import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const chatScreenSource = await readFile(
  new URL("../src/screens/ChatScreen.tsx", import.meta.url),
  "utf8",
);

assert.match(
  chatScreenSource,
  /behavior=\{Platform\.OS === "ios" \? "padding" : "height"\}/,
  "Android 聊天页没有启用 KeyboardAvoidingView 的高度避让，系统键盘可能覆盖输入栏",
);

assert.doesNotMatch(
  chatScreenSource,
  /keyboardVerticalOffset=\{Platform\.OS === "ios" \? 0 : 0\}/,
  "无差别的零偏移配置没有表达任何有效布局规则",
);

console.log("PASS: 聊天输入栏在 iOS 和 Android 均启用明确的键盘避让策略");
