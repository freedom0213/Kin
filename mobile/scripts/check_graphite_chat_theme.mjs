import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [themeSource, chatSource, voiceSource] = await Promise.all([
  readFile(new URL("../src/theme/graphite.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/ChatScreen.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/VoiceMessage.tsx", import.meta.url), "utf8"),
]);

assert.match(themeSource, /primaryDeep/, "Graphite Flow 尚未定义自己的消息气泡深绿色表面");
assert.match(themeSource, /warningSoft/, "Graphite Flow 尚未定义加密异常警告表面");
assert.match(chatSource, /GRAPHITE_COLORS/, "聊天页尚未接入 Graphite Flow Token");
assert.match(chatSource, /GRAPHITE_INPUT_COLORS/, "聊天输入框尚未显式设置深色主题输入颜色");
assert.match(chatSource, /ExpoStatusBar style="light"/, "聊天页状态栏图标在深色背景上可能不可见");
assert.match(chatSource, /backgroundColor: GRAPHITE_COLORS\.primaryDeep/, "自己的消息气泡尚未使用克制深绿色表面");
assert.match(chatSource, /backgroundColor: GRAPHITE_COLORS\.surfaceStrong/, "对方消息和浮层尚未使用深色层级表面");
assert.match(chatSource, /sendBtnTextDisabled/, "发送按钮禁用状态缺少独立文字对比度");
assert.match(voiceSource, /GRAPHITE_COLORS/, "语音录制和播放组件尚未迁移到 Graphite Flow");
assert.doesNotMatch(
  `${chatSource}\n${voiceSource}`,
  /#EEF0ED|#F4F5F2|#FFFFFF|#F7F8F6|#171A1F|#273A34|#4E555B/i,
  "聊天页或语音组件仍残留旧浅色主题关键色值",
);
assert.match(chatSource, /shouldAutoScrollAfterContentChange/, "主题迁移破坏了既有滚动策略引用");
assert.match(chatSource, /display="hold"/, "主题迁移破坏了按住说话模式");

console.log("PASS: 聊天详情、消息气泡、输入区、语音和菜单已统一迁移到 Graphite Flow");
