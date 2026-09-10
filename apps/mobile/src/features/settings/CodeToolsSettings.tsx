import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { Schema } from "effect";
import { useState } from "react";
import { Modal, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CodeServerOverride,
  codeToolsScopeKey,
  emptyCodeToolsConfiguration,
  type CodeToolsConfiguration,
  type CodeToolsScope,
  type EnvironmentId,
} from "@t3tools/contracts";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { useEnvironments } from "../../state/environments";
import { useProjects } from "../../state/entities";
import { codeTools } from "../../state/codeTools";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsRow } from "./components/SettingsRow";
import { AdvisorButton } from "./AdvisorsSettings";

const field = "min-h-11 rounded-lg border border-border p-3 text-foreground";
const decodeServer = Schema.decodeUnknownSync(Schema.fromJsonString(CodeServerOverride));
export function CodeToolsSettings() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<EnvironmentId | null>(null);
  const { environments } = useEnvironments();
  const insets = useSafeAreaInsets();
  const environment =
    environments.find((value) => value.environmentId === selected) ?? environments[0];
  return (
    <>
      <SettingsRow icon="curlybraces" label="Tools & MCP servers" onPress={() => setOpen(true)} />
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View
          className="flex-1 bg-background"
          style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
        >
          <View className="flex-row items-center justify-between p-4">
            <Text className="text-xl font-t3-semibold text-foreground">Code tools</Text>
            <AdvisorButton title="Done" onPress={() => setOpen(false)} />
          </View>
          <ScrollView contentContainerClassName="gap-4 p-4" keyboardShouldPersistTaps="handled">
            <Text className="text-foreground-muted">
              Language servers and check rules run on the selected environment.
            </Text>
            {environments.map((value) => (
              <AdvisorButton
                key={value.environmentId}
                title={`${value.environmentId === environment?.environmentId ? "✓ " : ""}${value.label}`}
                onPress={() => setSelected(value.environmentId)}
              />
            ))}
            {open && environment && (
              <MobileCodeToolsConfiguration
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
export function MobileCodeToolsConfiguration(props: {
  environmentId: EnvironmentId;
  fixedScope?: CodeToolsScope;
}) {
  const config = useAtomValue(serverEnvironment.configValueAtom(props.environmentId));
  return config?.environment.capabilities.codeTools ? (
    <MobileCodeToolsContent {...props} />
  ) : (
    <Text className="text-foreground-muted">
      Update or reconnect this environment to use code tools.
    </Text>
  );
}

function MobileCodeToolsContent({
  environmentId,
  fixedScope,
}: {
  environmentId: EnvironmentId;
  fixedScope?: CodeToolsScope;
}) {
  const snapshot = useAtomValue(codeTools.snapshot({ environmentId, input: { settings: true } }));
  const save = useAtomCommand(codeTools.save);
  const manage = useAtomCommand(codeTools.manage);
  const projects = useProjects().filter((value) => value.environmentId === environmentId);
  const [scope, setScope] = useState<CodeToolsScope>(fixedScope ?? { type: "environment" });
  const [draft, setDraft] = useState<CodeToolsConfiguration | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [version, setVersion] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const [override, setOverride] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!AsyncResult.isSuccess(snapshot))
    return (
      <Text className="text-foreground-muted">
        {AsyncResult.isFailure(snapshot)
          ? "Update or reconnect this environment to use code tools."
          : "Loading code tools…"}
      </Text>
    );
  const value =
    draft ??
    snapshot.value.configurations.find(
      (value) => codeToolsScopeKey(value.scope) === codeToolsScopeKey(scope),
    ) ??
    emptyCodeToolsConfiguration(scope);
  const update = (patch: Partial<CodeToolsConfiguration>) => setDraft({ ...value, ...patch });
  async function persist() {
    setBusy(true);
    const result = await save({ environmentId, input: value });
    setBusy(false);
    if (result._tag === "Success") {
      setDraft(null);
      setError(null);
    } else setError("Could not save. Reload if these settings changed on another device.");
  }
  return (
    <View className="gap-4">
      {!fixedScope && (
        <MobileChoice
          title="Apply settings to"
          value={codeToolsScopeKey(scope)}
          choices={[
            { value: "environment", label: "All projects" },
            ...projects.map((project) => ({
              value: `project:${project.id}`,
              label: project.title,
            })),
          ]}
          onChange={(key) => {
            const project = projects.find((item) => `project:${item.id}` === key);
            setScope(
              project ? { type: "project", projectId: project.id } : { type: "environment" },
            );
            setDraft(null);
          }}
        />
      )}
      <MobileChoice
        title="Automatic checks"
        value={value.mode ?? "inherit"}
        choices={[
          {
            value: "inherit",
            label: scope.type === "environment" ? "Default · Observe" : "Inherit",
          },
          { value: "observe", label: "Observe" },
          { value: "guide", label: "Guide the agent" },
          { value: "off", label: "Off" },
        ]}
        onChange={(mode) =>
          update({ mode: mode === "inherit" ? null : (mode as "observe" | "guide" | "off") })
        }
      />
      <MobileChoice
        title="Missing language servers"
        value={value.installMode ?? "inherit"}
        choices={[
          {
            value: "inherit",
            label: scope.type === "environment" ? "Default · Install when needed" : "Inherit",
          },
          { value: "automatic", label: "Install when needed" },
          { value: "manual", label: "Install manually" },
        ]}
        onChange={(mode) =>
          update({ installMode: mode === "inherit" ? null : (mode as "automatic" | "manual") })
        }
      />
      <Text className="font-t3-semibold text-foreground">Rules file</Text>
      <TextInput
        accessibilityLabel="Code rules file"
        className={field}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Inherit, or enter a workspace-relative JSON path"
        value={value.rulesFile ?? ""}
        onChangeText={(rulesFile) => update({ rulesFile })}
      />
      <Text className="text-foreground-muted">
        {value.rulesFile === null
          ? "Using inherited rules."
          : value.rulesFile === ""
            ? "Additional rules disabled for this scope."
            : "Using this rules file."}
      </Text>
      {value.rulesFile !== null && (
        <AdvisorButton title="Inherit rules" onPress={() => update({ rulesFile: null })} />
      )}
      <Text className="font-t3-semibold text-foreground">Guidance limit per turn</Text>
      <View className="flex-row flex-wrap gap-2">
        {[null, 0, 1, 2, 3].map((maxCorrections) => (
          <AdvisorButton
            key={maxCorrections ?? "inherit"}
            title={`${value.maxCorrections === maxCorrections ? "✓ " : ""}${maxCorrections ?? "Inherit"}`}
            onPress={() => update({ maxCorrections })}
          />
        ))}
      </View>
      {value.servers.map((server) => (
        <View key={server.id} className="gap-2 rounded-lg border border-border p-3">
          <Text className="text-foreground">
            {server.id}
            {server.enabled ? "" : " · Disabled"}
          </Text>
          <AdvisorButton
            title="Configure"
            onPress={() => {
              setOverride(JSON.stringify(server, null, 2));
              setEditing(true);
            }}
          />
          <AdvisorButton
            title="Reset override"
            onPress={() =>
              update({ servers: value.servers.filter((entry) => entry.id !== server.id) })
            }
          />
        </View>
      ))}
      <AdvisorButton
        title="Custom server"
        onPress={() => {
          setEditing(true);
          setOverride(
            JSON.stringify(
              {
                id: "my-server",
                enabled: true,
                command: "",
                args: ["--stdio"],
                extensions: [".example"],
                rootMarkers: [],
                settings: {},
                initializationOptions: {},
              },
              null,
              2,
            ),
          );
        }}
      />
      {editing && (
        <View className="gap-2">
          <Text className="text-foreground-muted">
            Enter the server command, arguments, file extensions, root markers and optional settings
            as JSON.
          </Text>
          <TextInput
            multiline
            accessibilityLabel="Language server configuration"
            className={`${field} min-h-56 font-mono`}
            autoCapitalize="none"
            autoCorrect={false}
            value={override}
            onChangeText={setOverride}
          />
          <AdvisorButton
            title="Use configuration"
            onPress={() => {
              try {
                const next = decodeServer(override);
                update({ servers: [...value.servers.filter((item) => item.id !== next.id), next] });
                setEditing(false);
                setError(null);
              } catch {
                setError("Enter valid server configuration JSON.");
              }
            }}
          />
          <AdvisorButton title="Cancel" onPress={() => setEditing(false)} />
        </View>
      )}
      {draft && (
        <View className="gap-2">
          <AdvisorButton disabled={busy} title="Save settings" onPress={() => void persist()} />
          <AdvisorButton
            disabled={busy}
            title="Discard changes"
            onPress={() => {
              setDraft(null);
              setError(null);
            }}
          />
        </View>
      )}
      {error && (
        <Text accessibilityRole="alert" className="text-destructive">
          {error}
        </Text>
      )}
      {!fixedScope && (
        <>
          <Text className="font-t3-semibold text-foreground">Available tools</Text>
          <TextInput
            accessibilityLabel="Find code tools"
            className={field}
            value={search}
            placeholder="Search languages and tools"
            onChangeText={setSearch}
          />
          {snapshot.value.servers
            .filter((server) => server.name.toLowerCase().includes(search.toLowerCase()))
            .map((server) => (
              <View key={server.id} className="gap-3 rounded-lg border border-border p-3">
                <AdvisorButton
                  title={`${server.name} · ${server.status.replaceAll("-", " ")}${server.version ? ` · ${server.version}` : ""}`}
                  onPress={() => {
                    setExpanded(expanded === server.id ? null : server.id);
                    setVersion("");
                  }}
                />
                {expanded === server.id && (
                  <>
                    <Text className="text-foreground-muted">
                      {server.detail || `${server.sessions} active sessions`}
                    </Text>
                    {server.status === "installing" ? (
                      <AdvisorButton
                        title="Cancel installation"
                        onPress={() =>
                          void manage({
                            environmentId,
                            input: { action: "cancel", serverId: server.id },
                          })
                        }
                      />
                    ) : (
                      server.canInstall && (
                        <>
                          <TextInput
                            accessibilityLabel="Server version"
                            className={field}
                            value={version}
                            onChangeText={setVersion}
                            placeholder="Latest release"
                            autoCapitalize="none"
                          />
                          <AdvisorButton
                            title={server.version ? "Update / change version" : "Install"}
                            onPress={() =>
                              void manage({
                                environmentId,
                                input: {
                                  action: "install",
                                  serverId: server.id,
                                  ...(version.trim() ? { version: version.trim() } : {}),
                                },
                              })
                            }
                          />
                        </>
                      )
                    )}
                    {server.sessions > 0 && (
                      <AdvisorButton
                        title="Stop sessions"
                        onPress={() =>
                          void manage({
                            environmentId,
                            input: { action: "restart", serverId: server.id },
                          })
                        }
                      />
                    )}
                    <AdvisorButton
                      title="Configure"
                      onPress={() => {
                        setOverride(
                          JSON.stringify(
                            value.servers.find((item) => item.id === server.id) ?? {
                              id: server.id,
                              enabled: true,
                              settings: {},
                              initializationOptions: {},
                            },
                            null,
                            2,
                          ),
                        );
                        setEditing(true);
                      }}
                    />
                    {server.version && (
                      <AdvisorButton
                        title="Remove"
                        disabled={server.sessions > 0 || server.status === "installing"}
                        onPress={() =>
                          void manage({
                            environmentId,
                            input: { action: "remove", serverId: server.id },
                          })
                        }
                      />
                    )}
                  </>
                )}
              </View>
            ))}
        </>
      )}
    </View>
  );
}

function MobileChoice({
  title,
  value,
  choices,
  onChange,
}: {
  title: string;
  value: string;
  choices: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View className="gap-2">
      <Text className="font-t3-semibold text-foreground">{title}</Text>
      <AdvisorButton
        title={choices.find((choice) => choice.value === value)?.label ?? value}
        onPress={() => setOpen(!open)}
      />
      {open &&
        choices.map((choice) => (
          <AdvisorButton
            key={choice.value}
            title={`${choice.value === value ? "✓ " : ""}${choice.label}`}
            onPress={() => {
              onChange(choice.value);
              setOpen(false);
            }}
          />
        ))}
    </View>
  );
}
