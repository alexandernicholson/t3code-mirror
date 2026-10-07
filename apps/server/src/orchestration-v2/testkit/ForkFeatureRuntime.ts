import { makeReviewAdapter } from "./ReviewAdapter.ts";
import { ProviderSessionManagerV2 } from "../ProviderSessionManager.ts";
import {
  CommandId,
  EventId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  ProviderTurnId,
  RunAttemptId,
  RunId,
  ThreadId,
  type ModelSelection,
} from "@t3tools/contracts";
import { DateTime, Effect, Layer } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as Sqlite from "../../persistence/Sqlite.ts";
import * as EventStore from "../EventStore.ts";
import * as EventSink from "../EventSink.ts";
import * as ProjectionStore from "../ProjectionStore.ts";
import * as ProjectStore from "../ProjectStore.ts";
import * as Orchestrator from "../Orchestrator.ts";
import * as ForkRuntime from "../ForkThreadRuntime.ts";
import * as Registry from "../ProviderAdapterRegistry.ts";
import * as Replay from "./ProviderReplayHarness.ts";
import { CodexProviderCapabilitiesV2 } from "../Adapters/CodexAdapterV2.ts";
import type { ProviderAdapterV2Shape } from "../ProviderAdapter.ts";

const adapters = ["codex", "claudeAgent"].map((id): ProviderAdapterV2Shape => ({
  instanceId: ProviderInstanceId.make(id),
  driver: ProviderDriverKind.make(id),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
  openSession: (input) =>
    Effect.gen(function* () {
      const fixture = yield* makeReviewAdapter({ text: "", driver: id });
      return yield* fixture.adapter.openSession(input);
    }),
}));
const database = Sqlite.layerMemory;
const stores = Layer.mergeAll(EventStore.layer, ProjectionStore.layer, ProjectStore.layer).pipe(
  Layer.provideMerge(database),
);
const runtime = Replay.layerWithRegistry(
  { name: "fork-feature" },
  Registry.layerFromAdapters(adapters),
  { databaseLayer: database, runEffectWorker: false },
);
export const layer = ForkRuntime.layer.pipe(Layer.provideMerge(Layer.mergeAll(runtime, stores)));

/** Seed a real V2 conversation without running a provider process. */
export const seedThread = Effect.fn("ForkFeatureRuntime.seedThread")(function* (input: {
  threadId: ThreadId;
  projectId: ProjectId;
  cwd: string;
  title: string;
  modelSelection: ModelSelection;
  active: boolean;
}) {
  const sql = yield* SqlClient.SqlClient;
  const engine = yield* Orchestrator.OrchestratorV2;
  const sink = yield* EventSink.EventSinkV2;
  const now = yield* DateTime.now;
  const at = DateTime.formatIso(now);
  yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at) VALUES (${input.projectId}, ${input.title}, ${input.cwd}, '[]', ${at}, ${at}, NULL)`;
  yield* engine.dispatch({
    type: "thread.create",
    commandId: CommandId.make(`${input.threadId}:create`),
    threadId: input.threadId,
    projectId: input.projectId,
    title: input.title,
    modelSelection: input.modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdBy: "user",
    creationSource: "web",
  });
  if (input.active) {
    const runId = RunId.make(`${input.threadId}:run`);
    const nodeId = NodeId.make(`${runId}:node`);
    const attemptId = RunAttemptId.make(`${runId}:attempt`);
    const providerThreadId = ProviderThreadId.make(`${runId}:provider-thread`);
    const providerTurnId = ProviderTurnId.make(`${runId}:provider-turn`);
    const providerSessionId = ProviderSessionId.make(`${runId}:session`);
    yield* (yield* ProviderSessionManagerV2).open({
      threadId: input.threadId,
      providerSessionId,
      modelSelection: input.modelSelection,
      runtimePolicy: { cwd: input.cwd, runtimeMode: "full-access", interactionMode: "default" },
    });
    const base = { threadId: input.threadId, runId, occurredAt: now };
    yield* sink.write({
      events: [
        {
          ...base,
          id: EventId.make(`${runId}:thread-event`),
          type: "provider-thread.updated",
          payload: {
            id: providerThreadId,
            driver: ProviderDriverKind.make("codex"),
            providerInstanceId: input.modelSelection.instanceId,
            providerSessionId,
            appThreadId: input.threadId,
            ownerNodeId: null,
            nativeThreadRef: {
              driver: ProviderDriverKind.make("codex"),
              nativeId: "feature-thread",
              strength: "strong",
            },
            nativeConversationHeadRef: null,
            status: "active",
            firstRunOrdinal: 1,
            lastRunOrdinal: 1,
            handoffIds: [],
            forkedFrom: null,
            createdAt: now,
            updatedAt: now,
          },
        },
        {
          ...base,
          id: EventId.make(`${runId}:created`),
          type: "run.created",
          payload: {
            id: runId,
            threadId: input.threadId,
            ordinal: 1,
            providerInstanceId: input.modelSelection.instanceId,
            modelSelection: input.modelSelection,
            providerThreadId,
            userMessageId: MessageId.make(`${runId}:message`),
            rootNodeId: nodeId,
            activeAttemptId: attemptId,
            status: "running",
            requestedAt: now,
            startedAt: now,
            completedAt: null,
            checkpointId: null,
            contextHandoffId: null,
          },
        },
        {
          ...base,
          id: EventId.make(`${runId}:node-event`),
          type: "node.updated",
          payload: {
            id: nodeId,
            threadId: input.threadId,
            runId,
            parentNodeId: null,
            rootNodeId: nodeId,
            kind: "root_turn",
            status: "running",
            countsForRun: true,
            providerThreadId,
            providerTurnId,
            nativeItemRef: null,
            runtimeRequestId: null,
            checkpointScopeId: null,
            startedAt: now,
            completedAt: null,
          },
        },
        {
          ...base,
          id: EventId.make(`${runId}:attempt-event`),
          type: "run-attempt.created",
          payload: {
            id: attemptId,
            runId,
            attemptOrdinal: 1,
            rootNodeId: nodeId,
            providerInstanceId: input.modelSelection.instanceId,
            providerThreadId,
            providerTurnId,
            reason: "initial",
            status: "running",
            startedAt: now,
            completedAt: null,
          },
        },
        {
          ...base,
          id: EventId.make(`${runId}:turn-event`),
          type: "provider-turn.updated",
          payload: {
            id: providerTurnId,
            providerThreadId,
            nodeId,
            runAttemptId: attemptId,
            nativeTurnRef: {
              driver: ProviderDriverKind.make("codex"),
              nativeId: "feature-turn",
              strength: "strong",
            },
            ordinal: 1,
            status: "running",
            startedAt: now,
            completedAt: null,
          },
        },
        {
          ...base,
          id: EventId.make(`${runId}:session-event`),
          type: "provider-session.updated",
          payload: {
            id: providerSessionId,
            driver: ProviderDriverKind.make("codex"),
            providerInstanceId: input.modelSelection.instanceId,
            status: "running",
            cwd: input.cwd,
            model: input.modelSelection.model,
            lastError: null,
            capabilities: CodexProviderCapabilitiesV2,
            createdAt: now,
            updatedAt: now,
          },
        },
      ],
    });
  }
});
