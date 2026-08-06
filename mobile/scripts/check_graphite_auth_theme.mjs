import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [themeSource, layoutSource, loginSource, registerSource, passwordSource, appSource] = await Promise.all([
  readFile(new URL("../src/theme/graphite.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/components/GraphiteAuthLayout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/LoginScreen.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/RegisterScreen.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/PasswordInput.tsx", import.meta.url), "utf8"),
  readFile(new URL("../App.tsx", import.meta.url), "utf8"),
]);

assert.match(themeSource, /canvas:\s*"#000000"/i, "Authentication canvas must use pure black");
assert.match(themeSource, /primary:\s*"#69C8A4"/i, "Kin green accent token is missing");
assert.match(themeSource, /GRAPHITE_NAVIGATION_THEME/, "Navigation theme is missing");
assert.match(layoutSource, /GRAPHITE_COLORS/, "Authentication layout must use shared Graphite tokens");
assert.match(layoutSource, /accessibilityRole="tab"/, "Authentication mode switch must remain accessible");
assert.match(loginSource, /DEV_TEST_ACCOUNTS/, "Development account shortcuts are missing");
assert.match(loginSource, /__DEV__/, "Development accounts must remain restricted to dev builds");
assert.match(registerSource, /confirmPassword/, "Registration confirmation password is missing");
assert.match(registerSource, /passwordRules/, "Registration password feedback is missing");
assert.match(passwordSource, /GRAPHITE_COLORS/, "Password input must use shared Graphite tokens");
assert.match(appSource, /GRAPHITE_NAVIGATION_THEME/, "App navigation must use Graphite theme");
assert.match(appSource, /ExpoStatusBar/, "App status bar must remain dark-theme compatible");
assert.doesNotMatch(loginSource, /backgroundColor:\s*"#fff"/i, "Login screen contains a white page background");
assert.doesNotMatch(registerSource, /backgroundColor:\s*"#fff"/i, "Register screen contains a white page background");

console.log("PASS: login and registration use the pure-black Graphite theme");
