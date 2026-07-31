"""开发/内部测试账号的幂等初始化。"""

from __future__ import annotations

from datetime import datetime, timezone

import bcrypt
from sqlalchemy import and_, select
from sqlalchemy.engine import Engine

from database import engine, friendships, users


TEST_ACCOUNTS = (
    {
        "id": "kin-test-account-01",
        "username": "kin_test_01",
        "password": "KinTest01!",
        "nickname": "Kin 测试一号",
        "status_msg": "用于聊天与在线状态测试",
    },
    {
        "id": "kin-test-account-02",
        "username": "kin_test_02",
        "password": "KinTest02!",
        "nickname": "Kin 测试二号",
        "status_msg": "用于聊天与离线消息测试",
    },
    {
        "id": "kin-test-account-03",
        "username": "kin_test_03",
        "password": "KinTest03!",
        "nickname": "Kin 配对测试",
        "status_msg": "初始无好友，用于配对流程测试",
    },
)


def _ensure_friendship(
    connection,
    relationship_id: str,
    user_id: str,
    friend_id: str,
    meet_at: datetime,
) -> bool:
    existing = connection.execute(
        select(friendships.c.id).where(
            and_(
                friendships.c.user_id == user_id,
                friendships.c.friend_id == friend_id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        return False
    connection.execute(
        friendships.insert().values(
            id=relationship_id,
            user_id=user_id,
            friend_id=friend_id,
            meet_at=meet_at,
        )
    )
    return True


def seed_test_accounts(db_engine: Engine = engine) -> dict[str, int]:
    """创建或刷新三个测试账号，并确保 01/02 为双向好友。

    已激活账号的 public_key 不会被覆盖，因此重复执行不会破坏设备密钥。
    03 的后续测试好友关系也不会在重复执行时被清除。
    """

    created = 0
    refreshed = 0
    friendship_rows_created = 0
    account_ids: dict[str, str] = {}
    password_hashes = {
        account["username"]: bcrypt.hashpw(
            account["password"].encode("utf-8"),
            bcrypt.gensalt(),
        ).decode("utf-8")
        for account in TEST_ACCOUNTS
    }

    with db_engine.begin() as connection:
        for account in TEST_ACCOUNTS:
            existing = connection.execute(
                select(users.c.id).where(users.c.username == account["username"])
            ).scalar_one_or_none()
            values = {
                "username": account["username"],
                "password_hash": password_hashes[account["username"]],
                "nickname": account["nickname"],
                "status_msg": account["status_msg"],
            }
            if existing:
                connection.execute(
                    users.update().where(users.c.id == existing).values(**values)
                )
                refreshed += 1
                account_ids[account["username"]] = existing
            else:
                connection.execute(
                    users.insert().values(id=account["id"], **values)
                )
                created += 1
                account_ids[account["username"]] = account["id"]

        meet_at = datetime.now(timezone.utc)
        friendship_rows_created += int(_ensure_friendship(
            connection,
            "kin-test-friendship-01-02",
            account_ids[TEST_ACCOUNTS[0]["username"]],
            account_ids[TEST_ACCOUNTS[1]["username"]],
            meet_at,
        ))
        friendship_rows_created += int(_ensure_friendship(
            connection,
            "kin-test-friendship-02-01",
            account_ids[TEST_ACCOUNTS[1]["username"]],
            account_ids[TEST_ACCOUNTS[0]["username"]],
            meet_at,
        ))

    return {
        "created": created,
        "refreshed": refreshed,
        "friendship_rows_created": friendship_rows_created,
    }
