// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalDateInEffect:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "./config.ts";
import { ServerLoggerLive } from "./serverLogger.ts";
import * as ResourceAttribution from "./resourceTelemetry/ResourceAttribution.ts";
import { makeServerLogStore, readServerLogDiagnostics, readServerLogTail } from "./serverLog.ts";

const TestLayer = ServerConfig.ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-server-log-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

const IntegrationLayer = Layer.mergeAll(TestLayer, ResourceAttribution.layer);

function makeLogConfig(overrides: Partial<ServerConfig.ServerLogConfig> = {}) {
  return {
    ...ServerConfig.DEFAULT_SERVER_LOG_CONFIG,
    ...overrides,
  } satisfies ServerConfig.ServerLogConfig;
}

it.effect("installs the file logger alongside the server observability loggers", () =>
  Effect.gen(function* () {
    const logPath = yield* Effect.scoped(
      Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        yield* Effect.logError("server logger integration test");
        return config.serverLogPath;
      }).pipe(Effect.provide(ServerLoggerLive)),
    );

    const contents = NodeFS.readFileSync(logPath, "utf8");
    assert.include(contents, "server logger integration test");
  }).pipe(Effect.provide(IntegrationLayer)),
);

it.effect("writes structured, redacted records and exposes a bounded tail", () =>
  Effect.gen(function* () {
    const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-server-log-"));
    try {
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const baseConfig = yield* ServerConfig.ServerConfig;
          const config = ServerConfig.make({
            ...baseConfig,
            serverLogPath: NodePath.join(tempDir, "server.log"),
            serverLog: makeLogConfig({ batchWindowMs: 1, maxBufferedRecords: 1 }),
          });
          const writer = yield* makeServerLogStore(config);
          assert.exists(writer.logger);
          if (!writer.logger) return yield* Effect.die("Expected the test server log writer");

          yield* Effect.logInfo("Authorization: Bearer top-secret-token").pipe(
            Effect.annotateLogs({ token: "annotation-secret", operation: "server-log-test" }),
            Effect.provide(Logger.layer([writer.logger], { mergeWithExisting: false })),
          );
          const diagnostics = yield* readServerLogDiagnostics(config);
          const tail = yield* readServerLogTail(config, { maxBytes: 1024, maxEntries: 10 });
          return { config, diagnostics, tail };
        }),
      );

      const contents = NodeFS.readFileSync(result.config.serverLogPath, "utf8");
      assert.notInclude(contents, "top-secret-token");
      assert.notInclude(contents, "annotation-secret");
      assert.include(contents, "[REDACTED]");
      assert.equal(NodeFS.statSync(result.config.serverLogPath).mode & 0o777, 0o600);

      assert.equal(result.diagnostics.enabled, true);
      assert.equal(result.diagnostics.writeFailureCount, 0);
      assert.equal(result.diagnostics.retainedFileCount, 1);

      assert.equal(result.tail.entries.length, 1);
      assert.notInclude(result.tail.entries[0]?.message ?? "", "top-secret-token");
      assert.notInclude(result.tail.entries[0]?.message ?? "", "annotation-secret");

      const diagnosticsAfterShutdown = yield* readServerLogDiagnostics(result.config);
      assert.equal(diagnosticsAfterShutdown.enabled, false);
    } finally {
      NodeFS.rmSync(tempDir, { recursive: true, force: true });
    }
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("rotates files and compacts backups under the total-byte budget", () =>
  Effect.gen(function* () {
    const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-server-log-"));
    try {
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const baseConfig = yield* ServerConfig.ServerConfig;
          const config = ServerConfig.make({
            ...baseConfig,
            serverLogPath: NodePath.join(tempDir, "server.log"),
            serverLog: makeLogConfig({
              maxBytes: 220,
              maxFiles: 3,
              maxTotalBytes: 430,
              maxAgeMs: 24 * 60 * 60 * 1_000,
              batchWindowMs: 1,
              maxBufferedRecords: 1,
              maxBufferedBytes: 1024,
              retentionCheckIntervalMs: 5 * 60 * 1_000,
              maxRecordBytes: 180,
              maxWriteChunkBytes: 180,
            }),
          });
          const writer = yield* makeServerLogStore(config);
          assert.exists(writer.logger);
          if (!writer.logger) return config;

          yield* Effect.forEach(
            Array.from({ length: 8 }, (_, index) => index),
            (index) =>
              Effect.logInfo(`rotation-record-${index}-${"x".repeat(120)}`).pipe(
                Effect.provide(Logger.layer([writer.logger!], { mergeWithExisting: false })),
              ),
            { discard: true },
          );
          yield* TestClock.adjust(5 * 60 * 1_000);
          return config;
        }),
      );

      const files = NodeFS.readdirSync(tempDir).filter((file) => file.startsWith("server.log"));
      assert.isAtMost(files.length, 4);
      const totalBytes = files.reduce(
        (total, file) => total + NodeFS.statSync(NodePath.join(tempDir, file)).size,
        0,
      );
      assert.isAtMost(
        totalBytes,
        result.serverLog?.maxTotalBytes ?? ServerConfig.DEFAULT_SERVER_LOG_CONFIG.maxTotalBytes,
      );
      assert.isTrue(NodeFS.existsSync(result.serverLogPath));
    } finally {
      NodeFS.rmSync(tempDir, { recursive: true, force: true });
    }
  }).pipe(Effect.provide(TestLayer)),
);
