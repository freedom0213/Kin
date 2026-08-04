import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dialogSource = await readFile(
  new URL("../src/components/KinDialog.tsx", import.meta.url),
  "utf8",
);

assert.match(
  dialogSource,
  /useRef/,
  "KinDialog 关闭动画期间尚未保留当前弹窗内容",
);

assert.match(
  dialogSource,
  /if \(visible\)[\s\S]*\.current = \{ title, message, actions \}/,
  "KinDialog 必须只在可见时更新退场内容快照",
);

assert.match(
  dialogSource,
  /renderedContent\.(title|message|actions)/,
  "KinDialog 退场时仍直接渲染已被清空的外部配置",
);

console.log("PASS: KinDialog 关闭动画期间保留原内容，不会闪现空白默认弹窗");
