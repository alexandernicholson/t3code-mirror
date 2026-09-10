import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  generate: vi.fn(),
  play: vi.fn(),
  stopSpeaking: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("expo-file-system", () => ({ Paths: { document: { uri: "file:///device/documents" } } }));
vi.mock("expo-audio", () => ({}));
vi.mock("@kittentts/react-native", () => ({
  KittenTTS: { create: mocks.create },
  KittenModel: { NanoInt8: "nano-int8" },
  KittenVoice: { Jasper: "Jasper", Bella: "Bella" },
  createExpoAudioPlayer: () => ({}),
}));
import { createNativeKittenSpeaker } from "./kittenSpeech";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resume) => {
    resolve = resume;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({
    generate: mocks.generate,
    play: mocks.play,
    stopSpeaking: mocks.stopSpeaking,
    dispose: mocks.dispose,
  });
  mocks.play.mockResolvedValue(undefined);
  mocks.stopSpeaking.mockResolvedValue(undefined);
  mocks.dispose.mockResolvedValue(undefined);
});

describe("native narration lifecycle", () => {
  it("discards late inference after mute and disposes only after native work settles", async () => {
    const generated = deferred<object>();
    const started = deferred<void>();
    const disposed = deferred<void>();
    mocks.generate.mockImplementation(() => {
      started.resolve();
      return generated.promise;
    });
    mocks.dispose.mockImplementation(() => {
      disposed.resolve();
      return Promise.resolve();
    });
    const done = vi.fn();
    const failed = vi.fn();
    const speaker = createNativeKittenSpeaker("Jasper", 1, vi.fn(), vi.fn());
    speaker.speak("Checking the tests.", done, failed);
    await started.promise;
    speaker.cancel();
    expect(mocks.stopSpeaking).toHaveBeenCalledOnce();
    expect(mocks.dispose).not.toHaveBeenCalled();
    generated.resolve({});
    await disposed.promise;
    expect(mocks.play).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });
  it("waits for playback completion before releasing the next narration update", async () => {
    mocks.generate.mockResolvedValue({});
    const playing = deferred<void>();
    const finished = deferred<void>();
    mocks.play.mockImplementation(() => {
      playing.resolve();
      return finished.promise;
    });
    const completed = deferred<void>();
    const done = vi.fn(() => completed.resolve());
    const speaker = createNativeKittenSpeaker("Jasper", 1, vi.fn(), vi.fn());
    speaker.speak("Running the tests.", done, vi.fn());
    await playing.promise;
    expect(done).not.toHaveBeenCalled();
    finished.resolve();
    await completed.promise;
    expect(done).toHaveBeenCalledOnce();
    speaker.cancel();
  });
  it("changes thread voices without reloading the native engine", async () => {
    mocks.generate.mockResolvedValue({});
    const speaker = createNativeKittenSpeaker("Jasper", 1, vi.fn(), vi.fn());
    const first = deferred<void>();
    speaker.speak("Thread one.", () => first.resolve(), vi.fn(), "Jasper");
    await first.promise;
    const second = deferred<void>();
    speaker.speak("Thread two.", () => second.resolve(), vi.fn(), "Bella");
    await second.promise;
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.generate.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ["Thread one.", "Jasper"],
      ["Thread two.", "Bella"],
    ]);
    speaker.cancel();
  });
  it("reports failed setup and permits a fresh retry", async () => {
    mocks.create.mockRejectedValueOnce(new Error("Download interrupted"));
    const failed = deferred<void>();
    const error = vi.fn();
    const speaker = createNativeKittenSpeaker("Jasper", 1, vi.fn(), error);
    speaker.speak("Hello.", vi.fn(), () => failed.resolve());
    await failed.promise;
    speaker.cancel();
    expect(error).toHaveBeenCalledWith("Download interrupted");
    mocks.generate.mockResolvedValue({});
    const completed = deferred<void>();
    const retry = createNativeKittenSpeaker("Jasper", 1, vi.fn(), vi.fn());
    retry.speak("Hello again.", () => completed.resolve(), vi.fn());
    await completed.promise;
    retry.cancel();
    expect(mocks.play).toHaveBeenCalledOnce();
  });
});
