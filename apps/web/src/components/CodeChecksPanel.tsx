import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { useState } from "react";
import {
  codeDiagnosticKey,
  codeDiagnosticText,
  codeToolDisplayItems,
} from "@t3tools/client-runtime/code-tool-results";
import { CheckCheck, Play, Settings2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  type EnvironmentId,
  type ThreadId,
  type CodeToolInput,
  type CodeToolResult,
} from "@t3tools/contracts";
import { codeTools } from "~/state/codeTools";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { CodeToolsSettings } from "./settings/CodeToolsSettings";

export function CodeChecksIndicator({
  environmentId,
  threadId,
  onOpen,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  onOpen: () => void;
}) {
  const snapshot = useAtomValue(codeTools.snapshot({ environmentId, input: { threadId } }));
  const value = AsyncResult.isSuccess(snapshot) ? snapshot.value.checks : null;
  if (!value || !["issues", "unavailable"].includes(value.status)) return null;
  return (
    <Button variant="ghost" size="sm" aria-label="Open code checks" onClick={onOpen}>
      <CheckCheck className="size-3.5" />
      <span className="text-xs">
        {value.status === "unavailable"
          ? "Checks unavailable"
          : `${AsyncResult.isSuccess(snapshot) ? snapshot.value.issueCount : 0} issues`}
      </span>
    </Button>
  );
}

export function CodeChecksPanel(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  onOpenFile: (file: string, line: number) => void;
  initialFile?: string | undefined;
  initialLine?: number | undefined;
}) {
  const config = useAtomValue(serverEnvironment.configValueAtom(props.environmentId));
  return config?.environment.capabilities.codeTools ? (
    <CodeChecksContent {...props} />
  ) : (
    <p className="p-4 text-sm text-muted-foreground">
      Update or reconnect this environment to use code checks.
    </p>
  );
}

function CodeChecksContent({
  environmentId,
  threadId,
  onOpenFile,
  initialFile,
  initialLine,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  onOpenFile: (file: string, line: number) => void;
  initialFile?: string | undefined;
  initialLine?: number | undefined;
}) {
  const snapshot = useAtomValue(
    codeTools.snapshot({ environmentId, input: { threadId, details: true } }),
  );
  const run = useAtomCommand(codeTools.run);
  const manage = useAtomCommand(codeTools.manage);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState(initialFile ?? "");
  const [action, setAction] = useState<CodeToolInput["action"]>("definition");
  const [line, setLine] = useState(String(initialLine ?? 1));
  const [character, setCharacter] = useState("1");
  const [newName, setNewName] = useState("");
  const [query, setQuery] = useState("");
  const [serverId, setServerId] = useState("");
  const [result, setResult] = useState<CodeToolResult | null>(null);
  const [lastInput, setLastInput] = useState<CodeToolInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function execute(input: CodeToolInput) {
    setBusy(true);
    setError(null);
    setResult(null);
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
    } else
      setError(
        "The code tool could not complete. Check the error notification or configure its language server in Settings.",
      );
  }
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
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <CheckCheck className="size-4" />
        <h2 className="flex-1 text-sm font-medium">Code checks</h2>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || value?.status === "checking"}
          onClick={() => void execute({ action: "diagnostics" })}
        >
          <Play className="size-3" />
          Run
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Code tools settings"
          render={
            <Link to="/settings/tools" search={{ environment: environmentId }} hash="code-tools" />
          }
        >
          <Settings2 className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <p className="whitespace-pre-wrap text-sm text-muted-foreground" role="status">
          {value?.status === "checking"
            ? "Checking changed files…"
            : (value?.detail ??
              "Check changed files for errors and project rules. Choose Guide in thread settings to send new errors to the running agent.")}
        </p>
        {AsyncResult.isSuccess(snapshot) &&
          snapshot.value.servers
            .filter((server) => server.status === "installing")
            .map((server) => (
              <div
                key={server.id}
                className="rounded border border-border p-3 text-sm"
                role="status"
              >
                <p>Installing {server.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{server.detail}</p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void manage({ environmentId, input: { action: "cancel", serverId: server.id } })
                  }
                >
                  Cancel installation
                </Button>
              </div>
            ))}
        {missing.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {missing.map((server) => (
              <Button
                key={server.id}
                variant="outline"
                size="sm"
                onClick={() =>
                  void manage({ environmentId, input: { action: "install", serverId: server.id } })
                }
              >
                Install {server.name}
              </Button>
            ))}
          </div>
        )}
        {value?.diagnostics.length ? (
          <div className="space-y-3">
            {value.diagnostics.map((diagnostic) => (
              <div
                key={codeDiagnosticKey(diagnostic)}
                className="rounded-lg border border-border p-3"
              >
                <Button
                  variant="link"
                  className="h-auto max-w-full justify-start p-0 text-xs"
                  onClick={() => onOpenFile(diagnostic.file, diagnostic.line)}
                >
                  {diagnostic.file}:{diagnostic.line}
                </Button>
                <p className="mt-1 whitespace-pre-wrap text-sm">{codeDiagnosticText(diagnostic)}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {diagnostic.severity} · {diagnostic.source}
                  {diagnostic.code ? ` · ${diagnostic.code}` : ""}
                </p>
              </div>
            ))}
          </div>
        ) : value?.status === "clean" ? (
          <p className="text-sm">No issues reported in the checked files.</p>
        ) : null}
        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">Thread settings</summary>
          <div className="mt-4">
            <CodeToolsSettings
              environmentId={environmentId}
              fixedScope={{ type: "thread", threadId }}
            />
          </div>
        </details>
        <details
          className="rounded-lg border border-border p-3"
          open={initialFile ? true : undefined}
        >
          <summary className="cursor-pointer text-sm font-medium">Navigate and refactor</summary>
          <form
            className="mt-3 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void execute({
                action,
                ...(file ? { file } : {}),
                ...(serverId ? { serverId } : {}),
                line: Number(line),
                character: Number(character),
                ...(newName ? { newName } : {}),
                ...(query ? { query } : {}),
              });
            }}
          >
            <label className="block space-y-1 text-sm">
              Action
              <select
                aria-label="Code tool action"
                className="h-9 w-full rounded-md border border-input bg-background px-2"
                value={action}
                onChange={(event) => {
                  setAction(event.target.value as CodeToolInput["action"]);
                  setResult(null);
                }}
              >
                {(
                  [
                    ["definition", "Go to definition"],
                    ["references", "Find references"],
                    ["hover", "Type information"],
                    ["symbols", "Find symbols"],
                    ["rename", "Rename symbol"],
                    ["code_actions", "Code actions"],
                    ["diagnostics", "Check a file"],
                  ] as const
                ).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-sm">
              File
              <Input
                aria-label="Code tool file"
                placeholder="src/example.ts"
                value={file}
                onChange={(event) => setFile(event.target.value)}
              />
            </label>
            <label className="block space-y-1 text-sm">
              Server <span className="text-xs text-muted-foreground">(optional)</span>
              <Input
                placeholder="Automatic selection"
                value={serverId}
                onChange={(event) => setServerId(event.target.value)}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-sm">
                Line
                <Input
                  type="number"
                  min="1"
                  value={line}
                  onChange={(event) => setLine(event.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm">
                Column
                <Input
                  type="number"
                  min="1"
                  value={character}
                  onChange={(event) => setCharacter(event.target.value)}
                />
              </label>
            </div>
            {action === "rename" && (
              <label className="block space-y-1 text-sm">
                New name
                <Input
                  required
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                />
              </label>
            )}
            {action === "symbols" && (
              <label className="block space-y-1 text-sm">
                Symbol search
                <Input value={query} onChange={(event) => setQuery(event.target.value)} />
              </label>
            )}
            <Button size="sm" variant="outline" disabled={busy} type="submit">
              {busy ? "Working…" : action === "rename" ? "Preview rename" : "Run code tool"}
            </Button>
          </form>
        </details>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {result && (
          <div className="space-y-3">
            <p className="text-sm">{result.text}</p>
            {result.diagnostics.map((diagnostic) => (
              <div key={codeDiagnosticKey(diagnostic)} className="rounded border border-border p-3">
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => onOpenFile(diagnostic.file, diagnostic.line)}
                >
                  {diagnostic.file}:{diagnostic.line}
                </Button>
                <p className="whitespace-pre-wrap text-sm">{codeDiagnosticText(diagnostic)}</p>
              </div>
            ))}
            <CodeToolData
              data={result.data}
              file={lastInput?.file}
              onOpenFile={onOpenFile}
              onAction={(index) => {
                if (lastInput) void execute({ ...lastInput, actionIndex: index });
              }}
            />
            {lastInput &&
              !lastInput.apply &&
              ["rename", "code_actions"].includes(lastInput.action) &&
              Array.isArray(result.data) &&
              result.data.some(
                (entry) => entry && typeof entry === "object" && "after" in entry,
              ) && (
                <Button disabled={busy} onClick={() => void execute({ ...lastInput, apply: true })}>
                  Apply changes
                </Button>
              )}
          </div>
        )}
      </div>
    </div>
  );
}

