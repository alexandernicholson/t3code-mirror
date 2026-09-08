import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProjectId, ThreadId, type SecretTarget } from "@t3tools/contracts";
import { Effect, Fiber, Layer, Option, Ref, Schema, Stream } from "effect";
import * as ServerConfig from "../config.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as SecretBackend from "./SecretBackend.ts";
import * as SecretApprovals from "./SecretApprovals.ts";
import * as Secrets from "./Secrets.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const TestLayer = Layer.merge(SecretApprovals.layer, SecretBackend.localBackendLayer).pipe(
  Layer.provide(ServerSecretStore.layer),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-agent-secrets-" })),
  Layer.provideMerge(NodeServices.layer),
);
const target: SecretTarget = { key: "API_KEY", scope: { type: "environment" } };
const thread = ThreadId.make("thread-a");
const otherThread = ThreadId.make("thread-b");
const fixture = Effect.gen(function* () {
  const reader = yield* SecretBackend.SecretReader;
  const reads = yield* Ref.make(0);
  const service = yield* Secrets.make.pipe(
    Effect.provideService(SecretBackend.SecretReader, {
      list: reader.list,
      read: (key, revision) =>
        Ref.update(reads, (count) => count + 1).pipe(Effect.andThen(reader.read(key, revision))),
    }),
  );
  return { service, reads };
});
const pendingRequest = (service: Effect.Success<typeof Secrets.make>, threadId = thread) =>
  service.changes.pipe(
    Stream.map((snapshot) =>
      snapshot.pendingReads.find((request) => request.threadId === threadId),
    ),
    Stream.filter((request) => request !== undefined),
    Stream.runHead,
    Effect.flatMap(Effect.fromOption),
  );

it.effect(
  "stores and replaces independent environment and project keys without exposing values in snapshots",
  () =>
    Effect.gen(function* () {
      const { service } = yield* fixture;
      const projectTarget: SecretTarget = {
        key: target.key,
        scope: { type: "project", projectId: ProjectId.make("project-a") },
      };
      yield* service.create({ ...target, value: "environment-value", highlySensitive: false });
      yield* service.create({ ...projectTarget, value: "project-value", highlySensitive: false });
      expect(yield* service.readForAgent(target, thread, "test")).toBe("environment-value");
      expect(yield* service.readForAgent(projectTarget, thread, "test")).toBe("project-value");
      const snapshot = Option.getOrThrow(yield* service.changes.pipe(Stream.runHead));
      expect(snapshot.entries).toHaveLength(2);
      expect(encodeJson(snapshot)).not.toContain("environment-value");
      expect(encodeJson(snapshot)).not.toContain("project-value");
      const old = snapshot.entries.find((entry) => entry.scope.type === "environment")!;
      yield* service.update({ ...old, value: "replacement" });
      expect(yield* service.update({ ...old, value: "stale" }).pipe(Effect.flip)).toMatchObject({
        code: "conflict",
      });
      expect(yield* service.readForAgent(target, thread, "test")).toBe("replacement");
      const current = (yield* service.list).find((entry) => entry.scope.type === "environment")!;
      yield* service.remove(current);
      expect(yield* service.readForAgent(target, thread, "test").pipe(Effect.flip)).toMatchObject({
        code: "not_found",
      });
    }).pipe(Effect.provide(TestLayer)),
);

