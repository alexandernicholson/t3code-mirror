import { createAdvisorAtoms } from "@t3tools/client-runtime/state/advisors";
import { connectionAtomRuntime } from "../connection/runtime";
export const advisors = createAdvisorAtoms(connectionAtomRuntime);
