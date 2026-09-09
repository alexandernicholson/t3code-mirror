import type { TodoItem } from "@t3tools/contracts";

export type TodoEdit =
  | { type: "add"; id: string; content: string; phase?: string }
  | { type: "edit"; id: string; content: string; phase: string }
  | { type: "toggle"; id: string }
  | { type: "delete"; id: string }
  | { type: "move"; id: string; direction: -1 | 1 };

/** Shared user edit semantics for web/desktop and native mobile. */
export function editTodoItems(items: readonly TodoItem[], edit: TodoEdit): readonly TodoItem[] {
  if (edit.type === "add") {
    const content = edit.content.trim();
    return content
      ? [
          ...items,
          { id: edit.id, content, phase: edit.phase?.trim() || "Tasks", status: "pending" },
        ]
      : items;
  }
  const index = items.findIndex((item) => item.id === edit.id);
  if (index < 0) return items;
  if (edit.type === "delete") return items.filter((item) => item.id !== edit.id);
  const next = [...items];
  if (edit.type === "move") {
    const target = index + edit.direction;
    if (target < 0 || target >= items.length) return items;
    [next[index], next[target]] = [next[target]!, next[index]!];
  } else if (edit.type === "toggle") {
    const { blocker: _, ...item } = next[index]!;
    next[index] = { ...item, status: item.status === "completed" ? "pending" : "completed" };
  } else {
    if (!edit.content.trim() || !edit.phase.trim()) return items;
    next[index] = { ...next[index]!, content: edit.content.trim(), phase: edit.phase.trim() };
  }
  return next;
}
