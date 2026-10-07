import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderInstanceId } from "@t3tools/contracts";
import { Effect } from "effect";
import { make, extractReviewerJson } from "./ReviewerRunner.ts";
import { makeReviewAdapter } from "../orchestration-v2/testkit/ReviewAdapter.ts";
import * as Registry from "../orchestration-v2/ProviderAdapterRegistry.ts";

it.effect("runs a disposable V2 reviewer with full tool access", () =>
  Effect.gen(function* () {
    const fixture = yield* makeReviewAdapter({
      text: '{"summary":"Reviewed changes","findings":[{"severity":"concern","title":"Boundary","body":"The boundary is wrong","filePath":"adult.ts","line":4}]}',
    });
    const runner = yield* make.pipe(Effect.provide(Registry.layerFromAdapters([fixture.adapter])));
    const result = yield* runner.review({
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
      cwd: "/tmp",
      prompt: "Review boundaries",
      depth: "quick",
    });
    assert.equal(result.findings[0]?.filePath, "adult.ts");
    assert.equal(fixture.policies[0]?.runtimeMode, "full-access");
    assert.equal(fixture.policies[0]?.sandboxPolicy, undefined);
    assert.equal(fixture.isClosed(), true);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it("extracts fenced reviewer JSON", () =>
  assert.equal(
    extractReviewerJson('```json\n{"summary":"done","findings":[]}\n```'),
    '{"summary":"done","findings":[]}',
  ));
