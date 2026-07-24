"""路由层共享：认证辅助函数"""

from fastapi import HTTPException, Header
from services.auth_service import decode_token


def get_user_id(authorization: str = Header(...)) -> str:
    """从 Authorization header 提取 user_id，无效则抛 401"""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="需要登录")
    token = authorization[7:]
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="无效的登录令牌")
    return payload["sub"]
