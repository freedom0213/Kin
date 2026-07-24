# Kin — 完整技术架构方案

## Context

Kin 是一款基于物理近场交互（NFC 碰一碰）的亲密社交聊天应用。核心哲学：加好友必须物理见面碰一碰，用物理距离定义社交距离。不做陌生人发现、不做群发广播、不做算法推荐——只服务于用户真正见过面、在乎的人。

### 核心技术指标
- 目标用户量（首阶段）：数百人级别
- 消息体量：纯好友间聊天，数据量极小
- 部署成本目标：首年 ¥400 以内
- 开发方式：单人开发

---

## 一、技术选型总览

| 层 | 技术 | 选型理由 |
|---|------|----------|
| 移动端 UI | React Native 0.76+ | 一套代码覆盖 Android + iOS，用户已有 React 基础 |
| 状态管理 | React Context + useReducer | 轻量，不引入 Redux/Zustand 等外部依赖 |
| 本地数据库 | `expo-sqlite` / `react-native-sqlite-storage` | 消息本地持久化 |
| 本地加密 | `react-native-keychain` | 安全存储登录令牌 |
| NFC | `react-native-nfc-manager` | Android/iOS 双端支持 |
| 后端框架 | FastAPI + Uvicorn | 用户已熟练，开发效率高 |
| 服务端数据库 | SQLite（开发）→ PostgreSQL（生产可选） | 起步零配置 |
| 实时通信 | FastAPI WebSocket | 消息推送 + WebRTC 信令 |
| 语音通话 | WebRTC（P2P，无服务端流量费） | 免费开放标准 |
| E2E 加密 | `libsodium-wrappers` | Signal Protocol 的底层库 |

---

## 二、项目目录结构

```
Kin/
├── backend/                    # FastAPI 后端
│   ├── main.py                 # 应用入口，路由注册，CORS
│   ├── config.py               # 配置（JWT secret、数据库路径等）
│   ├── database.py             # SQLite 连接 + 建表
│   ├── requirements.txt        # fastapi, uvicorn, PyJWT, websockets, etc.
│   ├── routers/
│   │   ├── auth.py             # 注册 / 登录 / 令牌刷新
│   │   ├── friends.py          # NFC 好友绑定 / 好友列表 / 删除好友
│   │   └── status.py           # 在线状态上报 / 已读回执
│   ├── services/
│   │   ├── auth_service.py     # 注册登录逻辑、密码哈希、JWT 生成
│   │   ├── friend_service.py   # NFC token 匹配、好友关系 CRUD
│   │   └── status_service.py   # 在线状态缓存（Redis 或内存 dict）
│   └── websocket/
│       ├── __init__.py
│       └── handler.py          # WebSocket 连接管理 + 消息路由
│
├── mobile/                     # React Native 前端（待创建）
│   ├── App.tsx
│   ├── src/
│   │   ├── api/
│   │   │   ├── client.ts       # API 请求封装（登录态注入）
│   │   │   └── ws.ts           # WebSocket 客户端
│   │   ├── screens/
│   │   │   ├── LoginScreen.tsx
│   │   │   ├── RegisterScreen.tsx
│   │   │   ├── FriendListScreen.tsx
│   │   │   ├── ChatScreen.tsx
│   │   │   ├── AddFriendScreen.tsx   # NFC 碰一碰界面
│   │   │   ├── VoiceCallScreen.tsx   # 语音通话界面
│   │   │   └── SettingsScreen.tsx
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── stores/             # Context + Reducer 状态管理
│   │   ├── services/
│   │   │   ├── nfc.ts          # NFC 读写封装
│   │   │   ├── webrtc.ts       # WebRTC 语音通话封装
│   │   │   ├── db.ts           # 本地 SQLite 操作
│   │   │   └── encryption.ts   # E2E 加密/解密封装
│   │   └── utils/
│   └── package.json
│
└── docs/                        # 文档
    └── api.md                   # API 接口文档
```

---

## 三、产品功能清单

### MVP（第一版必须）

| 模块 | 功能 | 优先级 |
|------|------|--------|
| 账户 | 用户名+密码注册/登录 | P0 |
| 账户 | JWT 令牌认证 | P0 |
| 好友 | NFC 碰一碰添加好友（唯一方式） | P0 |
| 好友 | 好友列表（最多 100 人） | P0 |
| 好友 | 删除好友 | P0 |
| 聊天 | 文字消息（主功能） | P0 |
| 聊天 | 消息送达/已读状态 | P0 |
| 聊天 | 本地 SQLite 存储消息 | P0 |
| 在线状态 | 在线 / 离线 / 最后在线时间 | P0 |
| 聊天 | 消息导出备份文件 / 导入恢复 | P1 |
| 语音 | 语音消息（按住录制，发送） | P1 |
| 语音 | VoIP 语音通话（WebRTC） | P2 |
| 群聊 | 密友圈（3-8 人，建群必须所有人 NFC 在场） | P3 |

