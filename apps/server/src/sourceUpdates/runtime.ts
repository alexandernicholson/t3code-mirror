import { SourceBuild, SourceUpdateError, type SourceUpdateTarget } from "@t3tools/contracts";
import { changelogBetween, parseChangelog, RELEASE_VERSION } from "@t3tools/shared/changelog";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";
import { ServerConfig } from "../config.ts";
import { ProcessRunner } from "../processRunner.ts";
import { SERVICE_LAUNCHER_PROTOCOL } from "../cloud/serviceProtocol.ts";
import { decodeServicePreflightResult } from "../cloud/servicePreflight.ts";
import { assertCompatibleMigrations } from "./build.ts";

const decodePreflightJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

export const sourceUpdateFailure = (cause: unknown) =>
  new SourceUpdateError({
    message: cause instanceof Error ? cause.message : "The source update could not be completed.",
  });

/** Flush the file and containing directory before publishing a recoverable updater transition. */
export const writeSourceState = Effect.fn("SourceUpdates.writeState")(function* (
  filePath: string,
  contents: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });
  yield* Effect.scoped(
    Effect.gen(function* () {
      const temporary = `${filePath}.tmp`;
      const file = yield* fs.open(temporary, { flag: "w", mode: 0o600 });
      yield* file.writeAll(new TextEncoder().encode(contents));
      yield* file.sync;
      yield* fs.rename(temporary, filePath);
      const directory = yield* fs.open(path.dirname(filePath), { flag: "r" });
      yield* directory.sync;
    }),
  );
}, Effect.mapError(sourceUpdateFailure));

