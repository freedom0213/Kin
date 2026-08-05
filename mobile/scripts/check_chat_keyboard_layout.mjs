import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const chatScreenSource = await readFile(
  new URL("../src/screens/ChatScreen.tsx", import.meta.url),
  "utf8",
);

assert.match(
  chatScreenSource,
  /behavior=\{Platform\.OS === "ios" \? "padding" : "height"\}/,
  "Android 聊天页必须继续避让系统键盘",
);
assert.match(chatScreenSource, /numberOfLines=\{1\}/, "输入框应从单行高度开始");
assert.match(
  chatScreenSource,
  /textAlignVertical=\{inputHeight > 52 \? "top" : "center"\}/,
  "单行提示文字必须垂直居中",
);
assert.match(
  chatScreenSource,
  /measuredHeight <= COMPOSER_SINGLE_LINE_CONTENT_MAX[\s\S]*\? COMPOSER_MIN_HEIGHT/,
  "Android 单行输入尚未稳定保持 48 高度",
);
assert.match(
  chatScreenSource,
  /Math\.min\(COMPOSER_MAX_HEIGHT, measuredHeight \+ 16\)/,
  "多行输入尚未在限制范围内随内容增高",
);
assert.match(
  chatScreenSource,
  /if \(Platform\.OS === "web"\) setInputHeight\(getWebComposerHeight\(text\)\)/,
  "Web 输入框缺少独立高度计算",
);
assert.match(chatScreenSource, /if \(!value\) return 48/, "Web 空输入框未保持 48 高度");

const backgroundIndex = chatScreenSource.indexOf("<ChatAmbientBackground");
const keyboardIndex = chatScreenSource.indexOf("<KeyboardAvoidingView", backgroundIndex);
assert.ok(backgroundIndex >= 0 && keyboardIndex > backgroundIndex, "环境背景必须位于键盘避让容器之外");
assert.match(chatScreenSource, /contentLayer: \{ flex: 1, backgroundColor: "transparent" \}/, "键盘响应层应保持透明");

console.log("PASS: 聊天输入框单行等高、多行增长，背景位置不再受 Android 键盘影响");
