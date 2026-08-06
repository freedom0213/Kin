export const CHAT_COMPOSER_MIN_HEIGHT = 48;
export const CHAT_COMPOSER_MAX_HEIGHT = 112;

interface ComposerHeightInput {
  contentHeight: number;
  singleLineContentHeight: number;
  minHeight?: number;
  maxHeight?: number;
}

export function calculateNativeComposerHeight({
  contentHeight,
  singleLineContentHeight,
  minHeight = CHAT_COMPOSER_MIN_HEIGHT,
  maxHeight = CHAT_COMPOSER_MAX_HEIGHT,
}: ComposerHeightInput): number {
  const growth = Math.max(0, Math.ceil(contentHeight) - Math.ceil(singleLineContentHeight));
  return Math.min(maxHeight, Math.max(minHeight, minHeight + growth));
}

export function calculateWebComposerHeight(value: string): number {
  if (!value) return CHAT_COMPOSER_MIN_HEIGHT;
  const visualLines = value.split("\n").reduce((total, line) => (
    total + Math.max(1, Math.ceil(Array.from(line).length / 18))
  ), 0);
  return Math.min(
    CHAT_COMPOSER_MAX_HEIGHT,
    CHAT_COMPOSER_MIN_HEIGHT + Math.max(0, visualLines - 1) * 22,
  );
}
