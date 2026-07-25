# Kin — 只和见过的人聊天

<p align="center">
  <img src="mobile/assets/icon.png" width="120" alt="Kin Logo" />
</p>

<p align="center">
  <strong>用物理距离定义社交距离。</strong><br />
  没有陌生人、没有算法推荐、没有群发广播。<br />
  只有在现实世界中见过面的人，才能在这里聊天。
</p>

---

## 为什么是 Kin？

大多数社交 App 都在追求「连接更多人」。Kin 反其道而行——**加好友的唯一方式是和对方手机碰一碰（NFC）**。

- 你的好友列表里不会有没见过面的人
- 不会被算法推送给陌生人
- 不会收到骚扰消息
- 每一个联系人背后都有一个真实的物理相遇

## 核心特性

| 特性 | 说明 |
|------|------|
| 🤝 **NFC 碰一碰加好友** | 唯一加好友方式，物理见面才能建立连接 |
| 🔒 **端到端加密（E2E）** | NaCl crypto_box（Curve25519 + XSalsa20-Poly1305），服务器无法解密消息 |
| ⚡ **同步聊天** | 双方在线才能收发消息——不囤积离线消息 |
| 📞 **语音通话** | WebRTC P2P 加密语音，不经过服务器、零流量费 |
| 🎤 **语音消息** | 按住录制语音气泡，长按即说 |
| 📱 **本地优先** | 消息存储在手机本地 SQLite，服务器不保存消息内容 |
| 📦 **消息导出/导入** | 一键导出备份，换手机无忧 |
| 👥 **好友上限 100 人** | 设计上限，防止社交膨胀 |

## 技术栈

### 后端

| 组件 | 技术 |
|------|------|
| 框架 | Python 3.x + FastAPI + Uvicorn |
| 数据库 | SQLite（SQLAlchemy Core） |
| 认证 | JWT（HS256，7 天有效）+ bcrypt 密码哈希 |
| 实时通信 | FastAPI WebSocket |
| 通话信令 | WebSocket 转发 WebRTC SDP/ICE |

### 移动端

| 组件 | 技术 |
|------|------|
| 框架 | React Native 0.86（Expo SDK 57） |
| 导航 | @react-navigation/native-stack |
| 本地存储 | expo-sqlite + expo-secure-store |
| NFC | react-native-nfc-manager v3 |
| 语音通话 | react-native-webrtc（P2P） |
| 语音消息 | expo-av（录制 + 播放） |
| E2E 加密 | tweetnacl（NaCl crypto_box） |
| 消息导出 | expo-file-system + expo-sharing |

## 架构

```
┌─────────────────────────────────────────────────┐
│                   手机端                          │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ E2E 加密  │  │ SQLite   │  │ SecureStore   │  │
│  │ 加解密    │  │ 本地消息  │  │ 密钥存储      │  │
│  └──────────┘  └──────────┘  └───────────────┘  │
│         │              │              │          │
│  ┌──────┴──────────────┴──────────────┴───────┐  │
│  │           WebSocket + REST API             │  │
│  └──────────────────────┬─────────────────────┘  │
└─────────────────────────┼────────────────────────┘
                          │
              HTTPS/WSS   │
                          ▼
┌─────────────────────────────────────────────────┐
│                  FastAPI 服务器                    │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ 认证鉴权  │  │ 好友管理  │  │ 在线状态      │  │
│  │ JWT+bcrypt│  │ NFC配对  │  │ 心跳+上下线   │  │
│  └──────────┘  └──────────┘  └───────────────┘  │
│  ┌──────────────────────────────────────────┐   │
│  │    WebSocket 消息路由（不解密、不存储）    │   │
│  │    文字/语音消息转发 + WebRTC 信令转发     │   │
│  └──────────────────────────────────────────┘   │
│                       │                          │
│              ┌────────┴────────┐                 │
│              │    SQLite       │                 │
│              │ 用户/好友/token │                 │
│              └─────────────────┘                 │
└─────────────────────────────────────────────────┘
```

## 项目结构

