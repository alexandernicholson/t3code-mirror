// @effect-diagnostics nodeBuiltinImport:off - These tests exercise a fake executable and isolated files.
import { it } from "@effect/vitest";
import { expect, type TestContext } from "vite-plus/test";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { Effect, Schema } from "effect";
import { HostProcessPlatform, HostProcessArchitecture } from "@t3tools/shared/hostProcess";
import { LanguageServerInstaller } from "./installer.ts";
import { languageServers } from "./catalog.ts";
const decodeCall = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ args: Schema.Array(Schema.String), data: Schema.String })),
);
const withInstaller = Effect.fn("installer.test")(function* (
  context: TestContext,
  run: (fixture: { root: string; installer: LanguageServerInstaller }) => Promise<void>,
) {
  const runtime = {
    platform: yield* HostProcessPlatform,
    architecture: yield* HostProcessArchitecture,
  };
  if (runtime.platform === "win32") {
    context.skip("The fake installer uses a POSIX executable script.");
    return;
  }
  const root = yield* Effect.acquireRelease(
    Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-installer-test-"))),
    (root) => Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true })),
  );
  const installer = new LanguageServerInstaller(root, () => {}, runtime);
  yield* Effect.addFinalizer(() => Effect.promise(() => installer.close()));
  const platform = runtime.platform === "darwin" ? "macos" : "linux";
  const binary = NodePath.join(
    root,
    `mise-v2026.9.4-${platform}-${runtime.architecture}${platform === "linux" ? "-musl" : ""}`,
  );
  yield* Effect.promise(async () => {
    await NodeFSP.writeFile(
      binary,
      `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(path.join(process.cwd(), 'calls.jsonl'), JSON.stringify({args, data: process.env.MISE_DATA_DIR}) + '\\n');
if (args[0] === 'latest') process.stdout.write(args[1].split('@').pop() === 'latest' ? '1.0.0' : args[1].split('@').pop());
if (args[0] === 'install' && args.some(arg => arg.endsWith('@broken'))) { process.stderr.write('fixture installation failed'); process.exitCode = 2; }
`,
      { mode: 0o755 },
    );

    await installer.initialize();
    await run({ root, installer });
  });
}, Effect.scoped);
it.effect(
  "coalesces callers, rejects conflicting versions, and uses a private installation root",
  (context) =>
    withInstaller(context, async ({ root, installer }) => {
      const a = installer.install(languageServers[0]!, "1.0.0");
      const b = installer.install(languageServers[0]!, "1.0.0");
      expect(a).toBe(b);
      await expect(installer.install(languageServers[0]!, "2.0.0")).rejects.toThrow(
        "Another version",
      );
      await a;
      const calls = (await NodeFSP.readFile(NodePath.join(root, "calls.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => decodeCall(line));
      expect(calls.filter((call) => call.args[0] === "install")).toHaveLength(1);
      expect(calls.every((call) => call.data === NodePath.join(root, "mise", "data"))).toBe(true);
      expect(installer.manifests.get("typescript")?.version).toBe("1.0.0");
    }),
);
it.effect("preserves the previous installation when an update fails", (context) =>
  withInstaller(context, async ({ root, installer }) => {
    await installer.install(languageServers[0]!, "1.0.0");
    await expect(installer.install(languageServers[0]!, "broken")).rejects.toThrow(
      "fixture installation failed",
    );
    const reloaded = new LanguageServerInstaller(root, () => {}, installer.runtime);
    await reloaded.initialize();
    expect(reloaded.manifests.get("typescript")?.version).toBe("1.0.0");
    expect(installer.details.get("typescript")?.status).toBe("error");
    await reloaded.close();
  }),
);
it.effect("keeps runtimes shared by another installed server when removing a server", (context) =>
  withInstaller(context, async ({ root, installer }) => {
    await installer.install(languageServers[0]!, "1.0.0");
    await installer.install(
      languageServers.find((server) => server.id === "yaml")!,
      "1.0.0",
    );
    await installer.remove("typescript");
    const log = (await NodeFSP.readFile(NodePath.join(root, "calls.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => decodeCall(line));
    const removed = log.find((entry) => entry.args[0] === "uninstall")!.args;
    expect(removed.some((arg) => arg.startsWith("node@"))).toBe(false);
    expect(installer.manifests.has("yaml")).toBe(true);
  }),
);
