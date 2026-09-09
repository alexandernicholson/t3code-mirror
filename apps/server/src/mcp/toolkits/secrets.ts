import {
  SecretKey,
  SecretReadRequest,
  SecretMetadata,
  SecretValue,
  SecretsError,
  type SecretScope,
} from "@t3tools/contracts";
import { Cause, Context, Effect, Layer, Option, Schema, Sink, Stream } from "effect";
import { McpSchema, McpServer, Tool, Toolkit } from "effect/unstable/ai";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { Secrets } from "../../secrets/Secrets.ts";
import { McpInvocationContext } from "../McpInvocationContext.ts";

const scope = Schema.Literals(["environment", "project"]);
const dependencies = [Secrets, McpInvocationContext, ProjectionSnapshotQuery];
export const SecretsToolkit = Toolkit.make(
  Tool.make("secrets_list", {
    description:
      "List secret keys and sensitivity in this environment and the current project. Never returns values.",
    parameters: Tool.EmptyParams,
    success: Schema.Array(SecretMetadata),
    failure: SecretsError,
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
    failure: SecretsError,
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
    failure: SecretsError,
    dependencies,
  }).annotate(Tool.Destructive, true),
);

const invocation = Effect.gen(function* () {
  const context = yield* McpInvocationContext;
  if (!context.capabilities.has("secrets")) return yield* new SecretsError({ code: "denied" });
  const query = yield* ProjectionSnapshotQuery;
  const thread = yield* query
    .getThreadShellById(context.threadId)
    .pipe(Effect.mapError(() => new SecretsError({ code: "unavailable" })));
  if (Option.isNone(thread)) return yield* new SecretsError({ code: "denied" });
  return { threadId: context.threadId, projectId: thread.value.projectId };
});

export const SecretsToolkitHandlersLive = SecretsToolkit.toLayer({
  secrets_list: () =>
    Effect.gen(function* () {
      const caller = yield* invocation;
      const secrets = yield* Secrets;
      return (yield* secrets.list).filter(
        (entry) => entry.scope.type === "environment" || entry.scope.projectId === caller.projectId,
      );
    }),
  secrets_read: (input) =>
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
  secrets_write: (input) =>
    Effect.gen(function* () {
      const caller = yield* invocation;
      const secrets = yield* Secrets;
      const targetScope: SecretScope =
        input.scope === "environment"
          ? { type: "environment" }
          : { type: "project", projectId: caller.projectId };
      return yield* secrets.writeForAgent({ ...input, scope: targetScope });
    }),
});

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const isSecretsError = Schema.is(SecretsError);

// Generic toolkit validation errors can contain rejected input values. Keep the
// secret transport's failure responses and logs independent of those payloads.
const register = Effect.gen(function* () {
  const server = yield* McpServer.McpServer;
  const secrets = yield* Secrets;
  const query = yield* ProjectionSnapshotQuery;
  const built = yield* SecretsToolkit;
  for (const tool of Object.values(built.tools)) {
    yield* server.addTool({
      tool: new McpSchema.Tool({
        name: tool.name,
        description: Tool.getDescription(tool),
        inputSchema: Tool.getJsonSchema(tool),
        annotations: {
          readOnlyHint: Context.get(tool.annotations, Tool.Readonly),
          destructiveHint: Context.get(tool.annotations, Tool.Destructive),
          idempotentHint: Context.get(tool.annotations, Tool.Idempotent),
          openWorldHint: Context.get(tool.annotations, Tool.OpenWorld),
        },
      }),
      annotations: tool.annotations,
      handle: (payload) =>
        Effect.withFiber((fiber) => {
          const context = Context.getUnsafe(fiber.context, McpInvocationContext);
          return built.handle(tool.name, payload).pipe(
            Stream.unwrap,
            Stream.run(Sink.last()),
            Effect.flatMap(Effect.fromOption),
            Effect.provideService(McpInvocationContext, context),
            Effect.provideService(Secrets, secrets),
            Effect.provideService(ProjectionSnapshotQuery, query),
            Effect.map(
              (result) =>
                new McpSchema.CallToolResult({
                  isError: false,
                  content: [{ type: "text", text: encodeJson(result.encodedResult) }],
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
                      text: isSecretsError(error)
                        ? error.message
                        : "Secret operation failed. Check the arguments and try again.",
                    },
                  ],
                }),
              );
            }),
          );
        }),
    });
  }
});

export const SecretsToolkitRegistrationLive = Layer.effectDiscard(register).pipe(
  Layer.provide(SecretsToolkitHandlersLive),
);
