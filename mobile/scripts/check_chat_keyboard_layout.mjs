import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const chatScreenSource = await readFile(
  new URL("../src/screens/ChatScreen.tsx", import.meta.url),
  "utf8",
);
const {
  calculateNativeComposerHeight,
  calculateWebComposerHeight,
  CHAT_COMPOSER_MIN_HEIGHT,
  CHAT_COMPOSER_MAX_HEIGHT,
} = await import("../src/services/chatComposerLayout.ts");

assert.equal(CHAT_COMPOSER_MIN_HEIGHT, 48, "Single-line composer must be 48dp");
assert.equal(CHAT_COMPOSER_MAX_HEIGHT, 112, "Composer maximum must be 112dp");
assert.equal(
  calculateNativeComposerHeight({ contentHeight: 44, singleLineContentHeight: 44 }),
  48,
  "Android single-line content must not expand the composer to 60dp",
);
assert.equal(
  calculateNativeComposerHeight({ contentHeight: 66, singleLineContentHeight: 44 }),
  70,
  "A second native line should grow by the measured line delta",
);
assert.equal(
  calculateNativeComposerHeight({ contentHeight: 180, singleLineContentHeight: 44 }),
  112,
  "Native composer height must be capped",
);
assert.equal(calculateWebComposerHeight(""), 48, "Empty Web composer must be 48dp");
assert.equal(calculateWebComposerHeight("hello"), 48, "Single-line Web composer must be 48dp");
assert.ok(calculateWebComposerHeight("first\nsecond") > 48, "Multiline Web composer must grow");

assert.match(chatScreenSource, /numberOfLines=\{1\}/, "Composer must start as one line");
assert.match(chatScreenSource, /includeFontPadding:\s*false/, "Android font padding must not offset centering");
assert.match(
  chatScreenSource,
  /textAlignVertical=\{inputHeight > CHAT_COMPOSER_MIN_HEIGHT \? "top" : "center"\}/,
  "Single-line text must be vertically centered",
);
assert.match(chatScreenSource, /calculateNativeComposerHeight/, "Native content height must use the normalized helper");
assert.doesNotMatch(chatScreenSource, /measuredHeight \+ 16/, "The faulty Android +16 height rule must not return");

console.log("PASS: composer is 48dp for one line and grows only for measured multiline content");
