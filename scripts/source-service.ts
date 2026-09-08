#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off
// Local release/bootstrap tooling uses Node directly and does not start an application runtime.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as NodeUtil from "node:util";
import { RELEASE_VERSION } from "@t3tools/shared/changelog";

// This is the one-time local bootstrap. Future builds are owned by the running source updater.
const { values } = NodeUtil.parseArgs({
  options: {
    repository: {
      type: "string",
      default: "https://github.com/alexandernicholson/t3code-mirror.git",
    },
    branch: { type: "string", default: "main" },
    "home-dir": { type: "string" },
  },
});
if (Effect.runSync(Effect.service(HostProcessPlatform)) !== "linux")
  throw new Error("Source service setup currently supports Linux.");
if (!values["home-dir"])
  throw new Error(
    "Pass --home-dir with the existing service's T3 home. Its userdata directory is preserved.",
  );
const baseDir = NodePath.resolve(values["home-dir"]);
const runtime = NodePath.join(baseDir, "runtime");
await NodeFSP.mkdir(runtime, { recursive: true });
const staging = await NodeFSP.mkdtemp(NodePath.join(runtime, "bootstrap-"));
const checkout = NodePath.join(staging, "source");
const settingsPath = NodePath.join(baseDir, "userdata/settings.json");
const originalSettings = await NodeFSP.readFile(settingsPath, "utf8").catch(
  (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  },
);
const env: NodeJS.ProcessEnv = { ...process.env, CI: "true", GIT_TERMINAL_PROMPT: "0" };
delete env.VITE_HTTP_URL;
delete env.VITE_WS_URL;
const run = (command: string, args: string[], cwd?: string) =>
  NodeChildProcess.execFileSync(command, args, { cwd, env, stdio: "inherit" });
try {
  run("git", ["check-ref-format", `refs/heads/${values.branch}`]);
  run("git", [
    "clone",
    "--single-branch",
    "--branch",
    values.branch,
    "--",
    values.repository,
    checkout,
  ]);
  const commit = NodeChildProcess.execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: checkout,
    encoding: "utf8",
  }).trim();
  const version = (await NodeFSP.readFile(NodePath.join(checkout, "VERSION"), "utf8")).trim();
  if (!RELEASE_VERSION.test(version)) throw new Error("The branch has no valid VERSION.");
  run("vp", ["install", "--frozen-lockfile"], checkout);
  run(
    process.execPath,
    [
      "scripts/build-source-runtime.ts",
      "--runtime-dir",
      staging,
      "--repository",
      values.repository,
      "--branch",
      values.branch,
      "--commit",
      commit,
    ],
    checkout,
  );
  const runtimeVersion = `${version}+git.${commit}`;
  const target = NodePath.join(runtime, "versions", runtimeVersion);
  await NodeFSP.mkdir(NodePath.dirname(target), { recursive: true });
  await NodeFSP.writeFile(NodePath.join(staging, ".install-complete"), `${runtimeVersion}\n`);
  // Never overwrite a runtime: it may still be the selected service or its rollback target.
  await NodeFSP.rename(staging, target);
  const entry = NodePath.join(target, "node_modules/t3/dist/bin.mjs");
  run(process.execPath, [
    entry,
    "__service-preflight",
    "--database-path",
    NodePath.join(baseDir, "userdata/state.sqlite"),
    "--launcher-protocol",
    "3",
  ]);
  const settings = originalSettings === null ? {} : JSON.parse(originalSettings);
  if (typeof settings !== "object" || settings === null || Array.isArray(settings))
    throw new Error("The service settings file is invalid.");
  // Initialize the selected branch only when adopting an installation without source-update settings.
  if (settings.sourceUpdates === undefined) {
    await NodeFSP.mkdir(NodePath.dirname(settingsPath), { recursive: true });
    await NodeFSP.writeFile(
      `${settingsPath}.source-bootstrap`,
      JSON.stringify(
        {
          ...settings,
          sourceUpdates: { enabled: true, policy: "automatic", branch: values.branch },
        },
        null,
        2,
      ),
    );
    await NodeFSP.rename(`${settingsPath}.source-bootstrap`, settingsPath);
  }
  try {
    run(process.execPath, [entry, "service", "update", "--base-dir", baseDir]);
  } catch (error) {
    if (settings.sourceUpdates === undefined) {
      if (originalSettings === null) await NodeFSP.rm(settingsPath, { force: true });
      else await NodeFSP.writeFile(settingsPath, originalSettings);
    }
    throw error;
  }
  process.stdout.write(
    `Source service installed. Select ${values.branch} in Settings → Updates.\n`,
  );
} finally {
  await NodeFSP.rm(staging, { recursive: true, force: true });
}
