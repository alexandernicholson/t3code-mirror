import { exportMermaidPng, renderMermaidImage } from "@t3tools/client-runtime/mermaid-browser";
import {
  createMermaidViewport,
  MERMAID_MAX_ZOOM,
  MERMAID_MIN_ZOOM,
} from "@t3tools/client-runtime/mermaid-viewport";
import { DownloadIcon, MinusIcon, PlusIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { downloadMedia } from "./media/mediaContent";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

function MermaidViewer({
  url,
  theme,
  children,
}: {
  url: string;
  theme: "light" | "dark";
  children: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const controls = useRef<ReturnType<typeof createMermaidViewport> | null>(null);
  const [zoom, setZoom] = useState(1);
  const [showSource, setShowSource] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string>();

  useEffect(() => {
    if (showSource || !viewport.current || !image.current) return;
    const controller = createMermaidViewport(viewport.current, image.current, setZoom);
    controls.current = controller;
    return () => {
      controller.dispose();
      controls.current = null;
    };
  }, [showSource]);

  async function exportPng() {
    if (exporting) return;
    setExporting(true);
    setExportError(undefined);
    try {
      await downloadMedia(await exportMermaidPng(url, theme), "mermaid-diagram.png");
    } catch {
      setExportError("Could not export this diagram as PNG. Try again.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-1 px-2 pt-1">
        {!showSource ? (
          <div className="mr-auto flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Zoom out"
                    disabled={zoom <= MERMAID_MIN_ZOOM}
                    onClick={() => controls.current?.zoomOut()}
                  />
                }
              >
                <MinusIcon />
              </TooltipTrigger>
              <TooltipPopup>Zoom out</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="xs"
                    className="min-w-14 tabular-nums"
                    aria-label="Reset zoom and pan"
                    onClick={() => controls.current?.reset()}
                  />
                }
              >
                {Math.round(zoom * 100)}%
              </TooltipTrigger>
              <TooltipPopup>Reset zoom and pan</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Zoom in"
                    disabled={zoom >= MERMAID_MAX_ZOOM}
                    onClick={() => controls.current?.zoomIn()}
                  />
                }
              >
                <PlusIcon />
              </TooltipTrigger>
              <TooltipPopup>Zoom in</TooltipPopup>
            </Tooltip>
          </div>
        ) : null}
        <Button variant="ghost" size="xs" disabled={exporting} onClick={() => void exportPng()}>
          <DownloadIcon />
          {exporting ? "Exporting…" : "Export PNG"}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          aria-pressed={showSource}
          onClick={() => setShowSource(!showSource)}
        >
          {showSource ? "Show diagram" : "Show source"}
        </Button>
      </div>
      {exportError ? (
        <p className="px-3 pt-2 text-xs text-muted-foreground" role="alert">
          {exportError}
        </p>
      ) : null}
      {showSource ? (
        children
      ) : (
        <>
          <div
            ref={viewport}
            tabIndex={0}
            role="region"
            aria-label="Mermaid diagram viewer"
            aria-description="Drag to pan, pinch or Control/Command-scroll to zoom. Use arrow keys to pan, plus and minus to zoom, and zero to reset."
            className="touch-none cursor-grab overflow-hidden p-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <img
              ref={image}
              src={url}
              alt="Mermaid diagram"
              draggable={false}
              className="pointer-events-none mx-auto block max-h-[40rem] w-full select-none object-contain"
            />
          </div>
          <p className="px-3 pb-2 text-center text-xs text-muted-foreground">
            Drag to pan · Pinch or Ctrl/⌘ + scroll to zoom
          </p>
        </>
      )}
    </>
  );
}

export function MermaidDiagram({
  source,
  theme,
  isStreaming,
  children,
}: {
  source: string;
  theme: "light" | "dark";
  isStreaming: boolean;
  children: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  const [result, setResult] = useState<{ source: string; theme: string; url: string | null }>();

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || isStreaming) return;
    let cancelled = false;
    void renderMermaidImage(source, theme).then(
      (url) => {
        if (!cancelled) setResult({ source, theme, url });
      },
      () => {
        if (!cancelled) setResult({ source, theme, url: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [visible, isStreaming, source, theme]);

  const current = result?.source === source && result.theme === theme ? result : undefined;
  return (
    <div ref={container}>
      {!isStreaming && current?.url ? (
        <MermaidViewer key={current.url} url={current.url} theme={theme}>
          {children}
        </MermaidViewer>
      ) : (
        <>
          {!isStreaming && current?.url === null ? (
            <p className="px-3 pt-2 text-xs text-muted-foreground" role="status">
              Could not render this diagram. Showing source.
            </p>
          ) : null}
          {children}
        </>
      )}
    </div>
  );
}
