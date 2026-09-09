import { getProviderOptionCurrentLabel, getProviderOptionDescriptors } from "@t3tools/shared/model";
import { useState } from "react";
import { Modal, Pressable, View } from "react-native";
import type { EnvironmentId, ModelSelection, ServerConfig } from "@t3tools/contracts";
import { AppText as Text } from "../../components/AppText";
import { buildModelOptions, groupByProvider } from "../../lib/modelOptions";
import { SettingsModelPickerContent } from "../threads/ThreadSettingsSheet";

export function SettingsModelPicker({
  config,
  environmentId,
  selection,
  onChange,
}: {
  config: ServerConfig;
  environmentId: EnvironmentId;
  selection: ModelSelection;
  onChange: (selection: ModelSelection) => void;
}) {
  const [open, setOpen] = useState(false);
  const models = buildModelOptions(config, selection);
  const selected = models.find(
    (option) =>
      option.selection.instanceId === selection.instanceId &&
      option.selection.model === selection.model,
  );
  const descriptors = selected?.capabilities
    ? getProviderOptionDescriptors({ caps: selected.capabilities, selections: selection.options })
    : [];
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Advisor account, model and options"
        onPress={() => setOpen(true)}
        className="min-h-11 justify-center rounded-lg border border-border px-3 py-2"
      >
        <Text className="text-foreground">
          {selected ? `${selected.providerLabel} · ${selected.label}` : selection.model}
        </Text>
        <Text className="text-xs text-foreground-muted">
          {selection.options?.length
            ? descriptors
                .filter((descriptor) =>
                  selection.options?.some((option) => option.id === descriptor.id),
                )
                .map(
                  (descriptor) =>
                    `${descriptor.label}: ${getProviderOptionCurrentLabel(descriptor)}`,
                )
                .join(" · ")
            : "Model options"}
        </Text>
      </Pressable>
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <View className="flex-1 bg-sheet">
          {open && (
            <SettingsModelPickerContent
              environmentId={environmentId}
              providerGroups={groupByProvider(models)}
              selection={selection}
              onChange={onChange}
              onClose={() => setOpen(false)}
            />
          )}
        </View>
      </Modal>
    </>
  );
}
