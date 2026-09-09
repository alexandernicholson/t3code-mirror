import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { decideOrchestrationCommand } from "./decider.ts";

const now = "2026-09-08T12:00:00.000Z";
const threadId = ThreadId.make("queue-thread");
const turnId = TurnId.make("active-turn");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
function model(): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    updatedAt: now,
    threads: [
      {
        id: threadId,
        projectId: ProjectId.make("project"),
        title: "Queued work",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        deletedAt: null,
        messages: [],
        activities: [],
        proposedPlans: [],
        checkpoints: [],
        latestTurn: {
          turnId,
          state: "running",
          requestedAt: now,
          startedAt: now,
          completedAt: null,
          assistantMessageId: null,
        },
        session: {
          threadId,
          status: "running",
          providerName: "codex",
          activeTurnId: turnId,
          runtimeMode: "full-access",
          lastError: null,
          updatedAt: now,
        },
      },
    ],
  };
}

for (const state of ["running", "completed", "interrupted", "plan", "new-turn"] as const) {
  it.effect(`advisor guidance respects ${state} at command dispatch`, () =>
    Effect.gen(function* () {
      const readModel = model();
      const thread = readModel.threads[0]!;
      const modified = {
        ...thread,
        interactionMode: state === "plan" ? ("plan" as const) : ("default" as const),
        latestTurn: thread.latestTurn
          ? {
              ...thread.latestTurn,
              state:
                state === "completed"
                  ? ("completed" as const)
                  : state === "interrupted"
                    ? ("interrupted" as const)
                    : ("running" as const),
            }
          : null,
        session: thread.session
          ? {
              ...thread.session,
              activeTurnId: state === "new-turn" ? TurnId.make("another-turn") : turnId,
            }
          : null,
      };
      const command: OrchestrationCommand = {
        type: "thread.turn.start",
        commandId: CommandId.make("advisor-guidance"),
        threadId,
        expectedActiveTurnId: turnId,
        delivery: "steer",
        message: {
          messageId: MessageId.make("advisor:finding"),
          role: "user",
          text: "Check this finding",
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: now,
      };
      const result = yield* decideOrchestrationCommand({
        readModel: { ...readModel, threads: [modified] },
        command,
      }).pipe(Effect.result);
      expect(result._tag).toBe(state === "running" ? "Success" : "Failure");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
}
