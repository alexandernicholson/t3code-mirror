import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";
export function createCodeToolsAtoms<R, E>(runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>) {
  return {
    snapshot: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "Code tools",
      tag: WS_METHODS.codeToolsSubscribe,
    }),
    save: createEnvironmentRpcCommand(runtime, {
      label: "Save code tools",
      tag: WS_METHODS.codeToolsSave,
    }),
    manage: createEnvironmentRpcCommand(runtime, {
      label: "Manage code tools",
      tag: WS_METHODS.codeToolsManage,
    }),
    run: createEnvironmentRpcCommand(runtime, {
      label: "Run code tool",
      tag: WS_METHODS.codeToolsRun,
    }),
  };
}
