import { SettingsModelPicker } from "./SettingsModelPicker";
import { randomUUID } from "~/lib/utils";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { useState } from "react";
import {
  inheritedAdvisorIds,
  advisorScopeKey,
  emptyAdvisorConfiguration,
  type AdvisorConfiguration,
  type AdvisorDefinition,
  type AdvisorScope,
  type EnvironmentId,
} from "@t3tools/contracts";
import { useEnvironments, usePrimaryEnvironment } from "~/state/environments";
import { useProjects, useThreadShell } from "~/state/entities";
import { serverEnvironment } from "~/state/server";
import { advisors } from "~/state/advisors";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { SettingsPageContainer } from "./settingsLayout";

const fieldClass = "h-9 rounded-md border border-input bg-background px-3 text-sm";
export function AdvisorsSettings() {
  const { environments } = useEnvironments();
  const primary = usePrimaryEnvironment();
  const [selected, setSelected] = useState<EnvironmentId | null>(null);
  const environment =
    environments.find((value) => value.environmentId === (selected ?? primary?.environmentId)) ??
    environments[0];
  return (
    <SettingsPageContainer>
      <div className="space-y-6 py-2">
        <div>
          <h1 className="text-xl font-semibold">Agents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Independent advisors that follow your work and offer a second opinion.
          </p>
        </div>
        <label className="flex max-w-sm flex-col gap-2 text-sm">
          Environment
          <select
            className={fieldClass}
            value={environment?.environmentId ?? ""}
            onChange={(event) => {
              const next = environments.find((value) => value.environmentId === event.target.value);
              if (next) setSelected(next.environmentId);
            }}
          >
            {environments.map((value) => (
              <option key={value.environmentId} value={value.environmentId}>
                {value.label}
              </option>
            ))}
          </select>
        </label>
        {environment ? (
          <AdvisorConfigurationEditor
            key={environment.environmentId}
            environmentId={environment.environmentId}
          />
        ) : (
          <p>Connect an environment to configure advisors.</p>
        )}
      </div>
    </SettingsPageContainer>
  );
}

