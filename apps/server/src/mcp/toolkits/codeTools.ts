import { CodeToolInput, CodeToolsError, type CodeToolsRunInput } from "@t3tools/contracts";
import { Cause, Context, Effect, Layer, Schema } from "effect";
import { Tool, Toolkit } from "effect/ai";
import * as McpToolAccess from "../McpToolAccess.ts";
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { CodeTools } from "../../codeTools/CodeTools.ts";
import { McpInvocationContext, requireThreadScope } from "../McpInvocationContext.ts";
const decodeCodeToolInput = Schema.decodeUnknownEffect(CodeToolInput);
const isCodeToolsError = Schema.is(CodeToolsError);

export const executeCodeTool = Effect.fn("mcp.code")(function* (input: CodeToolInput) {
  const caller = yield* McpInvocationContext;
  if (!caller.capabilities.has("code-tools"))
    return yield* new CodeToolsError({ message: "Code tools are unavailable for this session." });
  const tools = yield* CodeTools;
  return yield* tools.run({
    ...input,
    threadId: (yield* requireThreadScope(caller, "code tools")).thread.threadId,
  } satisfies CodeToolsRunInput);
});
export const CodeToolkit = Toolkit.make(
  Tool.make("code", {
    description:
      "Language-server tools scoped to this thread's worktree: diagnostics, definition, references, hover, symbols, rename, code_actions, capabilities, status. For provider-native subagents, workspace may name another registered worktree of the same repository. Positions use 1-based lines and UTF-16 characters. diagnostics without file checks changed files and configured project rules. Missing servers install when enabled in Code tools. Use serverId when multiple servers match. Rename and code actions preview by default; apply:true writes the resulting edits, respecting Plan mode. code_actions lists choices; pass actionIndex to preview a choice. Run diagnostics after editing.",
    parameters: CodeToolInput,
    success: Schema.Unknown,
    failure: Schema.Union([CodeToolsError, OrchestratorMcpFailure]),
    dependencies: [CodeTools, McpInvocationContext],
  })
    .annotate(Tool.Destructive, true)
    .annotate(Tool.OpenWorld, false),
);
export const codeHandlers = McpToolAccess.toLayer(CodeToolkit, {
  code: McpToolAccess.readsAsCaller(executeCodeTool),
});
