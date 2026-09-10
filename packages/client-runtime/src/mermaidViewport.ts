export const MERMAID_MIN_ZOOM = 0.25;
export const MERMAID_MAX_ZOOM = 8;
const ZOOM_STEP = 1.25;

/** Updates only the image transform during gestures, without rerendering the conversation. */
export function createMermaidViewport(
  viewport: HTMLElement,
  image: HTMLImageElement,
  onZoomChange: (zoom: number) => void,
) {
  let zoom = 1;
  let x = 0;
  let y = 0;
  const pointers = new Map<number, { x: number; y: number }>();

  function paint() {
    image.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
  }

  function zoomAt(next: number, anchorX = 0, anchorY = 0) {
    const clamped = Math.min(MERMAID_MAX_ZOOM, Math.max(MERMAID_MIN_ZOOM, next));
    const ratio = clamped / zoom;
    x = anchorX - (anchorX - x) * ratio;
    y = anchorY - (anchorY - y) * ratio;
    if (clamped !== zoom) onZoomChange(clamped);
    zoom = clamped;
    paint();
  }

  function reset() {
    zoom = 1;
    x = 0;
    y = 0;
    onZoomChange(zoom);
    paint();
  }

  function gesture() {
    const [first, second] = pointers.values();
    if (!first) return;
    return second
      ? {
          x: (first.x + second.x) / 2,
          y: (first.y + second.y) / 2,
          distance: Math.hypot(second.x - first.x, second.y - first.y),
        }
      : { ...first, distance: 0 };
  }

  function pointerDown(event: PointerEvent) {
    if (event.button !== 0 || pointers.size >= 2) return;
    event.preventDefault();
    viewport.focus({ preventScroll: true });
    viewport.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    viewport.style.cursor = "grabbing";
  }

  function pointerMove(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return;
    event.preventDefault();
    const before = gesture()!;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const after = gesture()!;
    if (before.distance > 0 && after.distance > 0) {
      const bounds = viewport.getBoundingClientRect();
      zoomAt(
        zoom * (after.distance / before.distance),
        before.x - bounds.left - bounds.width / 2,
        before.y - bounds.top - bounds.height / 2,
      );
    }
    x += after.x - before.x;
    y += after.y - before.y;
    paint();
  }

  function pointerUp(event: PointerEvent) {
    pointers.delete(event.pointerId);
    if (viewport.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }
    if (pointers.size === 0) viewport.style.cursor = "grab";
  }

  function wheel(event: WheelEvent) {
    // Ordinary scrolling must still scroll the conversation.
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const bounds = viewport.getBoundingClientRect();
    const delta =
      event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
    zoomAt(
      zoom * Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.01),
      event.clientX - bounds.left - bounds.width / 2,
      event.clientY - bounds.top - bounds.height / 2,
    );
  }

  function keyDown(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    switch (event.key) {
      case "+":
      case "=":
        zoomAt(zoom * ZOOM_STEP);
        break;
      case "-":
        zoomAt(zoom / ZOOM_STEP);
        break;
      case "0":
      case "Home":
        reset();
        break;
      case "ArrowLeft":
        x += 40;
        break;
      case "ArrowRight":
        x -= 40;
        break;
      case "ArrowUp":
        y += 40;
        break;
      case "ArrowDown":
        y -= 40;
        break;
      default:
        return;
    }
    event.preventDefault();
    paint();
  }

  viewport.addEventListener("pointerdown", pointerDown);
  viewport.addEventListener("pointermove", pointerMove);
  viewport.addEventListener("pointerup", pointerUp);
  viewport.addEventListener("pointercancel", pointerUp);
  viewport.addEventListener("lostpointercapture", pointerUp);
  viewport.addEventListener("wheel", wheel, { passive: false });
  viewport.addEventListener("keydown", keyDown);
  reset();

  return {
    zoomIn: () => zoomAt(zoom * ZOOM_STEP),
    zoomOut: () => zoomAt(zoom / ZOOM_STEP),
    reset,
    dispose() {
      viewport.removeEventListener("pointerdown", pointerDown);
      viewport.removeEventListener("pointermove", pointerMove);
      viewport.removeEventListener("pointerup", pointerUp);
      viewport.removeEventListener("pointercancel", pointerUp);
      viewport.removeEventListener("lostpointercapture", pointerUp);
      viewport.removeEventListener("wheel", wheel);
      viewport.removeEventListener("keydown", keyDown);
      for (const id of pointers.keys()) {
        if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id);
      }
      pointers.clear();
      viewport.style.cursor = "grab";
    },
  };
}
