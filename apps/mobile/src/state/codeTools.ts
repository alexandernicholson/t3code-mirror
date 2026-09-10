import { createCodeToolsAtoms } from "@t3tools/client-runtime/state/codeTools";
import { connectionAtomRuntime } from "../connection/runtime";
export const codeTools = createCodeToolsAtoms(connectionAtomRuntime);
