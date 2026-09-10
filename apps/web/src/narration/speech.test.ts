import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createNarrationSpeaker } from "./speech";
import { GlobalNarrationQueue } from "@t3tools/client-runtime/narration/global";

class Utterance extends EventTarget {
  text: string;
  voice?: { voiceURI: string; lang: string };
  lang = "";
  rate = 1;
  constructor(text: string) {
    super();
    this.text = text;
  }
}
afterEach(() => vi.unstubAllGlobals());
describe("system narration playback", () => {
  it("switches voices between queued threads and cancels only when globally stopped", () => {
    const utterances: Utterance[] = [];
    const voices = [
      { voiceURI: "one", lang: "en-US" },
      { voiceURI: "two", lang: "en-GB" },
    ];
    const cancel = vi.fn();
    vi.stubGlobal("window", {
      speechSynthesis: {
        getVoices: () => voices,
        speak: (utterance: Utterance) => utterances.push(utterance),
        cancel,
      },
    });
    vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
    const error = vi.fn();
    const queue = new GlobalNarrationQueue(
      createNarrationSpeaker("one", 1.25),
      ["one", "two"],
      vi.fn(),
      error,
    );
    queue.enqueue({ key: "a", title: "A", text: "First thread." });
    queue.enqueue({ key: "b", title: "B", text: "Second thread." });
    expect(utterances).toHaveLength(1);
    expect(utterances[0]?.voice).toBe(voices[0]);
    utterances[0]!.dispatchEvent(new Event("end"));
    expect(utterances).toHaveLength(2);
    expect(utterances[1]?.voice).toBe(voices[1]);
    expect(utterances[1]?.lang).toBe("en-GB");
    expect(utterances[1]?.rate).toBe(1.25);
    expect(cancel).not.toHaveBeenCalled();
    queue.enqueue({ key: "a", title: "A", text: "Pending." });
    queue.stop();
    utterances[1]!.dispatchEvent(new Event("end"));
    utterances[1]!.dispatchEvent(new Event("error"));
    expect(cancel).toHaveBeenCalledOnce();
    expect(utterances).toHaveLength(2);
    expect(error).not.toHaveBeenCalled();
  });
});
