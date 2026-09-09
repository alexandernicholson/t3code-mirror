import { Effect, Layer, Stream } from "effect";
import { Advisors } from "./Advisors.ts";
/** Unrelated transport/reactor tests do not launch external reviewer processes. */
export const advisorTestLayer = Layer.succeed(Advisors, {
  start: () => Effect.void,
  save: () => Effect.succeed(undefined),
  action: () => Effect.succeed(undefined),
  subscribe: () =>
    Stream.succeed({
      configurations: [],
      states: [],
      entries: [],
      latestEntryId: null,
      findingCount: 0,
    }),
  drain: Effect.void,
});
