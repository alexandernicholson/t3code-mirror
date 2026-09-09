import ChatMarkdown from "./ChatMarkdown";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { Eye, Pause, Play, Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  advisorDefinitionsForScope,
  emptyAdvisorConfiguration,
  setAdvisorDefinition,
  type AdvisorConfiguration,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { advisors } from "~/state/advisors";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "./ui/button";
import { AdvisorConfigurationEditor } from "./settings/AdvisorsSettings";
import { SettingsModelPicker } from "./settings/SettingsModelPicker";
import { useThreadShell } from "~/state/entities";
import { serverEnvironment } from "~/state/server";

const labels = {
  watching: "Watching",
  reviewing: "Reviewing",
  "catching-up": "Catching up",
  paused: "Paused",
  unavailable: "Unavailable",
};
type Props = { environmentId: EnvironmentId; threadId: ThreadId };
export function AdvisorIndicator({
  environmentId,
  threadId,
  onOpen,
  panelOpen = false,
}: Props & { onOpen: () => void; panelOpen?: boolean }) {
  const snapshot = useAtomValue(advisors.snapshot({ environmentId, input: { threadId } }));
  const icon = useRef<SVGSVGElement>(null);
  const lastBlink = useRef(0);
  const [seenFindings, setSeenFindings] = useState(0);
  const findingCount = AsyncResult.isSuccess(snapshot) ? snapshot.value.findingCount : 0;
  useEffect(() => {
    if (!panelOpen) return;
    const timeout = window.setTimeout(() => setSeenFindings(findingCount), 0);
    return () => window.clearTimeout(timeout);
  }, [panelOpen, findingCount]);
  const states = AsyncResult.isSuccess(snapshot) ? snapshot.value.states : [];
  const active = states.some(
    (state) => state.status === "reviewing" || state.status === "catching-up",
  );
  const updatedAt = states.map((state) => state.updatedAt).join(":");
  useEffect(() => {
    if (
      !updatedAt ||
      !active ||
      Date.now() - lastBlink.current < 3000 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    lastBlink.current = Date.now();
    const animation = icon.current?.animate([{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }], {
      duration: 500,
    });
    return () => animation?.cancel();
  }, [active, updatedAt]);
  if (states.length === 0) return null;
  const label = active
    ? "Reviewing"
    : states.some((state) => state.status === "unavailable")
      ? "Unavailable"
      : states.every((state) => state.status === "paused")
        ? "Paused"
        : "Watching";
  return (
    <Button
      variant="ghost"
      size="sm"
      className="pointer-events-auto gap-1.5"
      title={`Advisors · ${label}`}
      aria-label={`Open advisors · ${label}`}
      onClick={() => {
        setSeenFindings(findingCount);
        onOpen();
      }}
    >
      <Eye ref={icon} className="size-3.5" />
      <span className="hidden text-xs xl:inline">{label}</span>
      {findingCount > seenFindings && !panelOpen && (
        <span className="rounded-full bg-accent px-1 text-[10px] tabular-nums">
          {Math.min(99, findingCount - seenFindings)}
        </span>
      )}
    </Button>
  );
}

export function AdvisorsPanel({ environmentId, threadId }: Props) {
  const thread = useThreadShell({ environmentId, threadId });
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const snapshot = useAtomValue(
    advisors.snapshot({ environmentId, input: { threadId, details: true } }),
  );
  const action = useAtomCommand(advisors.action);
  const save = useAtomCommand(advisors.save);
  const [filter, setFilter] = useState("all");
  const [settings, setSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [following, setFollowing] = useState(true);
  const end = useRef<HTMLDivElement>(null);
  const value = AsyncResult.isSuccess(snapshot) ? snapshot.value : null;
  useEffect(() => {
    if (following && value?.latestEntryId) end.current?.scrollIntoView({ block: "end" });
  }, [value?.latestEntryId, following]);
  async function act(kind: "pause" | "resume" | "address", findingId?: string) {
    setBusy(true);
    setError(null);
    const result = await action({
      environmentId,
      input: { threadId, action: kind, ...(findingId ? { findingId } : {}) },
    });
    setBusy(false);
    if (result._tag !== "Success") setError("Could not update advisors. Reconnect and try again.");
  }
  async function configure(input: AdvisorConfiguration) {
    setBusy(true);
    setError(null);
    const result = await save({ environmentId, input });
    setBusy(false);
    if (result._tag !== "Success")
      setError("Could not save advisor settings. Reload and try again.");
  }
  if (!value)
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {AsyncResult.isFailure(snapshot)
          ? "Advisors are unavailable. Update or reconnect this environment."
          : "Loading advisors…"}
      </div>
    );
  const paused =
    value.states.length > 0 &&
    value.states.every((state) => state.status === "paused" || state.status === "unavailable");
  const scope = { type: "thread", threadId } as const;
  const configuration =
    value.configurations.find(
      (item) => item.scope.type === "thread" && item.scope.threadId === threadId,
    ) ?? emptyAdvisorConfiguration(scope);
  const definitions = advisorDefinitionsForScope(value.configurations, scope, thread?.projectId);
  const inheritedDefinitions = advisorDefinitionsForScope(
    value.configurations.filter((item) => item !== configuration),
    scope,
    thread?.projectId,
  );
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Advisors">
      <header className="flex items-center gap-2 border-b border-border p-3">
        <Eye className="size-4" />
        <h2 className="flex-1 text-sm font-medium">Advisors</h2>
        <Button
          size="icon"
          variant="ghost"
          disabled={busy}
          title={paused ? "Resume advisors" : "Pause advisors"}
          aria-label={paused ? "Resume advisors" : "Pause advisors"}
          onClick={() => void act(paused ? "resume" : "pause")}
        >
          {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          title="Thread advisor settings"
          aria-label="Thread advisor settings"
          onClick={() => setSettings(!settings)}
        >
          <Settings2 className="size-3.5" />
        </Button>
      </header>
      {error && (
        <p role="alert" className="p-3 text-xs text-destructive-foreground">
          {error}
        </p>
      )}
      {settings || value.states.length === 0 ? (
        <div className="overflow-auto p-4">
          <AdvisorConfigurationEditor
            key={threadId}
            environmentId={environmentId}
            fixedScope={{ type: "thread", threadId }}
          />
        </div>
      ) : (
        <>
          {value.states.length > 1 && (
            <select
              aria-label="Filter advisors"
              className="m-3 rounded border border-input bg-background p-2 text-xs"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="all">All advisors</option>
              {value.states.map((state) => (
                <option key={state.advisorId} value={state.advisorId}>
                  {state.name}
                </option>
              ))}
            </select>
          )}
          <div className="max-h-[40%] shrink-0 space-y-3 overflow-y-auto border-b border-border p-3">
            {value.states
              .filter((state) => filter === "all" || state.advisorId === filter)
              .map((state) => {
                const definition = definitions.find((item) => item.id === state.advisorId);
                return (
                  <div key={state.advisorId} className="text-xs">
                    <span className="font-medium">{state.name}</span>
                    <span className="text-muted-foreground"> · {labels[state.status]}</span>
                    {config && definition && (
                      <fieldset disabled={busy} className="mt-2 min-w-0">
                        <SettingsModelPicker
                          config={config}
                          selection={definition.modelSelection}
                          purpose="advisor"
                          label={`${state.name} account and model`}
                          onChange={(modelSelection) => {
                            void configure(
                              setAdvisorDefinition(configuration, {
                                ...definition,
                                modelSelection,
                              }),
                            );
                          }}
                        />
                        {configuration.definitions.some((item) => item.id === state.advisorId) &&
                          inheritedDefinitions.some((item) => item.id === state.advisorId) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="mt-1 text-xs"
                              onClick={() =>
                                void configure({
                                  ...configuration,
                                  definitions: configuration.definitions.filter(
                                    (item) => item.id !== state.advisorId,
                                  ),
                                })
                              }
                            >
                              Use inherited advisor
                            </Button>
                          )}
                      </fieldset>
                    )}
                    {state.reason && <p className="mt-1 text-muted-foreground">{state.reason}</p>}
                  </div>
                );
              })}
          </div>
          <div
            className="flex-1 space-y-3 overflow-auto p-4"
            onScroll={(event) => {
              const el = event.currentTarget;
              setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
            }}
          >
            {value.entries
              .filter((entry) => filter === "all" || entry.advisorId === filter)
              .map((entry) => (
                <article
                  key={entry.id}
                  className={`border-l-2 pl-3 ${entry.severity === "blocker" ? "border-destructive" : entry.severity === "concern" ? "border-amber-500" : "border-border"}`}
                >
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>
                      {entry.advisorName} · {entry.severity ?? entry.kind}
                    </span>
                    <time dateTime={entry.createdAt}>
                      {new Date(entry.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  {entry.kind === "reasoning" ||
                  (entry.kind === "activity" && entry.text.length > 300) ? (
                    <details>
                      <summary className="cursor-pointer text-xs">
                        {entry.kind === "reasoning"
                          ? "Reasoning summary"
                          : entry.text.split("\n")[0]}
                      </summary>
                      <p className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                        {entry.text}
                      </p>
                    </details>
                  ) : (
                    <ChatMarkdown
                      text={entry.text}
                      cwd={undefined}
                      environmentId={environmentId}
                      threadRef={{ environmentId, threadId }}
                      className="text-sm"
                    />
                  )}
                  {entry.kind === "finding" &&
                    !value.entries.some(
                      (other) =>
                        other.findingId === entry.id &&
                        other.kind === "delivery" &&
                        other.text === "Delivered to the agent",
                    ) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        className="mt-1 text-xs"
                        onClick={() => void act("address", entry.id)}
                      >
                        Ask agent to address
                      </Button>
                    )}
                </article>
              ))}
            <div ref={end} />
          </div>
          {!following && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFollowing(true);
                end.current?.scrollIntoView({ block: "end" });
              }}
            >
              Latest activity ↓
            </Button>
          )}
          {value.states.length > 0 && (
            <details className="border-t border-border p-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer">Usage details</summary>
              {value.states.map((state) => (
                <p className="mt-2" key={state.advisorId}>
                  {state.name}: {state.reviewCount} reviews ·{" "}
                  {(state.inputTokens + state.outputTokens).toLocaleString()} tokens · $
                  {state.costUsd.toFixed(4)} reported cost
                </p>
              ))}
            </details>
          )}
        </>
      )}
    </section>
  );
}
