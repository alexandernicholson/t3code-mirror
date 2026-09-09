import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { Atom, AtomRegistry } from "effect/unstable/reactivity";
import type { EnvironmentThreadShell } from "../state/models.ts";
import type { EnvironmentThreadState } from "../state/threadState.ts";
import { Option } from "effect";
import { NarrationCursor, type NarrationMessage } from "./controller.ts";

export const narrationThreadKey = (ref: ScopedThreadRef) =>
  JSON.stringify([ref.environmentId, ref.threadId]);

/** Observe only threads that work or change during this session, using existing windowed subscriptions. */
export function subscribeNarrationFeed<
  T extends Pick<
    EnvironmentThreadShell,
    "environmentId" | "id" | "createdAt" | "updatedAt" | "latestTurn"
  >,
>(input: {
  registry: AtomRegistry.AtomRegistry;
  shells: Atom.Atom<readonly T[]>;
  environmentBaseline: (environmentId: EnvironmentId) => string | undefined;
  state: (ref: ScopedThreadRef) => Atom.Atom<{
    status: EnvironmentThreadState["status"];
    data: Option.Option<{ messages: readonly NarrationMessage[] }>;
  }>;
  fullText: boolean;
  onUpdate: (thread: T, text: string) => void;
  onRemove: (key: string) => void;
}) {
  const tracked = new Map<
    string,
    {
      shell: T;
      baseline: string;
      unsubscribe?: () => void;
    }
  >();
  const environments = new Map<EnvironmentId, string>();
  let initial = true;
  let stopped = false;
  function refresh() {
    const shells = input.registry.get(input.shells);
    const keys = new Set<string>();
    const knownEnvironments = new Map(environments);
    const initialSnapshot = initial;
    initial = false;
    for (const shell of shells) {
      const ref = { environmentId: shell.environmentId, threadId: shell.id };
      const key = narrationThreadKey(ref);
      keys.add(key);
      if (!knownEnvironments.has(shell.environmentId)) {
        const baseline =
          environments.get(shell.environmentId) ??
          input.environmentBaseline(shell.environmentId) ??
          "";
        if (shell.updatedAt > baseline) environments.set(shell.environmentId, shell.updatedAt);
      }
      let entry = tracked.get(key);
      const changed = entry
        ? entry.shell.updatedAt !== shell.updatedAt
        : !initialSnapshot &&
          shell.createdAt >
            (knownEnvironments.get(shell.environmentId) ??
              input.environmentBaseline(shell.environmentId) ??
              shell.createdAt);
      if (!entry) {
        entry = { shell, baseline: changed ? shell.createdAt : shell.updatedAt };
        tracked.set(key, entry);
      }
      entry.shell = shell;
      if (entry.unsubscribe || (!changed && shell.latestTurn?.state !== "running")) continue;
      const current = entry;
      let cursor: NarrationCursor | undefined;
      let previousMessages: readonly NarrationMessage[] | undefined;
      const stateAtom = input.state(ref);
      current.unsubscribe = input.registry.subscribe(
        stateAtom,
        (state) => {
          if (stopped || state.status !== "live" || Option.isNone(state.data)) return;
          const messages = state.data.value.messages;
          if (messages === previousMessages) return;
          previousMessages = messages;
          // Baseline uses the environment's own clock and survives delayed snapshot loading.
          cursor ??= new NarrationCursor([], input.fullText);
          const text = cursor.next(
            messages.filter(
              (message) => message.createdAt !== undefined && message.createdAt > current.baseline,
            ),
          );
          if (text) input.onUpdate(current.shell, text);
        },
        { immediate: true },
      );
    }
    for (const [key, entry] of tracked) {
      if (keys.has(key)) continue;
      entry.unsubscribe?.();
      tracked.delete(key);
      input.onRemove(key);
    }
  }
  const unsubscribe = input.registry.subscribe(input.shells, refresh, { immediate: true });
  return () => {
    stopped = true;
    unsubscribe();
    for (const entry of tracked.values()) entry.unsubscribe?.();
    tracked.clear();
  };
}
