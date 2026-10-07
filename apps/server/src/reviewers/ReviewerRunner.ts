import { ProviderAdapterRegistryV2 } from "../orchestration-v2/ProviderAdapterRegistry.ts";
import { runReviewSession } from "../orchestration-v2/ReviewSession.ts";
import {
  ApprovalRequestId,
  ReviewerError,
  ThreadId,
  type ModelSelection,
} from "@t3tools/contracts";
import { Context, Crypto, Deferred, Effect, Layer, Schema, Stream } from "effect";

export const ReviewerOutput = Schema.Struct({
  summary: Schema.String.check(Schema.isMaxLength(4_000)),
  findings: Schema.Array(
    Schema.Struct({
      severity: Schema.Literals(["note", "concern", "blocker"]),
      title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(240)),
      body: Schema.String.check(Schema.isMaxLength(4_000)),
      filePath: Schema.NullOr(Schema.String.check(Schema.isMaxLength(1_000))),
      line: Schema.NullOr(Schema.Int),
    }),
  ).check(Schema.isMaxLength(30)),
});
export type ReviewerOutput = typeof ReviewerOutput.Type;

const OptimizedRule = Schema.Struct({
  markdown: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(16_000)),
});
const decodeReview = Schema.decodeEffect(Schema.fromJsonString(ReviewerOutput));
const decodeOptimizedRule = Schema.decodeEffect(Schema.fromJsonString(OptimizedRule));
const isReviewerError = Schema.is(ReviewerError);

export function extractReviewerJson(text: string): string {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end >= start ? trimmed.slice(start, end + 1) : trimmed;
}

export const make = Effect.gen(function* () {
  const services = yield* Effect.context<Crypto.Crypto | ProviderAdapterRegistryV2>();
  const generate = Effect.fn("ReviewerRunner.generate")(
    function* (input: {
      modelSelection: ModelSelection;
      cwd: string;
      prompt: string;
      timeout: "2 minutes" | "10 minutes";
    }) {
      const result = yield* runReviewSession({ ...input, readOnly: false }).pipe(
        Effect.provide(services),
      );
      return result.text;
    },
    (effect, input) => effect.pipe(Effect.timeout(input.timeout)),
    Effect.mapError(
      (cause) =>
        new ReviewerError({
          message:
            cause instanceof Error
              ? cause.message
              : "Reviewer generation failed. Check the selected provider and model.",
        }),
    ),
  );

  const review = Effect.fn("ReviewerRunner.review")(function* (input: {
    modelSelection: ModelSelection;
    cwd: string;
    prompt: string;
    depth: "quick" | "deep";
  }) {
    const raw = yield* generate({
      ...input,
      timeout: input.depth === "quick" ? "2 minutes" : "10 minutes",
      prompt: [
        "You are a dedicated code-review agent. Inspect the current local changes against their merge base and follow the supplied rule set. You have full tool access: run focused commands, use configured web/MCP tools, and inspect or clone primary library sources when necessary. Do not modify the reviewed workspace. Return ONLY JSON in this shape:",
        '{"summary":"what was reviewed and verified","findings":[{"severity":"note|concern|blocker","title":"concise issue","body":"evidence, impact, and remediation","filePath":"workspace-relative path or null","line":123}]}.',
        "Only report concrete, actionable defects or high-conviction rule violations. Use an empty findings array when no material issue exists. Lines must refer to the new-side line when possible.",
        input.depth === "quick"
          ? "Depth: quick. Prioritize obvious high-impact problems and finish promptly."
          : "Depth: deep. Trace behavior across boundaries, run relevant verification, and investigate subtle failure modes.",
        input.prompt,
      ].join("\n\n"),
    });
    return yield* decodeReview(extractReviewerJson(raw));
  });

  const optimize = Effect.fn("ReviewerRunner.optimize")(function* (input: {
    modelSelection: ModelSelection;
    cwd: string;
    markdown: string;
  }) {
    const raw = yield* generate({
      ...input,
      timeout: "2 minutes",
      prompt: [
        'Rewrite this code-review rule Markdown so another coding agent can apply it reliably. Preserve its intent and non-negotiable constraints, remove ambiguity and repetition, add a crisp scope, evidence requirements, severity guidance, and output expectations. Do not invent organization-specific policy. Return ONLY JSON: {"markdown":"optimized Markdown"}.',
        input.markdown,
      ].join("\n\n"),
    });
    return yield* decodeOptimizedRule(extractReviewerJson(raw));
  });

  return { review, optimize };
});

export class ReviewerRunner extends Context.Service<ReviewerRunner, Effect.Success<typeof make>>()(
  "t3/reviewers/ReviewerRunner",
) {}

export const layer = Layer.effect(ReviewerRunner, make);
