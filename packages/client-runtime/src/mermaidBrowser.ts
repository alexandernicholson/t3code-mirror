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
