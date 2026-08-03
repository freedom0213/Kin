import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname } from "node:path";

const sourceRoot = new URL("../src/", import.meta.url);

async function collectSourceFiles(directoryUrl) {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directoryUrl);
    if (entry.isDirectory()) files.push(...await collectSourceFiles(entryUrl));
    else if ([".ts", ".tsx"].includes(extname(entry.name))) files.push(entryUrl);
  }
  return files;
}

const sourceFiles = await collectSourceFiles(sourceRoot);
const appUrl = new URL("../App.tsx", import.meta.url);
const allFiles = [appUrl, ...sourceFiles];
const contents = await Promise.all(allFiles.map(async (fileUrl) => ({
  file: fileUrl.pathname,
  source: await readFile(fileUrl, "utf8"),
})));

const appSource = contents.find(({ file }) => file.endsWith("/App.tsx"))?.source || "";
const nonThemeSource = contents
  .filter(({ file }) => !file.endsWith("/theme/graphite.ts"))
  .map(({ source }) => source)
  .join("\n");

assert.doesNotMatch(nonThemeSource, /\bAlert\.alert\b|\bAlert\b/, "移动端仍残留系统 Alert");
assert.doesNotMatch(
  nonThemeSource,
  /"#[0-9A-Fa-f]{3,8}"/,
  "Graphite Flow 色值仍散落在主题 Token 之外",
);
assert.match(appSource, /theme=\{GRAPHITE_NAVIGATION_THEME\}/, "登录后导航容器仍可能回退到浅色主题");
assert.match(appSource, /<ExpoStatusBar style="light"/, "App 根状态栏尚未固定为深色页面可见模式");
assert.doesNotMatch(appSource, /systemMaterialLight|DefaultTheme/, "全局浮层仍残留浅色系统材质");
assert.match(appSource, /incomingAction: \{\s*width: 48, height: 48/s, "来电操作触控目标不足 48 dp");

const dialogSource = contents.find(({ file }) => file.endsWith("/components/KinDialog.tsx"))?.source || "";
assert.match(dialogSource, /export function useKinDialog/, "统一 Graphite 对话框缺少跨页面复用入口");
assert.match(dialogSource, /minHeight: 48/, "统一对话框操作触控目标不足 48 dp");

const chatSource = contents.find(({ file }) => file.endsWith("/screens/ChatScreen.tsx"))?.source || "";
const voiceSource = contents.find(({ file }) => file.endsWith("/components/VoiceMessage.tsx"))?.source || "";
const profileEditSource = contents.find(({ file }) => file.endsWith("/screens/ProfileEditScreen.tsx"))?.source || "";
const callSource = contents.find(({ file }) => file.endsWith("/screens/VoiceCallScreen.tsx"))?.source || "";
assert.match(chatSource, /useKinDialog/, "聊天页面提示尚未接入统一 Graphite 对话框");
assert.match(voiceSource, /useKinDialog/, "录音权限提示尚未接入统一 Graphite 对话框");
assert.match(profileEditSource, /useKinDialog/, "资料编辑反馈尚未接入统一 Graphite 对话框");
assert.match(callSource, /GRAPHITE_COLORS/, "语音通话页尚未并入 Graphite Token");

console.log(`PASS: 真机验收前 Graphite Flow 全局审计完成（${allFiles.length} 个源码文件）`);
