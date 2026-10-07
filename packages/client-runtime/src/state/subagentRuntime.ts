/**
 * Subagent status helpers shared by web and mobile, and the runtime shape the
 * web agent rows render.
 */
import * as DateTime from "effect/DateTime";
import type {
  OrchestrationThreadActivity,
  OrchestrationV2Subagent,
  ThreadId,
} from "@t3tools/contracts";
import { isOrchestrationV2WorkActive } from "@t3tools/contracts";

export type RuntimeSubagentStatus =
  | "pending"
  | "running"
  | "waiting"
  | "idle"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface SubagentUsage {
  readonly totalTokens: number;
  readonly inputTokens?: number | undefined;
  readonly cachedInputTokens?: number | undefined;
  readonly outputTokens?: number | undefined;
  readonly reasoningOutputTokens?: number | undefined;
  readonly toolUses?: number | undefined;
  readonly durationMs?: number | undefined;
}

export interface SubagentActivityEntry {
  readonly at: string;
  readonly summary: string;
}

export interface SubagentTranscriptEntry {
  readonly id: string;
  readonly at: string;
  readonly kind: string;
  readonly tone: OrchestrationThreadActivity["tone"];
  readonly summary: string;
  readonly detail: string | null;
  readonly data: unknown;
}

export interface SubagentWorkflowPhase {
  readonly index: number;
  readonly title: string;
}

export interface SubagentRunHandles {
  readonly runId?: string | undefined;
  readonly scriptPath?: string | undefined;
  readonly transcriptDir?: string | undefined;
  readonly sessionUrl?: string | undefined;
}

export interface RuntimeSubagent {
  readonly childThreadId?: ThreadId | null | undefined;
  readonly id: string;
  readonly kind: "subagent" | "subagent_batch" | "workflow" | "workflow_agent";
  readonly title: string;
  readonly role: string | null;
  readonly model: string | null;
  readonly effort: string | null;
  readonly status: RuntimeSubagentStatus;
  readonly activationCount: number;
  readonly usage: SubagentUsage | null;
  readonly progress: string | null;
  readonly lastToolName: string | null;
  readonly result: string | null;
  readonly error: string | null;
  readonly outputFile: string | null;
  readonly parentAgentId: string | null;
  readonly agentIndex: number | null;
  readonly phaseIndex: number | null;
  readonly phaseTitle: string | null;
  readonly attempt: number | null;
  readonly workflowName: string | null;
  readonly phases: ReadonlyArray<SubagentWorkflowPhase>;
  readonly runHandles: SubagentRunHandles | null;
  readonly recentActivity: ReadonlyArray<SubagentActivityEntry>;
  /** First retained observation, used as the roster's stable display order. */
  readonly firstSeenAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly updatedAt: string;
}

const TERMINAL_STATUSES: ReadonlySet<RuntimeSubagentStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export function isTerminalSubagentStatus(status: RuntimeSubagentStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Active = the user may still need to care while it runs. Idle is settled-ish
 * but resumable; waiting counts as active because it needs the user. */
export function isActiveSubagentStatus(status: RuntimeSubagentStatus): boolean {
  return isOrchestrationV2WorkActive(status);
}

/**
 * Projects orchestration-v2 subagent entities into the runtime shape the web
 * agent rows render.
 */
export function projectedSubagentsToRuntime(
  subagents: ReadonlyArray<{
    readonly id: string;
    readonly title: string | null;
    readonly prompt: string;
    readonly model: string | null;
    readonly status: OrchestrationV2Subagent["status"];
    readonly progress?: string | undefined;
    readonly result: string | null;
    readonly startedAt: DateTime.Utc | null;
    readonly completedAt: DateTime.Utc | null;
    readonly updatedAt: DateTime.Utc;
    readonly childThreadId?: ThreadId | null | undefined;
    readonly usage?: SubagentUsage | undefined;
    readonly effort?: string | undefined;
    readonly role?: string | undefined;
    readonly lastToolName?: string | undefined;
    readonly outputFile?: string | undefined;
  }>,
): ReadonlyArray<RuntimeSubagent> {
  return subagents.map((subagent) => {
    const updatedAt = DateTime.formatIso(subagent.updatedAt);
    const startedAt = subagent.startedAt === null ? null : DateTime.formatIso(subagent.startedAt);
    return {
      id: subagent.id,
      kind: "subagent" as const,
      title:
        subagent.title ??
        (subagent.prompt.length > 80 ? `${subagent.prompt.slice(0, 77)}...` : subagent.prompt),
      childThreadId: subagent.childThreadId ?? null,
      role: subagent.role ?? null,
      model: subagent.model,
      effort: subagent.effort ?? null,
      status: subagent.status,
      activationCount: 1,
      usage: subagent.usage ?? null,
      progress: subagent.progress ?? null,
      lastToolName: subagent.lastToolName ?? null,
      result: subagent.result,
      error: subagent.status === "failed" ? (subagent.result ?? null) : null,
      outputFile: subagent.outputFile ?? null,
      parentAgentId: null,
      agentIndex: null,
      phaseIndex: null,
      phaseTitle: null,
      attempt: null,
      workflowName: null,
      phases: [],
      runHandles: null,
      recentActivity: [],
      firstSeenAt: startedAt ?? updatedAt,
      startedAt,
      completedAt: subagent.completedAt === null ? null : DateTime.formatIso(subagent.completedAt),
      updatedAt,
    } satisfies RuntimeSubagent;
  });
}

function transcriptPayload(activity: OrchestrationThreadActivity): Record<string, unknown> {
  return activity.payload !== null && typeof activity.payload === "object"
    ? (activity.payload as Record<string, unknown>)
    : {};
}

/**
 * Selects the durable process log for one agent from the parent thread's
 * normalized activity stream. Provider adapters already stamp child-owned
 * tools with agentId and child lifecycle/progress with taskId, so this stays
 * provider-neutral and automatically includes new provider item types.
 */
export function selectSubagentTranscript(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  agentId: string,
): ReadonlyArray<SubagentTranscriptEntry> {
  const rows: SubagentTranscriptEntry[] = [];
  for (const activity of activities) {
    const payload = transcriptPayload(activity);
    const ownsActivity = payload.agentId === agentId || payload.taskId === agentId;
    const isChildAgent = payload.parentAgentId === agentId;
    if (!ownsActivity && !isChildAgent) continue;

    const detail =
      typeof payload.detail === "string"
        ? payload.detail
        : typeof payload.summary === "string"
          ? payload.summary
          : null;
    rows.push({
      id: String(activity.id),
      at: activity.createdAt,
      kind: activity.kind,
      tone: activity.tone,
      summary: activity.summary,
      detail,
      data: payload.data,
    });
  }
  return [...rows].sort((left, right) => left.at.localeCompare(right.at));
}

export {
  deriveAgentPanelModel,
  emptyAgentPanelModel,
  foldSubagentActivities,
  formatSubagentModelLabel,
  formatSubagentTokenCount,
  type AgentPanelModel,
  type AgentPanelWorkflowGroup,
} from "./legacySubagentActivities.ts";
