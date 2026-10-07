import { ProviderGlobalSettingsError, type ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { ProviderInstanceRegistry } from "./ProviderInstanceRegistry.ts";

export const providerGlobalSettings = Effect.fn("providerGlobalSettings")(function* (
  registry: Pick<ProviderInstanceRegistry["Service"], "getInstance">,
  instanceId: ProviderInstanceId,
) {
  const instance = yield* registry.getInstance(instanceId);
  if (!instance?.globalSettings) {
    return yield* new ProviderGlobalSettingsError({
      instanceId,
      detail: instance
        ? "This provider does not support global settings."
        : "Provider instance not found.",
    });
  }
  return instance.globalSettings;
});
