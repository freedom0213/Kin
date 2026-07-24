"""好友业务逻辑：NFC token、好友请求、好友列表"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, and_, or_, delete

import config
from database import engine, get_table


# -- NFC Token --

def generate_nfc_token(user_id: str) -> dict:
    """为用户生成一个用于 NFC 碰一碰的临时 token"""
    token = secrets.token_hex(16)  # 32字符随机token
    expires_at = datetime.utcnow() + timedelta(seconds=config.NFC_TOKEN_TTL)

    table = get_table("nfc_tokens")
    with engine.connect() as conn:
        conn.execute(
            table.insert().values(
                token=token,
                username=user_id,
                expires_at=expires_at,
            )
        )
        conn.commit()

    return {"token": token, "expires_at": int(expires_at.timestamp()), "ttl": config.NFC_TOKEN_TTL}


def resolve_nfc_token(token: str) -> str | None:
    """根据 NFC token 查找发起方 user_id，token 过期返回 None"""
    table = get_table("nfc_tokens")

    with engine.connect() as conn:
        stmt = select(table).where(table.c.token == token)
        row = conn.execute(stmt).mappings().first()

    if not row:
        return None

    # 检查过期（SQLite 存的是 naive UTC，用 utcnow 比较）
    expires_at = row["expires_at"]
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at < datetime.utcnow():
        _cleanup_expired_tokens()
        return None

    # 注：nfc_tokens.username 列实际存储 user_id（UUID）
    return row["username"]


def _cleanup_expired_tokens():
    """清理过期的 NFC token"""
    table = get_table("nfc_tokens")
    now = datetime.utcnow()  # naive UTC，与存储格式一致
    with engine.connect() as conn:
        conn.execute(delete(table).where(table.c.expires_at < now))
        conn.commit()


# -- 好友关系 --

def add_friendship(user_id: str, friend_id: str) -> dict:
    """建立双向好友关系"""
    table = get_table("friendships")
    now = datetime.now(timezone.utc)

    # 检查是否已经是好友
    with engine.connect() as conn:
        stmt = select(table).where(
            and_(table.c.user_id == user_id, table.c.friend_id == friend_id)
        )
        existing = conn.execute(stmt).first()
        if existing:
            return {"success": False, "message": "你们已经是好友了"}

        # 检查好友数量上限
        count_stmt = select(table).where(table.c.user_id == user_id)
        count = conn.execute(count_stmt).mappings().all()
        if len(list(count)) >= config.MAX_FRIENDS:
            return {"success": False, "message": f"好友已达上限（{config.MAX_FRIENDS}人）"}

        friend_count = select(table).where(table.c.user_id == friend_id)
        friend_count_result = conn.execute(friend_count).mappings().all()
        if len(list(friend_count_result)) >= config.MAX_FRIENDS:
            return {"success": False, "message": f"对方好友已达上限（{config.MAX_FRIENDS}人）"}

        # 双向插入
        conn.execute(
            table.insert().values(
                id=str(uuid.uuid4()),
                user_id=user_id,
                friend_id=friend_id,
                meet_at=now,
            )
        )
        conn.execute(
            table.insert().values(
                id=str(uuid.uuid4()),
                user_id=friend_id,
                friend_id=user_id,
                meet_at=now,
            )
        )
        conn.commit()

    return {"success": True, "message": "好友添加成功", "meet_at": now.strftime("%Y-%m-%d %H:%M:%S")}


def get_friend_list(user_id: str) -> list[dict]:
    """获取好友列表（含用户名等基本信息）"""
    friends_table = get_table("friendships")
    users_table = get_table("users")

    with engine.connect() as conn:
        stmt = (
            select(
                friends_table.c.friend_id,
                friends_table.c.meet_at,
                users_table.c.username,
                users_table.c.nickname,
                users_table.c.avatar,
                users_table.c.status_msg,
            )
            .select_from(
                friends_table.join(
                    users_table, friends_table.c.friend_id == users_table.c.id
                )
            )
            .where(friends_table.c.user_id == user_id)
            .order_by(users_table.c.username)
        )
        rows = conn.execute(stmt).mappings().all()

    return [
        {
            "user_id": row["friend_id"],
            "username": row["username"],
            "nickname": row["nickname"],
            "avatar": row["avatar"],
            "status_msg": row["status_msg"],
            "meet_at": row["meet_at"],
        }
        for row in rows
    ]


def remove_friend(user_id: str, friend_id: str) -> dict:
    """删除好友（双向删除）"""
    table = get_table("friendships")

    # 先检查是否是好友
    with engine.connect() as conn:
        stmt = select(table).where(
            and_(table.c.user_id == user_id, table.c.friend_id == friend_id)
        )
        row = conn.execute(stmt).first()
        if not row:
            return {"success": False, "message": "不是好友关系"}

        # 双向删除
        conn.execute(
            delete(table).where(
                or_(
                    and_(table.c.user_id == user_id, table.c.friend_id == friend_id),
                    and_(table.c.user_id == friend_id, table.c.friend_id == user_id),
                )
            )
        )
        conn.commit()

    return {"success": True, "message": "好友已删除"}
