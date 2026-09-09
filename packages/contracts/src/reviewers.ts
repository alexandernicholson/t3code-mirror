import { Schema } from "effect";
import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./orchestration.ts";

export const ReviewerDefinition = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
  category: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
  description: Schema.String.check(Schema.isMaxLength(240)),
  createdAt: IsoDateTime,
  sourceUrl: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(1_000))),
  modelSelection: Schema.NullOr(ModelSelection),
  prompt: Schema.String.check(Schema.isMaxLength(16_000)),
});
export type ReviewerDefinition = typeof ReviewerDefinition.Type;

export const ReviewerConfiguration = Schema.Struct({
  revision: Schema.Int,
  definitions: Schema.Array(ReviewerDefinition).check(Schema.isMaxLength(64)),
  optimizerModelSelection: Schema.NullOr(ModelSelection),
});
export type ReviewerConfiguration = typeof ReviewerConfiguration.Type;

export const ReviewerRun = Schema.Struct({
  id: TrimmedNonEmptyString,
  threadId: ThreadId,
  reviewerId: TrimmedNonEmptyString,
  reviewerName: TrimmedNonEmptyString,
  status: Schema.Literals(["running", "completed", "failed"]),
  depth: Schema.Literals(["quick", "deep"]),
  summary: Schema.String,
  error: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
});
export type ReviewerRun = typeof ReviewerRun.Type;

export const ReviewerFinding = Schema.Struct({
  id: TrimmedNonEmptyString,
  runId: TrimmedNonEmptyString,
  threadId: ThreadId,
  reviewerId: TrimmedNonEmptyString,
  reviewerName: TrimmedNonEmptyString,
  severity: Schema.Literals(["note", "concern", "blocker"]),
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(240)),
  body: Schema.String.check(Schema.isMaxLength(4_000)),
  filePath: Schema.NullOr(Schema.String.check(Schema.isMaxLength(1_000))),
  line: Schema.NullOr(Schema.Int),
  dismissed: Schema.Boolean,
  createdAt: IsoDateTime,
});
export type ReviewerFinding = typeof ReviewerFinding.Type;

export const ReviewerSubscriptionInput = Schema.Struct({
  threadId: Schema.optional(ThreadId),
});
export const ReviewerSnapshot = Schema.Struct({
  configuration: ReviewerConfiguration,
  runs: Schema.Array(ReviewerRun),
  findings: Schema.Array(ReviewerFinding),
});
export type ReviewerSnapshot = typeof ReviewerSnapshot.Type;

export const ReviewerAction = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("run"),
    threadId: ThreadId,
    reviewerId: TrimmedNonEmptyString,
    modelSelection: ModelSelection,
    depth: Schema.Literals(["quick", "deep"]),
  }),
  Schema.Struct({
    action: Schema.Literals(["dismiss", "restore"]),
    threadId: ThreadId,
    findingId: TrimmedNonEmptyString,
  }),
]);
export type ReviewerAction = typeof ReviewerAction.Type;

export const ReviewerOptimizeInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  markdown: Schema.String.check(Schema.isMaxLength(16_000)),
  modelSelection: ModelSelection,
});
export const ReviewerOptimizeResult = Schema.Struct({
  markdown: Schema.String.check(Schema.isMaxLength(16_000)),
});

export const ReviewerGenerateNameInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  markdown: Schema.String.check(Schema.isMaxLength(16_000)),
});
export const ReviewerGenerateNameResult = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
});

export class ReviewerError extends Schema.TaggedError<ReviewerError>()("ReviewerError", {
  message: Schema.String,
}) {}

const standardsPrelude =
  "Detect the languages, frameworks, build system, and test tooling in this repository. Apply their current official conventions and established project patterns. Inspect the relevant implementation and tests, run focused commands, and consult primary documentation or dependency source when behavior is uncertain. Do not modify the project: return a review with evidence, file and line references, commands run, concrete findings ordered by severity, and focused remediation advice. Say explicitly when no material issue is found.";

