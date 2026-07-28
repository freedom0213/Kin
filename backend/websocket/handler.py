"""WebSocket 连接管理 + 消息路由 + 通话信令"""

import asyncio
import json
from fastapi import WebSocket

from services.auth_service import decode_token
from services import friend_service, status_service
from services.offline_message_store import MessageConflictError, message_store

CALL_RECONNECT_GRACE_SECONDS = 12.0


class ConnectionManager:
    """管理所有活跃的 WebSocket 连接"""

    def __init__(self, store=message_store, call_reconnect_grace: float = CALL_RECONNECT_GRACE_SECONDS):
        self._connections: dict[str, WebSocket] = {}
        self._store = store
        self._call_reconnect_grace = call_reconnect_grace
        self._active_call_by_user: dict[str, str] = {}
        self._call_participants: dict[str, tuple[str, str]] = {}
        self._call_disconnect_tasks: dict[str, asyncio.Task] = {}

    async def connect(self, websocket: WebSocket, token: str) -> str | None:
        """认证并建立连接，成功返回 user_id，失败返回 None"""
        payload = decode_token(token)
        if not payload:
            await websocket.close(code=4001, reason="无效的登录令牌")
            return None

        user_id = payload["sub"]
        await websocket.accept()
        self._connections[user_id] = websocket
        disconnect_task = self._call_disconnect_tasks.pop(user_id, None)
        if disconnect_task:
            disconnect_task.cancel()
        status_service.set_online(user_id)

        call_id = self._active_call_by_user.get(user_id)
        participants = self._call_participants.get(call_id) if call_id else None
        if call_id and participants:
            caller_id, callee_id = participants
            peer_id = callee_id if user_id == caller_id else caller_id
            await self.send_json(user_id, {
                "type": "call_resumed",
                "call_id": call_id,
                "from": peer_id,
            })
            await self.send_json(peer_id, {
                "type": "call_peer_resumed",
                "call_id": call_id,
                "from": user_id,
            })

        # 通知好友上线（后台执行，不阻塞连接建立）
        asyncio.create_task(self._notify_status_change(user_id, True))

        return user_id

    def disconnect(self, user_id: str, websocket: WebSocket | None = None):
        """断开连接"""
        if websocket is not None and self._connections.get(user_id) is not websocket:
            return
        self._connections.pop(user_id, None)
        call_id = self._active_call_by_user.get(user_id)
        if call_id:
            previous_task = self._call_disconnect_tasks.pop(user_id, None)
            if previous_task:
                previous_task.cancel()
            try:
                self._call_disconnect_tasks[user_id] = asyncio.get_running_loop().create_task(
                    self._expire_disconnected_call(user_id, call_id)
                )
            except RuntimeError:
                self._release_user_call(user_id)
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

    def _register_call(self, call_id: str, caller_id: str, callee_id: str):
        self._call_participants[call_id] = (caller_id, callee_id)
        self._active_call_by_user[caller_id] = call_id
        self._active_call_by_user[callee_id] = call_id

    def _release_call(self, call_id: str) -> tuple[str, str] | None:
        participants = self._call_participants.pop(call_id, None)
        if not participants:
            return None
        try:
            current_task = asyncio.current_task()
        except RuntimeError:
            current_task = None
        for user_id in participants:
            if self._active_call_by_user.get(user_id) == call_id:
                self._active_call_by_user.pop(user_id, None)
            disconnect_task = self._call_disconnect_tasks.pop(user_id, None)
            if disconnect_task and disconnect_task is not current_task:
                disconnect_task.cancel()
        return participants

    async def _expire_disconnected_call(self, user_id: str, call_id: str):
        """短暂保留通话，给 WebSocket 重连和 ICE Restart 留出恢复窗口。"""
        try:
            await asyncio.sleep(self._call_reconnect_grace)
            if self.is_online(user_id) or self._active_call_by_user.get(user_id) != call_id:
                return
            released_call = self._release_user_call(user_id)
            if not released_call:
                return
            _, peer_id = released_call
            await self.send_json(peer_id, {
                "type": "call_end",
                "call_id": call_id,
                "from": user_id,
                "detail": "对方连接恢复超时",
            })
        finally:
            current_task = asyncio.current_task()
            if self._call_disconnect_tasks.get(user_id) is current_task:
                self._call_disconnect_tasks.pop(user_id, None)

    def _release_user_call(self, user_id: str) -> tuple[str, str] | None:
        call_id = self._active_call_by_user.get(user_id)
        if not call_id:
            return None
        participants = self._release_call(call_id)
        if not participants:
            return None
        caller_id, callee_id = participants
        peer_id = callee_id if user_id == caller_id else caller_id
        return call_id, peer_id

    def _matches_call(self, call_id: str, from_id: str, to_id: str) -> bool:
        participants = self._call_participants.get(call_id)
        if not participants:
            return False
        return {from_id, to_id} == set(participants)

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

    async def notify_profile_change(self, user_id: str, profile: dict):
        """向当前在线好友广播公开资料变更，不包含密码、公钥等敏感字段。"""
        try:
            loop = asyncio.get_running_loop()
            friends = await loop.run_in_executor(None, friend_service.get_friend_list, user_id)
            payload = {
                "type": "friend_profile",
                "user_id": user_id,
                "username": profile.get("username"),
                "nickname": profile.get("nickname"),
                "avatar": profile.get("avatar"),
                "profile_banner": profile.get("profile_banner"),
                "status_msg": profile.get("status_msg"),
            }
            for friend in friends:
                await self.send_json(friend["user_id"], payload)
        except Exception:
            # 资料已经写入数据库；实时通知失败时由好友下次刷新恢复最终状态。
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
                          "ice_candidate", "ice_restart_request", "ice_restart_offer",
                          "ice_restart_answer", "call_end"):
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
        """校验通话会话和忙线状态后转发 WebRTC 信令。"""
        msg_type = data.get("type")
        to_id = data.get("to")
        call_id = data.get("call_id")
        if (
            not to_id
            or to_id == from_id
            or not isinstance(call_id, str)
            or not 8 <= len(call_id) <= 128
        ):
            await self.send_json(from_id, {
                "type": "call_rejected",
                "code": "INVALID_CALL",
                "detail": "通话标识无效",
                "call_id": call_id,
                "from": to_id,
            })
            return

        if msg_type == "call_request":
            loop = asyncio.get_running_loop()
            is_friend = await loop.run_in_executor(
                None, friend_service.are_friends, from_id, to_id
            )
            if not is_friend:
                await self.send_json(from_id, {
                    "type": "call_rejected",
                    "code": "NOT_FRIEND",
                    "detail": "只能与好友进行语音通话",
                    "call_id": call_id,
                    "from": to_id,
                })
                return

            if not self.is_online(to_id):
                await self.send_json(from_id, {
                    "type": "call_rejected",
                    "code": "USER_OFFLINE",
                    "detail": "对方不在线",
                    "call_id": call_id,
                    "from": to_id,
                })
                return

            if call_id in self._call_participants:
                await self.send_json(from_id, {
                    "type": "call_rejected",
                    "code": "INVALID_CALL",
                    "detail": "通话标识已被使用",
                    "call_id": call_id,
                    "from": to_id,
                })
                return

            if from_id in self._active_call_by_user:
                await self.send_json(from_id, {
                    "type": "call_rejected",
                    "code": "CALLER_BUSY",
                    "detail": "你正在进行另一场通话",
                    "call_id": call_id,
                    "from": to_id,
                })
                return

            if to_id in self._active_call_by_user:
                await self.send_json(from_id, {
                    "type": "call_rejected",
                    "code": "CALL_BUSY",
                    "detail": "对方正在通话",
                    "call_id": call_id,
                    "from": to_id,
                })
                return

            self._register_call(call_id, from_id, to_id)
            outgoing = {**data, "from": from_id}
            delivered = await self.send_json(to_id, outgoing)
            if not delivered:
                self._release_call(call_id)
                await self.send_json(from_id, {
                    "type": "call_rejected",
                    "code": "DELIVERY_FAILED",
                    "detail": "暂时无法联系对方",
                    "call_id": call_id,
                    "from": to_id,
                })
            return

        if not self._matches_call(call_id, from_id, to_id):
            await self.send_json(from_id, {
                "type": "call_rejected",
                "code": "INVALID_CALL",
                "detail": "通话已失效",
                "call_id": call_id,
                "from": to_id,
            })
            return

        caller_id, callee_id = self._call_participants[call_id]
        if msg_type in ("call_accepted", "call_rejected", "ice_restart_request", "ice_restart_answer") and (
            from_id != callee_id or to_id != caller_id
        ):
            await self.send_json(from_id, {
                "type": "call_rejected",
                "code": "INVALID_CALL",
                "detail": "通话信令方向无效",
                "call_id": call_id,
                "from": to_id,
            })
            return

        if msg_type == "ice_restart_offer" and (
            from_id != caller_id or to_id != callee_id
        ):
            await self.send_json(from_id, {
                "type": "call_rejected",
                "code": "INVALID_CALL",
                "detail": "通话恢复信令方向无效",
                "call_id": call_id,
                "from": to_id,
            })
            return

        outgoing = {**data, "from": from_id}
        delivered = await self.send_json(to_id, outgoing)
        recoverable_signal = msg_type in (
            "ice_candidate", "ice_restart_request", "ice_restart_offer", "ice_restart_answer"
        )
        if msg_type in ("call_rejected", "call_end") or (not delivered and not recoverable_signal):
            self._release_call(call_id)
        if not delivered:
            await self.send_json(from_id, {
                "type": "call_signal_unavailable" if recoverable_signal else "call_rejected",
                "code": "SIGNAL_RETRY" if recoverable_signal else "DELIVERY_FAILED",
                "detail": "等待对方恢复连接" if recoverable_signal else "对方连接已断开",
                "call_id": call_id,
                "from": to_id,
                "signal_type": msg_type,
            })


manager = ConnectionManager()
