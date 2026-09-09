import { useAtomValue } from "@effect/atom-react";
import { memo, useRef, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import type { EnvironmentId, ThreadId, TodoItem } from "@t3tools/contracts";
import { editTodoItems, type TodoEdit } from "@t3tools/client-runtime/todos";
import { emptyTodos } from "@t3tools/shared/todos";
import { AppText as Text } from "../../components/AppText";
import { threadEnvironment, environmentThreadDetails } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

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
  const [expanded, setExpanded] = useState(false);
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
        setError("Could not save TODOs. Review the latest list and retry.");
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
    <View className="mx-4 mb-2 rounded-xl border border-border bg-card p-3">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="TODOs"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        className="min-h-11 flex-row items-center justify-between"
      >
        <Text className="font-t3-medium text-foreground">TODOs</Text>
        <Text className="text-sm text-foreground-muted">
          {state.items.filter((item) => item.status === "completed").length}/{state.items.length}{" "}
          complete {expanded ? "⌄" : "⌃"}
        </Text>
      </Pressable>
      {expanded && (
        <View className="gap-2">
          <ScrollView
            style={{ maxHeight: 220 }}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
          >
            {state.items.map((item, index) => (
              <View key={item.id} className="mb-2 gap-1">
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel={item.content}
                  accessibilityState={{ checked: item.status === "completed", disabled }}
                  disabled={disabled}
                  onPress={() => void mutate({ type: "toggle", id: item.id })}
                  className="min-h-11 flex-row items-center gap-2"
                >
                  <Text className="text-foreground">{item.status === "completed" ? "☑" : "☐"}</Text>
                  <Text className="flex-1 text-foreground">{item.content}</Text>
                </Pressable>
                <Text className="text-xs text-foreground-muted">
                  {item.phase} · {item.status.replaceAll("_", " ")}
                  {item.blocker ? ` · ${item.blocker}` : ""}
                </Text>
                <View className="flex-row gap-3">
                  <TodoButton
                    label={`Move ${item.content} up`}
                    disabled={disabled || index === 0}
                    onPress={() => void mutate({ type: "move", id: item.id, direction: -1 })}
                  >
                    Up
                  </TodoButton>
                  <TodoButton
                    label={`Move ${item.content} down`}
                    disabled={disabled || index === state.items.length - 1}
                    onPress={() => void mutate({ type: "move", id: item.id, direction: 1 })}
                  >
                    Down
                  </TodoButton>
                  <TodoButton
                    label={`Edit ${item.content}`}
                    disabled={disabled}
                    onPress={() => {
                      setEditing({ ...item, revision: state.revision });
                      setContent(item.content);
                      setPhase(item.phase);
                    }}
                  >
                    Edit
                  </TodoButton>
                  <TodoButton
                    label={`Delete ${item.content}`}
                    disabled={disabled}
                    onPress={() => void mutate({ type: "delete", id: item.id })}
                  >
                    Delete
                  </TodoButton>
                </View>
              </View>
            ))}
          </ScrollView>
          {state.items.length === 0 && (
            <Text className="text-sm text-foreground-muted">
              No TODOs yet. Add one or ask the agent for a checklist.
            </Text>
          )}
          <TextInput
            accessibilityLabel="TODO text"
            placeholder="Add a TODO…"
            value={content}
            maxLength={2000}
            onChangeText={setContent}
            editable={!disabled}
            className="min-h-11 rounded-md border border-border px-3 text-foreground"
          />
          <TextInput
            accessibilityLabel="TODO phase"
            value={phase}
            maxLength={2000}
            onChangeText={setPhase}
            editable={!disabled}
            className="min-h-11 rounded-md border border-border px-3 text-foreground"
          />
          <View className="flex-row gap-3">
            <TodoButton
              label={editing ? "Save TODO" : "Add TODO"}
              disabled={disabled || !content.trim() || !phase.trim()}
              onPress={() =>
                void mutate(
                  editing
                    ? { type: "edit", id: editing.id, content, phase }
                    : { type: "add", id: Crypto.randomUUID(), content, phase },
                )
              }
            >
              {editing ? "Save" : "Add"}
            </TodoButton>
            {editing && (
              <TodoButton
                label="Cancel TODO edit"
                onPress={() => {
                  setEditing(null);
                  setContent("");
                  setPhase("Tasks");
                }}
              >
                Cancel
              </TodoButton>
            )}
          </View>
          <Text className="text-xs text-foreground-muted">
            Edits are shared with the agent on your next message.
          </Text>
          {error && (
            <Text accessibilityRole="alert" className="text-sm text-foreground">
              {error}
            </Text>
          )}
        </View>
      )}
    </View>
  );
});

function TodoButton({
  label,
  children,
  disabled = false,
  onPress,
}: {
  label: string;
  children: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className="min-h-11 min-w-11 items-center justify-center"
      style={{ opacity: disabled ? 0.4 : 1 }}
    >
      <Text className="text-sm text-foreground">{children}</Text>
    </Pressable>
  );
}
