import { assert, it } from "@effect/vitest";
import { ClaudeSettings, ProviderInstanceId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { ServerConfig } from "../config.ts";
import { makeClaudeAdapter } from "../provider/Layers/ClaudeAdapter.ts";
import { providerServiceTestLayer } from "../provider/testUtils/providerServiceTestLayer.ts";
import { make } from "./ReviewerRunner.ts";

const decodeClaudeSettings = Schema.decodeEffect(ClaudeSettings);

// T3_REVIEW_LIVE_MODEL=claude-fable-5-1 vp test run src/reviewers/ReviewerRunner.live.test.ts
it.live.skipIf(!process.env.T3_REVIEW_LIVE_MODEL)(
  "completes real reviews of a one-line bug and its correction",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-reviewer-live-" });
      const file = path.join(cwd, "adult.js");
      const correct = "export const isAdult = (age) => age >= 18;\n";
      yield* fs.writeFileString(file, correct);
      for (const args of [
        ["init", "--initial-branch=main"],
        ["config", "user.email", "review-test@example.com"],
        ["config", "user.name", "Review test"],
        ["add", "adult.js"],
        ["commit", "-m", "Initial implementation"],
      ]) {
        const exitCode = yield* spawner.exitCode(ChildProcess.make("git", args, { cwd }));
        assert.strictEqual(exitCode, 0);
      }
      const adapter = yield* makeClaudeAdapter(yield* decodeClaudeSettings({})).pipe(
        Effect.provide(ServerConfig.layerTest(cwd, { prefix: "t3-reviewer-runtime-" })),
      );
      const services = yield* Layer.build(providerServiceTestLayer(adapter));
      const runner = yield* make.pipe(Effect.provide(services));
      for (const hasBug of [true, false]) {
        const contents = hasBug ? correct.replace(">=", ">") : correct;
        yield* fs.writeFileString(file, contents);
        const result = yield* runner.review({
          cwd,
          modelSelection: {
            instanceId: ProviderInstanceId.make("claudeAgent"),
            model: process.env.T3_REVIEW_LIVE_MODEL!,
          },
          depth: "quick",
          prompt:
            "Review only adult.js. Its requirement is that all ages 18 and older return true. Inspect git diff against HEAD and the file. Report any broken age boundary. If there are no changes or defects, return no findings. Do not inspect external sources or other directories.",
        });
        assert.ok(result.summary.length > 0);
        if (hasBug)
          assert.ok(
            result.findings.some(
              (finding) => finding.filePath === "adult.js" && finding.body.includes("18"),
            ),
          );
        else assert.deepEqual(result.findings, []);
        assert.strictEqual(yield* fs.readFileString(file), contents);
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { timeout: 300_000 },
);
