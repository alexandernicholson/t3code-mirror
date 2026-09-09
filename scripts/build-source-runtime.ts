#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off
// Local release/bootstrap tooling uses Node directly and does not start an application runtime.
import { releasePackageFiles } from "./lib/release-packages.ts";
import * as NodeCrypto from "node:crypto";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { RELEASE_VERSION, parseChangelog } from "@t3tools/shared/changelog";

/** Run only in a disposable checkout. The parent publishes the whole directory after preflight. */
async function buildSourceRuntime(input: {
  root: string;
  runtimeDir: string;
  repository: string;
  branch: string;
  commit: string;
}) {
  const version = (await NodeFSP.readFile(NodePath.join(input.root, "VERSION"), "utf8")).trim();
  if (!RELEASE_VERSION.test(version) || !/^[a-f0-9]{40}$/.test(input.commit)) {
    throw new Error("Source releases require a VERSION and an exact Git commit.");
  }
  const actualCommit = NodeChildProcess.execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: input.root,
    encoding: "utf8",
  }).trim();
  if (actualCommit !== input.commit)
    throw new Error("The source checkout changed before building.");
  const changelog = await NodeFSP.readFile(NodePath.join(input.root, "CHANGELOG.md"), "utf8");
  if (parseChangelog(changelog)[0]?.version !== version)
    throw new Error("VERSION and CHANGELOG.md disagree.");
  const runtimeVersion = `${version}+git.${input.commit}`;
  const migrationDir = NodePath.join(input.root, "apps/server/src/persistence/Migrations");
  const migrations: Record<string, string> = {};
  for (const file of (await NodeFSP.readdir(migrationDir)).sort()) {
    if (!/^\d+_.*\.ts$/.test(file) || file.endsWith(".test.ts")) continue;
    const id = file.split("_", 1)[0]!;
    if (migrations[id]) throw new Error(`Duplicate migration ${id}`);
    migrations[id] = NodeCrypto.createHash("sha256")
      .update(await NodeFSP.readFile(NodePath.join(migrationDir, file)))
      .digest("hex");
  }
  const metadata = {
    version,
    runtimeVersion,
    commit: input.commit,
    branch: input.branch,
    repository: input.repository,
    migrations,
  };
  for (const file of releasePackageFiles) {
    const filename = NodePath.join(input.root, file);
    const json = JSON.parse(await NodeFSP.readFile(filename, "utf8"));
    await NodeFSP.writeFile(
      filename,
      `${JSON.stringify({ ...json, version: runtimeVersion }, null, 2)}\n`,
    );
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    T3CODE_SOURCE_BUILD: JSON.stringify(metadata),
    APP_VERSION: runtimeVersion,
  };
  delete env.VITE_HTTP_URL;
  delete env.VITE_WS_URL;
  NodeChildProcess.execFileSync("vp", ["run", "--filter", "t3", "build"], {
    cwd: input.root,
    env,
    stdio: "inherit",
  });
  for (const file of ["dist/bin.mjs", "dist/service-launcher.mjs", "dist/client/index.html"]) {
    await NodeFSP.readFile(NodePath.join(input.root, "apps/server", file));
  }
  await NodeFSP.mkdir(NodePath.join(input.runtimeDir, "node_modules"), { recursive: true });
  await NodeFSP.symlink(
    NodePath.relative(
      NodePath.join(input.runtimeDir, "node_modules"),
      NodePath.join(input.root, "apps/server"),
    ),
    NodePath.join(input.runtimeDir, "node_modules/t3"),
  );
  await NodeFSP.writeFile(
    NodePath.join(input.runtimeDir, "source-build.json"),
    `${JSON.stringify(metadata)}\n`,
  );
  await NodeFSP.writeFile(NodePath.join(input.runtimeDir, "CHANGELOG.md"), changelog);
  return metadata;
}

if (import.meta.main) {
  const { values } = NodeUtil.parseArgs({
    options: {
      "runtime-dir": { type: "string" },
      repository: { type: "string" },
      branch: { type: "string" },
      commit: { type: "string" },
    },
  });
  if (!values["runtime-dir"] || !values.repository || !values.branch || !values.commit) {
    throw new Error("Required: --runtime-dir, --repository, --branch, --commit");
  }
  await buildSourceRuntime({
    root: process.cwd(),
    runtimeDir: NodePath.resolve(values["runtime-dir"]),
    repository: values.repository,
    branch: values.branch,
    commit: values.commit,
  });
}
