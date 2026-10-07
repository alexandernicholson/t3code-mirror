import {
  SecretKey,
  SecretReadRequest,
  SecretMetadata,
  SecretValue,
  SecretsError,
  type SecretScope,
} from "@t3tools/contracts";
import { Cause, Context, Effect, Layer, Option, Schema, Sink, Stream } from "effect";
import { Tool, Toolkit } from "effect/ai";
import { ForkThreadRuntime as ProjectionSnapshotQuery } from "../../orchestration-v2/ForkThreadRuntime.ts";
import * as McpToolAccess from "../McpToolAccess.ts";
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { Secrets } from "../../secrets/Secrets.ts";
import { McpInvocationContext, requireThreadScope } from "../McpInvocationContext.ts";

const scope = Schema.Literals(["environment", "project"]);
const dependencies = [Secrets, McpInvocationContext, ProjectionSnapshotQuery];
export const SecretsToolkit = Toolkit.make(
  Tool.make("secrets_list", {
    description:
      "List secret keys and sensitivity in this environment and the current project. Never returns values.",
    parameters: Tool.EmptyParams,
    success: Schema.Array(SecretMetadata),
    failure: Schema.Union([SecretsError, OrchestratorMcpFailure]),
    dependencies,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("secrets_read", {
    description:
      "Retrieve a secret by key and scope. Highly sensitive values require user approval in T3 Code. Explain why you need the value. Do not echo secrets into chat, logs, or files.",
    parameters: Schema.Struct({
      key: SecretKey,
      scope,
      reason: SecretReadRequest.fields.reason,
    }),
    success: Schema.Struct({ value: SecretValue }),
    failure: Schema.Union([SecretsError, OrchestratorMcpFailure]),
    dependencies,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("secrets_write", {
    description:
      "Create or replace a secret in this environment or the current project. highlySensitive requires approval to retrieve. Existing highly sensitive secrets cannot be downgraded by agents. Returns metadata only.",
    parameters: Schema.Struct({
      key: SecretKey,
      scope,
      value: SecretValue,
      highlySensitive: Schema.Boolean,
    }),
    success: SecretMetadata,
    failure: Schema.Union([SecretsError, OrchestratorMcpFailure]),
    dependencies,
  }).annotate(Tool.Destructive, true),
);

const invocation = Effect.gen(function* () {
  const context = yield* McpInvocationContext;
  if (context.thread === undefined) return yield* new SecretsError({ code: "denied" });
  if (!context.capabilities.has("secrets")) return yield* new SecretsError({ code: "denied" });
  const query = yield* ProjectionSnapshotQuery;
  const thread = yield* query
    .getThreadShellById(context.thread.threadId)
    .pipe(Effect.mapError(() => new SecretsError({ code: "unavailable" })));
  if (Option.isNone(thread)) return yield* new SecretsError({ code: "denied" });
  return { threadId: context.thread.threadId, projectId: thread.value.projectId };
});

export const secretsHandlers = McpToolAccess.toLayer(SecretsToolkit, {
  secrets_list: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const caller = yield* invocation;
      const secrets = yield* Secrets;
      return (yield* secrets.list).filter(
        (entry) => entry.scope.type === "environment" || entry.scope.projectId === caller.projectId,
      );
    }),
  ),
  secrets_read: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const caller = yield* invocation;
      const secrets = yield* Secrets;
      const targetScope: SecretScope =
        input.scope === "environment"
          ? { type: "environment" }
          : { type: "project", projectId: caller.projectId };
      const value = yield* secrets.readForAgent(
        { key: input.key, scope: targetScope },
        caller.threadId,
        input.reason,
      );
      return { value };
    }),
  ),
  secrets_write: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const caller = yield* invocation;
      const secrets = yield* Secrets;
      const targetScope: SecretScope =
        input.scope === "environment"
          ? { type: "environment" }
          : { type: "project", projectId: caller.projectId };
      return yield* secrets.writeForAgent({ ...input, scope: targetScope });
    }),
  ),
});
