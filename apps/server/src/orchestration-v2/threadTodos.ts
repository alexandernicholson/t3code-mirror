import type { OrchestrationV2Command, ThreadTodos } from "@t3tools/contracts";
import {
  applyTodoOperation,
  emptyTodos,
  reconcileNativeTodos,
  validateTodoItems,
} from "@t3tools/shared/todos";

type TodoUpdate = NonNullable<
  Extract<OrchestrationV2Command, { type: "thread.metadata.update" }>["todoUpdate"]
>;

/** Apply a checklist mutation inside the thread's serialized command transaction. */
export function updateThreadTodos(
  current: ThreadTodos = emptyTodos,
  update: TodoUpdate,
): ThreadTodos | string {
  if (update.type === "edit") {
    if (update.expectedRevision !== current.revision)
      return "TODOs changed on another client or by the agent. Reload the list and retry.";
    const error = validateTodoItems(update.items);
    return (
      error ?? { ...current, revision: current.revision + 1, items: update.items, userEdited: true }
    );
  }
  const result =
    update.type === "tool"
      ? applyTodoOperation(current, update.operation)
      : reconcileNativeTodos(current, update.steps);
  return typeof result === "string" ? result : (validateTodoItems(result.items) ?? result);
}
