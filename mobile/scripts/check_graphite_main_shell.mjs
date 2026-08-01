import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [appSource, shellSource, conversationsSource, contactsSource, profileSource, storeSource, packageSource] = await Promise.all([
  readFile(new URL("../App.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/MainShellScreen.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/ConversationsScreen.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/ContactsScreen.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/ProfileScreen.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/stores/FriendsHomeContext.tsx", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);

assert.match(appSource, /name="FriendList" component=\{MainShellScreen\}/, "登录后默认入口尚未切换为三栏主框架");
assert.match(shellSource, /会话[\s\S]*通讯录[\s\S]*我的/, "主框架缺少固定的三个一级入口");
assert.match(shellSource, /useWindowDimensions/, "主框架尚未适配手机底栏与宽屏导航栏");
assert.match(shellSource, /BackHandler/, "Android 返回键尚未回到默认会话标签");
assert.match(conversationsSource, /最近会话/, "会话页尚未建立最近会话主列表");
assert.match(conversationsSource, /Online/, "会话页尚未保留在线好友快速入口");
assert.match(contactsSource, /搜索好友/, "通讯录尚未提供好友搜索");
assert.match(contactsSource, /ConversationDetails/, "通讯录头像尚未进入好友资料");
assert.match(profileSource, /Profile Card/i, "我的页面尚未建立独立身份展示区");
assert.match(storeSource, /FriendsHomeProvider/, "会话与通讯录尚未共享好友和会话数据模块");
assert.match(storeSource, /kinWS\.on\("friend_status"/, "共享数据模块尚未处理实时在线状态");
assert.doesNotMatch(packageSource, /@react-navigation\/bottom-tabs/, "本阶段不应引入新的底栏导航依赖");

console.log("PASS: 登录后已使用 Graphite Flow 三栏主框架，并共享好友与会话数据");
