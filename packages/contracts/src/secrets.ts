import * as Schema from "effect/Schema";
import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const SecretKey = TrimmedNonEmptyString.check(Schema.isMaxLength(200));
export const SecretValue = Schema.String.check(Schema.isMaxLength(65_536));
export const SecretScope = Schema.Union([
  Schema.Struct({ type: Schema.Literal("environment") }),
  Schema.Struct({ type: Schema.Literal("project"), projectId: ProjectId }),
]);
export type SecretScope = typeof SecretScope.Type;
export const SecretTarget = Schema.Struct({ key: SecretKey, scope: SecretScope });
export type SecretTarget = typeof SecretTarget.Type;
export function secretTargetId(target: SecretTarget): string {
  return JSON.stringify([
    target.scope.type === "project" ? target.scope.projectId : null,
    target.key,
  ]);
}
export const SecretMetadata = Schema.Struct({
  ...SecretTarget.fields,
  highlySensitive: Schema.Boolean,
  revision: Schema.String,
});
export type SecretMetadata = typeof SecretMetadata.Type;

export const SecretWriteInput = Schema.Struct({
  ...SecretTarget.fields,
  value: SecretValue,
  highlySensitive: Schema.Boolean,
});
export type SecretWriteInput = typeof SecretWriteInput.Type;
export const SecretUpdateInput = Schema.Struct({
  ...SecretMetadata.fields,
  value: Schema.optionalKey(SecretValue),
});
export type SecretUpdateInput = typeof SecretUpdateInput.Type;
export const SecretDeleteInput = Schema.Struct({ ...SecretTarget.fields, revision: Schema.String });

export const SecretReadRequest = Schema.Struct({
  requestId: Schema.String,
  ...SecretTarget.fields,
  threadId: ThreadId,
  reason: TrimmedNonEmptyString.check(Schema.isMaxLength(1_000)),
});
export type SecretReadRequest = typeof SecretReadRequest.Type;
export const SecretApprovalInput = Schema.Struct({
  requestId: Schema.String,
  decision: Schema.Literals(["once", "thread", "deny"]),
});
export type SecretApprovalInput = typeof SecretApprovalInput.Type;
export const SecretThreadGrant = Schema.Struct({ ...SecretMetadata.fields, threadId: ThreadId });
export type SecretThreadGrant = typeof SecretThreadGrant.Type;
export const SecretRevokeInput = Schema.Struct({ threadId: ThreadId });
export const SecretsSnapshot = Schema.Struct({
  entries: Schema.Array(SecretMetadata),
  pendingReads: Schema.Array(SecretReadRequest),
  threadGrants: Schema.Array(SecretThreadGrant),
});
export type SecretsSnapshot = typeof SecretsSnapshot.Type;

export class SecretsError extends Schema.TaggedError<SecretsError>()("SecretsError", {
  code: Schema.Literals(["not_found", "conflict", "denied", "unavailable", "capacity"]),
}) {
  override get message(): string {
    switch (this.code) {
      case "not_found":
        return "The secret or access request no longer exists.";
      case "conflict":
        return "The secret changed. Refresh and try again.";
      case "denied":
        return "Secret access was denied.";
      case "capacity":
        return "The secrets store has reached its capacity.";
      case "unavailable":
        return "The secrets store is unavailable.";
    }
  }
}
