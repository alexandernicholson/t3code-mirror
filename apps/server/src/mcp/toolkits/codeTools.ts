import { CodeToolInput, CodeToolsError, type CodeToolsRunInput } from "@t3tools/contracts";
import { Cause, Context, Effect, Layer, Schema } from "effect";
import { McpSchema, McpServer } from "effect/unstable/ai";
import { CodeTools } from "../../codeTools/CodeTools.ts";
import { McpInvocationContext } from "../McpInvocationContext.ts";
const decodeCodeToolInput = Schema.decodeUnknownEffect(CodeToolInput);
const isCodeToolsError = Schema.is(CodeToolsError);

export const executeCodeTool = Effect.fn("mcp.code")(function* (input: CodeToolInput) {
  const caller = yield* McpInvocationContext;
  if (!caller.capabilities.has("code-tools"))
    return yield* new CodeToolsError({ message: "Code tools are unavailable for this session." });
  const tools = yield* CodeTools;
  return yield* tools.run({ ...input, threadId: caller.threadId } satisfies CodeToolsRunInput);
});
export const CodeToolsRegistrationLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const codeTools = yield* CodeTools;
    yield* server.addTool({
      annotations: Context.empty(),
      tool: new McpSchema.Tool({
        name: "code",
        description:
          "Language-server tools scoped to this thread's worktree: diagnostics, definition, references, hover, symbols, rename, code_actions, capabilities, status. For provider-native subagents, workspace may name another registered worktree of the same repository. Positions use 1-based lines and UTF-16 characters. diagnostics without file checks changed files and configured project rules. Missing servers install when enabled in Code tools. Use serverId when multiple servers match. Rename and code actions preview by default; apply:true writes the resulting edits, respecting Plan mode. code_actions lists choices; pass actionIndex to preview a choice. Run diagnostics after editing.",
        inputSchema: Schema.toJsonSchemaDocument(CodeToolInput).schema,
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
          return decodeCodeToolInput(payload).pipe(
            Effect.flatMap(executeCodeTool),
            Effect.provideService(CodeTools, codeTools),
            Effect.provideService(McpInvocationContext, caller),
            Effect.map(
              (result) =>
                new McpSchema.CallToolResult({
                  isError: false,
                  content: [{ type: "text", text: JSON.stringify(result) }],
                }),
            ),
            Effect.catchCause((cause) => {
              if (Cause.hasInterrupts(cause)) return Effect.failCause(cause).pipe(Effect.orDie);
              const error = cause.reasons.find(Cause.isFailReason)?.error;
              return Effect.succeed(
                new McpSchema.CallToolResult({
                  isError: true,
                  content: [
                    {
                      type: "text",
                      text: isCodeToolsError(error) ? error.message : "Invalid code tool request.",
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
