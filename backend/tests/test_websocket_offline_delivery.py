"""WebSocket 离线消息协议集成测试。"""

import os
import sys
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

BACKEND_DIR = os.path.dirname(os.path.dirname(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from database import metadata, offline_messages  # noqa: E402
from services.offline_message_store import OfflineMessageStore  # noqa: E402
from websocket.handler import ConnectionManager  # noqa: E402


class FakeWebSocket:
    def __init__(self):
        self.sent = []

    async def send_json(self, data):
        self.sent.append(data)


class WebSocketOfflineDeliveryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        metadata.create_all(self.engine)
        self.store = OfflineMessageStore(self.engine, offline_messages)
        self.manager = ConnectionManager(self.store)
        self.alice = FakeWebSocket()
        self.manager._connections["alice"] = self.alice

    async def asyncTearDown(self):
        self.engine.dispose()

    @patch("websocket.handler.friend_service.are_friends", return_value=True)
    async def test_offline_ciphertext_is_queued_synced_and_acknowledged(self, _):
        await self.manager.handle_message("alice", {
            "type": "chat_message",
            "to": "bob",
            "msg_id": "message-1",
            "content": "ciphertext",
            "encrypted": True,
        })

        self.assertEqual("queued", self.alice.sent[-1]["type"])
        self.assertEqual("ciphertext", self.store.get("message-1")["content"])

        bob = FakeWebSocket()
        self.manager._connections["bob"] = bob
        await self.manager.handle_message("bob", {"type": "sync_messages"})

        delivered_payload = next(item for item in bob.sent if item["type"] == "chat_message")
        self.assertEqual("ciphertext", delivered_payload["content"])
        self.assertTrue(delivered_payload["offline_delivery"])

        await self.manager.handle_message("bob", {
            "type": "message_received",
            "msg_id": "message-1",
        })

        self.assertEqual("delivered", self.alice.sent[-1]["type"])
        stored = self.store.get("message-1")
        self.assertEqual("delivered", stored["status"])
        self.assertIsNone(stored["content"])

    @patch("websocket.handler.friend_service.are_friends", return_value=True)
    async def test_plaintext_is_not_stored_while_recipient_is_offline(self, _):
        await self.manager.handle_message("alice", {
            "type": "chat_message",
            "to": "bob",
            "msg_id": "message-2",
            "content": "plaintext",
            "encrypted": False,
        })

        self.assertEqual("error", self.alice.sent[-1]["type"])
        self.assertEqual("ENCRYPTION_REQUIRED", self.alice.sent[-1]["code"])
        self.assertIsNone(self.store.get("message-2"))

    @patch("websocket.handler.friend_service.get_friend_list")
    async def test_profile_change_only_broadcasts_public_fields(self, get_friend_list):
        get_friend_list.return_value = [{"user_id": "bob"}, {"user_id": "offline-user"}]
        bob = FakeWebSocket()
        self.manager._connections["bob"] = bob

        await self.manager.notify_profile_change("alice", {
            "id": "alice",
            "username": "alice",
            "nickname": "Alice Lin",
            "avatar": "/media/avatar.jpg",
            "profile_banner": "/media/profile-banners/card.jpg",
            "status_msg": "hello",
            "public_key": "must-not-leak",
            "password_hash": "must-not-leak",
        })

        self.assertEqual(1, len(bob.sent))
        self.assertEqual("friend_profile", bob.sent[0]["type"])
        self.assertEqual("alice", bob.sent[0]["user_id"])
        self.assertNotIn("public_key", bob.sent[0])
        self.assertNotIn("password_hash", bob.sent[0])


if __name__ == "__main__":
    unittest.main()
