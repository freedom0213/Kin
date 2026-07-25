# Kin 项目当前状态（Codex 工作文档）

> 本文档供 Codex Agent 了解 Kin 项目现状，重点描述前端页面情况，以便 Codex 接手前端开发工作。

---

## 一、项目概述

Kin 是一款基于 NFC 碰一碰加好友的亲密社交聊天 App。核心哲学：**加好友必须物理见面碰一碰手机**。后端 FastAPI + SQLite，前端 React Native（Expo）。

- **仓库**: `https://github.com/freedom0213/Kin.git`
- **后端入口**: [backend/main.py](backend/main.py)
- **前端入口**: [mobile/App.tsx](mobile/App.tsx)
- **技术架构文档**: [Kin-技术架构方案.md](Kin-技术架构方案.md)

---

## 二、整体完成情况

8 个阶段的后端 + 前端核心功能全部完成代码编写，TypeScript 类型检查通过（`npx tsc --noEmit` 零错误），等待真机测试。

| 阶段 | 内容 | 状态 |
|------|------|------|
| 1 | 后端基础：认证/JWT/WebSocket | ✅ 完成 |
| 2 | 好友系统：NFC token/添加/删除/列表 | ✅ 完成 |
| 3 | 消息系统：WebSocket 转发/已读回执 | ✅ 完成 |
| 4 | RN 前端骨架：登录/注册/好友/聊天页面 | ✅ 完成 |
| 5 | E2E 加密：NaCl crypto_box 端到端加密 | ✅ 完成 |
| 6 | NFC 碰一碰：react-native-nfc-manager | ✅ 完成（需真机验证） |
| 7 | 语音消息/通话：expo-av + WebRTC | ✅ 完成（需真机验证） |
| 8 | 本地存储/导出：expo-sqlite + expo-sharing | ✅ 完成 |

---

## 三、前端文件地图

### 完整文件清单

```
mobile/
├── App.tsx                          # 应用入口 + react-navigation 导航结构
├── package.json                     # 依赖声明（16个运行时依赖 + 2个dev依赖）
├── tsconfig.json                    # TypeScript 配置
├── app.json                         # Expo 配置
├── index.ts                         # Expo 注册入口
├── CLAUDE.md                        # Claude Code 指令
├── AGENTS.md                        # Agent 指令
│
└── src/
    ├── config.ts                    # API_BASE / WS_BASE 地址配置
    │
    ├── api/
    │   ├── client.ts                # REST API 请求封装 + 所有接口类型定义
    │   └── ws.ts                    # WebSocket 客户端单例（消息/信令/心跳）
    │
    ├── stores/
    │   └── AuthContext.tsx           # 认证状态 Context + useReducer
    │
    ├── screens/
    │   ├── LoginScreen.tsx           # 登录页
    │   ├── RegisterScreen.tsx        # 注册页（含 E2E 密钥生成）
    │   ├── FriendListScreen.tsx      # 好友列表页
    │   ├── ChatScreen.tsx            # 聊天页（最复杂）
    │   ├── AddFriendScreen.tsx       # NFC 碰一碰添加好友页
    │   └── VoiceCallScreen.tsx       # 语音通话页
    │
    ├── components/
    │   └── VoiceMessage.tsx          # 语音录制按钮 + 语音消息气泡
    │
    └── services/
        ├── encryption.ts            # E2E 加解密（tweetnacl）
        ├── keys.ts                  # SecureStore 密钥持久化
        ├── nfc.ts                   # NFC 读写封装
        ├── webrtc.ts                # WebRTC 通话管理
        ├── db.ts                    # 本地 SQLite 消息 CRUD
        └── export.ts                # 消息 JSON 导出/导入
```

---

## 四、前端页面逐个分析

### 4.1 App.tsx — 导航结构

**文件**: [mobile/App.tsx](mobile/App.tsx)

**路由配置**（基于登录状态条件渲染两组页面）：

```
未登录时:
  Stack: Login → Register

已登录时:
  Stack: FriendList → Chat → AddFriend
                      → VoiceCall (slide_from_bottom, gestureEnabled: false)
```

**状态管理**: `AuthProvider` 包裹整个应用，提供 `useAuth()` hook：
- `state.isLoading` — 启动时从 SecureStore 恢复 token
- `state.isLoggedIn` — 是否已登录
- `state.user` — `{id, username, nickname, avatar, status_msg}`
- `loginAction(token, user)` — 存 token + 连 WebSocket + 更新状态
- `logoutAction()` — 删 token + 断 WebSocket + 重置状态

