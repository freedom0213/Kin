"""好友路由：NFC token、好友请求、好友列表"""

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel

from services import friend_service, status_service
from services.pairing_service import PairingError, pairing_service
from routers._auth_helper import get_user_id
from websocket.handler import manager

router = APIRouter()


def _pairing_http_error(error: PairingError) -> HTTPException:
    if error.code == "PAIRING_NOT_FOUND":
        status_code = 404
    elif error.code == "PAIRING_FORBIDDEN":
        status_code = 403
    elif error.code in ("PAIRING_CLOSED", "PAIRING_TAKEN", "ALREADY_FRIENDS"):
        status_code = 409
    else:
        status_code = 400
    return HTTPException(status_code=status_code, detail={"code": error.code, "message": str(error)})


async def _notify_pairing_participants(session: dict):
    for user_id in (session.get("initiator_id"), session.get("receiver_id")):
        if not user_id:
            continue
        try:
            snapshot = pairing_service.get(session["id"], user_id)
        except PairingError:
            continue
        await manager.send_json(user_id, {"type": "pairing_updated", "pairing": snapshot})


# -- NFC Token --

@router.post("/nfc-token")
async def api_generate_nfc_token(authorization: str = Header(...)):
    """生成 NFC 碰一碰用的临时 token"""
    user_id = get_user_id(authorization)
    result = friend_service.generate_nfc_token(user_id)
    return result


# -- 好友请求（通过 NFC token） --

class FriendRequest(BaseModel):
    token: str  # 从对方 NFC 读取到的 token


@router.post("/request")
async def api_friend_request(body: FriendRequest, authorization: str = Header(...)):
    """通过 NFC token 发起好友请求"""
    my_id = get_user_id(authorization)

    # 解析 token，返回的是对方的 user_id（UUID）
    friend_id = friend_service.resolve_nfc_token(body.token)
    if not friend_id:
        raise HTTPException(status_code=400, detail="NFC token 已过期或无效，请重新碰一碰")

    if friend_id == my_id:
        raise HTTPException(status_code=400, detail="不能添加自己为好友")

    # 尝试建立好友关系
    result = friend_service.add_friendship(my_id, friend_id)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])

    # WebSocket 通知对方
    await manager.send_json(friend_id, {
        "type": "friend_added",
        "user_id": my_id,
        "meet_at": result["meet_at"],
    })

    return result


# -- NFC 双方确认配对 --

class PairingJoinRequest(BaseModel):
    token: str


@router.post("/pairings")
async def api_create_pairing(authorization: str = Header(...)):
    user_id = get_user_id(authorization)
    return pairing_service.create(user_id)


@router.post("/pairings/join")
async def api_join_pairing(body: PairingJoinRequest, authorization: str = Header(...)):
    user_id = get_user_id(authorization)
    try:
        session = pairing_service.join(user_id, body.token)
    except PairingError as error:
        raise _pairing_http_error(error) from error
    await _notify_pairing_participants(session)
    return session


@router.get("/pairings/{session_id}")
async def api_get_pairing(session_id: str, authorization: str = Header(...)):
    user_id = get_user_id(authorization)
    try:
        return pairing_service.get(session_id, user_id)
    except PairingError as error:
        raise _pairing_http_error(error) from error


@router.post("/pairings/{session_id}/confirm")
async def api_confirm_pairing(session_id: str, authorization: str = Header(...)):
    user_id = get_user_id(authorization)
    try:
        session = pairing_service.confirm(session_id, user_id)
    except PairingError as error:
        raise _pairing_http_error(error) from error
    await _notify_pairing_participants(session)
    if session["status"] == "completed":
        for participant_id in (session["initiator_id"], session["receiver_id"]):
            await manager.send_json(participant_id, {
                "type": "friend_added",
                "user_id": session["receiver_id"] if participant_id == session["initiator_id"] else session["initiator_id"],
            })
    return session


@router.post("/pairings/{session_id}/cancel")
async def api_cancel_pairing(session_id: str, authorization: str = Header(...)):
    user_id = get_user_id(authorization)
    try:
        session = pairing_service.cancel(session_id, user_id)
    except PairingError as error:
        raise _pairing_http_error(error) from error
    await _notify_pairing_participants(session)
    return session


# -- 好友列表 --

@router.get("/list")
async def api_friend_list(authorization: str = Header(...)):
    """获取好友列表（含在线状态）"""
    user_id = get_user_id(authorization)
    friends = friend_service.get_friend_list(user_id)

    # 批量获取在线状态
    friend_ids = [f["user_id"] for f in friends]
    statuses = status_service.get_friends_status(friend_ids)

    for friend in friends:
        uid = friend["user_id"]
        friend.update(statuses.get(uid, {"is_online": False, "last_seen": None}))

    return {"friends": friends, "total": len(friends)}


# -- 删除好友 --

@router.delete("/{friend_id}")
async def api_delete_friend(friend_id: str, authorization: str = Header(...)):
    """删除好友"""
    user_id = get_user_id(authorization)
    result = friend_service.remove_friend(user_id, friend_id)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])

    # WebSocket 通知对方
    await manager.send_json(friend_id, {
        "type": "friend_removed",
        "user_id": user_id,
    })

    return result
