import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [authSource, keysSource, storageSource, configSource] = await Promise.all([
  readFile(new URL("../src/stores/AuthContext.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/services/keys.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/services/secureStorage.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/config.ts", import.meta.url), "utf8"),
]);

assert.doesNotMatch(authSource, /expo-secure-store/, "AuthContext 不应直接调用原生 SecureStore");
assert.doesNotMatch(keysSource, /expo-secure-store/, "账号密钥服务不应直接调用原生 SecureStore");
assert.match(storageSource, /Platform\.OS === "web"/, "存储适配器必须为 Web 提供独立分支");
assert.match(storageSource, /localStorage/, "Web 存储分支必须使用浏览器可用的存储实现");
assert.match(storageSource, /SecureStore\.getItemAsync/, "原生平台必须继续使用 SecureStore");
assert.match(configSource, /Platform\.OS === "web"/, "API 默认地址必须区分 Web 与原生平台");
assert.match(configSource, /http:\/\/127\.0\.0\.1:8000/, "Web 默认 API 地址必须指向本机后端");
assert.match(configSource, /http:\/\/10\.0\.2\.2:8000/, "Android 模拟器默认地址必须保持可用");

console.log("PASS: Web API 地址与登录存储已完成跨平台隔离");
