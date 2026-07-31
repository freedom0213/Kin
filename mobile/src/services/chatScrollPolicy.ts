export interface ChatScrollIntent {
  initialScrollPending: boolean;
  explicitScrollPending: boolean;
  userNearBottom: boolean;
}

interface MessageListPosition {
  contentHeight: number;
  viewportHeight: number;
  offsetY: number;
  threshold?: number;
}

export const CHAT_BOTTOM_THRESHOLD = 120;

export function shouldAutoScrollAfterContentChange(intent: ChatScrollIntent): boolean {
  return intent.initialScrollPending
    || intent.explicitScrollPending
    || intent.userNearBottom;
}

export function isMessageListNearBottom({
  contentHeight,
  viewportHeight,
  offsetY,
  threshold = CHAT_BOTTOM_THRESHOLD,
}: MessageListPosition): boolean {
  const distanceFromBottom = contentHeight - viewportHeight - offsetY;
  return distanceFromBottom <= threshold;
}
