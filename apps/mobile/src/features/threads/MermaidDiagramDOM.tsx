"use dom";

import { renderMermaidImage } from "@t3tools/client-runtime/mermaid-browser";
import { useEffect, useState } from "react";

export default function MermaidDiagramDOM({
  source,
  theme,
  onError,
}: {
  source: string;
  theme: "light" | "dark";
  onError: () => Promise<void>;
  dom?: import("expo/dom").DOMProps;
}) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    void renderMermaidImage(source, theme).then(
      (image) => {
        if (!cancelled) setUrl(image);
      },
      () => {
        if (!cancelled) void onError();
      },
    );
    return () => {
      cancelled = true;
    };
  }, [source, theme, onError]);
  return (
    <div style={{ minHeight: 60, padding: 8, color: theme === "dark" ? "white" : "black" }}>
      {url ? (
        <img
          src={url}
          alt="Mermaid diagram"
          style={{ width: "100%", maxHeight: 640, objectFit: "contain", display: "block" }}
        />
      ) : (
        <span>Rendering diagram…</span>
      )}
    </div>
  );
}
