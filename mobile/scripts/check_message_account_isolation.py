"""Regression check for account-scoped local chat storage.

This lightweight check uses Python's built-in SQLite engine because the mobile
project does not currently have a JavaScript test runner. It extracts the real
messages table definition from db.ts, validates the account-scoped primary key,
and reproduces two local accounts talking to the same friend.
"""

from __future__ import annotations

import re
import sqlite3
from pathlib import Path


DB_SOURCE = Path(__file__).resolve().parents[1] / "src" / "services" / "db.ts"


def extract_messages_schema(source: str) -> str:
    match = re.search(
        r"CREATE TABLE IF NOT EXISTS messages\s*\((.*?)\);",
        source,
        flags=re.DOTALL,
    )
    if not match:
        raise AssertionError("db.ts 中没有找到 messages 建表语句")
    return f"CREATE TABLE messages ({match.group(1)});"


def require_owner_scoped_queries(source: str) -> None:
    required_fragments = [
        "PRIMARY KEY (owner_id, id)",
        "WHERE owner_id = ? AND chat_id = ?",
        "WHERE owner_id = ? AND id = ?",
        "PARTITION BY owner_id, chat_id",
    ]
    missing = [fragment for fragment in required_fragments if fragment not in source]
    if missing:
        raise AssertionError(f"消息查询仍缺少账号作用域: {missing}")


def main() -> None:
    source = DB_SOURCE.read_text(encoding="utf-8")
    schema = extract_messages_schema(source)

    connection = sqlite3.connect(":memory:")
    connection.execute(schema)

    columns = {
        row[1]: {"pk_order": row[5], "not_null": bool(row[3])}
        for row in connection.execute("PRAGMA table_info(messages)")
    }
    assert "owner_id" in columns, "messages 表没有 owner_id，账号会共享同一份本地记录"
    assert columns["owner_id"]["not_null"], "owner_id 必须为 NOT NULL"
    assert columns["owner_id"]["pk_order"] == 1, "owner_id 必须是复合主键第一列"
    assert columns["id"]["pk_order"] == 2, "消息 ID 必须在账号范围内唯一"

    insert_sql = """
        INSERT INTO messages
        (owner_id, id, chat_id, sender_id, type, content, is_read, created_at)
        VALUES (?, ?, ?, ?, 'text', ?, 0, ?)
    """
    connection.execute(
        insert_sql,
        ("account_b", "message_1", "common_friend", "account_b", "B 与好友的消息", "2026-07-31T10:00:00Z"),
    )
    connection.execute(
        insert_sql,
        ("account_c", "message_1", "common_friend", "account_c", "C 与好友的消息", "2026-07-31T10:01:00Z"),
    )

    b_messages = connection.execute(
        "SELECT content FROM messages WHERE owner_id = ? AND chat_id = ? ORDER BY created_at",
        ("account_b", "common_friend"),
    ).fetchall()
    c_messages = connection.execute(
        "SELECT content FROM messages WHERE owner_id = ? AND chat_id = ? ORDER BY created_at",
        ("account_c", "common_friend"),
    ).fetchall()

    assert b_messages == [("B 与好友的消息",)], "账户 B 读到了其他账号的聊天记录"
    assert c_messages == [("C 与好友的消息",)], "账户 C 读到了其他账号的聊天记录"
    require_owner_scoped_queries(source)

    print("PASS: 本地消息表和关键查询均按 owner_id 隔离")


if __name__ == "__main__":
    main()
