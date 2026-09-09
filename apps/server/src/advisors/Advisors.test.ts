import { assert, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import { Effect, FileSystem, Layer } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { AdvisorRunner } from "./AdvisorRunner.ts";
import { advisorOrchestrationTestLayer, runAdvisorTask } from "./orchestrationTestLayer.ts";

for (const [mode, active] of [
  ["observe", true],
  ["guide", true],
  ["guide", false],
] as const) {
  it.effect(
    `${mode} records a completed review and ${mode === "guide" && active ? "submits" : "withholds"} guidance for ${active ? "active" : "finished"} work`,
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "t3-advisor-task-" });
        const { result } = yield* runAdvisorTask({
          cwd,
          name: `${mode}-${active}`,
          active,
          definition: {
            id: "age",
            name: "Age reviewer",
            mode,
            instructions: "Check adult.js",
            modelSelection: {
              instanceId: ProviderInstanceId.make("claudeAgent"),
              model: "claude-fable-5-1",
            },
          },
        });
        assert.strictEqual(result.states[0]?.reviewCount, 1);
        assert.strictEqual(result.states[0]?.status, "watching");
        assert.strictEqual(result.entries.filter((entry) => entry.kind === "finding").length, 1);
        assert.strictEqual(
          result.entries.filter((entry) => entry.kind === "delivery").length,
          mode === "guide" && active ? 1 : 0,
        );
      }).pipe(
        Effect.provide(
          advisorOrchestrationTestLayer.pipe(
            Layer.provide(
              Layer.succeed(AdvisorRunner, {
                review: () =>
                  Effect.succeed({
                    summary: "Checked adult.js",
                    findings: [{ severity: "concern", text: "adult.js:1 excludes age 18." }],
                    inputTokens: 100,
                    outputTokens: 20,
                    costUsd: 0,
                  }),
              }),
            ),
          ),
        ),
        Effect.scoped,
        Effect.provide(NodeServices.layer),
      ),
  );
}
