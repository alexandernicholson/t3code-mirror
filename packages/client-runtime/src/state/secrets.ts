import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createSecretsAtoms<R, E>(runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>) {
  return {
    snapshot: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "secrets",
      tag: WS_METHODS.secretsSubscribe,
    }),
    create: createEnvironmentRpcCommand(runtime, {
      label: "Create secret",
      tag: WS_METHODS.secretsCreate,
    }),
    update: createEnvironmentRpcCommand(runtime, {
      label: "Update secret",
      tag: WS_METHODS.secretsUpdate,
    }),
    remove: createEnvironmentRpcCommand(runtime, {
      label: "Delete secret",
      tag: WS_METHODS.secretsDelete,
    }),
    revoke: createEnvironmentRpcCommand(runtime, {
      label: "Revoke thread secret access",
      tag: WS_METHODS.secretsRevoke,
    }),
    respond: createEnvironmentRpcCommand(runtime, {
      label: "Respond to secret access",
      tag: WS_METHODS.secretsRespond,
    }),
  };
}
