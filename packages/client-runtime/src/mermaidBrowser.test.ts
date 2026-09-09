import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock("mermaid", () => ({ default: mermaid }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mermaid.render.mockResolvedValue({
    svg: '<svg viewBox="0 0 10 10"><text>A &amp; B</text></svg>',
  });
  vi.stubGlobal("document", { getElementById: vi.fn(() => null) });
});
afterEach(() => vi.unstubAllGlobals());

describe("Mermaid rendering", () => {
  it("coalesces identical renders and returns an inert image with animations disabled", async () => {
    const { renderMermaidImage } = await import("./mermaidBrowser.ts");
    const first = renderMermaidImage("graph TD; A-->B", "dark");
    expect(renderMermaidImage("graph TD; A-->B", "dark")).toBe(first);
    const url = await first;
    expect(url.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(decodeURIComponent(url)).toContain("animation:none!important");
    expect(mermaid.render).toHaveBeenCalledTimes(1);
  });

  it("serializes different themes so global configuration cannot race", async () => {
    const { renderMermaidImage } = await import("./mermaidBrowser.ts");
    const gate = Promise.withResolvers<{ svg: string }>();
    const started = Promise.withResolvers<void>();
    mermaid.render.mockImplementationOnce(() => {
      started.resolve();
      return gate.promise;
    });
    const dark = renderMermaidImage("graph TD; A-->B", "dark");
    const light = renderMermaidImage("graph TD; A-->B", "light");
    await started.promise;
    expect(mermaid.initialize).toHaveBeenCalledTimes(1);
    expect(mermaid.initialize.mock.calls[0]?.[0].theme).toBe("dark");
    gate.resolve({ svg: "<svg></svg>" });
    await Promise.all([dark, light]);
    expect(mermaid.initialize.mock.calls[1]?.[0].theme).toBe("default");
  });

  it("recovers after a parse failure and rejects oversized diagrams before rendering", async () => {
    const { renderMermaidImage, MERMAID_MAX_TEXT_SIZE } = await import("./mermaidBrowser.ts");
    mermaid.render.mockRejectedValueOnce(new Error("Invalid diagram"));
    await expect(renderMermaidImage("invalid", "light")).rejects.toThrow("Invalid diagram");
    await expect(renderMermaidImage("invalid", "light")).resolves.toMatch(/^data:image/);
    await expect(
      renderMermaidImage("x".repeat(MERMAID_MAX_TEXT_SIZE + 1), "light"),
    ).rejects.toThrow("too large");
    expect(mermaid.render).toHaveBeenCalledTimes(2);
  });

  it("bounds the render cache", async () => {
    const { renderMermaidImage } = await import("./mermaidBrowser.ts");
    for (let i = 0; i < 33; i++) await renderMermaidImage(`graph TD; A-->B${i}`, "light");
    await renderMermaidImage("graph TD; A-->B0", "light");
    expect(mermaid.render).toHaveBeenCalledTimes(34);
  });
});
