import type { ModelSelection, ServerConfig } from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { createModelSelection } from "@t3tools/shared/model";
import { useClientSettings } from "~/hooks/useSettings";
import { getCustomModelOptionsByInstance } from "~/modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "~/providerInstances";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";

/** The composer controls with explicit settings persistence instead of a thread draft. */
export function SettingsModelPicker({
  config,
  selection,
  purpose,
  label,
  onChange,
}: {
  config: ServerConfig;
  selection: ModelSelection;
  purpose: "advisor" | "narration";
  label: string;
  onChange: (selection: ModelSelection) => void;
}) {
  const clientSettings = useClientSettings();
  const settings = { ...DEFAULT_UNIFIED_SETTINGS, ...config.settings, ...clientSettings };
  const providers =
    purpose === "advisor"
      ? config.providers
      : config.providers.filter((provider) => provider.supportsTextGeneration !== false);
  const provider = providers.find((provider) => provider.instanceId === selection.instanceId);
  const instanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
  );
  const modelOptions = getCustomModelOptionsByInstance(
    settings,
    providers,
    selection.instanceId,
    selection.model,
  );
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      <ProviderModelPicker
        activeInstanceId={selection.instanceId}
        model={selection.model}
        lockedProvider={null}
        instanceEntries={instanceEntries}
        modelOptionsByInstance={modelOptions}
        triggerVariant="outline"
        triggerAriaLabel={label}
        onInstanceModelChange={(instanceId, model) =>
          onChange(
            instanceId === selection.instanceId && model === selection.model
              ? selection
              : createModelSelection(instanceId, model),
          )
        }
      />
      {provider && (
        <TraitsPicker
          provider={provider.driver}
          instanceId={provider.instanceId}
          models={provider.models}
          model={selection.model}
          modelOptions={selection.options}
          prompt=""
          onPromptChange={() => {}}
          allowPromptInjectedEffort={false}
          planModeEnabled={false}
          triggerVariant="outline"
          triggerAriaLabel={`${label} options`}
          isComposerOwned={false}
          onModelOptionsChange={(options) =>
            onChange(createModelSelection(selection.instanceId, selection.model, options))
          }
        />
      )}
    </div>
  );
}
