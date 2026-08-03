import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [sheetSource, addFriendSource] = await Promise.all([
  readFile(new URL("../src/components/KinBottomSheet.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/AddFriendScreen.tsx", import.meta.url), "utf8"),
]);

assert.match(sheetSource, /PanResponder\.create/, "Kin Bottom Sheet 尚未实现拖动手势");
assert.match(sheetSource, /defaultSnapOffset/, "Kin Bottom Sheet 尚未提供默认与展开停靠点");
assert.match(sheetSource, /accessibilityActions/, "Kin Bottom Sheet 缺少读屏等价操作");
assert.match(sheetSource, /setAccessibilityFocus/, "Kin Bottom Sheet 打开后没有把读屏焦点移入弹窗");
assert.match(sheetSource, /reduceMotion/, "Kin Bottom Sheet 尚未支持减少动态效果");
assert.match(sheetSource, /dragDismissEnabled/, "Kin Bottom Sheet 尚未提供关键流程防误关闭策略");
assert.match(sheetSource, /dragActiveRef/, "Kin Bottom Sheet 尚未记录当前拖动是否仍处于激活状态");
assert.match(sheetSource, /onStartShouldSetPanResponder:\s*\(\)\s*=>\s*true/, "Kin Bottom Sheet 抓手按下时尚未立即取得拖动响应");
assert.match(sheetSource, /if \(!dragActiveRef\.current\) return/, "Kin Bottom Sheet 未阻止释放后的悬空移动事件");
assert.match(sheetSource, /onPanResponderTerminationRequest:\s*\(\)\s*=>\s*true/, "Kin Bottom Sheet 仍会拒绝浏览器终止拖动响应");
for (const eventName of ["pointerup", "pointercancel", "pointermove", "mouseup", "mousemove", "blur", "mouseleave"]) {
  assert.match(sheetSource, new RegExp(`addEventListener\\(\\"${eventName}\\"`), `Kin Bottom Sheet 缺少 ${eventName} 释放兜底`);
  assert.match(sheetSource, new RegExp(`removeEventListener\\(\\"${eventName}\\"`), `Kin Bottom Sheet 未清理 ${eventName} 监听器`);
}
assert.match(sheetSource, /event\.buttons\s*===\s*0/, "Kin Bottom Sheet 未识别重新进入页面时鼠标已经松开");
assert.match(sheetSource, /finalOffset\s*>=\s*expandedHeight\s*-\s*1/, "Kin Bottom Sheet 拖至底部时尚未强制关闭");
assert.match(sheetSource, /onPanResponderTerminate:\s*\(\)\s*=>\s*finishDrag\(\)/, "Kin Bottom Sheet 中断拖动时没有统一释放状态");
assert.match(sheetSource, /KeyboardAvoidingView/, "Kin Bottom Sheet 尚未集中处理键盘避让");
assert.match(sheetSource, /useSafeAreaInsets/, "Kin Bottom Sheet 尚未集中处理系统安全区");
assert.match(addFriendSource, /<KinBottomSheet/, "碰一碰弹窗尚未迁移到统一组件");
assert.doesNotMatch(addFriendSource, /<Modal/, "碰一碰页面仍在复制原始 Modal 逻辑");
assert.doesNotMatch(addFriendSource, /sheetHandle/, "碰一碰页面仍保留静态假抓手");

console.log("PASS: 碰一碰已使用支持停靠点、拖动与无障碍操作的统一 Bottom Sheet");
