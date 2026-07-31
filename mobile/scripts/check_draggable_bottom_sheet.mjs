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
assert.match(sheetSource, /KeyboardAvoidingView/, "Kin Bottom Sheet 尚未集中处理键盘避让");
assert.match(sheetSource, /useSafeAreaInsets/, "Kin Bottom Sheet 尚未集中处理系统安全区");
assert.match(addFriendSource, /<KinBottomSheet/, "碰一碰弹窗尚未迁移到统一组件");
assert.doesNotMatch(addFriendSource, /<Modal/, "碰一碰页面仍在复制原始 Modal 逻辑");
assert.doesNotMatch(addFriendSource, /sheetHandle/, "碰一碰页面仍保留静态假抓手");

console.log("PASS: 碰一碰已使用支持停靠点、拖动与无障碍操作的统一 Bottom Sheet");
