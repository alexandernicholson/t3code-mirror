import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { useState } from "react";
import {
  secretTargetId,
  type EnvironmentId,
  type SecretMetadata,
  type SecretScope,
} from "@t3tools/contracts";
import { useEnvironments, usePrimaryEnvironment } from "~/state/environments";
import { useProjects } from "~/state/entities";
import { secrets } from "~/state/secrets";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { InfoTooltip } from "../ui/info-tooltip";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { SettingsPageContainer } from "./settingsLayout";

const selectClass = "h-9 rounded-md border border-input bg-background px-3 text-sm";

export function SecretsSettings() {
  const { environments } = useEnvironments();
  const primary = usePrimaryEnvironment();
  const [selectedId, setSelectedId] = useState<EnvironmentId | null>(null);
  const environment = environments.find(
    (entry) => entry.environmentId === (selectedId ?? primary?.environmentId),
  );
  return (
    <SettingsPageContainer>
      <div className="space-y-6 py-2">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Secrets</h1>
            <p className="mt-2 text-sm text-muted-foreground">Manage secrets for your agents.</p>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            Environment
            <select
              className={selectClass}
              value={environment?.environmentId ?? ""}
              onChange={(event) => {
                const next = environments.find(
                  (entry) => entry.environmentId === event.target.value,
                );
                if (next) setSelectedId(next.environmentId);
              }}
            >
              {!environment && <option value="">Choose an environment</option>}
              {environments.map((entry) => (
                <option key={entry.environmentId} value={entry.environmentId}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {environment && (
          <EnvironmentSecrets
            key={environment.environmentId}
            environmentId={environment.environmentId}
          />
        )}
      </div>
    </SettingsPageContainer>
  );
}

function EnvironmentSecrets({ environmentId }: { environmentId: EnvironmentId }) {
  const snapshot = useAtomValue(secrets.snapshot({ environmentId, input: {} }));
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const create = useAtomCommand(secrets.create);
  const update = useAtomCommand(secrets.update);
  const remove = useAtomCommand(secrets.remove);
  const [editing, setEditing] = useState<SecretMetadata | "new" | null>(null);
  const [deleting, setDeleting] = useState<SecretMetadata | null>(null);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [replaceValue, setReplaceValue] = useState(false);
  const [scope, setScope] = useState<SecretScope>({ type: "environment" });
  const [highlySensitive, setHighlySensitive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function edit(entry: SecretMetadata | "new") {
    setEditing(entry);
    setKey(entry === "new" ? "" : entry.key);
    setValue("");
    setReplaceValue(entry === "new");
    setScope(entry === "new" ? { type: "environment" } : entry.scope);
    setHighlySensitive(entry === "new" || entry.highlySensitive);
    setError(null);
  }
  async function save() {
    if (!editing || !key.trim() || busy) return;
    setBusy(true);
    setError(null);
    const result =
      editing === "new"
        ? await create({ environmentId, input: { key: key.trim(), scope, value, highlySensitive } })
        : await update({
            environmentId,
            input: { ...editing, highlySensitive, ...(replaceValue ? { value } : {}) },
          });
    setBusy(false);
    if (result._tag === "Success") {
      setEditing(null);
      setValue("");
    } else setError("Could not save the secret. Refresh and try again.");
  }
  async function deleteEntry(entry: SecretMetadata) {
    if (busy) return;
    setBusy(true);
    const result = await remove({ environmentId, input: entry });
    setBusy(false);
    if (result._tag !== "Success") setError("Could not delete the secret. Refresh and try again.");
    else if (editing !== "new" && editing && secretTargetId(editing) === secretTargetId(entry)) {
      setEditing(null);
      setValue("");
    }
  }
  if (!AsyncResult.isSuccess(snapshot))
    return (
      <p className="text-sm text-muted-foreground">
        {AsyncResult.isFailure(snapshot)
          ? "Secrets are unavailable. Check your connection."
          : "Loading secrets…"}
      </p>
    );
  return (
    <section id="secrets" className="space-y-4">
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words">Delete {deleting?.key}?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (deleting) void deleteEntry(deleting);
                setDeleting(null);
              }}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
      <Button onClick={() => edit("new")} disabled={busy}>
        Add secret
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {editing && (
        <form
          className="space-y-3 rounded-lg border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium">
              {editing === "new" ? "Add secret" : "Edit secret"}
            </h2>
            <InfoTooltip label="Secret settings details">
              Highly sensitive secrets require approval before an agent can read them. Saved values
              stay hidden. Editing a secret revokes its thread access.
            </InfoTooltip>
          </div>
          <label className="block space-y-1 text-sm">
            <span>Key</span>
            <Input
              value={key}
              disabled={editing !== "new" || busy}
              maxLength={200}
              required
              onChange={(event) => setKey(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Scope
            <select
              className={selectClass}
              disabled={editing !== "new" || busy}
              value={scope.type === "environment" ? "" : scope.projectId}
              onChange={(event) => {
                const project = projects.find((entry) => entry.id === event.target.value);
                setScope(
                  project ? { type: "project", projectId: project.id } : { type: "environment" },
                );
              }}
            >
              <option value="">Environment-wide</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
          </label>
          {editing !== "new" && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={replaceValue}
                disabled={busy}
                onChange={(event) => {
                  setReplaceValue(event.target.checked);
                  setValue("");
                }}
              />
              Replace value
            </label>
          )}
          {replaceValue && (
            <label className="block space-y-1 text-sm">
              <span>Value</span>
              <Input
                type="password"
                autoComplete="off"
                value={value}
                maxLength={65_536}
                disabled={busy}
                onChange={(event) => setValue(event.target.value)}
              />
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={highlySensitive}
              disabled={busy}
              onChange={(event) => setHighlySensitive(event.target.checked)}
            />
            Highly sensitive
          </label>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setEditing(null);
                setValue("");
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      {snapshot.value.entries.length === 0 && (
        <p className="text-sm text-muted-foreground">No secrets yet.</p>
      )}
      {snapshot.value.entries.map((entry) => (
        <div
          key={secretTargetId(entry)}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
        >
          <div>
            <p className="break-all font-mono text-sm">{entry.key}</p>
            <p className="text-xs text-muted-foreground">
              {entry.scope.type === "environment"
                ? "Environment-wide"
                : (projects.find(
                    (project) =>
                      entry.scope.type === "project" && project.id === entry.scope.projectId,
                  )?.title ?? "Project")}{" "}
              · {entry.highlySensitive ? "Highly sensitive" : "No approval required"}
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => edit(entry)}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDeleting(entry)}>
              Delete
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
}
