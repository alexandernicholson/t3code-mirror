import { sourceUpdateLabels as labels } from "./sourceUpdateLabels";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, SourceUpdateAction, SourceUpdatePolicy } from "@t3tools/contracts";
import { useState } from "react";
import { serverEnvironment } from "~/state/server";
import { useEnvironments } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import ChatMarkdown from "./ChatMarkdown";
import { SettingsPageContainer, SettingsSection } from "./settings/settingsLayout";

function SourceUpdateEnvironment({
  environmentId,
  label,
  connected,
}: {
  environmentId: EnvironmentId;
  label: string;
  connected: boolean;
}) {
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const update = useAtomCommand(serverEnvironment.sourceUpdate);
  const save = useAtomCommand(serverEnvironment.updateSettings);
  const status = config?.sourceUpdates;
  const settings = config?.settings.sourceUpdates;
  const [branchDraft, setBranch] = useState<string | null>(null);
  const branch = branchDraft ?? settings?.branch ?? "main";
  const [pending, setPending] = useState(false);
  if (!settings || !status?.supported) return null;
  const act = async (action: SourceUpdateAction["action"]) => {
    setPending(true);
    try {
      await update({
        environmentId,
        input: { action, ...(status.target ? { commit: status.target.commit } : {}) },
      });
    } finally {
      setPending(false);
    }
  };
  const changeSettings = async (patch: Partial<typeof settings>) => {
    setPending(true);
    try {
      await save({ environmentId, input: { patch: { sourceUpdates: { ...settings, ...patch } } } });
    } finally {
      setPending(false);
    }
  };
  const busy =
    pending || !connected || ["building", "checking", "restarting"].includes(status.phase);
  return (
    <SettingsSection title={label}>
      <div className="space-y-4 p-4">
        <p className="text-sm">
          Running <strong>{status.running?.version}</strong> · {status.running?.branch} ·{" "}
          <code>{status.running?.commit.slice(0, 8)}</code>
        </p>
        <label className="flex items-center justify-between gap-4 text-sm">
          Check for updates
          <Switch
            checked={settings.enabled}
            disabled={pending || !connected}
            onCheckedChange={(enabled) => void changeSettings({ enabled })}
          />
        </label>
        <label className="flex flex-wrap items-center justify-between gap-3 text-sm">
          Update policy
          <select
            aria-label={`Update policy for ${label}`}
            className="rounded-md border bg-background px-3 py-2"
            value={settings.policy}
            disabled={pending || !connected}
            onChange={(event) =>
              void changeSettings({ policy: event.target.value as SourceUpdatePolicy })
            }
          >
            <option value="automatic">Automatically download, install, and restart</option>
            <option value="manual-restart">Automatically prepare; restart manually</option>
            <option value="notify">Notify only</option>
          </select>
        </label>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void changeSettings({ branch: branch.trim() });
          }}
        >
          <label className="text-sm" htmlFor={`update-branch-${environmentId}`}>
            Branch
          </label>
          <Input
            id={`update-branch-${environmentId}`}
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            disabled={pending || !connected}
          />
          <Button
            type="submit"
            size="sm"
            disabled={pending || !connected || !branch.trim() || branch === settings.branch}
          >
            Follow branch
          </Button>
        </form>
        <div role="status" aria-live="polite" className="space-y-1 text-sm">
          <p>
            {labels[status.phase]}
            {status.target && status.phase !== "idle"
              ? ` · ${status.target.version} (${status.target.commit.slice(0, 8)})`
              : ""}
          </p>
          {status.message ? (
            <p className={status.phase === "failed" ? "text-destructive" : "text-muted-foreground"}>
              {status.message}
            </p>
          ) : null}
          {status.lastCheckedAt ? (
            <p className="text-xs text-muted-foreground">
              Last checked {new Date(status.lastCheckedAt).toLocaleString()}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !settings.enabled}
            onClick={() => void act("check")}
          >
            Check now
          </Button>
          {status.target && ["available", "failed"].includes(status.phase) ? (
            <Button
              size="sm"
              disabled={busy || !settings.enabled}
              onClick={() => void act("prepare")}
            >
              Prepare update
            </Button>
          ) : null}
          {status.target && ["ready", "waiting"].includes(status.phase) ? (
            <>
              <Button
                size="sm"
                disabled={busy || !settings.enabled}
                onClick={() => void act("restart")}
              >
                Restart to update
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void act("discard")}
              >
                Defer this build
              </Button>
            </>
          ) : null}
        </div>
        {status.target || status.installedNotes ? (
          <details
            className="rounded-md border p-3"
            open={status.phase === "available" || status.phase === "ready"}
          >
            <summary className="cursor-pointer text-sm font-medium">
              {status.outcome === "committed" ? "What changed" : "Changes in this update"}
            </summary>
            {status.target?.divergent ? (
              <p className="my-2 text-sm text-muted-foreground">
                This branch has different history. These are the target branch’s release notes.
              </p>
            ) : null}
            {status.target?.compareUrl ? (
              <a
                href={status.target.compareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-sm underline"
              >
                Compare commits
              </a>
            ) : null}
            <div className="mt-3">
              <ChatMarkdown
                text={status.target?.notes ?? status.installedNotes ?? ""}
                cwd={undefined}
              />
            </div>
          </details>
        ) : null}
      </div>
    </SettingsSection>
  );
}

export function SourceUpdatesSettings() {
  const { environments } = useEnvironments();
  return (
    <SettingsPageContainer>
      <p className="mb-4 text-sm text-muted-foreground">
        Updates run on each Linux host, including when no clients are connected. Automatic restarts
        wait for active work to finish. Choose the source-service installation for environments you
        want to update here.
      </p>
      {environments.map((environment) => (
        <SourceUpdateEnvironment
          key={environment.environmentId}
          environmentId={environment.environmentId}
          label={environment.label}
          connected={environment.connection.phase === "connected"}
        />
      ))}
    </SettingsPageContainer>
  );
}