### 永远不做

- ❌ 搜索/推荐加好友
- ❌ 二维码/链接加好友
- ❌ 陌生人消息
- ❌ 朋友圈/动态
- ❌ 群发/广播
- ❌ 广告

---

## 四、核心流程设计

### 4.1 NFC 碰一碰加好友流程

```
手机A（发起方）                    服务器                        手机B（接收方）
      │                            │                              │
      │──①点「添加好友」──────────►│                              │
      │  App进入NFC发送模式        │                              │
      │                            │                              │
      │──②NFC碰一碰───────────────►│                              │
      │  交换：A的用户名+临时token │                              │
      │                            │                              │
      │──③POST /api/friends/nfc-token│                            │
      │  {token_b, my_username}    │                              │
      │                            │──④WebSocket推送好友请求────►│
      │                            │  {from_user, token}          │
      │                            │                              │──⑤弹出好友名片
      │                            │                              │   确认/拒绝
      │                            │◄──⑥POST 确认────────────────│
      │◄──⑦WebSocket推送结果──────│                              │
      │  {status: "accepted"}      │                              │
      │                            │                              │
      │⑧好友列表刷新               │                        ⑧好友列表刷新
```

**安全要点**：
- NFC token 只在 60 秒内有效，超时作废
- 服务器侧校验：两个 token 必须分别来自两台不同的手机
- 每对好友只能建立一次关系（不可重复添加）

### 4.2 消息发送流程

```
发送方                        服务器(WebSocket)                   接收方
  │                              │                                │
  │──①本地加密消息体─────────────│                                │
  │  (用接收方公钥)               │                                │
  │──②WebSocket发送─────────────►│                                │
  │  {to, ciphertext, msg_id}    │──③检查接收方是否在线───────────│
  │                              │                                │
  │                    ┌─在线────│──④转发────►──⑤本地解密         │
  │                    │         │              ──⑥存入本地SQLite  │
  │                    │         │              ──⑦返回已读回执    │
  │◄──⑧已读回执────────│─────────│◄───────────────────────────────│
  │──⑨更新消息状态─────│         │                                │
  │                    │         │                                │
  │◄──❌ 对方不在线────┘         │                                │
  │  {status: "offline"}         │                                │
  │  (消息未送达，不排队)         │                                │
```

**关键设计**：
- 服务器**只转发加密的消息**，无法解密
- 服务器**不存消息**，消息只在收发双方的本地 SQLite 中
- 接收方离线时 → 服务器直接返回「对方不在线」，消息不暂存不排队

### 4.3 语音通话（WebRTC）流程

```
呼叫方                         服务器(WebSocket)                   被叫方
  │                              │                                │
  │──①创建PeerConnection────────│                                │
  │──②生成Offer SDP─────────────│                                │
  │──③WS发送call_request────────►│──④WS推送incoming_call─────────►│
  │                              │                                │──⑤响铃
  │                              │◄──⑥WS: call_accepted──────────│──⑥接听
  │◄──⑦WS转发Answer SDP─────────│                                │──⑦生成Answer SDP
  │──⑧ICE候选交换(p2p直连)──────│──⑨信令转发─────────────────────│──⑧ICE候选交换
  │══════════ 加密音频流 P2P 直连 ════════════════════════════════►│
  │              （不经过服务器，零流量费）                         │
```

---

## 五、数据库设计

### 5.1 服务端（FastAPI SQLite）

