import { assert, it } from "@effect/vitest";
import { ClaudeSettings, ProviderInstanceId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { ServerConfig } from "../config.ts";
import { makeClaudeAdapter } from "../provider/Layers/ClaudeAdapter.ts";
import { AdvisorRunner, make } from "./AdvisorRunner.ts";
import { providerServiceTestLayer } from "../provider/testUtils/providerServiceTestLayer.ts";
import { advisorOrchestrationTestLayer, runAdvisorTask } from "./orchestrationTestLayer.ts";

const decodeClaudeSettings = Schema.decodeEffect(ClaudeSettings);

// Opt in explicitly: this invokes the installed Claude CLI with its configured account.
// T3_REVIEW_LIVE_MODEL=claude-fable-5-1 vp test run src/advisors/Advisors.live.test.ts
it.live.skipIf(!process.env.T3_REVIEW_LIVE_MODEL)(
  "persists real Claude reviews and submits guidance for small Observer and Advisor tasks",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-advisor-task-" });
      const settings = yield* decodeClaudeSettings({});
      const adapter = yield* makeClaudeAdapter(settings).pipe(
        Effect.provide(ServerConfig.layerTest(cwd, { prefix: "t3-advisor-live-" })),
      );
      const services = yield* Layer.build(providerServiceTestLayer(adapter));
      const runner = yield* make.pipe(Effect.provide(services));
      const orchestration = yield* Layer.build(
        advisorOrchestrationTestLayer.pipe(Layer.provide(Layer.succeed(AdvisorRunner, runner))),
      );
      const definition = {
        id: "age-check",
        name: "Age check",
        modelSelection: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: process.env.T3_REVIEW_LIVE_MODEL!,
        },
        instructions:
          "Review only adult.js. An adult is anyone aged 18 or older. Focus only on correctness of the returned boolean. Read the file before answering.",
        mode: "observe" as const,
      };
      for (const [mode, hasBug] of [
        ["observe", true],
        ["guide", true],
        ["observe", false],
      ] as const) {
        const taskCwd = path.join(cwd, `${mode}-${hasBug}`);
        yield* fs.makeDirectory(taskCwd);
        const file = path.join(taskCwd, "adult.js");
        const contents = `export const isAdult = (age) => age ${hasBug ? ">" : ">="} 18;\n`;
        yield* fs.writeFileString(file, contents);
        const { result } = yield* runAdvisorTask({
          cwd: taskCwd,
          name: `${mode}-${hasBug}`,
          definition: { ...definition, mode },
          active: true,
        }).pipe(Effect.provide(orchestration));
        assert.strictEqual(
          result.states[0]?.reviewCount,
          1,
          result.states[0]?.reason ?? "Review did not finish",
        );
        assert.strictEqual(result.states[0]?.status, "watching");
        const findings = result.entries.filter((entry) => entry.kind === "finding");
        if (hasBug) {
          assert.ok(findings.some((finding) => finding.text.includes("18")));
        } else {
          assert.deepEqual(findings, []);
        }
        assert.strictEqual(
          result.entries.filter((entry) => entry.kind === "delivery").length,
          mode === "guide" ? 1 : 0,
        );
        assert.strictEqual(yield* fs.readFileString(file), contents);
        yield* Effect.logInfo("Advisor real-provider review completed", {
          model: definition.modelSelection.model,
          mode,
          task: hasBug ? "known defect" : "correct implementation",
          reviews: result.states[0]?.reviewCount,
          findings: findings.map((entry) => entry.text),
        });
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { timeout: 960_000 },
);
