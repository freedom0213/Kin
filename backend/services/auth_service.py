"""认证业务逻辑：注册、登录、JWT"""

import re
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt as _bcrypt
import jwt
from sqlalchemy import select

import config
from database import engine, get_table


def _validate_username(username: str) -> str | None:
    """校验用户名格式，合法返回 None，非法返回错误信息"""
    if len(username) < config.USERNAME_MIN_LEN:
        return f"用户名至少 {config.USERNAME_MIN_LEN} 位"
    if len(username) > config.USERNAME_MAX_LEN:
        return f"用户名最多 {config.USERNAME_MAX_LEN} 位"
    if not re.match(config.USERNAME_REGEX, username):
        return "用户名须字母开头，仅含字母、数字、下划线"
    # 禁止纯数字
    if username.isdigit():
        return "用户名不能是纯数字"
    if username.lower() in config.USERNAME_FORBIDDEN:
        return "该用户名为系统保留"
    return None


def _validate_password(password: str) -> str | None:
    """校验密码格式，合法返回 None，非法返回错误信息"""
    if len(password) < config.PASSWORD_MIN_LEN:
        return f"密码至少 {config.PASSWORD_MIN_LEN} 位"
    if len(password) > config.PASSWORD_MAX_LEN:
        return f"密码最多 {config.PASSWORD_MAX_LEN} 位"
    if " " in password:
        return "密码不能包含空格"
    if config.PASSWORD_REQUIRE_LETTER and not any(c.isalpha() for c in password):
        return "密码必须包含字母"
    if config.PASSWORD_REQUIRE_DIGIT and not any(c.isdigit() for c in password):
        return "密码必须包含数字"
    # 检查非法字符
    allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" + config.PASSWORD_ALLOWED_SPECIAL)
    for c in password:
        if c not in allowed:
            return f"密码包含非法字符: {c}"
    return None


def _generate_token(user_id: str, username: str) -> str:
    """生成 JWT access token"""
    payload = {
        "sub": user_id,
        "username": username,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(hours=config.ACCESS_TOKEN_EXPIRE_HOURS),
    }
    return jwt.encode(payload, config.JWT_SECRET, algorithm=config.JWT_ALGORITHM)


def decode_token(token: str) -> dict | None:
    """解码 JWT，失败返回 None"""
    try:
        return jwt.decode(token, config.JWT_SECRET, algorithms=[config.JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None


def register(username: str, password: str, public_key: str | None = None) -> dict:
    """注册新用户，返回 {success, message, user}"""
    # 校验输入
    err = _validate_username(username)
    if err:
        return {"success": False, "message": err}

    err = _validate_password(password)
    if err:
        return {"success": False, "message": err}

    table = get_table("users")

    # 查重
    with engine.connect() as conn:
        stmt = select(table.c.id).where(table.c.username == username)
        existing = conn.execute(stmt).scalar()
        if existing:
            return {"success": False, "message": "该用户名已被注册"}

    # 插入
    user_id = str(uuid.uuid4())
    password_hash = _bcrypt.hashpw(password.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")

    with engine.connect() as conn:
        conn.execute(
            table.insert().values(
                id=user_id,
                username=username,
                password_hash=password_hash,
                public_key=public_key,
            )
        )
        conn.commit()

    token = _generate_token(user_id, username)

    return {
        "success": True,
        "message": "注册成功",
        "user": {"id": user_id, "username": username},
        "token": token,
    }


def login(username: str, password: str) -> dict:
    """登录"""
    table = get_table("users")

    with engine.connect() as conn:
        stmt = select(table).where(table.c.username == username)
        row = conn.execute(stmt).mappings().first()

    if not row:
        return {"success": False, "message": "用户名或密码错误"}

    if not _bcrypt.checkpw(password.encode("utf-8"), row["password_hash"].encode("utf-8")):
        return {"success": False, "message": "用户名或密码错误"}

    user_id = row["id"]
    token = _generate_token(user_id, username)

    return {
        "success": True,
        "message": "登录成功",
        "user": {
            "id": user_id,
            "username": row["username"],
            "nickname": row.get("nickname"),
            "avatar": row.get("avatar"),
            "profile_banner": row.get("profile_banner"),
            "status_msg": row.get("status_msg"),
        },
        "token": token,
    }


def get_profile(user_id: str) -> dict | None:
    """获取用户信息"""
    table = get_table("users")
    with engine.connect() as conn:
        stmt = select(table).where(table.c.id == user_id)
        row = conn.execute(stmt).mappings().first()
    if not row:
        return None
    return {
        "id": row["id"],
        "username": row["username"],
        "nickname": row.get("nickname"),
        "avatar": row.get("avatar"),
        "profile_banner": row.get("profile_banner"),
        "status_msg": row.get("status_msg"),
    }


def _normalize_profile_text(value: str | None, max_length: int, field_name: str) -> str | None:
    if value is None:
        return None
    normalized = " ".join(value.split())
    if len(normalized) > max_length:
        raise ValueError(f"{field_name}最多 {max_length} 个字符")
    return normalized or None


def update_profile(user_id: str, nickname: str | None, status_msg: str | None) -> dict | None:
    """更新昵称和个性签名，返回更新后的完整资料。"""
    normalized_nickname = _normalize_profile_text(nickname, 24, "昵称")
    normalized_status = _normalize_profile_text(status_msg, 80, "个性签名")
    table = get_table("users")
    with engine.begin() as conn:
        result = conn.execute(
            table.update()
            .where(table.c.id == user_id)
            .values(nickname=normalized_nickname, status_msg=normalized_status)
        )
    if result.rowcount == 0:
        return None
    return get_profile(user_id)


def update_profile_banner(user_id: str, profile_banner: str | None) -> tuple[dict | None, str | None]:
    """更新背景名片地址，返回（完整资料，旧地址）。"""
    table = get_table("users")
    with engine.begin() as conn:
        old_banner = conn.execute(
            select(table.c.profile_banner).where(table.c.id == user_id)
        ).scalar_one_or_none()
        result = conn.execute(
            table.update()
            .where(table.c.id == user_id)
            .values(profile_banner=profile_banner)
        )
    if result.rowcount == 0:
        return None, None
    return get_profile(user_id), old_banner
