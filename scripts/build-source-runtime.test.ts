// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import releasedMigrations from "./fixtures/source-migrations-0.8.5.json" with { type: "json" };
import { readSourceMigrationHashes } from "./build-source-runtime.ts";

it("builds the same migration IDs as the runtime and preserves released source hashes", async () => {
  const hashes = await readSourceMigrationHashes(
    NodePath.resolve("apps/server/src/persistence/Migrations"),
  );
  const registry = await NodeFSP.readFile(
    NodePath.resolve("apps/server/src/persistence/Migrations.ts"),
    "utf8",
  );
  const registeredIds = [...registry.matchAll(/^\s+\[(\d+), "/gm)].map((match) => Number(match[1]));
  expect(Object.keys(hashes).map(Number)).toEqual(registeredIds);
  for (const [id, hash] of Object.entries(releasedMigrations)) {
    expect(hashes[id], `Released migration ${id} must remain byte-for-byte identical`).toBe(hash);
  }
});

it("rejects duplicate migration filenames before building a source release", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-migration-manifest-"));
  try {
    await NodeFSP.writeFile(NodePath.join(directory, "001_First.ts"), "first");
    await NodeFSP.writeFile(NodePath.join(directory, "001_Second.ts"), "second");
    await expect(readSourceMigrationHashes(directory)).rejects.toThrow("Duplicate migration 001");
  } finally {
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
});
