import * as ort from "onnxruntime-web/wasm";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import wasmModuleUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import JSZip from "jszip";
import { phonemize } from "phonemizer";
import {
  KITTEN_FILES,
  KITTEN_VOICE_KEYS,
  kittenTokenIds,
  type KittenWorkerRequest,
  type KittenWorkerResponse,
} from "@t3tools/client-runtime/narration/kitten";
import { loadKittenFile } from "./kittenCache";

const send = (response: KittenWorkerResponse) =>
  postMessage(response, { transfer: response.type === "audio" ? [response.samples.buffer] : [] });
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: wasmModuleUrl };
let engine: Promise<{ session: ort.InferenceSession; voices: JSZip }> | undefined;
function load() {
  return (engine ??= (async () => {
    send({ type: "progress", progress: { phase: "downloading", percent: 0 } });
    const loaded = [0, 0];
    let lastPercent = -1;
    const buffers = await Promise.all(
      KITTEN_FILES.map((file, index) =>
        loadKittenFile(file, (bytes) => {
          loaded[index] = bytes;
          const percent = Math.floor(
            (100 * loaded.reduce((a, b) => a + b, 0)) /
              KITTEN_FILES.reduce((sum, entry) => sum + entry.size, 0),
          );
          if (percent !== lastPercent) {
            lastPercent = percent;
            send({ type: "progress", progress: { phase: "downloading", percent } });
          }
        }),
      ),
    );
    send({ type: "progress", progress: { phase: "loading", percent: 100 } });
    const [session, voices] = await Promise.all([
      ort.InferenceSession.create(buffers[0]!, { executionProviders: ["wasm"] }),
      JSZip.loadAsync(buffers[1]!),
    ]);
    send({ type: "progress", progress: { phase: "ready", percent: 100 } });
    return { session, voices };
  })());
}

async function generate({ text, voice, rate }: KittenWorkerRequest) {
  const { session, voices } = await load();
  const parts = text.match(/[^;:,.!?—…]+|[;:,.!?—…]+/g) ?? [];
  let ipa = "";
  for (const part of parts) {
    ipa += /^[;:,.!?—…]+$/.test(part) ? part : (await phonemize(part, "en-us")).join(" ");
  }
  const ids = kittenTokenIds(ipa);
  if (ids.length > 510 || ids.length <= 3)
    throw new Error("This update cannot be narrated. Try a shorter English sentence.");
  const entry = voices.file(`${KITTEN_VOICE_KEYS[voice]}.npy`);
  if (!entry) throw new Error("Kitten voice data is missing.");
  const npy = await entry.async("uint8array");
  const view = new DataView(npy.buffer, npy.byteOffset, npy.byteLength);
  const headerOffset = npy[6] === 1 ? 10 : 12;
  const headerLength = npy[6] === 1 ? view.getUint16(8, true) : view.getUint32(8, true);
  const header = new TextDecoder().decode(npy.subarray(headerOffset, headerOffset + headerLength));
  const shape = /'shape':\s*\((\d+),\s*(\d+)/.exec(header);
  if (!shape || !header.includes("<f4") || !header.includes("False"))
    throw new Error("Unsupported Kitten voice format.");
  const count = Number(shape[1]);
  const dimension = Number(shape[2]);
  const offset = headerOffset + headerLength + Math.min(text.length, count - 1) * dimension * 4;
  const style = new Float32Array(npy.slice(offset, offset + dimension * 4).buffer);
  const outputs = await session.run({
    input_ids: new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    style: new ort.Tensor("float32", style, [1, dimension]),
    speed: new ort.Tensor("float32", Float32Array.of(rate * (voice === "Hugo" ? 0.9 : 0.8)), [1]),
  });
  const output = outputs[session.outputNames[0]!];
  if (!output || !(output.data instanceof Float32Array))
    throw new Error("Kitten returned no audio.");
  const samples = output.data.slice(0, Math.max(0, output.data.length - 5000));
  for (const tensor of Object.values(outputs)) tensor.dispose();
  if (!samples.length || samples.some((sample) => !Number.isFinite(sample)))
    throw new Error("Kitten returned invalid audio.");
  send({ type: "audio", samples });
}
self.addEventListener("message", (event: MessageEvent<KittenWorkerRequest>) => {
  void generate(event.data).catch((error: unknown) =>
    send({
      type: "error",
      message: error instanceof Error ? error.message : "Kitten speech generation failed.",
    }),
  );
});
