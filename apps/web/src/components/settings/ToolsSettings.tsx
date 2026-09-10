import { useId, useRef, useState, type ReactNode } from "react";
import { Link, useSearch } from "@tanstack/react-router";
import {
  GlobeIcon,
  InfoIcon,
  PencilIcon,
  PlusIcon,
  PlugIcon,
  TerminalIcon,
  Trash2Icon,
} from "lucide-react";
import * as Schema from "effect/Schema";
import {
  MANAGED_MCP_PROVIDERS,
  ManagedMcpServer,
  ManagedMcpServerName,
  type EnvironmentId,
  type ProjectId,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { useEnvironments, usePrimaryEnvironment } from "~/state/environments";
import { useProjects } from "~/state/entities";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Switch } from "../ui/switch";
import { Checkbox } from "../ui/checkbox";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "../ui/dialog";
import { SettingsPageContainer } from "./settingsLayout";
import { CodeToolsSettings } from "./CodeToolsSettings";

const decodeServerName = Schema.decodeUnknownSync(ManagedMcpServerName);
const decodeServer = Schema.decodeUnknownSync(ManagedMcpServer);
const PROVIDER_LABELS = {
  codex: "Codex",
  claudeAgent: "Claude",
  cursor: "Cursor",
  grok: "Grok",
  antigravity: "Antigravity",
};
const selectClass =
  "h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Project = { readonly id: ProjectId; readonly title: string };

function InfoTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        delay={200}
        render={
          <Button size="icon-micro" variant="ghost-muted" aria-label={label}>
            <InfoIcon className="size-3.5" />
          </Button>
        }
      />
      <TooltipPopup side="top" className="max-w-72">
        {children}
      </TooltipPopup>
    </Tooltip>
  );
}

