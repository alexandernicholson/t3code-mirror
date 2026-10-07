import { OrchestratorV2, OrchestratorDispatchError } from "../../orchestration-v2/Orchestrator.ts";
import { CommandId, ThreadTodos, TodoOperation } from "@t3tools/contracts";
import { emptyTodos } from "@t3tools/shared/todos";
import { Cause, Context, Crypto, DateTime, Effect, Layer, Option, Schema } from "effect";
import { Tool, Toolkit } from "effect/ai";
import * as McpToolAccess from "../McpToolAccess.ts";
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { McpInvocationContext, requireThreadScope } from "../McpInvocationContext.ts";

class TodoToolError extends Schema.TaggedError<TodoToolError>()("TodoToolError", {
  message: Schema.String,
}) {}

const isTodoToolError = Schema.is(TodoToolError);
const decodeOperation = Schema.decodeUnknownEffect(TodoOperation);
const encodeTodos = Schema.encodeSync(Schema.fromJsonString(ThreadTodos));

export const executeTodo = Effect.fn("mcp.todo")(function* (input: TodoOperation) {
  const caller = yield* McpInvocationContext;
  if (!caller.capabilities.has("todos"))
    return yield* new TodoToolError({ message: "TODO access is unavailable." });
  const scoped = yield* requireThreadScope(caller, "todo");
  const engine = yield* OrchestratorV2;
  const threadId = scoped.thread.threadId;
  const thread = yield* engine.getThreadShell(threadId);
  if (thread === null) return yield* new TodoToolError({ message: "Thread not found." });
  if (input.op !== "view") {
    yield* engine.dispatch({
      type: "thread.metadata.update",
      commandId: CommandId.make(`todo:${yield* (yield* Crypto.Crypto).randomUUIDv4}`),
      threadId,
      todoUpdate: { type: "tool", operation: input },
    });
  }
  const updated = yield* engine.getThreadProjection(threadId);
  return updated.thread.todos ?? emptyTodos;
});

export const TodosToolkit = Toolkit.make(
  Tool.make("todo", {
    description:
      "Read the thread TODO list with op=view. Prefer your native TODO tool for updates when available; otherwise use this OMP-style fallback. init replaces the list with items or list:[{phase,items}]; append requires phase and items; start/done/drop/block/unblock target task by exact ID or content, or phase; rm removes a task/phase or clears when neither is supplied. block accepts reason. Mutations are atomic and return the saved list. The earliest pending task auto-starts when none is running; blocked tasks never auto-start. Respect user edits. Do not claim TODOs were created without a successful tool result.",
    parameters: TodoOperation,
    success: ThreadTodos,
    failure: Schema.Union([TodoToolError, OrchestratorMcpFailure]),
    dependencies: [OrchestratorV2, Crypto.Crypto, McpInvocationContext],
  })
    .annotate(Tool.Destructive, true)
    .annotate(Tool.OpenWorld, false),
);
export const todosHandlers = McpToolAccess.toLayer(TodosToolkit, {
  todo: McpToolAccess.readsAsCaller((input) =>
    executeTodo(input).pipe(
      Effect.mapError((error) => new TodoToolError({ message: error.message })),
    ),
  ),
});
