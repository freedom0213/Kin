"""离线消息状态机测试。"""

import os
import sys
import unittest

from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

BACKEND_DIR = os.path.dirname(os.path.dirname(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from database import metadata, offline_messages  # noqa: E402
from services.offline_message_store import (  # noqa: E402
    MessageConflictError,
    OfflineMessageStore,
)


class OfflineMessageStoreTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        metadata.create_all(self.engine)
        self.store = OfflineMessageStore(self.engine, offline_messages)

    def tearDown(self):
        self.engine.dispose()

    def payload(self, msg_id="message-1"):
        return {
            "type": "chat_message",
            "msg_id": msg_id,
            "content": "encrypted-payload",
            "encrypted": True,
        }

    def test_enqueue_is_idempotent(self):
        first = self.store.enqueue("alice", "bob", self.payload(), now=100)
        second = self.store.enqueue("alice", "bob", self.payload(), now=101)

        self.assertTrue(first["created"])
        self.assertFalse(second["created"])
        self.assertEqual("queued", second["status"])
        self.assertEqual(1, len(self.store.pending_for("bob", now=102)))

    def test_conflicting_message_id_is_rejected(self):
        self.store.enqueue("alice", "bob", self.payload(), now=100)
        with self.assertRaises(MessageConflictError):
            self.store.enqueue("mallory", "bob", self.payload(), now=101)

    def test_delivery_ack_clears_ciphertext(self):
        self.store.enqueue("alice", "bob", self.payload(), now=100)
        result = self.store.acknowledge_delivery("bob", "message-1", now=110)

        self.assertEqual("alice", result["sender_id"])
        stored = self.store.get("message-1")
        self.assertEqual("delivered", stored["status"])
        self.assertIsNone(stored["content"])
        self.assertEqual([], self.store.pending_for("bob", now=111))

    def test_read_status_is_restored_for_sender(self):
        self.store.enqueue("alice", "bob", self.payload(), now=100)
        self.store.acknowledge_delivery("bob", "message-1", now=110)
        self.store.mark_read("bob", "message-1", now=120)

        updates = self.store.status_updates_for("alice", now=121)
        self.assertEqual([{
            "msg_id": "message-1",
            "recipient_id": "bob",
            "status": "read",
        }], updates)

    def test_expired_messages_are_removed(self):
        self.store.enqueue("alice", "bob", self.payload(), now=100)
        removed = self.store.cleanup_expired(now=100 + 8 * 86_400)

        self.assertEqual(1, removed)
        self.assertIsNone(self.store.get("message-1"))

    def test_plaintext_cannot_be_queued(self):
        payload = self.payload()
        payload["encrypted"] = False
        with self.assertRaisesRegex(ValueError, "端到端加密"):
            self.store.enqueue("alice", "bob", payload, now=100)


if __name__ == "__main__":
    unittest.main()
