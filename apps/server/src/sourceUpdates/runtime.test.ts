import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import { ServerConfig, layerTest } from "../config.ts";
import { ProcessRunner, layer as runnerLayer } from "../processRunner.ts";
import { makeSourceRuntime } from "./runtime.ts";

it.layer(NodeServices.layer)("source runtime discovery", (it) => {
  it.effect(
    "pins Git discovery and leaves the running runtime intact when installation fails",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-source-runtime-test-" });
        const repo = path.join(root, "repo");
        const base = path.join(root, "home");
        const runner = yield* ProcessRunner.pipe(Effect.provide(runnerLayer));
        const git = (args: string[]) =>
          runner
            .run({ command: "git", args, cwd: repo })
            .pipe(
              Effect.flatMap((result) =>
                result.code === 0
                  ? Effect.succeed(result.stdout.trim())
                  : Effect.die(result.stderr),
              ),
            );
        yield* fs.makeDirectory(repo);
        yield* git(["init", "--initial-branch=main"]);
        yield* fs.writeFileString(path.join(repo, "VERSION"), "0.1.0\n");
        yield* fs.writeFileString(
          path.join(repo, "CHANGELOG.md"),
          "## [0.1.0] - 2026-09-08\n\n- Initial\n",
        );
        yield* git(["add", "."]);
        yield* git([
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.com",
          "commit",
          "-m",
          "initial",
        ]);
        const previous = yield* git(["rev-parse", "HEAD"]);
        yield* fs.writeFileString(path.join(repo, "VERSION"), "0.1.1\n");
        yield* fs.writeFileString(
          path.join(repo, "CHANGELOG.md"),
          "## [0.1.1] - 2026-09-08\n\n- Update\n\n---\n\n## [0.1.0] - 2026-09-08\n\n- Initial\n",
        );
        yield* git(["add", "."]);
        yield* git([
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.com",
          "commit",
          "-m",
          "update",
        ]);
        const commit = yield* git(["rev-parse", "HEAD"]);
        const config = yield* ServerConfig.pipe(Effect.provide(layerTest(repo, base)));
        const runningVersion = `0.1.0+git.${previous}`;
        const sentinel = path.join(base, "runtime/versions", runningVersion, ".install-complete");
        yield* fs.makeDirectory(path.dirname(sentinel), { recursive: true });
        yield* fs.writeFileString(sentinel, runningVersion);
        const runtime = yield* makeSourceRuntime({
          version: "0.1.0",
          runtimeVersion: runningVersion,
          branch: "main",
          commit: previous,
          repository: repo,
          migrations: {},
        }).pipe(
          Effect.provideService(ServerConfig, config),
          Effect.provideService(ProcessRunner, {
            run: (input) =>
              input.command === "flock"
                ? Effect.succeed({
                    code: ChildProcessSpawner.ExitCode(1),
                    stdout: "",
                    stderr: "fixture install failure",
                    timedOut: false,
                    stdoutTruncated: false,
                    stderrTruncated: false,
                    stdoutInvalidUtf8: false,
                    stderrInvalidUtf8: false,
                  })
                : runner.run(input),
          }),
        );
        const target = yield* runtime.discover("main");
        expect(target.commit).toBe(commit);
        expect(target.divergent).toBe(false);
        expect(target.notes).toContain("Update");
        expect(target.notes).not.toContain("Initial");
        const error = yield* runtime.prepare(target).pipe(Effect.flip);
        expect(error.message).toContain("flock failed");
        expect(yield* fs.readFileString(sentinel)).toBe(runningVersion);
        expect(yield* runtime.installed(target)).toBe(false);
        const invalidBranch = yield* runtime.discover("--upload-pack=other").pipe(Effect.flip);
        expect(invalidBranch.message).toContain("valid branch");
      }),
  );
});
