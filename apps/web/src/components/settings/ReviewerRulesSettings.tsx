import { useAtomValue } from "@effect/atom-react";
import {
  defaultReviewerConfiguration,
  reviewerRuleFileName,
  type EnvironmentId,
  type ModelSelection,
  type ReviewerConfiguration,
  type ReviewerDefinition,
  type ServerConfig,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { ExternalLink, Plus, Sparkles, WandSparkles, X } from "lucide-react";
import { useState } from "react";
import { randomUUID } from "~/lib/utils";
import { useProjects } from "~/state/entities";
import { reviewers } from "~/state/reviewers";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { SettingsModelPicker } from "./SettingsModelPicker";

function fallbackModel(config: ServerConfig | null | undefined): ModelSelection | null {
  if (!config) return null;
  if (config.settings.defaultModelSelection) return config.settings.defaultModelSelection;
  const provider = config.providers.find(
    (candidate) =>
      candidate.enabled &&
      candidate.installed &&
      candidate.auth.status !== "unauthenticated" &&
      candidate.availability !== "unavailable" &&
      candidate.models[0],
  );
  return provider?.models[0]
    ? { instanceId: provider.instanceId, model: provider.models[0].slug }
    : null;
}

export function ReviewerRulesSettings({ environmentId }: { environmentId: EnvironmentId }) {
  const snapshot = useAtomValue(reviewers.snapshot({ environmentId, input: {} }));
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const project = useProjects().find((candidate) => candidate.environmentId === environmentId);
  const save = useAtomCommand(reviewers.save);
  const optimize = useAtomCommand(reviewers.optimize);
  const generateName = useAtomCommand(reviewers.generateName);
  const [draft, setDraft] = useState<ReviewerConfiguration | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "optimize" | "name" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!AsyncResult.isSuccess(snapshot))
    return <p className="text-sm text-muted-foreground">Loading review rule library…</p>;
  const value = draft ?? snapshot.value.configuration;
  const selected = value.definitions.find((rule) => rule.id === selectedId) ?? null;
  const defaultModel = fallbackModel(config);
  const optimizerModel = value.optimizerModelSelection ?? defaultModel;
  const cwd = project?.workspaceRoot ?? null;
  const categories = [...new Set(value.definitions.map((rule) => rule.category))].map(
    (category) => ({
      category,
      rules: value.definitions.filter((rule) => rule.category === category),
    }),
  );
  const update = (patch: Partial<ReviewerConfiguration>) => setDraft({ ...value, ...patch });
  const updateRule = (id: string, patch: Partial<ReviewerDefinition>) =>
    update({
      definitions: value.definitions.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    });

  async function persist() {
    if (!draft) return;
    setBusy("save");
    setError(null);
    const result = await save({ environmentId, input: draft });
    setBusy(null);
    if (result._tag === "Success") setDraft(null);
    else setError("Could not save the rule library. Reload and try again.");
  }

  async function optimizeSelected() {
    if (!selected || !optimizerModel || !cwd) return;
    setBusy("optimize");
    setError(null);
    const result = await optimize({
      environmentId,
      input: { cwd, markdown: selected.prompt, modelSelection: optimizerModel },
    });
    setBusy(null);
    if (result._tag === "Success") updateRule(selected.id, { prompt: result.value.markdown });
    else setError("The selected model could not optimize this rule.");
  }

  async function nameSelected() {
    if (!selected || !cwd) return;
    setBusy("name");
    setError(null);
    const result = await generateName({
      environmentId,
      input: { cwd, markdown: selected.prompt },
    });
    setBusy(null);
    if (result._tag === "Success") updateRule(selected.id, { name: result.value.name });
    else setError("The title-generation model could not name this rule.");
  }

  return (
    <section id="review-rules" className="space-y-4" aria-label="Review rule library">
      <div>
        <h2 className="text-sm font-medium">Review rule library</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Reusable Markdown instructions for focused, on-demand review agents.
        </p>
      </div>
      <div className="grid min-h-[32rem] grid-cols-[minmax(12rem,0.38fr)_minmax(0,1fr)] overflow-hidden rounded-lg border border-border">
        <div className="overflow-auto border-r border-border p-2">
          {categories.map(({ category, rules }) => (
            <div key={category}>
              <div className="px-2 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {category}
              </div>
              {rules.map((rule) => (
                <button
                  key={rule.id}
                  type="button"
                  className={`block w-full rounded px-2 py-1.5 text-left text-xs ${selected?.id === rule.id ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"}`}
                  onClick={() => setSelectedId(rule.id)}
                >
                  <span className="block truncate font-medium">{rule.name}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {reviewerRuleFileName(rule.name, rule.createdAt)}
                  </span>
                </button>
              ))}
            </div>
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="mt-2 w-full justify-start"
            disabled={value.definitions.length >= 64}
            onClick={() => {
              const id = randomUUID();
              const rule: ReviewerDefinition = {
                id,
                name: "Untitled review rule",
                category: "Custom",
                description: "A custom review policy.",
                createdAt: new Date().toISOString(),
                modelSelection: defaultModel,
                prompt:
                  "# Review rule\n\nDescribe what the reviewer must inspect, what evidence it should gather, and what constitutes a material finding.",
              };
              update({ definitions: [...value.definitions, rule] });
              setSelectedId(id);
            }}
          >
            <Plus className="size-3.5" /> Add rule
          </Button>
        </div>
        <div className="min-w-0 overflow-auto p-4">
          {selected ? (
            <div className="space-y-3">
              <div className="flex items-end gap-2">
                <label className="grid min-w-0 flex-1 gap-1 text-xs">
                  Rule name
                  <Input
                    value={selected.name}
                    maxLength={80}
                    onChange={(event) => updateRule(selected.id, { name: event.target.value })}
                  />
                </label>
                <Button
                  size="icon"
                  variant="outline"
                  title="Generate name with the title model"
                  aria-label="Generate rule name with the title model"
                  disabled={busy !== null || !cwd || !selected.prompt.trim()}
                  onClick={() => void nameSelected()}
                >
                  <WandSparkles className="size-3.5" />
                </Button>
              </div>
              <p className="font-mono text-[10px] text-muted-foreground">
                {reviewerRuleFileName(selected.name, selected.createdAt)}
              </p>
              <label className="grid gap-1 text-xs">
                Category
                <Input
                  value={selected.category}
                  maxLength={80}
                  onChange={(event) => updateRule(selected.id, { category: event.target.value })}
                />
              </label>
              <label className="grid gap-1 text-xs">
                Description
                <Input
                  value={selected.description}
                  maxLength={240}
                  onChange={(event) => updateRule(selected.id, { description: event.target.value })}
                />
              </label>
              {config && (selected.modelSelection ?? defaultModel) && (
                <div className="grid gap-1 text-xs">
                  <span>Review account and model</span>
                  <SettingsModelPicker
                    config={config}
                    selection={(selected.modelSelection ?? defaultModel)!}
                    purpose="advisor"
                    label={`${selected.name} account and model`}
                    onChange={(modelSelection) => updateRule(selected.id, { modelSelection })}
                  />
                </div>
              )}
              <label className="grid gap-1 text-xs">
                Rule Markdown
                <Textarea
                  className="min-h-80 font-mono text-xs"
                  value={selected.prompt}
                  maxLength={16000}
                  onChange={(event) => updateRule(selected.id, { prompt: event.target.value })}
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null || !optimizerModel || !cwd || !selected.prompt.trim()}
                  onClick={() => void optimizeSelected()}
                >
                  <Sparkles className="size-3.5" />
                  {busy === "optimize" ? "Optimizing…" : "AI-optimize"}
                </Button>
                {selected.sourceUrl && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => window.open(selected.sourceUrl, "_blank", "noopener,noreferrer")}
                  >
                    <ExternalLink className="size-3.5" /> Source
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto text-destructive-foreground"
                  onClick={() => {
                    update({
                      definitions: value.definitions.filter((rule) => rule.id !== selected.id),
                    });
                    setSelectedId(null);
                  }}
                >
                  <X className="size-3.5" /> Delete
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a rule to edit its Markdown and model.
            </div>
          )}
        </div>
      </div>
      {optimizerModel && config && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span>AI optimization model</span>
          <SettingsModelPicker
            config={config}
            selection={optimizerModel}
            purpose="advisor"
            label="Rule optimization account and model"
            onChange={(modelSelection) => update({ optimizerModelSelection: modelSelection })}
          />
        </div>
      )}
      {error && <p className="text-xs text-destructive-foreground">{error}</p>}
      {draft && (
        <div className="flex gap-2">
          <Button size="sm" disabled={busy !== null} onClick={() => void persist()}>
            {busy === "save" ? "Saving…" : "Save library"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => {
              setDraft(null);
              setError(null);
            }}
          >
            Discard
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() =>
              setDraft({ ...defaultReviewerConfiguration(), revision: value.revision })
            }
          >
            Restore defaults
          </Button>
        </div>
      )}
    </section>
  );
}
