import {
  defaultReviewerConfiguration,
  type ReviewerFinding,
  type ReviewerRun,
} from "@t3tools/contracts";
import { Effect, Layer, Stream } from "effect";
import { Reviewers } from "./Reviewers.ts";

const configuration = defaultReviewerConfiguration();

export const reviewerTestLayer = Layer.succeed(Reviewers, {
  save: () => Effect.succeed(undefined),
  subscribe: () =>
    Stream.make({
      configuration,
      runs: [] as ReviewerRun[],
      findings: [] as ReviewerFinding[],
    }),
  action: () => Effect.succeed(undefined),
  optimize: (input) => Effect.succeed({ markdown: input.markdown }),
  generateName: () => Effect.succeed({ name: "Review rule" }),
  drain: Effect.void,
});
