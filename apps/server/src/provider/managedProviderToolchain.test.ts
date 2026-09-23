import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProviderDriverKind } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { makeManagedProviderToolchain } from "./managedProviderToolchain.ts";

it.effect("keeps a default provider CLI under T3 home and first on PATH", () =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const toolchain = makeManagedProviderToolchain({
      baseDir: "/srv/t3",
      commandName: "codex",
      environment: { PATH: "/usr/local/bin:/usr/bin" },
      packageName: "@openai/codex",
      path,
      platform: "linux",
      provider: ProviderDriverKind.make("codex"),
    });

    assert.strictEqual(toolchain.prefix, "/srv/t3/tools/codex-cli");
    assert.strictEqual(
      toolchain.environment.PATH,
      "/srv/t3/tools/codex-cli/bin:/usr/local/bin:/usr/bin",
    );
    assert.deepStrictEqual(toolchain.maintenance.update?.args, [
      "install",
      "-g",
      "--prefix",
      "/srv/t3/tools/codex-cli",
      "--allow-scripts=@openai/codex",
      "@openai/codex@latest",
    ]);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("uses the npm prefix itself for managed provider shims on Windows", () =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const toolchain = makeManagedProviderToolchain({
      baseDir: "C:\\t3",
      commandName: "claude",
      environment: { Path: "C:\\Windows\\System32" },
      packageName: "@anthropic-ai/claude-code",
      path,
      platform: "win32",
      provider: ProviderDriverKind.make("claudeAgent"),
    });

    assert.strictEqual(toolchain.environment.PATH, `${toolchain.prefix};C:\\Windows\\System32`);
  }).pipe(Effect.provide(NodeServices.layer)),
);