```sql
-- 用户表
CREATE TABLE users (
    id          TEXT PRIMARY KEY,          -- UUID
    username    TEXT UNIQUE NOT NULL,       -- 4-16位，字母开头
    password_hash TEXT NOT NULL,            -- bcrypt 哈希
    nickname    TEXT,                       -- 显示昵称（可选）
    avatar      TEXT,                       -- 头像URL（可选）
    status_msg  TEXT,                       -- 个签（可选，最多50字）
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 好友关系表
CREATE TABLE friendships (
    id          TEXT PRIMARY KEY,          -- UUID
    user_id     TEXT NOT NULL REFERENCES users(id),
    friend_id   TEXT NOT NULL REFERENCES users(id),
    meet_at     TIMESTAMP NOT NULL,        -- 首次碰一碰的时间
    meet_lat    REAL,                      -- 碰一碰时的纬度（可选）
    meet_lng    REAL,                      -- 碰一碰时的经度（可选）
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, friend_id)
);

-- NFC 临时 token（用于碰一碰配对）
CREATE TABLE nfc_tokens (
    token       TEXT PRIMARY KEY,          -- 随机生成的 token
    username    TEXT NOT NULL,             -- 发起方用户名
    device_id   TEXT,                      -- 设备标识
    expires_at  TIMESTAMP NOT NULL,        -- 60秒超时
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 5.2 客户端（手机本地 SQLite）

```sql
-- 消息表（本地存储，不在服务器）
CREATE TABLE messages (
    id          TEXT PRIMARY KEY,
    chat_id     TEXT NOT NULL,             -- 聊天对象 user_id
    chat_type   TEXT NOT NULL DEFAULT 'private',
    sender_id   TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'text',  -- 'text' | 'voice'
    content     TEXT,                      -- 文字或语音本地路径
    is_encrypted INTEGER DEFAULT 1,
    is_read     INTEGER DEFAULT 0,
    is_sent     INTEGER DEFAULT 0,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 好友缓存表（同步自服务端）
CREATE TABLE contacts (
    user_id     TEXT PRIMARY KEY,
    username    TEXT NOT NULL,
    nickname    TEXT,
    avatar      TEXT,
    status_msg  TEXT,
    public_key  TEXT,                      -- E2E 加密公钥
    is_online   INTEGER DEFAULT 0,
    last_seen   TIMESTAMP,
    meet_at     TIMESTAMP,
    meet_location TEXT
);
```

---

## 六、API 接口设计

### 6.1 认证模块 `/api/auth`

| 方法 | 路径 | 说明 | 请求体 |
|------|------|------|--------|
| POST | `/api/auth/register` | 注册 | `{username, password}` |
| POST | `/api/auth/login` | 登录 | `{username, password}` |
| POST | `/api/auth/refresh` | 刷新令牌 | `{refresh_token}` |

### 6.2 好友模块 `/api/friends`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/friends/nfc-token` | 上传碰一碰后获取的对方 token |
| POST | `/api/friends/confirm` | 确认好友请求 |
| GET | `/api/friends/list` | 好友列表 |
| DELETE | `/api/friends/{user_id}` | 删除好友 |

### 6.3 在线状态 `/api/status`

| 方法 | 路径 | 说明 |
|------|------|------|
| PUT | `/api/status/heartbeat` | 上报在线心跳 |
| GET | `/api/status/friends` | 获取好友在线状态 |

### 6.4 WebSocket `/ws?token={jwt}`

```
消息类型：
- chat_message     → 发送/接收聊天消息
- read_receipt     → 已读回执
- typing           → 正在输入
- nfc_friend_req   → NFC 好友请求推送
- call_request     → WebRTC 呼叫
- call_accepted    → WebRTC 接听
- call_rejected    → WebRTC 拒绝
- ice_candidate    → WebRTC ICE 候选
- call_end         → 挂断
- heartbeat        → 心跳保活
```

---

## 七、E2E 加密方案

- 注册时客户端本地生成 Ed25519 密钥对
- 公钥上传服务器，私钥存本地 Keychain
- 添加好友时双方交换公钥
- 消息用 `crypto_box_easy` 加密，服务器只看密文

---

## 八、分阶段实施计划

| 阶段 | 内容 | 预估 |
|------|------|------|
| 1 | 后端基础：项目初始化、用户注册/登录、JWT | 1-2天 |
| 2 | 好友系统：NFC token、好友请求/列表 | 1-2天 |
| 3 | 消息系统：WebSocket 转发、离线队列、已读 | 1-2天 |
| 4 | 前端骨架：React Native 初始化、登录/列表/聊天页 | 2-3天 |
| 5 | E2E 加密：libsodium 集成到消息收发 | 1天 |
| 6 | NFC 碰一碰：真机调试 NFC 读写 + token 交换 | 2-3天 |
| 7 | 语音消息 + 通话：录制播放 + WebRTC | 3-4天 |
| 8 | 打磨：导出导入、推送、性能优化 | 持续 |

---

## 九、验证方式

- **后端**：Swagger UI (`/docs`) + curl 测试 WebSocket + 模拟 token 配对
- **前端**：Android 模拟器 + USB 真机调试 + 两台真机 NFC 碰一碰
- **集成**：两台设备登录 → NFC 加好友 → 发消息 → 已读 → 语音通话
