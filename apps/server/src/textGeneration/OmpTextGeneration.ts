import type { OmpSettings } from "@t3tools/contracts";

import { makeOmpAcpRuntime, applyOmpAcpModelSelection } from "../provider/acp/OmpAcpSupport.ts";
import { makeCursorTextGeneration } from "./CursorTextGeneration.ts";

export const makeOmpTextGeneration = (settings: OmpSettings, environment?: NodeJS.ProcessEnv) =>
  makeCursorTextGeneration(
    {
      enabled: settings.enabled,
      binaryPath: settings.binaryPath,
      apiEndpoint: "",
      customModels: settings.customModels,
    },
    environment,
    {
      providerName: "OMP",
      makeRuntime: (input) =>
        makeOmpAcpRuntime({
          ompSettings: settings,
          childProcessSpawner: input.childProcessSpawner,
          cwd: input.cwd,
          clientInfo: input.clientInfo,
          ...(input.environment ? { environment: input.environment } : {}),
          ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
        }),
      applyModelSelection: (input) => applyOmpAcpModelSelection(input),
    },
  );
