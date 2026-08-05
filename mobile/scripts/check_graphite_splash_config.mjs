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
assert.equal(options.image, "./assets/splash-transparent.svg", "启动页仍可能显示旧圆环资源");
assert.equal(options.dark?.image, "./assets/splash-transparent.svg", "深色模式仍可能显示旧圆环资源");
assert.equal(options.imageWidth, 1, "透明占位资源不应形成可见图案");
assert.notEqual(options.image, "./assets/splash-icon.png", "旧白色圆环启动图仍在使用");

console.log("PASS: 原生启动过渡已改为 Graphite 纯黑背景且不显示图案");
