import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [loginSource, registerSource, passwordInputSource] = await Promise.all([
  readFile(new URL("../src/screens/LoginScreen.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/RegisterScreen.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/PasswordInput.tsx", import.meta.url), "utf8"),
]);

for (const [screenName, source] of [["登录页", loginSource], ["注册页", registerSource]]) {
  assert.match(source, /<PasswordInput[\s\S]*?value=\{password\}/, `${screenName}尚未使用共用密码输入组件`);
  assert.match(source, /placeholderTextColor=\{INPUT_COLORS\.placeholder\}/, `${screenName}没有明确用户名占位文字颜色`);
  assert.match(source, /selectionColor=\{INPUT_COLORS\.selection\}/, `${screenName}没有明确用户名选中颜色`);
  assert.match(source, /cursorColor=\{INPUT_COLORS\.cursor\}/, `${screenName}没有明确用户名光标颜色`);
}

assert.match(passwordInputSource, /secureTextEntry=\{!visible\}/, "密码输入组件没有根据显隐状态切换安全输入");
assert.match(passwordInputSource, /color: INPUT_COLORS\.text/, "密码输入文字没有明确颜色");
assert.match(passwordInputSource, /placeholderTextColor=\{INPUT_COLORS\.placeholder\}/, "密码占位文字没有明确颜色");
assert.match(passwordInputSource, /cursorColor=\{INPUT_COLORS\.cursor\}/, "密码光标没有明确颜色");
assert.match(passwordInputSource, /selectionColor=\{INPUT_COLORS\.selection\}/, "密码选中区域没有明确颜色");
assert.match(passwordInputSource, /minWidth: 44, height: 44/, "密码显隐按钮点击区域不足 44×44");
assert.match(passwordInputSource, /accessibilityLabel=\{visible \? "隐藏密码" : "显示密码"\}/, "密码显隐按钮缺少明确的无障碍名称");
assert.match(passwordInputSource, /selection=\{selection\}/, "密码显隐切换没有保留光标选择位置");

console.log("PASS: 登录和注册页密码输入颜色明确，且支持无障碍显隐切换");
