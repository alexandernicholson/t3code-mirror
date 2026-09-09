import {
  ReviewerError,
  type ReviewerAction,
  type ReviewerFinding,
  type ReviewerGenerateNameInput,
  type ReviewerOptimizeInput,
  type ReviewerRun,
} from "@t3tools/contracts";
import { Context, Crypto, DateTime, Effect, Fiber, Layer, Option, Schema } from "effect";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { makeTextGenerationFromRegistry } from "../textGeneration/TextGeneration.ts";
import { ReviewerRunner } from "./ReviewerRunner.ts";
import { ReviewerStore } from "./ReviewerStore.ts";

const isReviewerError = Schema.is(ReviewerError);

export const make = Effect.gen(function* () {
  const store = yield* ReviewerStore;
  const runner = yield* ReviewerRunner;
  const snapshots = yield* ProjectionSnapshotQuery;
  const providerInstances = yield* ProviderInstanceRegistry;
  const settings = yield* ServerSettingsService;
  const crypto = yield* Crypto.Crypto;
  const scope = yield* Effect.scope;
  const textGeneration = makeTextGenerationFromRegistry(providerInstances);
  const workers = new Map<string, Fiber.Fiber<void>>();
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const fail = (message: string) => new ReviewerError({ message });

  for (const run of yield* store.runningRuns()) {
    yield* store.saveRun({
      ...run,
      status: "failed",
      error: "The server restarted before this review completed. Run it again.",
      completedAt: yield* now,
    });
  }

  const startRun = Effect.fn("Reviewers.startRun")(function* (
    input: Extract<ReviewerAction, { action: "run" }>,
  ) {
    const thread = yield* snapshots.getThreadShellById(input.threadId);
    if (Option.isNone(thread)) return yield* fail("This thread is no longer available.");
    const project = yield* snapshots.getProjectShellById(thread.value.projectId);
    if (Option.isNone(project)) return yield* fail("This project is no longer available.");
    const configuration = yield* store.configuration();
    const definition = configuration.definitions.find((value) => value.id === input.reviewerId);
    if (!definition) return yield* fail("This review rule is no longer available.");
    const createdAt = yield* now;
    const run: ReviewerRun = {
      id: yield* crypto.randomUUIDv4,
      threadId: input.threadId,
      reviewerId: definition.id,
      reviewerName: definition.name,
      status: "running",
      depth: input.depth,
      summary: "",
      error: null,
      createdAt,
      completedAt: null,
    };
    yield* store.saveRun(run);
    const cwd = thread.value.worktreePath ?? project.value.workspaceRoot;
    const work = runner
      .review({
        modelSelection: input.modelSelection,
        cwd,
        prompt: definition.prompt,
        depth: input.depth,
      })
      .pipe(
        Effect.flatMap((output) =>
          Effect.gen(function* () {
            const completedAt = yield* now;
            const findings: ReviewerFinding[] = [];
            for (const finding of output.findings) {
              findings.push({
                id: yield* crypto.randomUUIDv4,
                runId: run.id,
                threadId: run.threadId,
                reviewerId: run.reviewerId,
                reviewerName: run.reviewerName,
                severity: finding.severity,
                title: finding.title,
                body: finding.body,
                filePath: finding.filePath,
                line: finding.line,
                dismissed: false,
                createdAt: completedAt,
              });
            }
            yield* store.replaceRunFindings(run.id, run.threadId, findings);
            yield* store.saveRun({
              ...run,
              status: "completed",
              summary: output.summary,
              completedAt,
            });
          }),
        ),
        Effect.catch((cause) =>
          Effect.gen(function* () {
            yield* store.saveRun({
              ...run,
              status: "failed",
              error: isReviewerError(cause) ? cause.message : "Review failed.",
              completedAt: yield* now,
            });
          }),
        ),
        Effect.ensuring(Effect.sync(() => workers.delete(run.id))),
        Effect.catchCause((cause) =>
          Effect.logWarning("Reviewer result could not be saved", cause),
        ),
      );
    const fiber = yield* Effect.forkIn(work, scope, { startImmediately: false });
    workers.set(run.id, fiber);
  });

  const action = Effect.fn("Reviewers.action")(
    function* (input: ReviewerAction) {
      if (input.action === "run") return yield* startRun(input);
      const finding = yield* store.findingById(input.findingId);
      if (!finding || finding.threadId !== input.threadId)
        return yield* fail("This review finding is no longer available.");
      yield* store.saveFinding({ ...finding, dismissed: input.action === "dismiss" });
    },
    Effect.mapError(
      (cause) =>
        new ReviewerError({
          message: isReviewerError(cause) ? cause.message : "Could not update the review.",
        }),
    ),
  );

  const optimize = Effect.fn("Reviewers.optimize")(
    function* (input: typeof ReviewerOptimizeInput.Type) {
      return yield* runner.optimize(input);
    },
    Effect.mapError(
      (cause) =>
        new ReviewerError({
          message: isReviewerError(cause) ? cause.message : "Could not optimize this rule.",
        }),
    ),
  );

  const generateName = Effect.fn("Reviewers.generateName")(
    function* (input: typeof ReviewerGenerateNameInput.Type) {
      const current = yield* settings.getSettings;
      const result = yield* textGeneration.generateThreadTitle({
        cwd: input.cwd,
        message: `Name this reusable code-review rule from its Markdown. Return a short specific title, not a sentence.\n\n${input.markdown}`,
        modelSelection: current.textGenerationModelSelection,
      });
      return { name: result.title.slice(0, 80) };
    },
    Effect.mapError(() => new ReviewerError({ message: "Could not generate a rule name." })),
  );

  return {
    save: store.save,
    subscribe: store.subscribe,
    action,
    optimize,
    generateName,
    drain: Effect.suspend(() =>
      Effect.forEach([...workers.values()], Fiber.await, { discard: true }),
    ),
  };
});

export class Reviewers extends Context.Service<Reviewers, Effect.Success<typeof make>>()(
  "t3/reviewers/Reviewers",
) {}

export const layer = Layer.effect(Reviewers, make);
