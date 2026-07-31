"""在当前 Kin 后端数据库中创建开发测试账号。"""

from __future__ import annotations

import os
import sys


BACKEND_DIR = os.path.dirname(os.path.dirname(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from database import init_db  # noqa: E402
from services.test_account_seed import TEST_ACCOUNTS, seed_test_accounts  # noqa: E402


def main() -> None:
    init_db()
    result = seed_test_accounts()
    print(
        "测试账号初始化完成："
        f"新增 {result['created']}，刷新 {result['refreshed']}，"
        f"新增好友关系记录 {result['friendship_rows_created']}"
    )
    for account in TEST_ACCOUNTS:
        print(f"{account['username']} / {account['password']}")


if __name__ == "__main__":
    main()