it.effect("does not resolve a highly sensitive value before approval or after denial", () =>
  Effect.gen(function* () {
    const { service, reads } = yield* fixture;
    yield* service.create({ ...target, value: "sensitive-value", highlySensitive: true });
    const read = yield* service
      .readForAgent(target, thread, "Deploy the app")
      .pipe(Effect.forkChild);
    const request = yield* pendingRequest(service);
    expect(yield* Ref.get(reads)).toBe(0);
    expect(encodeJson(request)).not.toContain("sensitive-value");
    yield* service.respond({ requestId: request.requestId, decision: "deny" });
    expect(yield* Fiber.join(read).pipe(Effect.flip)).toMatchObject({ code: "denied" });
    expect(yield* Ref.get(reads)).toBe(0);
    expect(
      yield* service.respond({ requestId: request.requestId, decision: "once" }).pipe(Effect.flip),
    ).toMatchObject({ code: "not_found" });
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("allow once is consumed, while thread approval is isolated and revocable", () =>
  Effect.gen(function* () {
    const { service, reads } = yield* fixture;
    yield* service.create({ ...target, value: "sensitive-value", highlySensitive: true });
    const first = yield* service.readForAgent(target, thread, "test").pipe(Effect.forkChild);
    yield* service.respond({
      requestId: (yield* pendingRequest(service)).requestId,
      decision: "once",
    });
    expect(yield* Fiber.join(first)).toBe("sensitive-value");
    const second = yield* service.readForAgent(target, thread, "test again").pipe(Effect.forkChild);
    yield* service.respond({
      requestId: (yield* pendingRequest(service)).requestId,
      decision: "thread",
    });
    yield* Fiber.join(second);
    expect(yield* service.readForAgent(target, thread, "third read")).toBe("sensitive-value");
    expect(yield* Ref.get(reads)).toBe(3);
    const other = yield* service
      .readForAgent(target, otherThread, "other thread")
      .pipe(Effect.forkChild);
    yield* service.respond({
      requestId: (yield* pendingRequest(service, otherThread)).requestId,
      decision: "deny",
    });
    yield* Fiber.join(other).pipe(Effect.flip);
    yield* service.revoke({ threadId: thread });
    const revoked = yield* service.readForAgent(target, thread, "revoked").pipe(Effect.forkChild);
    yield* pendingRequest(service);
    yield* Fiber.interrupt(revoked);
    const snapshot = Option.getOrThrow(yield* service.changes.pipe(Stream.runHead));
    expect(snapshot.pendingReads).toEqual([]);
    expect(snapshot.threadGrants).toEqual([]);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect(
  "replacement invalidates pending reads and thread grants; agents cannot downgrade sensitivity",
  () =>
    Effect.gen(function* () {
      const { service } = yield* fixture;
      yield* service.create({ ...target, value: "old", highlySensitive: true });
      const first = yield* service.readForAgent(target, thread, "test").pipe(Effect.forkChild);
      yield* service.respond({
        requestId: (yield* pendingRequest(service)).requestId,
        decision: "thread",
      });
      yield* Fiber.join(first);
      const pending = yield* service
        .readForAgent(target, otherThread, "test")
        .pipe(Effect.forkChild);
      const request = yield* pendingRequest(service, otherThread);
      const changed = yield* service.writeForAgent({
        ...target,
        value: "new",
        highlySensitive: false,
      });
      expect(changed.highlySensitive).toBe(true);
      expect(yield* Fiber.join(pending).pipe(Effect.flip)).toMatchObject({ code: "conflict" });
      expect(
        yield* service
          .respond({ requestId: request.requestId, decision: "once" })
          .pipe(Effect.flip),
      ).toMatchObject({ code: "not_found" });
      const after = yield* service
        .readForAgent(target, thread, "new revision")
        .pipe(Effect.forkChild);
      yield* service.respond({
        requestId: (yield* pendingRequest(service)).requestId,
        decision: "once",
      });
      expect(yield* Fiber.join(after)).toBe("new");
    }).pipe(Effect.provide(TestLayer)),
);

it.effect(
  "preserves stored secrets when a new service starts, without preserving approval grants",
  () =>
    Effect.gen(function* () {
      const { service } = yield* fixture;
      yield* service.create({ ...target, value: "persisted", highlySensitive: true });
      const original = yield* service
        .readForAgent(target, thread, "original grant")
        .pipe(Effect.forkChild);
      yield* service.respond({
        requestId: (yield* pendingRequest(service)).requestId,
        decision: "thread",
      });
      yield* Fiber.join(original);
      const approvals = yield* SecretApprovals.make;
      const restarted = yield* Secrets.make.pipe(
        Effect.provideService(SecretApprovals.SecretApprovals, approvals),
      );
      expect(yield* restarted.list).toEqual(yield* service.list);
      const read = yield* restarted.readForAgent(target, thread, "test").pipe(Effect.forkChild);
      yield* restarted.respond({
        requestId: (yield* pendingRequest(restarted)).requestId,
        decision: "once",
      });
      expect(yield* Fiber.join(read)).toBe("persisted");
    }).pipe(Effect.scoped, Effect.provide(TestLayer)),
);

it.effect(
  "thread approval releases matching concurrent reads but does not authorize another scope",
  () =>
    Effect.gen(function* () {
      const { service } = yield* fixture;
      const projectTarget: SecretTarget = {
        key: target.key,
        scope: { type: "project", projectId: ProjectId.make("project-a") },
      };
      yield* service.create({ ...target, value: "environment", highlySensitive: true });
      yield* service.create({ ...projectTarget, value: "project", highlySensitive: true });
      const reads = yield* Effect.all([
        service.readForAgent(target, thread, "first").pipe(Effect.forkChild),
        service.readForAgent(target, thread, "second").pipe(Effect.forkChild),
        service.readForAgent(projectTarget, thread, "project").pipe(Effect.forkChild),
      ]);
      const snapshot = yield* service.changes.pipe(
        Stream.filter((state) => state.pendingReads.length === 3),
        Stream.runHead,
        Effect.flatMap(Effect.fromOption),
      );
      const request = snapshot.pendingReads.find((entry) => entry.scope.type === "environment")!;
      yield* service.respond({ requestId: request.requestId, decision: "thread" });
      expect(yield* Fiber.join(reads[0]!)).toBe("environment");
      expect(yield* Fiber.join(reads[1]!)).toBe("environment");
      const projectRequest = yield* pendingRequest(service);
      expect(projectRequest.scope.type).toBe("project");
      yield* service.respond({ requestId: projectRequest.requestId, decision: "deny" });
      expect(yield* Fiber.join(reads[2]!).pipe(Effect.flip)).toMatchObject({ code: "denied" });
    }).pipe(Effect.provide(TestLayer)),
);
