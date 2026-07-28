"""WebRTC 通话信令的会话隔离与忙线状态测试。"""

import asyncio
import asyncio
import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

BACKEND_DIR = os.path.dirname(os.path.dirname(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from websocket.handler import ConnectionManager  # noqa: E402


class FakeWebSocket:
    def __init__(self):
        self.sent = []

    async def send_json(self, data):
        self.sent.append(data)


class CallSignalingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.manager = ConnectionManager(store=object())
        self.alice = FakeWebSocket()
        self.bob = FakeWebSocket()
        self.carol = FakeWebSocket()
        self.manager._connections.update({
            "alice": self.alice,
            "bob": self.bob,
            "carol": self.carol,
        })

    @patch("websocket.handler.friend_service.are_friends", return_value=True)
    async def test_call_lifecycle_keeps_call_id_and_releases_busy_state(self, _):
        await self.manager.handle_message("alice", {
            "type": "call_request",
            "to": "bob",
            "call_id": "call-session-1",
            "sdp": {"type": "offer"},
        })

        self.assertEqual("call-session-1", self.bob.sent[-1]["call_id"])
        self.assertEqual("alice", self.bob.sent[-1]["from"])
        self.assertEqual("call-session-1", self.manager._active_call_by_user["alice"])
        self.assertEqual("call-session-1", self.manager._active_call_by_user["bob"])

        await self.manager.handle_message("bob", {
            "type": "call_accepted",
            "to": "alice",
            "call_id": "call-session-1",
            "sdp": {"type": "answer"},
        })
        self.assertEqual("call_accepted", self.alice.sent[-1]["type"])

        await self.manager.handle_message("alice", {
            "type": "ice_candidate",
            "to": "bob",
            "call_id": "call-session-1",
            "candidate": {"candidate": "candidate:1"},
        })
        self.assertEqual("ice_candidate", self.bob.sent[-1]["type"])

        await self.manager.handle_message("alice", {
            "type": "call_end",
            "to": "bob",
            "call_id": "call-session-1",
        })
        self.assertEqual("call_end", self.bob.sent[-1]["type"])
        self.assertNotIn("alice", self.manager._active_call_by_user)
        self.assertNotIn("bob", self.manager._active_call_by_user)

    @patch("websocket.handler.friend_service.are_friends", return_value=True)
    async def test_busy_user_rejects_second_call_without_releasing_first(self, _):
        await self.manager.handle_message("alice", {
            "type": "call_request", "to": "bob",
            "call_id": "call-session-1", "sdp": {},
        })
        await self.manager.handle_message("carol", {
            "type": "call_request", "to": "bob",
            "call_id": "call-session-2", "sdp": {},
        })

        self.assertEqual("CALL_BUSY", self.carol.sent[-1]["code"])
        self.assertEqual("call-session-2", self.carol.sent[-1]["call_id"])
        self.assertEqual("call-session-1", self.manager._active_call_by_user["bob"])

        await self.manager.handle_message("alice", {
            "type": "call_request", "to": "carol",
            "call_id": "call-session-3", "sdp": {},
        })
        self.assertEqual("CALLER_BUSY", self.alice.sent[-1]["code"])
        self.assertEqual("call-session-1", self.manager._active_call_by_user["alice"])

    @patch("websocket.handler.friend_service.are_friends", return_value=True)
    async def test_stale_signal_does_not_end_current_call(self, _):
        await self.manager.handle_message("alice", {
            "type": "call_request", "to": "bob",
            "call_id": "call-session-current", "sdp": {},
        })
        await self.manager.handle_message("alice", {
            "type": "call_end", "to": "bob",
            "call_id": "call-session-stale",
        })

        self.assertEqual("INVALID_CALL", self.alice.sent[-1]["code"])
        self.assertEqual("call-session-current", self.manager._active_call_by_user["alice"])
        self.assertEqual("call-session-current", self.manager._active_call_by_user["bob"])

    async def test_missing_call_id_is_rejected(self):
        await self.manager.handle_message("alice", {
            "type": "call_request", "to": "bob", "sdp": {},
        })

        self.assertEqual("INVALID_CALL", self.alice.sent[-1]["code"])
        self.assertEqual({}, self.manager._active_call_by_user)

    @patch("websocket.handler.friend_service.are_friends", return_value=False)
    async def test_non_friend_call_is_rejected(self, _):
        await self.manager.handle_message("alice", {
            "type": "call_request", "to": "bob",
            "call_id": "call-session-1", "sdp": {},
        })

        self.assertEqual("NOT_FRIEND", self.alice.sent[-1]["code"])
        self.assertEqual([], self.bob.sent)

    @patch("websocket.handler.friend_service.are_friends", return_value=True)
    async def test_disconnect_releases_call_and_notifies_peer(self, _):
        await self.manager.handle_message("alice", {
            "type": "call_request", "to": "bob",
            "call_id": "call-session-1", "sdp": {},
        })

        with patch.object(self.manager, "_notify_status_change", new=AsyncMock()):
            self.manager.disconnect("bob", self.bob)
            await asyncio.sleep(0)

        self.assertEqual("call_end", self.alice.sent[-1]["type"])
        self.assertEqual("call-session-1", self.alice.sent[-1]["call_id"])
        self.assertEqual({}, self.manager._active_call_by_user)


if __name__ == "__main__":
    unittest.main()
