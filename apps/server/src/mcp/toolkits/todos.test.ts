import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { Effect, Layer, Option, Schema } from "effect";
import { McpSchema, McpServer } from "effect/unstable/ai";
import { ServerConfig } from "../../config.ts";
import { OrchestrationLayerLive } from "../../orchestration/runtimeLayer.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import {
  McpInvocationContext,
  type McpInvocationScope,
  type McpCapability,
} from "../McpInvocationContext.ts";
import { TodosToolkitRegistrationLive } from "./todos.ts";

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const threadId = ThreadId.make("todo-thread");
const projectId = ProjectId.make("todo-project");
const invocation: McpInvocationScope = {
  environmentId: EnvironmentId.make("env"),
  threadId,
  providerSessionId: "session",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(["todos"]),
  issuedAt: 1,
};
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "test", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  },
  getClient: Effect.die("unused"),
});
const TestLayer = TodosToolkitRegistrationLive.pipe(
  Layer.provideMerge(McpServer.McpServer.layer),
  Layer.provideMerge(OrchestrationLayerLive),
  Layer.provide(RepositoryIdentityResolver.layer),
  Layer.provide(SqlitePersistenceMemory),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-todos-mcp-" })),
  Layer.provide(NodeServices.layer),
);
it.effect(
  "MCP confirms committed TODOs, rejects invalid mutations and enforces the authenticated thread",
  () =>
    Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService;
      const query = yield* ProjectionSnapshotQuery;
      const server = yield* McpServer.McpServer;
      const createdAt = "2026-09-09T00:00:00.000Z";
      yield* engine.dispatch({
        type: "project.create",
        commandId: CommandId.make("project"),
        projectId,
        title: "TODOs",
        workspaceRoot: process.cwd(),
        createdAt,
      });
      yield* engine.dispatch({
        type: "thread.create",
        commandId: CommandId.make("thread"),
        threadId,
        projectId,
        title: "TODOs",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt,
      });
      const result = yield* server.callTool({
        name: "todo",
        arguments: { op: "init", items: ["Review", "Build"], threadId: "other-thread" },
      });
      expect(result.isError).toBe(false);
      const saved = Option.getOrThrow(yield* query.getThreadDetailById(threadId)).todos!;
      expect(saved.items.map((item) => item.content)).toEqual(["Review", "Build"]);
      expect(yield* encodeJson(result.content)).toContain("Review");
      expect(Option.isNone(yield* query.getThreadDetailById(ThreadId.make("other-thread")))).toBe(
        true,
      );
      const invalid = yield* server.callTool({
        name: "todo",
        arguments: { op: "done", task: "Missing" },
      });
      expect(invalid.isError).toBe(true);
      expect(Option.getOrThrow(yield* query.getThreadDetailById(threadId)).todos).toEqual(saved);
      const denied = yield* server.callTool({ name: "todo", arguments: { op: "rm" } }).pipe(
        Effect.provideService(McpInvocationContext, {
          ...invocation,
          capabilities: new Set<McpCapability>(),
        }),
      );
      expect(denied.isError).toBe(true);
      const viewed = yield* server.callTool({ name: "todo", arguments: { op: "view" } });
      expect(viewed.isError).toBe(false);
      expect(Option.getOrThrow(yield* query.getThreadDetailById(threadId)).todos?.revision).toBe(
        saved.revision,
      );
    }).pipe(
      Effect.provideService(McpInvocationContext, invocation),
      Effect.provideService(McpSchema.McpServerClient, client),
      Effect.provide(TestLayer),
    ),
);