### 4.2 登录页 LoginScreen

**文件**: [mobile/src/screens/LoginScreen.tsx](mobile/src/screens/LoginScreen.tsx)

**状态**: ✅ 功能完整

**功能点**:
- 用户名 + 密码输入
- `KeyboardAvoidingView`（iOS padding / Android 默认）
- 调用 `login(username, password)` API
- 成功后调用 `loginAction` 存入 Context → 自动跳转到 FriendList
- 失败 Alert 提示
- 底部「没有账号？去注册」跳转到 Register

**当前 UI**:
- 白底 + 居中布局
- 标题 "Kin" + 副标题 "只和见过的人聊天"
- 圆角输入框 + 圆角登录按钮（深色 #1a1a2e）
- 加载中显示 "登录中..." 并禁用按钮

**待改进**:
- 暂无 Loading skeleton（登录按钮已有 disabled 状态）
- 没有「记住密码」功能
- 没有「忘记密码」功能（目前产品设计不需要）

### 4.3 注册页 RegisterScreen

**文件**: [mobile/src/screens/RegisterScreen.tsx](mobile/src/screens/RegisterScreen.tsx)

**状态**: ✅ 功能完整

**功能点**:
- 用户名 + 密码输入（带格式提示文字）
- **注册时自动生成 E2E 密钥对**：调用 `generateAndStoreKeyPair()` → 私钥存 SecureStore → 公钥随注册请求上传
- 调用 `register(username, password, publicKey)` API
- 注册成功自动登录（调用 `loginAction`）
- `ScrollView` 包裹 + `keyboardShouldPersistTaps="handled"`

**当前 UI**:
- 白底 + 「加入 Kin」标题 + 「创建账号，开始真正的亲密社交」副标题
- 用户名规则提示："字母开头，4-16位，字母/数字/下划线"
- 密码规则提示："8-32位，必须含字母和数字"
- 底部「已有账号？去登录」

**待改进**:
- 没有密码确认输入框（二次确认）
- 没有注册条款/隐私政策勾选

### 4.4 好友列表页 FriendListScreen

**文件**: [mobile/src/screens/FriendListScreen.tsx](mobile/src/screens/FriendListScreen.tsx)

**状态**: ✅ 功能完整

**功能点**:
- 使用 `useFocusEffect` 每次页面获得焦点时刷新好友列表
- FlatList 展示好友，下拉刷新
- 每个好友项显示：在线状态圆点（绿/灰）+ 昵称/用户名 + 个签 + 相识日期
- 点击进入聊天 ChatScreen
- 长按弹出删除确认 Alert
- **导出按钮**：点击调用 `exportMessagesToFile()` → 生成 JSON → 系统分享面板
- **监听 WebRTC 来电**：收到 `incoming_call` WS 事件 → 自动跳转到 VoiceCallScreen
- 顶栏：当前用户名 + 导出 + 添加按钮 + 退出

**当前 UI**:
- 深色顶栏（#1a1a2e）+ 白底列表
- 空状态：「还没有好友」+ "点击右上角「+ 添加」和朋友碰一碰手机吧"
- 每行：在线圆点 + 姓名 + 个签 + 相识日期

**待改进**:
- 没有搜索/过滤功能（只有 100 个好友上限，不算紧急）
- 没有好友详情页（点击直接进聊天）
- 导出没有进度提示
- 导出是全部消息，没有按好友分别导出

### 4.5 聊天页 ChatScreen

**文件**: [mobile/src/screens/ChatScreen.tsx](mobile/src/screens/ChatScreen.tsx)

**状态**: ✅ 功能完整（最复杂的页面，约 344 行）

**功能点**:

*消息加载*:
1. 进入页面 → 从 localStorage 加载我的私钥（`getSecretKey()`）
2. 从 `friend.public_key` 获取对方公钥
3. 从本地 SQLite 加载历史消息（`getMessages(chatId, 50)`）→ 倒序取回后反转

*WebSocket 消息监听*（6 种消息类型）:
- `chat_message` / `voice_message` → 收到后 E2E 解密（如果 `data.encrypted`）→ 追加到消息列表 → 自动发送已读回执 → 存 SQLite
- `delivered` → 服务器确认送达
- `read_receipt` → 标记消息已读
- `friend_status` → 更新在线状态
- `error` (OFFLINE) → 服务器通知对方不在线

