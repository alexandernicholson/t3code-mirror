import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  OrchestrationThreadShell,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { Effect, Fiber, Layer, Option, Schema, Stream } from "effect";
import { McpSchema, McpServer } from "effect/unstable/ai";
import * as ServerConfig from "../../config.ts";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as Secrets from "../../secrets/Secrets.ts";
import * as SecretApprovals from "../../secrets/SecretApprovals.ts";
import { localBackendLayer } from "../../secrets/SecretBackend.ts";
import { McpInvocationContext, type McpInvocationScope } from "../McpInvocationContext.ts";
import { SecretsToolkitRegistrationLive } from "./secrets.ts";

const threadId = ThreadId.make("thread-a");
const projectId = ProjectId.make("project-a");
const otherProjectId = ProjectId.make("project-b");
const invocation: McpInvocationScope = {
  environmentId: EnvironmentId.make("environment-a"),
  threadId,
  providerSessionId: "provider-session",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(["secrets"]),
  issuedAt: 1,
};
const thread = Schema.decodeUnknownSync(OrchestrationThreadShell)({
  id: threadId,
  projectId,
  title: "Secrets test",
  modelSelection: { provider: "codex", model: "gpt-5" },
  runtimeMode: "full-access",
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-09-08T00:00:00.000Z",
  updatedAt: "2026-09-08T00:00:00.000Z",
  session: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
});
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  },
  getClient: Effect.die("unused"),
});
const TestLayer = SecretsToolkitRegistrationLive.pipe(
  Layer.provideMerge(McpServer.McpServer.layer),
  Layer.provideMerge(
    Secrets.layer.pipe(Layer.provide(SecretApprovals.layer), Layer.provide(localBackendLayer)),
  ),
  Layer.provide(
    Layer.mock(ProjectionSnapshotQuery)({
      getThreadShellById: (id) =>
        Effect.succeed(id === threadId ? Option.some(thread) : Option.none()),
    }),
  ),
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-secrets-mcp-" })),
  Layer.provide(NodeServices.layer),
);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

it.effect("MCP reads and writes are scoped to the authenticated thread's project", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const secrets = yield* Secrets.Secrets;
    yield* secrets.create({
      key: "shared",
      scope: { type: "environment" },
      value: "env-value",
      highlySensitive: false,
    });
    yield* secrets.create({
      key: "private",
      scope: { type: "project", projectId: otherProjectId },
      value: "other-project-value",
      highlySensitive: false,
    });
    const write = yield* server.callTool({
      name: "secrets_write",
      arguments: { key: "private", scope: "project", value: "our-value", highlySensitive: false },
    });
    expect(write.isError).toBe(false);
    expect(encodeJson(write)).not.toContain("our-value");
    const listed = yield* server.callTool({ name: "secrets_list", arguments: {} });
    expect(listed.isError).toBe(false);
    expect(encodeJson(listed)).toContain(projectId);
    expect(encodeJson(listed)).not.toContain(otherProjectId);
    expect(encodeJson(listed)).not.toContain("env-value");
    const read = yield* server.callTool({
      name: "secrets_read",
      arguments: { key: "private", scope: "project", reason: "test", projectId: otherProjectId },
    });
    expect(read.isError).toBe(false);
    expect(encodeJson(read)).toContain("our-value");
    expect(encodeJson(read)).not.toContain("other-project-value");
  }).pipe(
    Effect.provideService(McpInvocationContext, invocation),
    Effect.provideService(McpSchema.McpServerClient, client),
    Effect.provide(TestLayer),
  ),
);

it.effect(
  "MCP retrieval blocks until the user approves and invalid input never echoes a secret",
  () =>
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const secrets = yield* Secrets.Secrets;
      yield* secrets.create({
        key: "key",
        scope: { type: "environment" },
        value: "approved-secret",
        highlySensitive: true,
      });
      const read = yield* server
        .callTool({
          name: "secrets_read",
          arguments: { key: "key", scope: "environment", reason: "Deploy" },
        })
        .pipe(Effect.forkChild);
      const pending = yield* secrets.changes.pipe(
        Stream.map((snapshot) => snapshot.pendingReads[0]),
        Stream.filter((request) => request !== undefined),
        Stream.runHead,
        Effect.flatMap(Effect.fromOption),
      );
      yield* secrets.respond({ requestId: pending.requestId, decision: "once" });
      const result = yield* Fiber.join(read);
      expect(result.isError).toBe(false);
      expect(encodeJson(result)).toContain("approved-secret");
      const invalid = yield* server.callTool({
        name: "secrets_write",
        arguments: {
          key: "key",
          scope: "environment",
          value: "secret-sentinel",
          highlySensitive: "invalid-secret-sentinel",
        },
      });
      expect(invalid.isError).toBe(true);
      expect(encodeJson(invalid)).not.toContain("secret-sentinel");
    }).pipe(
      Effect.provideService(McpInvocationContext, invocation),
      Effect.provideService(McpSchema.McpServerClient, client),
      Effect.provide(TestLayer),
    ),
);

it.effect("MCP denies credentials without secrets capability and unknown threads", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    for (const caller of [
      { ...invocation, capabilities: new Set<"secrets">() },
      { ...invocation, threadId: ThreadId.make("deleted-thread") },
    ]) {
      const result = yield* server
        .callTool({ name: "secrets_list", arguments: {} })
        .pipe(Effect.provideService(McpInvocationContext, caller));
      expect(result.isError).toBe(true);
      expect(encodeJson(result)).toContain("denied");
    }
  }).pipe(Effect.provideService(McpSchema.McpServerClient, client), Effect.provide(TestLayer)),
);
