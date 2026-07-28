"""系统推送设备注册接口。"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from routers._auth_helper import get_user_id
from services.push_service import device_store


router = APIRouter()


class PushDeviceBody(BaseModel):
    token: str = Field(..., min_length=16, max_length=256)
    platform: str = Field(..., min_length=2, max_length=16)


class PushDeviceDeleteBody(BaseModel):
    token: str = Field(..., min_length=16, max_length=256)
    unregister_secret: str = Field(..., min_length=24, max_length=128)


@router.post("/devices")
async def register_push_device(body: PushDeviceBody, user_id: str = Depends(get_user_id)):
    try:
        device = device_store.register(user_id, body.token, body.platform)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {"registered": True, **device}


@router.delete("/devices")
async def unregister_push_device(body: PushDeviceDeleteBody):
    removed = device_store.unregister(body.token, body.unregister_secret)
    return {"registered": False, "removed": removed}


@router.get("/status")
async def get_push_status(user_id: str = Depends(get_user_id)):
    return {"registered_devices": device_store.count_for(user_id)}
