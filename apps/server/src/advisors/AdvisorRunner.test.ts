import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, PubSub, Stream } from "effect";
import {
  EventId,
  ProviderDriverKind,
  RuntimeRequestId,
  ProviderInstanceId,
  TurnId,
  type ProviderRuntimeEvent,
  type ProviderSessionStartInput,
} from "@t3tools/contracts";
import { extractAdvisorReviewJson, make } from "./AdvisorRunner.ts";
import { ProviderAdapterRegistry } from "../provider/Services/ProviderAdapterRegistry.ts";
import { makeAdapterRegistryMock } from "../provider/testUtils/providerAdapterRegistryMock.ts";
import type { ProviderAdapterShape } from "../provider/Services/ProviderAdapter.ts";
import type { ProviderAdapterError } from "../provider/Errors.ts";

it.effect(
  "observes early events, denies approvals, captures findings and closes its reviewer session",
  () =>
    Effect.gen(function* () {
      const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();
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
            yield* PubSub.publish(events, {
              ...base,
              eventId: EventId.make("question"),
              type: "user-input.requested",
              requestId: RuntimeRequestId.make("question"),
              payload: { questions: [] },
            });
            yield* PubSub.publish(events, {
              ...base,
              eventId: EventId.make("approval"),
              type: "request.opened",
              requestId: RuntimeRequestId.make("request"),
              payload: { requestType: "command_execution_approval" },
            });
            yield* PubSub.publish(events, {
              ...base,
              eventId: EventId.make("content"),
              type: "content.delta",
              payload: {
                streamKind: "assistant_text",
                delta:
                  '{"summary":"Checked cancellation","findings":[{"severity":"concern","text":"Worker.ts:12 leaves a receipt unresolved"}]}',
              },
            });
            yield* PubSub.publish(events, {
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
        streamEvents: Stream.fromPubSub(events),
      };
      const runner = yield* make.pipe(
        Effect.provideService(
          ProviderAdapterRegistry,
          makeAdapterRegistryMock({ [provider]: adapter }),
        ),
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
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it("extracts a review object from provider prose or a fenced response", () => {
  const review = '{"summary":"Checked","findings":[]}';
  assert.strictEqual(extractAdvisorReviewJson(`Here is the review:\n${review}\nDone.`), review);
  assert.strictEqual(extractAdvisorReviewJson(`\`\`\`json\n${review}\n\`\`\``), review);
});
