import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderInstanceId } from "@t3tools/contracts";
import { Effect, Layer } from "effect";
import { make, extractAdvisorReviewJson } from "./AdvisorRunner.ts";
import { makeReviewAdapter } from "../orchestration-v2/testkit/ReviewAdapter.ts";
import * as Registry from "../orchestration-v2/ProviderAdapterRegistry.ts";

it.effect("uses a disposable read-only V2 session and captures the review", () =>
  Effect.gen(function* () {
    const fixture = yield* makeReviewAdapter({
      text: '{"summary":"Checked the boundary","findings":[{"severity":"concern","text":"The age boundary is off by one."}]}',
    });
    const runner = yield* make.pipe(Effect.provide(Registry.layerFromAdapters([fixture.adapter])));
    const result = yield* runner.review({
      definition: {
        id: "boundary",
        name: "Boundary",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
        instructions: "Check the age boundary",
        mode: "observe",
      },
      cwd: "/tmp",
      context: "Implement isAdult",
      onActivity: () => Effect.void,
    });
    assert.equal(result.findings.length, 1);
    assert.equal(fixture.policies[0]?.runtimeMode, "full-access");
    assert.deepStrictEqual(fixture.policies[0]?.sandboxPolicy, {
      type: "readOnly",
      access: { type: "fullAccess" },
    });
    assert.equal(fixture.isClosed(), true);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it("extracts fenced review JSON", () =>
  assert.equal(
    extractAdvisorReviewJson('```json\n{"summary":"done","findings":[]}\n```'),
    '{"summary":"done","findings":[]}',
  ));
