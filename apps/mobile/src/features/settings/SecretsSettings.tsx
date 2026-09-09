import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { useState, type ReactNode } from "react";
import { Alert, Modal, Pressable, ScrollView, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  secretTargetId,
  type EnvironmentId,
  type SecretMetadata,
  type SecretScope,
} from "@t3tools/contracts";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { useEnvironments } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { secrets } from "../../state/secrets";
import { useAtomCommand } from "../../state/use-atom-command";
import { InfoButton } from "../../components/InfoButton";
import { SettingsRow } from "./components/SettingsRow";

function Action({
  children,
  onPress,
  disabled = false,
}: {
  children: ReactNode;
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
      <Text className="text-foreground">{children}</Text>
    </Pressable>
  );
}

export function SecretsSettings() {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<EnvironmentId | null>(null);
  const { environments } = useEnvironments();
  const insets = useSafeAreaInsets();
  const environment =
    environments.find((entry) => entry.environmentId === selectedId) ?? environments[0];
  return (
    <>
      <SettingsRow icon="lock" label="Secrets" onPress={() => setOpen(true)} />
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View
          className="flex-1 bg-background"
          style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
        >
          <View className="flex-row items-center justify-between p-4">
            <Text className="text-xl font-t3-semibold text-foreground">Secrets</Text>
            <Action onPress={() => setOpen(false)}>Done</Action>
          </View>
          <ScrollView contentContainerClassName="gap-4 p-4" keyboardShouldPersistTaps="handled">
            <Text className="text-sm text-foreground-muted">Manage secrets for your agents.</Text>
            <Text className="font-t3-medium text-foreground">Environment</Text>
            <View className="flex-row flex-wrap gap-2">
              {environments.map((entry) => (
                <Action
                  key={entry.environmentId}
                  onPress={() => setSelectedId(entry.environmentId)}
                >
                  {entry.environmentId === environment?.environmentId ? "✓ " : ""}
                  {entry.label}
                </Action>
              ))}
            </View>
            {open && environment && (
              <EnvironmentSecrets
                key={environment.environmentId}
                environmentId={environment.environmentId}
              />
            )}
            {!environment && (
              <Text className="text-foreground-muted">
                Connect an environment to manage secrets.
              </Text>
            )}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

function EnvironmentSecrets({ environmentId }: { environmentId: EnvironmentId }) {
  const snapshot = useAtomValue(secrets.snapshot({ environmentId, input: {} }));
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const create = useAtomCommand(secrets.create);
  const update = useAtomCommand(secrets.update);
  const remove = useAtomCommand(secrets.remove);
  const [editing, setEditing] = useState<SecretMetadata | "new" | null>(null);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [replaceValue, setReplaceValue] = useState(false);
  const [scope, setScope] = useState<SecretScope>({ type: "environment" });
  const [highlySensitive, setHighlySensitive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function edit(entry: SecretMetadata | "new") {
    setEditing(entry);
    setKey(entry === "new" ? "" : entry.key);
    setValue("");
    setReplaceValue(entry === "new");
    setScope(entry === "new" ? { type: "environment" } : entry.scope);
    setHighlySensitive(entry === "new" || entry.highlySensitive);
    setError(null);
  }
  async function save() {
    if (!editing || !key.trim() || busy) return;
    setBusy(true);
    setError(null);
    const result =
      editing === "new"
        ? await create({ environmentId, input: { key: key.trim(), scope, value, highlySensitive } })
        : await update({
            environmentId,
            input: { ...editing, highlySensitive, ...(replaceValue ? { value } : {}) },
          });
    setBusy(false);
    if (result._tag === "Success") {
      setEditing(null);
      setValue("");
    } else setError("Could not save the secret. Refresh and try again.");
  }
  function deleteEntry(entry: SecretMetadata) {
    Alert.alert(`Delete ${entry.key}?`, undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setBusy(true);
            const result = await remove({ environmentId, input: entry });
            setBusy(false);
            if (result._tag !== "Success") setError("Could not delete. Refresh and try again.");
            else if (
              editing &&
              editing !== "new" &&
              secretTargetId(editing) === secretTargetId(entry)
            ) {
              setEditing(null);
              setValue("");
            }
          })();
        },
      },
    ]);
  }
  if (!AsyncResult.isSuccess(snapshot))
    return (
      <Text className="text-foreground-muted">
        {AsyncResult.isFailure(snapshot)
          ? "Secrets are unavailable. Check your connection."
          : "Loading secrets…"}
      </Text>
    );
  return (
    <View className="gap-4">
      <Action disabled={busy} onPress={() => edit("new")}>
        Add secret
      </Action>
      {error && (
        <Text accessibilityRole="alert" className="text-foreground-muted">
          {error}
        </Text>
      )}
      {editing && (
        <View className="gap-3 rounded-lg border border-border p-4">
          <View className="flex-row items-center justify-between gap-3">
            <Text className="font-t3-medium text-foreground">
              {editing === "new" ? "Add secret" : "Edit secret"}
            </Text>
            <InfoButton
              label="Secret settings details"
              details="Highly sensitive secrets require approval before an agent can read them. Saved values stay hidden. Editing a secret revokes its thread access."
            />
          </View>
          <Text className="text-foreground">Key</Text>
          <TextInput
            accessibilityLabel="Secret key"
            className="rounded-lg border border-border p-3 text-foreground"
            value={key}
            editable={editing === "new" && !busy}
            maxLength={200}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setKey}
          />
          <Text className="text-foreground">Scope</Text>
          <View className="flex-row flex-wrap gap-2">
            <Action
              disabled={editing !== "new" || busy}
              onPress={() => setScope({ type: "environment" })}
            >
              {scope.type === "environment" ? "✓ " : ""}Environment-wide
            </Action>
            {projects.map((project) => (
              <Action
                key={project.id}
                disabled={editing !== "new" || busy}
                onPress={() => setScope({ type: "project", projectId: project.id })}
              >
                {scope.type === "project" && scope.projectId === project.id ? "✓ " : ""}
                {project.title}
              </Action>
            ))}
          </View>
          {editing !== "new" && (
            <View className="flex-row items-center justify-between">
              <Text className="text-foreground">Replace value</Text>
              <Switch
                accessibilityLabel="Replace value"
                disabled={busy}
                value={replaceValue}
                onValueChange={(next) => {
                  setReplaceValue(next);
                  setValue("");
                }}
              />
            </View>
          )}
          {replaceValue && (
            <>
              <Text className="text-foreground">Value</Text>
              <TextInput
                accessibilityLabel="Secret value"
                className="rounded-lg border border-border p-3 text-foreground"
                secureTextEntry
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect={false}
                value={value}
                maxLength={65_536}
                editable={!busy}
                onChangeText={setValue}
              />
            </>
          )}
          <View className="flex-row items-center justify-between">
            <Text className="text-foreground">Highly sensitive</Text>
            <Switch
              accessibilityLabel="Highly sensitive"
              disabled={busy}
              value={highlySensitive}
              onValueChange={setHighlySensitive}
            />
          </View>
          <View className="flex-row gap-2">
            <Action disabled={busy || !key.trim()} onPress={() => void save()}>
              Save
            </Action>
            <Action
              disabled={busy}
              onPress={() => {
                setEditing(null);
                setValue("");
              }}
            >
              Cancel
            </Action>
          </View>
        </View>
      )}
      {snapshot.value.entries.length === 0 && (
        <Text className="text-foreground-muted">No secrets yet.</Text>
      )}
      {snapshot.value.entries.map((entry) => (
        <View key={secretTargetId(entry)} className="gap-2 rounded-lg border border-border p-4">
          <Text className="font-t3-medium text-foreground">{entry.key}</Text>
          <Text className="text-sm text-foreground-muted">
            {entry.scope.type === "environment"
              ? "Environment-wide"
              : (projects.find(
                  (project) =>
                    entry.scope.type === "project" && project.id === entry.scope.projectId,
                )?.title ?? "Project")}{" "}
            · {entry.highlySensitive ? "Highly sensitive" : "No approval required"}
          </Text>
          <View className="flex-row gap-2">
            <Action disabled={busy} onPress={() => edit(entry)}>
              Edit
            </Action>
            <Action disabled={busy} onPress={() => deleteEntry(entry)}>
              Delete
            </Action>
          </View>
        </View>
      ))}
    </View>
  );
}
