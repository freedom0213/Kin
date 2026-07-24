from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, Field

from services import auth_service
from routers._auth_helper import get_user_id

router = APIRouter()


class RegisterBody(BaseModel):
    username: str = Field(..., min_length=4, max_length=16, description="用户名")
    password: str = Field(..., min_length=8, max_length=32, description="密码")
    public_key: str | None = Field(None, description="E2E 加密公钥（Base64编码）")


class LoginBody(BaseModel):
    username: str
    password: str


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
