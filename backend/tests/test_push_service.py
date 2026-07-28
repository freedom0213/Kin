"""系统推送设备存储与 Expo ticket 处理测试。"""

import json
import os
import sys
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

BACKEND_DIR = os.path.dirname(os.path.dirname(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from database import push_devices  # noqa: E402
from services.push_service import ExpoPushService, PushDeviceStore  # noqa: E402


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class PushServiceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        push_devices.create(self.engine)
        self.store = PushDeviceStore(self.engine, push_devices)
        self.service = ExpoPushService(self.store)

    def tearDown(self):
        self.engine.dispose()

    def test_register_reassign_and_unregister_device(self):
        token = "ExpoPushToken[abcdefghijklmnop]"
        first = self.store.register("alice", token, "android", now=10)
        self.assertEqual([token], self.store.tokens_for("alice"))

        second = self.store.register("bob", token, "ios", now=20)
        self.assertEqual([], self.store.tokens_for("alice"))
        self.assertEqual([token], self.store.tokens_for("bob"))
        self.assertFalse(self.store.unregister(token, first["unregister_secret"]))
        self.assertTrue(self.store.unregister(token, second["unregister_secret"]))
        self.assertEqual([], self.store.tokens_for("bob"))

    def test_invalid_token_is_rejected(self):
        with self.assertRaises(ValueError):
            self.store.register("alice", "not-a-push-token", "android")

    def test_non_serializable_payload_is_ignored(self):
        token = "ExpoPushToken[abcdefghijklmnop]"
        self.store.register("alice", token, "android")

        accepted = self.service.send_to_user(
            "alice",
            title="Kin",
            body="新消息",
            data={"invalid": object()},
            channel_id="kin-messages",
        )

        self.assertEqual(0, accepted)

    @patch("services.push_service.request.urlopen")
    def test_device_not_registered_ticket_removes_stale_token(self, urlopen):
        token = "ExponentPushToken[abcdefghijklmnop]"
        self.store.register("alice", token, "android")
        urlopen.return_value = FakeResponse({
            "data": [{
                "status": "error",
                "details": {"error": "DeviceNotRegistered"},
            }],
        })

        accepted = self.service.send_to_user(
            "alice",
            title="Kin",
            body="新消息",
            data={"notification_type": "message"},
            channel_id="kin-messages",
        )

        self.assertEqual(0, accepted)
        self.assertEqual([], self.store.tokens_for("alice"))


if __name__ == "__main__":
    unittest.main()
