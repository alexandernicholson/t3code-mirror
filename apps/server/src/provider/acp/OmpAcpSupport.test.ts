import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  applyOmpAcpModelSelection,
  buildOmpAcpSpawnInput,
  ompModelsFromConfigOptions,
} from "./OmpAcpSupport.ts";

const configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "anthropic/claude-sonnet-4-6",
    options: [
      { value: "anthropic/claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
      { value: "openai/gpt-5.4", name: "GPT-5.4" },
    ],
  },
  {
    id: "thinking",
    name: "Thinking",
    category: "thought_level",
    type: "select",
    currentValue: "high",
    options: [
      { value: "off", name: "Off" },
      { value: "high", name: "High" },
      { value: "xhigh", name: "Extra High" },
    ],
  },
];

describe("OmpAcpSupport", () => {
  it("spawns the configured OMP binary in ACP mode with launch args and environment", () => {
    expect(
      buildOmpAcpSpawnInput(
        { binaryPath: "/opt/omp", launchArgs: "--profile work --no-extensions" },
        "/workspace",
        { OMP_PROFILE: "work" },
      ),
    ).toEqual({
      command: "/opt/omp",
      args: ["acp", "--profile", "work", "--no-extensions"],
      cwd: "/workspace",
      env: { OMP_PROFILE: "work" },
    });
  });

  it("maps T3 permission modes to OMP approval flags", () => {
    expect(buildOmpAcpSpawnInput(undefined, "/workspace", undefined, "full-access").args).toEqual([
      "acp",
      "--approval-mode",
      "yolo",
    ]);
    expect(
      buildOmpAcpSpawnInput(undefined, "/workspace", undefined, "auto-accept-edits").args,
    ).toEqual(["acp", "--approval-mode", "write"]);
    expect(buildOmpAcpSpawnInput(undefined, "/workspace", undefined, "auto").args).toEqual([
      "acp",
      "--approval-mode",
      "always-ask",
    ]);
    expect(
      buildOmpAcpSpawnInput(
        { binaryPath: "omp", launchArgs: "--approval-mode yolo" },
        "/workspace",
        undefined,
        "approval-required",
      ).args,
    ).toEqual(["acp", "--approval-mode", "yolo", "--approval-mode", "always-ask"]);
  });

  it("projects native model and thinking choices into T3 model capabilities", () => {
    expect(ompModelsFromConfigOptions(configOptions)).toEqual([
      expect.objectContaining({
        slug: "anthropic/claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        isDefault: true,
        capabilities: expect.objectContaining({
          optionDescriptors: [
            expect.objectContaining({
              id: "reasoningEffort",
              options: [
                expect.objectContaining({ id: "off" }),
                expect.objectContaining({ id: "high", isDefault: true }),
                expect.objectContaining({ id: "xhigh" }),
              ],
            }),
          ],
        }),
      }),
      expect.objectContaining({ slug: "openai/gpt-5.4", name: "GPT-5.4" }),
    ]);
  });

  it.effect("sets OMP model and thinking through ACP config options", () =>
    Effect.gen(function* () {
      const updates: Array<readonly [string, string | boolean]> = [];
      yield* applyOmpAcpModelSelection({
        runtime: {
          getConfigOptions: Effect.succeed(configOptions),
          setConfigOption: (id, value) =>
            Effect.sync(() => {
              updates.push([id, value]);
              return { configOptions };
            }),
        },
        model: "openai/gpt-5.4",
        selections: [{ id: "reasoningEffort", value: "xhigh" }],
        mapError: (cause) => cause,
      });

      expect(updates).toEqual([
        ["model", "openai/gpt-5.4"],
        ["thinking", "xhigh"],
      ]);
    }),
  );
});
