import {
  DEFAULT_SERVER_SETTINGS,
  TextGenerationError,
  type ServerSettings,
  type ServerSettingsError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { TextGeneration } from "./TextGeneration.ts";

/** Resolve preferences on every update so connected clients share the current configuration. */
export const makeSummarizeNarration = (
  getSettings: Effect.Effect<ServerSettings, ServerSettingsError>,
  textGeneration: Pick<TextGeneration["Service"], "generateNarration">,
) =>
  Effect.fn("Narration.summarize")(function* (input: { cwd: string; text: string }) {
    const settings = yield* getSettings;
    return yield* textGeneration
      .generateNarration({
        cwd: input.cwd,
        message: input.text,
        instructions:
          settings.narrationInstructions.trim() || DEFAULT_SERVER_SETTINGS.narrationInstructions,
        modelSelection: settings.narrationModelSelection ?? settings.textGenerationModelSelection,
      })
      .pipe(
        Effect.timeoutOrElse({
          duration: "20 seconds",
          orElse: () =>
            Effect.fail(
              new TextGenerationError({
                operation: "generateNarration",
                detail: "Narration summary took too long. Try a faster model.",
              }),
            ),
        }),
      );
  });
