"""个人资料更新服务测试。"""

import os
import sys
import unittest
import base64

from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

BACKEND_DIR = os.path.dirname(os.path.dirname(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from database import metadata, users  # noqa: E402
from services import auth_service  # noqa: E402


class AuthProfileTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        metadata.create_all(self.engine)
        with self.engine.begin() as conn:
            conn.execute(users.insert().values(
                id="alice",
                username="alice",
                password_hash="hash",
            ))
        self.original_engine = auth_service.engine
        auth_service.engine = self.engine

    def tearDown(self):
        auth_service.engine = self.original_engine
        self.engine.dispose()

    def test_update_profile_normalizes_whitespace(self):
        profile = auth_service.update_profile(
            "alice",
            "  Alice   Lin  ",
            "  今天也想去   远一点的地方  ",
        )

        self.assertIsNotNone(profile)
        self.assertEqual("Alice Lin", profile["nickname"])
        self.assertEqual("今天也想去 远一点的地方", profile["status_msg"])

    def test_blank_values_clear_optional_profile_fields(self):
        auth_service.update_profile("alice", "Alice", "hello")
        profile = auth_service.update_profile("alice", "   ", "\n\t")

        self.assertIsNone(profile["nickname"])
        self.assertIsNone(profile["status_msg"])

    def test_unknown_user_is_not_created(self):
        self.assertIsNone(auth_service.update_profile("missing", "Name", "Status"))

    def test_update_profile_banner_returns_old_value(self):
        profile, old_banner = auth_service.update_profile_banner(
            "alice", "/media/profile-banners/first.jpg"
        )
        self.assertIsNone(old_banner)
        self.assertEqual("/media/profile-banners/first.jpg", profile["profile_banner"])

        profile, old_banner = auth_service.update_profile_banner("alice", None)
        self.assertEqual("/media/profile-banners/first.jpg", old_banner)
        self.assertIsNone(profile["profile_banner"])

    def test_service_rejects_overlong_values(self):
        with self.assertRaisesRegex(ValueError, "昵称最多 24 个字符"):
            auth_service.update_profile("alice", "a" * 25, None)

    def test_update_public_key_accepts_curve25519_key(self):
        public_key = base64.b64encode(bytes(range(32))).decode("ascii")

        profile = auth_service.update_public_key("alice", public_key)

        self.assertEqual(public_key, profile["public_key"])

    def test_update_public_key_rejects_invalid_key(self):
        with self.assertRaisesRegex(ValueError, "无效的端到端加密公钥"):
            auth_service.update_public_key("alice", "not-a-key")


if __name__ == "__main__":
    unittest.main()
