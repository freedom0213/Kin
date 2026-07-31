"""NFC 双方确认配对状态机测试。"""

import os
import sys
import unittest

from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

BACKEND_DIR = os.path.dirname(os.path.dirname(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from database import metadata, pairing_sessions, users  # noqa: E402
import config  # noqa: E402
from services.pairing_service import PairingError, PairingService  # noqa: E402


class PairingServiceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        metadata.create_all(self.engine)
        with self.engine.begin() as conn:
            for user_id in ("alice", "bob", "carol"):
                conn.execute(users.insert().values(
                    id=user_id,
                    username=user_id,
                    password_hash="hash",
                    nickname=user_id.title(),
                ))
        self.friendships = set()

        def create_friendship(first, second):
            pair = frozenset((first, second))
            if pair in self.friendships:
                return {"success": False, "message": "你们已经是好友了"}
            self.friendships.add(pair)
            return {"success": True, "message": "好友添加成功"}

        def are_friends(first, second):
            return frozenset((first, second)) in self.friendships

        self.service = PairingService(
            self.engine,
            pairing_sessions,
            users,
            friendship_creator=create_friendship,
            friendship_checker=are_friends,
        )

    def tearDown(self):
        self.engine.dispose()

    def test_both_participants_must_confirm(self):
        created = self.service.create("alice", now=100)
        joined = self.service.join("bob", created["token"], now=101)

        alice_confirmed = self.service.confirm(created["id"], "alice", now=102)
        self.assertEqual("awaiting_confirmation", alice_confirmed["status"])
        self.assertTrue(alice_confirmed["viewer_confirmed"])
        self.assertFalse(alice_confirmed["peer_confirmed"])
        self.assertEqual(set(), self.friendships)

        completed = self.service.confirm(created["id"], "bob", now=103)
        self.assertEqual("completed", completed["status"])
        self.assertEqual({frozenset(("alice", "bob"))}, self.friendships)

    def test_pairing_peer_includes_temporary_profile_banner(self):
        with self.engine.begin() as conn:
            conn.execute(
                users.update()
                .where(users.c.id == "bob")
                .values(profile_banner="/media/profile-banners/bob-card.jpg")
            )

        created = self.service.create("alice", now=100)
        self.service.join("bob", created["token"], now=101)
        alice_snapshot = self.service.get(created["id"], "alice", now=102)

        self.assertEqual(
            "/media/profile-banners/bob-card.jpg",
            alice_snapshot["peer"]["profile_banner"],
        )

    def test_third_user_cannot_take_joined_session(self):
        created = self.service.create("alice", now=100)
        self.service.join("bob", created["token"], now=101)

        with self.assertRaisesRegex(PairingError, "另一台设备"):
            self.service.join("carol", created["token"], now=102)

    def test_user_cannot_join_own_session(self):
        created = self.service.create("alice", now=100)
        with self.assertRaisesRegex(PairingError, "自己"):
            self.service.join("alice", created["token"], now=101)

    def test_cancel_prevents_confirmation(self):
        created = self.service.create("alice", now=100)
        self.service.join("bob", created["token"], now=101)
        cancelled = self.service.cancel(created["id"], "bob", now=102)

        self.assertEqual("cancelled", cancelled["status"])
        with self.assertRaisesRegex(PairingError, "已经结束"):
            self.service.confirm(created["id"], "alice", now=103)

    def test_expired_session_cannot_be_joined(self):
        created = self.service.create("alice", now=100)
        with self.assertRaisesRegex(PairingError, "已经结束"):
            self.service.join("bob", created["token"], now=100 + config.PAIRING_SESSION_TTL + 1)

    def test_join_and_confirmation_are_idempotent(self):
        created = self.service.create("alice", now=100)
        first_join = self.service.join("bob", created["token"], now=101)
        second_join = self.service.join("bob", created["token"], now=102)
        self.assertEqual(first_join["id"], second_join["id"])

        self.service.confirm(created["id"], "alice", now=103)
        self.service.confirm(created["id"], "bob", now=104)
        completed_again = self.service.confirm(created["id"], "bob", now=105)
        self.assertEqual("completed", completed_again["status"])
        self.assertFalse(completed_again["_completed_now"])
        self.assertEqual(1, len(self.friendships))


if __name__ == "__main__":
    unittest.main()
