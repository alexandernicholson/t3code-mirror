import { renderMermaidImage } from "@t3tools/client-runtime/mermaid-browser";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "./ui/button";

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
  const [showSource, setShowSource] = useState(false);
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
        <div className="flex justify-end px-2 pt-1">
          <Button
            variant="ghost"
            size="xs"
            aria-pressed={showSource}
            onClick={() => setShowSource(!showSource)}
          >
            {showSource ? "Show diagram" : "Show source"}
          </Button>
        </div>
      ) : null}
      {!isStreaming && current?.url && !showSource ? (
        <img
          src={current.url}
          alt="Mermaid diagram"
          className="mx-auto max-h-[40rem] w-full object-contain p-3"
        />
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
