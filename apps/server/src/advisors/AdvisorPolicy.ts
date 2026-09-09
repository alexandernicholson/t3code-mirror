import {
  advisorScopeKey,
  type AdvisorConfiguration,
  type AdvisorDefinition,
  type OrchestrationEvent,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";

export function resolveAdvisors(
  configurations: readonly AdvisorConfiguration[],
  thread: Pick<OrchestrationThreadShell, "id" | "projectId">,
) {
  const byScope = new Map(configurations.map((value) => [advisorScopeKey(value.scope), value]));
  const layers = [
    byScope.get("environment"),
    byScope.get(`project:${thread.projectId}`),
    byScope.get(`thread:${thread.id}`),
  ].filter((value) => value !== undefined);
  const definitions = new Map<string, AdvisorDefinition>();
  let ids: readonly string[] = [];
  for (const layer of layers) {
    for (const definition of layer.definitions) definitions.set(definition.id, definition);
    if (layer.advisorIds !== null) ids = layer.advisorIds;
  }
  return {
    definitions: ids.flatMap((id) => (definitions.has(id) ? [definitions.get(id)!] : [])),
    layers,
    paused: layers.some((layer) => layer.paused),
  };
}

export function advisorSourceText(event: OrchestrationEvent): string | null {
  if (event.type === "thread.message-sent") {
    if (event.payload.messageId.startsWith("advisor:")) return null;
    if (event.payload.streaming || !event.payload.text.trim()) return null;
    return `${event.payload.role}: ${event.payload.text}`;
  }
  if (event.type === "thread.activity-appended") {
    if (event.payload.activity.kind.startsWith("advisor")) return null;
    // Usage and checkpoint bookkeeping add no new work for a reviewer to inspect.
    if (
      event.payload.activity.kind === "context-window.updated" ||
      event.payload.activity.kind === "checkpoint.captured"
    )
      return null;
    return `${event.payload.activity.kind}: ${event.payload.activity.summary}\n${JSON.stringify(event.payload.activity.payload).slice(0, 12_000)}`;
  }
  return null;
}

export function advisorMayGuide(thread: OrchestrationThreadShell): boolean {
  return (
    thread.session?.status === "running" &&
    thread.session.activeTurnId !== null &&
    thread.latestTurn?.state === "running" &&
    thread.interactionMode !== "plan" &&
    thread.archivedAt === null
  );
}
