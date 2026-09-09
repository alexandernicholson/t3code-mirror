import { describe, expect, it } from "vite-plus/test";
import { applyTodoOperation, emptyTodos, reconcileNativeTodos, todoAgentContext } from "./todos.ts";
import type { ThreadTodos, TodoOperation } from "@t3tools/contracts";

function apply(state: ThreadTodos, op: TodoOperation): ThreadTodos {
  const result = applyTodoOperation(state, op);
  if (typeof result === "string") throw new Error(result);
  return result;
}
describe("OMP-style TODO operations", () => {
  it("initializes phases, advances work, and leaves blocked tasks waiting", () => {
    const initialized = apply(emptyTodos, {
      op: "init",
      list: [{ phase: "Build", items: ["Implement", "Verify"] }],
    });
    expect(initialized.items.map((item) => item.status)).toEqual(["in_progress", "pending"]);
    const blocked = apply(initialized, {
      op: "block",
      task: "Implement",
      reason: "Waiting for input",
    });
    expect(blocked.items.map((item) => item.status)).toEqual(["blocked", "in_progress"]);
    const done = apply(blocked, { op: "done", task: "Verify" });
    expect(done.items.map((item) => item.status)).toEqual(["blocked", "completed"]);
    const unblocked = apply(done, { op: "unblock", task: "Implement" });
    expect(unblocked.items[0]?.status).toBe("in_progress");
    expect(unblocked.items[0]?.blocker).toBeUndefined();
    expect(applyTodoOperation(unblocked, { op: "view" })).toBe(unblocked);
  });
  it("rejects ambiguous content without changing state, accepts IDs, and clears explicitly", () => {
    const initialized = apply(emptyTodos, { op: "init", items: ["Test", "Another"] });
    const state = {
      ...initialized,
      items: initialized.items.map((item) => ({ ...item, content: "Test" })),
    };
    expect(applyTodoOperation(state, { op: "done", task: "Test" })).toMatch(/ambiguous/);
    expect(state.items[0]?.status).toBe("in_progress");
    const done = apply(state, { op: "done", task: state.items[0]!.id });
    expect(done.items.map((item) => item.status)).toEqual(["completed", "in_progress"]);
    expect(apply(done, { op: "rm" }).items).toEqual([]);
  });
  it("does not partially apply a rejected operation", () => {
    const state = apply(emptyTodos, { op: "init", items: ["A", "B"] });
    expect(
      typeof applyTodoOperation(state, { op: "append", phase: "Tasks", items: ["New", "A"] }),
    ).toBe("string");
    expect(state.items.map((item) => item.status)).toEqual(["in_progress", "pending"]);
  });
});
it("matches OMP start, whole-list completion and phase blocking semantics", () => {
  const state = apply(emptyTodos, {
    op: "init",
    list: [
      { phase: "One", items: ["A", "B"] },
      { phase: "Two", items: ["C"] },
    ],
  });
  const started = apply(state, { op: "start", task: "B" });
  expect(started.items.map((item) => item.status)).toEqual(["pending", "in_progress", "pending"]);
  const completed = apply(started, { op: "done", task: "A" });
  const blocked = apply(completed, { op: "block", phase: "One" });
  expect(blocked.items.map((item) => item.status)).toEqual(["completed", "blocked", "in_progress"]);
  const unblocked = apply(blocked, { op: "unblock", phase: "One" });
  expect(unblocked.items[0]?.status).toBe("completed");
  expect(apply(unblocked, { op: "done" }).items.every((item) => item.status === "completed")).toBe(
    true,
  );
  expect(typeof applyTodoOperation(emptyTodos, { op: "init", items: ["Same", "Same"] })).toBe(
    "string",
  );
});

describe("native checklist reconciliation", () => {
  it("preserves edits, completion overrides, reordering and deletion across stale native updates", () => {
    const steps = ["A", "B", "C"].map((step) => ({ id: step, step, status: "pending" as const }));
    const native = reconcileNativeTodos(emptyTodos, steps);
    const edited: ThreadTodos = {
      ...native,
      userEdited: true,
      items: [{ ...native.items[1]!, content: "Edited B", status: "completed" }, native.items[0]!],
    };
    const refreshed = reconcileNativeTodos(edited, steps);
    expect(refreshed.items.map((item) => item.content)).toEqual(["Edited B", "A"]);
    expect(refreshed.items[0]?.status).toBe("completed");
    expect(todoAgentContext(refreshed)).toContain(
      "Respect their text, order, statuses and removals",
    );
  });
  it("updates untouched items, retains manual additions, and handles native clear", () => {
    const initial = reconcileNativeTodos(emptyTodos, [{ step: "A", status: "pending" }]);
    const manual: ThreadTodos = {
      ...initial,
      items: [
        ...initial.items,
        { id: "user", content: "My task", phase: "Tasks", status: "pending" },
      ],
    };
    const updated = reconcileNativeTodos(manual, [{ step: "A", status: "completed" }]);
    expect(updated.items[0]?.id).toBe(initial.items[0]?.id);
    expect(updated.items[0]?.status).toBe("completed");
    expect(reconcileNativeTodos(updated, []).items.map((item) => item.content)).toEqual([
      "My task",
    ]);
  });
  it("keeps duplicate native titles distinct and follows native IDs across renames", () => {
    const state = reconcileNativeTodos(emptyTodos, [
      { id: "a", step: "Same", status: "pending" },
      { id: "b", step: "Same", status: "pending" },
    ]);
    const updated = reconcileNativeTodos(state, [
      { id: "a", step: "New", status: "completed" },
      { id: "b", step: "Same", status: "pending" },
    ]);
    expect(updated.items.map((item) => item.id)).toEqual(state.items.map((item) => item.id));
    expect(updated.items[0]?.content).toBe("New");
  });
});

it("adopts agent progress for user-added tasks without duplicating them", () => {
  const state: ThreadTodos = {
    revision: 1,
    userEdited: true,
    items: [{ id: "user", content: "Review", phase: "Planning", status: "pending" }],
  };
  const updated = reconcileNativeTodos(state, [
    { id: "provider", step: "Review", status: "completed" },
  ]);
  expect(updated.items).toEqual([{ ...state.items[0], nativeId: "provider", status: "completed" }]);
  const edited = { ...updated, items: [{ ...updated.items[0]!, content: "Custom review" }] };
  const missing = reconcileNativeTodos(edited, []);
  expect(
    reconcileNativeTodos(missing, [{ id: "provider", step: "Review", status: "completed" }]).items,
  ).toHaveLength(1);
});
