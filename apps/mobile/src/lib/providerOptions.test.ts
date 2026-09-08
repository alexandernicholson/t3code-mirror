import { describe, expect, it } from "vite-plus/test";

import type { ModelCapabilities } from "@t3tools/contracts";

import { applyProviderOptionSelection, resolveProviderOptionDescriptors } from "./providerOptions";
import { buildContextWindowDescriptor } from "@t3tools/shared/contextWindow";

const CODEX_CAPABILITIES: ModelCapabilities = {
  optionDescriptors: [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [
        { id: "medium", label: "Medium", isDefault: true },
        { id: "high", label: "High" },
      ],
      currentValue: "medium",
    },
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard", isDefault: true },
        { id: "priority", label: "Fast" },
      ],
      currentValue: "default",
    },
  ],
};

describe("mobile provider options", () => {
  it("stores custom context limits and restores named options", () => {
    const descriptor = buildContextWindowDescriptor({ defaultTokens: 272_000, maxTokens: 872_000 });
    const capabilities = { optionDescriptors: [descriptor] };
    const custom = applyProviderOptionSelection([descriptor], {
      id: "contextWindow",
      value: "500000",
    });
    expect(custom).toEqual([{ id: "contextWindow", value: "500000" }]);
    const reloaded = resolveProviderOptionDescriptors({ capabilities, selections: custom });
    expect(reloaded[0]?.currentValue).toBe("500000");
    expect(
      applyProviderOptionSelection(reloaded, { id: "contextWindow", value: "default" }),
    ).toEqual([{ id: "contextWindow", value: "default" }]);
    expect(
      applyProviderOptionSelection(reloaded, { id: "contextWindow", value: "1000000" }),
    ).toBeNull();
  });

  it("updates generic select options without knowing provider-specific ids", () => {
    const descriptors = resolveProviderOptionDescriptors({
      capabilities: CODEX_CAPABILITIES,
      selections: undefined,
    });

    expect(
      applyProviderOptionSelection(descriptors, { id: "serviceTier", value: "priority" }),
    ).toEqual([
      { id: "reasoningEffort", value: "medium" },
      { id: "serviceTier", value: "priority" },
    ]);
    // Choices the model doesn't advertise are rejected, not stored.
    expect(
      applyProviderOptionSelection(descriptors, { id: "serviceTier", value: "turbo" }),
    ).toBeNull();
    expect(applyProviderOptionSelection(descriptors, { id: "unknown", value: "high" })).toBeNull();
  });

  it("updates generic boolean options", () => {
    const descriptors = resolveProviderOptionDescriptors({
      capabilities: {
        optionDescriptors: [{ id: "fastMode", label: "Fast Mode", type: "boolean" }],
      },
      selections: undefined,
    });

    expect(applyProviderOptionSelection(descriptors, { id: "fastMode", value: true })).toEqual([
      { id: "fastMode", value: true },
    ]);
  });
});