function ServerEditor({
  name: originalName,
  server,
  projects,
  saving,
  onSave,
  onClose,
}: {
  name: string;
  server: ManagedMcpServer | undefined;
  projects: readonly Project[];
  saving: boolean;
  onSave: (name: string, server: ManagedMcpServer) => Promise<boolean>;
  onClose: () => void;
}) {
  const formId = useId();
  const connection = server?.connection;
  const [name, setName] = useState(originalName);
  const [type, setType] = useState<"http" | "stdio">(connection?.type ?? "http");
  const [url, setUrl] = useState(connection?.type === "http" ? connection.url : "");
  const [token, setToken] = useState(
    connection?.type === "http" ? (connection.bearerTokenEnvVar ?? "") : "",
  );
  const [command, setCommand] = useState(connection?.type === "stdio" ? connection.command : "");
  const [args, setArgs] = useState(connection?.type === "stdio" ? connection.args.join("\n") : "");
  const [envVars, setEnvVars] = useState(
    connection?.type === "stdio" ? connection.envVars.join("\n") : "",
  );
  const [providers, setProviders] = useState(server?.providers ?? [...MANAGED_MCP_PROVIDERS]);
  const [projectIds, setProjectIds] = useState(server?.projectIds ?? []);
  const [allProjects, setAllProjects] = useState(projectIds.length === 0);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!allProjects && projectIds.length === 0) {
      setError("Select at least one project, or choose all projects.");
      return;
    }
    try {
      const validName = decodeServerName(name.trim());
      const next = decodeServer({
        enabled: server?.enabled ?? true,
        connection:
          type === "http"
            ? {
                type,
                url: url.trim(),
                ...(token.trim() ? { bearerTokenEnvVar: token.trim() } : {}),
              }
            : {
                type,
                command: command.trim(),
                args: args === "" ? [] : args.split("\n"),
                envVars: envVars
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
              },
        providers,
        projectIds: allProjects ? [] : projectIds,
      });
      if (await onSave(validName, next)) onClose();
      else setError("Server not saved. Check the connection and try again. Names must be unique.");
    } catch {
      setError(
        "Check the server name, connection details, and provider selection. Use an HTTP(S) URL and environment variable names, not token values.",
      );
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{server ? "Edit MCP server" : "Add MCP server"}</DialogTitle>
          <DialogDescription>Choose how your agents connect to this server.</DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-5">
          <div className="space-y-2 text-sm font-medium">
            <div className="flex items-center gap-1">
              <label htmlFor={`${formId}-name`}>Server name</label>
              <InfoTooltip label="Server name requirements">
                Start with a letter. Use letters, numbers, hyphens or underscores. “t3-code” is
                reserved. Choose a name that isn't already configured in your provider.
              </InfoTooltip>
            </div>
            <Input
              id={`${formId}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!!server || saving}
              placeholder="e.g. team-docs"
              aria-label="Server name"
            />
          </div>
          <label className="block space-y-2 text-sm font-medium">
            Connection
            <select
              className={`${selectClass} block w-full`}
              value={type}
              onChange={(e) => setType(e.target.value as "http" | "stdio")}
              aria-label="Connection type"
              disabled={saving}
            >
              <option value="http">Remote HTTP</option>
              <option value="stdio">Local command (stdio)</option>
            </select>
          </label>
          {type === "http" ? (
            <>
              <label className="block space-y-2 text-sm font-medium">
                Server URL
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/mcp"
                  aria-label="Server URL"
                  disabled={saving}
                />
              </label>
              <div className="space-y-2 text-sm font-medium">
                <div className="flex items-center gap-1">
                  <label htmlFor={`${formId}-token`}>
                    Token variable{" "}
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  </label>
                  <InfoTooltip label="Token variable details">
                    Enter the environment variable name for your bearer token. Set its secret value
                    in Settings → Providers → Environment variables.
                  </InfoTooltip>
                </div>
                <Input
                  id={`${formId}-token`}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="TEAM_MCP_TOKEN"
                  aria-label="Token variable"
                  disabled={saving}
                />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2 text-sm font-medium">
                <div className="flex items-center gap-1">
                  <label htmlFor={`${formId}-command`}>Command</label>
                  <InfoTooltip label="Command details">
                    Runs on this environment’s machine, in the agent’s working directory.
                  </InfoTooltip>
                </div>
                <Input
                  id={`${formId}-command`}
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx"
                  aria-label="Command"
                  disabled={saving}
                />
              </div>
              <label className="block space-y-2 text-sm font-medium">
                Arguments <span className="font-normal text-muted-foreground">(one per line)</span>
                <Textarea
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder={"-y\n@your-team/mcp-server"}
                  aria-label="Arguments"
                  rows={3}
                  disabled={saving}
                />
              </label>
              <div className="space-y-2 text-sm font-medium">
                <div className="flex items-center gap-1">
                  <label htmlFor={`${formId}-variables`}>Environment variables</label>
                  <InfoTooltip label="Environment variable details">
                    Enter one variable name per line. Set values in Settings → Providers →
                    Environment variables.
                  </InfoTooltip>
                </div>
                <Textarea
                  id={`${formId}-variables`}
                  value={envVars}
                  onChange={(e) => setEnvVars(e.target.value)}
                  placeholder="TEAM_API_KEY"
                  aria-label="Environment variables"
                  rows={2}
                  disabled={saving}
                />
              </div>
            </>
          )}
          <fieldset className="space-y-3" disabled={saving}>
            <legend className="text-sm font-medium">Providers</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-3">
              {MANAGED_MCP_PROVIDERS.map((provider) => (
                <label key={provider} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={providers.includes(provider)}
                    onCheckedChange={(checked) =>
                      setProviders(
                        checked
                          ? [...providers, provider]
                          : providers.filter((p) => p !== provider),
                      )
                    }
                  />
                  {PROVIDER_LABELS[provider]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-3" disabled={saving}>
            <legend className="text-sm font-medium">Projects</legend>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={allProjects} onCheckedChange={setAllProjects} />
              All projects, including new projects
            </label>
            {!allProjects && (
              <div className="max-h-36 space-y-3 overflow-y-auto rounded-md border p-3">
                {projects.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Add a project to this environment first.
                  </p>
                )}
                {projects.map((project) => (
                  <label key={project.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={projectIds.includes(project.id)}
                      onCheckedChange={(checked) =>
                        setProjectIds(
                          checked
                            ? [...projectIds, project.id]
                            : projectIds.filter((id) => id !== project.id),
                        )
                      }
                    />
                    {project.title}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void submit()}>
            {saving ? "Saving…" : "Save server"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function ToolsSettings() {
  const search = useSearch({ from: "/settings/tools" });
  const { environments } = useEnvironments();
  const primary = usePrimaryEnvironment();
  const [selectedId, setSelectedId] = useState<EnvironmentId | null>(null);
  const environment = environments.find(
    (e) => e.environmentId === (selectedId ?? search.environment ?? primary?.environmentId),
  );
  return (
    <SettingsPageContainer>
      <div className="space-y-8 py-2">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Tools & MCP servers</h1>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Connect tools to your agents.
            </p>
          </div>
          <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            Environment
            <select
              className={selectClass}
              aria-label="Environment"
              value={environment?.environmentId ?? ""}
              onChange={(e) => {
                const next = environments.find((env) => env.environmentId === e.target.value);
                if (next) setSelectedId(next.environmentId);
              }}
            >
              {!environment && <option value="">Choose an environment</option>}
              {environments.map((env) => (
                <option key={env.environmentId} value={env.environmentId}>
                  {env.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {environment ? (
          <>
            <CodeToolsSettings
              key={`code:${environment.environmentId}`}
              environmentId={environment.environmentId}
            />
            <EnvironmentTools
              key={environment.environmentId}
              environmentId={environment.environmentId}
            />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Connect to an environment to manage its tools.
          </p>
        )}
      </div>
    </SettingsPageContainer>
  );
}

function EnvironmentTools({ environmentId }: { environmentId: EnvironmentId }) {
  const { environments } = useEnvironments();
  const environment = environments.find((e) => e.environmentId === environmentId);
  const settings = environment?.serverConfig?.settings;
  const supported = environment?.serverConfig?.environment.capabilities.managedMcpServers === true;
  const projects = useProjects().filter((p) => p.environmentId === environmentId);
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const persist = useAtomCommand(serverEnvironment.updateSettings, "MCP settings update");
  const servers = settings?.managedMcpServers ?? {};

  async function save(patch: ServerSettingsPatch) {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    try {
      return (await persist({ environmentId, input: { patch } }))._tag === "Success";
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  if (!settings)
    return (
      <p className="text-sm text-muted-foreground">Waiting for this environment’s settings…</p>
    );
  if (!supported)
    return (
      <p className="rounded-lg border p-5 text-sm text-muted-foreground">
        Update this environment’s T3 server to manage MCP servers here.
      </p>
    );

  return (
    <>
      <section id="builtin-tools" className="space-y-3">
        <h2 className="text-sm font-medium">Built-in tools</h2>
        <div className="flex items-center gap-4 rounded-xl border bg-card p-5">
          <div className="rounded-lg border bg-background p-2.5">
            <GlobeIcon className="size-5 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium">T3 browser</h3>
              <Badge variant="secondary">Built in</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Let agents use the in-app browser.</p>
            <Link
              className="mt-2 inline-block text-xs text-muted-foreground underline underline-offset-4"
              to="/settings/projects"
              search={{ machine: environmentId, project: undefined }}
            >
              Manage project overrides
            </Link>
          </div>
          <Switch
            checked={settings.enableAgentBrowserAccess}
            disabled={saving}
            aria-label="Agent browser access"
            onCheckedChange={(enabled) => void save({ enableAgentBrowserAccess: enabled })}
          />
        </div>
      </section>
      <section id="mcp-servers" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <h2 className="text-sm font-medium">
              MCP servers{" "}
              <span className="ml-1 text-muted-foreground">{Object.keys(servers).length}</span>
            </h2>
            <InfoTooltip label="MCP server details">
              <p>
                These servers belong to this environment and work across web, desktop, and mobile.
              </p>
              <p className="mt-2">
                Manage OpenCode, OAuth, and servers configured directly in a provider through that
                provider.
              </p>
            </InfoTooltip>
          </div>
          <Button size="sm" disabled={saving} onClick={() => setEditing("")}>
            <PlusIcon className="size-4" />
            Add server
          </Button>
        </div>
        {Object.keys(servers).length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-12 text-center">
            <div className="mb-4 rounded-xl border bg-muted/40 p-3">
              <PlugIcon className="size-6 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-medium">Connect your first MCP server</h3>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Add a remote service or local command.
            </p>
            <Button className="mt-5" variant="outline" size="sm" onClick={() => setEditing("")}>
              Add MCP server
            </Button>
          </div>
        ) : (
          <div className="divide-y rounded-xl border bg-card">
            {Object.entries(servers).map(([name, server]) => (
              <div key={name} className="flex items-start gap-3 p-4 sm:gap-4 sm:p-5">
                <div className="mt-0.5 rounded-lg border bg-background p-2.5">
                  {server.connection.type === "http" ? (
                    <GlobeIcon className="size-4 text-muted-foreground" />
                  ) : (
                    <TerminalIcon className="size-4 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="break-all text-sm font-medium">{name}</h3>
                    <Badge variant="secondary">{server.enabled ? "Enabled" : "Disabled"}</Badge>
                  </div>
                  <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                    {server.connection.type === "http"
                      ? server.connection.url
                      : server.connection.command}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {server.providers.map((p) => PROVIDER_LABELS[p]).join(", ")}
                    <span className="mx-1.5">·</span>
                    {server.projectIds.length === 0
                      ? "All projects"
                      : `${server.projectIds.length} selected project${server.projectIds.length === 1 ? "" : "s"}`}
                  </p>
                  <div className="mt-2 flex gap-1">
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={saving}
                      onClick={() => setEditing(name)}
                      aria-label={`Edit ${name}`}
                    >
                      <PencilIcon className="size-3" />
                      Edit
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={saving}
                      onClick={() => setRemoving(name)}
                      aria-label={`Remove ${name}`}
                    >
                      <Trash2Icon className="size-3" />
                      Remove
                    </Button>
                  </div>
                </div>
                <Switch
                  className="mt-1"
                  checked={server.enabled}
                  disabled={saving}
                  aria-label={`Enable ${name}`}
                  onCheckedChange={(enabled) =>
                    void save({ managedMcpServers: { [name]: { ...server, enabled } } })
                  }
                />
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <p>Changes apply to new or restarted sessions.</p>
          <InfoTooltip label="When MCP changes apply">
            Existing sessions keep their tools. Enabled servers are configured to connect; the
            provider reports availability when it connects.
          </InfoTooltip>
        </div>
      </section>
      {editing !== null && (
        <ServerEditor
          name={editing}
          server={servers[editing]}
          projects={projects}
          saving={saving}
          onClose={() => setEditing(null)}
          onSave={async (name, server) => {
            if (editing === "" && servers[name]) return false;
            return save({ managedMcpServers: { [name]: server } });
          }}
        />
      )}
      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setRemoving(null);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Remove {removing}?</DialogTitle>
            <DialogDescription>
              New sessions will no longer use this server. You can add it again later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={saving}
              onClick={async () => {
                if (removing && (await save({ managedMcpServers: { [removing]: null } })))
                  setRemoving(null);
              }}
            >
              Remove server
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
