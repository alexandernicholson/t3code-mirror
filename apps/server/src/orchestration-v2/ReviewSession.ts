import * as ManagedMcp from "../mcp/ManagedMcpServers.ts";
import { selectManagedMcpServers } from "@t3tools/contracts";
import { ServerSettingsService } from "../serverSettings.ts";
import {
  MessageId,
  NodeId,
  ProjectId,
  ProviderSessionId,
  RunAttemptId,
  RunId,
  ThreadId,
  type ModelSelection,
  type OrchestrationV2AppThread,
} from "@t3tools/contracts";
import { Crypto, DateTime, Deferred, Effect, Option, Schema, Stream } from "effect";
import { ProviderAdapterRegistryV2 } from "./ProviderAdapterRegistry.ts";
import { ProviderInstanceRegistry } from "../provider/ProviderInstanceRegistry.ts";
import type { ProviderAdapterV2RuntimePolicy } from "./ProviderAdapter.ts";

export class ReviewSessionError extends Schema.TaggedError<ReviewSessionError>()(
  "ReviewSessionError",
  { message: Schema.String },
) {}

/** Run a disposable review through the same V2 adapter as an ordinary thread. */
export const runReviewSession = Effect.fn("runReviewSession")(function* (input: {
  modelSelection: ModelSelection;
  cwd: string;
  prompt: string;
  readOnly: boolean;
  onActivity?: (kind: "activity" | "reasoning" | "tool", text: string) => Effect.Effect<void>;
}) {
  const adapters = yield* ProviderAdapterRegistryV2;
  const instances = yield* Effect.serviceOption(ProviderInstanceRegistry);
  if (Option.isSome(instances)) {
    const instance = yield* instances.value.getInstance(input.modelSelection.instanceId);
    if (!instance?.enabled)
      return yield* new ReviewSessionError({
        message: "Enable the selected review provider in Settings.",
      });
  }
  const adapter = yield* adapters.get(input.modelSelection.instanceId);
  if (input.readOnly && adapter.driver !== "codex" && adapter.driver !== "claudeAgent")
    return yield* new ReviewSessionError({
      message: "This provider does not support read-only advisor sessions.",
    });
  const crypto = yield* Crypto.Crypto;
  const id = `review:${yield* crypto.randomUUIDv4}`;
  const threadId = ThreadId.make(id);
  const runId = RunId.make(id);
  const now = yield* DateTime.now;
  const runtimePolicy: ProviderAdapterV2RuntimePolicy = {
    cwd: input.cwd,
    runtimeMode: "full-access",
    interactionMode: "default",
    approvalPolicy: "never",
    ...(input.readOnly
      ? { sandboxPolicy: { type: "readOnly", access: { type: "fullAccess" } } }
      : {}),
  };
  const appThread: OrchestrationV2AppThread = {
    id: threadId,
    projectId: ProjectId.make("review"),
    title: "Independent review",
    providerInstanceId: input.modelSelection.instanceId,
    modelSelection: input.modelSelection,
    runtimeMode: runtimePolicy.runtimeMode,
    interactionMode: runtimePolicy.interactionMode,
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    createdBy: "system",
    creationSource: "server",
  };
  const settings = yield* Effect.serviceOption(ServerSettingsService);
  if (!input.readOnly && Option.isSome(settings)) {
    const configured = yield* settings.value.getSettings;
    ManagedMcp.setManagedMcpServers(
      threadId,
      selectManagedMcpServers(configured.managedMcpServers, adapter.driver, undefined),
    );
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => ManagedMcp.clearManagedMcpServers(threadId)),
    );
  }
  const runtime = yield* adapter.openSession({
    threadId,
    providerSessionId: ProviderSessionId.make(id),
    modelSelection: input.modelSelection,
    runtimePolicy,
  });
  const messages = new Map<string, string>();
  const completed = yield* Deferred.make<
    { text: string; inputTokens: number; outputTokens: number; costUsd: number },
    ReviewSessionError
  >();
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  const pull = yield* Stream.toPull(runtime.events);
  yield* Stream.fromPull(Effect.succeed(pull)).pipe(
    Stream.runForEach((event) =>
      Effect.gen(function* () {
        if (event.type === "message.updated" && event.message.role === "assistant") {
          messages.set(event.message.id, event.message.text.slice(-80_000));
        } else if (event.type === "turn_item.updated") {
          const item = event.turnItem;
          if (input.onActivity && item.type === "reasoning")
            yield* input.onActivity("reasoning", item.text.slice(-8_000));
          else if (input.onActivity && item.title && item.status === "completed")
            yield* input.onActivity("tool", item.title.slice(-4_000));
        } else if (event.type === "provider_turn.updated") {
          inputTokens =
            event.providerTurn.turnTokenUsage?.inputTokens ??
            event.providerTurn.tokenUsage?.inputTokens ??
            inputTokens;
          outputTokens =
            event.providerTurn.turnTokenUsage?.outputTokens ??
            event.providerTurn.tokenUsage?.outputTokens ??
            outputTokens;
          costUsd = event.providerTurn.costUsd ?? costUsd;
        } else if (
          event.type === "runtime_request.updated" &&
          event.runtimeRequest.status === "pending"
        ) {
          yield* runtime.respondToRuntimeRequest({
            requestId: event.runtimeRequest.id,
            ...(event.runtimeRequest.kind === "user_input"
              ? { answers: {} }
              : { decision: input.readOnly ? "decline" : "accept" }),
          });
        } else if (event.type === "turn.terminal") {
          if (event.status === "completed")
            yield* Deferred.succeed(completed, {
              text: [...messages.values()].join("\n").slice(-80_000),
              inputTokens,
              outputTokens,
              costUsd,
            });
          else
            yield* Deferred.fail(
              completed,
              new ReviewSessionError({
                message:
                  event.status === "failed" ? event.failure.message : "Review was interrupted.",
              }),
            );
        }
      }),
    ),
    Effect.catch((error) =>
      Deferred.fail(completed, new ReviewSessionError({ message: error.message })).pipe(
        Effect.asVoid,
      ),
    ),
    Effect.forkScoped({ startImmediately: true }),
  );
  const providerThread = yield* runtime.ensureThread({
    threadId,
    modelSelection: input.modelSelection,
    runtimePolicy,
  });
  yield* runtime.startTurn({
    appThread,
    threadId,
    runId,
    runOrdinal: 1,
    providerTurnOrdinal: 1,
    attemptId: RunAttemptId.make(id),
    rootNodeId: NodeId.make(id),
    providerThread,
    message: {
      messageId: MessageId.make(id),
      text: input.prompt.slice(0, 115_000),
      attachments: [],
      createdBy: "system",
      creationSource: "server",
    },
    modelSelection: input.modelSelection,
    runtimePolicy,
  });
  return yield* Deferred.await(completed);
}, Effect.scoped);
