"""Kin 后端入口 — FastAPI 应用"""

import json
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import config

from database import init_db
from websocket.handler import manager
from routers import auth, friends, push, status


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动时建表"""
    init_db()
    yield


app = FastAPI(
    title="Kin API",
    description="Kin — 亲密社交聊天应用后端",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 开发阶段由 Kin 后端直接托管资料图片；生产环境可把同一路径切换到对象存储/CDN。
app.mount("/media", StaticFiles(directory=config.MEDIA_ROOT, check_dir=False), name="media")

# -- REST 路由 --
app.include_router(auth.router, prefix="/api/auth", tags=["认证"])
app.include_router(friends.router, prefix="/api/friends", tags=["好友"])
app.include_router(status.router, prefix="/api/status", tags=["在线状态"])
app.include_router(push.router, prefix="/api/push", tags=["系统通知"])


# -- WebSocket 路由 --
@app.websocket("/ws")
async def ws_chat(websocket: WebSocket, token: str = Query(...)):
    """聊天 WebSocket 入口

    客户端连接: ws://host/ws?token={jwt}
    """
    user_id = await manager.connect(websocket, token)
    if not user_id:
        return  # 认证失败，已关闭连接

    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            await manager.handle_message(user_id, data)

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        manager.disconnect(user_id, websocket)


# -- 健康检查 --
@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "app": "Kin",
        "version": "0.1.0",
        "online_users": manager.get_online_count(),
    }
