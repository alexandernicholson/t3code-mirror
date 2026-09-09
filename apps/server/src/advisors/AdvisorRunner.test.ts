import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Context, Deferred, Effect, Fiber, Layer, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import {
  EventId,
  ProviderDriverKind,
  RuntimeRequestId,
  ProviderInstanceId,
  TurnId,
  type ProviderRuntimeEvent,
  type ProviderSessionStartInput,
} from "@t3tools/contracts";
import { make, extractAdvisorReviewJson } from "./AdvisorRunner.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import { providerServiceTestLayer } from "../provider/testUtils/providerServiceTestLayer.ts";
import type { ProviderAdapterShape } from "../provider/Services/ProviderAdapter.ts";
import type { ProviderAdapterError } from "../provider/Errors.ts";
import { makeTestProviderAdapterHarness } from "../../integration/TestProviderAdapter.integration.ts";

it.effect(
  "observes early events, denies approvals, captures findings and closes its reviewer session",
  () =>
    Effect.gen(function* () {
      const events = yield* Queue.unbounded<ProviderRuntimeEvent>();
      let started: ProviderSessionStartInput | undefined;
      let stopped = false;
      let denied = false;
      let answered = false;
      const provider = ProviderDriverKind.make("codex");
      const adapter: ProviderAdapterShape<ProviderAdapterError> = {
        provider,
        capabilities: { sessionModelSwitch: "in-session", reviewerSession: "read-only" },
        startSession: (input) =>
          Effect.sync(() => {
            started = input;
            return {
              threadId: input.threadId,
              provider,
              status: "ready" as const,
              runtimeMode: input.runtimeMode,
              createdAt: "2026-09-09T00:00:00.000Z",
              updatedAt: "2026-09-09T00:00:00.000Z",
            };
          }),
        sendTurn: (input) =>
          Effect.gen(function* () {
            const base = {
              threadId: input.threadId,
              provider,
              createdAt: "2026-09-09T00:00:00.000Z",
            };
            yield* Queue.offer(events, {
              ...base,
              eventId: EventId.make("question"),
              type: "user-input.requested",
              requestId: RuntimeRequestId.make("question"),
              payload: { questions: [] },
            });
            yield* Queue.offer(events, {
              ...base,
              eventId: EventId.make("approval"),
              type: "request.opened",
              requestId: RuntimeRequestId.make("request"),
              payload: { requestType: "command_execution_approval" },
            });
            yield* Queue.offer(events, {
              ...base,
              eventId: EventId.make("content"),
              type: "content.delta",
              payload: {
                streamKind: "assistant_text",
                delta:
                  '{"summary":"Checked cancellation","findings":[{"severity":"concern","text":"Worker.ts:12 leaves a receipt unresolved"}]}',
              },
            });
            yield* Queue.offer(events, {
              ...base,
              eventId: EventId.make("completed"),
              type: "turn.completed",
              payload: {
                state: "completed",
                totalCostUsd: 0.01,
                tokenUsage: {
                  usageScope: "main_agent",
                  usageStatus: "complete",
                  hasSubagents: false,
                  inputTokens: 100,
                  outputTokens: 30,
                },
              },
            });
            return { threadId: input.threadId, turnId: TurnId.make("review") };
          }),
        stopSession: () =>
          Effect.sync(() => {
            stopped = true;
          }),
        respondToRequest: (_thread, _request, decision) =>
          Effect.sync(() => {
            denied = decision === "decline";
          }),
        interruptTurn: () => Effect.void,
        respondToUserInput: () =>
          Effect.sync(() => {
            answered = true;
          }),
        listSessions: () => Effect.succeed([]),
        hasSession: () => Effect.succeed(false),
        readThread: (threadId) => Effect.succeed({ threadId, turns: [] }),
        rollbackThread: (threadId) => Effect.succeed({ threadId, turns: [] }),
        stopAll: () => Effect.void,
        streamEvents: Stream.fromQueue(events),
      };
      const services = yield* Layer.build(providerServiceTestLayer(adapter));
      const runner = yield* make.pipe(Effect.provide(services));
      const providers = Context.get(services, ProviderService);
      const pull = yield* Stream.toPull(providers.streamEvents);
      const observed = yield* Stream.fromPull(Effect.succeed(pull)).pipe(
        Stream.filter((event) => event.type === "turn.completed"),
        Stream.take(1),
        Stream.runCollect,
        Effect.forkScoped({ startImmediately: true }),
      );
      const result = yield* runner.review({
        definition: {
          id: "reviewer",
          name: "Reviewer",
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
          instructions: "Review cancellation",
          mode: "guide",
        },
        cwd: "/tmp",
        context: "Review this task",
        onActivity: () => Effect.void,
      });
      assert.strictEqual(started?.reviewer, true);
      assert.strictEqual(started?.runtimeMode, "approval-required");
      assert.strictEqual(denied, true);
      assert.strictEqual(answered, true);
      assert.strictEqual(stopped, true);
      assert.strictEqual(result.findings[0]?.severity, "concern");
      assert.strictEqual(result.inputTokens, 100);
      assert.strictEqual((yield* Fiber.join(observed)).length, 1);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it("extracts a review object from provider prose or a fenced response", () => {
  const review = '{"summary":"Checked","findings":[]}';
  assert.strictEqual(extractAdvisorReviewJson(`Here is the review:\n${review}\nDone.`), review);
  assert.strictEqual(extractAdvisorReviewJson(`\`\`\`json\n${review}\n\`\`\``), review);
});

it.effect("times out a stalled session startup and cleans up the reviewer", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    let stopped = false;
    const harness = yield* makeTestProviderAdapterHarness();
    const services = yield* Layer.build(
      providerServiceTestLayer({
        ...harness.adapter,
        capabilities: { ...harness.adapter.capabilities, reviewerSession: "read-only" },
        startSession: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
        stopSession: () =>
          Effect.sync(() => {
            stopped = true;
          }),
      }),
    );
    const runner = yield* make.pipe(Effect.provide(services));
    const review = yield* runner
      .review({
        definition: {
          id: "stalled",
          name: "Stalled reviewer",
          mode: "observe",
          instructions: "Review adult.js",
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
        },
        cwd: "/tmp",
        context: "Check the age boundary",
        onActivity: () => Effect.void,
      })
      .pipe(Effect.result, Effect.forkScoped);
    yield* Deferred.await(started);
    yield* TestClock.adjust("5 minutes");
    const result = yield* Fiber.join(review);
    assert.strictEqual(result._tag, "Failure");
    if (result._tag === "Failure") assert.match(result.failure.message, /timed out/);
    assert.strictEqual(stopped, true);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
