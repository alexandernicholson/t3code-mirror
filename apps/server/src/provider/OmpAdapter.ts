import { ProviderDriverKind, type OmpSettings } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { ChildProcessSpawner } from "effect/process";
import { resolveSelfInvocation } from "@t3tools/shared/nodeRuntime";
import {
  makeAcpAdapterV2,
  AcpProviderCapabilitiesV2,
} from "../orchestration-v2/Adapters/AcpAdapterV2.ts";
import * as IdAllocator from "../orchestration-v2/IdAllocator.ts";
import * as ServerConfig from "../config.ts";
import { applyOmpAcpModelSelection, makeOmpAcpRuntime } from "./acp/OmpAcpSupport.ts";
import { makeAcpNativeLoggerFactory } from "./acp/AcpNativeLogging.ts";
import type { makeOmpProvider } from "./OmpProvider.ts";
import type { ProviderInstanceId } from "@t3tools/contracts";
import type { ProviderEventLoggers } from "./ProviderEventLoggers.ts";

type OmpProvider = Effect.Success<ReturnType<typeof makeOmpProvider>>;
export interface OmpAdapterOptions {
  readonly instanceId: ProviderInstanceId;
  readonly environment: NodeJS.ProcessEnv;
  readonly nativeEventLogger?: Exclude<ProviderEventLoggers["Service"]["native"], undefined>;
  readonly onSessionStarted?: OmpProvider["onSessionStarted"];
  readonly onConfigOptionsUpdated?: OmpProvider["onConfigOptionsUpdated"];
  readonly onAvailableCommands?: OmpProvider["onAvailableCommands"];
}

/** OMP uses the common V2 ACP runtime with its native model and thinking configuration. */
export const makeOmpAdapter = Effect.fn("makeOmpAdapter")(function* (
  settings: OmpSettings,
  options: OmpAdapterOptions,
) {
  const skillNamesByCwd = new Map<string, ReadonlySet<string>>();
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const idAllocator = yield* IdAllocator.IdAllocatorV2;
  const serverConfig = yield* ServerConfig.ServerConfig;
  const selfInvocation = yield* resolveSelfInvocation();
  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const makeNativeLogger = yield* makeAcpNativeLoggerFactory();
  const driver = ProviderDriverKind.make("omp");
  return makeAcpAdapterV2({
    environment: options.environment,
    instanceId: options.instanceId,
    crypto,
    fileSystem,
    idAllocator,
    serverConfig,
    selfInvocation,
    nativeLogging: (threadId) =>
      makeNativeLogger({
        nativeEventLogger: options.nativeEventLogger,
        provider: driver,
        threadId,
      }),
    flavor: {
      driver,
      runtimeHarness: "OMP",
      capabilities: {
        ...AcpProviderCapabilitiesV2,
        sessions: { ...AcpProviderCapabilitiesV2.sessions, supportsModelSwitchInSession: true },
        tools: { ...AcpProviderCapabilitiesV2.tools, supportsMcpTools: true },
      },
      supportsCompaction: true,
      preferResumeSession: true,
      onSessionConfigurationUpdate: (configOptions) =>
        options.onConfigOptionsUpdated?.(configOptions) ?? Effect.void,
      transformPrompt: (prompt, cwd) =>
        prompt.replace(/\$([a-zA-Z0-9_-]+)/g, (match, name: string) =>
          skillNamesByCwd.get(cwd)?.has(name) ? `/skill:${name}` : match,
        ),
      onAvailableCommandsUpdate: (commands, cwd) => {
        skillNamesByCwd.set(
          cwd,
          new Set(
            commands
              .map((command) => command.name)
              .filter((name) => name.startsWith("skill:"))
              .map((name) => name.slice(6)),
          ),
        );
        return options.onAvailableCommands?.(commands) ?? Effect.void;
      },
      applyModelSelection: ({ runtime, modelSelection }) =>
        applyOmpAcpModelSelection({
          runtime,
          model: modelSelection.model,
          selections: modelSelection.options,
          mapError: (cause) => cause,
        }).pipe(Effect.as(modelSelection.model)),
      makeRuntime: ({ runtimePolicy, ...input }) =>
        makeOmpAcpRuntime({
          ...input,
          ompSettings: settings,
          childProcessSpawner,
          environment: options.environment,
          runtimeMode: runtimePolicy.runtimeMode,
        }).pipe(
          Effect.map((runtime) => ({
            ...runtime,
            start: () =>
              runtime
                .start()
                .pipe(
                  Effect.tap(
                    (started) => options.onSessionStarted?.(started, input.cwd) ?? Effect.void,
                  ),
                ),
          })),
        ),
    },
  });
});
