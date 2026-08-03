import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const config = require("../metro.config.js");

assert.ok(
  config?.resolver?.assetExts?.includes("wasm"),
  "Metro 尚未将 expo-sqlite 的 WASM 文件作为 Web 资源处理",
);

console.log("PASS: Metro 已支持 expo-sqlite Web WASM 资源");
