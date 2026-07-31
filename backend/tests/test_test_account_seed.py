"""开发测试账号初始化测试。"""

import os
import sys
import unittest

import bcrypt
from sqlalchemy import create_engine, func, select
from sqlalchemy.pool import StaticPool

BACKEND_DIR = os.path.dirname(os.path.dirname(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from database import friendships, metadata, users  # noqa: E402
from services.test_account_seed import TEST_ACCOUNTS, seed_test_accounts  # noqa: E402


class TestAccountSeedTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        metadata.create_all(self.engine)

    def tearDown(self):
        self.engine.dispose()

    def test_seed_is_idempotent_and_creates_expected_relationships(self):
        first = seed_test_accounts(self.engine)
        second = seed_test_accounts(self.engine)

        self.assertEqual(3, first["created"])
        self.assertEqual(2, first["friendship_rows_created"])
        self.assertEqual(0, second["created"])
        self.assertEqual(3, second["refreshed"])
        self.assertEqual(0, second["friendship_rows_created"])

        with self.engine.connect() as connection:
            account_rows = connection.execute(
                select(users).where(users.c.username.in_([
                    account["username"] for account in TEST_ACCOUNTS
                ]))
            ).mappings().all()
            relationship_count = connection.execute(
                select(func.count()).select_from(friendships)
            ).scalar_one()

        self.assertEqual(3, len(account_rows))
        self.assertEqual(2, relationship_count)
        by_username = {row["username"]: row for row in account_rows}
        for account in TEST_ACCOUNTS:
            self.assertTrue(bcrypt.checkpw(
                account["password"].encode("utf-8"),
                by_username[account["username"]]["password_hash"].encode("utf-8"),
            ))

        account_three_id = by_username["kin_test_03"]["id"]
        with self.engine.connect() as connection:
            account_three_relationships = connection.execute(
                select(func.count())
                .select_from(friendships)
                .where(friendships.c.user_id == account_three_id)
            ).scalar_one()
        self.assertEqual(0, account_three_relationships)

    def test_reseed_keeps_activated_public_key(self):
        seed_test_accounts(self.engine)
        with self.engine.begin() as connection:
            connection.execute(
                users.update()
                .where(users.c.username == "kin_test_01")
                .values(public_key="activated-key")
            )

        seed_test_accounts(self.engine)

        with self.engine.connect() as connection:
            public_key = connection.execute(
                select(users.c.public_key).where(users.c.username == "kin_test_01")
            ).scalar_one()
        self.assertEqual("activated-key", public_key)


if __name__ == "__main__":
    unittest.main()
