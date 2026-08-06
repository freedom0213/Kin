export const BOTTOM_SHEET_DEFAULT_HEIGHT_RATIO = 0.88;
export const BOTTOM_SHEET_MAX_HEIGHT_RATIO = 0.88;

export function resolveBottomSheetHeights(
  windowHeight: number,
  defaultHeightRatio = BOTTOM_SHEET_DEFAULT_HEIGHT_RATIO,
  maxHeightRatio = BOTTOM_SHEET_MAX_HEIGHT_RATIO,
) {
  const resolvedMaxHeightRatio = Math.max(0.4, Math.min(1, maxHeightRatio));
  const resolvedDefaultHeightRatio = Math.max(
    0.32,
    Math.min(resolvedMaxHeightRatio, defaultHeightRatio),
  );
  const expandedHeight = Math.max(320, windowHeight * resolvedMaxHeightRatio);
  const defaultHeight = Math.min(
    expandedHeight,
    Math.max(320, windowHeight * resolvedDefaultHeightRatio),
  );
  return { expandedHeight, defaultHeight };
}
