import {
  NodeId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  type OrchestrationV2ProviderThread,
} from "@t3tools/contracts";
import { DateTime, Effect, Queue, Stream } from "effect";
import { CodexProviderCapabilitiesV2 } from "../Adapters/CodexAdapterV2.ts";
import type {
  ProviderAdapterV2Event,
  ProviderAdapterV2Shape,
  ProviderAdapterV2RuntimePolicy,
} from "../ProviderAdapter.ts";

/** A review session emits through the same queue the production V2 adapters expose. */
export const makeReviewAdapter = Effect.fn("makeReviewAdapter")(function* (input: {
  text: string;
  driver?: string;
  request?: Extract<ProviderAdapterV2Event, { type: "runtime_request.updated" }>;
}) {
  const events = yield* Queue.unbounded<ProviderAdapterV2Event>();
  const instanceId = ProviderInstanceId.make("codex");
  const driver = ProviderDriverKind.make(input.driver ?? "codex");
  const policies: ProviderAdapterV2RuntimePolicy[] = [];
  const decisions: Array<string | undefined> = [];
  let closed = false;
  const now = yield* DateTime.now;
  let thread: OrchestrationV2ProviderThread;
  const adapter: ProviderAdapterV2Shape = {
    instanceId,
    driver,
    getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
    planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
    openSession: (open) =>
      Effect.gen(function* () {
        policies.push(open.runtimePolicy);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            closed = true;
          }),
        );
        const providerSession = {
          id: open.providerSessionId,
          driver,
          providerInstanceId: instanceId,
          status: "ready" as const,
          cwd: open.runtimePolicy.cwd ?? "/tmp",
          model: open.modelSelection.model,
          lastError: null,
          capabilities: CodexProviderCapabilitiesV2,
          runtimePolicy: open.runtimePolicy,
          nativeSessionRef: null,
          attachedThreadIds: [],
          createdAt: now,
          updatedAt: now,
        };
        return {
          instanceId,
          driver,
          providerSessionId: open.providerSessionId,
          providerSession,
          events: Stream.fromEffectRepeat(Queue.take(events)),
          ensureThread: (ensure) =>
            Effect.sync(() => {
              thread = {
                id: ProviderThreadId.make("review-provider-thread"),
                driver,
                providerInstanceId: instanceId,
                providerSessionId: open.providerSessionId,
                appThreadId: ensure.threadId,
                ownerNodeId: null,
                nativeThreadRef: null,
                nativeConversationHeadRef: null,
                status: "idle",
                firstRunOrdinal: null,
                lastRunOrdinal: null,
                handoffIds: [],
                forkedFrom: null,
                createdAt: now,
                updatedAt: now,
              };
              return thread;
            }),
          resumeThread: () => Effect.succeed(thread),
          startTurn: (turn) =>
            Effect.gen(function* () {
              if (input.request) yield* Queue.offer(events, input.request);
              yield* Queue.offer(events, {
                type: "message.updated",
                driver,
                message: {
                  id: turn.message.messageId,
                  threadId: turn.threadId,
                  runId: turn.runId,
                  nodeId: NodeId.make("review-node"),
                  role: "assistant",
                  text: input.text,
                  attachments: [],
                  streaming: false,
                  createdAt: now,
                  updatedAt: now,
                  createdBy: "agent",
                  creationSource: "provider",
                },
              });
              yield* Queue.offer(events, {
                type: "turn.terminal",
                driver,
                providerThreadId: thread.id,
                providerTurnId: ProviderTurnId.make("review-turn"),
                runOrdinal: 1,
                status: "completed",
                failure: null,
                threadDisposition: "reusable",
              });
            }),
          steerTurn: () => Effect.void,
          interruptTurn: () => Effect.void,
          respondToRuntimeRequest: (response) =>
            Effect.sync(() => {
              decisions.push(response.decision);
            }),
          readThreadSnapshot: () => Effect.die("unused"),
          rollbackThread: () => Effect.die("unused"),
          forkThread: () => Effect.die("unused"),
        };
      }),
  };
  return { adapter, policies, decisions, isClosed: () => closed };
});
