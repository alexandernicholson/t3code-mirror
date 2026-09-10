/** Browser-only renderer, also used inside mobile's DOM component. */
const diagrams = new Map<string, Promise<string>>();
const CACHE_LIMIT = 32;
export const MERMAID_MAX_TEXT_SIZE = 50_000;
let sequence = 0;
let rendering = Promise.resolve();

/** Serialize Mermaid's global configuration and cache bounded, inert SVG image URLs. */
export function renderMermaidImage(source: string, theme: "light" | "dark"): Promise<string> {
  if (source.length > MERMAID_MAX_TEXT_SIZE) {
    return Promise.reject(new Error("Diagram is too large to render."));
  }
  const key = `${theme}:${source}`;
  const cached = diagrams.get(key);
  if (cached) return cached;

  const result = rendering.then(async () => {
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: theme === "dark" ? "dark" : "default",
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      suppressErrorRendering: true,
      maxTextSize: MERMAID_MAX_TEXT_SIZE,
      maxEdges: 500,
      secure: [
        "secure",
        "securityLevel",
        "startOnLoad",
        "maxTextSize",
        "maxEdges",
        "suppressErrorRendering",
        "htmlLabels",
        "flowchart",
        "themeCSS",
      ],
    });
    const id = `t3-mermaid-${++sequence}`;
    try {
      const { svg } = await mermaid.render(id, source);
      // Diagrams in long conversations must not continuously repaint. Display
      // as an image, so authored links and scripts cannot access the client.
      const stillSvg = svg.replace(
        /(<svg\b[^>]*>)/,
        "$1<style>*{animation:none!important;transition:none!important}</style>",
      );
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(stillSvg)}`;
    } finally {
      document.getElementById(`d${id}`)?.remove();
    }
  });
  rendering = result.then(
    () => undefined,
    () => undefined,
  );
  diagrams.set(key, result);
  if (diagrams.size > CACHE_LIMIT) diagrams.delete(diagrams.keys().next().value!);
  // Failed loads can be retried after reconnecting or remounting.
  void result.catch(() => {
    if (diagrams.get(key) === result) diagrams.delete(key);
  });
  return result;
}

/** Rasterizes the complete diagram at 2x resolution, bounded for mobile canvas memory. */
export async function exportMermaidPng(url: string, theme: "light" | "dark"): Promise<string> {
  const svg = new DOMParser()
    .parseFromString(decodeURIComponent(url.slice(url.indexOf(",") + 1)), "image/svg+xml")
    .querySelector("svg");
  const bounds = svg?.viewBox.baseVal;
  if (
    !svg ||
    !bounds ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    throw new Error("This diagram has no usable dimensions for PNG export.");
  }

  const scale = Math.min(2, 4096 / bounds.width, 4096 / bounds.height);
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  // Mermaid often emits width="100%". Give the standalone image explicit
  // dimensions so SVG decoding does not fall back to a 300 x 150 viewport.
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.style.maxWidth = "none";
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PNG export is unavailable in this browser.");
    context.fillStyle = theme === "dark" ? "#1f2020" : "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const png = canvas.toDataURL("image/png");
    if (!png.startsWith("data:image/png;base64,")) {
      throw new Error("The diagram could not be converted to PNG.");
    }
    return png;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
