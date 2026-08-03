import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [clientSource, editSource, profileSource, cardSource, detailsSource, themeSource] = await Promise.all([
  readFile(new URL("../src/api/client.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/ProfileEditScreen.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/ProfileScreen.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/MyProfileCardScreen.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/ConversationDetailsScreen.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/theme/graphite.ts", import.meta.url), "utf8"),
]);

assert.match(clientSource, /uploadAvatar/, "移动端 API 尚未提供头像上传");
assert.match(clientSource, /removeAvatar/, "移动端 API 尚未提供头像移除");
assert.match(editSource, /selectedAvatar/, "编辑资料页尚未保留待上传头像");
assert.match(editSource, /aspect:\s*kind === "avatar" \? \[1, 1\]/, "头像选择尚未使用正方形裁剪");
assert.match(editSource, /MAX_PROFILE_IMAGE_BYTES\s*=\s*5 \* 1024 \* 1024/, "头像尚未限制为 5 MB");
assert.match(editSource, /更换头像/, "编辑资料页缺少更换头像操作");
assert.match(editSource, /移除头像/, "编辑资料页缺少移除头像操作");
assert.match(editSource, /updateProfileAction\(latest\)/, "头像保存后尚未刷新当前账号资料");
assert.match(editSource, /GRAPHITE_COLORS/, "编辑资料页尚未迁移到 Graphite Flow");
assert.doesNotMatch(editSource, /bannerShade/, "编辑资料背景图不应使用造成硬分割线的底部遮罩");
assert.match(themeSource, /PROFILE_BANNER_ASPECT_RATIO\s*=\s*16\s*\/\s*7/, "资料背景尚未定义统一的 16:7 比例");
for (const [name, source] of [
  ["编辑资料", editSource],
  ["我的名片", cardSource],
  ["好友资料", detailsSource],
]) {
  assert.match(source, /aspectRatio:\s*PROFILE_BANNER_ASPECT_RATIO/, `${name}页尚未使用统一背景比例`);
}
assert.doesNotMatch(editSource, /bannerFrame:\s*\{[^}]*height:\s*\d+/s, "编辑资料背景不应继续使用固定高度");
assert.doesNotMatch(cardSource, /bannerFrame:\s*\{[^}]*height:\s*\d+/s, "我的名片背景不应继续使用固定高度");
assert.doesNotMatch(detailsSource, /profileBanner:\s*\{[^}]*height:\s*\d+/s, "好友资料背景不应继续使用固定高度");
assert.match(profileSource, /resolveMediaUrl\(user\?\.avatar\)/, "个人主页尚未显示服务端头像");

console.log("PASS: 头像支持正方形编辑，资料背景保持原图且不添加底部硬遮罩");
