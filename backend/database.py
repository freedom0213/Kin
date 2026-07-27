"""数据库连接与建表 — SQLAlchemy Core 模式"""

import os
from sqlalchemy import create_engine, MetaData, Table, Column, Text, Float, Integer, UniqueConstraint, Index, inspect, text
from sqlalchemy.types import TIMESTAMP
import config

# 确保 data 目录存在
os.makedirs(os.path.dirname(config.DB_PATH), exist_ok=True)

DATABASE_URL = f"sqlite:///{config.DB_PATH}"

engine = create_engine(
    DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False},
    pool_pre_ping=True,
)

metadata = MetaData()

# -- 用户表 --
users = Table(
    "users", metadata,
    Column("id", Text, primary_key=True),
    Column("username", Text, unique=True, nullable=False),
    Column("password_hash", Text, nullable=False),
    Column("public_key", Text, nullable=True),      # E2E 加密公钥
    Column("nickname", Text, nullable=True),
    Column("avatar", Text, nullable=True),
    Column("profile_banner", Text, nullable=True),
    Column("status_msg", Text, nullable=True),
    Column("created_at", TIMESTAMP, server_default=text("CURRENT_TIMESTAMP")),
)

# -- 好友关系表 --
friendships = Table(
    "friendships", metadata,
    Column("id", Text, primary_key=True),
    Column("user_id", Text, nullable=False),
    Column("friend_id", Text, nullable=False),
    Column("meet_at", TIMESTAMP, nullable=False),
    Column("meet_lat", Float, nullable=True),
    Column("meet_lng", Float, nullable=True),
    Column("created_at", TIMESTAMP, server_default=text("CURRENT_TIMESTAMP")),
    UniqueConstraint("user_id", "friend_id", name="uq_friendship"),
)

# -- NFC 临时 token --
nfc_tokens = Table(
    "nfc_tokens", metadata,
    Column("token", Text, primary_key=True),
    Column("username", Text, nullable=False),
    Column("device_id", Text, nullable=True),
    Column("expires_at", TIMESTAMP, nullable=False),
    Column("created_at", TIMESTAMP, server_default=text("CURRENT_TIMESTAMP")),
)

# -- NFC 双方确认配对会话 --
pairing_sessions = Table(
    "pairing_sessions", metadata,
    Column("id", Text, primary_key=True),
    Column("token", Text, unique=True, nullable=False),
    Column("initiator_id", Text, nullable=False),
    Column("receiver_id", Text, nullable=True),
    Column("initiator_confirmed", Integer, nullable=False, server_default=text("0")),
    Column("receiver_confirmed", Integer, nullable=False, server_default=text("0")),
    Column("status", Text, nullable=False, server_default=text("'awaiting_peer'")),
    Column("failure_reason", Text, nullable=True),
    Column("expires_at", Float, nullable=False),
    Column("created_at", Float, nullable=False),
    Column("updated_at", Float, nullable=False),
)
Index("idx_pairing_token", pairing_sessions.c.token)
Index("idx_pairing_initiator_status", pairing_sessions.c.initiator_id, pairing_sessions.c.status)
Index("idx_pairing_receiver_status", pairing_sessions.c.receiver_id, pairing_sessions.c.status)
Index("idx_pairing_expires", pairing_sessions.c.expires_at)

# -- 离线加密消息 --
# 接收设备确认保存后 content 会被置空，只保留最小状态元数据用于送达/已读同步。
offline_messages = Table(
    "offline_messages", metadata,
    Column("msg_id", Text, primary_key=True),
    Column("sender_id", Text, nullable=False),
    Column("recipient_id", Text, nullable=False),
    Column("message_type", Text, nullable=False),
    Column("content", Text, nullable=True),
    Column("duration", Float, nullable=True),
    Column("encrypted", Integer, nullable=False, server_default=text("1")),
    Column("status", Text, nullable=False, server_default=text("'queued'")),
    Column("created_at", Float, nullable=False),
    Column("expires_at", Float, nullable=False),
    Column("delivered_at", Float, nullable=True),
    Column("read_at", Float, nullable=True),
)
Index("idx_offline_recipient_status", offline_messages.c.recipient_id, offline_messages.c.status)
Index("idx_offline_sender_status", offline_messages.c.sender_id, offline_messages.c.status)
Index("idx_offline_expires", offline_messages.c.expires_at)


def init_db():
    """创建所有表（幂等：已存在则跳过）"""
    metadata.create_all(engine)
    # create_all 不会为已有 SQLite 表补列；这里进行一次幂等的轻量迁移。
    user_columns = {column["name"] for column in inspect(engine).get_columns("users")}
    if "profile_banner" not in user_columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN profile_banner TEXT"))


def get_table(name: str) -> Table:
    """按名称获取表对象"""
    if name not in metadata.tables:
        raise ValueError(f"表 '{name}' 不存在")
    return metadata.tables[name]
