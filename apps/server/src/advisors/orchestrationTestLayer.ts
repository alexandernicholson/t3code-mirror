import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  EventId,
  ProjectId,
  ThreadId,
  TurnId,
  emptyAdvisorConfiguration,
  type AdvisorDefinition,
} from "@t3tools/contracts";
import { Effect, Fiber, Layer, Option, Stream } from "effect";
import * as Advisors from "./Advisors.ts";
import * as Store from "./AdvisorStore.ts";
import { ServerConfig } from "../config.ts";
import * as ForkFeatureRuntime from "../orchestration-v2/testkit/ForkFeatureRuntime.ts";
import { ForkThreadRuntime as OrchestrationEngineService } from "../orchestration-v2/ForkThreadRuntime.ts";
export const advisorOrchestrationTestLayer = Advisors.layer.pipe(
  Layer.provideMerge(Store.layer),
  Layer.provideMerge(ForkFeatureRuntime.layer),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-advisor-orchestration-" })),
  Layer.provide(NodeServices.layer),
);

/** A real orchestration task and persisted review, with completion observed through the subscription. */
export const runAdvisorTask = Effect.fn("runAdvisorTask")(function* (input: {
  cwd: string;
  name: string;
  definition: AdvisorDefinition;
  active: boolean;
}) {
  const engine = yield* OrchestrationEngineService;
  const advisors = yield* Advisors.Advisors;
  const store = yield* Store.AdvisorStore;
  const threadId = ThreadId.make(input.name);
  const projectId = ProjectId.make(input.name);
  const turnId = TurnId.make(input.name);
  const createdAt = "2026-09-09T00:00:00.000Z";
  yield* ForkFeatureRuntime.seedThread({
    threadId,
    projectId,
    cwd: input.cwd,
    title: "Implement isAdult: ages 18 and older return true",
    modelSelection: input.definition.modelSelection,
    active: input.active,
  });
  yield* advisors.start();
  yield* advisors.save({
    ...emptyAdvisorConfiguration({ type: "thread", threadId }),
    definitions: [input.definition],
    advisorIds: [input.definition.id],
  });
  yield* advisors.drain;
  const completed = yield* store.subscribe({ threadId, details: true }).pipe(
    Stream.filter((snapshot) =>
      snapshot.states.some((state) => state.reviewCount > 0 || state.status === "unavailable"),
    ),
    Stream.runHead,
    Effect.forkScoped({ startImmediately: true }),
  );
  yield* engine.dispatch({
    type: "thread.activity.append",
    commandId: CommandId.make(`${input.name}:edit`),
    threadId,
    createdAt,
    activity: {
      id: EventId.make(`${input.name}:edit`),
      tone: "info",
      kind: "file.changed",
      summary: "Implemented adult.js. Review the age boundary in this file.",
      payload: { path: "adult.js" },
      turnId,
      createdAt,
    },
  });
  const result = Option.getOrThrow(yield* Fiber.join(completed));
  yield* advisors.drain;
  return { threadId, result };
});
