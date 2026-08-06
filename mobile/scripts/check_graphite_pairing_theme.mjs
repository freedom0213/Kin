import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [screenSource, sheetSource] = await Promise.all([
  readFile(new URL("../src/screens/AddFriendScreen.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/KinBottomSheet.tsx", import.meta.url), "utf8"),
]);

assert.match(screenSource, /GRAPHITE_COLORS/, "AddFriendScreen must use Graphite tokens");
assert.match(screenSource, /GRAPHITE_INPUT_COLORS/, "Pairing code input must use dark input tokens");
assert.match(screenSource, /ExpoStatusBar style="light"/, "Add friend status bar must remain visible on black");
assert.match(screenSource, /reduceMotion=\{reduceMotion\}/, "Pairing motion must respect reduce motion");
assert.match(screenSource, /resizeMode="contain"/, "Pairing profile banner must preserve its aspect ratio");
assert.match(screenSource, /resolveMediaUrl\(pairing\.peer\.avatar\)/, "Pairing avatar URL must be resolved");
assert.match(screenSource, /无法碰一碰？使用配对码/, "Pairing-code fallback entry is missing");
assert.match(screenSource, /不支持 NFC，可使用配对码/, "NFC fallback guidance is missing");
assert.match(screenSource, /不支持发起 HCE 碰一碰，请使用下方配对码/, "HCE fallback guidance is missing");
assert.match(screenSource, /headerAction: \{ width: 48, height: 48/, "Back target must remain at least 48dp");
assert.match(screenSource, /fallbackToggle: \{ minHeight: 48/, "Pairing-code target must remain at least 48dp");
assert.match(sheetSource, /backgroundColor:\s*GRAPHITE_COLORS\.canvas/, "Bottom Sheet must use pure-black canvas");
assert.match(sheetSource, /rgba\(0,0,0,0\.64\)/, "Bottom Sheet scrim must preserve focus");
assert.doesNotMatch(
  `${screenSource}\n${sheetSource}`,
  /#F4F5F2|#FFFFFF|#F0F2EF|#F4F6F3|#171A1F|#E2E5E1/i,
  "Legacy light-theme colors must not return",
);

console.log("PASS: pairing screen and Bottom Sheet use the pure-black Graphite theme");
