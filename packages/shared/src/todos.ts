import * as Schema from "effect/Schema";
import { TodoItems } from "@t3tools/contracts";
import type { NativeTodoStep, ThreadTodos, TodoItem, TodoOperation } from "@t3tools/contracts";

const encodeItems = Schema.encodeSync(Schema.fromJsonString(TodoItems));

export const emptyTodos: ThreadTodos = { revision: 0, items: [] };

export function validateTodoItems(items: readonly TodoItem[]): string | undefined {
  if (items.length > 500) return "A list can contain at most 500 TODOs.";
  if (new Set(items.map((item) => item.id)).size !== items.length)
    return "TODO IDs must be unique.";
  return undefined;
}

/** OMP's todo operations (can1357/oh-my-pi, 856d9375), adapted to durable IDs.
 * Native/UI lists may contain duplicate titles; agent targeting then requires IDs.
 */
export function applyTodoOperation(state: ThreadTodos, input: TodoOperation): ThreadTodos | string {
  if (input.op === "view") return state;
  let items = state.items.map((item) => ({ ...item }));
  let nextId = 0;
  const makeItem = (content: string, phase: string): TodoItem => ({
    id: `todo:${state.revision + 1}:${nextId++}`,
    content,
    phase,
    status: "pending",
  });
  if (input.op === "init") {
    const phases =
      input.list ?? (input.items ? [{ phase: input.phase ?? "Tasks", items: input.items }] : []);
    if (phases.length === 0 || phases.some((phase) => phase.items.length === 0))
      return "init requires non-empty items or a phased list.";
    if (new Set(phases.map((phase) => phase.phase)).size !== phases.length)
      return "Phase names must be unique.";
    items = phases.flatMap((phase) => phase.items.map((content) => makeItem(content, phase.phase)));
  } else if (input.op === "append") {
    if (!input.items?.length || !input.phase) return "append requires phase and non-empty items.";
    if (
      input.items.some((content) => items.some((item) => item.content === content)) ||
      new Set(input.items).size !== input.items.length
    )
      return "Task content already exists. Use view to find its ID.";
    const phaseEnd = items.findLastIndex((item) => item.phase === input.phase);
    items.splice(
      phaseEnd < 0 ? items.length : phaseEnd + 1,
      0,
      ...input.items.map((content) => makeItem(content, input.phase!)),
    );
  } else {
    const matches = items.filter((item) =>
      input.task
        ? (item.id === input.task || item.content === input.task) &&
          (!input.phase || item.phase === input.phase)
        : input.phase
          ? item.phase === input.phase
          : true,
    );
    if (input.task && matches.length !== 1)
      return "Task is missing or ambiguous. Use view and pass its exact ID.";
    if (input.phase && matches.length === 0) return "Phase not found.";
    if (input.op === "start" && !input.task) return "start requires a task.";
    if (!input.task && !input.phase && (input.op === "block" || input.op === "unblock"))
      return `${input.op} requires task or phase.`;
    if (input.op === "start")
      for (const item of items) {
        if (item.status === "in_progress" && !matches.includes(item)) item.status = "pending";
      }
    if (input.op === "rm") items = items.filter((item) => !matches.includes(item));
    else
      for (const item of matches) {
        if (input.op === "unblock" && item.status !== "blocked") continue;
        if (input.op === "block" && (item.status === "completed" || item.status === "abandoned"))
          continue;
        item.status =
          input.op === "done"
            ? "completed"
            : input.op === "drop"
              ? "abandoned"
              : input.op === "block"
                ? "blocked"
                : input.op === "unblock"
                  ? "pending"
                  : "in_progress";
        delete item.blocker;
        if (input.op === "block" && input.reason) item.blocker = input.reason.replace(/\s+/g, " ");
      }
  }
  if (input.op === "init" && new Set(items.map((item) => item.content)).size !== items.length)
    return "Task content must be unique.";
  const error = validateTodoItems(items);
  if (error) return error;
  // Match OMP: at most one running task; promote the earliest pending task.
  let running = false;
  for (const item of items) {
    if (item.status !== "in_progress") continue;
    if (running) item.status = "pending";
    running = true;
  }
  if (!running) {
    const next = items.find((item) => item.status === "pending");
    if (next) next.status = "in_progress";
  }
  return { ...state, revision: state.revision + 1, items };
}

