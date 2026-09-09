import { it } from "@effect/vitest";
import { expect } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { DEFAULT_SERVER_SETTINGS, ProviderInstanceId } from "@t3tools/contracts";
import { makeSummarizeNarration } from "./Narration.ts";

it.effect("uses the current environment's default model and human-focused instructions", () =>
  Effect.gen(function* () {
    const summarize = makeSummarizeNarration(Effect.succeed(DEFAULT_SERVER_SETTINGS), {
      generateNarration: (input) => {
        expect(input.modelSelection).toEqual(DEFAULT_SERVER_SETTINGS.textGenerationModelSelection);
        expect(input.instructions).toContain("at most 20 words");
        expect(input.message).toBe("The tests passed.");
        expect(input.cwd).toBe("/project");
        return Effect.succeed({ text: "The fix passed its tests." });
      },
    });
    expect(yield* summarize({ cwd: "/project", text: "The tests passed." })).toEqual({
      text: "The fix passed its tests.",
    });
  }),
);

it.effect("honors a separate model and custom instructions", () =>
  Effect.gen(function* () {
    const modelSelection = { instanceId: ProviderInstanceId.make("claude-work"), model: "sonnet" };
    const summarize = makeSummarizeNarration(
      Effect.succeed({
        ...DEFAULT_SERVER_SETTINGS,
        narrationModelSelection: modelSelection,
        narrationInstructions: "Mention only blockers.",
      }),
      {
        generateNarration: (input) => {
          expect(input.modelSelection).toEqual(modelSelection);
          expect(input.instructions).toBe("Mention only blockers.");
          return Effect.succeed({ text: "" });
        },
      },
    );
    expect(yield* summarize({ cwd: "/project", text: "Working on the fix." })).toEqual({
      text: "",
    });
  }),
);
