import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [screenSource, sheetSource] = await Promise.all([
  readFile(new URL("../src/screens/AddFriendScreen.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/KinBottomSheet.tsx", import.meta.url), "utf8"),
]);

assert.match(screenSource, /GRAPHITE_COLORS/, "添加好友页尚未接入 Graphite Flow Token");
assert.match(screenSource, /GRAPHITE_INPUT_COLORS/, "配对码输入框尚未设置深色输入颜色");
assert.match(screenSource, /ExpoStatusBar style="light"/, "添加好友页状态栏图标在深色背景上可能不可见");
assert.match(screenSource, /reduceMotion=\{reduceMotion\}/, "设备靠近图形尚未尊重减少动态效果");
assert.match(screenSource, /resizeMode="contain"/, "配对背景名片尚未保持原比例显示");
assert.match(screenSource, /resolveMediaUrl\(pairing\.peer\.avatar\)/, "配对头像尚未解析服务端媒体地址");
assert.match(screenSource, /NFC 不可用，可使用配对码/, "NFC 不可用状态缺少明确备用方案");
assert.match(screenSource, /headerAction: \{ width: 48, height: 48/, "返回操作触控目标不足 48 dp");
assert.match(screenSource, /fallbackToggle: \{ minHeight: 48/, "配对码入口触控目标不足 48 dp");
assert.match(sheetSource, /GRAPHITE_COLORS\.surface/, "统一 Bottom Sheet 尚未迁移到深色表面");
assert.match(sheetSource, /rgba\(0,0,0,0\.64\)/, "深色 Bottom Sheet 遮罩不足以建立焦点");
assert.doesNotMatch(
  `${screenSource}\n${sheetSource}`,
  /#F4F5F2|#FFFFFF|#F0F2EF|#F4F6F3|#171A1F|#E2E5E1/i,
  "添加好友页或 Bottom Sheet 仍残留旧浅色主题关键色值",
);

console.log("PASS: 添加好友、碰一碰状态、配对码和 Bottom Sheet 已迁移到 Graphite Flow");
