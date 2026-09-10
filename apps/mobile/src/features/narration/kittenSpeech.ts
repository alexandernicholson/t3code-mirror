import type { NarrationSpeaker } from "@t3tools/client-runtime/narration";
import {
  KITTEN_BASE_URL,
  KITTEN_REVISION,
  KITTEN_VOICES,
  type KittenVoice,
  type KittenProgress,
} from "@t3tools/client-runtime/narration/kitten";
import type { KittenTTS } from "@kittentts/react-native";
import { Paths } from "expo-file-system";

// Serialized disposal prevents a previous, uncancellable native inference from
// racing the next session. Downloaded files remain in the device cache.
let cleanup: Promise<void> = Promise.resolve();
const storageDirectory = `${Paths.document.uri.replace(/^file:\/\//, "")}/narration/${KITTEN_REVISION}`;
async function sdk() {
  return import("@kittentts/react-native");
}
export async function isNativeKittenCached() {
  const { KittenTTS, KittenModel } = await sdk();
  return KittenTTS.isModelCached({ model: KittenModel.NanoInt8, storageDirectory });
}
export async function clearNativeKittenCache() {
  await cleanup;
  const { KittenTTS, KittenModel } = await sdk();
  await KittenTTS.clearModelCache({ model: KittenModel.NanoInt8, storageDirectory });
}
export function createNativeKittenSpeaker(
  voice: KittenVoice,
  rate: number,
  onProgress: (progress: KittenProgress | null) => void,
  onError: (message: string) => void,
): NarrationSpeaker {
  let stopped = false;
  let engine: KittenTTS | undefined;
  let initialization: Promise<KittenTTS> | undefined;
  let pending: Promise<void> = Promise.resolve();
  const previousCleanup = cleanup;
  function load() {
    return (initialization ??= (async () => {
      onProgress({ phase: "loading", percent: 0 });
      await previousCleanup;
      if (stopped) throw new Error("Narration stopped.");
      const [{ KittenTTS, KittenModel, createExpoAudioPlayer }, audio] = await Promise.all([
        sdk(),
        import("expo-audio"),
      ]);
      if (stopped) throw new Error("Narration stopped.");
      engine = await KittenTTS.create(
        {
          model: KittenModel.NanoInt8,
          modelBaseURL: KITTEN_BASE_URL,
          storageDirectory,
          ortNumThreads: 2,
          player: createExpoAudioPlayer(audio),
        },
        (fraction, info) => {
          if (!stopped)
            onProgress({
              phase:
                info?.stage === "cached" || info?.stage === "complete" ? "loading" : "downloading",
              percent: Math.floor(fraction * 100),
            });
        },
      );
      if (!stopped) onProgress(null);
      return engine;
    })());
  }
  return {
    speak(text, done, failed, selectedVoice) {
      pending = (async () => {
        const tts = await load();
        if (stopped) return;
        const { KittenVoice: Voices } = await sdk();
        const nextVoice = KITTEN_VOICES.find((candidate) => candidate === selectedVoice) ?? voice;
        const result = await tts.generate(text, Voices[nextVoice], rate);
        if (stopped) return;
        await tts.play(result);
        if (!stopped) done();
      })().catch((error: unknown) => {
        if (stopped) return;
        onProgress(null);
        const message = error instanceof Error ? error.message : "Kitten speech generation failed.";
        onError(message);
        failed(message);
      });
    },
    cancel() {
      if (stopped) return;
      stopped = true;
      onProgress(null);
      void engine?.stopSpeaking().catch(() => undefined);
      cleanup = pending
        .then(async () => {
          await engine?.dispose();
        })
        .catch(() => undefined);
    },
  };
}
