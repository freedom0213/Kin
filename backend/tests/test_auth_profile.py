"""个人资料更新服务测试。"""

import os
import sys
import unittest

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

    def test_service_rejects_overlong_values(self):
        with self.assertRaisesRegex(ValueError, "昵称最多 24 个字符"):
            auth_service.update_profile("alice", "a" * 25, None)


if __name__ == "__main__":
    unittest.main()
