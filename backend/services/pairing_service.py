"""NFC 双方确认配对：短期会话、参与者确认和好友关系落地。"""

import secrets
import time
import uuid
from typing import Callable

from sqlalchemy import and_, or_, select, update
from sqlalchemy.engine import Engine

import config
from database import engine, get_table
from services import friend_service


ACTIVE_STATUSES = ("awaiting_peer", "awaiting_confirmation")
TERMINAL_STATUSES = ("completed", "cancelled", "expired", "failed")


class PairingError(ValueError):
    """可安全映射到 API 响应的配对领域错误。"""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class PairingService:
    """封装配对会话状态机和持久化细节。"""

    def __init__(
        self,
        db_engine: Engine,
        table=None,
        users_table=None,
        friendship_creator: Callable[[str, str], dict] = friend_service.add_friendship,
        friendship_checker: Callable[[str, str], bool] = friend_service.are_friends,
    ):
        self._engine = db_engine
        self._table = table if table is not None else get_table("pairing_sessions")
        self._users = users_table if users_table is not None else get_table("users")
        self._create_friendship = friendship_creator
        self._are_friends = friendship_checker

    def create(self, initiator_id: str, now: float | None = None) -> dict:
        timestamp = now if now is not None else time.time()
        self.expire_due(timestamp)
        session_id = str(uuid.uuid4())
        token = secrets.token_urlsafe(24)
        values = {
            "id": session_id,
            "token": token,
            "initiator_id": initiator_id,
            "receiver_id": None,
            "initiator_confirmed": 0,
            "receiver_confirmed": 0,
            "status": "awaiting_peer",
            "failure_reason": None,
            "expires_at": timestamp + config.PAIRING_SESSION_TTL,
            "created_at": timestamp,
            "updated_at": timestamp,
        }
        with self._engine.begin() as conn:
            conn.execute(
                update(self._table)
                .where(and_(
                    self._table.c.initiator_id == initiator_id,
                    self._table.c.status.in_(ACTIVE_STATUSES),
                ))
                .values(status="cancelled", failure_reason="已创建新的配对会话", updated_at=timestamp)
            )
            conn.execute(self._table.insert().values(**values))
        return self.get(session_id, initiator_id, now=timestamp)

    def join(self, receiver_id: str, token: str, now: float | None = None) -> dict:
        timestamp = now if now is not None else time.time()
        self.expire_due(timestamp)
        with self._engine.begin() as conn:
            row = conn.execute(
                select(self._table).where(self._table.c.token == token)
            ).mappings().first()
            if not row:
                raise PairingError("PAIRING_NOT_FOUND", "配对会话不存在或已过期")
            if row["initiator_id"] == receiver_id:
                raise PairingError("PAIRING_SELF", "不能与自己建立配对")
            if row["status"] in TERMINAL_STATUSES:
                raise PairingError("PAIRING_CLOSED", "配对会话已经结束")
            if row["receiver_id"] and row["receiver_id"] != receiver_id:
                raise PairingError("PAIRING_TAKEN", "配对会话已由另一台设备加入")
            if self._are_friends(row["initiator_id"], receiver_id):
                raise PairingError("ALREADY_FRIENDS", "你们已经是好友了")
            if not row["receiver_id"]:
                conn.execute(
                    update(self._table)
                    .where(self._table.c.id == row["id"])
                    .values(
                        receiver_id=receiver_id,
                        status="awaiting_confirmation",
                        updated_at=timestamp,
                    )
                )
            session_id = row["id"]
        return self.get(session_id, receiver_id, now=timestamp)

    def get(self, session_id: str, user_id: str, now: float | None = None) -> dict:
        timestamp = now if now is not None else time.time()
        self.expire_due(timestamp)
        with self._engine.connect() as conn:
            row = conn.execute(
                select(self._table).where(self._table.c.id == session_id)
            ).mappings().first()
        if not row:
            raise PairingError("PAIRING_NOT_FOUND", "配对会话不存在")
        if user_id not in (row["initiator_id"], row["receiver_id"]):
            raise PairingError("PAIRING_FORBIDDEN", "你不是该配对会话的参与者")
        return self._snapshot(dict(row), user_id)

    def confirm(self, session_id: str, user_id: str, now: float | None = None) -> dict:
        timestamp = now if now is not None else time.time()
        self.expire_due(timestamp)
        with self._engine.begin() as conn:
            row = conn.execute(
                select(self._table).where(self._table.c.id == session_id)
            ).mappings().first()
            if not row:
                raise PairingError("PAIRING_NOT_FOUND", "配对会话不存在")
            if user_id not in (row["initiator_id"], row["receiver_id"]):
                raise PairingError("PAIRING_FORBIDDEN", "你不是该配对会话的参与者")
            if row["status"] == "completed":
                snapshot = self._snapshot(dict(row), user_id)
                snapshot["_completed_now"] = False
                return snapshot
            if row["status"] in ("cancelled", "expired", "failed"):
                raise PairingError("PAIRING_CLOSED", "配对会话已经结束")
            if row["status"] != "awaiting_confirmation" or not row["receiver_id"]:
                raise PairingError("PAIRING_NOT_READY", "请等待另一台设备加入")

            confirmation_field = (
                "initiator_confirmed"
                if user_id == row["initiator_id"]
                else "receiver_confirmed"
            )
            conn.execute(
                update(self._table)
                .where(self._table.c.id == session_id)
                .values(**{confirmation_field: 1, "updated_at": timestamp})
            )
            updated_row = conn.execute(
                select(self._table).where(self._table.c.id == session_id)
            ).mappings().first()

        completed_now = False
        if updated_row["initiator_confirmed"] and updated_row["receiver_confirmed"]:
            result = self._create_friendship(
                updated_row["initiator_id"], updated_row["receiver_id"]
            )
            completed = result.get("success") or self._are_friends(
                updated_row["initiator_id"], updated_row["receiver_id"]
            )
            with self._engine.begin() as conn:
                transition = conn.execute(
                    update(self._table)
                    .where(and_(
                        self._table.c.id == session_id,
                        self._table.c.status == "awaiting_confirmation",
                    ))
                    .values(
                        status="completed" if completed else "failed",
                        failure_reason=None if completed else result.get("message", "无法建立好友关系"),
                        updated_at=timestamp,
                    )
                )
                completed_now = completed and (transition.rowcount or 0) > 0
        snapshot = self.get(session_id, user_id, now=timestamp)
        snapshot["_completed_now"] = completed_now
        return snapshot

    def cancel(self, session_id: str, user_id: str, now: float | None = None) -> dict:
        timestamp = now if now is not None else time.time()
        self.expire_due(timestamp)
        with self._engine.begin() as conn:
            row = conn.execute(
                select(self._table).where(self._table.c.id == session_id)
            ).mappings().first()
            if not row:
                raise PairingError("PAIRING_NOT_FOUND", "配对会话不存在")
            if user_id not in (row["initiator_id"], row["receiver_id"]):
                raise PairingError("PAIRING_FORBIDDEN", "你不是该配对会话的参与者")
            if row["status"] == "cancelled":
                return self._snapshot(dict(row), user_id)
            if row["status"] in ("completed", "expired", "failed"):
                raise PairingError("PAIRING_CLOSED", "配对会话已经结束")
            conn.execute(
                update(self._table)
                .where(self._table.c.id == session_id)
                .values(status="cancelled", failure_reason="一方已取消", updated_at=timestamp)
            )
        return self.get(session_id, user_id, now=timestamp)

    def expire_due(self, now: float | None = None) -> int:
        timestamp = now if now is not None else time.time()
        with self._engine.begin() as conn:
            result = conn.execute(
                update(self._table)
                .where(and_(
                    self._table.c.status.in_(ACTIVE_STATUSES),
                    self._table.c.expires_at <= timestamp,
                ))
                .values(status="expired", failure_reason="配对等待已超时", updated_at=timestamp)
            )
        return result.rowcount or 0

    def _snapshot(self, row: dict, viewer_id: str) -> dict:
        role = "initiator" if viewer_id == row["initiator_id"] else "receiver"
        peer_id = row["receiver_id"] if role == "initiator" else row["initiator_id"]
        peer = self._user_summary(peer_id) if peer_id else None
        return {
            "id": row["id"],
            "token": row["token"] if role == "initiator" and row["status"] == "awaiting_peer" else None,
            "role": role,
            "status": row["status"],
            "initiator_id": row["initiator_id"],
            "receiver_id": row["receiver_id"],
            "initiator_confirmed": bool(row["initiator_confirmed"]),
            "receiver_confirmed": bool(row["receiver_confirmed"]),
            "viewer_confirmed": bool(
                row["initiator_confirmed"] if role == "initiator" else row["receiver_confirmed"]
            ),
            "peer_confirmed": bool(
                row["receiver_confirmed"] if role == "initiator" else row["initiator_confirmed"]
            ),
            "peer": peer,
            "failure_reason": row["failure_reason"],
            "expires_at": row["expires_at"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def _user_summary(self, user_id: str | None) -> dict | None:
        if not user_id:
            return None
        with self._engine.connect() as conn:
            row = conn.execute(
                select(
                    self._users.c.id,
                    self._users.c.username,
                    self._users.c.nickname,
                    self._users.c.avatar,
                ).where(self._users.c.id == user_id)
            ).mappings().first()
        return dict(row) if row else {"id": user_id, "username": "", "nickname": None, "avatar": None}


pairing_service = PairingService(engine)
