// @effect-diagnostics preferSchemaOverJson:off
// Fake child source and standalone launcher files use JSON, just like the launcher protocol.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import {
  Launcher,
  readServiceState,
  validateSourceTransition,
  writeServiceState,
} from "../serviceLauncher.ts";
import { SERVICE_LAUNCHER_PROTOCOL } from "../cloud/serviceProtocol.ts";

it.layer(NodeServices.layer)("source launcher transitions", (it) => {
  it.effect("restores SQLite and the prior branch after a lower-version source trial fails", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-source-launcher-test-" });
      const from = `0.2.0+git.${"a".repeat(40)}`;
      const to = `0.1.0+git.${"b".repeat(40)}`;
      const dbPath = path.join(root, "state.sqlite");
      yield* fs.writeFileString(dbPath, "original data");
      const child = `import { writeFileSync } from 'node:fs';
const context = JSON.parse(process.env.T3_SERVICE_LAUNCHER_CONTEXT);
if (context.update?.status === 'pending') {
  writeFileSync(context.update.dbPath, 'trial data');
  process.exit(1);
} else if (!context.update) {
  process.send({ type: 'request-update', sourceUpdate: true, targetVersion: ${JSON.stringify(to)}, dbPath: ${JSON.stringify(dbPath)} });
  process.on('message', message => { if (message.type === 'update-rejected') process.exit(2); });
  setInterval(() => {}, 1000);
} else process.exit(0);`;
      for (const [version, commit] of [
        [from, "a".repeat(40)],
        [to, "b".repeat(40)],
      ] as const) {
        const dir = path.join(root, "runtime/versions", version);
        const entry = path.join(dir, "node_modules/t3/dist/bin.mjs");
        yield* fs.makeDirectory(path.dirname(entry), { recursive: true });
        yield* fs.writeFileString(entry, child);
        yield* fs.writeFileString(path.join(dir, ".install-complete"), version);
        yield* fs.writeFileString(
          path.join(dir, "source-build.json"),
          JSON.stringify({
            runtimeVersion: version,
            commit,
            repository: "https://example.com/fork.git",
            migrations: { "001": "same-migration" },
          }),
        );
      }
      const statePath = path.join(root, "runtime/service-state.json");
      yield* Effect.promise(() =>
        writeServiceState(statePath, { protocol: SERVICE_LAUNCHER_PROTOCOL, activeVersion: from }),
      );
      const launcher = new Launcher(root, yield* Effect.promise(() => readServiceState(statePath)));
      yield* Effect.promise(() =>
        launcher.run().then(
          () => {
            throw new Error("Unexpected launcher completion");
          },
          () => undefined,
        ),
      );
      const state = yield* Effect.promise(() => readServiceState(statePath));
      expect(state.activeVersion).toBe(from);
      expect(state.update?.status).toBe("rolled-back");
      expect(state.update?.sourceUpdate).toBe(true);
      expect(yield* fs.readFileString(dbPath)).toBe("original data");
      const metadataPath = path.join(root, "runtime/versions", to, "source-build.json");
      yield* fs.writeFileString(
        metadataPath,
        JSON.stringify({
          runtimeVersion: to,
          commit: "b".repeat(40),
          repository: "https://example.com/fork.git",
          migrations: { "001": "changed" },
        }),
      );
      const result = yield* Effect.tryPromise(() => validateSourceTransition(root, from, to)).pipe(
        Effect.flip,
      );
      expect(String(result.cause)).toContain("migration 001");
    }),
  );
});
