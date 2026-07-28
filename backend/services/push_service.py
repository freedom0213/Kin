"""Expo Push 设备注册与系统通知发送。"""

import json
import hashlib
import re
import secrets
import time
from typing import Any
from urllib import request

from sqlalchemy import delete, select
from sqlalchemy.engine import Engine

import config
from database import engine, get_table


EXPO_TOKEN_PATTERN = re.compile(r"^(ExponentPushToken|ExpoPushToken)\[[^\]]{8,220}\]$")
VALID_PLATFORMS = {"android", "ios"}


class PushDeviceStore:
    def __init__(self, db_engine: Engine, table=None):
        self._engine = db_engine
        self._table = table if table is not None else get_table("push_devices")

    def register(self, user_id: str, token: str, platform: str, now: float | None = None) -> dict:
        if not EXPO_TOKEN_PATTERN.fullmatch(token):
            raise ValueError("推送 Token 格式无效")
        if platform not in VALID_PLATFORMS:
            raise ValueError("设备平台无效")
        timestamp = now if now is not None else time.time()
        unregister_secret = secrets.token_urlsafe(32)
        secret_hash = hashlib.sha256(unregister_secret.encode("utf-8")).hexdigest()
        with self._engine.begin() as conn:
            existing = conn.execute(
                select(self._table).where(self._table.c.token == token)
            ).mappings().first()
            if existing:
                conn.execute(
                    self._table.update()
                    .where(self._table.c.token == token)
                    .values(
                        user_id=user_id,
                        platform=platform,
                        unregister_secret_hash=secret_hash,
                        updated_at=timestamp,
                    )
                )
            else:
                conn.execute(self._table.insert().values(
                    token=token,
                    user_id=user_id,
                    platform=platform,
                    unregister_secret_hash=secret_hash,
                    created_at=timestamp,
                    updated_at=timestamp,
                ))
        return {"token": token, "platform": platform, "unregister_secret": unregister_secret}

    def unregister(self, token: str, unregister_secret: str) -> bool:
        supplied_hash = hashlib.sha256(unregister_secret.encode("utf-8")).hexdigest()
        with self._engine.begin() as conn:
            existing = conn.execute(
                select(self._table.c.unregister_secret_hash).where(self._table.c.token == token)
            ).scalar_one_or_none()
            if not existing or not secrets.compare_digest(existing, supplied_hash):
                return False
            result = conn.execute(delete(self._table).where(
                self._table.c.token == token
            ))
        return bool(result.rowcount)

    def remove_token(self, token: str) -> None:
        with self._engine.begin() as conn:
            conn.execute(delete(self._table).where(self._table.c.token == token))

    def tokens_for(self, user_id: str) -> list[str]:
        with self._engine.connect() as conn:
            rows = conn.execute(
                select(self._table.c.token).where(self._table.c.user_id == user_id)
            ).all()
        return [row[0] for row in rows]

    def count_for(self, user_id: str) -> int:
        return len(self.tokens_for(user_id))


class ExpoPushService:
    def __init__(self, store: PushDeviceStore):
        self._store = store

    def has_devices(self, user_id: str) -> bool:
        return self._store.count_for(user_id) > 0

    def send_to_user(
        self,
        user_id: str,
        *,
        title: str,
        body: str,
        data: dict[str, Any],
        channel_id: str,
        ttl: int = 3600,
        priority: str = "high",
    ) -> int:
        try:
            tokens = self._store.tokens_for(user_id)
        except Exception:
            return 0
        if not tokens:
            return 0
        payload = [{
            "to": token,
            "title": title,
            "body": body,
            "data": data,
            "sound": "default",
            "priority": priority,
            "ttl": ttl,
            "channelId": channel_id,
        } for token in tokens]
        try:
            encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        except (TypeError, ValueError):
            return 0
        headers = {
            "Accept": "application/json",
            "Accept-Encoding": "gzip, deflate",
            "Content-Type": "application/json",
        }
        if config.EXPO_PUSH_ACCESS_TOKEN:
            headers["Authorization"] = f"Bearer {config.EXPO_PUSH_ACCESS_TOKEN}"
        req = request.Request(config.EXPO_PUSH_URL, data=encoded, headers=headers, method="POST")
        try:
            with request.urlopen(req, timeout=config.EXPO_PUSH_TIMEOUT_SECONDS) as response:
                result = json.loads(response.read().decode("utf-8"))
        except Exception:
            return 0

        tickets = result.get("data") if isinstance(result, dict) else None
        if not isinstance(tickets, list):
            return 0
        accepted = 0
        for token, ticket in zip(tokens, tickets):
            if not isinstance(ticket, dict):
                continue
            if ticket.get("status") == "ok":
                accepted += 1
                continue
            if ticket.get("details", {}).get("error") == "DeviceNotRegistered":
                self._store.remove_token(token)
        return accepted


device_store = PushDeviceStore(engine)
push_service = ExpoPushService(device_store)
