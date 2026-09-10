import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { useState } from "react";
import {
  codeDiagnosticKey,
  codeDiagnosticText,
  codeToolDisplayItems,
} from "@t3tools/client-runtime/code-tool-results";
import { Modal, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { EnvironmentId, ThreadId, CodeToolInput, CodeToolResult } from "@t3tools/contracts";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { codeTools } from "../../state/codeTools";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { AdvisorButton } from "../settings/AdvisorsSettings";
import { MobileCodeToolsConfiguration } from "../settings/CodeToolsSettings";

export function ThreadCodeChecks(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  openRequest?: number;
}) {
  const config = useAtomValue(serverEnvironment.configValueAtom(props.environmentId));
  return config?.environment.capabilities.codeTools ? <ThreadCodeChecksContent {...props} /> : null;
}

function ThreadCodeChecksContent({
  environmentId,
  threadId,
  openRequest,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  openRequest?: number;
}) {
  const [manualOpen, setManualOpen] = useState(false);
  const [closedRequest, setClosedRequest] = useState(0);
  const open = manualOpen || (openRequest ?? 0) > closedRequest;
  const setOpen = (next: boolean) => {
    setManualOpen(next);
    if (!next) setClosedRequest(openRequest ?? 0);
  };
  const snapshot = useAtomValue(
    codeTools.snapshot({ environmentId, input: { threadId, details: open } }),
  );
  const run = useAtomCommand(codeTools.run);
  const manage = useAtomCommand(codeTools.manage);
  const [settings, setSettings] = useState(false);
  const [navigation, setNavigation] = useState(false);
  const [file, setFile] = useState("");
  const [serverId, setServerId] = useState("");
  const [line, setLine] = useState("1");
  const [character, setCharacter] = useState("1");
  const [newName, setNewName] = useState("");
  const [result, setResult] = useState<CodeToolResult | null>(null);
  const [lastInput, setLastInput] = useState<CodeToolInput | null>(null);
  const [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets();
  const value = AsyncResult.isSuccess(snapshot) ? snapshot.value.checks : null;
  const missing =
    AsyncResult.isSuccess(snapshot) && value?.status === "unavailable"
      ? snapshot.value.servers.filter(
          (server) =>
            server.canInstall &&
            (server.status === "not-installed" || server.status === "error") &&
            value.checkedFiles.some((file) =>
              server.extensions.some((extension) => file.endsWith(extension)),
            ),
        )
      : [];
  async function execute(input: CodeToolInput) {
    setBusy(true);
    input = { ...input, ...(serverId ? { serverId } : {}) };
    const response = await run({ environmentId, input: { ...input, threadId } });
    setBusy(false);
    if (response._tag === "Success") {
      setResult(input.action === "diagnostics" && !input.file ? null : response.value);
      setLastInput({
        ...input,
        expectedHashes: Object.fromEntries(
          Array.isArray(response.value.data)
            ? response.value.data.flatMap((entry: unknown) =>
                entry &&
                typeof entry === "object" &&
                "file" in entry &&
                typeof entry.file === "string" &&
                "hash" in entry &&
                typeof entry.hash === "string"
                  ? [[entry.file, entry.hash]]
                  : [],
              )
            : [],
        ),
      });
    }
  }
  return (
    <>
      {value && ["issues", "unavailable"].includes(value.status) && (
        <AdvisorButton
          title={
            value.status === "issues"
              ? `Code checks · ${AsyncResult.isSuccess(snapshot) ? snapshot.value.issueCount : 0} issues`
              : "Code checks unavailable"
          }
          onPress={() => setOpen(true)}
        />
      )}
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View
          className="flex-1 bg-background"
          style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
        >
          <View className="flex-row items-center justify-between p-4">
            <Text className="font-t3-semibold text-foreground">Code checks</Text>
            <AdvisorButton title="Done" onPress={() => setOpen(false)} />
          </View>
          <ScrollView contentContainerClassName="gap-4 p-4" keyboardShouldPersistTaps="handled">
            <Text className="text-foreground-muted">
              {value?.detail ?? "Check changed files for errors and project rules."}
            </Text>
            <AdvisorButton
              title={busy ? "Checking…" : "Run checks"}
              disabled={busy}
              onPress={() => void execute({ action: "diagnostics" })}
            />
            {AsyncResult.isSuccess(snapshot) &&
              snapshot.value.servers
                .filter((server) => server.status === "installing")
                .map((server) => (
                  <View key={server.id} className="gap-2 rounded border border-border p-3">
                    <Text className="text-foreground">Installing {server.name}</Text>
                    <Text className="text-xs text-foreground-muted">{server.detail}</Text>
                    <AdvisorButton
                      title="Cancel installation"
                      onPress={() =>
                        void manage({
                          environmentId,
                          input: { action: "cancel", serverId: server.id },
                        })
                      }
                    />
                  </View>
                ))}
            {missing.map((server) => (
              <AdvisorButton
                key={server.id}
                title={`Install ${server.name}`}
                onPress={() =>
                  void manage({ environmentId, input: { action: "install", serverId: server.id } })
                }
              />
            ))}
            {value?.diagnostics.map((diagnostic) => (
              <View
                key={codeDiagnosticKey(diagnostic)}
                className="gap-2 rounded-lg border border-border p-3"
              >
                <Text selectable className="font-mono text-xs text-foreground-muted">
                  {diagnostic.file}:{diagnostic.line}
                </Text>
                <Text selectable className="text-foreground">
                  {codeDiagnosticText(diagnostic)}
                </Text>
                <Text className="text-xs text-foreground-muted">
                  {diagnostic.severity} · {diagnostic.source}
                </Text>
              </View>
            ))}
            <AdvisorButton title="Thread settings" onPress={() => setSettings(!settings)} />
            {settings && (
              <MobileCodeToolsConfiguration
                environmentId={environmentId}
                fixedScope={{ type: "thread", threadId }}
              />
            )}
            <AdvisorButton
              title="Navigate and refactor"
              onPress={() => setNavigation(!navigation)}
            />
            {navigation && (
              <View className="gap-3">
                <TextInput
                  accessibilityLabel="Code tool file"
                  className="min-h-11 rounded border border-border p-3 text-foreground"
                  placeholder="src/example.ts"
                  autoCapitalize="none"
                  value={file}
                  onChangeText={setFile}
                />
                <TextInput
                  accessibilityLabel="Language server identifier"
                  className="min-h-11 rounded border border-border p-3 text-foreground"
                  placeholder="Server · automatic selection"
                  value={serverId}
                  onChangeText={setServerId}
                  autoCapitalize="none"
                />
                <View className="flex-row gap-2">
                  <TextInput
                    accessibilityLabel="Line"
                    className="min-h-11 flex-1 rounded border border-border p-3 text-foreground"
                    value={line}
                    onChangeText={setLine}
                    keyboardType="number-pad"
                  />
                  <TextInput
                    accessibilityLabel="Column"
                    className="min-h-11 flex-1 rounded border border-border p-3 text-foreground"
                    value={character}
                    onChangeText={setCharacter}
                    keyboardType="number-pad"
                  />
                </View>
                {(
                  [
                    ["definition", "Go to definition"],
                    ["references", "Find references"],
                    ["hover", "Type information"],
                    ["symbols", "Find symbols"],
                    ["code_actions", "Code actions"],
                  ] as const
                ).map(([action, title]) => (
                  <AdvisorButton
                    key={action}
                    title={title}
                    disabled={busy}
                    onPress={() =>
                      void execute({
                        action,
                        file,
                        line: Number(line),
                        character: Number(character),
                      })
                    }
                  />
                ))}
                <TextInput
                  accessibilityLabel="New symbol name"
                  className="min-h-11 rounded border border-border p-3 text-foreground"
                  placeholder="New symbol name"
                  autoCapitalize="none"
                  value={newName}
                  onChangeText={setNewName}
                />
                <AdvisorButton
                  title="Preview rename"
                  disabled={busy || !newName}
                  onPress={() =>
                    void execute({
                      action: "rename",
                      file,
                      line: Number(line),
                      character: Number(character),
                      newName,
                    })
                  }
                />
              </View>
            )}
            {result && (
              <>
                <Text className="text-foreground">{result.text}</Text>
                {result.diagnostics.map((diagnostic) => (
                  <View key={codeDiagnosticKey(diagnostic)} className="gap-1">
                    <Text className="text-xs text-foreground-muted">
                      {diagnostic.file}:{diagnostic.line}
                    </Text>
                    <Text selectable className="text-foreground">
                      {codeDiagnosticText(diagnostic)}
                    </Text>
                  </View>
                ))}
                {codeToolDisplayItems(result.data, lastInput?.file).map((item) =>
                  item.actionIndex !== undefined ? (
                    <AdvisorButton
                      key={`${item.text}:${item.file ?? ""}:${item.line ?? 0}:${item.actionIndex ?? -1}`}
                      title={item.text}
                      onPress={() => {
                        if (lastInput)
                          void execute({ ...lastInput, actionIndex: item.actionIndex });
                      }}
                    />
                  ) : (
                    <View
                      key={`${item.text}:${item.file ?? ""}:${item.line ?? 0}:${item.actionIndex ?? -1}`}
                      className="gap-2"
                    >
                      <Text selectable className="font-mono text-xs text-foreground">
                        {item.text}
                      </Text>
                      {item.before !== undefined && item.after !== undefined && (
                        <>
                          <Text className="text-xs text-foreground-muted">Before</Text>
                          <Text selectable className="font-mono text-xs text-foreground">
                            {item.before}
                          </Text>
                          <Text className="text-xs text-foreground-muted">After</Text>
                          <Text selectable className="font-mono text-xs text-foreground">
                            {item.after}
                          </Text>
                        </>
                      )}
                    </View>
                  ),
                )}
                {lastInput &&
                  !lastInput.apply &&
                  Array.isArray(result.data) &&
                  result.data.some(
                    (entry: unknown) => entry && typeof entry === "object" && "after" in entry,
                  ) && (
                    <AdvisorButton
                      title="Apply changes"
                      disabled={busy}
                      onPress={() => void execute({ ...lastInput, apply: true })}
                    />
                  )}
              </>
            )}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}
