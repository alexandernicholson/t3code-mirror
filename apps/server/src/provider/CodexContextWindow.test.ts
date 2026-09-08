import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
import { readCodexContextWindows, resolveCodexContextWindow } from "./CodexContextWindow.ts";

const catalog = {
  models: [
    {
      slug: "gpt-test",
      context_window: 272_000,
      max_context_window: 872_000,
      effective_context_window_percent: 95,
    },
    { slug: "bad", context_window: -1 },
  ],
};

it.effect("reads the selected instance's catalog and applies its configured override", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const homePath = yield* fs.makeTempDirectoryScoped({ prefix: "t3-context-" });
    yield* fs.writeFileString(`${homePath}/models_cache.json`, encodeJson(catalog));
    const contexts = yield* readCodexContextWindows({
      homePath,
      cwd: homePath,
      environment: { CODEX_HOME: "/wrong-home" },
      config: { model_context_window: 1_000_000 },
      modelSlugs: ["gpt-test", "custom-model"],
    });
    assert.deepStrictEqual(contexts.get("gpt-test"), {
      defaultTokens: 272_000,
      maxTokens: 872_000,
      configuredTokens: 872_000,
      effectivePercent: 95,
    });
    assert.strictEqual(contexts.has("bad"), false);
    assert.deepStrictEqual(contexts.get("custom-model"), { configuredTokens: 1_000_000 });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("uses an explicit custom catalog instead of cached account metadata", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const homePath = yield* fs.makeTempDirectoryScoped({ prefix: "t3-context-" });
    yield* fs.writeFileString(`${homePath}/models_cache.json`, encodeJson(catalog));
    yield* fs.writeFileString(
      `${homePath}/custom.json`,
      encodeJson({ models: [{ slug: "local-model", context_window: 128_000 }] }),
    );
    const contexts = yield* readCodexContextWindows({
      homePath,
      cwd: homePath,
      config: { model_catalog_json: "custom.json" },
    });
    assert.strictEqual(contexts.has("gpt-test"), false);
    assert.deepStrictEqual(contexts.get("local-model"), {
      defaultTokens: 128_000,
      configuredTokens: 128_000,
    });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("does not invent limits for missing or malformed catalogs", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const homePath = yield* fs.makeTempDirectoryScoped({ prefix: "t3-context-" });
    assert.strictEqual(
      (yield* readCodexContextWindows({ cwd: homePath, environment: { CODEX_HOME: homePath } }))
        .size,
      0,
    );
    yield* fs.writeFileString(`${homePath}/models_cache.json`, "{broken");
    assert.strictEqual((yield* readCodexContextWindows({ cwd: homePath, homePath })).size, 0);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it("resolves the shipped default, maximum, and custom limits without exceeding provider capacity", () => {
  const context = { defaultTokens: 272_000, maxTokens: 872_000, configuredTokens: 600_000 };
  assert.strictEqual(resolveCodexContextWindow("default", context), 272_000);
  assert.strictEqual(resolveCodexContextWindow("maximum", context), 872_000);
  assert.strictEqual(resolveCodexContextWindow("500000", context), 500_000);
  assert.throws(() => resolveCodexContextWindow("1000000", context), /872,000 tokens or fewer/);
  assert.throws(() => resolveCodexContextWindow("maximum", {}), /did not report/);
  assert.strictEqual(resolveCodexContextWindow("default", {}), undefined);
  assert.throws(() => resolveCodexContextWindow("0", context), /whole number/);
});
