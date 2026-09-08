import { it } from "@effect/vitest";
import { expect, vi } from "vite-plus/test";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type { CodexAppServerClient } from "effect-codex-app-server/client";
import { CodexAppServerRequestError } from "effect-codex-app-server/errors";
import type * as CodexSchema from "effect-codex-app-server/schema";

import { readCodexGlobalSettings, writeCodexGlobalSettings } from "./CodexGlobalSettings.ts";

const instanceId = ProviderInstanceId.make("codex-work");
const filePath = "/home/work/.codex/config.toml";
const response = {
  config: { web_search: "disabled", model_verbosity: "high", future_setting: { enabled: true } },
  origins: {
    web_search: { name: { type: "sessionFlags" }, version: "flags" },
    model_verbosity: { name: { type: "user", file: filePath }, version: "v1" },
  },
  layers: [
    { name: { type: "sessionFlags" }, version: "flags", config: { web_search: "disabled" } },
    {
      name: { type: "user", file: filePath },
      version: "v1",
      config: { web_search: "live", model_verbosity: "high", future_setting: { enabled: true } },
    },
  ],
} satisfies CodexSchema.V2ConfigReadResponse;

it.effect(
  "keeps editable user values separate from effective overrides and preserves unknown keys",
  () =>
    Effect.gen(function* () {
      const request = vi
        .fn<CodexAppServerClient["Service"]["request"]>()
        .mockReturnValue(Effect.succeed(response));
      const settings = yield* readCodexGlobalSettings(
        { request: request as CodexAppServerClient["Service"]["request"] },
        instanceId,
      );
      expect(settings.filePath).toBe(filePath);
      expect(settings.version).toBe("v1");
      expect(settings.fields.find((field) => field.key === "web_search")).toMatchObject({
        value: "live",
        effectiveValue: "disabled",
        overriddenBy: "Launch arguments",
      });
      expect(settings.fields.find((field) => field.key === "model_context_window")).toMatchObject({
        value: null,
        effectiveValue: null,
      });
      expect(settings.userConfig.future_setting).toEqual({ enabled: true });
      expect(settings.effectiveConfig.web_search).toBe("disabled");
    }),
);

it.effect("rejects a stale version or changed config home without writing", () =>
  Effect.gen(function* () {
    for (const input of [
      { filePath, expectedVersion: "old" },
      { filePath: "/another/config.toml", expectedVersion: "v1" },
    ]) {
      const request = vi
        .fn<CodexAppServerClient["Service"]["request"]>()
        .mockReturnValue(Effect.succeed(response));
      const result = yield* writeCodexGlobalSettings(
        { request: request as CodexAppServerClient["Service"]["request"] },
        { instanceId, ...input, edits: [{ key: "web_search", value: "cached" }] },
      ).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure.message).toContain("Reload");
      expect(request).toHaveBeenCalledTimes(1);
    }
  }),
);

it.effect(
  "batches reset and advanced table edits against the user file and returns the new effective state",
  () =>
    Effect.gen(function* () {
      const updated = {
        ...response,
        config: { web_search: "disabled", features: { memories: true } },
        layers: [
          {
            name: { type: "user" as const, file: filePath },
            version: "v2",
            config: { features: { memories: true } },
          },
        ],
      };
      const request = vi
        .fn<CodexAppServerClient["Service"]["request"]>()
        .mockReturnValueOnce(Effect.succeed(response))
        .mockReturnValueOnce(Effect.succeed({ status: "okOverridden", filePath, version: "v2" }))
        .mockReturnValueOnce(Effect.succeed(updated));
      const settings = yield* writeCodexGlobalSettings(
        { request: request as CodexAppServerClient["Service"]["request"] },
        {
          instanceId,
          filePath,
          expectedVersion: "v1",
          edits: [
            { key: "model_verbosity", value: null },
            { key: "features", value: { memories: true } },
          ],
        },
      );
      expect(request).toHaveBeenNthCalledWith(2, "config/batchWrite", {
        filePath,
        expectedVersion: "v1",
        edits: [
          { keyPath: "model_verbosity", value: null, mergeStrategy: "replace" },
          { keyPath: "features", value: { memories: true }, mergeStrategy: "replace" },
        ],
      });
      expect(settings.version).toBe("v2");
      expect(settings.fields.find((field) => field.key === "model_verbosity")?.value).toBeNull();
      expect(settings.userConfig.features).toEqual({ memories: true });
    }),
);

it.effect(
  "preserves Codex validation failures and does not report an unsuccessful write as saved",
  () =>
    Effect.gen(function* () {
      const failure = new CodexAppServerRequestError({
        code: -32600,
        errorMessage: "Invalid configuration: expected integer",
      });
      const request = vi
        .fn<CodexAppServerClient["Service"]["request"]>()
        .mockReturnValueOnce(Effect.succeed(response))
        .mockReturnValueOnce(Effect.fail(failure));
      const result = yield* writeCodexGlobalSettings(
        { request: request as CodexAppServerClient["Service"]["request"] },
        {
          instanceId,
          filePath,
          expectedVersion: "v1",
          edits: [{ key: "model_context_window", value: "invalid" }],
        },
      ).pipe(Effect.result);
      expect(result).toEqual(Result.fail(failure));
      expect(request).toHaveBeenCalledTimes(2);
    }),
);

it.effect("does not offer a system layer as a writable user configuration", () =>
  Effect.gen(function* () {
    const request = vi.fn<CodexAppServerClient["Service"]["request"]>().mockReturnValue(
      Effect.succeed({
        config: {},
        origins: {},
        layers: [
          { name: { type: "system", file: "/etc/codex/config.toml" }, version: "v1", config: {} },
        ],
      }),
    );
    const result = yield* readCodexGlobalSettings(
      { request: request as CodexAppServerClient["Service"]["request"] },
      instanceId,
    ).pipe(Effect.result);
    expect(Result.isFailure(result)).toBe(true);
  }),
);
