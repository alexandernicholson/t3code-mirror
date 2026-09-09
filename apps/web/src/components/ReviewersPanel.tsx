import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  ModelSelection,
  ReviewerFinding,
  ServerConfig,
  ThreadId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileDiff,
  Settings2,
} from "lucide-react";
import { useState } from "react";
import { reviewers } from "~/state/reviewers";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "./ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { SettingsModelPicker } from "./settings/SettingsModelPicker";

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

export function ReviewersPanel({
  environmentId,
  threadId,
  onFixFindings,
  onOpenFinding,
  onOpenChanges,
  onOpenRules,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  onFixFindings: (findings: readonly ReviewerFinding[]) => void;
  onOpenFinding: (finding: ReviewerFinding) => void;
  onOpenChanges: () => void;
  onOpenRules: () => void;
}) {
  const snapshot = useAtomValue(reviewers.snapshot({ environmentId, input: { threadId } }));
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const action = useAtomCommand(reviewers.action);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [depth, setDepth] = useState<"quick" | "deep">("quick");
  const [modelOverride, setModelOverride] = useState<{
    environmentId: EnvironmentId;
    threadId: ThreadId;
    selection: ModelSelection;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestedIssueIndex, setIssueIndex] = useState(0);
  const [showDismissed, setShowDismissed] = useState(false);

  const value = AsyncResult.isSuccess(snapshot) ? snapshot.value : null;
  const rules = value?.configuration.definitions ?? [];
  const selectedRule = rules.find((rule) => rule.id === selectedRuleId) ?? rules[0] ?? null;
  const selectedModel =
    (modelOverride?.environmentId === environmentId && modelOverride.threadId === threadId
      ? modelOverride.selection
      : null) ??
    selectedRule?.modelSelection ??
    fallbackModel(config);
  const latestRun = value?.runs[0] ?? null;
  const latestFindings = (value?.findings ?? []).filter(
    (finding) => finding.runId === latestRun?.id,
  );
  const activeFindings = latestFindings.filter((finding) => !finding.dismissed);
  const dismissedFindings = latestFindings.filter((finding) => finding.dismissed);
  const findings = showDismissed ? dismissedFindings : activeFindings;
  const issueIndex = Math.min(requestedIssueIndex, Math.max(findings.length - 1, 0));

  if (!value)
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {AsyncResult.isFailure(snapshot)
          ? "Reviewers are unavailable. Update or reconnect this environment."
          : "Loading reviewers…"}
      </div>
    );

  async function runReview() {
    if (!selectedRule || !selectedModel) return;
    setBusy(true);
    setError(null);
    const result = await action({
      environmentId,
      input: {
        action: "run",
        threadId,
        reviewerId: selectedRule.id,
        modelSelection: selectedModel,
        depth,
      },
    });
    setBusy(false);
    if (result._tag !== "Success") setError("Could not start this review. Check its model.");
  }

  async function dismiss(finding: ReviewerFinding) {
    const result = await action({
      environmentId,
      input: { action: "dismiss", threadId, findingId: finding.id },
    });
    if (result._tag !== "Success") setError("Could not dismiss this finding.");
  }

  async function restore(finding: ReviewerFinding) {
    const result = await action({
      environmentId,
      input: { action: "restore", threadId, findingId: finding.id },
    });
    if (result._tag !== "Success") setError("Could not restore this finding.");
  }

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Reviewers">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <ClipboardCheck className="size-4" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
          Review: {latestRun?.reviewerName ?? selectedRule?.name ?? "Local changes"}
        </h2>
        <Button
          size="icon-sm"
          variant="ghost"
          title="Review rule library"
          aria-label="Open review rule library"
          onClick={onOpenRules}
        >
          <Settings2 className="size-3.5" />
        </Button>
      </header>
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5 text-xs">
        <Button size="xs" variant="ghost" onClick={onOpenChanges}>
          <FileDiff className="size-3" /> All changes
        </Button>
        <span className="rounded bg-muted px-2 py-1">
          {activeFindings.length} {activeFindings.length === 1 ? "issue" : "issues"} found
        </span>
        {dismissedFindings.length > 0 && (
          <Button
            size="xs"
            variant={showDismissed ? "secondary" : "ghost"}
            onClick={() => {
              setShowDismissed(!showDismissed);
              setIssueIndex(0);
            }}
          >
            {dismissedFindings.length} dismissed
          </Button>
        )}
        <span className="ml-auto flex items-center gap-0.5 text-muted-foreground">
          <Button
            size="icon-micro"
            variant="ghost"
            aria-label="Previous review issue"
            disabled={issueIndex === 0}
            onClick={() => setIssueIndex(issueIndex - 1)}
          >
            <ChevronLeft />
          </Button>
          {findings.length ? `${issueIndex + 1}/${findings.length}` : "0/0"}
          <Button
            size="icon-micro"
            variant="ghost"
            aria-label="Next review issue"
            disabled={issueIndex >= findings.length - 1}
            onClick={() => setIssueIndex(issueIndex + 1)}
          >
            <ChevronRight />
          </Button>
        </span>
      </div>
      <div className="flex items-center gap-1 border-b border-border p-2">
        <Menu>
          <MenuTrigger
            render={
              <Button size="sm" variant="outline" className="min-w-0 flex-1 justify-between">
                <span className="truncate">{selectedRule?.name ?? "Choose rule"}</span>
                <ChevronDown className="size-3" />
              </Button>
            }
          />
          <MenuPopup className="max-h-80 min-w-64 overflow-auto">
            {rules.map((rule) => (
              <MenuItem key={rule.id} onClick={() => setSelectedRuleId(rule.id)}>
                <span className="min-w-0 flex-1 truncate">{rule.name}</span>
                {selectedRule?.id === rule.id && <Check className="size-3.5" />}
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
        <select
          aria-label="Review depth"
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          value={depth}
          onChange={(event) => setDepth(event.target.value === "deep" ? "deep" : "quick")}
        >
          <option value="quick">Quick</option>
          <option value="deep">Deep</option>
        </select>
        <Button
          size="sm"
          disabled={busy || latestRun?.status === "running" || !selectedModel}
          onClick={() => void runReview()}
        >
          {latestRun?.status === "running" || busy ? "Reviewing…" : "Find issues"}
        </Button>
      </div>
      {config && selectedModel && (
        <fieldset
          disabled={busy || latestRun?.status === "running"}
          className="border-b border-border p-2"
        >
          <SettingsModelPicker
            config={config}
            selection={selectedModel}
            purpose="advisor"
            label="Reviewer account and model"
            onChange={(selection) => setModelOverride({ environmentId, threadId, selection })}
          />
        </fieldset>
      )}
      {error && <p className="p-3 text-xs text-destructive-foreground">{error}</p>}
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {latestRun?.status === "running" && (
          <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
            Reviewing local changes with full tool access…
          </div>
        )}
        {latestRun?.status === "failed" && (
          <div className="rounded-lg border border-destructive/40 p-4 text-sm">
            {latestRun.error ?? "Review failed."}
          </div>
        )}
        {latestRun?.status === "completed" && activeFindings.length === 0 && !showDismissed && (
          <div className="rounded-lg border border-border p-4 text-sm">
            <p className="font-medium">No material issues found</p>
            <p className="mt-1 text-xs text-muted-foreground">{latestRun.summary}</p>
          </div>
        )}
        {!latestRun && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Choose a rule and review depth, then inspect all local changes.
          </div>
        )}
        {findings.map((finding, index) => (
          <article
            key={finding.id}
            className={`rounded-lg border p-3 ${index === issueIndex ? "border-foreground/30 bg-accent/20" : "border-border"}`}
          >
            <button
              type="button"
              className="w-full text-left"
              onClick={() => onOpenFinding(finding)}
            >
              <div className="flex items-start gap-2">
                <span
                  className={`mt-1 size-2 shrink-0 rounded-full ${finding.severity === "blocker" ? "bg-destructive" : finding.severity === "concern" ? "bg-amber-500" : "bg-muted-foreground"}`}
                />
                <div className="min-w-0">
                  <h3 className="text-sm font-medium">{finding.title}</h3>
                  {finding.filePath && (
                    <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                      {finding.filePath}
                      {finding.line ? `:${finding.line}` : ""}
                    </p>
                  )}
                </div>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                {finding.body}
              </p>
            </button>
            <div className="mt-3 flex gap-2">
              {!finding.dismissed && (
                <Button size="xs" variant="outline" onClick={() => onFixFindings([finding])}>
                  Fix in chat
                </Button>
              )}
              {finding.dismissed ? (
                <Button size="xs" variant="ghost" onClick={() => void restore(finding)}>
                  Restore
                </Button>
              ) : (
                <Button size="xs" variant="ghost" onClick={() => void dismiss(finding)}>
                  Dismiss
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>
      {!showDismissed && activeFindings.length > 1 && (
        <footer className="flex justify-end border-t border-border p-2">
          <Button size="sm" onClick={() => onFixFindings(activeFindings)}>
            Fix all
          </Button>
        </footer>
      )}
    </section>
  );
}
