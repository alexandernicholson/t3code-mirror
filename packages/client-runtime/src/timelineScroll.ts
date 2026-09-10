export interface TimelineLatestMessageState {
  readonly scroll?: number;
  readonly scrollLength?: number;
  readonly positionAtIndex?: (index: number) => number | undefined;
}

/**
 * Whether the newest message starts below the usable viewport. The message's
 * start is the boundary on purpose: once any part of the newest message has
 * been reached (or the reader has moved below it), there is nothing newer to
 * jump to. Appending a message moves the boundary to the new row.
 */
export function resolveLatestMessageIsBelowViewport(
  state: TimelineLatestMessageState | undefined,
  latestMessageIndex: number,
  obscuredViewportEnd: number,
): boolean | undefined {
  if (!state || latestMessageIndex < 0) {
    return undefined;
  }
  const { scroll, scrollLength, positionAtIndex } = state;
  if (scroll === undefined || scrollLength === undefined || !positionAtIndex) {
    return undefined;
  }
  const latestMessageTop = positionAtIndex(latestMessageIndex);
  if (latestMessageTop === undefined || !Number.isFinite(latestMessageTop)) {
    return undefined;
  }
  const visibleEnd = scroll + scrollLength - Math.max(0, obscuredViewportEnd);
  return latestMessageTop > visibleEnd;
}
