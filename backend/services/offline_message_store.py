"""离线消息持久化模块：幂等入队、补发查询、正文清除和状态同步。"""

import time
from typing import Any

from sqlalchemy import and_, delete, select, update
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

import config
from database import engine, get_table


class MessageConflictError(ValueError):
    """同一 msg_id 被用于不同消息。"""


class OfflineMessageStore:
    """隐藏离线消息状态机和 SQL 细节的小接口模块。"""

    def __init__(self, db_engine: Engine, table=None):
        self._engine = db_engine
        self._table = table if table is not None else get_table("offline_messages")

    def enqueue(
        self,
        sender_id: str,
        recipient_id: str,
        payload: dict[str, Any],
        now: float | None = None,
    ) -> dict[str, Any]:
        """幂等写入密文消息，返回当前服务器状态。"""
        msg_id = payload.get("msg_id")
        message_type = payload.get("type")
        content = payload.get("content")
        if not isinstance(msg_id, str) or not msg_id or len(msg_id) > 160:
            raise ValueError("消息 ID 无效")
        if message_type not in ("chat_message", "voice_message"):
            raise ValueError("消息类型无效")
        if not isinstance(content, str) or not content:
            raise ValueError("消息内容为空")
        if not payload.get("encrypted"):
            raise ValueError("离线消息必须端到端加密")
        if len(content.encode("utf-8")) > config.MAX_MESSAGE_BYTES:
            raise ValueError("消息内容超过大小限制")

        timestamp = now if now is not None else time.time()
        values = {
            "msg_id": msg_id,
            "sender_id": sender_id,
            "recipient_id": recipient_id,
            "message_type": message_type,
            "content": content,
            "duration": payload.get("duration"),
            "encrypted": 1,
            "status": "queued",
            "created_at": timestamp,
            "expires_at": timestamp + config.OFFLINE_MESSAGE_TTL_DAYS * 86_400,
        }

        try:
            with self._engine.begin() as conn:
                conn.execute(self._table.insert().values(**values))
            return {**values, "created": True}
        except IntegrityError:
            existing = self.get(msg_id)
            if not existing:
                raise
            same_message = (
                existing["sender_id"] == sender_id
                and existing["recipient_id"] == recipient_id
                and existing["message_type"] == message_type
            )
            if not same_message:
                raise MessageConflictError("消息 ID 已被其他消息使用")
            return {**existing, "created": False}

    def get(self, msg_id: str) -> dict[str, Any] | None:
        with self._engine.connect() as conn:
            row = conn.execute(
                select(self._table).where(self._table.c.msg_id == msg_id)
            ).mappings().first()
        return dict(row) if row else None

    def pending_for(
        self,
        recipient_id: str,
        limit: int | None = None,
        now: float | None = None,
    ) -> list[dict[str, Any]]:
        """读取仍含密文正文的待投递消息。"""
        timestamp = now if now is not None else time.time()
        self.cleanup_expired(timestamp)
        stmt = (
            select(self._table)
            .where(and_(
                self._table.c.recipient_id == recipient_id,
                self._table.c.status == "queued",
                self._table.c.content.is_not(None),
                self._table.c.expires_at > timestamp,
            ))
            .order_by(self._table.c.created_at, self._table.c.msg_id)
        )
        if limit is not None:
            stmt = stmt.limit(limit)
        with self._engine.connect() as conn:
            rows = conn.execute(stmt).mappings().all()
        return [dict(row) for row in rows]

    def acknowledge_delivery(
        self,
        recipient_id: str,
        msg_id: str,
        now: float | None = None,
    ) -> dict[str, Any] | None:
        """接收设备确认保存；进入 delivered 并立即清除密文正文。"""
        timestamp = now if now is not None else time.time()
        with self._engine.begin() as conn:
            row = conn.execute(
                select(self._table).where(and_(
                    self._table.c.msg_id == msg_id,
                    self._table.c.recipient_id == recipient_id,
                ))
            ).mappings().first()
            if not row:
                return None
            if row["status"] == "queued":
                conn.execute(
                    update(self._table)
                    .where(self._table.c.msg_id == msg_id)
                    .values(status="delivered", delivered_at=timestamp, content=None)
                )
            result = dict(row)
            result["status"] = "delivered" if row["status"] == "queued" else row["status"]
            return result

    def mark_read(
        self,
        recipient_id: str,
        msg_id: str,
        now: float | None = None,
    ) -> dict[str, Any] | None:
        """接收方标记已读；幂等进入 read 状态。"""
        timestamp = now if now is not None else time.time()
        with self._engine.begin() as conn:
            row = conn.execute(
                select(self._table).where(and_(
                    self._table.c.msg_id == msg_id,
                    self._table.c.recipient_id == recipient_id,
                ))
            ).mappings().first()
            if not row:
                return None
            if row["status"] != "read":
                conn.execute(
                    update(self._table)
                    .where(self._table.c.msg_id == msg_id)
                    .values(
                        status="read",
                        delivered_at=row["delivered_at"] or timestamp,
                        read_at=timestamp,
                        content=None,
                    )
                )
            result = dict(row)
            result["status"] = "read"
            return result

    def status_updates_for(
        self,
        sender_id: str,
        limit: int | None = None,
        now: float | None = None,
    ) -> list[dict[str, Any]]:
        """返回发送者需要恢复的 queued/delivered/read 状态快照。"""
        timestamp = now if now is not None else time.time()
        self.cleanup_expired(timestamp)
        stmt = (
            select(
                self._table.c.msg_id,
                self._table.c.recipient_id,
                self._table.c.status,
            )
            .where(and_(
                self._table.c.sender_id == sender_id,
                self._table.c.expires_at > timestamp,
            ))
            .order_by(self._table.c.created_at, self._table.c.msg_id)
        )
        if limit is not None:
            stmt = stmt.limit(limit)
        with self._engine.connect() as conn:
            rows = conn.execute(stmt).mappings().all()
        return [dict(row) for row in rows]

    def cleanup_expired(self, now: float | None = None) -> int:
        timestamp = now if now is not None else time.time()
        with self._engine.begin() as conn:
            result = conn.execute(
                delete(self._table).where(self._table.c.expires_at <= timestamp)
            )
        return result.rowcount or 0


message_store = OfflineMessageStore(engine)
