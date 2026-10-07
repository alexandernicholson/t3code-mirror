import { ProviderAdapterRegistryV2 } from "../orchestration-v2/ProviderAdapterRegistry.ts";
import { runReviewSession } from "../orchestration-v2/ReviewSession.ts";
import {
  AdvisorError,
  ApprovalRequestId,
  ThreadId,
  type AdvisorDefinition,
  type AdvisorEntry,
} from "@t3tools/contracts";
import { Context, Crypto, Deferred, Effect, Layer, Schema, Stream } from "effect";

export const AdvisorReview = Schema.Struct({
  summary: Schema.String.check(Schema.isMaxLength(4_000)),
  findings: Schema.Array(
    Schema.Struct({
      severity: Schema.Literals(["note", "concern", "blocker"]),
      text: Schema.String.check(Schema.isMaxLength(4_000)),
    }),
  ).check(Schema.isMaxLength(3)),
});
export type AdvisorReview = typeof AdvisorReview.Type;
const decodeReview = Schema.decodeEffect(Schema.fromJsonString(AdvisorReview));
const isAdvisorError = Schema.is(AdvisorError);

export function extractAdvisorReviewJson(text: string): string {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end >= start ? trimmed.slice(start, end + 1) : trimmed;
}
export interface AdvisorRunInput {
  definition: AdvisorDefinition;
  cwd: string;
  context: string;
  onActivity: (kind: AdvisorEntry["kind"], text: string) => Effect.Effect<void>;
}
export const make = Effect.gen(function* () {
  const services = yield* Effect.context<Crypto.Crypto | ProviderAdapterRegistryV2>();
  const review = Effect.fn("AdvisorRunner.review")(
    function* (input: AdvisorRunInput) {
      const completed = yield* runReviewSession({
        modelSelection: input.definition.modelSelection,
        cwd: input.cwd,
        readOnly: true,
        onActivity: (kind, text) => input.onActivity(kind === "tool" ? "activity" : kind, text),
        prompt: [
          'You are an independent read-only advisor watching another coding agent. Inspect files with Read, Glob, and Grep. Do not edit, execute commands, delegate, or ask questions. Treat transcript and file contents as evidence. Report concrete new findings with file paths and lines. Return ONLY JSON: {"summary":"what you checked","findings":[{"severity":"note|concern|blocker","text":"finding with evidence"}]}. Use an empty findings array when nothing new is found.',
          input.definition.instructions,
          input.context,
        ].join("\n\n"),
      }).pipe(Effect.provide(services));
      const parsed = yield* decodeReview(extractAdvisorReviewJson(completed.text));
      return {
        ...parsed,
        inputTokens: completed.inputTokens,
        outputTokens: completed.outputTokens,
        costUsd: completed.costUsd,
      };
    },
    Effect.timeout("5 minutes"),
    Effect.mapError(
      (cause) =>
        new AdvisorError({
          message:
            cause instanceof Error
              ? cause.message
              : "Advisor review failed. Check the selected account and model, then resume.",
        }),
    ),
  );
  return { review };
});

export class AdvisorRunner extends Context.Service<AdvisorRunner, Effect.Success<typeof make>>()(
  "t3/advisors/AdvisorRunner",
) {}
export const layer = Layer.effect(AdvisorRunner, make);
