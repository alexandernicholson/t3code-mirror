import {
  ApprovalRequestId,
  ReviewerError,
  ThreadId,
  type ModelSelection,
} from "@t3tools/contracts";
import { Context, Crypto, Deferred, Effect, Layer, Schema, Stream } from "effect";
import { ProviderAdapterRegistry } from "../provider/Services/ProviderAdapterRegistry.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";

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
  const registry = yield* ProviderAdapterRegistry;
  const providers = yield* ProviderService;
  const crypto = yield* Crypto.Crypto;

  const generate = Effect.fn("ReviewerRunner.generate")(
    function* (input: {
      modelSelection: ModelSelection;
      cwd: string;
      prompt: string;
      timeout: "2 minutes" | "10 minutes";
    }) {
      const info = yield* registry.getInstanceInfo(input.modelSelection.instanceId);
      if (!info.enabled)
        return yield* new ReviewerError({ message: "Enable this reviewer's provider first." });
      const adapter = yield* registry.getByInstance(info.instanceId);
      const threadId = ThreadId.make(`reviewer:${yield* crypto.randomUUIDv4}`);
      const result = yield* Deferred.make<string, ReviewerError>();
      let text = "";
      const pull = yield* Stream.toPull(
        providers.streamEvents.pipe(Stream.filter((event) => event.threadId === threadId)),
      );
      yield* Effect.addFinalizer(() => adapter.stopSession(threadId).pipe(Effect.ignore));
      yield* Stream.fromPull(Effect.succeed(pull)).pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            if (event.type === "content.delta" && event.payload.streamKind === "assistant_text") {
              text = (text + event.payload.delta).slice(-80_000);
            } else if (
              event.type === "item.started" &&
              event.payload.itemType === "assistant_message"
            ) {
              text = "";
            } else if (event.type === "request.opened" && event.requestId) {
              yield* adapter.respondToRequest(
                threadId,
                ApprovalRequestId.make(event.requestId),
                "accept",
              );
            } else if (event.type === "user-input.requested" && event.requestId) {
              yield* adapter.respondToUserInput(
                threadId,
                ApprovalRequestId.make(event.requestId),
                {},
              );
            } else if (event.type === "turn.completed") {
              if (event.payload.state === "completed") yield* Deferred.succeed(result, text);
              else
                yield* Deferred.fail(
                  result,
                  new ReviewerError({
                    message: event.payload.errorMessage ?? "Reviewer run was interrupted.",
                  }),
                );
            } else if (event.type === "runtime.error" || event.type === "session.exited") {
              yield* Deferred.fail(
                result,
                new ReviewerError({ message: "Reviewer session stopped before completing." }),
              );
            }
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      );
      yield* adapter.startSession({
        threadId,
        providerInstanceId: info.instanceId,
        modelSelection: input.modelSelection,
        cwd: input.cwd,
        runtimeMode: "full-access",
        reviewer: false,
      });
      yield* adapter.sendTurn({
        threadId,
        modelSelection: input.modelSelection,
        input: input.prompt.slice(0, 115_000),
      });
      return yield* Deferred.await(result);
    },
    (effect, input) => effect.pipe(Effect.timeout(input.timeout)),
    Effect.scoped,
    Effect.mapError(
      (cause) =>
        new ReviewerError({
          message: isReviewerError(cause)
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
