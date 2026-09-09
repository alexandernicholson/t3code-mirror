import * as Context from "effect/Context";
import * as Semaphore from "effect/Semaphore";

/** Serializes new orchestration/terminal work with the final idle check and launcher handoff. */
export class SourceUpdateGate extends Context.Reference<Semaphore.Semaphore>(
  "t3/sourceUpdates/gate",
  { defaultValue: () => Semaphore.makeUnsafe(1) },
) {}
