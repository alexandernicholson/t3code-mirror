import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { useState } from "react";
import { Schema } from "effect";
import { ChevronDown, Download, Plus, RefreshCw } from "lucide-react";
import {
  CodeServerOverride,
  codeToolsScopeKey,
  emptyCodeToolsConfiguration,
  type CodeToolsConfiguration,
  type CodeToolsScope,
  type EnvironmentId,
} from "@t3tools/contracts";
import { codeTools } from "~/state/codeTools";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { useProjects } from "~/state/entities";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Badge } from "../ui/badge";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "../ui/dialog";

const field = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
const decodeOverride = Schema.decodeUnknownSync(CodeServerOverride);
const decodeEditor = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      ...CodeServerOverride.fields,
      command: Schema.optionalKey(Schema.String),
    }),
  ),
);
const decodeOptions = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

export function CodeToolsSettings(props: {
  environmentId: EnvironmentId;
  fixedScope?: CodeToolsScope;
}) {
  const config = useAtomValue(serverEnvironment.configValueAtom(props.environmentId));
  return config?.environment.capabilities.codeTools ? (
    <CodeToolsConfigurationContent {...props} />
  ) : (
    <section id="code-tools">
      <h2 className="text-sm font-medium">Code tools</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {config ? "Update this environment to use code tools." : "Connecting to code tools…"}
      </p>
    </section>
  );
}

