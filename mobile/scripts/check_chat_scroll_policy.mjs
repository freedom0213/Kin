import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const chatScreenSource = await readFile(
  new URL("../src/screens/ChatScreen.tsx", import.meta.url),
  "utf8",
);
const {
  isMessageListNearBottom,
  shouldAutoScrollAfterContentChange,
  shouldStickToBottomAfterViewportResize,
} = await import("../src/services/chatScrollPolicy.ts");

assert.equal(
  shouldAutoScrollAfterContentChange({
    initialScrollPending: true,
    explicitScrollPending: false,
    userNearBottom: false,
  }),
  true,
  "Initial history must open at the newest message",
);
assert.equal(
  shouldAutoScrollAfterContentChange({
    initialScrollPending: false,
    explicitScrollPending: false,
    userNearBottom: false,
  }),
  false,
  "Reading history must not be interrupted",
);
assert.equal(
  shouldStickToBottomAfterViewportResize({
    previousHeight: 620,
    nextHeight: 330,
    userWasNearBottom: true,
  }),
  true,
  "Opening the keyboard at the bottom must preserve the newest message",
);
assert.equal(
  shouldStickToBottomAfterViewportResize({
    previousHeight: 620,
    nextHeight: 330,
    userWasNearBottom: false,
  }),
  false,
  "Opening the keyboard while reading history must preserve the reading position",
);
assert.equal(
  shouldStickToBottomAfterViewportResize({
    previousHeight: 330,
    nextHeight: 620,
    userWasNearBottom: true,
  }),
  false,
  "Closing the keyboard must not trigger a redundant forced scroll",
);
assert.equal(
  isMessageListNearBottom({ contentHeight: 2000, viewportHeight: 700, offsetY: 1250 }),
  true,
  "A 50px bottom distance must count as near-bottom",
);

assert.match(chatScreenSource, /handleMessageViewportLayout/, "Viewport resize handler is missing");
assert.match(chatScreenSource, /stickToBottomOnViewportResizeRef/, "Keyboard focus intent is not retained");
assert.match(chatScreenSource, /removeClippedSubviews=\{false\}/, "Android keyboard resize must not clip the last bubble");
assert.match(chatScreenSource, /explicitScrollPendingRef\.current = true;/, "Sending must explicitly reveal the new message");
assert.match(chatScreenSource, /WEB_SCROLL_THUMB_HEIGHT\s*=\s*42/, "Web scrollbar thumb must remain compact");

console.log("PASS: keyboard viewport changes preserve a complete latest message without stealing history position");
