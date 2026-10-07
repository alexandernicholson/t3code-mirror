import {
  EventId,
  TurnId,
  type OrchestrationThreadActivity,
  type OrchestrationV2ThreadProjection,
  type QueuedTurn,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

/** Present V2 queue records to the fork's message restore and send controls. */
export function forkThreadQueue(projection: OrchestrationV2ThreadProjection | null | undefined) {
  if (!projection) return undefined;
  const messages = new Map(projection.messages.map((message) => [message.id, message]));
  const runs = projection.runs
    .filter((run) => run.status === "queued")
    .sort((a, b) => (a.queuePosition ?? a.ordinal) - (b.queuePosition ?? b.ordinal));
  return {
    paused: runs.some((run) => run.queueHeld === true),
    items: runs.flatMap((run): QueuedTurn[] => {
      const message = messages.get(run.userMessageId);
      return message === undefined
        ? []
        : [
            {
              messageId: message.id,
              text: message.text,
              attachments: message.attachments,
              modelSelection: run.modelSelection,
              runtimeMode: run.runtimeMode ?? projection.thread.runtimeMode,
              interactionMode: run.interactionMode ?? projection.thread.interactionMode,
              createdAt: DateTime.formatIso(run.requestedAt),
            },
          ];
    }),
  };
}

/** Keep process-log and IDE activity views on the persisted V2 timeline. */
export function forkThreadActivities(
  projection: OrchestrationV2ThreadProjection | null | undefined,
): readonly OrchestrationThreadActivity[] {
  if (!projection) return [];
  const nodes = new Map(projection.nodes.map((node) => [node.id, node]));
  const agents = new Set(projection.subagents.map((agent) => agent.id));
  return projection.turnItems.map((item) => {
    if (item.type === "system_notice" && item.forkActivity) return item.forkActivity;
    let owner = item.nodeId;
    const visited = new Set<string>();
    while (owner !== null && !agents.has(owner) && !visited.has(owner)) {
      visited.add(owner);
      owner = nodes.get(owner)?.parentNodeId ?? null;
    }
    const agentId = owner !== null && agents.has(owner) ? owner : undefined;
    return {
      id: EventId.make(item.id),
      createdAt: DateTime.formatIso(item.updatedAt),
      turnId: item.runId === null ? null : TurnId.make(item.runId),
      kind: item.type,
      tone: item.type === "error" ? "error" : "tool",
      summary:
        item.title ||
        (item.type === "system_notice" ? item.message : item.type.replaceAll("_", " ")),
      payload: {
        ...(agentId ? { agentId } : {}),
        detail: "text" in item ? item.text : "output" in item ? JSON.stringify(item.output) : null,
        data: item,
        item,
      },
    };
  });
}
