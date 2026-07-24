"""数据库连接与建表 — SQLAlchemy Core 模式"""

import os
from sqlalchemy import create_engine, MetaData, Table, Column, Text, Float, Integer, UniqueConstraint, text
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


def init_db():
    """创建所有表（幂等：已存在则跳过）"""
    metadata.create_all(engine)


def get_table(name: str) -> Table:
    """按名称获取表对象"""
    if name not in metadata.tables:
        raise ValueError(f"表 '{name}' 不存在")
    return metadata.tables[name]
