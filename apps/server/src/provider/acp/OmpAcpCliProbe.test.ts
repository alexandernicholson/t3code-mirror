/** Optional handshake check against an official OMP binary. */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { ChildProcessSpawner } from "effect/unstable/process";
import { describe, expect } from "vite-plus/test";

import { makeOmpAcpRuntime, ompModelsFromConfigOptions } from "./OmpAcpSupport.ts";

describe.runIf(Boolean(process.env.T3_OMP_BINARY))("OMP ACP CLI probe", () => {
  it.effect("starts a real ACP session and discovers its model configuration", () =>
    Effect.gen(function* () {
      const binaryPath = process.env.T3_OMP_BINARY;
      expect(binaryPath).toBeDefined();
      if (!binaryPath) return;
      const fileSystem = yield* FileSystem.FileSystem;
      const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const cwd = yield* fileSystem.makeTempDirectoryScoped();
      const runtime = yield* makeOmpAcpRuntime({
        ompSettings: { binaryPath, launchArgs: "--no-extensions" },
        environment: process.env,
        childProcessSpawner,
        cwd,
        runtimeMode: "approval-required",
        clientInfo: { name: "t3-omp-probe", version: "0.0.0" },
      });
      const started = yield* runtime.start();
      expect(started.initializeResult.agentInfo?.name).toBe("oh-my-pi");
      expect(started.initializeResult.agentCapabilities?.loadSession).toBe(true);
      expect(started.sessionId.length).toBeGreaterThan(0);
      expect(
        ompModelsFromConfigOptions(started.sessionSetupResult.configOptions ?? []).length,
      ).toBeGreaterThan(0);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
