// @effect-diagnostics preferSchemaOverJson:off - Tests write project-owned rule fixtures as JSON.
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  emptyCodeToolsConfiguration,
} from "@t3tools/contracts";
import { Effect, FileSystem, Layer, Option, Stream } from "effect";
import * as CodeTools from "./CodeTools.ts";
import { runCommand } from "./process.ts";
import { ServerConfig } from "../config.ts";
import * as ForkFeatureRuntime from "../orchestration-v2/testkit/ForkFeatureRuntime.ts";
const layer = CodeTools.layer.pipe(
  Layer.provideMerge(ForkFeatureRuntime.layer),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-code-tools-test-" })),
  Layer.provide(NodeServices.layer),
);
const setup = Effect.fn("CodeTools.testSetup")(function* (active = false) {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-code-rules-" });
  yield* Effect.promise(() => runCommand("git", ["init", "--initial-branch=main"], { cwd: root }));
  yield* Effect.promise(() =>
    runCommand(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "--allow-empty",
        "-m",
        "Initial",
      ],
      { cwd: root },
    ),
  );
  const threadId = ThreadId.make("checks-thread");
  const projectId = ProjectId.make("checks-project");
  const createdAt = "2026-09-10T00:00:00.000Z";
  yield* ForkFeatureRuntime.seedThread({
    threadId,
    projectId,
    cwd: root,
    title: "Code tools",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
    active,
  });
  const tools = yield* CodeTools.CodeTools;
  yield* tools.save({
    ...emptyCodeToolsConfiguration({ type: "environment" }),
    installMode: "manual",
    mode: "guide",
    servers: [{ id: "json", enabled: false }],
    rulesFile: "rules.json",
    maxCorrections: 1,
  });
  yield* fs.writeFileString(
    `${root}/rules.json`,
    JSON.stringify({
      rules: [
        {
          id: "old",
          files: ["*.txt"],
          message: "Existing rule",
          severity: "error",
          match: { type: "regex", pattern: "OLD" },
        },
        {
          id: "new",
          files: ["*.txt"],
          message: "New rule",
          severity: "error",
          match: { type: "regex", pattern: "NEW" },
        },
      ],
    }),
  );
  return { root, tools, threadId, projectId, fs };
});
const snapshot = (tools: CodeTools.CodeTools["Service"], threadId: ThreadId) =>
  tools
    .subscribe({ threadId, details: true, settings: true })
    .pipe(Stream.runHead, Effect.map(Option.getOrThrow));

it.effect("preserves scoped settings, rejects stale saves, and applies inherited rules", () =>
  Effect.gen(function* () {
    const { tools, root, fs, threadId, projectId } = yield* setup();
    const setting = {
      ...emptyCodeToolsConfiguration({ type: "project" as const, projectId }),
      maxCorrections: 2,
    };
    yield* tools.save(setting);
    assert.strictEqual((yield* tools.save(setting).pipe(Effect.result))._tag, "Failure");
    yield* fs.writeFileString(`${root}/file.txt`, "NEW\n");
    yield* tools.check(threadId);
    const state = yield* snapshot(tools, threadId);
    assert.strictEqual(state.checks?.status, "issues");
    assert.strictEqual(state.checks?.diagnostics[0]?.code, "new");
    assert.strictEqual(
      state.configurations.find((value) => value.scope.type === "project")?.revision,
      1,
    );
  }).pipe(Effect.provide(layer), Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("reports invalid rule files and supports pausing", () =>
  Effect.gen(function* () {
    const { tools, fs, root, threadId } = yield* setup();
    yield* fs.writeFileString(`${root}/rules.json`, "invalid JSON");
    assert.strictEqual((yield* tools.check(threadId).pipe(Effect.result))._tag, "Failure");
    yield* tools.save({
      ...emptyCodeToolsConfiguration({ type: "thread", threadId }),
      mode: "off",
    });
    yield* tools.check(threadId);
    assert.strictEqual((yield* snapshot(tools, threadId)).checks?.status, "paused");
  }).pipe(Effect.provide(layer), Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect.each([true, false])(
  "guidance respects existing findings and retry budget with active=%s",
  (active) =>
    Effect.gen(function* () {
      const { tools, fs, root, threadId } = yield* setup(active);
      yield* fs.writeFileString(`${root}/file.txt`, "OLD\n");
      yield* tools.prepare(threadId);
      yield* tools.check(threadId);
      assert.strictEqual((yield* snapshot(tools, threadId)).checks?.corrections, 0);
      yield* fs.writeFileString(`${root}/file.txt`, "OLD\nNEW\n");
      yield* tools.check(threadId);
      assert.strictEqual((yield* snapshot(tools, threadId)).checks?.corrections, active ? 1 : 0);
      yield* tools.check(threadId);
      assert.strictEqual((yield* snapshot(tools, threadId)).checks?.corrections, active ? 1 : 0);
    }).pipe(Effect.provide(layer), Effect.scoped, Effect.provide(NodeServices.layer)),
);