*发送消息*:
- **文字消息**: 输入 → 如果有双方密钥则 `encrypt()` → `kinWS.sendMessage(...)` → 本地存 SQLite（存明文！密文只在线路上传输）
- **语音消息**: 按住录音 → 松开发送 → 加密 channel 同上 → `kinWS.sendVoiceMessage(...)` → 存 SQLite

*E2E 加密流程*:
```
发送: 明文 → encrypt(text, friendPublicKey, mySecretKey) → 密文 → WS发送
接收: WS收到 → decrypt(data.content, friendPublicKey, mySecretKey) → 明文 → 展示
本地存储: 存明文（方便查看历史）
加密失败降级: 发送明文（isEncrypted = false）
```

*通话入口*:
- 好友在线时，右上角显示 📞 按钮
- 点击跳转 VoiceCallScreen（direction: "outgoing"）

**当前 UI**:
- 深色顶栏：← 返回 + 好友名 + "在线/离线" + 🔒 E2E 标识（有公钥时显示）+ 📞 通话按钮（在线时显示）
- 消息气泡：自己的深色靠右 / 对方的白色靠左
- 消息已读状态：右下角小字"送达"/"已读"
- 输入栏：🎤 语音按钮 + 文字输入框 + 发送按钮
- 语音消息气泡：▶ 播放按钮 + 时长

**待改进**:
- 没有「正在输入」指示器的 UI 展示（WS `typing` 消息已支持但 ChatScreen 未监听）
- 没有消息长按菜单（复制/删除/撤回）
- 没有图片/文件消息（目前只支持文字+语音）
- 没有聊天背景自定义
- 语音录制没有取消机制（上滑取消）

### 4.6 添加好友页 AddFriendScreen

**文件**: [mobile/src/screens/AddFriendScreen.tsx](mobile/src/screens/AddFriendScreen.tsx)

**状态**: ✅ 功能完整（NFC 部分需真机验证）

**功能点**:

*双模式标签切换*：
- **「我来发出」**（send）：生成 NFC token → NFC 写入（或手动复制 token）
- **「收到碰一碰」**（receive）：NFC 读取 token → 自动添加好友（或手动输入降级）

*NFC 发送流程*:
1. 调用 `generateNfcToken()` 从服务器获取 60 秒有效 token
2. 如果 NFC 可用 → `startNfcSend(token)` 写入 NDEF，Alert 提示靠近对方手机
3. 如果 NFC 不可用 → Alert 显示 token 供手动复制（测试用）

*NFC 接收流程*:
1. 如果 NFC 可用 → `startNfcReceive(60000)` 前台调度监听 NFC tag → 读 NDEF → 解析 token → 自动调用 `addFriendByToken(token)`
2. 如果 NFC 不可用 → 显示输入框，手动粘贴 token → 调用 `addFriendByToken(token)`
3. **即使 NFC 可用也保留了手动输入降级方案**（页面底部）

**当前 UI**:
- 白底 + "添加好友" 标题
- 自动检测是否支持 NFC，副标题为 "手机碰一碰加好友" 或 "手动输入对方 Token"
- 标签切换（深色选中/灰色未选）
- NFC 按钮（绿色主题 #e8f5e9）
- Token 显示区域（monospace 字体）
- 手动输入降级区域（分隔线下方）

**待改进**:
- NFC 读写需要真机测试（模拟器不支持）
- 没有添加好友时的加载动画（已有 loading 状态但 UI 较简单）
- 没有「最近添加」历史

### 4.7 语音通话页 VoiceCallScreen

**文件**: [mobile/src/screens/VoiceCallScreen.tsx](mobile/src/screens/VoiceCallScreen.tsx)

**状态**: ✅ 功能完整（需真机验证 WebRTC）

**功能点**:

*四种通话状态*:
- `calling` — 呼出中，显示"等待对方接听..."
- `ringing` — 来电响铃，显示"对方邀请你语音通话..."
- `connected` — 通话中，显示实时计时器（分:秒）
- `ended` — 已结束，2 秒后自动返回