export const makeSourceRuntime = Effect.fn("SourceUpdates.makeRuntime")(function* (
  running: SourceBuild,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const runner = yield* ProcessRunner;
  const runtimeDir = path.join(config.baseDir, "runtime");
  const repositoryDir = path.join(runtimeDir, "source.git");
  const versionsDir = path.join(runtimeDir, "versions");
  const versionDir = (target: Pick<SourceUpdateTarget, "runtimeVersion">) =>
    path.join(versionsDir, target.runtimeVersion);
  const run = Effect.fn("SourceUpdates.run")(function* (
    command: string,
    args: ReadonlyArray<string>,
    cwd?: string,
    build = false,
  ) {
    const result = yield* runner.run({
      command,
      args,
      cwd,
      timeout: build ? "30 minutes" : "90 seconds",
      maxOutputBytes: 256 * 1024,
      outputMode: "truncate",
      env: { GIT_TERMINAL_PROMPT: "0", CI: "true" },
    });
    if (build)
      yield* fs.writeFileString(
        path.join(runtimeDir, "source-build.log"),
        result.stdout + result.stderr,
      );
    if (result.code !== 0)
      return yield* new SourceUpdateError({
        message: `${command} failed${build ? "; see source-build.log on the host" : `: ${result.stderr.slice(-1000).trim()}`}.`,
      });
    return result.stdout;
  }, Effect.mapError(sourceUpdateFailure));
  const git = (args: ReadonlyArray<string>) => run("git", ["--git-dir", repositoryDir, ...args]);
  const discover = Effect.fn("SourceUpdates.discover")(function* (branch: string) {
    if (!branch.trim() || branch !== branch.trim() || branch.startsWith("-"))
      return yield* new SourceUpdateError({ message: "Enter a valid branch name." });
    yield* run("git", ["check-ref-format", `refs/heads/${branch}`]);
    yield* fs.makeDirectory(runtimeDir, { recursive: true });
    if (!(yield* fs.exists(repositoryDir))) yield* run("git", ["init", "--bare", repositoryDir]);
    yield* git([
      "fetch",
      "--no-tags",
      "--force",
      "--",
      running.repository,
      `+refs/heads/${branch}:refs/heads/update-target`,
    ]);
    const commit = (yield* git(["rev-parse", "refs/heads/update-target"])).trim();
    if (!/^[a-f0-9]{40}$/.test(commit))
      return yield* new SourceUpdateError({
        message: "The branch did not resolve to a Git commit.",
      });
    const version = (yield* git(["show", `${commit}:VERSION`])).trim();
    if (!RELEASE_VERSION.test(version))
      return yield* new SourceUpdateError({ message: "The selected branch has no valid VERSION." });
    const changelog = yield* git(["show", `${commit}:CHANGELOG.md`]);
    const latest = yield* Effect.try({
      try: () => parseChangelog(changelog)[0],
      catch: sourceUpdateFailure,
    });
    if (latest?.version !== version)
      return yield* new SourceUpdateError({
        message: "The selected branch's VERSION and CHANGELOG.md disagree.",
      });
    const ancestor = yield* runner.run({
      command: "git",
      args: ["--git-dir", repositoryDir, "merge-base", "--is-ancestor", running.commit, commit],
      timeout: "30 seconds",
    });
    const divergent = ancestor.code !== 0;
    const notes = yield* Effect.try({
      try: () => changelogBetween(changelog, divergent ? null : running.version, version),
      catch: sourceUpdateFailure,
    });
    const repositorySlug = /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+)$/.exec(
      running.repository.replace(/\.git$/, ""),
    )?.[1];
    return {
      version,
      runtimeVersion: `${version}+git.${commit}`,
      commit,
      branch,
      divergent,
      ...(repositorySlug
        ? {
            compareUrl: `https://github.com/${repositorySlug}/compare/${running.commit}...${commit}`,
          }
        : {}),
      notes: (notes || `## [${version}]\n\n${latest.markdown}`).slice(0, 64 * 1024),
    } satisfies SourceUpdateTarget;
  }, Effect.mapError(sourceUpdateFailure));
  const installed = Effect.fn("SourceUpdates.installed")(function* (target: SourceUpdateTarget) {
    const sentinel = path.join(versionDir(target), ".install-complete");
    if (!(yield* fs.exists(sentinel))) return false;
    return (yield* fs.readFileString(sentinel)).trim() === target.runtimeVersion;
  }, Effect.mapError(sourceUpdateFailure));
  const validate = Effect.fn("SourceUpdates.validate")(function* (
    directory: string,
    target: SourceUpdateTarget,
  ) {
    const metadata = yield* fs
      .readFileString(path.join(directory, "source-build.json"))
      .pipe(Effect.flatMap(Schema.decodeUnknownEffect(fromJsonStringPretty(SourceBuild))));
    if (
      metadata.runtimeVersion !== target.runtimeVersion ||
      metadata.commit !== target.commit ||
      metadata.repository !== running.repository
    ) {
      return yield* new SourceUpdateError({
        message: "The built runtime does not match the selected commit.",
      });
    }
    yield* Effect.try({
      try: () => assertCompatibleMigrations(running, metadata),
      catch: sourceUpdateFailure,
    });
    const entry = path.join(directory, "node_modules/t3/dist/bin.mjs");
    const output = yield* run(process.execPath, [
      entry,
      "__service-preflight",
      "--database-path",
      config.dbPath,
      "--launcher-protocol",
      String(SERVICE_LAUNCHER_PROTOCOL),
    ]);
    const preflight = decodeServicePreflightResult(yield* decodePreflightJson(output));
    if (preflight?.status !== "ready" || preflight.version !== target.runtimeVersion) {
      return yield* new SourceUpdateError({
        message:
          preflight?.status === "blocked"
            ? preflight.reason
            : "The built runtime failed preflight.",
      });
    }
  }, Effect.mapError(sourceUpdateFailure));
  const prepare = Effect.fn("SourceUpdates.prepare")(function* (target: SourceUpdateTarget) {
    if (yield* installed(target)) {
      yield* validate(versionDir(target), target);
      return;
    }
    yield* fs.makeDirectory(versionsDir, { recursive: true });
    const staging = yield* fs.makeTempDirectory({
      directory: runtimeDir,
      prefix: "source-staging-",
    });
    const checkout = path.join(staging, "source");
    yield* run("git", ["clone", "--no-checkout", "--no-hardlinks", "--", repositoryDir, checkout]);
    yield* run("git", ["checkout", "--detach", target.commit], checkout);
    // The OS lock outlives a crashed server while its build process is still running.
    // Arguments stay separate from this fixed script; branch names are never shell code.
    const buildScript = `const {execFileSync}=require("node:child_process"); const fs=require("node:fs"); const path=require("node:path"); const args=process.argv.slice(1); const staging=args[3]; for(const name of fs.readdirSync(path.dirname(staging))) { if(name.startsWith("source-staging-") && name !== path.basename(staging)) fs.rmSync(path.join(path.dirname(staging),name),{recursive:true,force:true}); } execFileSync("vp",["install","--frozen-lockfile"],{stdio:"inherit"}); execFileSync(args[0],args.slice(1),{stdio:"inherit"});`;
    yield* run(
      "flock",
      [
        "--nonblock",
        path.join(runtimeDir, "source-build.lock"),
        "nice",
        "-n",
        "10",
        process.execPath,
        "-e",
        buildScript,
        process.execPath,
        "scripts/build-source-runtime.ts",
        "--runtime-dir",
        staging,
        "--repository",
        running.repository,
        "--branch",
        target.branch,
        "--commit",
        target.commit,
      ],
      checkout,
      true,
    );
    yield* validate(staging, target);
    yield* writeSourceState(
      path.join(staging, ".install-complete"),
      `${target.runtimeVersion}\n`,
    ).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );
    if (yield* fs.exists(versionDir(target)))
      yield* fs.remove(versionDir(target), { recursive: true });
    yield* fs.rename(staging, versionDir(target));
    // Recheck relative dependency links after the immutable directory moves.
    yield* validate(versionDir(target), target);
  }, Effect.mapError(sourceUpdateFailure));
  const cleanup = Effect.fn("SourceUpdates.cleanup")(function* (keep: ReadonlyArray<string>) {
    if (!(yield* fs.exists(versionsDir))) return;
    for (const name of yield* fs.readDirectory(versionsDir)) {
      if (/^\d+\.\d+\.\d+\+git\.[a-f0-9]{40}$/.test(name) && !keep.includes(name)) {
        yield* fs.remove(path.join(versionsDir, name), { recursive: true });
      }
    }
  }, Effect.mapError(sourceUpdateFailure));
  return { discover, prepare, installed, cleanup };
});
