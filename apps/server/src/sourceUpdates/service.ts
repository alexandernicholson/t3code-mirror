import { SourceUpdateStatus, type SourceBuild } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";
import { parseChangelog } from "@t3tools/shared/changelog";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as ProcessRunner from "../processRunner.ts";
import { ServerConfig } from "../config.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { ServiceLauncherClient } from "../cloud/serviceLauncherClient.ts";
import { parseServiceState, SERVICE_STATE_FILE } from "../cloud/serviceProtocol.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { CheckpointReactor } from "../orchestration/Services/CheckpointReactor.ts";
import { ProviderCommandReactor } from "../orchestration/Services/ProviderCommandReactor.ts";
import { ProviderRuntimeIngestionService } from "../orchestration/Services/ProviderRuntimeIngestion.ts";
import { TerminalManager } from "../terminal/Manager.ts";
import { forkParked } from "../serverActivation.ts";
import { recoverSourceUpdate } from "./recovery.ts";
import { sourceBuild } from "./build.ts";
import { SourceUpdateGate } from "./gate.ts";
import { makeController, SourceUpdates } from "./controller.ts";
import { makeSourceRuntime, sourceUpdateFailure, writeSourceState } from "./runtime.ts";

function initialSourceUpdateStatus(
  running: SourceBuild | null,
  supported: boolean,
): SourceUpdateStatus {
  return {
    deferred: false,
    restartRequested: false,
    supported,
    running,
    phase: "idle",
    target: null,
    lastCheckedAt: null,
    message: null,
    updateId: null,
    outcome: null,
  };
}

