import { assert, it } from "@effect/vitest";
import { Effect, Layer, Stream } from "effect";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { emptyAdvisorConfiguration, ThreadId } from "@t3tools/contracts";
import migration from "../persistence/Migrations/052_Advisors.ts";
import * as Store from "./AdvisorStore.ts";

const database = NodeSqliteClient.layerMemory();
const layer = Store.layer.pipe(
  Layer.provide(Layer.effectDiscard(migration).pipe(Layer.provideMerge(database))),
);
it.layer(layer)("AdvisorStore", (it) => {
  it.effect("rejects stale settings saves and preserves the accepted revision", () =>
    Effect.gen(function* () {
      const store = yield* Store.AdvisorStore;
      const configuration = emptyAdvisorConfiguration({ type: "environment" });
      yield* store.saveConfiguration(configuration);
      const result = yield* store
        .saveConfiguration({ ...configuration, instructions: "stale edit" })
        .pipe(Effect.result);
      assert.strictEqual(result._tag, "Failure");
      assert.strictEqual((yield* store.configurations())[0]?.revision, 1);
      assert.strictEqual((yield* store.configurations())[0]?.instructions, "");
    }),
  );
  it.effect(
    "keeps detailed private activity out of the compact subscription and isolates threads",
    () =>
      Effect.gen(function* () {
        const store = yield* Store.AdvisorStore;
        const threadId = ThreadId.make("private-thread");
        yield* store.append({
          id: "private-entry",
          threadId,
          advisorId: "reviewer",
          advisorName: "Reviewer",
          kind: "reasoning",
          text: "private tool output",
          sourceSequence: 3,
          createdAt: "2026-09-09T00:00:00.000Z",
        });
        const compact = yield* Stream.runHead(store.subscribe({ threadId }));
        assert.strictEqual(compact._tag, "Some");
        if (compact._tag === "Some") assert.deepEqual(compact.value.entries, []);
        assert.deepEqual(yield* store.entries("another-thread"), []);
        const detailed = yield* store.entries(threadId);
        assert.strictEqual(detailed[0]?.text, "private tool output");
        yield* store.removeThread(threadId);
        assert.deepEqual(yield* store.entries(threadId), []);
      }),
  );
});
