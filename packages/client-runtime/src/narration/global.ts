import { narrationExcerpt, type NarrationSpeaker } from "./controller.ts";

export interface NarrationUpdate {
  readonly key: string;
  readonly title: string;
  readonly text: string;
  readonly summarize?: (text: string) => Promise<string>;
}

export interface GlobalNarrationStatus {
  readonly title: string | null;
  readonly voice: string | null;
  readonly pending: number;
}

/** A single audio engine, with a fair queue retaining the newest update from each thread. */
export class GlobalNarrationQueue {
  private readonly pending = new Map<string, NarrationUpdate>();
  private readonly voicesByThread = new Map<string, string>();
  private current: NarrationUpdate | undefined;
  private stopped = false;
  private readonly speaker: NarrationSpeaker;
  private readonly voices: readonly string[];
  private readonly onChange: (status: GlobalNarrationStatus) => void;
  private readonly onError: (message: string, fatal: boolean) => void;
  private readonly removed = new Set<string>();

  constructor(
    speaker: NarrationSpeaker,
    voices: readonly string[],
    onChange: (status: GlobalNarrationStatus) => void,
    onError: (message: string, fatal: boolean) => void,
  ) {
    this.speaker = speaker;
    this.voices = voices;
    this.onChange = onChange;
    this.onError = onError;
  }

  private voice(key: string) {
    if (key === "") return this.voices[0] ?? "";
    let voice = this.voicesByThread.get(key);
    if (voice === undefined) {
      voice = this.voices[this.voicesByThread.size % this.voices.length] ?? "";
      this.voicesByThread.set(key, voice);
    }
    return voice;
  }

  private publish() {
    this.onChange({
      title: this.current?.title ?? null,
      voice: this.current ? this.voice(this.current.key) : null,
      pending: this.pending.size,
    });
  }

  enqueue(update: NarrationUpdate) {
    if (this.stopped) return;
    this.removed.delete(update.key);
    this.pending.set(update.key, update);
    if (!this.current) this.advance();
    else this.publish();
  }

  remove(key: string) {
    this.removed.add(key);
    this.pending.delete(key);
    // Let the current sentence finish; cancelling destroys the shared audio engine.
    this.publish();
  }

  private advance() {
    if (this.stopped) return;
    this.current = this.pending.values().next().value;
    const update = this.current;
    if (update) this.pending.delete(update.key);
    this.publish();
    if (!update) return;
    if (!update.summarize) {
      this.play(update, update.text);
      return;
    }
    void Promise.resolve()
      .then(() => {
        if (this.stopped) return "";
        return update.summarize!(update.text);
      })
      .then(
        (summary) => {
          if (this.stopped || this.current !== update) return;
          // Other threads must not discard this thread's summary or starve it.
          if (this.pending.has(update.key) || this.removed.has(update.key)) {
            this.advance();
            return;
          }
          const text = narrationExcerpt(summary).split(/\s+/).slice(0, 40).join(" ");
          if (text) this.play(update, text);
          else this.advance();
        },
        () => {
          if (this.stopped || this.current !== update) return;
          this.onError(
            `Could not summarize ${update.title}. Check the narration model in that environment’s Settings.`,
            false,
          );
          this.advance();
        },
      );
  }

  private play(update: NarrationUpdate, text: string) {
    const fail = (message?: string) => {
      if (this.stopped || this.current !== update) return;
      this.stop();
      this.onError(
        message ?? "Speech playback failed. Check your voice in Settings and try again.",
        true,
      );
    };
    try {
      this.speaker.speak(
        text,
        () => {
          if (!this.stopped && this.current === update) this.advance();
        },
        fail,
        this.voice(update.key),
      );
    } catch {
      fail();
    }
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.pending.clear();
    this.current = undefined;
    this.speaker.cancel();
    this.publish();
  }
}

/** Put the preferred voice first, then rotate through distinct voices before reusing any. */
export function narrationVoiceOrder(voices: readonly string[], preferred: string) {
  return [...new Set([preferred, ...voices].filter((voice) => voices.includes(voice)))];
}
