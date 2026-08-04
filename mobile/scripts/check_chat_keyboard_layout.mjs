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

assert.match(
  chatScreenSource,
  /numberOfLines=\{1\}/,
  "Web 多行输入框尚未以单行高度开始，空输入状态可能高于周围按钮",
);

assert.match(
  chatScreenSource,
  /textAlignVertical=\{inputHeight > 52 \? "top" : "center"\}/,
  "聊天输入框的单行提示文字尚未垂直居中",
);

assert.match(
  chatScreenSource,
  /Math\.min\(112, Math\.ceil\(nativeEvent\.contentSize\.height\) \+ 20\)/,
  "聊天输入框尚未随多行内容在 48px 到 112px 之间扩展",
);

assert.match(
  chatScreenSource,
  /if \(Platform\.OS === "web"\) setInputHeight\(getWebComposerHeight\(text\)\)/,
  "Web 输入框尚未避免 textarea 内容尺寸反馈循环",
);

assert.match(
  chatScreenSource,
  /if \(!value\) return 48/,
  "Web 空输入框尚未稳定保持与周围按钮相同的 48px 高度",
);

console.log("PASS: 聊天输入栏在 iOS 和 Android 均启用明确的键盘避让策略");
