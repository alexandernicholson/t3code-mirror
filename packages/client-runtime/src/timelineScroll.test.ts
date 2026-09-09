import { describe, expect, it } from "vite-plus/test";

import { resolveLatestMessageIsBelowViewport } from "./timelineScroll.js";

describe("resolveLatestMessageIsBelowViewport", () => {
  const state = {
    scroll: 800,
    scrollLength: 600,
    positionAtIndex: (index: number) => [100, 900, 1_300, 1_401][index],
  };

  it("stays hidden while the newest message is visible or above the viewport", () => {
    expect(resolveLatestMessageIsBelowViewport(state, 1, 100)).toBe(false);
    expect(resolveLatestMessageIsBelowViewport(state, 2, 100)).toBe(false);
  });

  it("shows after the reader scrolls above the newest message", () => {
    expect(resolveLatestMessageIsBelowViewport(state, 3, 100)).toBe(true);
  });

  it("shows when a newly appended message moves the boundary below the reader", () => {
    expect(resolveLatestMessageIsBelowViewport(state, 2, 100)).toBe(false);
    expect(resolveLatestMessageIsBelowViewport(state, 3, 100)).toBe(true);
  });

  it("uses the unobscured viewport above the composer", () => {
    expect(resolveLatestMessageIsBelowViewport(state, 2, 0)).toBe(false);
    expect(resolveLatestMessageIsBelowViewport(state, 3, 0)).toBe(true);
    expect(
      resolveLatestMessageIsBelowViewport({ ...state, positionAtIndex: () => 1_400 }, 3, 0),
    ).toBe(false);
  });

  it("waits for usable list geometry", () => {
    expect(resolveLatestMessageIsBelowViewport(undefined, 2, 100)).toBeUndefined();
    expect(resolveLatestMessageIsBelowViewport(state, -1, 100)).toBeUndefined();
    expect(
      resolveLatestMessageIsBelowViewport({ scroll: 800, scrollLength: 600 }, 2, 100),
    ).toBeUndefined();
  });
});
