import { useNavigation } from "@react-navigation/native";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ProviderGlobalSettings,
  type ProviderGlobalSettingsWriteInput,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import {
  globalSettingAtPath,
  globalSettingSource,
  globalSettingsDraft,
  globalSettingsEdits,
  parseGlobalSettingJson,
} from "@t3tools/client-runtime/provider-global-settings";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { environmentSession } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsSection } from "./components/SettingsSection";

export function SettingsProvidersRouteScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { environments } = useEnvironments();
  const [selected, setSelected] = useState<{
    environmentId: EnvironmentId;
    instanceId: ProviderInstanceId;
  } | null>(null);
  const environment = environments.find((item) => item.environmentId === selected?.environmentId);
  const provider = environment?.serverConfig?.providers.find(
    (item) => item.instanceId === selected?.instanceId,
  );
  return (
    <View className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <>
          <NativeStackScreenOptions options={{ headerShown: false }} />
          <AndroidScreenHeader title="Providers" onBack={() => navigation.goBack()} />
        </>
      ) : null}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-5 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {selected ? (
          <>
            <Action onPress={() => setSelected(null)}>Back to providers</Action>
            <Text className="text-lg font-t3-medium text-foreground">
              {provider?.displayName ?? provider?.driver ?? "Provider"} · {environment?.label}
            </Text>
            {environment?.connection.phase === "connected" && provider?.supportsGlobalSettings ? (
              <ProviderEditorAccess
                key={`${selected.environmentId}:${selected.instanceId}`}
                {...selected}
              />
            ) : (
              <Text className="text-foreground-muted">Connect to edit these settings.</Text>
            )}
          </>
        ) : (
          <>
            <Text className="text-sm text-foreground-muted">
              Choose a provider to edit its global settings.
            </Text>
            {environments.map((item) => (
              <SettingsSection key={item.environmentId} title={item.label}>
                {item.serverConfig?.providers.some((entry) => entry.supportsGlobalSettings) ? (
                  item.serverConfig.providers
                    .filter((entry) => entry.supportsGlobalSettings)
                    .map((entry) => (
                      <SettingsRow
                        key={entry.instanceId}
                        icon="slider.horizontal.3"
                        label={entry.displayName ?? entry.driver}
                        disabled={item.connection.phase !== "connected"}
                        onPress={() =>
                          setSelected({
                            environmentId: item.environmentId,
                            instanceId: entry.instanceId,
                          })
                        }
                      />
                    ))
                ) : (
                  <Text className="p-4 text-sm text-foreground-muted">
                    No global settings available. Connect to an environment with Codex configured.
                  </Text>
                )}
              </SettingsSection>
            ))}
            {environments.length === 0 ? (
              <Text className="text-foreground-muted">Add an environment in Settings first.</Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ProviderEditorAccess(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
}) {
  const session = useEnvironmentQuery(environmentSession.sessionStateAtom(props.environmentId));
  if (!session.data)
    return <Text className="text-foreground-muted">{session.error ?? "Checking access…"}</Text>;
  if (!session.data.authenticated || !session.data.scopes?.includes(AuthOrchestrationOperateScope))
    return (
      <Text className="text-foreground-muted">You need editing access to view these settings.</Text>
    );
  return <ProviderEditor {...props} />;
}

function ProviderEditor({
  environmentId,
  instanceId,
}: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
}) {
  const read = useAtomCommand(serverEnvironment.readProviderGlobalSettings, {
    reportFailure: false,
  });
  const write = useAtomCommand(serverEnvironment.writeProviderGlobalSettings, {
    reportFailure: false,
  });
  const [settings, setSettings] = useState<ProviderGlobalSettings | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void read({ environmentId, input: { instanceId } }).then((result) => {
      if (cancelled) return;
      if (result._tag === "Success") setSettings(result.value);
      else setError(errorMessage(squashAtomCommandFailure(result)));
      setPending(false);
    });
    return () => {
      cancelled = true;
    };
  }, [environmentId, instanceId, read]);

  async function reload() {
    if (pending || busy.current) return;
    setPending(true);
    setError(null);
    setSaved(false);
    setSettings(null);
    const result = await read({ environmentId, input: { instanceId } });
    if (result._tag === "Success") setSettings(result.value);
    else setError(errorMessage(squashAtomCommandFailure(result)));
    setPending(false);
  }
  async function save(edits: ProviderGlobalSettingsWriteInput["edits"]) {
    if (!settings || pending || busy.current || edits.length === 0) return;
    busy.current = true;
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const result = await write({
        environmentId,
        input: {
          instanceId,
          filePath: settings.filePath,
          expectedVersion: settings.version,
          edits,
        },
      });
      if (result._tag === "Success") {
        setSettings(result.value);
        setSaved(true);
      } else setError(errorMessage(squashAtomCommandFailure(result)));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <View className="gap-4">
      {settings ? (
        <>
          <HelpLabel
            label="Global settings"
            details="Edit the provider's settings on this environment. Instances that share this file share its settings. Thread settings and launch arguments can override them. Reset removes a setting from the file so Codex can use its default or inherited value."
          />
          <Text selectable className="text-xs text-foreground-muted">
            {settings.filePath}
          </Text>
          <Text className="text-sm text-foreground-muted">Applies to new sessions.</Text>
        </>
      ) : pending ? (
        <Text className="text-foreground-muted">Loading settings…</Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
          {error}
        </Text>
      ) : null}
      {saved ? (
        <Text accessibilityLiveRegion="polite" className="text-sm text-foreground-muted">
          Saved.
        </Text>
      ) : null}
      <Action disabled={pending} onPress={() => void reload()}>
        Reload
      </Action>
      {settings ? (
        <ProviderForm
          key={settings.filePath}
          settings={settings}
          pending={pending}
          onSave={save}
          onError={setError}
        />
      ) : null}
    </View>
  );
}

