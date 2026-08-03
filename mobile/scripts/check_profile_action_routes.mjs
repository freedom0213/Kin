import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [appSource, profileSource, cardSource, settingsSource, dbSource, editSource] = await Promise.all([
  readFile(new URL("../App.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/ProfileScreen.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/MyProfileCardScreen.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/SettingsScreen.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/services/db.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/ProfileEditScreen.tsx", import.meta.url), "utf8"),
]);

const expectedRoutes = [
  "MyProfileCard",
  "ProfileEdit",
  "NotificationSettings",
  "AccountSecurity",
  "ChatDataSettings",
  "HelpLegal",
];

for (const route of expectedRoutes) {
  assert.match(profileSource, new RegExp(`target: "${route}"`), `我的页面缺少独立入口 ${route}`);
  assert.match(appSource, new RegExp(`name="${route}"`), `导航栈尚未注册 ${route}`);
}

const targets = [...profileSource.matchAll(/target: "([A-Za-z]+)"/g)].map((match) => match[1]);
assert.equal(targets.length, 6, "我的页面应保留六个功能入口");
assert.equal(new Set(targets).size, 6, "六个功能入口必须分别使用不同路由");
assert.match(cardSource, /好友视角预览/, "我的名片缺少好友视角只读说明");
assert.match(cardSource, /navigation\.navigate\("ProfileEdit"\)/, "我的名片缺少编辑入口");
assert.match(settingsSource, /NotificationSettings: \{ title: "通知与状态"/, "通知与状态缺少独立页面配置");
assert.match(settingsSource, /AccountSecurity: \{ title: "账户与安全"/, "账户与安全缺少独立页面配置");
assert.match(settingsSource, /ChatDataSettings: \{ title: "聊天数据"/, "聊天数据缺少独立页面配置");
assert.match(settingsSource, /HelpLegal: \{ title: "帮助与法律"/, "帮助与法律缺少独立页面配置");
assert.match(settingsSource, /handleClearAllMessages/, "聊天数据页缺少清空当前账号全部消息操作");
assert.match(settingsSource, /clearAllMessages\(user\.id\)/, "聊天数据清理没有绑定当前登录账号");
assert.match(settingsSource, /确认清空/, "聊天数据清理缺少危险操作确认");
assert.match(dbSource, /DELETE FROM messages WHERE owner_id = \?/, "全部聊天数据清理必须按 owner_id 隔离");
assert.doesNotMatch(settingsSource, /accessibilityLabel="返回会话列表"/, "设置子页返回按钮标签与实际目的地不一致");
assert.doesNotMatch(editSource, /accessibilityLabel="返回设置"/, "个人资料返回按钮不应假定固定来源页面");

console.log("PASS: 我的页面六个功能入口已分别接入独立页面与对应内容");
