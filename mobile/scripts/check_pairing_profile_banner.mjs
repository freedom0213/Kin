import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [clientSource, addFriendSource] = await Promise.all([
  readFile(new URL("../src/api/client.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/AddFriendScreen.tsx", import.meta.url), "utf8"),
]);

assert.match(
  clientSource,
  /interface PairingPeer[\s\S]*?profile_banner: string \| null;/,
  "PairingPeer 尚未声明对方背景名片字段",
);
assert.match(
  addFriendSource,
  /resolveMediaUrl\(pairing\.peer\.profile_banner\)/,
  "配对弹窗尚未解析对方背景名片媒体地址",
);
assert.match(
  addFriendSource,
  /resizeMode="contain"/,
  "配对背景名片没有按原比例完整显示",
);
assert.doesNotMatch(
  addFriendSource,
  /pairingBanner(?:Shade|Overlay)/,
  "配对背景名片不应覆盖遮罩",
);

console.log("PASS: 配对对象背景名片会按原比例显示在头像附近");
