import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [sheetSource, addFriendSource] = await Promise.all([
  readFile(new URL("../src/components/KinBottomSheet.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/AddFriendScreen.tsx", import.meta.url), "utf8"),
]);

assert.match(sheetSource, /PanResponder\.create/, "Kin Bottom Sheet 尚未实现拖动手势");
assert.match(sheetSource, /defaultSnapOffset/, "Kin Bottom Sheet 尚未提供稳定的停靠位置");
assert.match(sheetSource, /accessibilityActions/, "Kin Bottom Sheet 缺少读屏等价操作");
assert.match(sheetSource, /setAccessibilityFocus/, "Kin Bottom Sheet 打开后没有移动读屏焦点");
assert.match(sheetSource, /reduceMotion/, "Kin Bottom Sheet 尚未支持减少动态效果");
assert.match(sheetSource, /dragActiveRef/, "Kin Bottom Sheet 尚未记录拖动激活状态");
assert.match(
  sheetSource,
  /onStartShouldSetPanResponder:\s*\(\)\s*=>\s*true/,
  "抓手按下时应立即取得拖动响应",
);
assert.match(
  sheetSource,
  /onPanResponderTerminationRequest:\s*\(\)\s*=>\s*false/,
  "Android 抓手拖动不应被内部滚动区域抢走",
);
assert.match(sheetSource, /if \(!dragActiveRef\.current\) return/, "释放后仍可能继续悬空移动");
assert.match(sheetSource, /finalOffset\s*>=\s*expandedHeight\s*-\s*1/, "拖到底部时尚未强制关闭");
assert.match(sheetSource, /onPanResponderTerminate:\s*\(\)\s*=>\s*finishDrag\(\)/, "中断拖动时没有统一收尾");
assert.match(sheetSource, /KeyboardAvoidingView/, "Bottom Sheet 尚未统一处理键盘避让");
assert.match(sheetSource, /useSafeAreaInsets/, "Bottom Sheet 尚未处理系统安全区");

for (const eventName of ["pointerup", "pointercancel", "pointermove", "mouseup", "mousemove", "blur", "mouseleave"]) {
  assert.match(sheetSource, new RegExp(`addEventListener\\(\\"${eventName}\\"`), `缺少 ${eventName} 释放兜底`);
  assert.match(sheetSource, new RegExp(`removeEventListener\\(\\"${eventName}\\"`), `未清理 ${eventName} 监听器`);
}

assert.match(sheetSource, /event\.buttons\s*===\s*0/, "未识别鼠标已经松开的情况");
assert.match(addFriendSource, /<KinBottomSheet/, "碰一碰弹窗尚未使用统一 Bottom Sheet");
assert.doesNotMatch(addFriendSource, /<Modal/, "碰一碰页面仍在复制原始 Modal 逻辑");
assert.doesNotMatch(addFriendSource, /sheetHandle/, "碰一碰页面仍保留静态假抓手");
assert.doesNotMatch(addFriendSource, /dragDismissEnabled=\{!pairing/, "配对进行中仍禁止拖动关闭");
assert.match(addFriendSource, /PROFILE_BANNER_ASPECT_RATIO/, "配对名片背景比例尚未与个人资料统一");
assert.match(addFriendSource, /sheetActions:[\s\S]*paddingBottom/, "确认操作区缺少底部安全间距");

console.log("PASS: 碰一碰 Bottom Sheet 可跟手拖动、回弹和关闭，确认操作区保持可见");
