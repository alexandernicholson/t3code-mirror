import type { ProviderDriverKind } from "@t3tools/contracts";
import type * as Path from "effect/Path";

import {
  makeProviderMaintenanceCapabilities,
  normalizeCommandPath,
  type ProviderMaintenanceCapabilities,
} from "./providerMaintenance.ts";

export interface ManagedProviderToolchain {
  readonly environment: NodeJS.ProcessEnv;
  readonly maintenance: ProviderMaintenanceCapabilities;
  readonly prefix: string;
}

/** Keep default provider CLIs writable and movable with the owning T3 environment. */
export function makeManagedProviderToolchain(input: {
  readonly baseDir: string;
  readonly commandName: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly packageName: string;
  readonly path: Path.Path;
  readonly platform: NodeJS.Platform;
  readonly provider: ProviderDriverKind;
}): ManagedProviderToolchain {
  const prefix = input.path.join(input.baseDir, "tools", `${input.commandName}-cli`);
  const binDirectory = input.platform === "win32" ? prefix : input.path.join(prefix, "bin");
  const inheritedPath = input.environment.PATH ?? input.environment.Path ?? input.environment.path;
  const delimiter = input.platform === "win32" ? ";" : ":";
  const environment = {
    ...input.environment,
    PATH: inheritedPath ? `${binDirectory}${delimiter}${inheritedPath}` : binDirectory,
  };
  const updateArgs = [
    "install",
    "-g",
    "--prefix",
    prefix,
    `--allow-scripts=${input.packageName}`,
    `${input.packageName}@latest`,
  ];
  return {
    environment,
    prefix,
    maintenance: makeProviderMaintenanceCapabilities({
      provider: input.provider,
      packageName: input.packageName,
      updateExecutable: "npm",
      updateArgs,
      updateLockKey: `npm-global:${normalizeCommandPath(prefix)}`,
      platform: input.platform,
    }),
  };
}