function ProviderForm({
  settings,
  pending,
  onSave,
  onError,
}: {
  readonly settings: ProviderGlobalSettings;
  readonly pending: boolean;
  readonly onSave: (edits: ProviderGlobalSettingsWriteInput["edits"]) => Promise<void>;
  readonly onError: (error: string | null) => void;
}) {
  const [draft, setDraft] = useState(() => globalSettingsDraft(settings));
  const [advanced, setAdvanced] = useState(false);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [previousSettings, setPreviousSettings] = useState(settings);
  if (previousSettings !== settings) {
    setPreviousSettings(settings);
    setDraft(globalSettingsDraft(settings));
    const current = globalSettingAtPath(settings.userConfig, key);
    setValue(current === undefined ? "" : JSON.stringify(current, null, 2));
  }
  const dirty = settings.fields.some(
    (field) => draft[field.key] !== (field.value === null ? "" : String(field.value)),
  );
  function chooseKey(next: string) {
    setKey(next);
    const current = globalSettingAtPath(settings.userConfig, next);
    setValue(current === undefined ? "" : JSON.stringify(current, null, 2));
  }
  const source = globalSettingSource(settings, key);
  return (
    <View className="gap-5">
      {settings.fields.map((field) => (
        <View key={field.key} className="gap-2">
          <HelpLabel
            label={field.title}
            details={`${field.description}${field.effectiveValue !== null ? `\n\nCurrent value: ${String(field.effectiveValue)}.${field.overriddenBy ? ` Set by ${field.overriddenBy}.` : ""}` : ""}`}
          />
          <SettingsSection card>
            <View className="gap-3 p-4">
              {field.control === "select" ? (
                <View className="flex-row flex-wrap gap-2">
                  {[{ value: "", label: "Default" }, ...(field.options ?? [])].map((option) => (
                    <Action
                      key={option.value}
                      disabled={pending}
                      selected={draft[field.key] === option.value}
                      onPress={() => setDraft({ ...draft, [field.key]: option.value })}
                    >
                      {option.label}
                    </Action>
                  ))}
                </View>
              ) : (
                <View className="flex-row items-center gap-2">
                  <TextInput
                    accessibilityLabel={field.title}
                    className="min-w-0 flex-1 rounded-lg border border-border px-3 py-2 text-foreground"
                    value={draft[field.key] ?? ""}
                    placeholder="Default"
                    keyboardType={field.control === "number" ? "number-pad" : "default"}
                    editable={!pending}
                    onChangeText={(text) => setDraft({ ...draft, [field.key]: text })}
                  />
                  {field.control === "number" ? (
                    <Text className="text-xs text-foreground-muted">tokens</Text>
                  ) : null}
                </View>
              )}
              {field.overriddenBy && field.effectiveValue !== null ? (
                <Text className="text-xs text-foreground-muted">
                  Using {String(field.effectiveValue)} from an override.
                </Text>
              ) : null}
              <Action
                disabled={pending || !draft[field.key]}
                onPress={() => setDraft({ ...draft, [field.key]: "" })}
              >
                Reset {field.title}
              </Action>
            </View>
          </SettingsSection>
        </View>
      ))}
      <Action
        disabled={pending || !dirty}
        onPress={() => {
          try {
            void onSave(globalSettingsEdits(settings, draft));
          } catch (error) {
            onError(errorMessage(error));
          }
        }}
      >
        Save
      </Action>
      <Action disabled={pending || !dirty} onPress={() => setDraft(globalSettingsDraft(settings))}>
        Discard
      </Action>
      <Action disabled={pending} onPress={() => setAdvanced(!advanced)}>
        {advanced ? "Close advanced settings" : "Advanced settings"}
      </Action>
      {advanced ? (
        <View className="gap-3">
          <View className="flex-row flex-wrap gap-2">
            {Object.keys(settings.userConfig)
              .sort()
              .map((entry) => (
                <Action key={entry} disabled={pending} onPress={() => chooseKey(entry)}>
                  {entry}
                </Action>
              ))}
          </View>
          <HelpLabel
            label="Key"
            details={`Use a dotted path for nested settings, such as features.memories.${key ? `\n\nCurrent value: ${JSON.stringify(globalSettingAtPath(settings.effectiveConfig, key)) ?? "Unset"}.${source ? ` Set by ${source}.` : ""}` : ""}`}
          />
          <TextInput
            accessibilityLabel="Configuration key"
            value={key}
            onChangeText={chooseKey}
            editable={!pending}
            placeholder="e.g. features.memories"
            autoCapitalize="none"
            autoCorrect={false}
            className="rounded-lg border border-border px-3 py-2 text-foreground"
          />
          <HelpLabel
            label="Value (JSON)"
            details="Strings need double quotes. Use arrays for lists and objects for tables. Saving an object replaces the whole table. Reset removes the key from this file."
          />
          <TextInput
            accessibilityLabel="Configuration value (JSON)"
            value={value}
            onChangeText={setValue}
            editable={!pending}
            placeholder={'e.g. true, "value", ["item"]'}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            textAlignVertical="top"
            className="min-h-28 rounded-lg border border-border px-3 py-2 text-foreground"
          />
          {dirty ? (
            <Text className="text-xs text-foreground-muted">
              Save or discard your changes above first.
            </Text>
          ) : null}
          <View className="flex-row gap-2">
            <Action
              disabled={pending || dirty || !key.trim() || !value.trim()}
              onPress={() => {
                try {
                  void onSave([{ key: key.trim(), value: parseGlobalSettingJson(value) }]);
                } catch {
                  onError("Enter valid JSON. Put strings in double quotes.");
                }
              }}
            >
              Save key
            </Action>
            <Action
              disabled={
                pending || dirty || globalSettingAtPath(settings.userConfig, key) === undefined
              }
              onPress={() => void onSave([{ key: key.trim(), value: null }])}
            >
              Reset key
            </Action>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function HelpLabel({ label, details }: { readonly label: string; readonly details: string }) {
  return (
    <View className="flex-row items-center gap-1">
      <Text className="text-sm font-t3-medium text-foreground">{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`About ${label}`}
        hitSlop={6}
        className="size-8 items-center justify-center"
        onPress={() => Alert.alert(label, details)}
      >
        <SymbolView
          name="info.circle"
          size={16}
          tintColorClassName="accent-icon"
          type="monochrome"
        />
      </Pressable>
    </View>
  );
}

function Action({
  children,
  disabled = false,
  selected = false,
  onPress,
}: {
  readonly children: ReactNode;
  readonly disabled?: boolean;
  readonly selected?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      className={`rounded-lg border border-border px-3 py-2 ${selected ? "bg-accent" : "bg-card"} ${disabled ? "opacity-50" : ""}`}
    >
      <Text className="text-sm text-foreground">{children}</Text>
    </Pressable>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not read or save provider settings.";
}