```
Kin/
├── README.md
├── backend/                        # FastAPI 后端
│   ├── main.py                     # 应用入口 + WebSocket 路由
│   ├── config.py                   # JWT/密码规则/NFC token 配置
│   ├── database.py                 # SQLite 连接 + 建表（用户/好友/token）
│   ├── requirements.txt            # Python 依赖
│   ├── routers/
│   │   ├── auth.py                 # 注册 / 登录 / 用户信息
│   │   ├── friends.py              # NFC token / 添加好友 / 好友列表 / 删除
│   │   ├── status.py               # 好友在线状态查询
│   │   └── _auth_helper.py         # JWT Bearer token 提取
│   ├── services/
│   │   ├── auth_service.py         # 用户名密码校验 / bcrypt / JWT
│   │   ├── friend_service.py       # NFC token 生成/验证/防重放 / 双向好友关系
│   │   └── status_service.py       # 在线状态（内存 dict）
│   └── websocket/
│       └── handler.py              # WebSocket 连接管理 + 消息/信令路由
│
└── mobile/                         # React Native 前端
    ├── App.tsx                     # 应用入口 + 导航结构
    ├── package.json                # 依赖声明
    └── src/
        ├── api/
        │   ├── client.ts           # REST API 请求封装 + 类型定义
        │   └── ws.ts               # WebSocket 客户端（消息/通话信令）
        ├── screens/
        │   ├── LoginScreen.tsx      # 登录页面
        │   ├── RegisterScreen.tsx   # 注册页面（生成 E2E 密钥）
        │   ├── FriendListScreen.tsx # 好友列表（在线状态/导出/来电监听）
        │   ├── ChatScreen.tsx       # 聊天页面（E2E 加解密/文字/语音/通话入口）
        │   ├── AddFriendScreen.tsx  # NFC 碰一碰（发送/接收双模式 + 手动输入）
        │   └── VoiceCallScreen.tsx  # 语音通话页面（呼叫/接听/挂断）
        ├── components/
        │   └── VoiceMessage.tsx     # 语音录制按钮 + 语音消息气泡
        ├── services/
        │   ├── encryption.ts       # NaCl crypto_box E2E 加解密
        │   ├── keys.ts            # SecureStore 密钥持久化
        │   ├── nfc.ts             # react-native-nfc-manager 封装
        │   ├── webrtc.ts          # WebRTC 通话管理
        │   ├── db.ts             # 本地 SQLite 消息存储
        │   └── export.ts         # 消息导出/导入
        ├── stores/
        │   └── AuthContext.tsx    # 认证状态管理（Context + useReducer）
        └── config.ts             # API/WS 地址配置
```

## 快速开始

### 前提条件

- Python 3.11+
- Node.js 20+
- Expo CLI（`npm install -g expo-cli`）
- **NFC 功能需要真机**（模拟器不支持 NFC）
- **语音通话需要真机**（WebRTC + 音频采集）

### 1. 启动后端

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

