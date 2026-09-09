import {
  ReviewerConfiguration,
  ReviewerError,
  ReviewerFinding,
  ReviewerRun,
  defaultReviewerConfiguration,
  type ReviewerSubscriptionInput,
} from "@t3tools/contracts";
import { Context, Effect, Layer, Schema, Semaphore, Stream, SubscriptionRef } from "effect";
import { SqlClient } from "effect/unstable/sql";

const decodeConfiguration = Schema.decodeEffect(Schema.fromJsonString(ReviewerConfiguration));
const encodeConfiguration = Schema.encodeEffect(Schema.fromJsonString(ReviewerConfiguration));
const decodeRun = Schema.decodeEffect(Schema.fromJsonString(ReviewerRun));
const encodeRun = Schema.encodeEffect(Schema.fromJsonString(ReviewerRun));
const decodeFinding = Schema.decodeEffect(Schema.fromJsonString(ReviewerFinding));
const encodeFinding = Schema.encodeEffect(Schema.fromJsonString(ReviewerFinding));
const isReviewerError = Schema.is(ReviewerError);

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const changes = yield* SubscriptionRef.make<Readonly<Record<string, number>>>({
    configuration: 0,
  });
  const mutex = yield* Semaphore.make(1);

  const configuration = Effect.fn("ReviewerStore.configuration")(function* () {
    const rows = yield* sql<{ body: string }>`SELECT body FROM reviewer_configuration WHERE id = 1`;
    return rows[0] ? yield* decodeConfiguration(rows[0].body) : defaultReviewerConfiguration();
  });

  const save = Effect.fn("ReviewerStore.save")(
    function* (input: ReviewerConfiguration) {
      const current = yield* configuration();
      if (current.revision !== input.revision)
        return yield* new ReviewerError({
          message: "These reviewer settings changed on another device. Reload and try again.",
        });
      if (
        new Set(input.definitions.map((definition) => definition.id)).size !==
        input.definitions.length
      )
        return yield* new ReviewerError({ message: "Each reviewer must have a unique ID." });
      const body = yield* encodeConfiguration({ ...input, revision: input.revision + 1 });
      yield* sql`INSERT INTO reviewer_configuration(id, body) VALUES (1, ${body}) ON CONFLICT(id) DO UPDATE SET body = excluded.body`;
      yield* SubscriptionRef.update(changes, (revisions) => ({
        ...revisions,
        configuration: (revisions.configuration ?? 0) + 1,
      }));
    },
    mutex.withPermits(1),
    Effect.mapError(
      (cause) =>
        new ReviewerError({
          message: isReviewerError(cause) ? cause.message : "Could not save reviewer settings.",
        }),
    ),
  );

  const runs = Effect.fn("ReviewerStore.runs")(function* (threadId: string) {
    const rows = yield* sql<{
      body: string;
    }>`SELECT body FROM reviewer_runs WHERE thread_id = ${threadId} ORDER BY rowid DESC LIMIT 20`;
    return yield* Effect.forEach(rows, (row) => decodeRun(row.body));
  });

  const runningRuns = Effect.fn("ReviewerStore.runningRuns")(function* () {
    const rows = yield* sql<{
      body: string;
    }>`SELECT body FROM reviewer_runs WHERE json_extract(body, '$.status') = 'running'`;
    return yield* Effect.forEach(rows, (row) => decodeRun(row.body));
  });

  const findings = Effect.fn("ReviewerStore.findings")(function* (threadId: string) {
    const rows = yield* sql<{
      body: string;
    }>`SELECT body FROM reviewer_findings WHERE thread_id = ${threadId} ORDER BY rowid DESC LIMIT 600`;
    return yield* Effect.forEach(rows, (row) => decodeFinding(row.body));
  });

  const findingById = Effect.fn("ReviewerStore.findingById")(function* (id: string) {
    const rows = yield* sql<{
      body: string;
    }>`SELECT body FROM reviewer_findings WHERE id = ${id} LIMIT 1`;
    return rows[0] ? yield* decodeFinding(rows[0].body) : null;
  });

  const notifyThread = (threadId: string) =>
    SubscriptionRef.update(changes, (revisions) => ({
      ...revisions,
      [threadId]: (revisions[threadId] ?? 0) + 1,
    }));

  const saveRun = Effect.fn("ReviewerStore.saveRun")(function* (run: ReviewerRun) {
    const body = yield* encodeRun(run);
    yield* sql`INSERT INTO reviewer_runs(id, thread_id, body) VALUES (${run.id}, ${run.threadId}, ${body}) ON CONFLICT(id) DO UPDATE SET body = excluded.body`;
    yield* notifyThread(run.threadId);
  });

  const replaceRunFindings = Effect.fn("ReviewerStore.replaceRunFindings")(function* (
    runId: string,
    threadId: string,
    values: readonly ReviewerFinding[],
  ) {
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`DELETE FROM reviewer_findings WHERE run_id = ${runId}`;
        for (const finding of values) {
          const body = yield* encodeFinding(finding);
          yield* sql`INSERT INTO reviewer_findings(id, run_id, thread_id, body) VALUES (${finding.id}, ${runId}, ${threadId}, ${body})`;
        }
      }),
    );
    yield* notifyThread(threadId);
  });

  const saveFinding = Effect.fn("ReviewerStore.saveFinding")(function* (finding: ReviewerFinding) {
    const body = yield* encodeFinding(finding);
    yield* sql`UPDATE reviewer_findings SET body = ${body} WHERE id = ${finding.id}`;
    yield* notifyThread(finding.threadId);
  });

  const snapshot = Effect.fn("ReviewerStore.snapshot")(function* (
    input: typeof ReviewerSubscriptionInput.Type,
  ) {
    const history = input.threadId ? yield* runs(input.threadId) : [];
    const threadFindings = input.threadId ? yield* findings(input.threadId) : [];
    const latestRunId = history[0]?.id;
    return {
      configuration: yield* configuration(),
      runs: history,
      findings: latestRunId
        ? threadFindings.filter((finding) => finding.runId === latestRunId)
        : [],
    };
  });

  return {
    configuration,
    save,
    runs,
    runningRuns,
    findings,
    findingById,
    saveRun,
    replaceRunFindings,
    saveFinding,
    subscribe: (input: typeof ReviewerSubscriptionInput.Type) =>
      SubscriptionRef.changes(changes).pipe(
        Stream.map(
          (revision) =>
            `${revision.configuration}:${input.threadId ? (revision[input.threadId] ?? 0) : 0}`,
        ),
        Stream.changes,
        Stream.mapEffect(() => snapshot(input)),
        Stream.mapError(() => new ReviewerError({ message: "Reviewer settings are unavailable." })),
      ),
  };
});

export class ReviewerStore extends Context.Service<ReviewerStore, Effect.Success<typeof make>>()(
  "t3/reviewers/ReviewerStore",
) {}

export const layer = Layer.effect(ReviewerStore, make);
