import { useEffect, useState } from "react";
import type { NarrationSpeaker } from "@t3tools/client-runtime/narration";

export function getSpeechSynthesis(): SpeechSynthesis | undefined {
  return typeof window !== "undefined" && "speechSynthesis" in window
    ? window.speechSynthesis
    : undefined;
}

export function useNarrationVoices() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(
    () => getSpeechSynthesis()?.getVoices() ?? [],
  );
  useEffect(() => {
    const synth = getSpeechSynthesis();
    if (!synth) return;
    const update = () => setVoices(synth.getVoices());
    update();
    synth.addEventListener("voiceschanged", update);
    return () => synth.removeEventListener("voiceschanged", update);
  }, []);
  return voices;
}

export function createNarrationSpeaker(voiceURI: string, rate: number): NarrationSpeaker {
  const synth = getSpeechSynthesis();
  // Retain the utterance until completion; some browser engines otherwise lose callbacks.
  let current: SpeechSynthesisUtterance | undefined;
  let removeListeners: (() => void) | undefined;
  return {
    speak(text, done, failed, selectedVoice = voiceURI) {
      if (!synth) {
        failed();
        return;
      }
      current = new SpeechSynthesisUtterance(text);
      const voice = synth.getVoices().find((candidate) => candidate.voiceURI === selectedVoice);
      if (voice) {
        current.voice = voice;
        current.lang = voice.lang;
      }
      current.rate = rate;
      const utterance = current;
      const finish = (callback: () => void) => {
        removeListeners?.();
        removeListeners = undefined;
        current = undefined;
        callback();
      };
      const onEnd = () => finish(done);
      const onError = () => finish(failed);
      utterance.addEventListener("end", onEnd);
      utterance.addEventListener("error", onError);
      removeListeners = () => {
        utterance.removeEventListener("end", onEnd);
        utterance.removeEventListener("error", onError);
      };
      try {
        synth.speak(current);
      } catch {
        finish(failed);
      }
    },
    cancel() {
      removeListeners?.();
      removeListeners = undefined;
      current = undefined;
      synth?.cancel();
    },
  };
}
