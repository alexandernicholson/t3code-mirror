import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import * as ServerConfig from "../config.ts";
import * as Identify from "./Identify.ts";

it.layer(NodeServices.layer)("telemetry identity", (it) => {
  it.effect("persists a random installation id without accessing provider auth files", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      // Any read outside the installation id is forbidden, including provider auth files.
      const restrictedFileSystem = FileSystem.makeNoop({
        readFileString: (filePath) => {
          assert.equal(filePath, config.anonymousIdPath);
          return fileSystem.readFileString(filePath);
        },
        writeFileString: (filePath, content) => {
          assert.equal(filePath, config.anonymousIdPath);
          return fileSystem.writeFileString(filePath, content);
        },
      });
      const identifier = yield* Identify.getTelemetryIdentifier.pipe(
        Effect.provideService(FileSystem.FileSystem, restrictedFileSystem),
      );
      assert.match(
        identifier ?? "",
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      assert.equal(yield* fileSystem.readFileString(config.anonymousIdPath), identifier);
      const nextIdentifier = yield* Identify.getTelemetryIdentifier.pipe(
        Effect.provideService(FileSystem.FileSystem, restrictedFileSystem),
      );
      assert.equal(nextIdentifier, identifier);
    }).pipe(
      Effect.provide(
        ServerConfig.layerTest(process.cwd(), { prefix: "t3-telemetry-identify-anonymous-" }),
      ),
    ),
  );

  it.effect("does not overwrite the anonymous id path after a non-NotFound read failure", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      yield* fileSystem.makeDirectory(config.anonymousIdPath);

      assert.isNull(yield* Identify.getTelemetryIdentifier);
      assert.deepEqual(yield* fileSystem.readDirectory(config.anonymousIdPath), []);
    }).pipe(
      Effect.provide(
        ServerConfig.layerTest(process.cwd(), { prefix: "t3-telemetry-identify-read-" }),
      ),
    ),
  );
});