*呼叫流程（呼出）*:
1. 组件挂载 → `webrtcService.startCall(targetId, targetName)` →
2. 获取本地音频流 → 创建 RTCPeerConnection → 生成 Offer SDP → 通过 WS 发送 `call_request`
3. 等待对方 `call_accepted` → 状态切换 `connected`
4. 收到 `onRemoteStream` → 显示 `RTCView`

*接听流程（来电）*:
1. `incoming_call` WS 事件 → FriendListScreen 导航到此页（direction: "incoming"）
2. 组件挂载 → 从 `webrtcService.getPendingOffer()` 取出来电 SDP
3. 用户点"接听" → `webrtcService.answerCall(targetId, remoteSdp)` → 创建 Answer → WS 发送 `call_accepted`
4. 收到对方音频流 → 显示 `RTCView`

*挂断/拒绝*:
- 来电 ringing 时点"拒绝" → `webrtcService.reject(targetId)` → WS 发 `call_rejected`
- 通话中/呼叫中点"挂断" → `webrtcService.hangup(targetId)` → WS 发 `call_end`
- 结束后 1.5 秒自动 `navigation.goBack()`

**当前 UI**:
- 深色全屏背景（#1a1a2e）
- 圆形头像区域：有 remoteStream 时显示 RTCView，否则显示对方名首字
- 状态文字（响铃/等待/计时/结束）
- 操作按钮：
  - ringing: 红色拒绝 + 绿色接听
  - calling/connected: 红色挂断
  - ended: 灰色返回

**待改进**:
- 没有静音/扬声器切换按钮
- 没有蓝牙耳机切换
- 没有通话时长记录
- 没有通话中最小化/后台功能

---

## 五、前端基础设施分析

### 5.1 API 客户端

**文件**: [mobile/src/api/client.ts](mobile/src/api/client.ts)

- 全局 `_token` 变量存 JWT（通过 `setToken()` 设置）
- 自动在请求头注入 `Authorization: Bearer {token}`
- 所有 API 函数都是简单的 `request<T>(method, path, body)` 封装
- `Friend` 接口包含 `public_key` 字段（用于 E2E 加密）

### 5.2 WebSocket 客户端

**文件**: [mobile/src/api/ws.ts](mobile/src/api/ws.ts)

- 单例模式 `kinWS`
- 自动重连（断开 3 秒后重试）
- 30 秒心跳保活
- 事件监听系统：`on(type, handler)` / `off(type, handler)`（基于 Map + Set）
- 自动处理 WebRTC 信令（`_handleCallSignaling` 方法内分发给 `webrtcService`）
- 消息发送方法：`sendMessage()` / `sendVoiceMessage()` / `sendReadReceipt()` / `sendTyping()`

### 5.3 认证状态

**文件**: [mobile/src/stores/AuthContext.tsx](mobile/src/stores/AuthContext.tsx)

- React Context + useReducer 模式
- 启动时从 SecureStore 恢复 token → 调 API 获取 profile → 自动连 WebSocket
- 退出时清除 token + 断开 WebSocket

### 5.4 E2E 加密服务

**文件**: [mobile/src/services/encryption.ts](mobile/src/services/encryption.ts)

- 依赖 tweetnacl（NaCl crypto_box）
- 自建 Base64/UTF-8 编解码（避免 tweetnacl-util 的类型兼容问题）
- `encrypt(plaintext, recipientPublicKey, senderSecretKey)` → `"nonce.ciphertext"`（Base64 格式）
- `decrypt(payload, senderPublicKey, recipientSecretKey)` → 明文

### 5.5 密钥持久化

**文件**: [mobile/src/services/keys.ts](mobile/src/services/keys.ts)

- 私钥和公钥都存 expo-secure-store（Keychain/Keystore 级别安全存储）
- `generateAndStoreKeyPair()` — 注册时调用，生成新密钥对
- `getSecretKey()` / `getPublicKey()` — 读取已有密钥

### 5.6 本地数据库

**文件**: [mobile/src/services/db.ts](mobile/src/services/db.ts)

- expo-sqlite，懒加载单例
- 表结构：`messages(id, chat_id, sender_id, type, content, duration, is_read, created_at)`
- `saveMessage()` — 单条插入（INSERT OR REPLACE）
- `saveMessages()` — 批量插入（`withTransactionAsync` 事务包裹）
- `getMessages(chatId, limit, beforeId)` — 分页查询（按 created_at DESC，返回时反转）
- `exportAllMessages()` — 导出全部消息
- `importMessages()` — 批量导入
- `clearMessages(chatId)` / `markAsRead(msgId)`

