import { expect, it } from "@effect/vitest";
import {
  SourceUpdateError,
  type SourceUpdateSettings,
  type SourceUpdateStatus,
  type SourceUpdateTarget,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { makeController } from "./controller.ts";

const target: SourceUpdateTarget = {
  version: "0.1.1",
  runtimeVersion: `0.1.1+git.${"b".repeat(40)}`,
  commit: "b".repeat(40),
  branch: "main",
  notes: "Fixed things.",
  divergent: false,
};
const initial: SourceUpdateStatus = {
  deferred: false,
  restartRequested: false,
  supported: true,
  running: {
    version: "0.1.0",
    runtimeVersion: `0.1.0+git.${"a".repeat(40)}`,
    commit: "a".repeat(40),
    branch: "main",
  },
  phase: "idle",
  target: null,
  lastCheckedAt: null,
  message: null,
  updateId: null,
  outcome: null,
};

const harness = Effect.fn("test.sourceUpdates.harness")(function* (
  options: {
    policy?: SourceUpdateSettings["policy"];
    initial?: SourceUpdateStatus;
    prepare?: Effect.Effect<void, SourceUpdateError>;
    idle?: boolean;
  } = {},
) {
  const settings = yield* Ref.make<SourceUpdateSettings>({
    enabled: true,
    policy: options.policy ?? "automatic",
    branch: "main",
  });
  const receipts = yield* Queue.unbounded<SourceUpdateStatus>();
  const installed = yield* Ref.make(options.initial?.phase === "ready");
  const idle = yield* Ref.make(options.idle ?? true);
  const builds = yield* Ref.make(0);
  const activations = yield* Ref.make(0);
  const controller = yield* makeController(options.initial ?? initial, {
    settings: Ref.get(settings),
    save: (status) => Queue.offer(receipts, status).pipe(Effect.asVoid),
    discover: (branch) => Effect.succeed({ ...target, branch }),
    installed: () => Ref.get(installed),
    prepare: () =>
      Ref.update(builds, (n) => n + 1).pipe(
        Effect.andThen(options.prepare ?? Effect.void),
        Effect.andThen(Ref.set(installed, true)),
      ),
    activate: (_target, accepted) =>
      Effect.gen(function* () {
        if (!(yield* Ref.get(idle))) return false;
        yield* Ref.update(activations, (n) => n + 1);
        yield* accepted("update-1");
        return true;
      }),
  });
  const until = (phase: SourceUpdateStatus["phase"]) =>
    Stream.fromQueue(receipts).pipe(
      Stream.filter((status) => status.phase === phase),
      Stream.take(1),
      Stream.runCollect,
    );
  return { ...controller, settings, installed, idle, builds, activations, until };
});

it.effect("automatically stages and hands off exactly the discovered commit", () =>
  Effect.gen(function* () {
    const h = yield* harness();
    yield* h.service.act({ action: "check" });
    const [receipt] = yield* h.until("restarting");
    expect(receipt?.target?.commit).toBe(target.commit);
    expect(receipt?.updateId).toBe("update-1");
    expect(yield* Ref.get(h.builds)).toBe(1);
    expect(yield* Ref.get(h.activations)).toBe(1);
  }),
);

it.effect("manual restart prepares without activating and rejects a stale target", () =>
  Effect.gen(function* () {
    const h = yield* harness({ policy: "manual-restart" as const });
    yield* h.service.act({ action: "check" });
    yield* h.until("ready");
    expect(yield* Ref.get(h.activations)).toBe(0);
    const error = yield* h.service
      .act({ action: "restart", commit: "c".repeat(40) })
      .pipe(Effect.flip);
    expect(error.message).toContain("target changed");
    yield* h.service.act({ action: "restart", commit: target.commit });
    yield* h.until("restarting");
    expect(yield* Ref.get(h.builds)).toBe(1);
  }),
);

it.effect("waits for an idle event, and honors changing to manual restart while waiting", () =>
  Effect.gen(function* () {
    const h = yield* harness({ initial: { ...initial, phase: "ready", target }, idle: false });
    yield* h.tick(false);
    yield* h.until("waiting");
    expect(yield* Ref.get(h.activations)).toBe(0);
    yield* Ref.update(h.settings, (settings) => ({
      ...settings,
      policy: "manual-restart" as const,
    }));
    yield* Ref.set(h.idle, true);
    yield* h.tick(false);
    yield* h.until("ready");
    expect(yield* Ref.get(h.activations)).toBe(0);
  }),
);

it.effect("does not repeatedly rebuild a failed commit; an explicit prepare retries it", () =>
  Effect.gen(function* () {
    const h = yield* harness({
      initial: { ...initial, phase: "failed", target, message: "Build failed" },
      policy: "manual-restart" as const,
    });
    yield* h.service.act({ action: "check" });
    yield* h.until("failed");
    expect(yield* Ref.get(h.builds)).toBe(0);
    yield* h.service.act({ action: "prepare", commit: target.commit });
    yield* h.until("ready");
    expect(yield* Ref.get(h.builds)).toBe(1);
  }),
);

it.effect("a policy change during a build leaves the prepared runtime awaiting restart", () =>
  Effect.gen(function* () {
    const built = yield* Deferred.make<void>();
    const h = yield* harness({ prepare: Deferred.await(built) });
    yield* h.service.act({ action: "check" });
    yield* h.until("building");
    yield* Ref.update(h.settings, (settings) => ({
      ...settings,
      policy: "manual-restart" as const,
    }));
    const concurrent = yield* h.service.act({ action: "check" }).pipe(Effect.flip);
    expect(concurrent.message).toContain("already running");
    yield* Deferred.succeed(built, undefined);
    yield* h.until("ready");
    expect(yield* Ref.get(h.activations)).toBe(0);
  }),
);

it.effect("never activates a build from a branch deselected while it was building", () =>
  Effect.gen(function* () {
    const built = yield* Deferred.make<void>();
    const h = yield* harness({ prepare: Deferred.await(built) });
    yield* h.service.act({ action: "check" });
    yield* h.until("building");
    yield* Ref.update(h.settings, (settings) => ({ ...settings, branch: "experiment" }));
    yield* Deferred.succeed(built, undefined);
    yield* h.until("idle");
    expect((yield* h.service.current).target).toBeNull();
    expect(yield* Ref.get(h.activations)).toBe(0);
  }),
);
