import type { ProviderGlobalSettings, ProviderGlobalSettingsWriteInput } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Arr from "effect/Array";

export const parseGlobalSettingJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

export const globalSettingsDraft = (settings: ProviderGlobalSettings): Record<string, string> =>
  Object.fromEntries(
    settings.fields.map((field) => [field.key, field.value === null ? "" : String(field.value)]),
  );

/** Empty controls remove the user override; numeric edits must remain exact integers. */
export function globalSettingsEdits(
  settings: ProviderGlobalSettings,
  draft: Readonly<Record<string, string>>,
): ProviderGlobalSettingsWriteInput["edits"] {
  return settings.fields.flatMap<ProviderGlobalSettingsWriteInput["edits"][number]>((field) => {
    const text = draft[field.key] ?? "";
    const original = field.value === null ? "" : String(field.value);
    if (text === original) return [];
    if (text.trim() === "") return [{ key: field.key, value: null }];
    if (field.control === "number") {
      const value = Number(text);
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${field.title} must be a positive whole number.`);
      }
      return [{ key: field.key, value }];
    }
    return [{ key: field.key, value: text }];
  });
}

/** Advanced table edits use JSON, so keys containing dots can be edited within their parent table. */
export function globalSettingAtPath(config: ProviderGlobalSettings["userConfig"], key: string) {
  let value: Schema.Json | undefined = config;
  for (const part of key.split(".")) {
    if (
      value === null ||
      typeof value !== "object" ||
      Arr.isArray(value) ||
      !Object.hasOwn(value, part)
    )
      return undefined;
    value = (value as Schema.JsonObject)[part];
  }
  return value;
}

export function globalSettingSource(
  settings: ProviderGlobalSettings,
  key: string,
): string | undefined {
  const parts = key.split(".");
  while (parts.length > 0) {
    const path = parts.join(".");
    if (Object.hasOwn(settings.origins, path)) return settings.origins[path];
    parts.pop();
  }
  return undefined;
}
