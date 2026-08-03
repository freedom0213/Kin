import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [storeSource, avatarSource, highlightSource, conversationsSource, contactsSource] = await Promise.all([
  readFile(new URL("../src/stores/FriendsHomeContext.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/FriendAvatar.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/PresenceWakeHighlight.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/ConversationsScreen.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/ContactsScreen.tsx", import.meta.url), "utf8"),
]);

const motion = await import("../src/services/presenceMotion.ts");

assert.equal(motion.PRESENCE_STATUS_WAKE_MS, 180, "状态点亮阶段时长发生意外变化");
assert.equal(motion.PRESENCE_LANDING_START_MS, 500, "落位反馈没有在迁移阶段后开始");
assert.equal(motion.PRESENCE_TOTAL_MS, 860, "好友上线总时长应保持在 700～900 ms");
assert.ok(
  motion.PRESENCE_STATUS_WAKE_MS < motion.PRESENCE_LANDING_START_MS
    && motion.PRESENCE_LANDING_START_MS < motion.PRESENCE_TOTAL_MS,
  "好友上线三个阶段的先后关系不正确",
);
assert.equal(motion.getPresenceDelay(1_000, 180, 1_050), 130, "阶段延迟计算不正确");

assert.match(storeSource, /scheduleOnlineCommit/, "在线状态尚未分阶段提交到 Online 分组");
assert.match(storeSource, /configurePresenceLayout\(false\)/, "会话项迁移尚未使用原生布局动画");
assert.match(storeSource, /PRESENCE_STAGGER_MS/, "多名好友同时上线时尚未错开反馈");
assert.match(storeSource, /if \(!reduceMotion \|\| presenceTimersRef\.current\.size === 0\) return/, "减少动态效果开启后尚未取消等待中的动画");
assert.match(avatarSource, /statusWake/, "头像状态点缺少第一阶段点亮动画");
assert.match(avatarSource, /PRESENCE_LANDING_START_MS/, "头像扩散没有等待迁移完成");
assert.match(avatarSource, /PRESENCE_TOTAL_MS/, "低强度呼吸没有等待落位反馈完成");
assert.match(avatarSource, /useNativeDriver: true/, "头像动画尚未使用原生驱动");
assert.match(highlightSource, /translateX/, "落位反馈缺少横向扫光");
assert.match(conversationsSource, /PresenceWakeHighlight/, "会话页尚未接入上线落位反馈");
assert.match(contactsSource, /PresenceWakeHighlight/, "通讯录尚未接入上线状态反馈");

console.log("PASS: 好友上线使用点亮、迁移、落位三阶段苏醒动画，并支持错峰与减少动态效果");