function CodeToolData({
  data,
  file,
  onOpenFile,
  onAction,
}: {
  data: unknown;
  file?: string | undefined;
  onOpenFile: (file: string, line: number) => void;
  onAction: (index: number) => void;
}) {
  return (
    <div className="space-y-3">
      {codeToolDisplayItems(data, file).map((item) => {
        if (item.actionIndex !== undefined)
          return (
            <Button
              key={`${item.text}:${item.file ?? ""}:${item.line ?? 0}:${item.actionIndex ?? -1}`}
              variant="outline"
              size="sm"
              className="h-auto whitespace-normal text-left"
              onClick={() => onAction(item.actionIndex!)}
            >
              {item.text}
            </Button>
          );
        if (item.before !== undefined && item.after !== undefined)
          return (
            <div
              key={`${item.text}:${item.file ?? ""}:${item.line ?? 0}:${item.actionIndex ?? -1}`}
              className="space-y-1"
            >
              <p className="text-xs font-medium">{item.text}</p>
              <p className="text-xs text-muted-foreground">Before</p>
              <pre className="max-h-48 overflow-auto rounded bg-red-500/5 p-2 text-xs">
                {item.before}
              </pre>
              <p className="text-xs text-muted-foreground">After</p>
              <pre className="max-h-48 overflow-auto rounded bg-green-500/5 p-2 text-xs">
                {item.after}
              </pre>
            </div>
          );
        if (item.file)
          return (
            <Button
              key={`${item.text}:${item.file ?? ""}:${item.line ?? 0}:${item.actionIndex ?? -1}`}
              variant="link"
              className="h-auto break-all whitespace-normal text-left text-xs"
              onClick={() => onOpenFile(item.file!, item.line ?? 1)}
            >
              {item.text}
            </Button>
          );
        return (
          <pre
            key={`${item.text}:${item.file ?? ""}:${item.line ?? 0}:${item.actionIndex ?? -1}`}
            className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-3 text-xs"
          >
            {item.text}
          </pre>
        );
      })}
    </div>
  );
}
