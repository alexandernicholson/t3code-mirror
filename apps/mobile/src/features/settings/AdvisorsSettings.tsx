import { SettingsModelPicker } from "./SettingsModelPicker";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { useState } from "react";
import { Modal, Pressable, ScrollView, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  inheritedAdvisorIds,
  advisorDefinitionsForScope,
  advisorScopeKey,
  emptyAdvisorConfiguration,
  setAdvisorDefinition,
  type AdvisorConfiguration,
  type AdvisorDefinition,
  type AdvisorScope,
  type EnvironmentId,
} from "@t3tools/contracts";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { useEnvironments } from "../../state/environments";
import { useProjects, useThreadShell } from "../../state/entities";
import { advisors } from "../../state/advisors";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { uuidv4 } from "../../lib/uuid";
import { SettingsRow } from "./components/SettingsRow";

export function AdvisorButton({
  title,
  onPress,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      className="min-h-11 justify-center rounded-lg border border-border px-3"
    >
      <Text className="text-foreground">{title}</Text>
    </Pressable>
  );
}
export function AdvisorsSettings() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<EnvironmentId | null>(null);
  const { environments } = useEnvironments();
  const insets = useSafeAreaInsets();
  const environment =
    environments.find((value) => value.environmentId === selected) ?? environments[0];
  return (
    <>
      <SettingsRow icon="eye" label="Advisors" onPress={() => setOpen(true)} />
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View
          className="flex-1 bg-background"
          style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
        >
          <View className="flex-row items-center justify-between p-4">
            <Text className="text-xl font-t3-semibold text-foreground">Advisors</Text>
            <AdvisorButton title="Done" onPress={() => setOpen(false)} />
          </View>
          <ScrollView contentContainerClassName="gap-4 p-4" keyboardShouldPersistTaps="handled">
            <Text className="text-foreground-muted">
              Independent reviewers that follow your agent's work.
            </Text>
            {environments.map((value) => (
              <AdvisorButton
                key={value.environmentId}
                title={`${value.environmentId === environment?.environmentId ? "✓ " : ""}${value.label}`}
                onPress={() => setSelected(value.environmentId)}
              />
            ))}
            {open && environment && (
              <MobileAdvisorConfiguration
                key={environment.environmentId}
                environmentId={environment.environmentId}
              />
            )}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}
