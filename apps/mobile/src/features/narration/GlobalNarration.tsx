import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Alert, AppState, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  GlobalNarrationQueue,
  narrationVoiceOrder,
  type GlobalNarrationStatus,
} from "@t3tools/client-runtime/narration/global";
import { narrationThreadKey, subscribeNarrationFeed } from "@t3tools/client-runtime/narration/feed";
import { KITTEN_VOICES, type KittenProgress } from "@t3tools/client-runtime/narration/kitten";
import { mobilePreferencesAtom } from "../../state/preferences";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentThreadDetails, environmentThreadShells } from "../../state/threads";
import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { createNativeKittenSpeaker } from "./kittenSpeech";
import { environmentSnapshotAtom } from "../../state/shell";

const IDLE: GlobalNarrationStatus = { title: null, voice: null, pending: 0 };
const NarrationContext = createContext<{
  enabled: boolean;
  status: GlobalNarrationStatus;
  progress: KittenProgress | null;
  toggle: () => void;
  stop: () => void;
} | null>(null);
export function useGlobalNarration() {
  const value = useContext(NarrationContext);
  if (!value) throw new Error("GlobalNarrationProvider is missing");
  return value;
}
export function GlobalNarrationProvider({ children }: { children: ReactNode }) {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const settings = AsyncResult.isSuccess(preferences) ? preferences.value : {};
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState(IDLE);
  const [progress, setProgress] = useState<KittenProgress | null>(null);
  const session = useRef<GlobalNarrationQueue | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);
  const stop = useCallback(() => {
    const current = session.current;
    session.current = null;
    unsubscribe.current?.();
    unsubscribe.current = null;
    current?.stop();
    setEnabled(false);
    setStatus(IDLE);
    setProgress(null);
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") stop();
    });
    return () => {
      subscription.remove();
      unsubscribe.current?.();
      session.current?.stop();
      session.current = null;
    };
  }, [stop]);
  const toggle = useCallback(() => {
    if (session.current) return stop();
    const preferred = settings.narrationVoice ?? "Jasper";
    const speaker = createNativeKittenSpeaker(
      preferred,
      settings.narrationRate ?? 1,
      setProgress,
      () => {},
    );
    const queue = new GlobalNarrationQueue(
      speaker,
      narrationVoiceOrder(KITTEN_VOICES, preferred),
      setStatus,
      (message) => {
        stop();
        Alert.alert("Narration stopped", message);
      },
    );
    session.current = queue;
    setEnabled(true);
    queue.enqueue({ key: "", title: "Global Narrate", text: "Global narration is on." });
    unsubscribe.current = subscribeNarrationFeed({
      registry: appAtomRegistry,
      shells: environmentThreadShells.threadShellsAtom,
      environmentBaseline: (id) => appAtomRegistry.get(environmentSnapshotAtom(id))?.updatedAt,
      state: environmentThreadDetails.stateAtom,
      fullText: false,
      onRemove: (key) => queue.remove(key),
      onUpdate: (thread, text) =>
        queue.enqueue({
          key: narrationThreadKey({ environmentId: thread.environmentId, threadId: thread.id }),
          title: thread.title,
          text,
        }),
    });
  }, [settings.narrationVoice, settings.narrationRate, stop]);
  const value = useMemo(
    () => ({ enabled, status, progress, toggle, stop }),
    [enabled, status, progress, toggle, stop],
  );
  return <NarrationContext value={value}>{children}</NarrationContext>;
}

/** Persistent stop/status control, including on settings and other non-thread routes. */
export function GlobalNarrationBar() {
  const narration = useGlobalNarration();
  const insets = useSafeAreaInsets();
  if (!narration.enabled) return null;
  return (
    <View
      className="border-t border-border bg-card px-4 py-2"
      style={{ paddingBottom: insets.bottom + 8 }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Stop global narration"
        onPress={narration.stop}
        className="flex-row items-center gap-2 py-1"
      >
        <SymbolView name="speaker.wave.2" size={16} tintColorClassName="accent-icon" />
        <Text className="text-sm text-foreground">Stop Global Narrate</Text>
      </Pressable>
      <Text className="text-xs text-foreground-muted" numberOfLines={1}>
        {narration.progress
          ? `Preparing voices · ${narration.progress.percent}%`
          : narration.status.title
            ? `${narration.status.title} · ${narration.status.voice}`
            : "Listening for new updates"}
        {narration.status.pending > 0 ? ` · ${narration.status.pending} queued` : ""}
      </Text>
    </View>
  );
}
