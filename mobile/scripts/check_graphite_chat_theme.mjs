import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [themeSource, chatSource, voiceSource] = await Promise.all([
  readFile(new URL("../src/theme/graphite.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/ChatScreen.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/VoiceMessage.tsx", import.meta.url), "utf8"),
]);

assert.match(themeSource, /surfacePressed/, "Graphite Flow 尚未定义聊天页需要的深色层级表面");
assert.match(themeSource, /warningSoft/, "Graphite Flow 尚未定义加密异常警告表面");
assert.match(chatSource, /GRAPHITE_COLORS/, "聊天页尚未接入 Graphite Flow Token");
assert.match(chatSource, /GRAPHITE_INPUT_COLORS/, "聊天输入框尚未显式设置深色主题输入颜色");
assert.match(chatSource, /ExpoStatusBar style="light"/, "聊天页状态栏图标在深色背景上可能不可见");
assert.match(chatSource, /msgMine:[\s\S]*backgroundColor: GRAPHITE_COLORS\.surfacePressed/, "自己的消息气泡尚未切换为黑灰层级表面");
assert.match(chatSource, /backgroundColor: GRAPHITE_COLORS\.surfaceStrong/, "对方消息和浮层尚未使用深色层级表面");
assert.match(chatSource, /ambientOnlineLayer:[\s\S]*backgroundColor: "rgba\(0,0,0,0\.10\)"/, "在线聊天背景仍带有大面积绿色底色");
assert.match(chatSource, /messageRipple:[\s\S]*borderColor: GRAPHITE_COLORS\.lineStrong/, "消息涟漪尚未改为中性石墨色");
assert.match(chatSource, /deliveryStatusRead: \{ color: GRAPHITE_COLORS\.text \}/, "已读标记仍在扩大绿色视觉占比");
assert.doesNotMatch(chatSource, /showEncryptionNotice/, "加密提示仍会定时卸载并造成聊天区域尺寸变化");
assert.match(chatSource, /encryptionNotice:[\s\S]*position: "absolute"[\s\S]*backgroundColor: "transparent"/, "加密提示尚未作为透明悬浮状态显示在消息区域顶部");
assert.match(chatSource, /msgList: \{ paddingHorizontal: 14, paddingTop: 48/, "消息列表尚未为悬浮加密提示保留稳定空间");
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