export function AdvisorConfigurationEditor({
  environmentId,
  fixedScope,
}: {
  environmentId: EnvironmentId;
  fixedScope?: AdvisorScope;
}) {
  const snapshot = useAtomValue(advisors.snapshot({ environmentId, input: {} }));
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const thread = useThreadShell(
    fixedScope?.type === "thread" ? { environmentId, threadId: fixedScope.threadId } : null,
  );
  const save = useAtomCommand(advisors.save);
  const [scope, setScope] = useState<AdvisorScope>(fixedScope ?? { type: "environment" });
  const [draft, setDraft] = useState<AdvisorConfiguration | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!AsyncResult.isSuccess(snapshot))
    return (
      <p className="text-sm text-muted-foreground">
        {AsyncResult.isFailure(snapshot)
          ? "Advisors are unavailable. Update or reconnect this environment."
          : "Loading advisors…"}
      </p>
    );
  const configurations = snapshot.value.configurations;
  const current =
    configurations.find((value) => advisorScopeKey(value.scope) === advisorScopeKey(scope)) ??
    emptyAdvisorConfiguration(scope);
  const value = draft ?? current;
  const inheritedIds = inheritedAdvisorIds(configurations, scope, thread?.projectId);
  const definitions =
    scope.type === "environment"
      ? value.definitions
      : (configurations.find((item) => item.scope.type === "environment")?.definitions ?? []);
  const update = (patch: Partial<AdvisorConfiguration>) => setDraft({ ...value, ...patch });
  const changeDefinition = (id: string, patch: Partial<AdvisorDefinition>) =>
    update({
      definitions: value.definitions.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });
  const providers = config?.providers ?? [];
  const choices = providers
    .filter(
      (provider) =>
        provider.enabled &&
        provider.installed &&
        provider.auth.status !== "unauthenticated" &&
        provider.availability !== "unavailable",
    )
    .flatMap((provider) =>
      provider.models.map((model) => ({
        key: `${provider.instanceId}/${model.slug}`,
        label: `${provider.displayName ?? provider.driver} · ${model.name}`,
        selection: { instanceId: provider.instanceId, model: model.slug },
      })),
    );
  async function persist() {
    setBusy(true);
    setError(null);
    const result = await save({ environmentId, input: value });
    setBusy(false);
    if (result._tag === "Success") setDraft(null);
    else
      setError(
        "Could not save. Settings may have changed on another device; reload and try again.",
      );
  }
  return (
    <div className="space-y-5">
      {!fixedScope && (
        <label className="flex max-w-sm flex-col gap-2 text-sm">
          Apply to
          <select
            className={fieldClass}
            value={advisorScopeKey(scope)}
            onChange={(event) => {
              const project = projects.find((item) => `project:${item.id}` === event.target.value);
              setScope(
                project ? { type: "project", projectId: project.id } : { type: "environment" },
              );
              setDraft(null);
              setEditing(null);
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
      <div className="space-y-2">
        <h2 className="text-sm font-medium">Advisors</h2>
        <p className="text-xs text-muted-foreground">
          Reviews run on this environment and use the selected account. Activity is shared with that
          provider.
        </p>
      </div>
      {scope.type !== "environment" && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.advisorIds === null}
            onChange={(event) => update({ advisorIds: event.target.checked ? null : [] })}
          />
          Use inherited advisors
        </label>
      )}
      {definitions.map((definition) => (
        <div key={definition.id} className="rounded-lg border border-border p-3">
          <div className="flex items-center gap-3">
            <input
              aria-label={`Enable ${definition.name}`}
              type="checkbox"
              disabled={value.advisorIds === null}
              checked={(value.advisorIds ?? inheritedIds).includes(definition.id)}
              onChange={(event) =>
                update({
                  advisorIds: event.target.checked
                    ? [...(value.advisorIds ?? []), definition.id]
                    : (value.advisorIds ?? []).filter((id) => id !== definition.id),
                })
              }
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{definition.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {choices.find(
                  (choice) =>
                    choice.selection.instanceId === definition.modelSelection.instanceId &&
                    choice.selection.model === definition.modelSelection.model,
                )?.label ?? definition.modelSelection.model}{" "}
                · {definition.mode === "guide" ? "Guide automatically" : "Observe only"}
              </div>
            </div>
            {scope.type === "environment" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(editing === definition.id ? null : definition.id)}
              >
                {editing === definition.id ? "Close" : "Edit"}
              </Button>
            )}
          </div>
          {editing === definition.id && (
            <div className="mt-4 grid gap-3">
              <label className="grid gap-1 text-xs">
                Name
                <Input
                  value={definition.name}
                  maxLength={80}
                  onChange={(event) =>
                    changeDefinition(definition.id, { name: event.target.value })
                  }
                />
              </label>
              <div className="grid gap-1 text-xs">
                <span>Account and model</span>
                {config && (
                  <SettingsModelPicker
                    config={config}
                    selection={definition.modelSelection}
                    purpose="advisor"
                    label="Advisor account and model"
                    onChange={(modelSelection) =>
                      changeDefinition(definition.id, { modelSelection })
                    }
                  />
                )}
              </div>
              <label className="grid gap-1 text-xs">
                Behavior
                <select
                  className={fieldClass}
                  value={definition.mode}
                  onChange={(event) =>
                    changeDefinition(definition.id, {
                      mode: event.target.value === "guide" ? "guide" : "observe",
                    })
                  }
                >
                  <option value="guide">Guide automatically during active work</option>
                  <option value="observe">Observe only</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs">
                Review instructions
                <Textarea
                  rows={4}
                  maxLength={16000}
                  value={definition.instructions}
                  onChange={(event) =>
                    changeDefinition(definition.id, { instructions: event.target.value })
                  }
                  placeholder="What should this advisor watch for?"
                />
              </label>
              <Button
                variant="ghost"
                className="justify-self-start text-destructive-foreground"
                onClick={() => {
                  update({
                    definitions: value.definitions.filter((item) => item.id !== definition.id),
                    advisorIds: value.advisorIds?.filter((id) => id !== definition.id) ?? null,
                  });
                  setEditing(null);
                }}
              >
                Remove advisor
              </Button>
            </div>
          )}
        </div>
      ))}
      {scope.type === "environment" && (
        <Button
          variant="outline"
          disabled={!choices[0] || definitions.length >= 12}
          onClick={() => {
            const choice = choices[0];
            if (!choice) return;
            const id = randomUUID();
            update({
              definitions: [
                ...value.definitions,
                {
                  id,
                  name: "General reviewer",
                  modelSelection: choice.selection,
                  instructions:
                    "Watch for correctness, missed requirements, and changes that need verification.",
                  mode: "guide",
                },
              ],
            });
            setEditing(id);
          }}
        >
          Add advisor
        </Button>
      )}
      {scope.type === "environment" && choices.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Set up a provider account before adding an advisor.
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-sm">Project guidance</summary>
        <div className="mt-3 grid gap-3">
          <Textarea
            aria-label="Advisor guidance"
            rows={3}
            maxLength={16000}
            value={value.instructions}
            onChange={(event) => update({ instructions: event.target.value })}
            placeholder="Review priorities for this scope"
          />
          <Input
            aria-label="Workspace guidance file"
            value={value.instructionsFile}
            onChange={(event) => update({ instructionsFile: event.target.value })}
            placeholder="Optional workspace file, e.g. WATCHDOG.md"
          />
        </div>
      </details>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.paused}
          onChange={(event) => update({ paused: event.target.checked })}
        />
        Pause advisors here
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      )}
      {draft && (
        <div className="flex gap-2">
          <Button
            disabled={busy || value.definitions.some((item) => !item.name.trim())}
            onClick={() => void persist()}
          >
            {busy ? "Saving…" : "Save changes"}
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setDraft(null);
              setError(null);
            }}
          >
            Discard changes
          </Button>
        </div>
      )}
    </div>
  );
}
