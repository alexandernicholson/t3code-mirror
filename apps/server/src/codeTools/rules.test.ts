import { describe, expect, it } from "vite-plus/test";
import { combineDiagnostics, regexPositions } from "./rules.ts";
import type { CodeDiagnostic } from "@t3tools/contracts";

describe("project-owned regex rules", () => {
  it("adds guidance without duplicating or losing distinct compiler issues at the same position", () => {
    const first: CodeDiagnostic = {
      file: "source.ts",
      line: 1,
      character: 1,
      severity: "error",
      source: "compiler",
      code: "",
      message: "First issue",
    };
    const second = { ...first, message: "Second issue" };
    const result = combineDiagnostics(
      [first, second],
      [{ ...first, severity: "warning", guidance: "Project guidance" }],
    );
    expect(result).toEqual([
      { ...first, severity: "warning", guidance: "Project guidance" },
      second,
    ]);
    expect(first.guidance).toBeUndefined();
  });
  it("finds multiline matches with 1-based positions", async () => {
    expect(await regexPositions("TODO", "ok\n  TODO: fix\nTODO")).toEqual([
      { line: 2, character: 3 },
      { line: 3, character: 1 },
    ]);
  });
  it("reports invalid rules instead of treating them as clean", async () => {
    await expect(regexPositions("[", "content")).rejects.toThrow();
  });
  it("terminates a pathological user regex without blocking the server", async () => {
    await expect(regexPositions("(a+)+$", "a".repeat(100_000) + "!")).rejects.toThrow(
      "execution limit",
    );
  });
});
