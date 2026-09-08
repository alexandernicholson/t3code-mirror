import {
  SourceUpdateError,
  type SourceUpdateAction,
  type SourceUpdateSettings,
  type SourceUpdateStatus,
  type SourceUpdateTarget,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Stream from "effect/Stream";

export class SourceUpdates extends Context.Reference<{
  readonly current: Effect.Effect<SourceUpdateStatus>;
  readonly changes: Stream.Stream<SourceUpdateStatus>;
  readonly act: (
    action: SourceUpdateAction,
  ) => Effect.Effect<SourceUpdateStatus, SourceUpdateError>;
}>("t3/sourceUpdates/controller/SourceUpdates", {
  defaultValue: () => {
    const status: SourceUpdateStatus = {
      deferred: false,
      restartRequested: false,
      supported: false,
      running: null,
      phase: "idle",
      target: null,
      lastCheckedAt: null,
      message: null,
      updateId: null,
      outcome: null,
    };
    return {
      current: Effect.succeed(status),
      changes: Stream.make(status),
      act: () =>
        Effect.fail(
          new SourceUpdateError({ message: "Source updates are unavailable in this environment." }),
        ),
    };
  },
}) {}

interface SourceUpdateDriver {
  readonly settings: Effect.Effect<SourceUpdateSettings, SourceUpdateError>;
  readonly save: (status: SourceUpdateStatus) => Effect.Effect<void, SourceUpdateError>;
  readonly discover: (branch: string) => Effect.Effect<SourceUpdateTarget, SourceUpdateError>;
  readonly prepare: (target: SourceUpdateTarget) => Effect.Effect<void, SourceUpdateError>;
  readonly installed: (target: SourceUpdateTarget) => Effect.Effect<boolean, SourceUpdateError>;
  readonly activate: (
    target: SourceUpdateTarget,
    accepted: (id: string) => Effect.Effect<void, SourceUpdateError>,
  ) => Effect.Effect<boolean, SourceUpdateError>;
}

/** Single environment-owned operation, independent of the requesting RPC's lifetime. */
export const makeController = Effect.fn("SourceUpdates.makeController")(function* (
  initial: SourceUpdateStatus,
  driver: SourceUpdateDriver,
) {
  const state = yield* SubscriptionRef.make(initial);
  const busy = yield* Ref.make(false);
  const scope = yield* Scope.Scope;
  const update = Effect.fn("SourceUpdates.publish")(function* (patch: Partial<SourceUpdateStatus>) {
    const next = { ...(yield* SubscriptionRef.get(state)), ...patch };
    yield* driver.save(next);
    yield* SubscriptionRef.set(state, next);
    return next;
  });
  const activate = Effect.fn("SourceUpdates.activate")(function* (
    target: SourceUpdateTarget,
    requested = false,
  ) {
    const settings = yield* driver.settings;
    if (!settings.enabled || settings.branch !== target.branch) return;
    yield* update({
      phase: "waiting",
      restartRequested: requested,
      message: "Waiting for active agents and terminal commands to finish.",
    });
    yield* driver.activate(target, (id) =>
      update({
        phase: "restarting",
        updateId: id,
        outcome: null,
        message: "Restarting to apply the update.",
      }).pipe(Effect.asVoid),
    );
  });
  const prepare = Effect.fn("SourceUpdates.prepareCandidate")(function* (
    target: SourceUpdateTarget,
  ) {
    yield* update({
      target,
      phase: "building",
      deferred: false,
      restartRequested: false,
      message: null,
      outcome: null,
      updateId: null,
    });
    yield* driver.prepare(target);
    const settings = yield* driver.settings;
    if (settings.branch !== target.branch) {
      yield* update({ target: null, phase: "idle", message: null });
      return;
    }
    yield* update({ phase: "ready", message: null });
    if (settings.enabled && settings.policy === "automatic") yield* activate(target);
  });
  const check = Effect.fn("SourceUpdates.check")(function* () {
    const settings = yield* driver.settings;
    const previous = yield* SubscriptionRef.get(state);
    if (!settings.enabled) return;
    yield* update({ phase: "checking", message: null });
    const target = yield* driver.discover(settings.branch);
    const currentSettings = yield* driver.settings;
    if (currentSettings.branch !== settings.branch || !currentSettings.enabled) {
      yield* update({ phase: "idle", target: null });
      return;
    }
    const lastCheckedAt = DateTime.formatIso(yield* DateTime.now);
    if (target.commit === initial.running?.commit) {
      yield* update({
        phase: "idle",
        target: previous.outcome === "committed" ? previous.target : null,
        message: previous.outcome === "committed" ? previous.message : null,
        lastCheckedAt,
      });
      return;
    }
    // A failed or discarded commit stays suppressed through scheduled checks and reboots.
    if (
      previous.target?.commit === target.commit &&
      (previous.phase === "failed" || previous.deferred)
    ) {
      yield* update({ ...previous, target, lastCheckedAt });
      return;
    }
    yield* update({
      phase: "available",
      target,
      deferred: false,
      restartRequested: false,
      lastCheckedAt,
      message: null,
      outcome: null,
    });
    if (yield* driver.installed(target)) {
      yield* update({ phase: "ready" });
      if (currentSettings.policy === "automatic") yield* activate(target);
    } else if (currentSettings.policy !== "notify") {
      yield* prepare(target);
    }
  });
  const execute = Effect.fn("SourceUpdates.execute")(function* (
    action: SourceUpdateAction,
    requested: boolean,
  ) {
    const current = yield* SubscriptionRef.get(state);
    if (action.action === "check") return yield* check();
    if (!current.target || action.commit !== current.target.commit) {
      return yield* new SourceUpdateError({
        message: "The update target changed. Review the current version before continuing.",
      });
    }
    if (action.action === "discard") {
      yield* update({
        phase: "available",
        deferred: true,
        restartRequested: false,
        message: "This build is deferred. Choose Prepare update to try it again.",
      });
    } else if (action.action === "prepare") {
      yield* prepare(current.target);
    } else {
      if (!(yield* driver.installed(current.target)))
        return yield* new SourceUpdateError({ message: "Prepare this update before restarting." });
      yield* activate(current.target, requested || current.restartRequested);
    }
  });
  const start = Effect.fn("SourceUpdates.start")(function* (
    action: SourceUpdateAction,
    requested: boolean,
  ) {
    if (!initial.supported)
      return yield* new SourceUpdateError({
        message: "Install the fork's source service on the Linux host to enable updates.",
      });
    const current = yield* SubscriptionRef.get(state);
    if (action.action !== "check" && (!current.target || action.commit !== current.target.commit)) {
      return yield* new SourceUpdateError({
        message: "The update target changed. Review it before continuing.",
      });
    }
    if (yield* Ref.getAndSet(busy, true))
      return yield* new SourceUpdateError({ message: "An update operation is already running." });
    yield* execute(action, requested).pipe(
      Effect.catch((error) =>
        update({ phase: "failed", message: error.message }).pipe(
          Effect.asVoid,
          Effect.catch((saveError) =>
            SubscriptionRef.update(state, (current) => ({
              ...current,
              phase: "failed" as const,
              message: `${error.message} Update state could not be saved: ${saveError.message}`,
            })),
          ),
        ),
      ),
      Effect.ensuring(Ref.set(busy, false)),
      Effect.forkIn(scope),
    );
    return yield* SubscriptionRef.get(state);
  });
  const act = (action: SourceUpdateAction) => start(action, true);
  const tick = Effect.fn("SourceUpdates.tick")(function* (discover: boolean) {
    if (!initial.supported || (yield* Ref.get(busy))) return;
    const current = yield* SubscriptionRef.get(state);
    const settings = yield* driver.settings;
    if (!settings.enabled) return;
    if (current.target && current.target.branch !== settings.branch) {
      yield* start({ action: "check" }, false);
    } else if (
      current.target &&
      (settings.policy === "automatic" || current.restartRequested) &&
      (current.phase === "waiting" || current.phase === "ready")
    ) {
      yield* start({ action: "restart", commit: current.target.commit }, false);
    } else if (current.phase === "waiting" && !current.restartRequested) {
      yield* update({ phase: "ready", message: null });
    } else if (discover) {
      yield* start({ action: "check" }, false);
    }
  });
  return {
    restore: update,
    service: SourceUpdates.of({
      current: SubscriptionRef.get(state),
      changes: SubscriptionRef.changes(state),
      act,
    }),
    tick,
  };
});
