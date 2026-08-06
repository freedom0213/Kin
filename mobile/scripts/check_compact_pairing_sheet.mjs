import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [screenSource, sheetSource] = await Promise.all([
  readFile(new URL("../src/screens/AddFriendScreen.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/KinBottomSheet.tsx", import.meta.url), "utf8"),
]);
const { resolveBottomSheetHeights } = await import("../src/services/bottomSheetLayout.ts");

const currentPhone = resolveBottomSheetHeights(954, 0.54, 0.54);
assert.ok(Math.abs(currentPhone.defaultHeight - 515.16) < 0.001, "954px pairing sheet must use 54% height");
assert.equal(currentPhone.expandedHeight, currentPhone.defaultHeight, "Compact pairing sheet must not expand beyond 54%");

const smallPhone = resolveBottomSheetHeights(640, 0.54, 0.54);
assert.equal(smallPhone.defaultHeight, 345.6, "640px pairing sheet must remain close to half-screen");
assert.equal(smallPhone.expandedHeight, smallPhone.defaultHeight, "Small-screen pairing sheet must remain compact");

assert.match(sheetSource, /defaultHeightRatio\?: number/, "Bottom Sheet default-height API is missing");
assert.match(sheetSource, /maxHeightRatio\?: number/, "Bottom Sheet maximum-height API is missing");
assert.match(screenSource, /defaultHeightRatio=\{0\.54\}/, "Pairing sheet default height must be 54%");
assert.match(screenSource, /maxHeightRatio=\{0\.54\}/, "Pairing sheet maximum height must be 54%");
assert.match(screenSource, /peerIdentityVisual: \{ width: "100%", maxWidth: 260/, "Profile visual must be compact");
assert.match(screenSource, /peerAvatar:[\s\S]*width: 68, height: 68/, "Pairing avatar must fit the compact card");
assert.match(screenSource, /pairVisual:[\s\S]*height: 150/, "Waiting-state device visual must leave room for the pairing code");
assert.match(screenSource, /pairingCodeArea:[\s\S]*marginTop: 10, padding: 10/, "Pairing code must fit above the fixed actions");
assert.match(screenSource, /sheetScroll: \{ flex: 1/, "Profile details must remain scrollable on short screens");
assert.match(screenSource, /sheetActions:[\s\S]*minHeight: 48/, "Confirmation actions must remain visible and touchable");

console.log("PASS: pairing confirmation sheet is compact, fixed at 54%, and keeps actions visible");
