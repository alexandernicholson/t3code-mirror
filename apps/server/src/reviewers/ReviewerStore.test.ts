import { assert, it } from "@effect/vitest";
import { ThreadId, defaultReviewerConfiguration } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { Effect, Layer, Stream } from "effect";
import migration from "../persistence/Migrations/054_Reviewers.ts";
import * as Store from "./ReviewerStore.ts";

const database = NodeSqliteClient.layerMemory();
const layer = Store.layer.pipe(
  Layer.provide(Layer.effectDiscard(migration).pipe(Layer.provideMerge(database))),
);

it.layer(layer)("ReviewerStore", (it) => {
  it.effect("starts with the standard reviewer catalog", () =>
    Effect.gen(function* () {
      const store = yield* Store.ReviewerStore;
      const configuration = yield* store.configuration();
      assert.deepEqual(
        configuration.definitions.map((definition) => definition.id),
        defaultReviewerConfiguration().definitions.map((definition) => definition.id),
      );
    }),
  );

  it.effect("rejects stale writes and publishes accepted settings", () =>
    Effect.gen(function* () {
      const store = yield* Store.ReviewerStore;
      const original = yield* store.configuration();
      yield* store.save({ ...original, definitions: original.definitions.slice(0, 2) });
      const stale = yield* store.save(original).pipe(Effect.result);
      assert.strictEqual(stale._tag, "Failure");
      const snapshot = yield* Stream.runHead(store.subscribe({}));
      assert.strictEqual(snapshot._tag, "Some");
      if (snapshot._tag === "Some") {
        assert.strictEqual(snapshot.value.configuration.revision, 1);
        assert.strictEqual(snapshot.value.configuration.definitions.length, 2);
      }
    }),
  );

  it.effect("persists review runs, findings, and dismissals in thread snapshots", () =>
    Effect.gen(function* () {
      const store = yield* Store.ReviewerStore;
      yield* store.saveRun({
        id: "run-1",
        threadId: ThreadId.make("thread-1"),
        reviewerId: "unit-tests",
        reviewerName: "Unit tests",
        status: "completed",
        depth: "quick",
        summary: "Checked focused tests",
        error: null,
        createdAt: "2026-09-09T10:00:00.000Z",
        completedAt: "2026-09-09T10:01:00.000Z",
      });
      yield* store.replaceRunFindings("run-1", "thread-1", [
        {
          id: "finding-1",
          runId: "run-1",
          threadId: ThreadId.make("thread-1"),
          reviewerId: "unit-tests",
          reviewerName: "Unit tests",
          severity: "concern",
          title: "Missing boundary case",
          body: "Zero is not covered.",
          filePath: "src/value.ts",
          line: 12,
          dismissed: false,
          createdAt: "2026-09-09T10:01:00.000Z",
        },
      ]);
      const finding = (yield* store.findings("thread-1"))[0]!;
      yield* store.saveFinding({ ...finding, dismissed: true });
      const snapshot = yield* Stream.runHead(
        store.subscribe({ threadId: ThreadId.make("thread-1") }),
      );
      assert.strictEqual(snapshot._tag, "Some");
      if (snapshot._tag === "Some") {
        assert.strictEqual(snapshot.value.runs[0]?.summary, "Checked focused tests");
        assert.strictEqual(snapshot.value.findings[0]?.dismissed, true);
      }
    }),
  );
});