export const layer = Layer.effect(
  SourceUpdates,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const platform = yield* HostProcessPlatform;
    const launcher = yield* ServiceLauncherClient;
    const settingsService = yield* ServerSettingsService;
    const engine = yield* OrchestrationEngineService;
    const projection = yield* ProjectionSnapshotQuery;
    const checkpoints = yield* CheckpointReactor;
    const commands = yield* ProviderCommandReactor;
    const ingestion = yield* ProviderRuntimeIngestionService;
    const terminals = yield* TerminalManager;
    const gate = yield* SourceUpdateGate;
    const supported =
      sourceBuild !== null && platform === "linux" && launcher.managed && config.mode !== "desktop";
    if (!supported || sourceBuild === null) {
      const status = initialSourceUpdateStatus(sourceBuild, false);
      return SourceUpdates.of({
        current: Effect.succeed(status),
        changes: Stream.make(status),
        act: () =>
          Effect.fail(
            sourceUpdateFailure(
              new Error("Source updates require the fork's Linux source service."),
            ),
          ),
      });
    }
    const running = sourceBuild;
    const runtime = yield* makeSourceRuntime(running);
    const statePath = path.join(config.baseDir, "runtime/source-update.json");
    const installedNotes = yield* fs
      .readFileString(
        path.join(config.baseDir, "runtime/versions", running.runtimeVersion, "CHANGELOG.md"),
      )
      .pipe(
        Effect.flatMap((contents) =>
          Effect.try(() => {
            const release = parseChangelog(contents).find(
              (entry) => entry.version === running.version,
            );
            return release
              ? `## [${release.version}] - ${release.date}\n\n${release.markdown}`
              : "";
          }),
        ),
        Effect.orElseSucceed(() => ""),
      );
    let initial = initialSourceUpdateStatus(sourceBuild, true);
    if (yield* fs.exists(statePath)) {
      const restored = yield* fs.readFileString(statePath).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(fromJsonStringPretty(SourceUpdateStatus))),
        Effect.catch(() =>
          Effect.succeed({
            ...initial,
            phase: "failed" as const,
            message: "Update state could not be read. Check for updates to recover.",
          }),
        ),
      );
      initial = { ...restored, running: sourceBuild, supported: true };
      if (initial.phase === "building" || initial.phase === "checking") {
        initial = {
          ...initial,
          phase: "failed",
          message: "The previous update was interrupted. Prepare the update to retry.",
        };
      }
    }
    initial = { ...initial, installedNotes };
    const settings = settingsService.getSettings.pipe(
      Effect.map((value) => value.sourceUpdates),
      Effect.mapError(sourceUpdateFailure),
    );
    const controller = yield* makeController(initial, {
      ...runtime,
      settings,
      save: (status) =>
        Schema.encodeUnknownEffect(fromJsonStringPretty(SourceUpdateStatus))(status).pipe(
          Effect.mapError(sourceUpdateFailure),
          Effect.flatMap((contents) =>
            writeSourceState(statePath, contents).pipe(
              Effect.provideService(FileSystem.FileSystem, fs),
              Effect.provideService(Path.Path, path),
            ),
          ),
        ),
      activate: (target, accepted) =>
        Effect.gen(function* () {
          // Drain queued side effects before taking the same permit used by every dispatch transport.
          yield* commands.drain;
          yield* ingestion.drain;
          yield* checkpoints.drain;
          return yield* gate.withPermit(
            Effect.gen(function* () {
              const currentSettings = yield* settings;
              if (!currentSettings.enabled || currentSettings.branch !== target.branch)
                return false;
              const snapshot = yield* projection.getShellSnapshot();
              if (
                snapshot.threads.some(
                  (thread) =>
                    thread.latestTurn?.state === "running" ||
                    thread.backgroundLiveness != null ||
                    thread.session?.status === "starting" ||
                    thread.session?.status === "running" ||
                    thread.session?.activeTurnId != null,
                )
              )
                return false;
              if (yield* terminals.hasRunningJobs ?? Effect.succeed(true)) return false;
              const id = yield* launcher.requestUpdate({
                targetVersion: target.runtimeVersion,
                dbPath: config.dbPath,
                sourceUpdate: true,
              });
              yield* accepted(id);
              // Keep new dispatches parked until this process exits; the launcher already owns recovery.
              return yield* Effect.never;
            }),
          );
        }).pipe(Effect.mapError(sourceUpdateFailure)),
    });
    yield* forkParked(
      Effect.gen(function* () {
        // The trial's migrations and durable launcher commit have finished before this root activates.
        const text = yield* fs.readFileString(
          path.join(config.baseDir, "runtime", SERVICE_STATE_FILE),
        );
        const serviceState = parseServiceState(text);
        const outcome = serviceState?.update;
        const recovered = recoverSourceUpdate(initial, running, outcome);
        if (recovered !== initial) yield* controller.restore(recovered);
        const current = yield* controller.service.current;
        if (
          (current.phase === "ready" || current.phase === "waiting") &&
          current.target &&
          !(yield* runtime.installed(current.target))
        ) {
          yield* controller.restore({
            phase: "failed",
            message: "The prepared runtime is missing. Prepare this update again.",
            restartRequested: false,
          });
        }
        yield* runtime
          .cleanup([
            running.runtimeVersion,
            ...(outcome ? [outcome.fromVersion, outcome.targetVersion] : []),
            ...(current.target ? [current.target.runtimeVersion] : []),
          ])
          .pipe(Effect.ignore);
        const events = yield* engine.subscribeDomainEvents;
        yield* events.pipe(
          Stream.debounce("250 millis"),
          Stream.runForEach(() => controller.tick(false).pipe(Effect.ignore)),
          Effect.forkScoped,
        );
        yield* Effect.acquireRelease(
          terminals.subscribeMetadata(() =>
            controller.tick(false).pipe(Effect.ignore, Effect.asVoid),
          ),
          (unsubscribe) => Effect.sync(unsubscribe),
        );
        yield* settingsService.streamChanges.pipe(
          Stream.runForEach(() => controller.tick(true).pipe(Effect.ignore)),
          Effect.forkScoped,
        );
        yield* controller.tick(true).pipe(Effect.ignore);
        return yield* Effect.forever(
          Effect.sleep("15 minutes").pipe(Effect.andThen(controller.tick(true)), Effect.ignore),
        );
      }).pipe(Effect.catch((error) => Effect.logError("Source update scheduler stopped", error))),
    );
    return controller.service;
  }),
).pipe(Layer.provide(ProcessRunner.layer));
