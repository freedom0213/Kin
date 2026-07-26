"""WebSocket 连接管理 + 消息路由 + 通话信令"""

import asyncio
import json
from fastapi import WebSocket

from services.auth_service import decode_token
from services import friend_service, status_service
from services.offline_message_store import MessageConflictError, message_store


class ConnectionManager:
    """管理所有活跃的 WebSocket 连接"""

    def __init__(self, store=message_store):
        self._connections: dict[str, WebSocket] = {}
        self._store = store

    async def connect(self, websocket: WebSocket, token: str) -> str | None:
        """认证并建立连接，成功返回 user_id，失败返回 None"""
        payload = decode_token(token)
        if not payload:
            await websocket.close(code=4001, reason="无效的登录令牌")
            return None

        user_id = payload["sub"]
        await websocket.accept()
        self._connections[user_id] = websocket
        status_service.set_online(user_id)

        # 通知好友上线（后台执行，不阻塞连接建立）
        asyncio.create_task(self._notify_status_change(user_id, True))

        return user_id

    def disconnect(self, user_id: str, websocket: WebSocket | None = None):
        """断开连接"""
        if websocket is not None and self._connections.get(user_id) is not websocket:
            return
        self._connections.pop(user_id, None)
        status_service.set_offline(user_id)
        # 通知好友离线（后台执行）
        asyncio.create_task(self._notify_status_change(user_id, False))

    def is_online(self, user_id: str) -> bool:
        return user_id in self._connections

    async def send_json(self, user_id: str, data: dict) -> bool:
        """发送 JSON 消息给指定用户"""
        ws = self._connections.get(user_id)
        if ws:
            try:
                await ws.send_json(data)
                return True
            except Exception:
                return False
        return False

    def get_online_count(self) -> int:
        return len(self._connections)

    async def _notify_status_change(self, user_id: str, online: bool):
        """通知所有好友上线/离线状态变化（后台任务，出错不影响主流程）"""
        try:
            from services.friend_service import get_friend_list
            loop = asyncio.get_event_loop()
            friends = await loop.run_in_executor(None, get_friend_list, user_id)
            for f in friends:
                await self.send_json(f["user_id"], {
                    "type": "friend_status",
                    "user_id": user_id,
                    "is_online": online,
                })
        except Exception:
            pass

    # -- 消息路由 --

    async def handle_message(self, from_id: str, data: dict):
        """处理收到的 WebSocket 消息"""
        msg_type = data.get("type")

        if msg_type == "heartbeat":
            await self.send_json(from_id, {"type": "heartbeat_ack"})

        elif msg_type == "chat_message":
            await self._handle_chat_message(from_id, data)

        elif msg_type == "voice_message":
            await self._handle_chat_message(from_id, data)  # 与文字消息相同转发逻辑

        elif msg_type == "read_receipt":
            await self._handle_read_receipt(from_id, data)

        elif msg_type == "message_received":
            await self._handle_message_received(from_id, data)

        elif msg_type == "sync_messages":
            await self._handle_sync_messages(from_id)

        elif msg_type == "typing":
            await self._handle_typing(from_id, data)

        # -- WebRTC 通话信令（纯转发） --
        elif msg_type in ("call_request", "call_accepted", "call_rejected",
                          "ice_candidate", "call_end"):
            await self._handle_call_signaling(from_id, data)

    async def _handle_chat_message(self, from_id: str, data: dict):
        """持久化密文并尝试实时投递；重复 msg_id 按当前状态幂等响应。"""
        to_id = data.get("to")
        if not to_id:
            await self.send_json(from_id, {"type": "error", "detail": "缺少接收方"})
            return

        loop = asyncio.get_running_loop()
        is_friend = await loop.run_in_executor(None, friend_service.are_friends, from_id, to_id)
        if not is_friend:
            await self.send_json(from_id, {
                "type": "error",
                "code": "NOT_FRIEND",
                "detail": "只能向好友发送消息",
                "to": to_id,
                "msg_id": data.get("msg_id"),
            })
            return

        # 未加密消息仅允许在线直传，服务端不会落盘保存明文。
        if not data.get("encrypted"):
            if not self.is_online(to_id):
                await self.send_json(from_id, {
                    "type": "error",
                    "code": "ENCRYPTION_REQUIRED",
                    "detail": "对方离线，未加密消息无法暂存",
                    "to": to_id,
                    "msg_id": data.get("msg_id"),
                })
                return
            outgoing = {**data, "from": from_id}
            delivered = await self.send_json(to_id, outgoing)
            await self.send_json(from_id, {
                "type": "delivered" if delivered else "error",
                "code": None if delivered else "DELIVERY_FAILED",
                "msg_id": data.get("msg_id"),
                "to": to_id,
            })
            return

        try:
            stored = await loop.run_in_executor(
                None, self._store.enqueue, from_id, to_id, dict(data)
            )
        except MessageConflictError as error:
            await self.send_json(from_id, {
                "type": "error", "code": "MESSAGE_ID_CONFLICT",
                "detail": str(error), "to": to_id, "msg_id": data.get("msg_id"),
            })
            return
        except ValueError as error:
            await self.send_json(from_id, {
                "type": "error", "code": "INVALID_MESSAGE",
                "detail": str(error), "to": to_id, "msg_id": data.get("msg_id"),
            })
            return

        await self.send_json(from_id, {
            "type": stored["status"],
            "msg_id": data.get("msg_id"),
            "to": to_id,
        })
        if stored["status"] == "queued" and self.is_online(to_id):
            await self._deliver_pending_to(to_id)

    async def _handle_message_received(self, from_id: str, data: dict):
        """接收设备保存成功后确认；清除服务端密文并通知发送方已送达。"""
        msg_id = data.get("msg_id")
        if not msg_id:
            return
        loop = asyncio.get_running_loop()
        stored = await loop.run_in_executor(
            None, self._store.acknowledge_delivery, from_id, msg_id
        )
        if stored:
            await self.send_json(stored["sender_id"], {
                "type": "delivered",
                "msg_id": msg_id,
                "to": from_id,
            })

    async def _handle_read_receipt(self, from_id: str, data: dict):
        """验证并持久化已读回执；旧的在线明文消息仍兼容直接转发。"""
        to_id = data.get("to")
        if not to_id:
            return
        msg_id = data.get("msg_id")
        loop = asyncio.get_running_loop()
        stored = await loop.run_in_executor(None, self._store.mark_read, from_id, msg_id)
        target_id = stored["sender_id"] if stored else to_id
        await self.send_json(target_id, {
            "type": "read_receipt",
            "from": from_id,
            "msg_id": msg_id,
        })

    async def _handle_sync_messages(self, user_id: str):
        """客户端准备完成后补发待收消息，并恢复自己已发送消息的状态。"""
        await self._deliver_pending_to(user_id)
        loop = asyncio.get_running_loop()
        updates = await loop.run_in_executor(None, self._store.status_updates_for, user_id)
        for item in updates:
            await self.send_json(user_id, {
                "type": "message_status",
                "msg_id": item["msg_id"],
                "to": item["recipient_id"],
                "status": item["status"],
            })
        await self.send_json(user_id, {"type": "sync_complete"})

    async def _deliver_pending_to(self, recipient_id: str):
        loop = asyncio.get_running_loop()
        pending = await loop.run_in_executor(None, self._store.pending_for, recipient_id)
        for item in pending:
            sent = await self.send_json(recipient_id, {
                "type": item["message_type"],
                "from": item["sender_id"],
                "to": recipient_id,
                "content": item["content"],
                "duration": item["duration"],
                "msg_id": item["msg_id"],
                "encrypted": True,
                "created_at": item["created_at"],
                "offline_delivery": True,
            })
            if not sent:
                break

    async def _handle_typing(self, from_id: str, data: dict):
        """转发正在输入状态"""
        to_id = data.get("to")
        if not to_id:
            return
        data["from"] = from_id
        await self.send_json(to_id, data)

    async def _handle_call_signaling(self, from_id: str, data: dict):
        """转发 WebRTC 通话信令（服务器不解密，只转发）"""
        to_id = data.get("to")
        if not to_id:
            return

        if not self.is_online(to_id):
            await self.send_json(from_id, {
                "type": "call_rejected",
                "detail": "对方不在线",
                "from": to_id,
            })
            return

        # 添加发送方信息后转发
        data["from"] = from_id
        await self.send_json(to_id, data)


manager = ConnectionManager()
