import type {
  OmpSettings,
  ProviderOptionSelection,
  RuntimeMode,
  ServerProviderModel,
} from "@t3tools/contracts";
import { tokenizeCliArgs } from "@t3tools/shared/cliArgs";
import {
  createModelCapabilities,
  getProviderOptionStringSelectionValue,
} from "@t3tools/shared/model";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

type OmpRuntimeSettings = Pick<OmpSettings, "binaryPath" | "launchArgs">;

export function buildOmpAcpSpawnInput(
  settings: OmpRuntimeSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
  runtimeMode?: RuntimeMode,
): AcpSessionRuntime.AcpSpawnInput {
  const approvalArgs =
    runtimeMode === "full-access"
      ? ["--approval-mode", "yolo"]
      : runtimeMode === undefined
        ? []
        : ["--approval-mode", runtimeMode === "auto-accept-edits" ? "write" : "always-ask"];
  return {
    command: settings?.binaryPath || "omp",
    // Runtime mode is authoritative for this session, so its override follows
    // user launch arguments when OMP resolves repeated flags.
    args: ["acp", ...tokenizeCliArgs(settings?.launchArgs), ...approvalArgs],
    cwd,
    ...(environment ? { env: environment } : {}),
  };
}

export interface OmpAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly ompSettings: OmpRuntimeSettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
  readonly runtimeMode?: RuntimeMode;
}

export const makeOmpAcpRuntime = (
  input: OmpAcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildOmpAcpSpawnInput(
          input.ompSettings,
          input.cwd,
          input.environment,
          input.runtimeMode,
        ),
        authMethodId: "agent",
        clientCapabilities: { elicitation: { form: {} } },
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(Effect.provide(context));
  });

function selectOptions(option: EffectAcpSchema.SessionConfigOption | undefined): ReadonlyArray<{
  readonly value: string;
  readonly name: string;
  readonly description?: string | null;
}> {
  if (option?.type !== "select") return [];
  return option.options.flatMap((entry) => ("value" in entry ? [entry] : entry.options));
}

export function ompModelsFromConfigOptions(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
): ReadonlyArray<ServerProviderModel> {
  const modelOption = configOptions.find(
    (option) => option.id === "model" || option.category === "model",
  );
  const thinkingOption = configOptions.find(
    (option) => option.id === "thinking" || option.category === "thought_level",
  );
  const currentModel = modelOption?.type === "select" ? modelOption.currentValue : undefined;
  const currentThinking =
    thinkingOption?.type === "select" ? thinkingOption.currentValue : undefined;
  const thinkingChoices = selectOptions(thinkingOption);
  const capabilities = createModelCapabilities({
    optionDescriptors:
      thinkingChoices.length === 0
        ? []
        : [
            {
              id: "reasoningEffort",
              label: thinkingOption?.name || "Thinking",
              type: "select" as const,
              ...(currentThinking ? { currentValue: currentThinking } : {}),
              options: thinkingChoices.map((choice) => ({
                id: choice.value,
                label: choice.name || choice.value,
                ...(choice.description ? { description: choice.description } : {}),
                ...(choice.value === currentThinking ? { isDefault: true } : {}),
              })),
            },
          ],
  });

  return selectOptions(modelOption).map((model) => ({
    slug: model.value,
    name: model.name || model.value,
    isCustom: false,
    ...(model.value === currentModel ? { isDefault: true } : {}),
    capabilities,
  }));
}

type OmpModelRuntime = Pick<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  "getConfigOptions" | "setConfigOption"
>;

export function applyOmpAcpModelSelection<E>(input: {
  readonly runtime: OmpModelRuntime;
  readonly model: string | null | undefined;
  readonly selections: ReadonlyArray<ProviderOptionSelection> | null | undefined;
  readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
}): Effect.Effect<void, E> {
  return Effect.gen(function* () {
    const options = yield* input.runtime.getConfigOptions;
    const modelOption = options.find(
      (option) => option.id === "model" || option.category === "model",
    );
    const thinkingOption = options.find(
      (option) => option.id === "thinking" || option.category === "thought_level",
    );
    if (input.model && modelOption) {
      yield* input.runtime
        .setConfigOption(modelOption.id, input.model)
        .pipe(Effect.mapError(input.mapError));
    }
    const reasoning = getProviderOptionStringSelectionValue(input.selections, "reasoningEffort");
    if (reasoning && thinkingOption) {
      yield* input.runtime
        .setConfigOption(thinkingOption.id, reasoning)
        .pipe(Effect.mapError(input.mapError));
    }
  });
}
