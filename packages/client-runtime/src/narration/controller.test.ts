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

function summaryFixture() {
  const summaries: Array<{ resolve: (text: string) => void; reject: (error: Error) => void }> = [];
  const summarize = vi.fn(
    () => new Promise<string>((resolve, reject) => summaries.push({ resolve, reject })),
  );
  const speak = vi.fn();
  const cancel = vi.fn();
  const error = vi.fn();
  const queue = new NarrationQueue({ speak, cancel }, error, Date.now, summarize);
  return { queue, summaries, summarize, speak, cancel, error };
}

describe("model narration summaries", () => {
  it("keeps excerpts for clients that do not request model summaries", () => {
    const cursor = new NarrationCursor([]);
    expect(
      cursor.next([message("1", "I checked the code. I ran the tests. The build is blocked.")]),
    ).toBe("I checked the code. I ran the tests.");
  });
  it("summarizes the full public update, including conclusions after the opening sentences", () => {
    const cursor = new NarrationCursor([], true);
    const text =
      "I checked the code. I ran the tests. The build is blocked by a missing dependency.";
    expect(cursor.next([message("1", text)])).toBe(text);
  });
  it("speaks a short summary, never the original long update", async () => {
    const f = summaryFixture();
    f.queue.enqueue("Detailed implementation notes. ".repeat(30));
    expect(f.speak).not.toHaveBeenCalled();
    f.summaries[0]!.resolve("The fix passed its tests.");
    await Promise.resolve();
    expect(f.speak.mock.calls[0]?.[0]).toBe("The fix passed its tests.");
  });
  it("keeps only the freshest update while a summary is in flight", async () => {
    const f = summaryFixture();
    f.queue.enqueue("First");
    f.queue.enqueue("Second");
    f.queue.enqueue("Latest");
    f.summaries[0]!.resolve("Old summary.");
    await Promise.resolve();
    expect(f.speak).not.toHaveBeenCalled();
    expect(f.summarize.mock.calls).toEqual([["First"], ["Latest"]]);
    f.summaries[1]!.resolve("Current summary.");
    await Promise.resolve();
    expect(f.speak.mock.calls[0]?.[0]).toBe("Current summary.");
  });
  it("ignores late summaries after mute or navigation", async () => {
    const f = summaryFixture();
    f.queue.enqueue("Update");
    f.queue.stop();
    f.summaries[0]!.resolve("Too late.");
    await Promise.resolve();
    expect(f.speak).not.toHaveBeenCalled();
    expect(f.cancel).toHaveBeenCalledOnce();
  });
  it("stops with an actionable error when summarization fails", async () => {
    const f = summaryFixture();
    f.queue.enqueue("Original long update");
    f.summaries[0]!.reject(new Error("offline"));
    await Promise.resolve();
    expect(f.speak).not.toHaveBeenCalled();
    expect(f.error).toHaveBeenCalledWith(expect.stringContaining("Check the narration model"));
  });
  it("skips empty summaries and bypasses the model for the activation greeting", async () => {
    const f = summaryFixture();
    f.queue.enqueue("Not useful");
    f.summaries[0]!.resolve("");
    await Promise.resolve();
    f.queue.enqueue("Narration is on.", false);
    expect(f.speak.mock.calls[0]?.[0]).toBe("Narration is on.");
    expect(f.summarize).toHaveBeenCalledOnce();
  });
});