访问 [http://localhost:8000/docs](http://localhost:8000/docs) 查看 Swagger API 文档。

### 2. 启动前端

```bash
cd mobile
npm install
npx expo start
```

- Android 模拟器：按 `a`
- iOS 模拟器：按 `i`
- 真机调试：修改 `mobile/src/config.ts` 中的 `API_BASE` 为电脑局域网 IP

### 3. 服务器端配套

```bash
# 启用局域网访问
uvicorn backend.main:app --host 0.0.0.0 --port 8000

# 手机端 config.ts
export const API_BASE = "http://192.168.x.x:8000";  // 换成你的IP
```

## API 概览

### REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 注册（可上传 E2E 公钥） |
| POST | `/api/auth/login` | 登录（返回 JWT） |
| GET | `/api/auth/me` | 获取当前用户信息 |
| POST | `/api/friends/nfc-token` | 生成 NFC token（60 秒有效） |
| POST | `/api/friends/request` | 通过 token 添加好友 |
| GET | `/api/friends/list` | 好友列表（含在线状态 + E2E 公钥） |
| DELETE | `/api/friends/{id}` | 删除好友 |
| GET | `/api/status/friends` | 好友在线状态 |
| GET | `/api/health` | 健康检查 |

### WebSocket (`/ws?token={jwt}`)

| 消息类型 | 方向 | 说明 |
|----------|------|------|
| `chat_message` / `voice_message` | C→S→C | 转发聊天/语音消息（E2E 加密） |
| `read_receipt` | C→S→C | 已读回执 |
| `typing` | C→S→C | 正在输入 |
| `call_request` / `call_accepted` / `call_rejected` / `ice_candidate` / `call_end` | C→S→C | WebRTC 信令（纯转发） |
| `friend_status` | S→C | 好友上线/离线通知 |
| `friend_added` / `friend_removed` | S→C | 好友关系变化通知 |
| `heartbeat` / `heartbeat_ack` | C↔S | 30 秒心跳保活 |

## E2E 加密原理

```
注册时                             聊天时
  手机A                               手机A
  ┌─────────────────┐                ┌─────────────────┐
  │ 生成密钥对       │                │ 明文: "你好"     │
  │ 私钥A ← SecureStore              │       ↓         │
  │ 公钥A → 上传服务器│                │ NaCl box 加密   │
  └─────────────────┘                │ 用: 公钥B + 私钥A│
                                     │       ↓         │
  服务器                              │ 密文（仅密文传输）│
  ┌─────────────────┐                └────────┬────────┘
  │ users 表         │                         │
  │ id │ public_key │                ┌────────▼────────┐
  │ A  │ 公钥A      │                │    服务器(转发)   │
  │ B  │ 公钥B      │                │  无法解密 ✓      │
  └────┴────────────┘                └────────┬────────┘
                                              │
 加好友时                              ┌────────▼────────┐
  手机A ◄─ 对方公钥B                  │  手机B           │
                                     │       ↓         │
                                     │ NaCl box 解密   │
                                     │ 用: 公钥A + 私钥B│
                                     │       ↓         │
                                     │ 明文: "你好"     │
                                     └─────────────────┘
```

- 密钥算法：Ed25519（Curve25519）
- 加密算法：NaCl crypto_box（Curve25519 + XSalsa20-Poly1305）
- 客户端使用 [tweetnacl](https://github.com/dchest/tweetnacl-js) 实现
- 服务器零知识——只看到密文，无法解密任何消息

## 设计哲学

| 原则 | 解释 |
|------|------|
| **物理优先** | NFC 碰一碰是唯一加好友方式，物理距离定义社交距离 |
| **同步聊天** | 双方在线才能收发消息——聊天是你来我往的对话，不是留言板 |
| **100 人上限** | 邓巴数（Dunbar's Number）——人类能维持稳定社交关系的人数上限 |
| **服务器零知识** | E2E 加密 + 消息不落盘 + 通话 P2P 直连 |
| **数据自主** | 消息在本地 SQLite，随时可导出备份 |

### 永远不做

- ❌ 搜索/推荐加好友
- ❌ 二维码/链接加好友
- ❌ 陌生人消息
- ❌ 朋友圈/动态/广场
- ❌ 群发/广播
- ❌ 算法推荐
- ❌ 广告

## 部署

目前为开发阶段。推荐部署方案：

| 服务 | 平台 | 预估成本 |
|------|------|----------|
| 后端 | Railway / Fly.io | ¥200-400/年 |
| 前端静态资源 | EAS Build（Expo） | 免费额度 |
| 数据库 | 服务器本地 SQLite | ¥0 |

## 开发进度

- [x] 阶段 1 — 后端基础（认证/JWT/WebSocket）
- [x] 阶段 2 — 好友系统（NFC token/添加/删除/列表）
- [x] 阶段 3 — 消息系统（WebSocket 转发/已读回执）
- [x] 阶段 4 — RN 前端骨架（登录/注册/好友/聊天页面）
- [x] 阶段 5 — E2E 加密集成（NaCl crypto_box）
- [x] 阶段 6 — NFC 碰一碰（react-native-nfc-manager，需真机验证）
- [x] 阶段 7 — 语音消息/通话（expo-av + WebRTC，需真机验证）
- [x] 阶段 8 — SQLite 本地存储 + 消息导出/导入
- [ ] 阶段 9 — 真机测试 + APK 打包 + 上线

## 许可证

本项目仅供学习交流使用。

---

<p align="center">
  <strong>Kin</strong> — 真正的社交，从见面开始。
</p>
