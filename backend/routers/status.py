"""在线状态路由"""

from fastapi import APIRouter, HTTPException, Header

from services import status_service, friend_service
from routers._auth_helper import get_user_id

router = APIRouter()


@router.get("/friends")
async def api_friends_status(authorization: str = Header(...)):
    """获取所有好友的在线状态"""
    user_id = get_user_id(authorization)
    friends = friend_service.get_friend_list(user_id)
    friend_ids = [f["user_id"] for f in friends]
    statuses = status_service.get_friends_status(friend_ids)
    return {"friends": statuses}
