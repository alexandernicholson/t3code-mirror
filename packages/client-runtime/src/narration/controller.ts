/** Public assistant messages only; tool output and reasoning are never narration input. */
export interface NarrationMessage {
  readonly id: string;
  readonly role: string;
  readonly text: string;
  readonly streaming: boolean;
  readonly createdAt?: string;
}

export function narrationExcerpt(text: string): string {
  const prose = text
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/^[\s]*[>#*+-]+\s*/gm, "")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = prose.match(/.+?(?:[.!?](?:\s+|$)|$)/g);
  const excerpt =
    sentences
      ?.slice(0, 2)
      .map((sentence) => sentence.trim())
      .join(" ") || prose;
  if (excerpt.length <= 280) return excerpt;
  return `${excerpt.slice(0, 277).replace(/\s+\S*$/, "")}…`;
}

/** Baseline at activation, then keep only the freshest completed update in a batch. */
export class NarrationCursor {
  private seen: Set<string>;
  private lastExcerpt: string | undefined;
  private readonly baselineCreatedAt: string;
  constructor(messages: readonly NarrationMessage[]) {
    this.seen = new Set(messages.map((message) => message.id));
    this.baselineCreatedAt = messages.reduce(
      (latest, message) =>
        message.createdAt && message.createdAt > latest ? message.createdAt : latest,
      "",
    );
  }
  next(messages: readonly NarrationMessage[]): string | undefined {
    let latest: string | undefined;
    for (const message of messages) {
      if (this.seen.has(message.id) || message.streaming) continue;
      this.seen.add(message.id);
      if (message.createdAt && message.createdAt < this.baselineCreatedAt) continue;
      if (message.role === "assistant") {
        const excerpt = narrationExcerpt(message.text);
        if (excerpt) latest = excerpt;
      }
    }
    if (latest === this.lastExcerpt) return undefined;
    if (latest) this.lastExcerpt = latest;
    return latest;
  }
}

export interface NarrationSpeaker {
  speak(text: string, done: () => void, failed: (message?: string) => void): void;
  cancel(): void;
}

/** One playing update and one replaceable pending update, never an audio backlog. */
export class NarrationQueue {
  private pending: { text: string; at: number } | undefined;
  private playing = false;
  private stopped = false;
  private readonly speaker: NarrationSpeaker;
  private readonly onError: (message?: string) => void;
  private readonly now: () => number;
  constructor(
    speaker: NarrationSpeaker,
    onError: (message?: string) => void,
    now: () => number = Date.now,
  ) {
    this.speaker = speaker;
    this.onError = onError;
    this.now = now;
  }
  enqueue(text: string) {
    if (this.stopped) return;
    if (this.playing) {
      this.pending = { text, at: this.now() };
      return;
    }
    this.playing = true;
    try {
      this.speaker.speak(
        text,
        () => {
          if (this.stopped) return;
          this.playing = false;
          const next = this.pending;
          this.pending = undefined;
          if (next && this.now() - next.at < 20_000) this.enqueue(next.text);
        },
        (message) => {
          if (this.stopped) return;
          this.stop();
          this.onError(message);
        },
      );
    } catch {
      this.stop();
      this.onError();
    }
  }
  stop() {
    this.stopped = true;
    this.pending = undefined;
    this.speaker.cancel();
  }
}
