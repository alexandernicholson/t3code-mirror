import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { decideOrchestrationCommand } from "./decider.ts";
import { projectEvent } from "./projector.ts";

const now = "2026-09-08T12:00:00.000Z";
const threadId = ThreadId.make("queue-thread");
const turnId = TurnId.make("active-turn");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
function model(): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    updatedAt: now,
    threads: [
      {
        id: threadId,
        projectId: ProjectId.make("project"),
        title: "Queued work",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        pullRequests: [],
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        deletedAt: null,
        messages: [],
        activities: [],
        proposedPlans: [],
        checkpoints: [],
        latestTurn: {
          turnId,
          state: "running",
          requestedAt: now,
          startedAt: now,
          completedAt: null,
          assistantMessageId: null,
        },
        session: {
          threadId,
          status: "running",
          providerName: "codex",
          activeTurnId: turnId,
          runtimeMode: "full-access",
          lastError: null,
          updatedAt: now,
        },
      },
    ],
  };
}
const send = (id: string, delivery: "queue" | "steer" = "queue"): OrchestrationCommand => ({
  type: "thread.turn.start",
  threadId,
  commandId: CommandId.make(`send-${id}`),
  delivery,
  message: { messageId: MessageId.make(id), role: "user", text: id, attachments: [] },
  modelSelection,
  runtimeMode: "full-access",
  interactionMode: "default",
  createdAt: now,
});
const manage = (action: "cancel" | "steer" | "resume", id?: string): OrchestrationCommand => ({
  type: "thread.turn.queue",
  threadId,
  commandId: CommandId.make(`${action}-${id}`),
  action,
  ...(id ? { messageId: MessageId.make(id) } : {}),
  createdAt: now,
});
const drain = (completedTurnId?: TurnId): OrchestrationCommand => ({
  type: "thread.turn.queue.drain",
  threadId,
  commandId: CommandId.make("drain"),
  createdAt: now,
  ...(completedTurnId ? { completedTurnId } : {}),
});
const decide = (readModel: OrchestrationReadModel, command: OrchestrationCommand) =>
  decideOrchestrationCommand({ readModel, command }).pipe(
    Effect.map((result) => (Array.isArray(result) ? result : [result])),
  );
const apply = Effect.fn("apply")(function* (
  readModel: OrchestrationReadModel,
  command: OrchestrationCommand,
) {
  const events = yield* decide(readModel, command);
  let next = readModel;
  for (const event of events)
    next = yield* projectEvent(next, {
      ...event,
      sequence: next.snapshotSequence + 1,
    } as OrchestrationEvent);
  return next;
});
function settle(readModel: OrchestrationReadModel): OrchestrationReadModel {
  return {
    ...readModel,
    threads: readModel.threads.map((thread) => ({
      ...thread,
      latestTurn: { ...thread.latestTurn!, state: "completed", completedAt: now },
      session: { ...thread.session!, status: "ready", activeTurnId: null },
    })),
  };
}