/** Merge confirmed native snapshots against their previous values, preserving user overrides and removals. */
export function reconcileNativeTodos(
  state: ThreadTodos,
  steps: readonly NativeTodoStep[],
): ThreadTodos {
  const baselineIds = new Set((state.nativeItems ?? []).map((item) => item.id));
  const unmatched = [
    ...(state.nativeItems ?? []),
    ...state.items.filter((item) => !baselineIds.has(item.id)),
  ];
  const nativeItems = steps.map((step, index): TodoItem => {
    const matchIndex = unmatched.findIndex((item) =>
      step.id
        ? item.nativeId === step.id || (!item.nativeId && item.content === step.step)
        : item.content === step.step,
    );
    const match = matchIndex >= 0 ? unmatched.splice(matchIndex, 1)[0] : undefined;
    return {
      id: match?.id ?? `native:${state.revision + 1}:${index}`,
      ...(step.id ? { nativeId: step.id } : {}),
      content: step.step,
      phase: match?.phase ?? "Tasks",
      status: step.status === "inProgress" ? "in_progress" : step.status,
    };
  });
  const previous = new Map((state.nativeItems ?? []).map((item) => [item.id, item]));
  const current = new Map(state.items.map((item) => [item.id, item]));
  const merged: TodoItem[] = [];
  for (const incoming of nativeItems) {
    const base = previous.get(incoming.id);
    const local = current.get(incoming.id);
    if (base && !local) continue; // User removed it; an unchanged native snapshot cannot resurrect it.
    if (!base || !local) {
      merged.push(
        local && state.userEdited
          ? {
              ...local,
              status: local.status === "pending" ? incoming.status : local.status,
              ...(incoming.nativeId ? { nativeId: incoming.nativeId } : {}),
            }
          : incoming,
      );
      continue;
    }
    merged.push({
      ...local,
      ...(incoming.nativeId ? { nativeId: incoming.nativeId } : {}),
      content: local.content === base.content ? incoming.content : local.content,
      status: local.status === base.status ? incoming.status : local.status,
    });
  }
  const incomingIds = new Set(nativeItems.map((item) => item.id));
  for (const local of state.items) {
    if (incomingIds.has(local.id)) continue;
    const base = previous.get(local.id);
    if (
      !base ||
      local.content !== base.content ||
      local.phase !== base.phase ||
      local.status !== base.status ||
      local.blocker !== base.blocker
    )
      merged.push(local);
  }
  const baseOrder = (state.nativeItems ?? [])
    .filter((item) => current.has(item.id))
    .map((item) => item.id);
  const localOrder = state.items.filter((item) => previous.has(item.id)).map((item) => item.id);
  if (
    baseOrder.length !== localOrder.length ||
    baseOrder.some((id, index) => id !== localOrder[index])
  ) {
    const positions = new Map(state.items.map((item, index) => [item.id, index]));
    merged.sort((a, b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity));
  }
  return { ...state, revision: state.revision + 1, items: merged, nativeItems };
}

export function todoAgentContext(todos: ThreadTodos | undefined): string {
  const guidance =
    "Use your native TODO/checklist tool when available. Otherwise use T3's todo MCP tool (OMP-style operations). A request to create TODOs requires a successful tool call; prose alone does not create them.";
  if (!todos) return guidance;
  return `${guidance}\nCurrent T3 TODO list (revision ${todos.revision}):\n${encodeItems(todos.items)}\n${todos.userEdited ? "The user has edited this list. Respect their text, order, statuses and removals; do not recreate removed tasks unless asked." : "Keep this list current as work progresses."}`;
}

/** Preserve provider slash commands verbatim; append checklist context to ordinary messages. */
export function appendTodoContext(message: string, todos: ThreadTodos | undefined): string {
  if (/^\s*\/[\w-]+(?:\s|$)/.test(message)) return message;
  return `${message}\n\n<t3-todos>\n${todoAgentContext(todos)}\n</t3-todos>`;
}
