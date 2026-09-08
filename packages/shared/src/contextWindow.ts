import type {
  ContextWindowOption,
  ModelSelection,
  SelectProviderOptionDescriptor,
} from "@t3tools/contracts";

export function parseContextWindowTokens(value: string): number | undefined {
  if (!/^[1-9]\d*$/.test(value)) return undefined;
  const tokens = Number(value);
  return Number.isSafeInteger(tokens) ? tokens : undefined;
}

export function contextWindowTokens(
  context: ContextWindowOption,
  value: string | undefined,
): number | undefined {
  if (value === "default") return context.defaultTokens;
  if (value === "maximum") return context.maxTokens;
  return value
    ? parseContextWindowTokens(value)
    : (context.configuredTokens ?? context.defaultTokens);
}

export function contextWindowValidationMessage(
  value: string,
  maximum?: number,
): string | undefined {
  const tokens = parseContextWindowTokens(value);
  if (tokens === undefined) return "Enter a whole number greater than zero.";
  if (maximum !== undefined && tokens > maximum)
    return `Enter ${maximum.toLocaleString("en-US")} tokens or fewer.`;
  return undefined;
}

export function formatContextTokens(tokens: number | undefined): string {
  return tokens === undefined ? "Not reported" : tokens.toLocaleString("en-US");
}

export function buildContextWindowDescriptor(
  context: ContextWindowOption,
): SelectProviderOptionDescriptor {
  return {
    id: "contextWindow",
    label: "Context Window",
    type: "select",
    options: [
      {
        id: "default",
        label: "Default",
        description: formatContextTokens(context.defaultTokens),
        isDefault: true,
      },
      {
        id: "maximum",
        label: "Highest available",
        description: formatContextTokens(context.maxTokens),
      },
    ],
    currentValue:
      context.configuredTokens !== undefined && context.configuredTokens !== context.defaultTokens
        ? String(context.configuredTokens)
        : "default",
    contextWindow: context,
  };
}

/** Context overrides are read at session start; effort and service tier still change per turn. */
export function codexContextWindowRequiresRestart(
  previous: ModelSelection | undefined,
  next: ModelSelection | undefined,
): boolean {
  const before = previous?.options?.find((option) => option.id === "contextWindow")?.value;
  const after = next?.options?.find((option) => option.id === "contextWindow")?.value;
  return (
    before !== after ||
    ((before !== undefined || after !== undefined) && previous?.model !== next?.model)
  );
}
