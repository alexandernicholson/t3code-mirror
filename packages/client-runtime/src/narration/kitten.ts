export const KITTEN_REVISION = "84781d74e29ee25217551556398b42f80593a813";
export const KITTEN_BASE_URL = `https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8/resolve/${KITTEN_REVISION}`;
export const KITTEN_FILES = [
  { name: "kitten_tts_nano_v0_8.onnx", size: 24369971 },
  { name: "voices.npz", size: 3278902 },
] as const;
export const KITTEN_VOICES = [
  "Bella",
  "Jasper",
  "Luna",
  "Bruno",
  "Rosie",
  "Hugo",
  "Kiki",
  "Leo",
] as const;
export type KittenVoice = (typeof KITTEN_VOICES)[number];
export const KITTEN_SAMPLE_RATE = 24000;
export type KittenProgress = { phase: "downloading" | "loading" | "ready"; percent: number };
export type KittenWorkerRequest = { text: string; voice: KittenVoice; rate: number };
export type KittenWorkerResponse =
  | { type: "progress"; progress: KittenProgress }
  | { type: "audio"; samples: Float32Array<ArrayBuffer> }
  | { type: "error"; message: string };

// Vocabulary and padding follow KittenML/KittenTTS's TextCleaner (Apache-2.0).
const symbols = [
  ...'$;:,.!?¡¿—…"«»"" ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘\'̩\'ᵻ',
];
const vocabulary = new Map(symbols.map((symbol, index) => [symbol, index]));
export function kittenTokenIds(phonemes: string): number[] {
  const separated = (
    phonemes.replaceAll("_", "").match(/[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]/gu) ?? []
  ).join(" ");
  return [
    0,
    ...[...separated].flatMap((symbol) => {
      const id = vocabulary.get(symbol);
      return id === undefined ? [] : [id];
    }),
    10,
    0,
  ];
}
export const KITTEN_VOICE_KEYS: Record<KittenVoice, string> = {
  Bella: "expr-voice-2-f",
  Jasper: "expr-voice-2-m",
  Luna: "expr-voice-3-f",
  Bruno: "expr-voice-3-m",
  Rosie: "expr-voice-4-f",
  Hugo: "expr-voice-4-m",
  Kiki: "expr-voice-5-f",
  Leo: "expr-voice-5-m",
};
