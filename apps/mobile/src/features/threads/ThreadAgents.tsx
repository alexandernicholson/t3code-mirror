import {
  deriveAgentPanelModel,
  foldSubagentActivities,
  formatSubagentModelLabel,
  selectSubagentTranscript,
  type RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text } from "../../components/AppText";

export function ThreadAgents({
  activities,
  onComposeMessage,
}: {
  activities: ReadonlyArray<OrchestrationThreadActivity>;
  onComposeMessage: (message: string) => void;
}) {
  const model = useMemo(
    () => deriveAgentPanelModel({ agents: foldSubagentActivities(activities) }),
    [activities],
  );
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<RuntimeSubagent | null>(null);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  if (!model.hasAgents) return null;
  const agents = [
    ...model.directAgents,
    ...model.workflows.flatMap((group) => [
      ...group.phases.flatMap((phase) => phase.members),
      ...group.unphasedMembers,
    ]),
  ];
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open agents"
        onPress={() => setOpen(true)}
        className="min-h-9 flex-row items-center justify-end gap-2 px-4"
      >
        <Text className="text-xs text-foreground-muted">
          Agents · {model.liveCount > 0 ? `${model.liveCount} working` : `${agents.length} settled`}
        </Text>
      </Pressable>
      <Modal
        visible={open}
        transparent={width >= 900}
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <View className="flex-1" style={{ alignItems: width >= 900 ? "flex-end" : "stretch" }}>
          <View
            className="flex-1 bg-background"
            style={{
              width: width >= 900 ? 440 : "100%",
              paddingTop: insets.top,
              paddingBottom: insets.bottom,
            }}
          >
            <View className="min-h-11 flex-row items-center justify-between px-4">
              {selected ? (
                <Pressable accessibilityRole="button" onPress={() => setSelected(null)}>
                  <Text className="text-foreground">Back</Text>
                </Pressable>
              ) : (
                <Text className="font-t3-semibold text-foreground">Agents</Text>
              )}
              <Pressable accessibilityRole="button" onPress={() => setOpen(false)}>
                <Text className="text-foreground">Done</Text>
              </Pressable>
            </View>
            {selected ? (
              <AgentTranscript
                agent={selected}
                activities={activities}
                onCompose={(text) => {
                  onComposeMessage(text);
                  setOpen(false);
                }}
              />
            ) : (
              <ScrollView contentContainerClassName="gap-2 p-3">
                {agents.map((agent) => (
                  <Pressable
                    key={agent.id}
                    accessibilityRole="button"
                    onPress={() => setSelected(agent)}
                    className="gap-1 rounded-lg border border-border p-3"
                  >
                    <View className="flex-row justify-between gap-2">
                      <Text className="font-t3-semibold text-foreground">{agent.title}</Text>
                      <Text className="text-xs text-foreground-muted">{agent.status}</Text>
                    </View>
                    <Text className="text-xs text-foreground-muted">
                      {formatSubagentModelLabel(agent.model, agent.effort) ?? agent.role ?? "Agent"}
                    </Text>
                    <Text className="text-sm text-foreground-muted" numberOfLines={2}>
                      {agent.error ??
                        agent.result ??
                        agent.progress ??
                        agent.lastToolName ??
                        "No activity yet"}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

function AgentTranscript({
  agent,
  activities,
  onCompose,
}: {
  agent: RuntimeSubagent;
  activities: ReadonlyArray<OrchestrationThreadActivity>;
  onCompose: (text: string) => void;
}) {
  const entries = useMemo(
    () => selectSubagentTranscript(activities, agent.id),
    [activities, agent.id],
  );
  const [message, setMessage] = useState("");
  return (
    <View className="flex-1">
      <View className="border-b border-border px-4 pb-3">
        <Text className="font-t3-semibold text-foreground">{agent.title}</Text>
        <Text className="text-xs text-foreground-muted">{agent.status}</Text>
      </View>
      <ScrollView className="flex-1" contentContainerClassName="gap-3 p-4">
        {entries.map((entry) => (
          <View key={entry.id} className="border-l-2 border-border pl-3">
            <Text className="text-xs text-foreground-muted">{entry.kind}</Text>
            <Text className="text-sm text-foreground">{entry.summary}</Text>
            {entry.detail && entry.detail !== entry.summary ? (
              <Text className="mt-1 text-sm text-foreground-muted">{entry.detail}</Text>
            ) : null}
          </View>
        ))}
      </ScrollView>
      <View className="flex-row items-end gap-2 border-t border-border p-3">
        <TextInput
          value={message}
          onChangeText={setMessage}
          multiline
          placeholder={`Message ${agent.title}`}
          placeholderTextColor="#888"
          className="max-h-28 min-h-11 flex-1 rounded-lg border border-border px-3 py-2 text-foreground"
        />
        <Pressable
          accessibilityRole="button"
          disabled={!message.trim()}
          onPress={() =>
            onCompose(
              [
                `<subagent-message target-id=${JSON.stringify(agent.id)} target-name=${JSON.stringify(agent.title)}>`,
                message.trim(),
                "</subagent-message>",
                "Deliver this message to the existing subagent with the provider's native agent messaging tool. Do not answer it yourself.",
              ].join("\n"),
            )
          }
          className="min-h-11 justify-center rounded-lg bg-foreground px-4"
        >
          <Text className="text-background">Send</Text>
        </Pressable>
      </View>
    </View>
  );
}