export function MobileAdvisorConfiguration({
  environmentId,
  fixedScope,
}: {
  environmentId: EnvironmentId;
  fixedScope?: AdvisorScope;
}) {
  const snapshot = useAtomValue(advisors.snapshot({ environmentId, input: {} }));
  const server = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const thread = useThreadShell(
    fixedScope?.type === "thread" ? { environmentId, threadId: fixedScope.threadId } : null,
  );
  const save = useAtomCommand(advisors.save);
  const [scope, setScope] = useState<AdvisorScope>(fixedScope ?? { type: "environment" });
  const [draft, setDraft] = useState<AdvisorConfiguration | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!AsyncResult.isSuccess(snapshot))
    return (
      <Text className="text-foreground-muted">
        {AsyncResult.isFailure(snapshot)
          ? "Advisors unavailable. Update or reconnect this environment."
          : "Loading advisors…"}
      </Text>
    );
  const configurations = snapshot.value.configurations;
  const value =
    draft ??
    configurations.find((item) => advisorScopeKey(item.scope) === advisorScopeKey(scope)) ??
    emptyAdvisorConfiguration(scope);
  const inheritedIds = inheritedAdvisorIds(configurations, scope, thread?.projectId);
  const definitions = advisorDefinitionsForScope(
    [
      ...configurations.filter((item) => advisorScopeKey(item.scope) !== advisorScopeKey(scope)),
      value,
    ],
    scope,
    thread?.projectId,
  );
  const choices = (server?.providers ?? [])
    .filter(
      (provider) =>
        provider.enabled &&
        provider.installed &&
        provider.auth.status !== "unauthenticated" &&
        provider.availability !== "unavailable",
    )
    .flatMap((provider) =>
      provider.models.map((model) => ({
        label: `${provider.displayName ?? provider.driver} · ${model.name}`,
        selection: { instanceId: provider.instanceId, model: model.slug },
      })),
    );
  const inheritedDefinitions = advisorDefinitionsForScope(
    configurations.filter((item) => advisorScopeKey(item.scope) !== advisorScopeKey(scope)),
    scope,
    thread?.projectId,
  );
  const update = (patch: Partial<AdvisorConfiguration>) => setDraft({ ...value, ...patch });
  const change = (id: string, patch: Partial<AdvisorDefinition>) => {
    const definition = definitions.find((item) => item.id === id);
    if (definition) setDraft(setAdvisorDefinition(value, { ...definition, ...patch }));
  };
  return (
    <View className="gap-4">
      {!fixedScope && (
        <View className="gap-2">
          <Text className="text-sm font-t3-medium text-foreground">Apply to</Text>
          <AdvisorButton
            title={`${scope.type === "environment" ? "✓ " : ""}All projects`}
            onPress={() => {
              setScope({ type: "environment" });
              setDraft(null);
            }}
          />
          {projects.map((project) => (
            <AdvisorButton
              key={project.id}
              title={`${scope.type === "project" && scope.projectId === project.id ? "✓ " : ""}${project.title}`}
              onPress={() => {
                setScope({ type: "project", projectId: project.id });
                setDraft(null);
              }}
            />
          ))}
        </View>
      )}
      {scope.type !== "environment" && (
        <View className="flex-row items-center justify-between">
          <Text className="text-foreground">Use inherited advisors</Text>
          <Switch
            value={value.advisorIds === null}
            onValueChange={(enabled) => update({ advisorIds: enabled ? null : [] })}
          />
        </View>
      )}
      {definitions.map((definition) => (
        <View key={definition.id} className="gap-3 rounded-xl border border-border p-3">
          <View className="flex-row items-center justify-between">
            <Pressable
              onPress={() => setEditing(editing === definition.id ? null : definition.id)}
              className="min-h-11 flex-1 justify-center"
            >
              <Text className="font-t3-medium text-foreground">{definition.name}</Text>
              <Text className="text-xs text-foreground-muted">
                {definition.modelSelection.model}
              </Text>
            </Pressable>
            <Switch
              accessibilityLabel={`Enable ${definition.name}`}
              disabled={value.advisorIds === null}
              value={(value.advisorIds ?? inheritedIds).includes(definition.id)}
              onValueChange={(enabled) =>
                update({
                  advisorIds: enabled
                    ? [...(value.advisorIds ?? []), definition.id]
                    : (value.advisorIds ?? []).filter((id) => id !== definition.id),
                })
              }
            />
          </View>
          {editing === definition.id && (
            <>
              <TextInput
                accessibilityLabel="Advisor name"
                value={definition.name}
                onChangeText={(name) => change(definition.id, { name })}
                className="rounded-lg border border-border p-3 text-foreground"
              />
              {server && (
                <SettingsModelPicker
                  config={server}
                  environmentId={environmentId}
                  selection={definition.modelSelection}
                  onChange={(modelSelection) => change(definition.id, { modelSelection })}
                />
              )}
              <AdvisorButton
                title={
                  definition.mode === "guide"
                    ? "Guide automatically during active work"
                    : "Observe only"
                }
                onPress={() =>
                  change(definition.id, { mode: definition.mode === "guide" ? "observe" : "guide" })
                }
              />
              <TextInput
                accessibilityLabel="Review instructions"
                multiline
                value={definition.instructions}
                onChangeText={(instructions) => change(definition.id, { instructions })}
                className="min-h-24 rounded-lg border border-border p-3 text-foreground"
              />
              {value.definitions.some((item) => item.id === definition.id) && (
                <AdvisorButton
                  title={
                    inheritedDefinitions.some((item) => item.id === definition.id)
                      ? "Use inherited settings"
                      : "Remove advisor"
                  }
                  onPress={() =>
                    update({
                      definitions: value.definitions.filter((item) => item.id !== definition.id),
                      advisorIds: inheritedDefinitions.some((item) => item.id === definition.id)
                        ? value.advisorIds
                        : (value.advisorIds?.filter((id) => id !== definition.id) ?? null),
                    })
                  }
                />
              )}
            </>
          )}
        </View>
      ))}
      <AdvisorButton
        title="Add advisor"
        disabled={!choices[0] || definitions.length >= 12}
        onPress={() => {
          const choice = choices[0];
          if (!choice) return;
          const id = uuidv4();
          update({
            advisorIds: [...(value.advisorIds ?? inheritedIds), id],
            definitions: [
              ...value.definitions,
              {
                id,
                name: "General reviewer",
                modelSelection: choice.selection,
                instructions: "Watch for correctness and missed requirements.",
                mode: "guide",
              },
            ],
          });
          setEditing(id);
        }}
      />
      {choices.length === 0 && (
        <Text className="text-sm text-foreground-muted">
          Set up a provider account before adding an advisor.
        </Text>
      )}
      <Text className="text-sm text-foreground-muted">
        Reviews use the selected account and share activity with its provider.
      </Text>
      <TextInput
        accessibilityLabel="Project review guidance"
        placeholder="Project review guidance"
        multiline
        value={value.instructions}
        onChangeText={(instructions) => update({ instructions })}
        className="min-h-20 rounded-lg border border-border p-3 text-foreground"
      />
      <TextInput
        accessibilityLabel="Guidance file"
        placeholder="Optional workspace file, e.g. WATCHDOG.md"
        value={value.instructionsFile}
        onChangeText={(instructionsFile) => update({ instructionsFile })}
        className="rounded-lg border border-border p-3 text-foreground"
      />
      <View className="flex-row items-center justify-between">
        <Text className="text-foreground">Pause advisors</Text>
        <Switch value={value.paused} onValueChange={(paused) => update({ paused })} />
      </View>
      {error && (
        <Text accessibilityRole="alert" className="text-foreground">
          {error}
        </Text>
      )}
      {draft && (
        <>
          <AdvisorButton
            title={busy ? "Saving…" : "Save changes"}
            disabled={busy || value.definitions.some((definition) => !definition.name.trim())}
            onPress={() => {
              setBusy(true);
              void save({ environmentId, input: value }).then((result) => {
                setBusy(false);
                if (result._tag === "Success") setDraft(null);
                else setError("Could not save. Reload settings and try again.");
              });
            }}
          />
          <AdvisorButton title="Discard changes" disabled={busy} onPress={() => setDraft(null)} />
        </>
      )}
    </View>
  );
}
