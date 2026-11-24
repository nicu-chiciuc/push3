import { createEffect, createSignal, onCleanup, Show, type JSX } from "solid-js";
import { clampNumber } from "./SidebarLayoutGeometryInternal.ts";
import { acquireSidebarResizeBodyStyleLock } from "./sidebarResizeBodyStyleLock.ts";

const KEYBOARD_RESIZE_TIMEOUT_MS = 120;

function getKeyboardResizeDeltaPx(event: KeyboardEvent, resizeFrom: "left" | "right") {
  const stepPx = event.shiftKey ? 96 : 24;

  if (resizeFrom === "left") {
    if (event.key === "ArrowRight") {
      return stepPx;
    }
    if (event.key === "ArrowLeft") {
      return -stepPx;
    }
    return 0;
  }

  if (event.key === "ArrowLeft") {
    return stepPx;
  }
  if (event.key === "ArrowRight") {
    return -stepPx;
  }
  return 0;
}

function getPointerDeltaPx(args: {
  event: PointerEvent;
  resizeFrom: "left" | "right";
  startClientPx: number;
}) {
  return (args.event.clientX - args.startClientPx) * (args.resizeFrom === "left" ? 1 : -1);
}

export type SidebarLayoutResizeHandleProps = {
  ariaControls: string;
  ariaLabel: string;
  ariaValueText?: string;
  currentSizePx: number;
  maxSizePx: number;
  minSizePx: number;
  onBlur?: () => void;
  onFocus?: () => void;
  onRawSizeChange?: (rawSizePx: number) => void;
  onResizeEnd?: () => void;
  onResizeStart?: () => void;
  onSizeChange: (sizePx: number) => void;
  pointerTarget?: "edge" | "grip";
  positionPx: number;
  resizeFrom: "left" | "right";
};

export function SidebarLayoutResizeHandle(props: SidebarLayoutResizeHandleProps) {
  let dragState: { startClientPx: number; startSizePx: number } | null = null;
  let keyboardResizeTimeout: number | null = null;
  let resizeSessionActive = false;
  let resizeSessionEnd: (() => void) | undefined = undefined;
  const [isResizing, setIsResizing] = createSignal(false);
  const [isPointerResizing, setIsPointerResizing] = createSignal(false);

  const startResizing = () => {
    if (resizeSessionActive) {
      return;
    }

    resizeSessionActive = true;
    resizeSessionEnd = props.onResizeEnd;
    props.onResizeStart?.();
  };

  const finishResizing = (updateLocalState = true) => {
    if (keyboardResizeTimeout !== null) {
      window.clearTimeout(keyboardResizeTimeout);
      keyboardResizeTimeout = null;
    }
    if (!resizeSessionActive) {
      return;
    }

    resizeSessionActive = false;
    const endResizeSession = resizeSessionEnd;
    resizeSessionEnd = undefined;
    dragState = null;
    if (updateLocalState) {
      setIsPointerResizing(false);
      setIsResizing(false);
    }
    endResizeSession?.();
  };

  createEffect(() => {
    if (!isPointerResizing()) {
      return;
    }

    const release = acquireSidebarResizeBodyStyleLock(document.body);
    onCleanup(release);
  });

  onCleanup(() => {
    finishResizing(false);
  });

  const commitSizeChange = (nextSizePx: number) => {
    props.onSizeChange(clampNumber(nextSizePx, props.minSizePx, props.maxSizePx));
    props.onRawSizeChange?.(nextSizePx);
  };

  const handlePointerDown: JSX.EventHandler<HTMLDivElement, PointerEvent> = (event) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dragState = {
      startClientPx: event.clientX,
      startSizePx: props.currentSizePx,
    };
    startResizing();
    setIsPointerResizing(true);
    setIsResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove: JSX.EventHandler<HTMLDivElement, PointerEvent> = (event) => {
    if (dragState === null) {
      return;
    }

    event.stopPropagation();
    const pointerDeltaPx = getPointerDeltaPx({
      event,
      resizeFrom: props.resizeFrom,
      startClientPx: dragState.startClientPx,
    });
    commitSizeChange(dragState.startSizePx + pointerDeltaPx);
  };

  const handlePointerEnd: JSX.EventHandler<HTMLDivElement, PointerEvent> = (event) => {
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    finishResizing();
  };

  const handleKeyDown: JSX.EventHandler<HTMLDivElement, KeyboardEvent> = (event) => {
    const deltaPx = getKeyboardResizeDeltaPx(event, props.resizeFrom);
    if (deltaPx === 0) {
      return;
    }

    event.preventDefault();
    startResizing();
    setIsResizing(true);
    commitSizeChange(props.currentSizePx + deltaPx);
    if (keyboardResizeTimeout !== null) {
      window.clearTimeout(keyboardResizeTimeout);
    }
    keyboardResizeTimeout = window.setTimeout(() => {
      finishResizing();
    }, KEYBOARD_RESIZE_TIMEOUT_MS);
  };

  const pointerTarget = () => props.pointerTarget ?? "edge";

  return (
    <Show
      when={pointerTarget() === "grip"}
      fallback={
        <div
          aria-controls={props.ariaControls}
          aria-label={props.ariaLabel}
          aria-orientation="vertical"
          aria-valuemax={props.maxSizePx}
          aria-valuemin={props.minSizePx}
          aria-valuenow={Math.round(props.currentSizePx)}
          aria-valuetext={props.ariaValueText}
          data-resize-mode={pointerTarget()}
          data-resize-side={props.resizeFrom}
          data-resizing={isResizing() ? "" : undefined}
          data-sidebar-layout-part="resize-handle"
          onBlur={() => props.onBlur?.()}
          onFocus={() => props.onFocus?.()}
          onKeyDown={handleKeyDown}
          on:lostpointercapture={() => finishResizing()}
          onPointerCancel={handlePointerEnd}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          role="separator"
          style={{ left: `${props.positionPx}px` }}
          tabIndex={0}
        />
      }
    >
      <div
        data-resize-side={props.resizeFrom}
        data-sidebar-layout-part="resize-track"
        style={{ left: `${props.positionPx}px` }}
      >
        <div
          aria-controls={props.ariaControls}
          aria-label={props.ariaLabel}
          aria-orientation="vertical"
          aria-valuemax={props.maxSizePx}
          aria-valuemin={props.minSizePx}
          aria-valuenow={Math.round(props.currentSizePx)}
          aria-valuetext={props.ariaValueText}
          data-resize-mode={pointerTarget()}
          data-resize-side={props.resizeFrom}
          data-resizing={isResizing() ? "" : undefined}
          data-sidebar-layout-part="resize-handle"
          onBlur={() => props.onBlur?.()}
          onFocus={() => props.onFocus?.()}
          onKeyDown={handleKeyDown}
          on:lostpointercapture={() => finishResizing()}
          onPointerCancel={handlePointerEnd}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          role="separator"
          tabIndex={0}
        >
          <div aria-hidden="true" data-sidebar-layout-part="resize-grip-indicator" />
        </div>
      </div>
    </Show>
  );
}