export const DEFAULT_REVIEWER_DEFINITIONS: readonly ReviewerDefinition[] = [
  {
    id: "test-strategy",
    name: "Test strategy",
    category: "Testing standards",
    description: "Coverage across the full test pyramid and release risk.",
    createdAt: "2026-09-09T00:00:00.000Z",
    modelSelection: null,
    prompt: `${standardsPrelude}\n\nReview the overall verification strategy. Map changed behavior to unit, integration, regression, non-functional, security, concurrency, and acceptance coverage. Find risky gaps, duplicated low-value tests, brittle test boundaries, and missing failure-path or rollback evidence. Judge the strategy proportionally to the change rather than demanding every test category mechanically.`,
  },
  {
    id: "unit-tests",
    name: "Unit tests",
    category: "Testing standards",
    description: "Fast code-level correctness and boundary coverage.",
    createdAt: "2026-09-09T00:00:00.000Z",
    modelSelection: null,
    prompt: `${standardsPrelude}\n\nReview unit-test quality and sufficiency. Check observable behavior, boundary values, error paths, state transitions, determinism, isolation, and meaningful assertions. Flag tests that merely mirror implementation, assert wiring or static markup, depend on timing, over-mock collaborators, or miss language-specific hazards. Run the smallest relevant unit-test set.`,
  },
  {
    id: "qa-regression",
    name: "QA & regression",
    category: "Testing standards",
    description: "Previously working behavior and realistic regression paths.",
    createdAt: "2026-09-09T00:00:00.000Z",
    modelSelection: null,
    prompt: `${standardsPrelude}\n\nPerform a regression-focused QA review. Identify existing workflows and compatibility guarantees touched by the change, then exercise realistic happy paths, failure paths, upgrades, reverse actions, and cross-surface or cross-provider variants that apply. Look for stale state, partial rollout behavior, backwards-compatibility breaks, and defects hidden by narrow new tests.`,
  },
  {
    id: "functional-integration",
    name: "Functional & integration",
    category: "Testing standards",
    description: "Contracts and behavior across component boundaries.",
    createdAt: "2026-09-09T00:00:00.000Z",
    modelSelection: null,
    prompt: `${standardsPrelude}\n\nReview functional and integration behavior across real boundaries: API or wire contracts, persistence, processes, filesystem, network, provider adapters, and clients. Verify setup and teardown, error propagation, retries or idempotency where applicable, and end-to-end observable outcomes. Prefer focused integration tests over mocked replicas of the implementation.`,
  },
  {
    id: "non-functional-performance",
    name: "Non-functional performance",
    category: "Testing standards",
    description: "Latency, throughput, memory, I/O, and resource behavior.",
    createdAt: "2026-09-09T00:00:00.000Z",
    modelSelection: null,
    prompt: `${standardsPrelude}\n\nReview non-functional performance. Inspect algorithmic complexity, render and allocation frequency, payload sizes, I/O and network amplification, caching, batching, backpressure, cleanup, and hot-path blocking. Measure representative behavior when practical and distinguish measured regressions from hypotheses. Include scale assumptions and the metric or budget each finding threatens.`,
  },
  {
    id: "benchmarking",
    name: "Benchmarking",
    category: "Testing standards",
    description: "Reproducible baselines and statistically useful comparisons.",
    createdAt: "2026-09-09T00:00:00.000Z",
    modelSelection: null,
    prompt: `${standardsPrelude}\n\nReview benchmark design and results. Check that workloads are representative, baselines and environments are controlled, warmup and sampling are sufficient, variance is reported, optimizers cannot erase the measured work, and comparisons isolate the intended change. Run existing benchmarks when feasible and report reproducible commands plus uncertainty, not just a single fastest number.`,
  },
  {
    id: "security-fuzz",
    name: "Security & fuzzing",
    category: "Testing standards",
    description: "Trust boundaries, abuse cases, and generated adversarial input.",
    createdAt: "2026-09-09T00:00:00.000Z",
    modelSelection: null,
    prompt: `${standardsPrelude}\n\nPerform a defensive security and fuzzing review. Threat-model changed trust boundaries; inspect authentication, authorization, injection, traversal, secret handling, unsafe deserialization, resource exhaustion, supply-chain use, and platform-specific escaping. Use safe local fuzzing or property tests for parsers and boundary-heavy logic where useful. Do not attack external systems or expose real secrets.`,
  },
  {
    id: "concurrency-correctness",
    name: "Concurrency & correctness",
    category: "Testing standards",
    description: "Races, ordering, cancellation, atomicity, and invariants.",
    createdAt: "2026-09-09T00:00:00.000Z",
    modelSelection: null,
    prompt: `${standardsPrelude}\n\nReview concurrency and correctness. Identify shared state and invariants, then inspect ordering, atomicity, cancellation, retries, duplicate delivery, stale writes, locks, transactions, lifecycle cleanup, and disconnect or restart behavior. Exercise deterministic race scenarios when the project supports them; reject sleep-based evidence. Explain a concrete interleaving for every claimed race.`,
  },
  {
    id: "uat",
    name: "User acceptance",
    category: "Testing standards",
    description: "Requirements and real user workflows across supported surfaces.",
    createdAt: "2026-09-09T00:00:00.000Z",
    modelSelection: null,
    prompt: `${standardsPrelude}\n\nPerform a user-acceptance review against the stated task and product conventions. Walk the complete user workflows, including discoverability, empty/loading/error states, accessibility, reversibility, permissions, remote use, and applicable web, desktop, and mobile surfaces. Separate requirement failures from polish suggestions and describe exact reproduction steps for each finding.`,
  },
  {
    id: "thermo-nuclear-quality",
    name: "Thermo-nuclear code quality",
    category: "Cursor Team Kit",
    description: "Strict structural simplicity, maintainability, and abstraction review.",
    createdAt: "2026-09-09T00:00:00.000Z",
    sourceUrl:
      "https://github.com/cursor/plugins/tree/main/cursor-team-kit/skills/thermo-nuclear-code-quality-review",
    modelSelection: null,
    prompt: `${standardsPrelude}\n\nPerform an unusually strict maintainability review. Search for a structural simplification that deletes concepts, branches, wrappers, casts, or layers instead of polishing them. Flag spaghetti growth, misplaced ownership, shallow abstractions, duplicated canonical helpers, non-atomic orchestration, and unjustified file-size growth. Prefer a small number of high-conviction structural findings over cosmetic nits. Adapted from Cursor Team Kit's MIT-licensed Thermo-Nuclear Code Quality Review.`,
  },
  {
    id: "standards-and-spec",
    name: "Standards & spec",
    category: "Matt Pocock",
    description: "Separates repository-standard findings from intent/spec failures.",
    createdAt: "2026-09-09T00:00:00.000Z",
    sourceUrl: "https://github.com/mattpocock/skills/tree/main/skills/engineering/code-review",
    modelSelection: null,
    prompt: `${standardsPrelude}\n\nReview the diff on two deliberately separate axes. Standards: find violations of documented repository rules and high-confidence design smells, letting explicit repo guidance win. Spec: find missing or partial requirements, scope creep, and implementations that contradict the originating intent or acceptance criteria. Never let strength on one axis mask failure on the other; report separate Standards and Spec sections. Adapted from Matt Pocock's MIT-licensed code-review skill.`,
  },
  {
    id: "deep-module-design",
    name: "Deep module design",
    category: "Matt Pocock",
    description: "Interface depth, clean seams, locality, and testability.",
    createdAt: "2026-09-09T00:00:00.000Z",
    sourceUrl: "https://github.com/mattpocock/skills/tree/main/skills/engineering/codebase-design",
    modelSelection: null,
    prompt: `${standardsPrelude}\n\nReview for deep modules: substantial useful behavior behind a small interface at a clean seam. Identify shallow pass-through layers, interfaces that expose implementation knowledge, scattered changes that reduce locality, dependencies created inside logic, and seams invented before two implementations exist. Apply the deletion test: if removing an abstraction would remove complexity rather than move it to callers, question whether it earns its keep. Adapted from Matt Pocock's MIT-licensed codebase-design skill.`,
  },
  {
    id: "test-quality-loop",
    name: "Test quality loop",
    category: "Matt Pocock",
    description: "Behavioral tests, useful seams, and red-green feedback quality.",
    createdAt: "2026-09-09T00:00:00.000Z",
    sourceUrl: "https://github.com/mattpocock/skills/tree/main/skills/engineering/tdd",
    modelSelection: null,
    prompt: `${standardsPrelude}\n\nReview whether tests verify behavior through public seams and would survive an internal refactor. Flag implementation-coupled mocks, tautological expectations, timing-based synchronization, static-markup assertions, and broad horizontal test batches that never prove a vertical capability. Check that failures would give a fast, deterministic feedback loop and that expected values come from the requirement rather than recomputing the implementation. Adapted from Matt Pocock's MIT-licensed TDD skill.`,
  },
];

export function defaultReviewerConfiguration(): ReviewerConfiguration {
  return {
    revision: 0,
    definitions: DEFAULT_REVIEWER_DEFINITIONS.map((definition) => ({ ...definition })),
    optimizerModelSelection: null,
  };
}

export function reviewerRuleFileName(name: string, createdAt: string): string {
  const slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "review-rule";
  const stamp = createdAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${slug}-${stamp}.md`;
}

export function reviewerLaunchPrompt(
  definition: ReviewerDefinition,
  context: { threadTitle: string; branch: string | null },
): string {
  const target = [
    `Review the current worktree as the **${definition.name}** reviewer.`,
    context.threadTitle.trim() ? `Originating task: ${context.threadTitle.trim()}` : "",
    context.branch ? `Branch: ${context.branch}` : "",
    "Review the work already present. Do not implement fixes unless the user explicitly asks after reading the review.",
  ]
    .filter(Boolean)
    .join("\n");
  return `${target}\n\n${definition.prompt.trim()}`;
}
