import type { ClientSettings } from "@t3tools/contracts/settings";
import type { NarrationSpeaker } from "@t3tools/client-runtime/narration";
import {
  KITTEN_SAMPLE_RATE,
  type KittenWorkerResponse,
} from "@t3tools/client-runtime/narration/kitten";
import { toastManager } from "~/components/ui/toast";
import { createNarrationSpeaker as createSystemSpeaker } from "./speech";

export function createConfiguredNarrationSpeaker(settings: ClientSettings): NarrationSpeaker {
  if (settings.narrationEngine === "system")
    return createSystemSpeaker(settings.narrationVoice, settings.narrationRate);
  // Construct/resume on the initiating click, before awaiting the model download.
  const context = new AudioContext({ sampleRate: KITTEN_SAMPLE_RATE });
  const resumed = context.resume();
  void resumed.catch(() => undefined);
  const worker = new Worker(new URL("./kitten.worker.ts", import.meta.url), { type: "module" });
  let source: AudioBufferSourceNode | undefined;
  let done: (() => void) | undefined;
  let failed: ((message?: string) => void) | undefined;
  let stopped = false;
  let toastId: ReturnType<typeof toastManager.add> | undefined;
  function closeProgress() {
    if (toastId) toastManager.close(toastId);
    toastId = undefined;
  }
  worker.addEventListener("message", (event: MessageEvent<KittenWorkerResponse>) => {
    if (stopped) return;
    const response = event.data;
    if (response.type === "progress") {
      if (response.progress.phase === "ready") {
        closeProgress();
        return;
      }
      const { percent, phase } = response.progress;
      const options = {
        type: "loading" as const,
        title:
          phase === "downloading"
            ? `Downloading Kitten voice · ${percent}%`
            : "Preparing Kitten voice…",
        description: (
          <div className="space-y-2">
            <p>
              {phase === "downloading"
                ? "Downloaded once from Hugging Face, then stored on this device."
                : "Starting local CPU inference."}
            </p>
            <progress
              aria-label="Kitten model download"
              max={100}
              value={percent}
              className="h-1.5 w-full accent-primary"
            />
          </div>
        ),
        timeout: 0,
      };
      if (toastId) toastManager.update(toastId, options);
      else toastId = toastManager.add(options);
    } else if (response.type === "error") {
      closeProgress();
      failed?.(response.message);
    } else {
      void resumed
        .then(() => {
          if (stopped) return;
          const buffer = context.createBuffer(1, response.samples.length, KITTEN_SAMPLE_RATE);
          buffer.copyToChannel(response.samples, 0);
          source = context.createBufferSource();
          source.buffer = buffer;
          source.connect(context.destination);
          source.addEventListener(
            "ended",
            () => {
              if (stopped) return;
              source?.disconnect();
              source = undefined;
              done?.();
            },
            { once: true },
          );
          source.start();
        })
        .catch(() => failed?.());
    }
  });
  worker.addEventListener("error", () => {
    closeProgress();
    failed?.();
  });
  return {
    speak(text, onDone, onFailed) {
      done = onDone;
      failed = onFailed;
      worker.postMessage(
        {
          text,
          voice: settings.narrationKittenVoice,
          rate: settings.narrationRate,
        },
        [],
      );
    },
    cancel() {
      if (stopped) return;
      stopped = true;
      closeProgress();
      worker.terminate();
      if (source) {
        source.stop();
        source.disconnect();
      }
      void context.close().catch(() => undefined);
    },
  };
}
