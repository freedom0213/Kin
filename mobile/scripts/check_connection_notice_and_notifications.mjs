import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [appSource, notificationSource] = await Promise.all([
  readFile(new URL("../App.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/services/notifications.ts", import.meta.url), "utf8"),
]);

assert.match(appSource, /recoveryReasonRef/, "连接提示尚未区分普通探测与真实断线");
assert.match(appSource, /data\?\.reconnected === true/, "真实重连结果尚未决定成功提示");
assert.match(appSource, /setTimeout\(\(\) => \{[\s\S]*showNotice\("restoring"\)[\s\S]*\}, 650\)/, "普通前台探测仍可能立即闪出恢复提示");
assert.match(appSource, /now - lastSyncedAtRef\.current < 8_000/, "同步成功提示缺少重复显示冷却时间");
assert.match(appSource, /setTimeout\(hideNotice, 1100\)/, "同步成功提示停留时间仍然过长");
assert.match(appSource, /maxWidth: "76%"/, "连接状态提示仍然过宽");
assert.doesNotMatch(notificationSource, /sound:\s*"default"/, "Expo 仍会把 default 当成未打包的自定义声音");
assert.match(notificationSource, /shouldPlaySound:\s*true/, "修复配置时不应关闭通知声音能力");

console.log("PASS: 普通连接探测保持安静，真实重连使用精简提示，通知渠道不再引用缺失声音文件");
