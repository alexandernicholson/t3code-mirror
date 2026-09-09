import { useAtomValue } from "@effect/atom-react";
import { randomUUID } from "../../lib/utils";
import { memo, useRef, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, ListTodoIcon, PencilIcon, Trash2Icon } from "lucide-react";
import type { EnvironmentId, ThreadId, TodoItem } from "@t3tools/contracts";
import { editTodoItems, type TodoEdit } from "@t3tools/client-runtime/todos";
import { emptyTodos } from "@t3tools/shared/todos";
import { threadEnvironment, environmentThreadDetails } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";

export const ThreadTodos = memo(function ThreadTodos({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const ref = { environmentId, threadId };
  const status = useAtomValue(environmentThreadDetails.statusAtom(ref));
  const state = useAtomValue(environmentThreadDetails.todosAtom(ref)) ?? emptyTodos;
  const save = useAtomCommand(threadEnvironment.editTodos);
  const [content, setContent] = useState("");
  const [phase, setPhase] = useState("Tasks");
  const [editing, setEditing] = useState<(TodoItem & { revision?: number }) | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = busy || status !== "live";
  async function mutate(edit: TodoEdit) {
    if (inFlight.current || disabled) return;
    const items = editTodoItems(state.items, edit);
    if (items === state.items) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await save({
        environmentId,
        input: {
          threadId,
          expectedRevision:
            edit.type === "edit" ? (editing?.revision ?? state.revision) : state.revision,
          items,
        },
      });
      if (result._tag !== "Success") {
        setEditing((current) => {
          if (!current) return null;
          const { revision: _, ...draft } = current;
          return draft;
        });
        setError("Could not save TODOs. The list may have changed; review it and retry.");
        return;
      }
      if (edit.type === "add" || edit.type === "edit") {
        setContent("");
        setPhase("Tasks");
        setEditing(null);
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <section aria-label="TODOs" className="h-full overflow-y-auto bg-background text-sm">
      <div className="flex items-center gap-2 px-3 py-3">
        <ListTodoIcon className="size-4 text-muted-foreground" />
        <span className="font-medium">TODOs</span>
        <span className="flex-1 text-xs text-muted-foreground">
          {state.items.filter((item) => item.status === "completed").length}/{state.items.length}{" "}
          complete
        </span>
      </div>
      <div className="border-t border-border p-3">
        <ul className="space-y-1" aria-label="TODO list">
          {state.items.map((item, index) => (
            <li key={item.id} className="flex items-start gap-2 rounded-md py-1">
              <input
                type="checkbox"
                aria-label={`Complete ${item.content}`}
                checked={item.status === "completed"}
                disabled={disabled}
                onChange={() => void mutate({ type: "toggle", id: item.id })}
                className="mt-1"
              />
              <div className="min-w-0 flex-1">
                <span
                  className={
                    item.status === "completed"
                      ? "break-words text-muted-foreground line-through"
                      : "break-words"
                  }
                >
                  {item.content}
                </span>
                <div className="text-xs text-muted-foreground">
                  {item.phase} · {item.status.replaceAll("_", " ")}
                  {item.blocker ? ` · ${item.blocker}` : ""}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Move ${item.content} up`}
                disabled={disabled || index === 0}
                onClick={() => void mutate({ type: "move", id: item.id, direction: -1 })}
              >
                <ChevronUpIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Move ${item.content} down`}
                disabled={disabled || index === state.items.length - 1}
                onClick={() => void mutate({ type: "move", id: item.id, direction: 1 })}
              >
                <ChevronDownIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Edit ${item.content}`}
                disabled={disabled}
                onClick={() => {
                  setEditing({ ...item, revision: state.revision });
                  setContent(item.content);
                  setPhase(item.phase);
                }}
              >
                <PencilIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Delete ${item.content}`}
                disabled={disabled}
                onClick={() => void mutate({ type: "delete", id: item.id })}
              >
                <Trash2Icon />
              </Button>
            </li>
          ))}
        </ul>
        {state.items.length === 0 && (
          <p className="mb-3 text-muted-foreground">
            No TODOs yet. Add one or ask the agent to create a checklist.
          </p>
        )}
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void mutate(
              editing
                ? { type: "edit", id: editing.id, content, phase }
                : { type: "add", id: randomUUID(), content, phase },
            );
          }}
        >
          <input
            aria-label="TODO text"
            placeholder="Add a TODO…"
            maxLength={2000}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            disabled={disabled}
            className="min-w-32 flex-1 rounded-md border border-input bg-background px-2 py-1.5"
          />
          <input
            aria-label="TODO phase"
            value={phase}
            maxLength={2000}
            onChange={(event) => setPhase(event.target.value)}
            disabled={disabled}
            className="w-24 rounded-md border border-input bg-background px-2 py-1.5"
          />
          <Button type="submit" size="sm" disabled={disabled || !content.trim() || !phase.trim()}>
            {editing ? "Save" : "Add"}
          </Button>
          {editing && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(null);
                setContent("");
                setPhase("Tasks");
              }}
            >
              Cancel
            </Button>
          )}
        </form>
        {error && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </section>
  );
});
