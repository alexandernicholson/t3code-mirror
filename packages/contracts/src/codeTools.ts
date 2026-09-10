import { Schema } from "effect";
import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const CodeToolsScope = Schema.Union([
  Schema.Struct({ type: Schema.Literal("environment") }),
  Schema.Struct({ type: Schema.Literal("project"), projectId: ProjectId }),
  Schema.Struct({ type: Schema.Literal("thread"), threadId: ThreadId }),
]);
export type CodeToolsScope = typeof CodeToolsScope.Type;
export const CodeChecksMode = Schema.Literals(["off", "observe", "guide"]);
export const CodeToolsInstallMode = Schema.Literals(["automatic", "manual"]);
const Strings = Schema.Array(Schema.String).check(Schema.isMaxLength(100));
const Options = Schema.Record(Schema.String, Schema.Unknown);
export const CodeServerOverride = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
  enabled: Schema.Boolean,
  command: Schema.optionalKey(TrimmedNonEmptyString),
  args: Schema.optionalKey(Strings),
  extensions: Schema.optionalKey(Strings),
  rootMarkers: Schema.optionalKey(Strings),
  initializationOptions: Schema.optionalKey(Options),
  settings: Schema.optionalKey(Options),
});
export type CodeServerOverride = typeof CodeServerOverride.Type;
export const CodeToolsConfiguration = Schema.Struct({
  scope: CodeToolsScope,
  revision: Schema.Int,
  mode: Schema.NullOr(CodeChecksMode),
  installMode: Schema.NullOr(CodeToolsInstallMode),
  rulesFile: Schema.NullOr(Schema.String.check(Schema.isMaxLength(512))),
  maxCorrections: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 }))),
  servers: Schema.Array(CodeServerOverride).check(Schema.isMaxLength(100)),
});
export type CodeToolsConfiguration = typeof CodeToolsConfiguration.Type;
export function codeToolsScopeKey(scope: CodeToolsScope): string {
  return scope.type === "environment"
    ? "environment"
    : `${scope.type}:${scope.type === "project" ? scope.projectId : scope.threadId}`;
}
export function emptyCodeToolsConfiguration(scope: CodeToolsScope): CodeToolsConfiguration {
  return {
    scope,
    revision: 0,
    mode: null,
    installMode: null,
    rulesFile: null,
    maxCorrections: null,
    servers: [],
  };
}

export const CodeDiagnostic = Schema.Struct({
  file: Schema.String,
  line: Schema.Int,
  character: Schema.Int,
  severity: Schema.Literals(["error", "warning", "information", "hint"]),
  source: Schema.String,
  code: Schema.String,
  message: Schema.String,
  guidance: Schema.optionalKey(Schema.String),
});
export type CodeDiagnostic = typeof CodeDiagnostic.Type;
export const CodeCheckRule = Schema.Struct({
  id: TrimmedNonEmptyString,
  files: Schema.optionalKey(Strings),
  message: TrimmedNonEmptyString.check(Schema.isMaxLength(4_000)),
  severity: Schema.Literals(["error", "warning"]),
  match: Schema.Union([
    Schema.Struct({
      type: Schema.Literal("diagnostic"),
      source: Schema.optionalKey(Schema.String),
      codes: Schema.optionalKey(Strings),
    }),
    Schema.Struct({
      type: Schema.Literal("regex"),
      pattern: TrimmedNonEmptyString.check(Schema.isMaxLength(4_000)),
    }),
    Schema.Struct({
      type: Schema.Literal("ast"),
      pattern: TrimmedNonEmptyString.check(Schema.isMaxLength(4_000)),
      language: TrimmedNonEmptyString,
    }),
  ]),
});
export type CodeCheckRule = typeof CodeCheckRule.Type;
export const CodeRulesFile = Schema.Struct({
  rules: Schema.Array(CodeCheckRule).check(Schema.isMaxLength(100)),
});

export const CodeServerStatus = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  languages: Strings,
  extensions: Strings,
  status: Schema.Literals(["not-installed", "installed", "installing", "error", "external"]),
  version: Schema.NullOr(Schema.String),
  detail: Schema.String,
  canInstall: Schema.Boolean,
  sessions: Schema.Int,
});
export type CodeServerStatus = typeof CodeServerStatus.Type;
export const CodeCheckResult = Schema.Struct({
  threadId: ThreadId,
  status: Schema.Literals(["idle", "checking", "issues", "clean", "unavailable", "paused"]),
  mode: CodeChecksMode,
  diagnostics: Schema.Array(CodeDiagnostic),
  checkedFiles: Strings,
  updatedAt: Schema.String,
  detail: Schema.String,
  corrections: Schema.Int,
});
export type CodeCheckResult = typeof CodeCheckResult.Type;
export const CodeToolsSubscriptionInput = Schema.Struct({
  threadId: Schema.optionalKey(ThreadId),
  details: Schema.optionalKey(Schema.Boolean),
  settings: Schema.optionalKey(Schema.Boolean),
});
export const CodeToolsSnapshot = Schema.Struct({
  configurations: Schema.Array(CodeToolsConfiguration),
  servers: Schema.Array(CodeServerStatus),
  checks: Schema.NullOr(CodeCheckResult),
  issueCount: Schema.Int,
});
export type CodeToolsSnapshot = typeof CodeToolsSnapshot.Type;
export const CodeToolsManageInput = Schema.Struct({
  action: Schema.Literals(["install", "remove", "cancel", "restart", "refresh"]),
  serverId: Schema.String,
  version: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(100))),
});
export type CodeToolsManageInput = typeof CodeToolsManageInput.Type;
export const CodeToolInput = Schema.Struct({
  workspace: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(4_000))),
  action: Schema.Literals([
    "diagnostics",
    "definition",
    "references",
    "hover",
    "symbols",
    "rename",
    "code_actions",
    "capabilities",
    "status",
  ]),
  file: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(4_000))),
  line: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  character: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  serverId: Schema.optionalKey(Schema.String),
  query: Schema.optionalKey(Schema.String),
  newName: Schema.optionalKey(TrimmedNonEmptyString),
  apply: Schema.optionalKey(Schema.Boolean),
  actionIndex: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  expectedHashes: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});
export type CodeToolInput = typeof CodeToolInput.Type;
export const CodeToolsRunInput = Schema.Struct({ threadId: ThreadId, ...CodeToolInput.fields });
export type CodeToolsRunInput = typeof CodeToolsRunInput.Type;
export const CodeToolResult = Schema.Struct({
  text: Schema.String,
  diagnostics: Schema.Array(CodeDiagnostic),
  data: Schema.Unknown,
});
export type CodeToolResult = typeof CodeToolResult.Type;
export class CodeToolsError extends Schema.TaggedError<CodeToolsError>()("CodeToolsError", {
  message: Schema.String,
}) {}
