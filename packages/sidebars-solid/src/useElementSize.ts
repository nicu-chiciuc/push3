import { createEffect, onCleanup } from "solid-js";

export type ElementSize = {
  heightPx: number;
  widthPx: number;
};

export function createElementSize(
  getElement: () => HTMLElement | undefined,
  onElementSizeChange: (elementSize: ElementSize) => void,
) {
  createEffect(() => {
    const node = getElement();
    if (!node) {
      return;
    }

    const updateElementSize = () => {
      const bounds = node.getBoundingClientRect();
      onElementSizeChange({
        heightPx: Math.max(0, Math.round(bounds.height)),
        widthPx: Math.max(0, Math.round(bounds.width)),
      });
    };

    updateElementSize();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateElementSize);
      onCleanup(() => {
        window.removeEventListener("resize", updateElementSize);
      });
      return;
    }

    const resizeObserver = new ResizeObserver(updateElementSize);
    resizeObserver.observe(node);
    window.addEventListener("resize", updateElementSize);
    onCleanup(() => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateElementSize);
    });
  });
}
