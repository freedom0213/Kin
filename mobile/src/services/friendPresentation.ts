import type { Friend } from "../api/client";
import type { ConversationSummary } from "./db";

const PINYIN_COLLATOR = new Intl.Collator("zh-CN-u-co-pinyin", {
  numeric: true,
  sensitivity: "base",
});

export function getFriendDisplayName(friend: Friend): string {
  return friend.nickname || friend.username;
}

export function getFriendInitials(friend: Friend): string {
  return Array.from(getFriendDisplayName(friend)).slice(0, 2).join("").toUpperCase();
}

export function sortFriendsByName(friends: Friend[]): Friend[] {
  return [...friends].sort((left, right) => (
    PINYIN_COLLATOR.compare(getFriendDisplayName(left), getFriendDisplayName(right))
    || left.user_id.localeCompare(right.user_id)
  ));
}

export function formatConversationTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round(
    (startOfToday.getTime() - startOfDate.getTime()) / 86_400_000,
  );

  if (dayDiff === 0) {
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  if (dayDiff === 1) return "昨天";
  if (dayDiff > 1 && dayDiff < 7) return `周${"日一二三四五六"[date.getDay()]}`;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function getMessagePreview(summary?: ConversationSummary): string {
  if (!summary) return "还没有聊过";
  const message = summary.last_message;
  if (message.type === "voice") {
    return `[语音] ${Math.max(1, Math.round(message.duration || 0))}″`;
  }
  return message.content || "[空消息]";
}

export function getSummaryStatus(
  summary: ConversationSummary | undefined,
  currentUserId: string,
): string {
  const message = summary?.last_message;
  if (!message || message.sender_id !== currentUserId) return "";
  if (message.delivery_status === "sending" || message.delivery_status === "queued") return "◷";
  if (message.delivery_status === "failed") return "!";
  if (message.delivery_status === "read" || message.is_read) return "✓✓";
  return "✓";
}
