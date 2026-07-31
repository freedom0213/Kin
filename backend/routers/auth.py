from fastapi import APIRouter, HTTPException, Header, Request
from pydantic import BaseModel, Field

import config

from services import auth_service
from services import profile_media
from routers._auth_helper import get_user_id

router = APIRouter()


async def _notify_profile_change(user_id: str, profile: dict) -> None:
    # 延迟导入避免 auth_service 与 WebSocket 管理器形成模块初始化环。
    from websocket.handler import manager
    await manager.notify_profile_change(user_id, profile)


class RegisterBody(BaseModel):
    username: str = Field(..., min_length=4, max_length=16, description="用户名")
    password: str = Field(..., min_length=8, max_length=32, description="密码")
    public_key: str | None = Field(None, description="E2E 加密公钥（Base64编码）")


class LoginBody(BaseModel):
    username: str
    password: str


class UpdateProfileBody(BaseModel):
    nickname: str | None = Field(None, max_length=24, description="昵称，留空表示未设置")
    status_msg: str | None = Field(None, max_length=80, description="个性签名，留空表示未设置")


class UpdatePublicKeyBody(BaseModel):
    public_key: str = Field(..., min_length=40, max_length=64, description="设备端 Curve25519 公钥")


@router.post("/register")
async def api_register(body: RegisterBody):
    """用户注册"""
    result = auth_service.register(body.username, body.password, body.public_key)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@router.post("/login")
async def api_login(body: LoginBody):
    """用户登录"""
    result = auth_service.login(body.username, body.password)
    if not result["success"]:
        raise HTTPException(status_code=401, detail=result["message"])
    return result


@router.get("/me")
async def api_me(authorization: str = Header(...)):
    """获取当前用户信息"""
    user_id = get_user_id(authorization)
    profile = auth_service.get_profile(user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="用户不存在")
    return profile


@router.put("/me")
async def api_update_me(body: UpdateProfileBody, authorization: str = Header(...)):
    """更新当前用户的昵称和个性签名。"""
    user_id = get_user_id(authorization)
    try:
        profile = auth_service.update_profile(user_id, body.nickname, body.status_msg)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if not profile:
        raise HTTPException(status_code=404, detail="用户不存在")
    await _notify_profile_change(user_id, profile)
    return profile


@router.put("/me/public-key")
async def api_update_public_key(body: UpdatePublicKeyBody, authorization: str = Header(...)):
    """为当前登录账号激活或轮换本设备的公开加密密钥。"""
    user_id = get_user_id(authorization)
    try:
        profile = auth_service.update_public_key(user_id, body.public_key)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if not profile:
        raise HTTPException(status_code=404, detail="用户不存在")
    await _notify_profile_change(user_id, profile)
    return profile


@router.put("/me/profile-banner")
async def api_update_profile_banner(request: Request, authorization: str = Header(...)):
    """上传当前用户的背景名片。请求体为 JPEG、PNG 或 WebP 原始字节。"""
    user_id = get_user_id(authorization)
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > config.MAX_PROFILE_BANNER_BYTES:
                raise HTTPException(status_code=413, detail="背景图片不能超过 5 MB")
        except ValueError:
            raise HTTPException(status_code=400, detail="无效的 Content-Length")

    chunks: list[bytes] = []
    received = 0
    async for chunk in request.stream():
        received += len(chunk)
        if received > config.MAX_PROFILE_BANNER_BYTES:
            raise HTTPException(status_code=413, detail="背景图片不能超过 5 MB")
        chunks.append(chunk)
    content = b"".join(chunks)
    try:
        public_url = profile_media.save_profile_banner(content)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    profile, old_banner = auth_service.update_profile_banner(user_id, public_url)
    if not profile:
        profile_media.delete_profile_banner(public_url)
        raise HTTPException(status_code=404, detail="用户不存在")
    profile_media.delete_profile_banner(old_banner)
    await _notify_profile_change(user_id, profile)
    return profile


@router.delete("/me/profile-banner")
async def api_delete_profile_banner(authorization: str = Header(...)):
    """移除当前用户的背景名片。"""
    user_id = get_user_id(authorization)
    profile, old_banner = auth_service.update_profile_banner(user_id, None)
    if not profile:
        raise HTTPException(status_code=404, detail="用户不存在")
    profile_media.delete_profile_banner(old_banner)
    await _notify_profile_change(user_id, profile)
    return profile
