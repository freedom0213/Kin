"""WebRTC 通话信令的会话隔离与忙线状态测试。"""

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

    async def accept(self):
        return None

    async def close(self, **_):
        return None


class FakePushSender:
    def __init__(self):
        self.users_with_devices = set()
        self.sent = []

    def has_devices(self, user_id):
        return user_id in self.users_with_devices

    def send_to_user(self, user_id, **payload):
        self.sent.append((user_id, payload))
        return 1


class CallSignalingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.push_sender = FakePushSender()
        self.manager = ConnectionManager(
            store=object(),
            call_reconnect_grace=0.02,
            call_ring_timeout=0.06,
            push_sender=self.push_sender,
        )
        self.alice = FakeWebSocket()
        self.bob = FakeWebSocket()
        self.carol = FakeWebSocket()
        self.manager._connections.update({
            "alice": self.alice,
            "bob": self.bob,
            "carol": self.carol,
        })

    @patch("websocket.handler.friend_service.are_friends", return_value=True)
    @patch("websocket.handler.auth_service.get_profile", return_value={
        "username": "alice_account",
        "nickname": "Alice Latest",
        "avatar": "/media/avatars/alice.png",
    })
    async def test_call_identity_comes_from_authenticated_profile(self, _, __):
        await self.manager.handle_message("alice", {
            "type": "call_request",
            "to": "bob",
            "call_id": "call-identity-1",
            "sdp": {"type": "offer"},
            "caller_name": "Spoofed Name",
            "caller_avatar": "/spoofed.png",
        })

        incoming = self.bob.sent[-1]
        self.assertEqual("Alice Latest", incoming["caller_name"])
        self.assertEqual("/media/avatars/alice.png", incoming["caller_avatar"])

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
    async def test_disconnect_keeps_call_during_grace_then_notifies_peer(self, _):
        await self.manager.handle_message("alice", {
            "type": "call_request", "to": "bob",
            "call_id": "call-session-1", "sdp": {},
        })
        await self.manager.handle_message("bob", {
            "type": "call_accepted", "to": "alice",
            "call_id": "call-session-1", "sdp": {},
        })
        self.alice.sent.clear()

        with patch.object(self.manager, "_notify_status_change", new=AsyncMock()):
            self.manager.disconnect("bob", self.bob)
            await asyncio.sleep(0)

        self.assertEqual("call-session-1", self.manager._active_call_by_user["bob"])
        self.assertEqual([], [item for item in self.alice.sent if item["type"] == "call_end"])

        await asyncio.sleep(0.04)

        self.assertEqual("call_end", self.alice.sent[-1]["type"])
        self.assertEqual("call-session-1", self.alice.sent[-1]["call_id"])
        self.assertEqual({}, self.manager._active_call_by_user)

    @patch("websocket.handler.decode_token", return_value={"sub": "bob"})
    @patch("websocket.handler.friend_service.are_friends", return_value=True)
    async def test_reconnect_within_grace_preserves_call_and_notifies_both_users(self, _, __):
        await self.manager.handle_message("alice", {
            "type": "call_request", "to": "bob",
            "call_id": "call-session-1", "sdp": {},
        })
        with patch.object(self.manager, "_notify_status_change", new=AsyncMock()):
            self.manager.disconnect("bob", self.bob)
            replacement = FakeWebSocket()
            await self.manager.connect(replacement, "token")

        await asyncio.sleep(0.04)
        self.assertEqual("call-session-1", self.manager._active_call_by_user["bob"])
        self.assertEqual("call_resumed", replacement.sent[-1]["type"])
        self.assertEqual("call_peer_resumed", self.alice.sent[-1]["type"])

    @patch("websocket.handler.friend_service.are_friends", return_value=True)
    async def test_ice_restart_offer_and_answer_are_relayed_without_releasing_call(self, _):
        await self.manager.handle_message("alice", {
            "type": "call_request", "to": "bob",
            "call_id": "call-session-1", "sdp": {},
        })
        await self.manager.handle_message("alice", {
            "type": "ice_restart_offer", "to": "bob",
            "call_id": "call-session-1", "sdp": {"type": "offer"},
        })
        self.assertEqual("ice_restart_offer", self.bob.sent[-1]["type"])

        await self.manager.handle_message("bob", {
            "type": "ice_restart_answer", "to": "alice",
            "call_id": "call-session-1", "sdp": {"type": "answer"},
        })
        self.assertEqual("ice_restart_answer", self.alice.sent[-1]["type"])
        self.assertEqual("call-session-1", self.manager._active_call_by_user["alice"])

    @patch("websocket.handler.friend_service.are_friends", return_value=True)
    async def test_callee_can_request_caller_to_start_ice_restart(self, _):
        await self.manager.handle_message("alice", {
            "type": "call_request", "to": "bob",
            "call_id": "call-session-1", "sdp": {},
        })
        await self.manager.handle_message("bob", {
            "type": "ice_restart_request", "to": "alice",
            "call_id": "call-session-1",
        })

        self.assertEqual("ice_restart_request", self.alice.sent[-1]["type"])
        self.assertEqual("bob", self.alice.sent[-1]["from"])

    @patch("websocket.handler.friend_service.are_friends", return_value=True)
    async def test_undelivered_restart_signal_keeps_call_for_reconnect_retry(self, _):
        await self.manager.handle_message("alice", {
            "type": "call_request", "to": "bob",
            "call_id": "call-session-1", "sdp": {},
        })
        self.manager._connections.pop("bob")

        await self.manager.handle_message("alice", {
            "type": "ice_restart_offer", "to": "bob",
            "call_id": "call-session-1", "sdp": {"type": "offer"},
        })

        self.assertEqual("call_signal_unavailable", self.alice.sent[-1]["type"])
        self.assertEqual("ice_restart_offer", self.alice.sent[-1]["signal_type"])
        self.assertEqual("call-session-1", self.manager._active_call_by_user["alice"])

    @patch("websocket.handler.friend_service.are_friends", return_value=True)
    @patch("websocket.handler.auth_service.get_profile", return_value={
        "username": "alice_account",
        "nickname": "Alice Latest",
        "avatar": "/media/avatars/alice.png",
    })
    async def test_offline_callee_with_push_device_receives_pending_call_after_reconnect(self, _, __):
        self.manager._connections.pop("bob")
        self.push_sender.users_with_devices.add("bob")
        await self.manager.handle_message("alice", {
            "type": "call_request", "to": "bob",
            "call_id": "call-session-push", "sdp": {"type": "offer"},
            "caller_name": "Alice",
        })

        self.assertEqual("call_queued", self.alice.sent[-1]["type"])
        await asyncio.sleep(0)
        self.assertEqual("incoming_call", self.push_sender.sent[-1][1]["data"]["notification_type"])
        self.assertEqual("Alice Latest", self.push_sender.sent[-1][1]["data"]["caller_name"])
        self.assertEqual(
            "/media/avatars/alice.png",
            self.push_sender.sent[-1][1]["data"]["caller_avatar"],
        )
        self.assertNotIn("sdp", self.push_sender.sent[-1][1]["data"])
        await self.manager.handle_message("alice", {
            "type": "ice_candidate", "to": "bob",
            "call_id": "call-session-push",
            "candidate": {"candidate": "candidate:push"},
        })

        replacement = FakeWebSocket()
        with patch("websocket.handler.decode_token", return_value={"sub": "bob"}), patch.object(
            self.manager, "_notify_status_change", new=AsyncMock()
        ):
            await self.manager.connect(replacement, "token")

        self.assertEqual("call_request", replacement.sent[0]["type"])
        self.assertEqual("call-session-push", replacement.sent[0]["call_id"])
        self.assertEqual("ice_candidate", replacement.sent[1]["type"])

    @patch("websocket.handler.friend_service.are_friends", return_value=True)
    async def test_offline_call_expires_when_recipient_does_not_reconnect(self, _):
        self.manager._connections.pop("bob")
        self.push_sender.users_with_devices.add("bob")
        await self.manager.handle_message("alice", {
            "type": "call_request", "to": "bob",
            "call_id": "call-session-timeout", "sdp": {"type": "offer"},
        })

        await asyncio.sleep(0.08)

        self.assertEqual("call_rejected", self.alice.sent[-1]["type"])
        self.assertEqual("UNANSWERED", self.alice.sent[-1]["code"])
        self.assertNotIn("call-session-timeout", self.manager._call_participants)


if __name__ == "__main__":
    unittest.main()
