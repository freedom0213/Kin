import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [themeSource, dialogSource, sheetSource, shellSource, chatSource] = await Promise.all([
  readFile(new URL("../src/theme/graphite.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/components/KinDialog.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/KinBottomSheet.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/MainShellScreen.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/ChatScreen.tsx", import.meta.url), "utf8"),
]);

assert.match(themeSource, /page:\s*"#000000"/, "Graphite page must be pure black");
assert.match(themeSource, /canvas:\s*"#000000"/, "Graphite canvas must be pure black");
assert.match(themeSource, /card:\s*GRAPHITE_COLORS\.canvas/, "Navigation card must use the black canvas");
assert.doesNotMatch(themeSource, /#080A09|#0F1210|#171B18|#1D221E|#242A25/, "Green-black legacy surfaces remain");
assert.match(dialogSource, /backgroundColor:\s*GRAPHITE_COLORS\.canvas/, "Dialog body must be pure black");
assert.match(sheetSource, /backgroundColor:\s*GRAPHITE_COLORS\.canvas/, "Bottom Sheet body must be pure black");
assert.match(shellSource, /backgroundColor:\s*"rgba\(0,0,0,0\.96\)"/, "Mobile tab bar must be neutral black");

const structuralBlackUses = chatSource.match(/backgroundColor:\s*GRAPHITE_COLORS\.canvas/g) || [];
assert.ok(structuralBlackUses.length >= 5, "Chat screen structural regions must use pure-black canvas");

console.log("PASS: page, navigation, chat chrome, dialogs, and sheets use pure black");
