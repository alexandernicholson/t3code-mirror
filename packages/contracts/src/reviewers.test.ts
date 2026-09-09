import { assert, it } from "@effect/vitest";
import {
  DEFAULT_REVIEWER_DEFINITIONS,
  reviewerLaunchPrompt,
  reviewerRuleFileName,
} from "./reviewers.ts";

it("ships one reviewer for every test category in the requested taxonomy", () => {
  assert.deepEqual(
    DEFAULT_REVIEWER_DEFINITIONS.slice(0, 9).map((definition) => definition.id),
    [
      "test-strategy",
      "unit-tests",
      "qa-regression",
      "functional-integration",
      "non-functional-performance",
      "benchmarking",
      "security-fuzz",
      "concurrency-correctness",
      "uat",
    ],
  );
  assert.deepEqual(
    [...new Set(DEFAULT_REVIEWER_DEFINITIONS.map((definition) => definition.category))],
    ["Testing standards", "Cursor Team Kit", "Matt Pocock"],
  );
});

it("turns a rule name and creation time into a stable Markdown filename", () => {
  assert.strictEqual(
    reviewerRuleFileName(" Security & Fuzzing ", "2026-09-09T17:10:05.123Z"),
    "security-fuzzing-20260909T171005Z.md",
  );
});

it("builds an editable review prompt with the originating work context", () => {
  const prompt = reviewerLaunchPrompt(DEFAULT_REVIEWER_DEFINITIONS[1]!, {
    threadTitle: "Add reviewers",
    branch: "feature/reviewers",
  });
  assert.match(prompt, /Unit tests/);
  assert.match(prompt, /Originating task: Add reviewers/);
  assert.match(prompt, /Branch: feature\/reviewers/);
  assert.match(prompt, /Do not implement fixes/);
});
