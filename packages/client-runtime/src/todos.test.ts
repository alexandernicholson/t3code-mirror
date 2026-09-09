import { expect, it } from "vite-plus/test";
import { editTodoItems } from "./todos.ts";
import type { TodoItem } from "@t3tools/contracts";
it("supports all user edits without mutating the received snapshot", () => {
  const original: TodoItem[] = [
    { id: "a", content: "A", phase: "Tasks", status: "blocked", blocker: "Waiting" },
  ];
  const added = editTodoItems(original, { type: "add", id: "b", content: " B " });
  const moved = editTodoItems(added, { type: "move", id: "b", direction: -1 });
  expect(moved.map((item) => item.id)).toEqual(["b", "a"]);
  const renamed = editTodoItems(moved, {
    type: "edit",
    id: "a",
    content: "Renamed",
    phase: "Verify",
  });
  const done = editTodoItems(renamed, { type: "toggle", id: "a" });
  expect(done[1]).toEqual({ id: "a", content: "Renamed", phase: "Verify", status: "completed" });
  const reopened = editTodoItems(done, { type: "toggle", id: "a" });
  expect(reopened[1]?.status).toBe("pending");
  expect(editTodoItems(reopened, { type: "delete", id: "b" })).toHaveLength(1);
  expect(original[0]?.status).toBe("blocked");
});
