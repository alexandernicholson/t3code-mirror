import { assert, it } from "@effect/vitest";
import {
  CommandId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import type { ProviderAdapterV2Shape } from "./ProviderAdapter.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("codex");
const adapter: ProviderAdapterV2Shape = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
  openSession: () => Effect.die("Checklist edits must not open provider sessions"),
};
const database = SqlitePersistence.layerMemory;
const layerTest = Layer.mergeAll(
  database,
  ProjectionStore.layer.pipe(Layer.provide(database)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "fork-todos" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: database, runEffectWorker: false },
  ),
);

it.effect(
  "persists checklist edits in V2 and rejects stale revisions without replacing user edits",
  () =>
    Effect.gen(function* () {
      const engine = yield* Orchestrator.OrchestratorV2;
      const threadId = ThreadId.make("thread:todos");
      yield* engine.dispatch({
        type: "thread.create",
        commandId: CommandId.make("todos:create"),
        threadId,
        projectId: ProjectId.make("project:todos"),
        title: "TODOs",
        modelSelection: { instanceId, model: "gpt-5.1-codex" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdBy: "user",
        creationSource: "web",
      });
      yield* engine.dispatch({
        type: "thread.metadata.update",
        commandId: CommandId.make("todos:init"),
        threadId,
        todoUpdate: {
          type: "tool",
          operation: { op: "init", items: ["Inspect the fork", "Merge upstream"] },
        },
      });
      const before = (yield* engine.getThreadProjection(threadId)).thread.todos!;
      const items = before.items.map((item, index) =>
        index === 0 ? { ...item, content: "Preserve released migrations" } : item,
      );
      yield* engine.dispatch({
        type: "thread.metadata.update",
        commandId: CommandId.make("todos:edit"),
        threadId,
        todoUpdate: { type: "edit", expectedRevision: before.revision, items },
      });
      const stale = yield* engine
        .dispatch({
          type: "thread.metadata.update",
          commandId: CommandId.make("todos:stale"),
          threadId,
          todoUpdate: { type: "edit", expectedRevision: before.revision, items: before.items },
        })
        .pipe(Effect.result);
      assert.equal(stale._tag, "Failure");
      const reloaded = (yield* engine.getThreadProjection(threadId)).thread.todos!;
      assert.deepStrictEqual(reloaded.items, items);
      assert.equal(reloaded.revision, before.revision + 1);
      assert.equal(reloaded.userEdited, true);
    }).pipe(Effect.provide(layerTest)),
);
