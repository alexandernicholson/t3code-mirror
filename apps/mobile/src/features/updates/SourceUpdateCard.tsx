import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, SourceUpdateAction, SourceUpdatePolicy } from "@t3tools/contracts";
import { useState } from "react";
import { Alert, Linking, Modal, Pressable, ScrollView, Switch, View } from "react-native";
import { Markdown } from "react-native-nitro-markdown";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

const policies: ReadonlyArray<{ value: SourceUpdatePolicy; label: string }> = [
  { value: "automatic", label: "Automatically install and restart" },
  { value: "manual-restart", label: "Prepare automatically; restart manually" },
  { value: "notify", label: "Notify only" },
];

export function SourceUpdateCard({
  environmentId,
  connected,
}: {
  environmentId: EnvironmentId;
  connected: boolean;
}) {
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const status = config?.sourceUpdates;
  const settings = config?.settings.sourceUpdates;
  const act = useAtomCommand(serverEnvironment.sourceUpdate);
  const save = useAtomCommand(serverEnvironment.updateSettings);
  const [branchDraft, setBranch] = useState<string | null>(null);
  const branch = branchDraft ?? settings?.branch ?? "main";
  const [pending, setPending] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  if (!status?.supported || !settings) return null;
  const change = async (patch: Partial<typeof settings>) => {
    setPending(true);
    try {
      await save({ environmentId, input: { patch: { sourceUpdates: { ...settings, ...patch } } } });
    } finally {
      setPending(false);
    }
  };
  const update = async (action: SourceUpdateAction["action"]) => {
    setPending(true);
    try {
      await act({
        environmentId,
        input: { action, ...(status.target ? { commit: status.target.commit } : {}) },
      });
    } finally {
      setPending(false);
    }
  };
  const busy =
    !connected || pending || ["building", "checking", "restarting"].includes(status.phase);
  const action = (label: string, callback: () => void, disabled = busy) => (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={callback}
      className={`rounded-xl border border-border px-3 py-2 ${disabled ? "opacity-50" : "active:opacity-70"}`}
    >
      <Text className="text-sm text-foreground">{label}</Text>
    </Pressable>
  );
  return (
    <View className="gap-3 border-t border-border p-4">
      <Text className="text-base font-t3-bold text-foreground">Server updates</Text>
      <Text className="text-sm text-foreground-muted">
        Running {status.running?.version} · {status.running?.branch} ·{" "}
        {status.running?.commit.slice(0, 8)}
      </Text>
      {status.target ? (
        <Text className="text-sm text-foreground">
          {status.outcome === "committed" ? "Installed" : "Available"}: {status.target.version} ·{" "}
          {status.phase}
        </Text>
      ) : null}
      {status.message ? (
        <Text className="text-sm text-foreground-muted">{status.message}</Text>
      ) : null}
      <View className="flex-row items-center justify-between">
        <Text className="text-sm text-foreground">Check for updates</Text>
        <Switch
          accessibilityLabel="Check for server updates"
          value={settings.enabled}
          disabled={!connected || pending}
          onValueChange={(enabled) => void change({ enabled })}
        />
      </View>
      {action(
        policies.find((policy) => policy.value === settings.policy)?.label ?? "Update policy",
        () =>
          Alert.alert(
            "Update policy",
            undefined,
            policies.map((policy) => ({
              text: policy.label,
              onPress: () => void change({ policy: policy.value }),
            })),
          ),
        !connected || pending,
      )}
      <TextInput
        accessibilityLabel="Update branch"
        autoCapitalize="none"
        autoCorrect={false}
        value={branch}
        onChangeText={setBranch}
        className="rounded-xl border border-input-border bg-input px-3 py-2 text-foreground"
      />
      {action(
        "Follow branch",
        () => void change({ branch: branch.trim() }),
        !connected || pending || !branch.trim() || branch === settings.branch,
      )}
      <View className="flex-row flex-wrap gap-2">
        {action("Check now", () => void update("check"), busy || !settings.enabled)}
        {status.target && ["available", "failed"].includes(status.phase)
          ? action("Prepare update", () => void update("prepare"), busy || !settings.enabled)
          : null}
        {status.target && ["ready", "waiting"].includes(status.phase) ? (
          <>
            {action("Restart to update", () => void update("restart"), busy || !settings.enabled)}
            {action("Defer", () => void update("discard"))}
          </>
        ) : null}
        {status.target || status.installedNotes
          ? action("View changes", () => setNotesOpen(true), false)
          : null}
      </View>
      <Modal
        visible={notesOpen}
        presentationStyle="pageSheet"
        animationType="slide"
        onRequestClose={() => setNotesOpen(false)}
      >
        <View className="flex-1 bg-background px-5 pt-12">
          {action("Close release notes", () => setNotesOpen(false), false)}
          <ScrollView className="mt-4 flex-1">
            {status.target?.divergent ? (
              <Text className="mb-3 text-sm text-foreground-muted">
                This branch has different history. These are its release notes.
              </Text>
            ) : null}
            {status.target?.compareUrl
              ? action(
                  "Compare commits",
                  () => void Linking.openURL(status.target!.compareUrl!),
                  false,
                )
              : null}
            <Markdown>{status.target?.notes ?? status.installedNotes ?? ""}</Markdown>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