function CodeToolsConfigurationContent({
  environmentId,
  fixedScope,
}: {
  environmentId: EnvironmentId;
  fixedScope?: CodeToolsScope;
}) {
  const snapshot = useAtomValue(codeTools.snapshot({ environmentId, input: { settings: true } }));
  const save = useAtomCommand(codeTools.save);
  const manage = useAtomCommand(codeTools.manage);
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const [scope, setScope] = useState<CodeToolsScope>(fixedScope ?? { type: "environment" });
  const [draft, setDraft] = useState<CodeToolsConfiguration | null>(null);
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [editor, setEditor] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState<Record<string, string>>({});
  if (!AsyncResult.isSuccess(snapshot))
    return (
      <section id="code-tools" className="space-y-2">
        <h2 className="text-sm font-medium">Code tools</h2>
        <p className="text-sm text-muted-foreground">
          {AsyncResult.isFailure(snapshot)
            ? "Code tools unavailable. Update or reconnect this environment."
            : "Loading code tools…"}
        </p>
      </section>
    );
  const value =
    draft ??
    snapshot.value.configurations.find(
      (item) => codeToolsScopeKey(item.scope) === codeToolsScopeKey(scope),
    ) ??
    emptyCodeToolsConfiguration(scope);
  const update = (patch: Partial<CodeToolsConfiguration>) => setDraft({ ...value, ...patch });
  async function persist() {
    setBusy(true);
    setError(null);
    const result = await save({ environmentId, input: value });
    setBusy(false);
    if (result._tag === "Success") setDraft(null);
    else setError("Settings could not be saved. Reload if another device changed them.");
  }
  const all = snapshot.value.servers.filter((server) =>
    `${server.name} ${server.languages.join(" ")}`.toLowerCase().includes(search.toLowerCase()),
  );
  const visible =
    search || showAll ? all : all.filter((server) => server.status !== "not-installed");
  return (
    <section id="code-tools" className="space-y-5 scroll-mt-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Code tools</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Language servers help agents understand and check your code. Tools install on this
            environment and keep each worktree separate.
          </p>
        </div>
        <Badge variant="secondary">Built in</Badge>
      </div>
      {!fixedScope && (
        <label className="block max-w-sm space-y-1.5 text-sm">
          Apply settings to
          <select
            aria-label="Code tools scope"
            className={field}
            value={codeToolsScopeKey(scope)}
            onChange={(event) => {
              const project = projects.find(
                (project) => `project:${project.id}` === event.target.value,
              );
              setScope(
                project ? { type: "project", projectId: project.id } : { type: "environment" },
              );
              setDraft(null);
            }}
          >
            <option value="environment">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={`project:${project.id}`}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm">
          Automatic checks
          <select
            className={field}
            aria-label="Automatic code checks"
            value={value.mode ?? "inherit"}
            onChange={(event) =>
              update({
                mode:
                  event.target.value === "inherit"
                    ? null
                    : (event.target.value as "off" | "observe" | "guide"),
              })
            }
          >
            <option value="inherit">
              {scope.type === "environment" ? "Default · Observe" : "Inherit"}
            </option>
            <option value="observe">Observe</option>
            <option value="guide">Guide the agent</option>
            <option value="off">Off</option>
          </select>
        </label>
        <label className="space-y-1.5 text-sm">
          Missing language servers
          <select
            className={field}
            aria-label="Language server installation"
            value={value.installMode ?? "inherit"}
            onChange={(event) =>
              update({
                installMode:
                  event.target.value === "inherit"
                    ? null
                    : (event.target.value as "automatic" | "manual"),
              })
            }
          >
            <option value="inherit">
              {scope.type === "environment" ? "Default · Install when needed" : "Inherit"}
            </option>
            <option value="automatic">Install when needed</option>
            <option value="manual">Install manually</option>
          </select>
        </label>
      </div>
      <details className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          Check rules and server configuration
        </summary>
        <div className="mt-4 space-y-4">
          <p className="text-xs text-muted-foreground">
            Checks use language-server diagnostics and your rules. Guide mode queues new errors for
            the running agent with a limited retry budget.
          </p>
          <label className="block space-y-1.5 text-sm">
            Rules file
            <Input
              aria-label="Code rules file"
              placeholder="Inherit from t3.json, or enter a workspace-relative JSON path"
              value={value.rulesFile ?? ""}
              onChange={(event) => update({ rulesFile: event.target.value })}
            />
          </label>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {value.rulesFile === null
                ? "Using inherited rules."
                : value.rulesFile === ""
                  ? "Additional rules disabled for this scope."
                  : "Using this rules file."}
            </span>
            {value.rulesFile !== null && (
              <Button variant="link" size="sm" onClick={() => update({ rulesFile: null })}>
                Inherit rules
              </Button>
            )}
          </div>
          <label className="block max-w-xs space-y-1.5 text-sm">
            Guidance limit per turn
            <select
              className={field}
              value={value.maxCorrections ?? "inherit"}
              onChange={(event) =>
                update({
                  maxCorrections:
                    event.target.value === "inherit" ? null : Number(event.target.value),
                })
              }
            >
              <option value="inherit">
                {scope.type === "environment" ? "Default · 1" : "Inherit"}
              </option>
              {[0, 1, 2, 3].map((number) => (
                <option key={number} value={number}>
                  {number}
                </option>
              ))}
            </select>
          </label>
          {value.servers.map((server) => (
            <div key={server.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="flex-1">
                {server.id}
                {server.enabled ? "" : " · Disabled"}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditor({ id: server.id, text: JSON.stringify(server, null, 2) })}
              >
                Configure
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  update({ servers: value.servers.filter((entry) => entry.id !== server.id) })
                }
              >
                Reset
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setEditor({
                id: "",
                text: JSON.stringify(
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
              })
            }
          >
            <Plus className="size-3.5" />
            Custom server
          </Button>
        </div>
      </details>
      {draft && (
        <div className="flex items-center gap-2">
          <Button disabled={busy} onClick={() => void persist()}>
            Save settings
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setDraft(null);
              setError(null);
            }}
          >
            Discard
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!fixedScope && (
        <>
          <div className="flex items-center gap-2">
            <Input
              aria-label="Find a code tool"
              placeholder="Find a language or code tool…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button
              aria-label="Refresh code tools"
              variant="ghost"
              size="icon"
              onClick={() =>
                void manage({ environmentId, input: { action: "refresh", serverId: "" } })
              }
            >
              <RefreshCw className="size-4" />
            </Button>
          </div>
          {!visible.length && (
            <p className="text-sm text-muted-foreground">
              {search
                ? "No matching tools. Add a custom server for another language."
                : "Language servers will appear here when installed. You can install one ahead of time below."}
            </p>
          )}
          <div className="divide-y divide-border rounded-lg border border-border empty:hidden">
            {visible.map((server) => (
              <details key={server.id} className="group p-3">
                <summary className="flex cursor-pointer list-none items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{server.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {server.status === "not-installed"
                        ? "Not installed"
                        : server.status === "external"
                          ? "Existing installation"
                          : server.status === "installed"
                            ? `Installed${server.version ? ` · ${server.version}` : ""}`
                            : server.status === "installing"
                              ? "Installing…"
                              : "Installation needs attention"}
                      {server.sessions ? ` · ${server.sessions} active` : ""}
                    </div>
                  </div>
                  <ChevronDown className="size-4 text-muted-foreground" />
                </summary>
                <div className="mt-3 space-y-3">
                  {server.detail && (
                    <p
                      className={`whitespace-pre-wrap text-xs ${server.status === "error" ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      {server.detail}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {server.status === "installing" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void manage({
                            environmentId,
                            input: { action: "cancel", serverId: server.id },
                          })
                        }
                      >
                        Cancel installation
                      </Button>
                    ) : (
                      server.canInstall && (
                        <>
                          <Input
                            className="w-36"
                            aria-label={`${server.name} version`}
                            placeholder="Latest release"
                            value={versions[server.id] ?? ""}
                            onChange={(event) =>
                              setVersions({ ...versions, [server.id]: event.target.value })
                            }
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void manage({
                                environmentId,
                                input: {
                                  action: "install",
                                  serverId: server.id,
                                  ...(versions[server.id]?.trim()
                                    ? { version: versions[server.id]!.trim() }
                                    : {}),
                                },
                              })
                            }
                          >
                            <Download className="size-3.5" />
                            {server.status === "installed"
                              ? "Update / change version"
                              : server.status === "error"
                                ? "Retry installation"
                                : "Install"}
                          </Button>
                        </>
                      )
                    )}
                    {server.sessions > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void manage({
                            environmentId,
                            input: { action: "restart", serverId: server.id },
                          })
                        }
                      >
                        Stop sessions
                      </Button>
                    )}
                    {server.version && server.status !== "installing" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={server.sessions > 0}
                        onClick={() =>
                          void manage({
                            environmentId,
                            input: { action: "remove", serverId: server.id },
                          })
                        }
                      >
                        Remove
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setEditor({
                          id: server.id,
                          text: JSON.stringify(
                            value.servers.find((item) => item.id === server.id) ?? {
                              id: server.id,
                              enabled: true,
                              settings: {},
                              initializationOptions: {},
                            },
                            null,
                            2,
                          ),
                        })
                      }
                    >
                      Configure
                    </Button>
                  </div>
                </div>
              </details>
            ))}
          </div>
          {!search && (
            <Button variant="ghost" size="sm" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show installed tools" : "Browse available tools"}
            </Button>
          )}
        </>
      )}
      {editor && (
        <ServerEditor
          initial={editor.text}
          existing={!!editor.id}
          onClose={() => setEditor(null)}
          onSave={(server) => {
            update({
              servers: [
                ...value.servers.filter((item) => item.id !== (editor.id || server.id)),
                server,
              ],
            });
            setEditor(null);
            setError(null);
          }}
        />
      )}
    </section>
  );
}

function ServerEditor({
  initial,
  existing,
  onClose,
  onSave,
}: {
  initial: string;
  existing: boolean;
  onClose: () => void;
  onSave: (value: CodeServerOverride) => void;
}) {
  const [value, setValue] = useState(() => decodeEditor(initial));
  const [args, setArgs] = useState(value.args?.join("\n") ?? "");
  const [extensions, setExtensions] = useState(value.extensions?.join(", ") ?? "");
  const [markers, setMarkers] = useState(value.rootMarkers?.join(", ") ?? "");
  const [settings, setSettings] = useState(JSON.stringify(value.settings ?? {}, null, 2));
  const [initialization, setInitialization] = useState(
    JSON.stringify(value.initializationOptions ?? {}, null, 2),
  );
  const [error, setError] = useState<string | null>(null);
  const list = (text: string) =>
    text
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  function submit() {
    try {
      onSave(
        decodeOverride({
          id: value.id,
          enabled: value.enabled,
          ...(value.command?.trim() ? { command: value.command.trim() } : {}),
          ...(args ? { args: args.split("\n") } : {}),
          ...(extensions ? { extensions: list(extensions) } : {}),
          ...(markers ? { rootMarkers: list(markers) } : {}),
          settings: decodeOptions(settings),
          initializationOptions: decodeOptions(initialization),
        }),
      );
    } catch {
      setError("Check the server identifier and advanced JSON settings.");
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {existing ? "Configure language server" : "Custom language server"}
          </DialogTitle>
          <DialogDescription>
            Use a command available on this environment. Leave optional fields empty to use the
            server defaults.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <label className="block space-y-1.5 text-sm">
            Server identifier
            <Input
              value={value.id}
              disabled={existing}
              onChange={(event) => setValue({ ...value, id: event.target.value })}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.enabled}
              onChange={(event) => setValue({ ...value, enabled: event.target.checked })}
            />
            Enabled for this scope
          </label>
          <label className="block space-y-1.5 text-sm">
            Command
            <Input
              value={value.command ?? ""}
              placeholder="Use the managed installation"
              onChange={(event) => setValue({ ...value, command: event.target.value })}
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            Arguments <span className="text-xs text-muted-foreground">(one per line)</span>
            <Textarea
              className="min-h-16 font-mono text-xs"
              value={args}
              onChange={(event) => setArgs(event.target.value)}
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            File extensions
            <Input
              placeholder=".ts, .tsx"
              value={extensions}
              onChange={(event) => setExtensions(event.target.value)}
            />
          </label>
          <details>
            <summary className="cursor-pointer text-sm">Advanced settings</summary>
            <div className="mt-3 space-y-3">
              <label className="block space-y-1.5 text-sm">
                Project root markers
                <Input
                  placeholder="package.json, tsconfig.json"
                  value={markers}
                  onChange={(event) => setMarkers(event.target.value)}
                />
              </label>
              <label className="block space-y-1.5 text-sm">
                Server settings (JSON)
                <Textarea
                  className="min-h-24 font-mono text-xs"
                  value={settings}
                  onChange={(event) => setSettings(event.target.value)}
                />
              </label>
              <label className="block space-y-1.5 text-sm">
                Initialization options (JSON)
                <Textarea
                  className="min-h-24 font-mono text-xs"
                  value={initialization}
                  onChange={(event) => setInitialization(event.target.value)}
                />
              </label>
            </div>
          </details>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>Use configuration</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
