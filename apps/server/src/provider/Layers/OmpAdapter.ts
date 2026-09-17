import {
  ProviderDriverKind,
  type OmpSettings,
  type ProviderRuntimeEvent,
  type ProviderSession,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { applyOmpAcpModelSelection, makeOmpAcpRuntime } from "../acp/OmpAcpSupport.ts";
import { makeCursorAdapter, type CursorAdapterLiveOptions } from "./CursorAdapter.ts";

const OMP = ProviderDriverKind.make("omp");
const CURSOR = ProviderDriverKind.make("cursor");

export interface OmpAdapterOptions extends Pick<
  CursorAdapterLiveOptions,
  | "environment"
  | "instanceId"
  | "nativeEventLogger"
  | "nativeEventLogPath"
  | "onSessionStarted"
  | "onConfigOptionsUpdated"
  | "onAvailableCommands"
> {}

function asOmpSession(session: ProviderSession): ProviderSession {
  return { ...session, provider: OMP };
}

function asOmpEvent(event: ProviderRuntimeEvent): ProviderRuntimeEvent {
  return { ...event, provider: OMP };
}

/** OMP is a standards-based ACP harness, so it shares the generic ACP adapter core. */
export const makeOmpAdapter = Effect.fn("makeOmpAdapter")(function* (
  settings: OmpSettings,
  options: OmpAdapterOptions,
) {
  const skillNamesByCwd = new Map<string, ReadonlySet<string>>();
  const adapter = yield* makeCursorAdapter(
    {
      enabled: settings.enabled,
      binaryPath: settings.binaryPath,
      apiEndpoint: "",
      customModels: settings.customModels,
    },
    {
      ...options,
      harnessName: "OMP",
      managedMcpProvider: OMP,
      rewriteCursorSkills: false,
      transformPrompt: (prompt, cwd) =>
        prompt.replace(/\$([a-zA-Z0-9_-]+)/g, (match, name: string) =>
          skillNamesByCwd.get(cwd)?.has(name) ? `/skill:${name}` : match,
        ),
      onAvailableCommands: (commands, cwd) => {
        skillNamesByCwd.set(
          cwd,
          new Set(
            commands
              .map((command) => command.name)
              .filter((name) => name.startsWith("skill:"))
              .map((name) => name.slice("skill:".length)),
          ),
        );
        return options.onAvailableCommands?.(commands, cwd) ?? Effect.void;
      },
      makeRuntime: (input) =>
        makeOmpAcpRuntime({
          ompSettings: settings,
          childProcessSpawner: input.childProcessSpawner,
          cwd: input.cwd,
          clientInfo: input.clientInfo,
          ...(input.environment ? { environment: input.environment } : {}),
          ...(input.runtimeMode ? { runtimeMode: input.runtimeMode } : {}),
          ...(input.resumeSessionId ? { resumeSessionId: input.resumeSessionId } : {}),
          ...(input.resumeMethod ? { resumeMethod: input.resumeMethod } : {}),
          ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
          ...(input.requestLogger ? { requestLogger: input.requestLogger } : {}),
          ...(input.protocolLogging ? { protocolLogging: input.protocolLogging } : {}),
          ...(input.onStderr ? { onStderr: input.onStderr } : {}),
        }),
      applyModelSelection: (input) => applyOmpAcpModelSelection(input),
    },
  );

  return {
    ...adapter,
    provider: OMP,
    compaction: { type: "slash-command", command: "/compact" },
    startSession: (input) =>
      adapter
        .startSession({ ...input, provider: input.provider === OMP ? CURSOR : input.provider })
        .pipe(Effect.map(asOmpSession)),
    listSessions: () =>
      adapter.listSessions().pipe(Effect.map((sessions) => sessions.map(asOmpSession))),
    streamEvents: adapter.streamEvents.pipe(Stream.map(asOmpEvent)),
  } satisfies ProviderAdapterShape<ProviderAdapterError>;
});
