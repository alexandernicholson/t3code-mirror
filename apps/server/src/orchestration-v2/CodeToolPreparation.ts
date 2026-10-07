import type { ThreadId } from "@t3tools/contracts";
import { Context, Effect, Layer, Ref } from "effect";
import type * as Scope from "effect/Scope";

type Prepare = (threadId: ThreadId) => Effect.Effect<void>;
interface Preparation {
  readonly prepare: Prepare;
  readonly register: (prepare: Prepare) => Effect.Effect<void, never, Scope.Scope>;
}
const noop: Prepare = () => Effect.void;

/** Keeps provider startup independent of the feature service that reads its runtime. */
export class CodeToolPreparation extends Context.Reference<Preparation>(
  "t3/orchestration-v2/CodeToolPreparation",
  {
    defaultValue: () => ({ prepare: noop, register: () => Effect.void }),
  },
) {}

export const layer = Layer.effect(
  CodeToolPreparation,
  Effect.gen(function* () {
    const current = yield* Ref.make<Prepare>(noop);
    return {
      prepare: (threadId: ThreadId) =>
        Ref.get(current).pipe(Effect.flatMap((prepare) => prepare(threadId))),
      register: (prepare: Prepare) =>
        Effect.gen(function* () {
          const previous = yield* Ref.getAndSet(current, prepare);
          yield* Effect.addFinalizer(() =>
            Ref.update(current, (value) => (value === prepare ? previous : value)),
          );
        }),
    };
  }),
);
