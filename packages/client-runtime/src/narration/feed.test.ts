import { describe, expect, it, vi } from "vite-plus/test";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { Option } from "effect";
import { EnvironmentId, ThreadId, TurnId } from "@t3tools/contracts";
import { subscribeNarrationFeed, narrationThreadKey } from "./feed.ts";
import type { NarrationMessage } from "./controller.ts";
import type { EnvironmentThreadState } from "../state/threadState.ts";

const environmentId = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const time = (second: number) => `2026-09-09T00:00:${String(second).padStart(2, "0")}.000Z`;
const shell = (id: string, updated = 10, running = false, environment = environmentId) => ({
  environmentId: environment,
  id: ThreadId.make(id),
  createdAt: time(1),
  updatedAt: time(updated),
  latestTurn: running
    ? {
        turnId: TurnId.make("turn"),
        state: "running" as const,
        requestedAt: time(1),
        startedAt: time(1),
        completedAt: null,
        assistantMessageId: null,
      }
    : null,
});
const message = (id: string, second: number, streaming = false): NarrationMessage => ({
  id,
  text: id,
  role: "assistant",
  streaming,
  createdAt: time(second),
});
type State = {
  status: EnvironmentThreadState["status"];
  data: Option.Option<{ messages: readonly NarrationMessage[] }>;
};
function fixture(initial: ReturnType<typeof shell>[]) {
  const registry = AtomRegistry.make();
  const shells = Atom.make<readonly ReturnType<typeof shell>[]>(initial);
  const states = Atom.family((_key: string) =>
    Atom.make<State>({ status: "empty", data: Option.none() }),
  );
  const onUpdate = vi.fn();
  const onRemove = vi.fn();
  const observed = vi.fn((ref: { environmentId: EnvironmentId; threadId: ThreadId }) =>
    states(narrationThreadKey(ref)),
  );
  const start = () =>
    subscribeNarrationFeed({
      registry,
      shells,
      environmentBaseline: () => time(10),
      state: observed,
      fullText: false,
      onUpdate,
      onRemove,
    });
  const stop = start();
  const update = (
    id: string,
    messages: NarrationMessage[],
    status: State["status"] = "live",
    environment = environmentId,
  ) =>
    registry.set(
      states(narrationThreadKey({ environmentId: environment, threadId: ThreadId.make(id) })),
      { status, data: Option.some({ messages }) },
    );
  return { registry, shells, observed, onUpdate, onRemove, update, stop, start };
}

describe("global narration feed", () => {
  it("leaves idle histories unloaded and catches updates that arrive before a changed thread loads", () => {
    const f = fixture([shell("a"), shell("idle")]);
    expect(f.observed).not.toHaveBeenCalled();
    f.registry.set(f.shells, [shell("a", 12), shell("idle")]);
    expect(f.observed).toHaveBeenCalledOnce();
    f.update("a", [message("history", 5), message("new", 11)], "cached");
    expect(f.onUpdate).not.toHaveBeenCalled();
    f.update("a", [message("history", 5), message("new", 11)]);
    expect(f.onUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }), "new");
    f.stop();
    f.registry.dispose();
  });
  it("follows running threads without a mounted chat view, waiting for completion and skipping pagination", () => {
    const f = fixture([shell("a", 10, true)]);
    f.update("a", [message("existing", 9), message("streaming", 11, true)]);
    expect(f.onUpdate).not.toHaveBeenCalled();
    f.update("a", [message("existing", 9), message("streaming", 11)]);
    f.update("a", [message("older page", 1), message("streaming", 11)]);
    expect(f.onUpdate.mock.calls.map((call) => call[1])).toEqual(["streaming"]);
    f.stop();
    f.registry.dispose();
  });
  it("reads the first update in a newly created thread, including an initially empty environment", () => {
    const f = fixture([]);
    f.registry.set(f.shells, [{ ...shell("new", 15), createdAt: time(11) }]);
    f.update("new", [message("first update", 14)]);
    expect(f.onUpdate.mock.calls.map((call) => call[1])).toEqual(["first update"]);
    f.stop();
    f.registry.dispose();
  });
  it("keeps same-id threads in different environments independent and baselines a newly connected environment", () => {
    const f = fixture([shell("same", 10, true)]);
    f.registry.set(f.shells, [shell("same", 10, true), shell("same", 20, true, remote)]);
    f.update("same", [message("remote history", 18)], "live", remote);
    f.update("same", [message("local update", 11)]);
    f.update("same", [message("remote update", 21)], "live", remote);
    expect(f.onUpdate.mock.calls.map(([thread, text]) => [thread.environmentId, text])).toEqual([
      [environmentId, "local update"],
      [remote, "remote update"],
    ]);
    f.stop();
    f.registry.dispose();
  });
  it("coalesces reconnect batches, releases removed threads, and never follows updates after stop", () => {
    const f = fixture([shell("a", 10, true)]);
    f.update("a", [message("offline", 11)], "cached");
    f.update("a", [message("offline", 11), message("fresh", 12)]);
    expect(f.onUpdate.mock.calls.map((call) => call[1])).toEqual(["fresh"]);
    f.registry.set(f.shells, []);
    expect(f.onRemove).toHaveBeenCalledWith(
      narrationThreadKey({ environmentId, threadId: ThreadId.make("a") }),
    );
    f.update("a", [message("removed", 13)]);
    f.stop();
    f.registry.set(f.shells, [shell("b", 15, true)]);
    f.update("b", [message("stopped", 16)]);
    expect(f.onUpdate).toHaveBeenCalledTimes(1);
    f.registry.dispose();
  });
  it("does not replay an archived thread's history when it is restored", () => {
    const f = fixture([shell("active")]);
    f.registry.set(f.shells, [shell("active"), shell("restored", 15)]);
    f.update("restored", [message("old history", 8)]);
    expect(f.observed).not.toHaveBeenCalled();
    f.registry.set(f.shells, [shell("active"), shell("restored", 17)]);
    f.update("restored", [message("old history", 8), message("new after restore", 16)]);
    expect(f.onUpdate.mock.calls.map((call) => call[1])).toEqual(["new after restore"]);
    f.stop();
    f.registry.dispose();
  });
  it("reads the first update when an environment connected empty during narration", () => {
    const f = fixture([]);
    f.registry.set(f.shells, [{ ...shell("new remote", 15, false, remote), createdAt: time(11) }]);
    f.update("new remote", [message("new remote update", 14)], "live", remote);
    expect(f.onUpdate.mock.calls.map((call) => call[1])).toEqual(["new remote update"]);
    f.stop();
    f.registry.dispose();
  });
  it("takes a fresh baseline after stopping and restarting", () => {
    const f = fixture([shell("a", 10, true)]);
    f.update("a", [message("first", 11)]);
    f.stop();
    f.registry.set(f.shells, [shell("a", 20, true)]);
    f.update("a", [message("while stopped", 19)]);
    const stopAgain = f.start();
    f.update("a", [message("while stopped", 19), message("after restart", 21)]);
    expect(f.onUpdate.mock.calls.map((call) => call[1])).toEqual(["first", "after restart"]);
    stopAgain();
    f.registry.dispose();
  });
});
