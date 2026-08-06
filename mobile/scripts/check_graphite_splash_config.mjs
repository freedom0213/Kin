import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appConfig = JSON.parse(await readFile(new URL("../app.json", import.meta.url), "utf8"));
const splashPlugin = appConfig.expo.plugins.find(
  (entry) => Array.isArray(entry) && entry[0] === "expo-splash-screen",
);

assert.ok(splashPlugin, "尚未显式配置 Expo 原生启动页");
const options = splashPlugin[1];
assert.equal(options.backgroundColor, "#080A09", "启动页未使用 Graphite 纯黑背景");
assert.equal(options.dark?.backgroundColor, "#080A09", "深色模式启动页背景不一致");
assert.equal(options.image, undefined, "纯色启动页不应配置图片资源");
assert.equal(options.dark?.image, undefined, "深色模式纯色启动页不应配置图片资源");
assert.equal(options.imageWidth, undefined, "没有图片时不应保留图片宽度配置");
assert.equal(options.resizeMode, undefined, "没有图片时不应保留图片缩放配置");

console.log("PASS: 原生启动过渡已改为 Graphite 纯黑背景且不显示图案");
