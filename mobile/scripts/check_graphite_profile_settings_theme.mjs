import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [settingsSource, profileSource, dialogSource] = await Promise.all([
  readFile(new URL("../src/screens/SettingsScreen.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/ConversationDetailsScreen.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/KinDialog.tsx", import.meta.url), "utf8"),
]);

const combined = `${settingsSource}\n${profileSource}\n${dialogSource}`;

assert.match(settingsSource, /GRAPHITE_COLORS/, "设置页尚未接入 Graphite Flow Token");
assert.match(profileSource, /GRAPHITE_COLORS/, "好友资料页尚未接入 Graphite Flow Token");
assert.match(settingsSource, /ExpoStatusBar style="light"/, "设置页深色状态栏图标可能不可见");
assert.match(profileSource, /ExpoStatusBar style="light"/, "好友资料页深色状态栏图标可能不可见");
assert.match(settingsSource, /resolveMediaUrl\(user\?\.avatar\)/, "设置页头像尚未解析服务端相对地址");
assert.match(profileSource, /resizeMode="contain"/, "好友背景名片尚未保持原比例显示");
assert.match(profileSource, />发消息<\/Text>/, "好友资料页缺少明确的发消息入口");
assert.match(profileSource, /navigation\.navigate\("Chat", \{ friend \}\)/, "发消息入口尚未进入对应聊天");
assert.match(settingsSource, /<KinDialog/, "设置页反馈仍未接入统一 Graphite 对话框");
assert.match(profileSource, /<KinDialog/, "好友资料页反馈仍未接入统一 Graphite 对话框");
assert.match(dialogSource, /minHeight: 48/, "对话框操作触控目标不足 48 dp");
assert.match(dialogSource, /GRAPHITE_COLORS\.danger/, "危险确认缺少独立危险语义");
assert.doesNotMatch(combined, /Alert\.alert/, "设置页或好友资料页仍残留系统 Alert");
assert.doesNotMatch(
  combined,
  /#F4F5F2|#FFFFFF|#171A1F|#70757D|#E2E5E1|#D8DBD7|#A9DEC9|#345C50|#ECEEEC|#DADDD9/i,
  "设置页、好友资料页或对话框仍残留旧浅色主题关键色值",
);

console.log("PASS: 好友资料、设置和相关反馈对话框已迁移到 Graphite Flow");
