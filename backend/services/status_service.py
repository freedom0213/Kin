"""在线状态管理 — 基于内存字典"""

import time

# {user_id: {"is_online": bool, "last_seen": float(timestamp)}}
_state: dict[str, dict] = {}


def set_online(user_id: str):
    """标记用户在线"""
    _state[user_id] = {"is_online": True, "last_seen": time.time()}


def set_offline(user_id: str):
    """标记用户离线"""
    if user_id in _state:
        _state[user_id]["is_online"] = False
        _state[user_id]["last_seen"] = time.time()


def is_online(user_id: str) -> bool:
    """检查用户是否在线"""
    entry = _state.get(user_id)
    return entry is not None and entry["is_online"]


def get_friends_status(user_ids: list[str]) -> dict[str, dict]:
    """批量获取好友在线状态"""
    result = {}
    for uid in user_ids:
        entry = _state.get(uid)
        if entry:
            result[uid] = {
                "is_online": entry["is_online"],
                "last_seen": entry["last_seen"],
            }
        else:
            result[uid] = {"is_online": False, "last_seen": None}
    return result
