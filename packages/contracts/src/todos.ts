import * as Schema from "effect/Schema";

const TodoText = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(2000),
);
export const TodoStatus = Schema.Literals([
  "pending",
  "in_progress",
  "completed",
  "abandoned",
  "blocked",
]);
export const TodoItem = Schema.Struct({
  id: TodoText,
  content: TodoText,
  phase: TodoText,
  status: TodoStatus,
  blocker: Schema.optional(TodoText),
  nativeId: Schema.optional(TodoText),
});
export type TodoItem = typeof TodoItem.Type;
export const TodoItems = Schema.Array(TodoItem).check(Schema.isMaxLength(500));
export const ThreadTodos = Schema.Struct({
  revision: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  items: TodoItems,
  // Retain the last native snapshot for a three-way merge with manual edits.
  nativeItems: Schema.optional(TodoItems),
  userEdited: Schema.optional(Schema.Boolean),
});
export type ThreadTodos = typeof ThreadTodos.Type;

// OMP's todo operation vocabulary, with stable IDs accepted alongside content.
export const TodoOperation = Schema.Struct({
  op: Schema.Literals([
    "init",
    "start",
    "done",
    "rm",
    "drop",
    "block",
    "unblock",
    "append",
    "view",
  ]),
  list: Schema.optional(
    Schema.Array(Schema.Struct({ phase: TodoText, items: Schema.Array(TodoText) })),
  ),
  task: Schema.optional(TodoText),
  phase: Schema.optional(TodoText),
  items: Schema.optional(Schema.Array(TodoText)),
  reason: Schema.optional(TodoText),
});
export type TodoOperation = typeof TodoOperation.Type;
export const NativeTodoStep = Schema.Struct({
  id: Schema.optional(TodoText),
  step: TodoText,
  status: Schema.Literals(["pending", "inProgress", "completed", "abandoned", "blocked"]),
});
export type NativeTodoStep = typeof NativeTodoStep.Type;
