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

assert.match(
  chatScreenSource,
  /showsVerticalScrollIndicator=\{Platform\.OS !== "web"\}/,
  "Web 聊天列表仍会显示浏览器原生高对比滚动条",
);

assert.match(
  chatScreenSource,
  /WEB_SCROLL_THUMB_HEIGHT\s*=\s*42/,
  "Web 聊天列表尚未使用固定小尺寸滚动滑块",
);

assert.match(
  chatScreenSource,
  /styles\.webScrollTrack/,
  "Web 聊天列表尚未提供贴合 Graphite 背景的自定义滚动轨道",
);

assert.match(
  chatScreenSource,
  /webScrollThumbY\.setValue\(progress \* travel\)/,
  "Web 自定义滚动滑块尚未跟随聊天阅读位置",
);

const ownMessageScrollIntentMatches = chatScreenSource.match(
  /explicitScrollPendingRef\.current = true;/g,
) || [];
assert.equal(
  ownMessageScrollIntentMatches.length,
  2,
  "发送文字或语音消息时必须明确滚动到刚发送的新消息",
);

assert.match(
  chatScreenSource,
  /useEffect\(\(\) => \{[\s\S]*shouldAutoScrollAfterContentChange\([\s\S]*requestAnimationFrame\([\s\S]*scrollToEnd\([\s\S]*\[loadingHistory, messages\.length\]\)/,
  "消息数量变化时必须主动唤醒虚拟列表，否则最新消息可能永远不会进入可见区域",
);

assert.match(
  chatScreenSource,
  /<FlatList[\s\S]*initialNumToRender=\{50\}[\s\S]*maxToRenderPerBatch=\{50\}/,
  "聊天页必须完整渲染当前 50 条历史批次，否则最近消息可能只有数据却没有可见节点",
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
