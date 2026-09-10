"use dom";

import { exportMermaidPng, renderMermaidImage } from "@t3tools/client-runtime/mermaid-browser";
import {
  createMermaidViewport,
  MERMAID_MAX_ZOOM,
  MERMAID_MIN_ZOOM,
} from "@t3tools/client-runtime/mermaid-viewport";
import { useEffect, useRef, useState, type CSSProperties } from "react";

const buttonStyle: CSSProperties = {
  minWidth: 44,
  minHeight: 44,
  padding: "4px 8px",
  border: 0,
  borderRadius: 6,
  background: "transparent",
  color: "inherit",
  font: "inherit",
  cursor: "pointer",
};

export default function MermaidDiagramDOM({
  source,
  theme,
  onError,
  onExport,
}: {
  source: string;
  theme: "light" | "dark";
  onError: () => Promise<void>;
  onExport: (png: string) => Promise<void>;
  dom?: import("expo/dom").DOMProps;
}) {
  const [url, setUrl] = useState<string>();
  const viewport = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const controls = useRef<ReturnType<typeof createMermaidViewport> | null>(null);
  const [zoom, setZoom] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string>();
  useEffect(() => {
    if (!url || !viewport.current || !image.current) return;
    const controller = createMermaidViewport(viewport.current, image.current, setZoom);
    controls.current = controller;
    return () => {
      controller.dispose();
      controls.current = null;
    };
  }, [url]);
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

  async function exportPng() {
    if (!url || exporting) return;
    setExporting(true);
    setExportError(undefined);
    try {
      await onExport(await exportMermaidPng(url, theme));
    } catch {
      setExportError("Could not export this diagram as PNG. Try again.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div
      style={{
        minHeight: 60,
        color: theme === "dark" ? "white" : "black",
        fontFamily: "system-ui, sans-serif",
        fontSize: 12,
      }}
    >
      {url ? (
        <>
          <div
            style={{ display: "flex", alignItems: "center", flexWrap: "wrap", padding: "0 8px" }}
          >
            <button
              type="button"
              style={{ ...buttonStyle, opacity: zoom <= MERMAID_MIN_ZOOM ? 0.4 : 1 }}
              aria-label="Zoom out"
              disabled={zoom <= MERMAID_MIN_ZOOM}
              onClick={() => controls.current?.zoomOut()}
            >
              −
            </button>
            <button
              type="button"
              style={{ ...buttonStyle, fontVariantNumeric: "tabular-nums" }}
              aria-label="Reset zoom and pan"
              onClick={() => controls.current?.reset()}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              style={{ ...buttonStyle, opacity: zoom >= MERMAID_MAX_ZOOM ? 0.4 : 1 }}
              aria-label="Zoom in"
              disabled={zoom >= MERMAID_MAX_ZOOM}
              onClick={() => controls.current?.zoomIn()}
            >
              +
            </button>
            <button
              type="button"
              style={{ ...buttonStyle, marginLeft: "auto", opacity: exporting ? 0.4 : 1 }}
              disabled={exporting}
              onClick={() => void exportPng()}
            >
              {exporting ? "Exporting…" : "Export PNG"}
            </button>
          </div>
          {exportError ? (
            <p role="alert" style={{ padding: "0 8px" }}>
              {exportError}
            </p>
          ) : null}
          <div
            ref={viewport}
            tabIndex={0}
            role="region"
            aria-label="Mermaid diagram viewer"
            aria-description="Drag to pan, pinch to zoom, or use the zoom buttons. Tap the zoom percentage to reset."
            style={{ overflow: "hidden", touchAction: "none", cursor: "grab", padding: 8 }}
          >
            <img
              ref={image}
              src={url}
              alt="Mermaid diagram"
              draggable={false}
              style={{
                width: "100%",
                maxHeight: 640,
                objectFit: "contain",
                display: "block",
                pointerEvents: "none",
                userSelect: "none",
              }}
            />
          </div>
          <p style={{ margin: 0, padding: "0 8px 8px", textAlign: "center", opacity: 0.65 }}>
            Drag to pan · Pinch to zoom · Tap % to reset
          </p>
        </>
      ) : (
        <span>Rendering diagram…</span>
      )}
    </div>
  );
}