it.layer(NodeServices.layer)("turn queue", (it) => {
  it.effect("keeps queued work out of provider history while steering remains immediate", () =>
    Effect.gen(function* () {
      const queued = yield* apply(model(), send("later"));
      expect(queued.threads[0]?.turnQueue?.items.map((item) => item.text)).toEqual(["later"]);
      expect(queued.threads[0]?.messages).toEqual([]);
      expect((yield* decide(queued, send("now", "steer"))).map((event) => event.type)).toEqual([
        "thread.message-sent",
        "thread.turn-start-requested",
      ]);
      expect(yield* decide(queued, drain())).toEqual([]);
    }),
  );
  it.effect("waits for checkpoint completion and dispatches only the FIFO head", () =>
    Effect.gen(function* () {
      const first = yield* apply(model(), send("first"));
      const queued = settle(yield* apply(first, send("second")));
      expect(yield* decide(queued, drain())).toEqual([]);
      const dispatched = yield* apply(queued, drain(turnId));
      expect(dispatched.threads[0]?.messages.map((message) => message.text)).toEqual(["first"]);
      expect(dispatched.threads[0]?.turnQueue?.items.map((item) => item.text)).toEqual(["second"]);
    }),
  );
  it.effect("records checkpoint readiness when ingestion is still running", () =>
    Effect.gen(function* () {
      const queued = yield* apply(model(), send("later"));
      const ready = yield* apply(queued, drain(turnId));
      expect(ready.threads[0]?.messages).toEqual([]);
      expect(ready.threads[0]?.turnQueue?.completedTurnId).toBe(turnId);
      const dispatched = yield* apply(settle(ready), drain());
      expect(dispatched.threads[0]?.messages[0]?.text).toBe("later");
    }),
  );
  it.effect("stops without restarting queued work and resumes explicitly", () =>
    Effect.gen(function* () {
      const queued = yield* apply(model(), send("later"));
      const stopped = yield* apply(queued, {
        type: "thread.turn.interrupt",
        commandId: CommandId.make("stop"),
        threadId,
        createdAt: now,
      });
      expect(stopped.threads[0]?.turnQueue?.paused).toBe(true);
      const ready = yield* apply(settle(stopped), drain(turnId));
      expect(ready.threads[0]?.messages).toEqual([]);
      const resumed = yield* apply(ready, manage("resume"));
      expect(resumed.threads[0]?.turnQueue?.paused).toBe(false);
      expect(resumed.threads[0]?.messages[0]?.text).toBe("later");
    }),
  );
  it.effect("cancels for editor restoration without sending, rejecting stale takes", () =>
    Effect.gen(function* () {
      const queued = yield* apply(model(), send("edit me"));
      const cancelled = yield* apply(queued, manage("cancel", "edit me"));
      expect(cancelled.threads[0]?.turnQueue?.items).toEqual([]);
      expect(cancelled.threads[0]?.messages).toEqual([]);
      const error = yield* decide(cancelled, manage("cancel", "edit me")).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );
  it.effect("can steer a queued message ahead of remaining work", () =>
    Effect.gen(function* () {
      const queued = yield* apply(yield* apply(model(), send("first")), send("second"));
      const sent = yield* apply(queued, manage("steer", "second"));
      expect(sent.threads[0]?.messages[0]?.text).toBe("second");
      expect(sent.threads[0]?.turnQueue?.items[0]?.text).toBe("first");
    }),
  );
  it.effect("retains attachments and settings until dispatch", () =>
    Effect.gen(function* () {
      const command = {
        ...send("files"),
        message: {
          messageId: MessageId.make("files"),
          role: "user" as const,
          text: "Review this",
          attachments: [
            {
              type: "file" as const,
              id: "file-one",
              name: "notes.md",
              mimeType: "text/markdown",
              sizeBytes: 12,
            },
          ],
        },
        runtimeMode: "approval-required" as const,
        interactionMode: "plan" as const,
      };
      const queued = yield* apply(model(), command);
      expect(queued.threads[0]?.runtimeMode).toBe("full-access");
      const dispatched = yield* apply(settle(queued), drain(turnId));
      expect(dispatched.threads[0]?.messages[0]?.attachments).toEqual(command.message.attachments);
      expect(dispatched.threads[0]?.runtimeMode).toBe("approval-required");
      expect(dispatched.threads[0]?.interactionMode).toBe("plan");
    }),
  );
  it.effect("rejects queued commands and bounded queue overflow", () =>
    Effect.gen(function* () {
      const command = send("/compact");
      expect((yield* decide(model(), command).pipe(Effect.flip))._tag).toBe(
        "OrchestrationCommandInvariantError",
      );
      let queued = model();
      for (let index = 0; index < 20; index++) queued = yield* apply(queued, send(String(index)));
      expect((yield* decide(queued, send("overflow")).pipe(Effect.flip))._tag).toBe(
        "OrchestrationCommandInvariantError",
      );
    }),
  );
  it.effect("reserves dispatch even when several messages share the same timestamp", () =>
    Effect.gen(function* () {
      const queued = settle(yield* apply(yield* apply(model(), send("first")), send("second")));
      const dispatched = yield* apply(queued, drain(turnId));
      expect(dispatched.threads[0]?.turnQueue?.dispatchingMessageId).toBe("first");
      expect(yield* decide(dispatched, drain())).toEqual([]);
    }),
  );
  it.effect("queueing re-engages a settled thread", () =>
    Effect.gen(function* () {
      const initial = model();
      const queued = yield* apply(
        {
          ...initial,
          threads: initial.threads.map((thread) => ({
            ...thread,
            settledOverride: "settled",
            settledAt: now,
          })),
        },
        send("wake"),
      );
      expect(queued.threads[0]?.settledOverride).toBe(null);
      expect(queued.threads[0]?.turnQueue?.items[0]?.text).toBe("wake");
    }),
  );
  it.effect("retains and pauses remaining work after a provider failure", () =>
    Effect.gen(function* () {
      const queued = yield* apply(model(), send("later"));
      const failed = yield* apply(queued, {
        type: "thread.session.set",
        threadId,
        commandId: CommandId.make("failed"),
        createdAt: now,
        session: {
          ...queued.threads[0]!.session!,
          status: "error",
          activeTurnId: null,
          lastError: "Provider unavailable",
        },
      });
      expect(failed.threads[0]?.turnQueue?.paused).toBe(true);
      expect(failed.threads[0]?.turnQueue?.items[0]?.text).toBe("later");
    }),
  );
});
