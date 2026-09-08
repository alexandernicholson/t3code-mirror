import { createSecretsAtoms } from "@t3tools/client-runtime/state/secrets";
import { connectionAtomRuntime } from "../connection/runtime";

export const secrets = createSecretsAtoms(connectionAtomRuntime);
