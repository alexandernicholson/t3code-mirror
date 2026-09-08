import * as Schema from "effect/Schema";

import { ProviderInstanceId } from "./providerInstance.ts";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const ProviderGlobalSettingValue = Schema.NullOr(
  Schema.Union([Schema.String, Schema.Number, Schema.Boolean]),
);
export type ProviderGlobalSettingValue = typeof ProviderGlobalSettingValue.Type;

export const ProviderGlobalSetting = Schema.Struct({
  key: TrimmedNonEmptyString,
  title: Schema.String,
  description: Schema.String,
  control: Schema.Literals(["text", "number", "select"]),
  options: Schema.optionalKey(
    Schema.Array(Schema.Struct({ value: Schema.String, label: Schema.String })),
  ),
  value: ProviderGlobalSettingValue,
  effectiveValue: ProviderGlobalSettingValue,
  overriddenBy: Schema.optionalKey(Schema.String),
});
export type ProviderGlobalSetting = typeof ProviderGlobalSetting.Type;

export const ProviderGlobalSettings = Schema.Struct({
  filePath: Schema.String,
  version: Schema.String,
  fields: Schema.Array(ProviderGlobalSetting),
  userConfig: Schema.Record(Schema.String, Schema.Json),
  effectiveConfig: Schema.Record(Schema.String, Schema.Json),
  origins: Schema.Record(Schema.String, Schema.String),
});
export type ProviderGlobalSettings = typeof ProviderGlobalSettings.Type;

export const ProviderGlobalSettingsReadInput = Schema.Struct({ instanceId: ProviderInstanceId });

export const ProviderGlobalSettingsWriteInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  filePath: Schema.String,
  expectedVersion: TrimmedNonEmptyString,
  edits: Schema.Array(Schema.Struct({ key: TrimmedNonEmptyString, value: Schema.Json })).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(100),
  ),
});
export type ProviderGlobalSettingsWriteInput = typeof ProviderGlobalSettingsWriteInput.Type;

export class ProviderGlobalSettingsError extends Schema.TaggedErrorClass<ProviderGlobalSettingsError>()(
  "ProviderGlobalSettingsError",
  {
    instanceId: ProviderInstanceId,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}
