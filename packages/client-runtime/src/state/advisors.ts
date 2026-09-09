import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";
export function createAdvisorAtoms<R, E>(runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>) {
  return {
    snapshot: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "advisors",
      tag: WS_METHODS.advisorsSubscribe,
    }),
    save: createEnvironmentRpcCommand(runtime, {
      label: "Save advisors",
      tag: WS_METHODS.advisorsSave,
    }),
    action: createEnvironmentRpcCommand(runtime, {
      label: "Update advisors",
      tag: WS_METHODS.advisorsAction,
    }),
  };
}
