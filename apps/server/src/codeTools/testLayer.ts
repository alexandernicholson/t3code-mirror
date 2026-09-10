import { Effect, Layer, Stream } from "effect";
import { CodeTools } from "./CodeTools.ts";
import type { CodeToolsConfiguration, CodeServerStatus, CodeCheckResult } from "@t3tools/contracts";

export const codeToolsTestLayer = Layer.succeed(CodeTools, {
  save: () => Effect.succeed(undefined),
  manage: () => Effect.void,
  run: () => Effect.succeed({ text: "", diagnostics: [], data: null }),
  prepare: () => Effect.void,
  start: () => Effect.void,
  subscribe: () =>
    Stream.make({
      configurations: [] as CodeToolsConfiguration[],
      servers: [] as CodeServerStatus[],
      checks: null as CodeCheckResult | null,
      issueCount: 0,
    }),
  check: () => Effect.void,
  drain: Effect.void,
});
