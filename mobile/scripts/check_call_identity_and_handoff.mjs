import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const app = fs.readFileSync(path.join(root, "App.tsx"), "utf8");
const chat = fs.readFileSync(path.join(root, "src/screens/ChatScreen.tsx"), "utf8");
const callScreen = fs.readFileSync(path.join(root, "src/screens/VoiceCallScreen.tsx"), "utf8");
const webrtc = fs.readFileSync(path.join(root, "src/services/webrtc.ts"), "utf8");
const backend = fs.readFileSync(path.resolve(root, "../backend/websocket/handler.py"), "utf8");

const checks = [
  [backend.includes('"caller_avatar"'), "后端通话信令必须注入权威 caller_avatar"],
  [app.includes("callerAvatar"), "来电协调器必须保存并渲染 callerAvatar"],
  [app.includes('const sessionMode = callPhaseRef.current === "ringing" ? "pending" : "active"')
    && app.includes("sessionMode,"), "通话中卡片必须以 active 模式打开详情页"],
  [!app.includes("disabled={busy || !ringing}"), "连接中和通话中的来电卡片不能被禁用"],
  [chat.includes("targetAvatar: friend.avatar"), "主动呼叫必须把好友头像传入通话页"],
  [callScreen.includes("targetAvatar"), "通话详情页必须读取 targetAvatar"],
  [callScreen.includes('sessionMode === "active"'), "通话详情页必须接管已存在的活动会话"],
  [webrtc.includes("getActiveCallSnapshot"), "WebRTC 服务必须提供只读活动会话快照"],
];

const failures = checks.filter(([ok]) => !ok).map(([, message]) => message);
if (failures.length) {
  console.error(`通话身份与活动会话检查失败：\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log("通话身份与活动会话检查通过");