### 5.7 WebRTC 服务

**文件**: [mobile/src/services/webrtc.ts](mobile/src/services/webrtc.ts)

- 单例 `webrtcService`
- STUN: Google 免费 STUN 服务器（`stun.l.google.com:19302`）
- 信令通过 WebSocket 发送（`setSignalSender` 注入）
- `_pendingOffer` 存储来电 SDP 供 VoiceCallScreen 获取
- `cleanup()` 释放所有资源（local tracks + peer connection）

### 5.8 NFC 服务

**文件**: [mobile/src/services/nfc.ts](mobile/src/services/nfc.ts)

- react-native-nfc-manager v3 封装
- `startNfcSend(token)` — NDEF 文本记录写入
- `startNfcReceive(timeoutMs)` — Promise 模式，前台调度监听，超时抛异常
- `cancelNfc()` — 清理 NFC 资源

### 5.9 消息导出/导入

**文件**: [mobile/src/services/export.ts](mobile/src/services/export.ts)

- 导出：读 SQLite → JSON → 写 File(Paths.document) → expo-sharing 系统分享
- 导入：读 File → JSON.parse → 验证 app tag "Kin" → 批量写入 SQLite
- 导出格式：`{ app: "Kin", version: 1, exported_at, message_count, messages: [...] }`

---

## 六、待做事项（前端）

### 优先级高

1. **真机测试 NFC** — 需要打包 APK（expo-dev-client），在真机上验证 NFC 碰一碰流程
2. **真机测试 WebRTC** — 两台真机互相拨打，验证音频流和信令
3. **真机测试语音消息** — 验证 expo-av 录音权限和播放
4. **完善 Contact 同步** — 好友缓存表（contacts）已设计但未在前端实现，当前只从服务端获取
5. **「正在输入」UI** — 后端 WS 已支持，但 ChatScreen 未监听 `typing` 事件展示

### 优先级中

6. **语音录制取消机制** — 上滑取消录音（当前只有按下/松开两种状态）
7. **消息长按菜单** — 复制文本、删除消息
8. **设置页面** — 当前没有 SettingsScreen（路由中不存在）
9. **昵称/头像/个签编辑** — 后端 users 表有字段但前端无编辑入口
10. **推送通知** — 当前无推送，消息只通过 WebSocket 实时推送
11. **通话功能增强** — 静音/扬声器切换

### 优先级低

12. **图片消息** — 产品 P1 功能，目前只支持文字+语音
13. **视频通话** — 产品 P2+ 功能
14. **密友圈（群聊）** — 产品 P3 功能

---

## 七、后端 API 完整列表

所有 API 均已实现并通过 Swagger 测试。详见 [Kin-技术架构方案.md](Kin-技术架构方案.md) 第六章。

### 需要后端配合的前端改动

- **获取好友详情**: 当前 `GET /api/friends/list` 返回好友列表含全部字段，不需要额外接口
- **更新用户资料**: 当前没有 `PUT /api/auth/me` 路由，需要新增
- **消息同步**: 当前服务器不存消息，无法做多设备同步

---

## 八、开发注意事项

### 配置切换

- **模拟器开发**: `API_BASE = "http://10.0.2.2:8000"`（Android 模拟器指向宿主机）
- **真机调试**: `API_BASE = "http://192.168.x.x:8000"`（电脑局域网 IP）
- **iOS 模拟器**: `API_BASE = "http://localhost:8000"`

### TypeScript 类型检查

```bash
cd mobile && npx tsc --noEmit
```

当前：零错误。

### 常见坑位

1. **`expo-file-system` v18+** 不再支持 `FileSystem.documentDirectory` / `FileSystem.readAsStringAsync` 等旧 API。统一使用 `new File(Paths.document, ...)` / `file.write()` / `file.text()` 新 API
2. **`tweetnacl`** 的类型定义在 TS 6.x 下与 `Uint8Array<ArrayBufferLike>` 不兼容，所以自建了 Base64/UTF-8 编解码，不依赖 `tweetnacl-util`
3. **WebRTC `ontrack` / `onicecandidate` 事件参数** 需要显式标注 `: any` 类型
4. **NFC 功能** 需要真机 + expo-dev-client（原生模块），Expo Go 不支持
5. **WebSocket 认证** 通过 URL query `?token={jwt}` 传递，不在 header 中
