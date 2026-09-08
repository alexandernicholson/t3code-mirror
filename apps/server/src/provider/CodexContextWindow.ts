import { PositiveInt, type ContextWindowOption } from "@t3tools/contracts";
import { contextWindowTokens, contextWindowValidationMessage } from "@t3tools/shared/contextWindow";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { expandHomePath } from "../pathExpansion.ts";

const CatalogModel = Schema.Struct({
  slug: Schema.String,
  context_window: Schema.optional(Schema.NullOr(PositiveInt)),
  max_context_window: Schema.optional(Schema.NullOr(PositiveInt)),
  effective_context_window_percent: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  ),
});
const Catalog = Schema.Struct({ models: Schema.Array(Schema.Unknown) });
const decodeModel = Schema.decodeUnknownOption(CatalogModel);
const decodeCatalog = Schema.decodeUnknownEffect(Schema.fromJsonString(Catalog));

/** model/list omits these fields. Read the catalog owned by the same Codex instance. */
export const readCodexContextWindows = Effect.fn("readCodexContextWindows")(function* (input: {
  homePath?: string | undefined;
  environment?: NodeJS.ProcessEnv | undefined;
  cwd: string;
  config?: Readonly<Record<string, unknown>> | undefined;
  modelSlugs?: ReadonlyArray<string>;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const environment = input.environment ?? process.env;
  const home = expandHomePath(
    input.homePath ||
      environment.CODEX_HOME ||
      (environment.HOME ? path.join(environment.HOME, ".codex") : "~/.codex"),
  );
  const customCatalog = input.config?.model_catalog_json;
  const catalogPath =
    typeof customCatalog === "string" && customCatalog
      ? path.resolve(input.cwd, expandHomePath(customCatalog))
      : path.resolve(input.cwd, home, "models_cache.json");
  const catalog = yield* fs.readFileString(catalogPath).pipe(
    Effect.flatMap(decodeCatalog),
    Effect.orElseSucceed(() => ({ models: [] })),
  );
  const configured = input.config?.model_context_window;
  const configuredTokens =
    typeof configured === "number" && Number.isSafeInteger(configured) && configured > 0
      ? configured
      : undefined;
  const contexts = new Map<string, ContextWindowOption>();
  for (const raw of catalog.models) {
    const decoded = decodeModel(raw);
    if (Option.isNone(decoded)) continue;
    const model = decoded.value;
    const defaultTokens = model.context_window ?? model.max_context_window ?? undefined;
    const maxTokens = model.max_context_window ?? undefined;
    contexts.set(model.slug, {
      ...(defaultTokens !== undefined ? { defaultTokens } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...(configuredTokens !== undefined
        ? {
            configuredTokens:
              maxTokens !== undefined ? Math.min(configuredTokens, maxTokens) : configuredTokens,
          }
        : defaultTokens !== undefined
          ? { configuredTokens: defaultTokens }
          : {}),
      ...(model.effective_context_window_percent !== undefined
        ? { effectivePercent: model.effective_context_window_percent }
        : {}),
    });
  }
  if (configuredTokens !== undefined) {
    for (const slug of input.modelSlugs ?? []) {
      if (!contexts.has(slug)) contexts.set(slug, { configuredTokens });
    }
  }
  return contexts;
});

export function resolveCodexContextWindow(
  value: string,
  context: ContextWindowOption,
): number | undefined {
  // Missing metadata must not prevent ordinary turns on older Codex versions.
  if (value === "default" && context.defaultTokens === undefined) return undefined;
  const tokens = contextWindowTokens(context, value);
  if (tokens === undefined) {
    throw new Error(
      value === "default" || value === "maximum"
        ? `Codex did not report this model's ${value === "default" ? "default" : "maximum"} context window. Refresh models or enter a custom limit.`
        : "Enter a whole number greater than zero for the context window.",
    );
  }
  const error = contextWindowValidationMessage(String(tokens), context.maxTokens);
  if (error) throw new Error(error);
  return tokens;
}
