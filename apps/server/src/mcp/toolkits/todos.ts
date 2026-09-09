import { isOrchestrationCommandRejection } from "../../orchestration/Errors.ts";
import { CommandId, ThreadTodos, TodoOperation } from "@t3tools/contracts";
import { emptyTodos } from "@t3tools/shared/todos";
import { Cause, Context, Crypto, DateTime, Effect, Layer, Option, Schema } from "effect";
import { McpSchema, McpServer } from "effect/unstable/ai";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { McpInvocationContext } from "../McpInvocationContext.ts";

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
  const query = yield* ProjectionSnapshotQuery;
  const engine = yield* OrchestrationEngineService;
  const thread = yield* query.getThreadShellById(caller.threadId);
  if (Option.isNone(thread)) return yield* new TodoToolError({ message: "Thread not found." });
  if (input.op === "view")
    return Option.getOrElse(yield* query.getThreadTodos(caller.threadId), () => emptyTodos);
  yield* engine.dispatch({
    type: "thread.todos.tool",
    commandId: CommandId.make(`todo:${yield* (yield* Crypto.Crypto).randomUUIDv4}`),
    threadId: caller.threadId,
    operation: input,
    createdAt: DateTime.formatIso(yield* DateTime.now),
  });
  // Dispatch returns only after the event and projection commit.
  const updated = yield* query.getThreadTodos(caller.threadId);
  if (Option.isNone(updated))
    return yield* new TodoToolError({ message: "Thread no longer exists." });
  return updated.value;
});

export const TodosToolkitRegistrationLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const services = yield* Effect.context<
      OrchestrationEngineService | ProjectionSnapshotQuery | Crypto.Crypto
    >();
    yield* server.addTool({
      annotations: Context.empty(),
      tool: new McpSchema.Tool({
        name: "todo",
        description:
          "Read the thread TODO list with op=view. Prefer your native TODO tool for updates when available; otherwise use this OMP-style fallback. init replaces the list with items or list:[{phase,items}]; append requires phase and items; start/done/drop/block/unblock target task by exact ID or content, or phase; rm removes a task/phase or clears when neither is supplied. block accepts reason. Mutations are atomic and return the saved list. The earliest pending task auto-starts when none is running; blocked tasks never auto-start. Respect user edits. Do not claim TODOs were created without a successful tool result.",
        inputSchema: Schema.toJsonSchemaDocument(TodoOperation).schema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      }),
      handle: (payload) =>
        Effect.withFiber((fiber) => {
          const caller = Context.getUnsafe(fiber.context, McpInvocationContext);
          return decodeOperation(payload).pipe(
            Effect.flatMap(executeTodo),
            Effect.provide(services),
            Effect.provideService(McpInvocationContext, caller),
            Effect.map(
              (todos) =>
                new McpSchema.CallToolResult({
                  isError: false,
                  content: [
                    {
                      type: "text",
                      text: encodeTodos({ revision: todos.revision, items: todos.items }),
                    },
                  ],
                }),
            ),
            Effect.catchCause((cause) => {
              if (Cause.hasInterrupts(cause)) return Effect.failCause(cause).pipe(Effect.orDie);
              return Effect.succeed(
                new McpSchema.CallToolResult({
                  isError: true,
                  content: [
                    {
                      type: "text",
                      text: (() => {
                        const error = cause.reasons.find(Cause.isFailReason)?.error;
                        return isTodoToolError(error) || isOrchestrationCommandRejection(error)
                          ? error.message
                          : "TODO operation failed. Check the arguments and use view to read the latest list.";
                      })(),
                    },
                  ],
                }),
              );
            }),
          );
        }),
    });
  }),
);
