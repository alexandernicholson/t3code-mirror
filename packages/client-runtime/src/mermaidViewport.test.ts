import { describe, expect, it, vi } from "vite-plus/test";

import { createMermaidViewport, MERMAID_MAX_ZOOM, MERMAID_MIN_ZOOM } from "./mermaidViewport.ts";

function setup() {
  const captures = new Set<number>();
  const viewport = Object.assign(new EventTarget(), {
    style: { cursor: "grab" },
    focus: vi.fn(),
    setPointerCapture: (id: number) => captures.add(id),
    hasPointerCapture: (id: number) => captures.has(id),
    releasePointerCapture: (id: number) => captures.delete(id),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
  });
  const image = { style: { transform: "" } };
  const zoom = vi.fn();
  const controls = createMermaidViewport(
    viewport as unknown as HTMLElement,
    image as HTMLImageElement,
    zoom,
  );
  function pointer(type: string, clientX: number, clientY: number, pointerId = 1, button = 0) {
    viewport.dispatchEvent(
      Object.assign(new Event(type, { cancelable: true }), {
        clientX,
        clientY,
        pointerId,
        button,
      }),
    );
  }
  return { viewport, image, zoom, controls, captures, pointer };
}

describe("Mermaid viewport", () => {
  it("bounds button zoom and resets both zoom and drag offset", () => {
    const { controls, image, zoom, pointer } = setup();
    for (let i = 0; i < 30; i++) controls.zoomIn();
    expect(zoom).toHaveBeenLastCalledWith(MERMAID_MAX_ZOOM);
    for (let i = 0; i < 50; i++) controls.zoomOut();
    expect(zoom).toHaveBeenLastCalledWith(MERMAID_MIN_ZOOM);
    pointer("pointerdown", 100, 100);
    pointer("pointermove", 160, 120);
    expect(image.style.transform).toBe("translate(60px, 20px) scale(0.25)");
    controls.reset();
    expect(image.style.transform).toBe("translate(0px, 0px) scale(1)");
    controls.dispose();
  });

  it("pans in screen pixels even when zoomed and stops on pointer cancellation", () => {
    const { controls, image, pointer, captures } = setup();
    controls.zoomIn();
    pointer("pointerdown", 100, 100);
    pointer("pointermove", 140, 70);
    expect(image.style.transform).toBe("translate(40px, -30px) scale(1.25)");
    pointer("pointercancel", 140, 70);
    pointer("pointermove", 200, 200);
    expect(image.style.transform).toBe("translate(40px, -30px) scale(1.25)");
    expect(captures.size).toBe(0);
    controls.dispose();
  });

  it("preserves ordinary page scrolling and keeps the point under the cursor fixed when zooming", () => {
    const { controls, viewport, image } = setup();
    const scroll = new Event("wheel", { cancelable: true });
    Object.assign(scroll, { deltaY: -50, deltaMode: 0, clientX: 300, clientY: 150 });
    viewport.dispatchEvent(scroll);
    expect(scroll.defaultPrevented).toBe(false);
    expect(image.style.transform).toBe("translate(0px, 0px) scale(1)");

    const zoom = new Event("wheel", { cancelable: true });
    Object.assign(zoom, {
      ctrlKey: true,
      deltaY: -Math.log(2) * 100,
      deltaMode: 0,
      clientX: 300,
      clientY: 150,
    });
    viewport.dispatchEvent(zoom);
    expect(zoom.defaultPrevented).toBe(true);
    // The diagram point 100 px right of center stays at that screen position.
    expect(image.style.transform).toBe("translate(-100px, 0px) scale(2)");
    controls.dispose();
  });

  it("pinches around the fingers and continues panning after one finger lifts", () => {
    const { controls, pointer, image } = setup();
    pointer("pointerdown", 100, 150, 1);
    pointer("pointerdown", 200, 150, 2);
    pointer("pointermove", 300, 150, 2);
    expect(image.style.transform).toBe("translate(100px, 0px) scale(2)");
    pointer("pointerup", 100, 150, 1);
    pointer("pointermove", 320, 180, 2);
    expect(image.style.transform).toBe("translate(120px, 30px) scale(2)");
    controls.dispose();
  });

  it("supports keyboard pan, zoom, and reset without intercepting unrelated keys", () => {
    const { controls, viewport, image } = setup();
    function key(value: string) {
      const event = Object.assign(new Event("keydown", { cancelable: true }), { key: value });
      viewport.dispatchEvent(event);
      return event;
    }
    key("+");
    key("ArrowRight");
    expect(image.style.transform).toBe("translate(-40px, 0px) scale(1.25)");
    key("0");
    expect(image.style.transform).toBe("translate(0px, 0px) scale(1)");
    expect(key("Tab").defaultPrevented).toBe(false);
    controls.dispose();
  });

  it("releases captures and listeners when the diagram is removed", () => {
    const { controls, pointer, image, captures } = setup();
    pointer("pointerdown", 100, 100, 1, 2);
    expect(captures.size).toBe(0);
    pointer("pointerdown", 100, 100);
    controls.dispose();
    expect(captures.size).toBe(0);
    pointer("pointermove", 160, 160);
    expect(image.style.transform).toBe("translate(0px, 0px) scale(1)");
  });
});
