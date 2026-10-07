import { describe, expect, it } from "@effect/vitest";

import { parseOmpModelsJson } from "./OmpProvider.ts";

describe("OMP provider model discovery", () => {
  it("parses the machine-readable OMP model catalog", () => {
    expect(
      parseOmpModelsJson(
        JSON.stringify({
          models: [
            {
              provider: "anthropic",
              id: "claude-sonnet-4-6",
              selector: "anthropic/claude-sonnet-4-6",
              name: "Claude Sonnet 4.6",
              contextWindow: 200000,
              maxTokens: 64000,
              reasoning: true,
              thinking: ["low", "high"],
              input: ["text", "image"],
              cost: {},
            },
          ],
        }),
      ),
    ).toEqual([
      expect.objectContaining({
        slug: "anthropic/claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        capabilities: {
          optionDescriptors: [
            expect.objectContaining({
              id: "reasoningEffort",
              options: [
                { id: "low", label: "low" },
                { id: "high", label: "high" },
              ],
            }),
          ],
        },
      }),
    ]);
  });

  it("rejects malformed output instead of inventing models", () => {
    expect(parseOmpModelsJson("not json")).toEqual([]);
  });
});
