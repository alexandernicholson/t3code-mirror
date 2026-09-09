import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeRequestId,
  TurnId,
  type ProviderRuntimeEvent,
  type ProviderSessionStartInput,
} from "@t3tools/contracts";
import { Effect, PubSub, Stream } from "effect";
import type { ProviderAdapterError } from "../provider/Errors.ts";
import type { ProviderAdapterShape } from "../provider/Services/ProviderAdapter.ts";
import { ProviderAdapterRegistry } from "../provider/Services/ProviderAdapterRegistry.ts";
import { makeAdapterRegistryMock } from "../provider/testUtils/providerAdapterRegistryMock.ts";
import { extractReviewerJson, make } from "./ReviewerRunner.ts";

it.effect("runs reviewer agents with full access and accepts tool requests", () =>
  Effect.gen(function* () {
    const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();
    const provider = ProviderDriverKind.make("codex");
    let started: ProviderSessionStartInput | undefined;
    let accepted = false;
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
                '{"summary":"Checked","findings":[{"severity":"concern","title":"Zero lost","body":"Falsy fallback","filePath":"src/a.ts","line":12}]}',
            },
          });
          yield* PubSub.publish(events, {
            ...base,
            eventId: EventId.make("done"),
            type: "turn.completed",
            payload: { state: "completed" },
          });
          return { threadId: input.threadId, turnId: TurnId.make("review") };
        }),
      stopSession: () => Effect.void,
      respondToRequest: (_thread, _request, decision) =>
        Effect.sync(() => {
          accepted = decision === "accept";
        }),
      interruptTurn: () => Effect.void,
      respondToUserInput: () => Effect.void,
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
    const output = yield* runner.review({
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
      cwd: "/tmp",
      prompt: "Review zero handling",
      depth: "quick",
    });
    assert.strictEqual(started?.runtimeMode, "full-access");
    assert.strictEqual(started?.reviewer, false);
    assert.strictEqual(accepted, true);
    assert.strictEqual(output.findings[0]?.filePath, "src/a.ts");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it("extracts structured review output from fenced provider text", () => {
  assert.strictEqual(
    extractReviewerJson('Here is the result:\n```json\n{"summary":"ok","findings":[]}\n```'),
    '{"summary":"ok","findings":[]}',
  );
});
