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

describe("Mermaid PNG export", () => {
  function setup(width = 600, height = 400) {
    const attributes = new Map<string, string>();
    const svg = {
      viewBox: { baseVal: { width, height } },
      style: { maxWidth: "600px" },
      setAttribute: (name: string, value: string) => attributes.set(name, value),
    };
    const context = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
    const toDataURL = vi.fn(() => "data:image/png;base64,cG5n");
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => context), toDataURL };
    const decode = vi.fn(async () => {});
    const images: { src: string }[] = [];
    vi.stubGlobal(
      "DOMParser",
      class {
        parseFromString() {
          return { querySelector: () => svg };
        }
      },
    );
    vi.stubGlobal(
      "XMLSerializer",
      class {
        serializeToString() {
          return `<svg width="${attributes.get("width")}" height="${attributes.get("height")}"/>`;
        }
      },
    );
    vi.stubGlobal(
      "Image",
      class {
        src = "";
        decode = decode;
        constructor() {
          images.push(this);
        }
      },
    );
    vi.stubGlobal("document", { createElement: () => canvas });
    return { canvas, context, attributes, images, decode, toDataURL };
  }

  it.each(["light", "dark"] as const)(
    "exports the full diagram at 2x resolution on a %s background",
    async (theme) => {
      const { exportMermaidPng } = await import("./mermaidBrowser.ts");
      const { canvas, context, attributes, images } = setup();
      await expect(exportMermaidPng("data:image/svg+xml,%3Csvg%2F%3E", theme)).resolves.toBe(
        "data:image/png;base64,cG5n",
      );
      expect(attributes.get("width")).toBe("1200");
      expect(attributes.get("height")).toBe("800");
      expect(context.fillStyle).toBe(theme === "dark" ? "#1f2020" : "#ffffff");
      expect(context.fillRect).toHaveBeenCalledWith(0, 0, 1200, 800);
      expect(context.drawImage).toHaveBeenCalledWith(images[0], 0, 0, 1200, 800);
      expect(canvas.width).toBe(0);
      expect(canvas.height).toBe(0);
    },
  );

  it("bounds large exports while preserving their aspect ratio", async () => {
    const { exportMermaidPng } = await import("./mermaidBrowser.ts");
    const { context } = setup(20_000, 10_000);
    await exportMermaidPng("data:image/svg+xml,%3Csvg%2F%3E", "light");
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 4096, 2048);
  });

  it("rejects unusable dimensions without decoding or allocating a canvas", async () => {
    const { exportMermaidPng } = await import("./mermaidBrowser.ts");
    const { decode, canvas } = setup(0, 400);
    await expect(exportMermaidPng("data:image/svg+xml,%3Csvg%2F%3E", "light")).rejects.toThrow(
      "no usable dimensions",
    );
    expect(decode).not.toHaveBeenCalled();
    expect(canvas.getContext).not.toHaveBeenCalled();
  });

  it("reports decoding and encoding failures and releases canvas memory", async () => {
    const { exportMermaidPng } = await import("./mermaidBrowser.ts");
    const { decode, canvas, toDataURL } = setup();
    decode.mockRejectedValueOnce(new Error("Invalid SVG"));
    await expect(exportMermaidPng("data:image/svg+xml,%3Csvg%2F%3E", "light")).rejects.toThrow(
      "Invalid SVG",
    );
    toDataURL.mockReturnValue("data:,");
    await expect(exportMermaidPng("data:image/svg+xml,%3Csvg%2F%3E", "light")).rejects.toThrow(
      "could not be converted",
    );
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });
});
