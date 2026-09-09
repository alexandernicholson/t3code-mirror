import { Schema } from "effect";
import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./orchestration.ts";

export const AdvisorDefinition = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
  modelSelection: ModelSelection,
  instructions: Schema.String.check(Schema.isMaxLength(16_000)),
  mode: Schema.Literals(["guide", "observe"]),
});
export type AdvisorDefinition = typeof AdvisorDefinition.Type;
export const AdvisorScope = Schema.Union([
  Schema.Struct({ type: Schema.Literal("environment") }),
  Schema.Struct({ type: Schema.Literal("project"), projectId: ProjectId }),
  Schema.Struct({ type: Schema.Literal("thread"), threadId: ThreadId }),
]);
export type AdvisorScope = typeof AdvisorScope.Type;
export const AdvisorConfiguration = Schema.Struct({
  scope: AdvisorScope,
  revision: Schema.Int,
  definitions: Schema.Array(AdvisorDefinition).check(Schema.isMaxLength(12)),
  advisorIds: Schema.NullOr(Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(12))),
  instructions: Schema.String.check(Schema.isMaxLength(16_000)),
  instructionsFile: Schema.String.check(Schema.isMaxLength(1_000)),
  paused: Schema.Boolean,
});
export type AdvisorConfiguration = typeof AdvisorConfiguration.Type;
export const AdvisorStatus = Schema.Literals([
  "watching",
  "reviewing",
  "catching-up",
  "paused",
  "unavailable",
]);
export const AdvisorState = Schema.Struct({
  threadId: ThreadId,
  advisorId: Schema.String,
  name: Schema.String,
  status: AdvisorStatus,
  reason: Schema.NullOr(Schema.String),
  reviewedSequence: Schema.Int,
  updatedAt: IsoDateTime,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  costUsd: Schema.Number,
  reviewCount: Schema.Int,
});
export type AdvisorState = typeof AdvisorState.Type;
export const AdvisorEntry = Schema.Struct({
  id: Schema.String,
  threadId: ThreadId,
  advisorId: Schema.String,
  advisorName: Schema.String,
  kind: Schema.Literals(["activity", "reasoning", "finding", "delivery", "error"]),
  text: Schema.String,
  severity: Schema.optional(Schema.Literals(["note", "concern", "blocker"])),
  sourceSequence: Schema.Int,
  findingId: Schema.optional(Schema.String),
  createdAt: IsoDateTime,
});
export type AdvisorEntry = typeof AdvisorEntry.Type;
export const AdvisorSubscriptionInput = Schema.Struct({
  threadId: Schema.optional(ThreadId),
  details: Schema.optional(Schema.Boolean),
});
export const AdvisorSnapshot = Schema.Struct({
  configurations: Schema.Array(AdvisorConfiguration),
  states: Schema.Array(AdvisorState),
  entries: Schema.Array(AdvisorEntry),
  latestEntryId: Schema.NullOr(Schema.String),
  findingCount: Schema.Int,
});
export type AdvisorSnapshot = typeof AdvisorSnapshot.Type;
export const AdvisorAction = Schema.Struct({
  threadId: ThreadId,
  action: Schema.Literals(["pause", "resume", "address"]),
  findingId: Schema.optional(Schema.String),
});
export type AdvisorAction = typeof AdvisorAction.Type;
export class AdvisorError extends Schema.TaggedError<AdvisorError>()("AdvisorError", {
  message: Schema.String,
}) {}
export function advisorScopeKey(scope: AdvisorScope): string {
  return scope.type === "environment"
    ? "environment"
    : `${scope.type}:${scope.type === "project" ? scope.projectId : scope.threadId}`;
}
export function emptyAdvisorConfiguration(scope: AdvisorScope): AdvisorConfiguration {
  return {
    scope,
    revision: 0,
    definitions: [],
    advisorIds: scope.type === "environment" ? [] : null,
    instructions: "",
    instructionsFile: "",
    paused: false,
  };
}

/** Selection inherited before applying a thread or project override. */
export function inheritedAdvisorIds(
  configurations: readonly AdvisorConfiguration[],
  scope: AdvisorScope,
  projectId?: ProjectId,
): readonly string[] {
  const environmentIds =
    configurations.find((value) => value.scope.type === "environment")?.advisorIds ?? [];
  if (scope.type !== "thread" || projectId === undefined) return environmentIds;
  return (
    configurations.find(
      (value) => value.scope.type === "project" && value.scope.projectId === projectId,
    )?.advisorIds ?? environmentIds
  );
}

/** Definitions visible at a scope, with local overrides replacing inherited values. */
export function advisorDefinitionsForScope(
  configurations: readonly AdvisorConfiguration[],
  scope: AdvisorScope,
  projectId?: ProjectId,
): readonly AdvisorDefinition[] {
  const keys = ["environment"];
  if (scope.type === "project") keys.push(advisorScopeKey(scope));
  if (scope.type === "thread") {
    if (projectId !== undefined) keys.push(`project:${projectId}`);
    keys.push(advisorScopeKey(scope));
  }
  const definitions = new Map<string, AdvisorDefinition>();
  for (const key of keys) {
    const configuration = configurations.find((value) => advisorScopeKey(value.scope) === key);
    for (const definition of configuration?.definitions ?? [])
      definitions.set(definition.id, definition);
  }
  return [...definitions.values()];
}

export function setAdvisorDefinition(
  configuration: AdvisorConfiguration,
  definition: AdvisorDefinition,
): AdvisorConfiguration {
  return {
    ...configuration,
    definitions: configuration.definitions.some((value) => value.id === definition.id)
      ? configuration.definitions.map((value) => (value.id === definition.id ? definition : value))
      : [...configuration.definitions, definition],
  };
}
