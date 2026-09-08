import { describe, expect, it, vi } from "vite-plus/test";
import {
  NarrationCursor,
  NarrationQueue,
  narrationExcerpt,
  type NarrationMessage,
} from "./controller.ts";

const message = (
  id: string,
  text: string,
  streaming = false,
  role = "assistant",
): NarrationMessage => ({ id, text, streaming, role });

describe("narration excerpts", () => {
  it("preserves dotted filenames and an unpunctuated last sentence", () => {
    expect(narrationExcerpt("I’m checking auth.test.ts. The tests are running")).toBe(
      "I’m checking auth.test.ts. The tests are running",
    );
  });
  it("reads prose without code, links, or image descriptions", () => {
    expect(
      narrationExcerpt(
        "I’m checking [authentication](https://example.com).\n```ts\nthrow new Error('secret');\n```\nThe tests are running. ![screenshot](image.png) A third sentence.",
      ),
    ).toBe("I’m checking authentication. The tests are running.");
    expect(narrationExcerpt("```ts\nonly code")).toBe("");
  });
  it("bounds long prose at a word boundary", () => {
    const result = narrationExcerpt("A long update ".repeat(100));
    expect(result.length).toBeLessThanOrEqual(280);
    expect(result.endsWith("…")).toBe(true);
  });
});

describe("narration cursor", () => {
  it("does not narrate older messages loaded through pagination", () => {
    const cursor = new NarrationCursor([
      { ...message("current", "Current update."), createdAt: "2026-09-08T15:00:00Z" },
    ]);
    expect(
      cursor.next([{ ...message("older", "Old update."), createdAt: "2026-09-08T14:00:00Z" }]),
    ).toBeUndefined();
    expect(
      cursor.next([{ ...message("new", "New update."), createdAt: "2026-09-08T15:01:00Z" }]),
    ).toBe("New update.");
  });
  it("does not repeat identical updates with different message ids", () => {
    const cursor = new NarrationCursor([]);
    expect(cursor.next([message("1", "Running tests.")])).toBe("Running tests.");
    expect(cursor.next([message("2", "Running tests.")])).toBeUndefined();
  });
  it("skips history, including messages streaming when enabled", () => {
    const cursor = new NarrationCursor([
      message("old", "Old update"),
      message("streaming", "Existing", true),
    ]);
    expect(
      cursor.next([message("old", "Old update"), message("streaming", "Existing complete")]),
    ).toBeUndefined();
  });
  it("waits for completion, speaks once, and never reads user or system messages", () => {
    const cursor = new NarrationCursor([]);
    expect(cursor.next([message("new", "I am checking", true)])).toBeUndefined();
    expect(cursor.next([message("new", "I am checking the tests.")])).toBe(
      "I am checking the tests.",
    );
    expect(
      cursor.next([
        message("new", "I am checking the tests."),
        message("user", "Private input", false, "user"),
        message("system", "System instructions", false, "system"),
      ]),
    ).toBeUndefined();
  });
  it("uses only the newest meaningful update when reconnect delivers a batch", () => {
    const cursor = new NarrationCursor([]);
    expect(
      cursor.next([
        message("1", "Checking files."),
        message("2", "Running tests."),
        message("3", "```\ncode\n```"),
      ]),
    ).toBe("Running tests.");
  });
});

function fixture() {
  const completions: (() => void)[] = [];
  const failures: (() => void)[] = [];
  const speak = vi.fn((_text: string, done: () => void, failed: () => void) => {
    completions.push(done);
    failures.push(failed);
  });
  const cancel = vi.fn();
  const error = vi.fn();
  let now = 0;
  const queue = new NarrationQueue({ speak, cancel }, error, () => now);
  return {
    queue,
    speak,
    cancel,
    error,
    completions,
    failures,
    advance: () => {
      now += 21_000;
    },
  };
}

describe("narration queue", () => {
  it("replaces pending updates without interrupting the current sentence", () => {
    const f = fixture();
    f.queue.enqueue("First");
    f.queue.enqueue("Second");
    f.queue.enqueue("Latest");
    expect(f.speak.mock.calls.map(([text]) => text)).toEqual(["First"]);
    f.completions[0]!();
    expect(f.speak.mock.calls.map(([text]) => text)).toEqual(["First", "Latest"]);
    expect(f.cancel).not.toHaveBeenCalled();
  });
  it("drops stale updates", () => {
    const f = fixture();
    f.queue.enqueue("First");
    f.queue.enqueue("Old");
    f.advance();
    f.completions[0]!();
    expect(f.speak).toHaveBeenCalledTimes(1);
  });
  it("cancels immediately and ignores callbacks after navigation or mute", () => {
    const f = fixture();
    f.queue.enqueue("First");
    f.queue.enqueue("Pending");
    f.queue.stop();
    f.completions[0]!();
    f.failures[0]!();
    f.queue.enqueue("Too late");
    expect(f.cancel).toHaveBeenCalledTimes(1);
    expect(f.speak).toHaveBeenCalledTimes(1);
    expect(f.error).not.toHaveBeenCalled();
  });
  it("stops and reports speech failures", () => {
    const f = fixture();
    f.queue.enqueue("First");
    f.queue.enqueue("Pending");
    f.failures[0]!();
    expect(f.cancel).toHaveBeenCalledTimes(1);
    expect(f.error).toHaveBeenCalledTimes(1);
    f.completions[0]!();
    expect(f.speak).toHaveBeenCalledTimes(1);
  });
});
