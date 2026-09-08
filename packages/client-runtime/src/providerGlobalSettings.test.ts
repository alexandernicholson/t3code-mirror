import { describe, expect, it } from "vite-plus/test";
import type { ProviderGlobalSettings } from "@t3tools/contracts";

import {
  globalSettingAtPath,
  globalSettingSource,
  globalSettingsDraft,
  globalSettingsEdits,
  parseGlobalSettingJson,
} from "./providerGlobalSettings.ts";

const settings: ProviderGlobalSettings = {
  filePath: "/home/user/.codex/config.toml",
  version: "v1",
  userConfig: {},
  effectiveConfig: {},
  origins: {},
  fields: [
    {
      key: "model_context_window",
      title: "Context window",
      description: "",
      control: "number",
      value: null,
      effectiveValue: 200000,
    },
    {
      key: "web_search",
      title: "Web search",
      description: "",
      control: "select",
      value: "live",
      effectiveValue: "disabled",
      overriddenBy: "Launch arguments",
    },
  ],
};

describe("provider global settings edits", () => {
  it("does not turn inherited effective values into user overrides", () => {
    const draft = globalSettingsDraft(settings);
    expect(draft.model_context_window).toBe("");
    expect(draft.web_search).toBe("live");
    expect(globalSettingsEdits(settings, draft)).toEqual([]);
  });
  it("encodes numeric changes and reset operations without touching unchanged keys", () => {
    expect(
      globalSettingsEdits(settings, { model_context_window: "128000", web_search: "" }),
    ).toEqual([
      { key: "model_context_window", value: 128000 },
      { key: "web_search", value: null },
    ]);
  });
  it.each(["1.5", "Infinity", "wrong", "-1", "0", "9007199254740993"])(
    "rejects invalid context limit %s",
    (value) => {
      expect(() =>
        globalSettingsEdits(settings, {
          ...globalSettingsDraft(settings),
          model_context_window: value,
        }),
      ).toThrow("positive whole number");
    },
  );
  it("accepts advanced scalar, array and table values and requires quoted strings", () => {
    expect(parseGlobalSettingJson('{"memories":true}')).toEqual({ memories: true });
    expect(parseGlobalSettingJson('["a","b"]')).toEqual(["a", "b"]);
    expect(parseGlobalSettingJson('"live"')).toBe("live");
    expect(parseGlobalSettingJson("null")).toBeNull();
    expect(() => parseGlobalSettingJson("live")).toThrow();
  });
  it("looks up nested keys without exposing inherited object properties", () => {
    const config = { features: { memories: false }, notify: ["tool"] };
    expect(globalSettingAtPath(config, "features.memories")).toBe(false);
    expect(globalSettingAtPath(config, "notify")).toEqual(["tool"]);
    expect(globalSettingAtPath(config, "features.toString")).toBeUndefined();
    expect(globalSettingAtPath(config, "missing.key")).toBeUndefined();
    expect(globalSettingAtPath(config, "notify.0")).toBeUndefined();
  });
  it("uses the closest configuration origin for nested advanced keys", () => {
    expect(
      globalSettingSource(
        { ...settings, origins: { features: "System", "features.memories": "Launch arguments" } },
        "features.memories",
      ),
    ).toBe("Launch arguments");
    expect(
      globalSettingSource({ ...settings, origins: { features: "System" } }, "features.memories"),
    ).toBe("System");
  });
});
