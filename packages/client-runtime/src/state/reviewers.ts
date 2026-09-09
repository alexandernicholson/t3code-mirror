import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createReviewerAtoms<R, E>(runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>) {
  return {
    snapshot: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "reviewers",
      tag: WS_METHODS.reviewersSubscribe,
    }),
    save: createEnvironmentRpcCommand(runtime, {
      label: "Save reviewers",
      tag: WS_METHODS.reviewersSave,
    }),
    action: createEnvironmentRpcCommand(runtime, {
      label: "Run reviewer",
      tag: WS_METHODS.reviewersAction,
    }),
    optimize: createEnvironmentRpcCommand(runtime, {
      label: "Optimize review rule",
      tag: WS_METHODS.reviewersOptimize,
    }),
    generateName: createEnvironmentRpcCommand(runtime, {
      label: "Generate review rule name",
      tag: WS_METHODS.reviewersGenerateName,
    }),
  };
}
