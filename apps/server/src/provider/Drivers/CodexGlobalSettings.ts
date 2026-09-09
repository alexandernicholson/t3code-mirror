import {
  ProviderGlobalSettingValue,
  ProviderGlobalSettingsError,
  type ProviderGlobalSetting,
  type ProviderGlobalSettings,
  type ProviderGlobalSettingsWriteInput,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { CodexAppServerClient } from "effect-codex-app-server/client";
import type * as CodexSchema from "effect-codex-app-server/schema";

const JsonObject = Schema.Record(Schema.String, Schema.Json);
const decodeJsonObject = Schema.decodeUnknownEffect(JsonObject);
const readScalar = Schema.decodeUnknownOption(ProviderGlobalSettingValue);

const fields = [
  {
    key: "web_search",
    title: "Web search",
    description: "Choose whether Codex can search the web and which results it uses.",
    control: "select",
    options: [
      { value: "disabled", label: "Disabled" },
      { value: "cached", label: "Cached" },
      { value: "live", label: "Live" },
    ],
  },
  {
    key: "model_verbosity",
    title: "Response verbosity",
    description: "How much detail Codex includes in its responses, for models that support it.",
    control: "select",
    options: [
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ],
  },
  {
    key: "personality",
    title: "Personality",
    description: "The communication style Codex uses.",
    control: "select",
    options: [
      { value: "none", label: "None" },
      { value: "friendly", label: "Friendly" },
      { value: "pragmatic", label: "Pragmatic" },
    ],
  },
  {
    key: "model_context_window",
    title: "Context window",
    description:
      "Override the model's context window in tokens. Leave unset to use the model default.",
    control: "number",
  },
  {
    key: "model_auto_compact_token_limit",
    title: "Auto-compact after",
    description:
      "Compact conversation history after this many tokens. Leave unset to use the model default.",
    control: "number",
  },
] as const satisfies ReadonlyArray<Omit<ProviderGlobalSetting, "value" | "effectiveValue">>;

function layerLabel(source: CodexSchema.V2ConfigReadResponse__ConfigLayerSource): string {
  switch (source.type) {
    case "user":
    case "system":
    case "legacyManagedConfigTomlFromFile":
      return source.file;
    case "project":
      return source.dotCodexFolder;
    case "sessionFlags":
      return "Launch arguments";
    case "enterpriseManaged":
      return `${source.name} (managed)`;
    case "mdm":
    case "legacyManagedConfigTomlFromMdm":
      return "Managed policy";
  }
}

/** Only the user layer is editable; effective values may include launch or managed overrides. */
export const readCodexGlobalSettings = Effect.fn("readCodexGlobalSettings")(function* (
  client: Pick<CodexAppServerClient["Service"], "request">,
  instanceId: ProviderInstanceId,
) {
  const response = yield* client.request("config/read", { includeLayers: true });
  const userLayer = response.layers?.find((layer) => layer.name.type === "user");
  if (!userLayer || userLayer.name.type !== "user") {
    return yield* new ProviderGlobalSettingsError({
      instanceId,
      detail: "Codex did not return a user configuration file. Update Codex and try again.",
    });
  }
  const userConfig = yield* decodeJsonObject(userLayer.config);
  const effectiveConfig = yield* decodeJsonObject(response.config);
  const origins = Object.fromEntries(
    Object.entries(response.origins).map(([key, origin]) => [key, layerLabel(origin.name)]),
  );
  return {
    filePath: userLayer.name.file,
    version: userLayer.version,
    userConfig,
    effectiveConfig,
    origins,
    fields: fields.map((field) => {
      const origin = response.origins[field.key];
      return {
        ...field,
        value: Option.getOrNull(readScalar(userConfig[field.key])),
        effectiveValue: Option.getOrNull(readScalar(effectiveConfig[field.key])),
        ...(origin && origin.name.type !== "user" ? { overriddenBy: layerLabel(origin.name) } : {}),
      };
    }),
  } satisfies ProviderGlobalSettings;
});

/** Let Codex preserve TOML comments and unrelated keys, and enforce its optimistic version check. */
export const writeCodexGlobalSettings = Effect.fn("writeCodexGlobalSettings")(function* (
  client: Pick<CodexAppServerClient["Service"], "request">,
  input: ProviderGlobalSettingsWriteInput,
) {
  const current = yield* readCodexGlobalSettings(client, input.instanceId);
  if (current.filePath !== input.filePath || current.version !== input.expectedVersion) {
    return yield* new ProviderGlobalSettingsError({
      instanceId: input.instanceId,
      detail: "The provider configuration changed. Reload it before saving your changes.",
    });
  }
  yield* client.request("config/batchWrite", {
    filePath: current.filePath,
    expectedVersion: input.expectedVersion,
    edits: input.edits.map(({ key, value }) => ({ keyPath: key, value, mergeStrategy: "replace" })),
  });
  return yield* readCodexGlobalSettings(client, input.instanceId);
});
