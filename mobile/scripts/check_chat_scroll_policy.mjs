import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const chatScreenSource = await readFile(
  new URL("../src/screens/ChatScreen.tsx", import.meta.url),
  "utf8",
);

assert.doesNotMatch(
  chatScreenSource,
  /onContentSizeChange=\{\(\) => flatListRef\.current\?\.scrollToEnd\(\)\}/,
  "ChatScreen 仍会在任意内容尺寸变化时无条件滚到底部",
);

const {
  shouldAutoScrollAfterContentChange,
  isMessageListNearBottom,
} = await import("../src/services/chatScrollPolicy.ts");

assert.equal(
  shouldAutoScrollAfterContentChange({
    initialScrollPending: true,
    explicitScrollPending: false,
    userNearBottom: false,
  }),
  true,
  "首次加载历史消息后应该滚动到最新消息",
);

assert.equal(
  shouldAutoScrollAfterContentChange({
    initialScrollPending: false,
    explicitScrollPending: true,
    userNearBottom: false,
  }),
  true,
  "用户点击新消息入口后应该明确滚动到底部",
);

assert.equal(
  shouldAutoScrollAfterContentChange({
    initialScrollPending: false,
    explicitScrollPending: false,
    userNearBottom: true,
  }),
  true,
  "用户位于底部附近时收到新消息应该自然跟随",
);

assert.equal(
  shouldAutoScrollAfterContentChange({
    initialScrollPending: false,
    explicitScrollPending: false,
    userNearBottom: false,
  }),
  false,
  "用户查看历史消息时，语音布局变化不得抢走滚动位置",
);

assert.equal(
  isMessageListNearBottom({
    contentHeight: 2000,
    viewportHeight: 700,
    offsetY: 1250,
  }),
  true,
  "距离底部 50px 应视为底部附近",
);

assert.equal(
  isMessageListNearBottom({
    contentHeight: 2000,
    viewportHeight: 700,
    offsetY: 800,
  }),
  false,
  "距离底部 500px 时应保留历史阅读位置",
);

console.log("PASS: 聊天列表只在存在明确滚动意图时自动滚到底部");
