"""WebSocket 连接管理 + 消息路由"""

import asyncio
import json
from fastapi import WebSocket

from services.auth_service import decode_token
from services import status_service


class ConnectionManager:
    """管理所有活跃的 WebSocket 连接"""

    def __init__(self):
        self._connections: dict[str, WebSocket] = {}

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

    def disconnect(self, user_id: str):
        """断开连接"""
        self._connections.pop(user_id, None)
        status_service.set_offline(user_id)
        # 通知好友离线（后台执行）
        asyncio.create_task(self._notify_status_change(user_id, False))

    def is_online(self, user_id: str) -> bool:
        return user_id in self._connections

    async def send_json(self, user_id: str, data: dict):
        """发送 JSON 消息给指定用户"""
        ws = self._connections.get(user_id)
        if ws:
            try:
                await ws.send_json(data)
            except Exception:
                pass

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

        elif msg_type == "read_receipt":
            await self._handle_read_receipt(from_id, data)

        elif msg_type == "typing":
            await self._handle_typing(from_id, data)

    async def _handle_chat_message(self, from_id: str, data: dict):
        """转发聊天消息（同步模式：接收方离线则拒绝）"""
        to_id = data.get("to")
        if not to_id:
            await self.send_json(from_id, {"type": "error", "detail": "缺少接收方"})
            return

        if not self.is_online(to_id):
            await self.send_json(from_id, {
                "type": "error",
                "code": "OFFLINE",
                "detail": "对方不在线，消息未送达",
                "to": to_id,
            })
            return

        # 设置发送方为当前用户
        data["from"] = from_id
        await self.send_json(to_id, data)

        # 回传给发送方确认送达
        await self.send_json(from_id, {
            "type": "delivered",
            "msg_id": data.get("msg_id"),
            "to": to_id,
        })

    async def _handle_read_receipt(self, from_id: str, data: dict):
        """转发已读回执"""
        to_id = data.get("to")
        if not to_id:
            return
        data["from"] = from_id
        await self.send_json(to_id, data)

    async def _handle_typing(self, from_id: str, data: dict):
        """转发正在输入状态"""
        to_id = data.get("to")
        if not to_id:
            return
        data["from"] = from_id
        await self.send_json(to_id, data)


manager = ConnectionManager()
