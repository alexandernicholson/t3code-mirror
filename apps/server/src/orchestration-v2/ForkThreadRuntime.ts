import {
  EventId,
  RunId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationV2StoredEvent,
  type OrchestrationV2ThreadShell,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { Context, DateTime, Effect, Layer, Option, Schema, Stream } from "effect";
import * as Orchestrator from "./Orchestrator.ts";
import * as EventStore from "./EventStore.ts";
import * as ProjectStore from "./ProjectStore.ts";

/** A small view of V2 threads used by the fork's independent feature services. */
export function featureThread(shell: OrchestrationV2ThreadShell) {
  const activeTurnId = shell.activeRunId === null ? null : TurnId.make(shell.activeRunId);
  return {
    ...shell,
    createdAt: DateTime.formatIso(shell.createdAt),
    updatedAt: DateTime.formatIso(shell.updatedAt),
    archivedAt: shell.archivedAt === null ? null : DateTime.formatIso(shell.archivedAt),
    backgroundLiveness:
      (shell.pendingBackgroundTasks ?? []).length > 0 ? shell.pendingBackgroundTasks : null,
    session: { status: shell.status, activeTurnId },
    latestTurn:
      shell.latestRunId === null
        ? null
        : {
            turnId: TurnId.make(shell.latestRunId),
            state: shell.status,
          },
  };
}

/** Adapt committed V2 activity for fork feature workers, without keeping a second event log. */
export function featureEvent(stored: OrchestrationV2StoredEvent): OrchestrationEvent {
  const event = stored.event;
  const at = DateTime.formatIso(event.occurredAt);
  const base = {
    sequence: stored.sequence,
    eventId: event.id,
    aggregateKind: "thread" as const,
    aggregateId: event.threadId,
    occurredAt: at,
    commandId: stored.commandId,
    causationEventId: null,
    correlationId: null,
    metadata: {},
  };
  if (event.type === "message.updated") {
    const message = event.payload;
    return {
      ...base,
      type: "thread.message-sent",
      payload: {
        threadId: event.threadId,
        messageId: message.id,
        role: message.role,
        text: message.text,
        attachments: message.attachments,
        turnId: message.runId === null ? null : TurnId.make(message.runId),
        streaming: message.streaming,
        createdAt: DateTime.formatIso(message.createdAt),
        updatedAt: DateTime.formatIso(message.updatedAt),
      },
    };
  }
  if (event.type === "thread.deleted")
    return {
      ...base,
      type: "thread.deleted",
      payload: { threadId: event.threadId, deletedAt: at },
    };
  const item = event.type === "turn-item.updated" ? event.payload : null;
  if (
    event.type === "run.updated" &&
    event.payload.status === "running" &&
    event.payload.userMessageId.startsWith("advisor:")
  )
    return {
      ...base,
      type: "thread.activity-appended",
      payload: {
        threadId: event.threadId,
        activity: {
          id: event.id,
          kind: "advisor.delivered",
          tone: "info",
          summary: "Advisor guidance delivered",
          payload: { findingId: event.payload.userMessageId.slice(8).split(":")[0] },
          turnId: TurnId.make(event.payload.id),
          createdAt: at,
        },
      },
    };

  const workKind =
    item && ["tool_call", "command_execution", "file_change"].includes(item.type)
      ? item.status === "completed"
        ? "tool.completed"
        : "tool.started"
      : event.type;
  const activity =
    item?.type === "system_notice" && item.forkActivity !== undefined
      ? item.forkActivity
      : {
          id: event.id,
          tone: "info" as const,
          kind: workKind,
          summary: item?.title || event.type,
          payload: { detail: JSON.stringify(event.payload).slice(0, 12_000) },
          turnId:
            event.runId === undefined || event.runId === null ? null : TurnId.make(event.runId),
          createdAt: at,
        };
  return {
    ...base,
    type: "thread.activity-appended",
    payload: { threadId: event.threadId, activity },
  };
}

export class ForkThreadRuntimeError extends Schema.TaggedError<ForkThreadRuntimeError>()(
  "ForkThreadRuntimeError",
  { message: Schema.String },
) {}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const events = yield* EventStore.EventStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const getThreadShellById = (threadId: ThreadId) =>
    engine
      .getThreadShell(threadId)
      .pipe(
        Effect.map((shell) => (shell === null ? Option.none() : Option.some(featureThread(shell)))),
      );
  const dispatch = Effect.fn("ForkThreadRuntime.dispatch")(function* (
    command: OrchestrationCommand,
  ) {
    const { commandId } = command;
    if (!("threadId" in command))
      return yield* new ForkThreadRuntimeError({
        message: "This feature requires a thread command.",
      });
    const { threadId } = command;
    if (command.type === "thread.turn.start") {
      const shell = yield* engine.getThreadShell(threadId);
      if (shell === null)
        return yield* new ForkThreadRuntimeError({ message: "Thread not found." });
      if (
        command.expectedActiveTurnId !== undefined &&
        shell.activeRunId !== RunId.make(command.expectedActiveTurnId)
      )
        return yield* new ForkThreadRuntimeError({
          message: "The active turn changed before guidance was delivered.",
        });
      return yield* engine.dispatch({
        type: "message.dispatch",
        commandId,
        threadId,
        messageId: command.message.messageId,
        text: command.message.text,
        attachments: command.message.attachments,
        ...(command.modelSelection === undefined ? {} : { modelSelection: command.modelSelection }),
        createdBy: "agent",
        creationSource: "server",
        dispatchMode:
          command.delivery === "queue"
            ? { type: "queue_after_active" }
            : shell.activeRunId === null
              ? { type: "start_immediately" }
              : { type: "steer_active", targetRunId: RunId.make(shell.activeRunId) },
      });
    }
    if (
      command.type === "thread.todos.tool" ||
      command.type === "thread.todos.edit" ||
      command.type === "thread.todos.native"
    )
      return yield* engine.dispatch({
        type: "thread.metadata.update",
        commandId,
        threadId,
        todoUpdate:
          command.type === "thread.todos.tool"
            ? { type: "tool", operation: command.operation }
            : command.type === "thread.todos.edit"
              ? { type: "edit", expectedRevision: command.expectedRevision, items: command.items }
              : { type: "native", steps: command.steps },
      });
    if (command.type === "thread.activity.append")
      return yield* engine.dispatch({
        type: "thread.metadata.update",
        commandId,
        threadId,
        activityNotice: command.activity,
      });
    return yield* new ForkThreadRuntimeError({
      message: `Unsupported feature command: ${command.type}`,
    });
  });
  return {
    dispatch,
    latestSequence: events.latestSequence(),
    subscribeDomainEvents: Effect.succeed(engine.streamStoredEvents.pipe(Stream.map(featureEvent))),
    readThreadEvents: (input: {
      threadId: ThreadId;
      fromSequenceExclusive: number;
      toSequenceInclusive: number;
      limit: number;
    }) =>
      events
        .read({
          threadId: input.threadId,
          afterSequence: input.fromSequenceExclusive,
          throughSequence: input.toSequenceInclusive,
          limit: input.limit,
        })
        .pipe(Stream.map(featureEvent)),
    getThreadShellById,
    getProjectShellById: (projectId: ProjectId) =>
      projects
        .get(projectId)
        .pipe(Effect.map(Option.map((row) => ({ ...row, id: row.projectId })))),
    getShellSnapshot: () =>
      engine
        .getShellSnapshot()
        .pipe(
          Effect.map((snapshot) => ({ ...snapshot, threads: snapshot.threads.map(featureThread) })),
        ),
    getThreadDetailSnapshot: (threadId: ThreadId, _options?: { turnLimit?: number }) =>
      engine
        .getThreadProjection(threadId)
        .pipe(
          Effect.map((projection) =>
            Option.some({ thread: { ...projection.thread, messages: projection.messages } }),
          ),
        ),
    getThreadTodos: (threadId: ThreadId) =>
      engine
        .getThreadProjection(threadId)
        .pipe(Effect.map((projection) => Option.fromNullishOr(projection.thread.todos))),
  };
});
export class ForkThreadRuntime extends Context.Service<
  ForkThreadRuntime,
  Effect.Success<typeof make>
>()("t3/orchestration-v2/ForkThreadRuntime") {}
export const layer = Layer.effect(ForkThreadRuntime, make);
