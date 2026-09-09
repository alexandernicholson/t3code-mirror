import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  advisorDefinitionsForScope,
  emptyAdvisorConfiguration,
  setAdvisorDefinition,
  type AdvisorConfiguration,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { AppText as Text } from "../../components/AppText";
import { advisors } from "../../state/advisors";
import { useAtomCommand } from "../../state/use-atom-command";
import { AdvisorButton, MobileAdvisorConfiguration } from "../settings/AdvisorsSettings";
import { SettingsModelPicker } from "../settings/SettingsModelPicker";
import { useThreadShell } from "../../state/entities";
import { serverEnvironment } from "../../state/server";

type Props = { environmentId: EnvironmentId; threadId: ThreadId };
export function ThreadAdvisors(props: Props & { openRequest?: number }) {
  const snapshot = useAtomValue(
    advisors.snapshot({ environmentId: props.environmentId, input: { threadId: props.threadId } }),
  );
  const [open, setOpen] = useState(false);
  const [dismissedOpenRequest, setDismissedOpenRequest] = useState(0);
  const requestedOpen = (props.openRequest ?? 0) > dismissedOpenRequest;
  const visible = open || requestedOpen;
  const close = () => {
    setOpen(false);
    setDismissedOpenRequest(props.openRequest ?? 0);
  };
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [opacity] = useState(() => new Animated.Value(1));
  const lastBlink = useRef(0);
  const value = AsyncResult.isSuccess(snapshot) ? snapshot.value : null;
  const active = value?.states.some(
    (state) => state.status === "reviewing" || state.status === "catching-up",
  );
  const updatedAt = value?.states.map((state) => state.updatedAt).join(":");
  useEffect(() => {
    if (!updatedAt || !active || Date.now() - lastBlink.current < 3000) return;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled || reduce) return;
      lastBlink.current = Date.now();
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.4, duration: 200, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start();
    });
    return () => {
      cancelled = true;
      opacity.stopAnimation();
      opacity.setValue(1);
    };
  }, [active, updatedAt, opacity]);
  if (!value || (value.states.length === 0 && !visible)) return null;
  const label = active
    ? "Reviewing"
    : value.states.some((state) => state.status === "unavailable")
      ? "Unavailable"
      : value.states.every((state) => state.status === "paused")
        ? "Paused"
        : "Watching";
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open advisors · ${label}`}
        onPress={() => setOpen(true)}
        className="min-h-9 flex-row items-center justify-end gap-2 px-4"
      >
        <Animated.View style={{ opacity }}>
          <Text className="text-xs text-foreground-muted">◉</Text>
        </Animated.View>
        <Text className="text-xs text-foreground-muted">Advisors · {label}</Text>
      </Pressable>
      <Modal
        visible={visible}
        transparent={width >= 900}
        animationType="slide"
        onRequestClose={close}
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
            <View className="flex-row items-center justify-between px-4 py-2">
              <Text className="font-t3-semibold text-foreground">Advisors</Text>
              <AdvisorButton title="Done" onPress={close} />
            </View>
            {visible && <AdvisorTimeline {...props} />}
          </View>
        </View>
      </Modal>
    </>
  );
}
function AdvisorTimeline({ environmentId, threadId }: Props) {
  const thread = useThreadShell({ environmentId, threadId });
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const snapshot = useAtomValue(
    advisors.snapshot({ environmentId, input: { threadId, details: true } }),
  );
  const action = useAtomCommand(advisors.action);
  const save = useAtomCommand(advisors.save);
  const [settings, setSettings] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [following, setFollowing] = useState(true);
  const scroll = useRef<ScrollView>(null);
  if (!AsyncResult.isSuccess(snapshot))
    return <Text className="p-4 text-foreground-muted">Loading advisor activity…</Text>;
  const value = snapshot.value;
  const scope = { type: "thread", threadId } as const;
  const configuration =
    value.configurations.find(
      (item) => item.scope.type === "thread" && item.scope.threadId === threadId,
    ) ?? emptyAdvisorConfiguration(scope);
  const definitions = advisorDefinitionsForScope(value.configurations, scope, thread?.projectId);
  const inheritedDefinitions = advisorDefinitionsForScope(
    value.configurations.filter((item) => item !== configuration),
    scope,
    thread?.projectId,
  );
  const configure = (input: AdvisorConfiguration) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void save({ environmentId, input }).then((result) => {
      setBusy(false);
      if (result._tag !== "Success")
        setError("Could not save advisor settings. Reload and try again.");
    });
  };
  const paused = value.states.every(
    (state) => state.status === "paused" || state.status === "unavailable",
  );
  const act = (kind: "pause" | "resume" | "address", findingId?: string) => {
    setBusy(true);
    setError(null);
    void action({
      environmentId,
      input: { threadId, action: kind, ...(findingId ? { findingId } : {}) },
    }).then((result) => {
      setBusy(false);
      if (result._tag !== "Success")
        setError("Could not update advisors. Reconnect and try again.");
    });
  };
  return (
    <>
      <View className="flex-row gap-2 px-4 py-2">
        <AdvisorButton
          title={paused ? "Resume" : "Pause"}
          disabled={busy}
          onPress={() => act(paused ? "resume" : "pause")}
        />
        <AdvisorButton
          title={settings ? "Timeline" : "Settings"}
          onPress={() => setSettings(!settings)}
        />
      </View>
      {error && (
        <Text accessibilityRole="alert" className="px-4 text-foreground">
          {error}
        </Text>
      )}
      {!settings && value.states.length > 0 && (
        <ScrollView
          style={{ maxHeight: 240, flexGrow: 0 }}
          contentContainerClassName="gap-3 px-4 py-2"
          keyboardShouldPersistTaps="handled"
        >
          {value.states
            .filter((state) => filter === null || state.advisorId === filter)
            .map((state) => {
              const definition = definitions.find((item) => item.id === state.advisorId);
              return (
                <View key={state.advisorId} className="gap-2">
                  <Text className="text-sm text-foreground-muted">{state.name}</Text>
                  {config && definition && (
                    <SettingsModelPicker
                      config={config}
                      environmentId={environmentId}
                      selection={definition.modelSelection}
                      disabled={busy}
                      onChange={(modelSelection) =>
                        configure(
                          setAdvisorDefinition(configuration, { ...definition, modelSelection }),
                        )
                      }
                    />
                  )}
                  {configuration.definitions.some((item) => item.id === state.advisorId) &&
                    inheritedDefinitions.some((item) => item.id === state.advisorId) && (
                      <AdvisorButton
                        title="Use inherited advisor"
                        disabled={busy}
                        onPress={() =>
                          configure({
                            ...configuration,
                            definitions: configuration.definitions.filter(
                              (item) => item.id !== state.advisorId,
                            ),
                          })
                        }
                      />
                    )}
                  {state.reason && (
                    <Text className="text-sm text-foreground-muted">{state.reason}</Text>
                  )}
                </View>
              );
            })}
        </ScrollView>
      )}
      <ScrollView
        ref={scroll}
        contentContainerClassName="gap-4 p-4"
        onContentSizeChange={() => {
          if (following) scroll.current?.scrollToEnd({ animated: false });
        }}
        onScroll={(event) => {
          const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
          setFollowing(contentSize.height - contentOffset.y - layoutMeasurement.height < 60);
        }}
        scrollEventThrottle={100}
      >
        {settings || value.states.length === 0 ? (
          <MobileAdvisorConfiguration
            key={threadId}
            environmentId={environmentId}
            fixedScope={{ type: "thread", threadId }}
          />
        ) : (
          <>
            {value.states.length > 0 ? (
              <View className="flex-row flex-wrap gap-2">
                <AdvisorButton title="All advisors" onPress={() => setFilter(null)} />
                {value.states.map((state) => (
                  <AdvisorButton
                    key={state.advisorId}
                    title={`${state.name} · ${state.status}`}
                    onPress={() => setFilter(state.advisorId)}
                  />
                ))}
              </View>
            ) : null}
            {value.entries
              .filter((entry) => filter === null || entry.advisorId === filter)
              .map((entry) => (
                <View key={entry.id} className="gap-2 border-l-2 border-border pl-3">
                  <Text className="text-xs text-foreground-muted">
                    {entry.advisorName} · {entry.severity ?? entry.kind}
                  </Text>
                  <AdvisorEntryText
                    text={entry.text}
                    collapsed={entry.kind === "reasoning" || entry.text.length > 500}
                  />
                  {entry.kind === "finding" &&
                    !value.entries.some(
                      (other) =>
                        other.findingId === entry.id &&
                        other.kind === "delivery" &&
                        other.text === "Delivered to the agent",
                    ) && (
                      <AdvisorButton
                        title="Ask agent to address"
                        disabled={busy}
                        onPress={() => act("address", entry.id)}
                      />
                    )}
                </View>
              ))}
            <Text className="text-xs text-foreground-muted">
              {value.states
                .reduce((sum, state) => sum + state.inputTokens + state.outputTokens, 0)
                .toLocaleString()}{" "}
              advisor tokens · $
              {value.states.reduce((sum, state) => sum + state.costUsd, 0).toFixed(4)} reported cost
            </Text>
          </>
        )}
      </ScrollView>
      {!following && (
        <AdvisorButton
          title="Latest activity ↓"
          onPress={() => {
            setFollowing(true);
            scroll.current?.scrollToEnd({ animated: false });
          }}
        />
      )}
    </>
  );
}
function AdvisorEntryText({ text, collapsed }: { text: string; collapsed: boolean }) {
  const [expanded, setExpanded] = useState(!collapsed);
  return (
    <Pressable
      accessibilityRole={collapsed ? "button" : undefined}
      onPress={() => setExpanded(!expanded)}
    >
      <Text className="text-sm text-foreground" numberOfLines={expanded ? undefined : 3}>
        {text}
      </Text>
      {collapsed && (
        <Text className="mt-1 text-xs text-foreground-muted">
          {expanded ? "Show less" : "Expand"}
        </Text>
      )}
    </Pressable>
  );
}
