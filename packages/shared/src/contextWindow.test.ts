import { describe, expect, it } from "vite-plus/test";
import {
  ModelSelection,
  ProviderInstanceId,
  SelectProviderOptionDescriptor,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import {
  buildContextWindowDescriptor,
  codexContextWindowRequiresRestart,
  contextWindowTokens,
  contextWindowValidationMessage,
  parseContextWindowTokens,
} from "./contextWindow.ts";
import {
  buildProviderOptionSelectionsFromDescriptors,
  getProviderOptionCurrentLabel,
  getProviderOptionDescriptors,
} from "./model.ts";

const descriptorCodec = Schema.fromJsonString(SelectProviderOptionDescriptor);
const decodeDescriptor = Schema.decodeUnknownSync(descriptorCodec);
const encodeDescriptor = Schema.encodeSync(descriptorCodec);
const selectionCodec = Schema.fromJsonString(ModelSelection);
const decodeSelection = Schema.decodeUnknownSync(selectionCodec);
const encodeSelection = Schema.encodeSync(selectionCodec);

const context = {
  defaultTokens: 272_000,
  maxTokens: 872_000,
  configuredTokens: 272_000,
  effectivePercent: 95,
};
const selection = (value?: string, model = "gpt-6-astra"): ModelSelection => ({
  instanceId: ProviderInstanceId.make("codex"),
  model,
  ...(value ? { options: [{ id: "contextWindow", value }] } : {}),
});

describe("context window selections", () => {
  it("preserves a custom limit through wire decoding and option normalization", () => {
    const descriptor = decodeDescriptor(encodeDescriptor(buildContextWindowDescriptor(context)));
    const saved = decodeSelection(encodeSelection(selection("500000")));
    const descriptors = getProviderOptionDescriptors({
      caps: { optionDescriptors: [descriptor] },
      selections: saved.options,
    });
    expect(buildProviderOptionSelectionsFromDescriptors(descriptors)).toEqual([
      { id: "contextWindow", value: "500000" },
    ]);
    expect(getProviderOptionCurrentLabel(descriptors[0])).toBe("Custom · 500,000");
  });

  it("keeps the shipped default distinct from an existing Codex override", () => {
    const descriptor = buildContextWindowDescriptor({ ...context, configuredTokens: 600_000 });
    expect(descriptor.currentValue).toBe("600000");
    expect(contextWindowTokens(context, "default")).toBe(272_000);
    expect(contextWindowTokens(context, "maximum")).toBe(872_000);
    expect(contextWindowTokens(context, "500000")).toBe(500_000);
    expect(contextWindowTokens({}, "maximum")).toBeUndefined();
  });

  it.each(["", "0", "-1", "1.5", "1e6", "NaN", "9007199254740992"])(
    "rejects invalid token count %s",
    (value) => {
      expect(parseContextWindowTokens(value)).toBeUndefined();
      expect(contextWindowValidationMessage(value)).toBeDefined();
    },
  );

  it("validates custom limits without silently replacing a saved limit", () => {
    expect(contextWindowValidationMessage("872000", 872_000)).toBeUndefined();
    expect(contextWindowValidationMessage("1000000", 872_000)).toBe(
      "Enter 872,000 tokens or fewer.",
    );
    const descriptors = getProviderOptionDescriptors({
      caps: { optionDescriptors: [buildContextWindowDescriptor(context)] },
      selections: selection("1000000").options,
    });
    expect(descriptors[0]?.currentValue).toBe("1000000");
  });

  it("restarts for applying, clearing, or changing model-scoped context settings", () => {
    expect(codexContextWindowRequiresRestart(selection(), selection("maximum"))).toBe(true);
    expect(codexContextWindowRequiresRestart(selection("500000"), selection("default"))).toBe(true);
    expect(codexContextWindowRequiresRestart(selection("maximum"), selection())).toBe(true);
    expect(
      codexContextWindowRequiresRestart(selection("maximum"), selection("maximum", "gpt-5.4-mini")),
    ).toBe(true);
    expect(codexContextWindowRequiresRestart(selection("maximum"), selection("maximum"))).toBe(
      false,
    );
    expect(
      codexContextWindowRequiresRestart(selection(), selection(undefined, "gpt-5.6-sol")),
    ).toBe(false);
    expect(
      codexContextWindowRequiresRestart(selection(), {
        ...selection(),
        options: [{ id: "reasoningEffort", value: "high" }],
      }),
    ).toBe(false);
  });
});
