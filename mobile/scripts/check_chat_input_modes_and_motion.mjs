import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [chatSource, voiceSource] = await Promise.all([
  readFile(new URL("../src/screens/ChatScreen.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/VoiceMessage.tsx", import.meta.url), "utf8"),
]);

assert.match(chatSource, /type InputMode = "text" \| "voice"/, "聊天页尚未建立文字和语音双模式");
assert.match(chatSource, /selectInputMode/, "聊天页尚未提供明确的模式切换行为");
assert.match(chatSource, /ref=\{inputRef\}/, "恢复文字模式后无法重新聚焦输入框");
assert.match(chatSource, /setInputMode\("text"\)[\s\S]*setInputText/, "表情选择尚未自动恢复文字模式");
assert.match(chatSource, /display="hold"/, "语音模式尚未使用横向按住说话按钮");
assert.match(voiceSource, /"按住说话"/, "录音组件尚未提供按住说话文案");
assert.match(voiceSource, /松开发送/, "录音按钮尚未反馈松开发送状态");
assert.match(voiceSource, /松开取消/, "录音按钮尚未反馈上滑取消状态");

assert.match(chatSource, /function MessageEntry/, "聊天消息尚未建立独立进入动画容器");
assert.match(chatSource, /duration: 210/, "消息气泡进入动画时长不符合短促反馈要求");
assert.match(chatSource, /outputRange: \[0\.96, 1\]/, "消息气泡尚未使用克制的缩放进入效果");
assert.match(chatSource, /animatedMessageIdsRef/, "聊天页无法区分新消息和历史消息动画");
assert.match(chatSource, /Date\.now\(\) - animationQueuedAt < 2_000/, "过期的新消息动画标记尚未自动失效");
assert.match(chatSource, /lastBackgroundPulseAtRef\.current < 280/, "连续消息尚未合并背景涟漪反馈");
assert.match(chatSource, /AccessibilityInfo\.isReduceMotionEnabled/, "消息动画尚未尊重减少动态效果设置");
assert.match(chatSource, /useNativeDriver: true/, "消息动画尚未使用原生驱动的高性能属性");

console.log("PASS: 聊天页已实现草稿保留的文字/语音双模式与仅新消息播放的进入动画");
