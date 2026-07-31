import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [themeSource, layoutSource, loginSource, registerSource, passwordSource, appSource] = await Promise.all([
  readFile(new URL("../src/theme/graphite.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/components/GraphiteAuthLayout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/LoginScreen.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/RegisterScreen.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/PasswordInput.tsx", import.meta.url), "utf8"),
  readFile(new URL("../App.tsx", import.meta.url), "utf8"),
]);

assert.match(themeSource, /canvas:\s*"#0F1210"/i, "Graphite Flow 尚未定义认证页基底色");
assert.match(themeSource, /primary:\s*"#69C8A4"/i, "Graphite Flow 尚未定义 Kin 绿色语义色");
assert.match(themeSource, /GRAPHITE_NAVIGATION_THEME/, "Graphite Flow 尚未提供导航主题");
assert.match(layoutSource, /GRAPHITE_COLORS/, "认证页共用布局尚未使用全局主题 Token");
assert.match(layoutSource, /accessibilityRole="tab"/, "登录注册模式切换缺少标签页语义");
assert.match(loginSource, /DEV_TEST_ACCOUNTS/, "登录页尚未提供开发测试账号快速填入");
assert.match(loginSource, /__DEV__/, "测试账号入口没有限制在开发构建");
assert.match(registerSource, /confirmPassword/, "注册页尚未增加确认密码");
assert.match(registerSource, /passwordRules/, "注册页尚未显示实时密码规则");
assert.match(passwordSource, /GRAPHITE_COLORS/, "共用密码输入尚未迁移到 Graphite Flow");
assert.match(appSource, /GRAPHITE_NAVIGATION_THEME/, "登录前导航容器尚未接入 Graphite Flow");
assert.match(appSource, /ExpoStatusBar/, "登录前状态栏尚未适配高级黑主题");
assert.doesNotMatch(loginSource, /backgroundColor:\s*"#fff"/i, "登录页仍保留白色页面基底");
assert.doesNotMatch(registerSource, /backgroundColor:\s*"#fff"/i, "注册页仍保留白色页面基底");

console.log("PASS: 登录注册已接入 Graphite Flow 主题、规则反馈和开发测试账号入口");
