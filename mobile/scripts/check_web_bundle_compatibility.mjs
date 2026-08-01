import assert from "node:assert/strict";

const bundleUrl = process.env.KIN_WEB_BUNDLE_URL
  || "http://127.0.0.1:4182/index.ts.bundle?platform=web&dev=true&hot=false&lazy=true&transform.engine=hermes&transform.routerRoot=app&unstable_transformProfile=hermes-stable";

const response = await fetch(bundleUrl);
assert.equal(response.ok, true, `Expo Web bundle 请求失败：${response.status}`);

const bundle = await response.text();
assert.equal(
  bundle.includes("node_modules/react-native-webrtc"),
  false,
  "Expo Web bundle 不应加载仅支持原生平台的 react-native-webrtc",
);
assert.equal(
  bundle.includes("_reactNativeWebDistIndex.requireNativeComponent"),
  false,
  "Expo Web bundle 不应包含 react-native-webrtc 的原生组件调用",
);

console.log("PASS: Expo Web bundle 已隔离原生 WebRTC 模块");
