import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const appConfig = JSON.parse(await readFile(new URL("../app.json", import.meta.url), "utf8"));
const appSource = await readFile(new URL("../App.tsx", import.meta.url), "utf8");
const authSource = await readFile(new URL("../src/stores/AuthContext.tsx", import.meta.url), "utf8");
const splashPlugin = appConfig.expo.plugins.find(
  (entry) => Array.isArray(entry) && entry[0] === "expo-splash-screen",
);

assert.ok(splashPlugin, "expo-splash-screen must be explicitly configured");
const options = splashPlugin[1];
const transparentSplashPath = "./assets/splash-transparent.png";

assert.equal(options.backgroundColor, "#000000", "Splash background must use pure black");
assert.equal(options.dark?.backgroundColor, "#000000", "Dark splash background must use pure black");
assert.equal(options.image, transparentSplashPath, "Android needs a transparent splash asset to generate splashscreen_logo");
assert.equal(options.dark?.image, transparentSplashPath, "Dark mode must use the same transparent splash asset");
assert.equal(options.imageWidth, 1, "Transparent splash asset must use the smallest image width");
assert.equal(options.resizeMode, undefined, "Transparent splash must not retain image resize configuration");

const transparentSplashUrl = new URL(`../${transparentSplashPath.slice(2)}`, import.meta.url);
await access(transparentSplashUrl);
const transparentSplash = await readFile(transparentSplashUrl);
assert.equal(
  transparentSplash.toString("base64"),
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4AWMAAQAABQABNtCI3QAAAABJRU5ErkJggg==",
  "Splash placeholder must remain a fully transparent 1x1 PNG",
);
assert.doesNotMatch(
  appSource,
  /state\.isLoading[\s\S]{0,400}<ActivityIndicator/,
  "Account restoration must not render a separate startup spinner",
);
assert.doesNotMatch(
  authSource,
  /await retryPendingPushUnregistration\(\)/,
  "Pending notification cleanup must not block account restoration",
);

console.log("PASS: startup transition is Graphite-only with no logo, spinner, or notification cleanup blocking");
