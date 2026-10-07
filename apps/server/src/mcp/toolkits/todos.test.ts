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
import { McpSchema, McpServer } from "effect/ai";
import { ServerConfig } from "../../config.ts";
import * as ForkFeatureRuntime from "../../orchestration-v2/testkit/ForkFeatureRuntime.ts";
import { OrchestratorV2 } from "../../orchestration-v2/Orchestrator.ts";
import {
  McpInvocationContext,
  type McpInvocationScope,
  type McpCapability,
} from "../McpInvocationContext.ts";
import { TodosToolkitRegistrationLive } from "../McpHttpServer.ts";

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const threadId = ThreadId.make("todo-thread");
const projectId = ProjectId.make("todo-project");
const invocation: McpInvocationScope = {
  environmentId: EnvironmentId.make("env"),
  requestNamespace: "session",
  thread: {
    threadId,
    providerSessionId: "session",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
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
  Layer.provideMerge(ForkFeatureRuntime.layer),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-todos-mcp-" })),
  Layer.provide(NodeServices.layer),
);
it.effect(
  "MCP confirms committed TODOs, rejects invalid mutations and enforces the authenticated thread",
  () =>
    Effect.gen(function* () {
      const engine = yield* OrchestratorV2;
      const server = yield* McpServer.McpServer;
      const createdAt = "2026-09-09T00:00:00.000Z";
      yield* ForkFeatureRuntime.seedThread({
        threadId,
        projectId,
        cwd: process.cwd(),
        title: "TODOs",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
        active: false,
      });
      const result = yield* server.callTool({
        name: "todo",
        arguments: { op: "init", items: ["Review", "Build"], threadId: "other-thread" },
      });
      expect(result.isError).toBe(false);
      const saved = (yield* engine.getThreadProjection(threadId)).thread.todos!;
      expect(saved.items.map((item) => item.content)).toEqual(["Review", "Build"]);
      expect(yield* encodeJson(result.content)).toContain("Review");
      expect(yield* engine.getThreadShell(ThreadId.make("other-thread"))).toBeNull();
      const invalid = yield* server.callTool({
        name: "todo",
        arguments: { op: "done", task: "Missing" },
      });
      expect(invalid.isError).toBe(true);
      expect((yield* engine.getThreadProjection(threadId)).thread.todos).toEqual(saved);
      const denied = yield* server.callTool({ name: "todo", arguments: { op: "rm" } }).pipe(
        Effect.provideService(McpInvocationContext, {
          ...invocation,
          capabilities: new Set<McpCapability>(),
        }),
      );
      expect(denied.isError).toBe(true);
      const viewed = yield* server.callTool({ name: "todo", arguments: { op: "view" } });
      expect(viewed.isError).toBe(false);
      expect((yield* engine.getThreadProjection(threadId)).thread.todos?.revision).toBe(
        saved.revision,
      );
    }).pipe(
      Effect.provideService(McpInvocationContext, invocation),
      Effect.provideService(McpSchema.McpServerClient, client),
      Effect.provide(TestLayer),
    ),
);
