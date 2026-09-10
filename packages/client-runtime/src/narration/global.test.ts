import { describe, expect, it, vi } from "vite-plus/test";
import { GlobalNarrationQueue, narrationVoiceOrder, type NarrationUpdate } from "./global.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function fixture() {
  const completions: (() => void)[] = [];
  const failures: ((message?: string) => void)[] = [];
  const speak = vi.fn(
    (_text: string, done: () => void, failed: (message?: string) => void, _voice?: string) => {
      completions.push(done);
      failures.push(failed);
    },
  );
  const cancel = vi.fn();
  const changed = vi.fn();
  const error = vi.fn();
  const queue = new GlobalNarrationQueue({ speak, cancel }, ["Jasper", "Bella"], changed, error);
  const enqueue = (key: string, text: string, summarize?: NarrationUpdate["summarize"]) =>
    queue.enqueue({ key, title: key, text, ...(summarize ? { summarize } : {}) });
  return { queue, speak, cancel, changed, error, completions, failures, enqueue };
}
async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("global narration", () => {
  it("serializes threads fairly, coalesces only within each thread, and keeps voice assignments", () => {
    const f = fixture();
    f.enqueue("a", "First A");
    f.enqueue("b", "Old B");
    f.enqueue("a", "Next A");
    f.enqueue("b", "Latest B");
    expect(f.speak).toHaveBeenCalledTimes(1);
    expect(f.changed).toHaveBeenLastCalledWith({ title: "a", voice: "Jasper", pending: 2 });
    f.completions[0]!();
    f.completions[1]!();
    expect(f.speak.mock.calls.map(([text, , , voice]) => [text, voice])).toEqual([
      ["First A", "Jasper"],
      ["Latest B", "Bella"],
      ["Next A", "Jasper"],
    ]);
    expect(f.cancel).not.toHaveBeenCalled();
    f.completions[0]!();
    f.failures[0]!("late failure");
    expect(f.speak).toHaveBeenCalledTimes(3);
    expect(f.error).not.toHaveBeenCalled();
  });
  it("does not discard a summary when another thread speaks next", async () => {
    const f = fixture();
    const summary = deferred<string>();
    f.enqueue("a", "Long A", () => summary.promise);
    f.enqueue("b", "B");
    summary.resolve("Short A.");
    await settle();
    expect(f.speak.mock.calls[0]?.[0]).toBe("Short A.");
    f.completions[0]!();
    expect(f.speak.mock.calls[1]?.[0]).toBe("B");
  });
  it("replaces outdated in-flight summaries without starving other threads", async () => {
    const f = fixture();
    const summary = deferred<string>();
    f.enqueue("a", "Old A", () => summary.promise);
    f.enqueue("b", "B");
    f.enqueue("a", "New A");
    summary.resolve("Outdated.");
    await settle();
    expect(f.speak.mock.calls[0]?.[0]).toBe("B");
    f.completions[0]!();
    expect(f.speak.mock.calls[1]?.[0]).toBe("New A");
  });
  it("skips a failed environment summary and continues with other threads", async () => {
    const f = fixture();
    f.enqueue("offline", "Update", async () => {
      throw new Error("Disconnected");
    });
    f.enqueue("online", "Ready.");
    await settle();
    expect(f.error).toHaveBeenCalledWith(expect.stringContaining("offline"), false);
    expect(f.speak.mock.calls[0]?.[0]).toBe("Ready.");
    expect(f.cancel).not.toHaveBeenCalled();
  });
  it("drops removed threads, including summaries still in flight", async () => {
    const f = fixture();
    const summary = deferred<string>();
    f.enqueue("a", "A", () => summary.promise);
    f.enqueue("b", "B");
    f.enqueue("c", "C");
    f.queue.remove("a");
    f.queue.remove("b");
    summary.resolve("Removed.");
    await settle();
    expect(f.speak.mock.calls[0]?.[0]).toBe("C");
  });
  it("stops playback, clears all threads, and ignores callbacks after stop", async () => {
    const f = fixture();
    const summary = deferred<string>();
    f.enqueue("a", "A", () => summary.promise);
    f.enqueue("b", "B");
    f.queue.stop();
    f.queue.stop();
    summary.resolve("Late.");
    await settle();
    f.enqueue("c", "C");
    expect(f.speak).not.toHaveBeenCalled();
    expect(f.cancel).toHaveBeenCalledOnce();
    expect(f.changed).toHaveBeenLastCalledWith({ title: null, voice: null, pending: 0 });
  });
  it("stops the global session on playback errors", () => {
    const f = fixture();
    f.enqueue("a", "A");
    f.enqueue("b", "B");
    f.failures[0]!("Audio failed");
    f.completions[0]!();
    expect(f.cancel).toHaveBeenCalledOnce();
    expect(f.error).toHaveBeenCalledWith("Audio failed", true);
    expect(f.speak).toHaveBeenCalledTimes(1);
  });
  it("starts with the preferred voice and reuses voices only after exhausting the pool", () => {
    expect(narrationVoiceOrder(["Bella", "Jasper", "Bella"], "Jasper")).toEqual([
      "Jasper",
      "Bella",
    ]);
    expect(narrationVoiceOrder(["Bella"], "missing")).toEqual(["Bella"]);
    const f = fixture();
    f.enqueue("", "On");
    f.enqueue("a", "A");
    f.enqueue("b", "B");
    f.enqueue("c", "C");
    for (let i = 0; i < 3; i++) f.completions[i]!();
    expect(f.speak.mock.calls.map((call) => call[3])).toEqual([
      "Jasper",
      "Jasper",
      "Bella",
      "Jasper",
    ]);
  });
});
