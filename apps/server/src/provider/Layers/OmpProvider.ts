import {
  ProviderDriverKind,
  type OmpSettings,
  type ServerProvider,
  type ServerProviderModel,
  type ServerProviderSkill,
  type ServerProviderSlashCommand,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import type * as EffectAcpSchema from "effect-acp/schema";

import type { AcpSessionRuntimeStartResult } from "../acp/AcpSessionRuntime.ts";
import { ompModelsFromConfigOptions } from "../acp/OmpAcpSupport.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  makeManualOnlyProviderMaintenanceCapabilities,
  type ProviderMaintenanceCapabilities,
} from "../providerMaintenance.ts";
import {
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";

const OMP = ProviderDriverKind.make("omp");
const EMPTY_CAPABILITIES = createModelCapabilities({ optionDescriptors: [] });
const ModelListing = Schema.Struct({
  models: Schema.Array(
    Schema.Struct({
      selector: Schema.String,
      name: Schema.String,
      reasoning: Schema.Boolean,
      thinking: Schema.NullOr(Schema.Array(Schema.String)),
    }),
  ),
});
const decodeModelListingJson = Schema.decodeUnknownOption(Schema.fromJsonString(ModelListing));
const OMP_PRESENTATION = {
  displayName: "Oh My Pi",
  badgeLabel: "Early Access",
  showInteractionModeToggle: true,
  supportsConversationRollback: false,
} as const;

export function parseOmpModelsJson(raw: string): ReadonlyArray<ServerProviderModel> {
  const parsed = decodeModelListingJson(raw);
  if (Option.isNone(parsed)) return [];
  return parsed.value.models.map((model) => ({
    slug: model.selector,
    name: model.name || model.selector,
    isCustom: false,
    capabilities: createModelCapabilities({
      optionDescriptors:
        model.reasoning && model.thinking && model.thinking.length > 0
          ? [
              {
                id: "reasoningEffort",
                label: "Thinking",
                type: "select" as const,
                options: model.thinking.map((effort) => ({ id: effort, label: effort })),
              },
            ]
          : [],
    }),
  }));
}

function nativeCommands(
  commands: ReadonlyArray<EffectAcpSchema.AvailableCommand>,
): ReadonlyArray<ServerProviderSlashCommand> {
  return commands.map((command) => ({
    name: command.name,
    ...(command.description.trim() ? { description: command.description.trim() } : {}),
    ...(command.input?.hint.trim() ? { input: { hint: command.input.hint.trim() } } : {}),
  }));
}

function nativeSkills(
  commands: ReadonlyArray<EffectAcpSchema.AvailableCommand>,
): ReadonlyArray<ServerProviderSkill> {
  return commands.flatMap((command) => {
    if (!command.name.startsWith("skill:")) return [];
    const name = command.name.slice("skill:".length).trim();
    if (!name) return [];
    return [
      {
        name,
        displayName: name,
        ...(command.description.trim() ? { description: command.description.trim() } : {}),
        path: `acp://skill/${name}`,
        scope: "omp",
        enabled: true,
        userInvocable: true,
      },
    ];
  });
}

export const makeOmpProvider = Effect.fn("makeOmpProvider")(function* (input: {
  readonly settings: OmpSettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly stampIdentity: (draft: ServerProviderDraft) => ServerProvider;
  readonly maintenanceCapabilities?: ProviderMaintenanceCapabilities;
}) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const initialModels = providerModelsFromSettings(
    [],
    input.settings.customModels,
    EMPTY_CAPABILITIES,
  );
  const initial = buildServerProvider({
    presentation: OMP_PRESENTATION,
    enabled: input.settings.enabled,
    checkedAt,
    models: initialModels,
    probe: {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: input.settings.enabled
        ? "Checking OMP availability."
        : "OMP is disabled in T3 Code settings.",
    },
  });
  const initialWithWorkspaces: ServerProviderDraft = {
    ...initial,
    supportsTextGeneration: true,
    workspaceSnapshots: [],
  };
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const metadata = yield* SubscriptionRef.make<ServerProviderDraft>(initialWithWorkspaces);
  const getSnapshot = SubscriptionRef.get(metadata).pipe(Effect.map(input.stampIdentity));

  const runOmp = (args: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      const command = yield* resolveSpawnCommand(input.settings.binaryPath, args, {
        env: input.environment,
      });
      return yield* spawnAndCollect(
        input.settings.binaryPath,
        ChildProcess.make(command.command, command.args, {
          cwd: input.cwd,
          env: input.environment,
          shell: command.shell,
        }),
      );
    }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));

  const checkProvider = Effect.gen(function* () {
    if (!input.settings.enabled) return yield* getSnapshot;
    const versionResult = yield* runOmp(["--version"]).pipe(
      Effect.timeoutOption("5 seconds"),
      Effect.result,
    );
    const versionOutput =
      Result.isSuccess(versionResult) && Option.isSome(versionResult.success)
        ? versionResult.success.value
        : undefined;
    const missing = Result.isFailure(versionResult) && isCommandMissingCause(versionResult.failure);
    let models = initialModels;
    if (versionOutput?.code === 0) {
      const listed = yield* runOmp(["models", "--json"]).pipe(
        Effect.timeoutOption("20 seconds"),
        Effect.result,
      );
      const listedOutput =
        Result.isSuccess(listed) && Option.isSome(listed.success)
          ? listed.success.value
          : undefined;
      if (listedOutput?.code === 0) {
        models = providerModelsFromSettings(
          parseOmpModelsJson(listedOutput.stdout),
          input.settings.customModels,
          EMPTY_CAPABILITIES,
        );
      }
    }
    const now = DateTime.formatIso(yield* DateTime.now);
    const previous = yield* SubscriptionRef.get(metadata);
    const draft = {
      ...buildServerProvider({
        presentation: OMP_PRESENTATION,
        enabled: input.settings.enabled,
        checkedAt: now,
        models,
        slashCommands: previous.slashCommands,
        skills: previous.skills,
        probe: {
          installed: !missing,
          version: versionOutput
            ? parseGenericCliVersion(`${versionOutput.stdout}\n${versionOutput.stderr}`)
            : null,
          status: versionOutput?.code === 0 ? "ready" : "error",
          auth: { status: "unknown" },
          ...(versionOutput?.code === 0
            ? {}
            : {
                message: missing
                  ? "OMP (`omp`) is not installed or not on PATH."
                  : "OMP is installed but failed its local health check.",
              }),
        },
      }),
      supportsTextGeneration: true,
      workspaceSnapshots: previous.workspaceSnapshots ?? [],
    } satisfies ServerProviderDraft;
    yield* SubscriptionRef.set(metadata, draft);
    return input.stampIdentity(draft);
  });

  const maintenance =
    input.maintenanceCapabilities ??
    makeManualOnlyProviderMaintenanceCapabilities({
      provider: OMP,
      packageName: "@oh-my-pi/pi-coding-agent",
    });
  const managed = yield* makeManagedServerProvider({
    resolveMaintenance: () => Effect.succeed(maintenance),
    getSettings: Effect.succeed(input.settings),
    streamSettings: Stream.empty,
    haveSettingsChanged: () => false,
    initialSnapshot: () => getSnapshot,
    checkProvider,
    enrichSnapshot: ({ publishSnapshot }) =>
      SubscriptionRef.changes(metadata).pipe(
        Stream.runForEach((draft) => publishSnapshot(input.stampIdentity(draft))),
      ),
  });

  const onSessionStarted = Effect.fn("OmpProvider.onSessionStarted")(function* (
    started: AcpSessionRuntimeStartResult,
    cwd?: string,
  ) {
    const models = ompModelsFromConfigOptions(started.sessionSetupResult.configOptions ?? []);
    const updatedAt = DateTime.formatIso(yield* DateTime.now);
    yield* SubscriptionRef.update(
      metadata,
      (draft) =>
        ({
          ...draft,
          installed: true,
          version: started.initializeResult.agentInfo?.version ?? draft.version,
          status: "ready",
          auth: { status: "authenticated", type: "local", label: "OMP credentials" },
          ...(models.length > 0
            ? {
                models: providerModelsFromSettings(
                  models,
                  input.settings.customModels,
                  EMPTY_CAPABILITIES,
                ),
              }
            : {}),
          ...(cwd
            ? {
                workspaceSnapshots: [
                  ...(draft.workspaceSnapshots ?? []).filter((entry) => entry.cwd !== cwd),
                  {
                    cwd,
                    checkedAt: updatedAt,
                    slashCommands:
                      draft.workspaceSnapshots?.find((entry) => entry.cwd === cwd)?.slashCommands ??
                      [],
                    skills:
                      draft.workspaceSnapshots?.find((entry) => entry.cwd === cwd)?.skills ?? [],
                  },
                ].slice(-32),
              }
            : {}),
        }) satisfies ServerProviderDraft,
    );
  });

  const onConfigOptionsUpdated = (options: ReadonlyArray<EffectAcpSchema.SessionConfigOption>) => {
    const models = ompModelsFromConfigOptions(options);
    return models.length === 0
      ? Effect.void
      : SubscriptionRef.update(metadata, (draft) => ({
          ...draft,
          models: providerModelsFromSettings(
            models,
            input.settings.customModels,
            EMPTY_CAPABILITIES,
          ),
        }));
  };
  const onAvailableCommands = (
    commands: ReadonlyArray<EffectAcpSchema.AvailableCommand>,
    cwd?: string,
  ) =>
    Effect.gen(function* () {
      const updatedAt = DateTime.formatIso(yield* DateTime.now);
      yield* SubscriptionRef.update(metadata, (draft) => ({
        ...draft,
        slashCommands: nativeCommands(commands),
        skills: nativeSkills(commands),
        ...(cwd
          ? {
              workspaceSnapshots: [
                ...(draft.workspaceSnapshots ?? []).filter((entry) => entry.cwd !== cwd),
                {
                  cwd,
                  checkedAt: updatedAt,
                  slashCommands: nativeCommands(commands),
                  skills: nativeSkills(commands),
                },
              ].slice(-32),
            }
          : {}),
      }));
    });

  const snapshotForCwd = (cwd: string) =>
    getSnapshot.pipe(
      Effect.map((snapshot) => {
        const workspace = snapshot.workspaceSnapshots?.find((entry) => entry.cwd === cwd);
        return workspace
          ? { ...snapshot, slashCommands: workspace.slashCommands, skills: workspace.skills }
          : snapshot;
      }),
    );

  return {
    snapshot: { ...managed, getSnapshot },
    onSessionStarted,
    onConfigOptionsUpdated,
    onAvailableCommands,
    snapshotForCwd,
  };
});
