import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  NarrationCursor,
  NarrationQueue,
  type NarrationMessage,
} from "@t3tools/client-runtime/narration";
import type { KittenProgress } from "@t3tools/client-runtime/narration/kitten";
import { mobilePreferencesAtom } from "../../state/preferences";
import { createNativeKittenSpeaker } from "./kittenSpeech";

export function useNarration(messages: readonly NarrationMessage[]) {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const settings = AsyncResult.isSuccess(preferences) ? preferences.value : {};
  const [enabled, setEnabled] = useState(false);
  const [progress, setProgress] = useState<KittenProgress | null>(null);
  const session = useRef<{ queue: NarrationQueue; cursor: NarrationCursor } | null>(null);
  const stop = useCallback(() => {
    session.current?.queue.stop();
    session.current = null;
    setEnabled(false);
    setProgress(null);
  }, []);
  useEffect(() => () => session.current?.queue.stop(), []);
  useFocusEffect(
    useCallback(() => {
      const subscription = AppState.addEventListener("change", (state) => {
        if (state !== "active") stop();
      });
      return () => {
        subscription.remove();
        stop();
      };
    }, [stop]),
  );
  useEffect(() => {
    const current = session.current;
    if (!current) return;
    const next = current.cursor.next(messages);
    if (next) current.queue.enqueue(next);
  }, [messages]);
  function start(
    text = "Narration is on. I’ll read short updates as the agent works.",
    preview = false,
  ) {
    if (session.current) {
      stop();
      return;
    }
    const speaker = createNativeKittenSpeaker(
      settings.narrationVoice ?? "Jasper",
      settings.narrationRate ?? 1,
      setProgress,
      (message) =>
        Alert.alert(
          "Kitten narration failed",
          `${message}\nTry again to retry the download or speech generation.`,
        ),
    );
    const queue = new NarrationQueue(
      preview
        ? {
            speak: (text, done, failed) =>
              speaker.speak(
                text,
                () => {
                  done();
                  stop();
                },
                failed,
              ),
            cancel: () => speaker.cancel(),
          }
        : speaker,
      stop,
    );
    session.current = { queue, cursor: new NarrationCursor(messages) };
    setEnabled(true);
    queue.enqueue(text);
  }
  return { enabled, progress, start, stop };
}
