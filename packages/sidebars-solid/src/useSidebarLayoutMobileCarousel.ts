import { createEffect, createMemo, onCleanup, untrack, type Accessor } from "solid-js";
import {
  getMobilePaneFromScrollLeft,
  getMobilePaneScrollLeftPx,
  getMobilePaneScrollProgress,
  isMobilePaneScrollSettled,
  type MobilePane,
  type SidebarLayoutMobileMergedSide,
} from "./SidebarLayoutGeometryInternal.ts";
import {
  readIsMobileSidebarLayout,
  useSidebarLayoutActions,
  type StateUpdater,
} from "./SidebarRuntimeInternal.tsx";

export type MutableRef<T> = { current: T };

/**
The scroll position is the pane. On a client-only mount, the first alignment sets the carousel
scrollLeft once from the state value. After that, this controller reads the pane from the scroll
position on each scroll, and writes the position only for pane changes that did not come from a
scroll (a toggle or a pane that disappears), never while a touch owns the scroll.
*/
export function createSidebarLayoutMobileCarouselController(args: {
  activeGripResizeSideRef: MutableRef<"left" | "right" | null>;
  getCarousel: () => HTMLDivElement | undefined;
  hasLeftPane: Accessor<boolean>;
  hasRightPane: Accessor<boolean>;
  isMobile: Accessor<boolean>;
  leftWidthPx: Accessor<number>;
  mainWidthPx: Accessor<number>;
  mergedSurfaceSide: Accessor<SidebarLayoutMobileMergedSide | null>;
  mobilePane: Accessor<MobilePane>;
  rightWidthPx: Accessor<number>;
  setMobilePane: (nextPane: StateUpdater<MobilePane>) => void;
  viewportWidthPx: Accessor<number>;
}) {
  let hasAlignedInitialMobilePane = false;
  let scrollDerivedMobilePane: MobilePane | null = null;
  let touchOwnsScroll = false;

  const { setIsMobilePaneSettled, setMobilePaneScrollProgress } = useSidebarLayoutActions();

  const canSyncScroll = createMemo(
    () => args.isMobile() && args.viewportWidthPx() > 0 && args.mainWidthPx() > 0,
  );

  const syncPaneFromScroll = (carouselNode: HTMLDivElement) => {
    if (
      args.activeGripResizeSideRef.current !== null ||
      !hasAlignedInitialMobilePane ||
      !readIsMobileSidebarLayout() ||
      carouselNode.scrollWidth <= carouselNode.clientWidth
    ) {
      return;
    }

    const geometry = untrack(() => ({
      hasLeftPane: args.hasLeftPane(),
      hasRightPane: args.hasRightPane(),
      leftWidthPx: args.leftWidthPx(),
      mainWidthPx: args.mainWidthPx(),
      mergedSurfaceSide: args.mergedSurfaceSide(),
      rightWidthPx: args.rightWidthPx(),
      viewportWidthPx: args.viewportWidthPx(),
    }));

    const nextPane = getMobilePaneFromScrollLeft({
      ...geometry,
      scrollLeftPx: carouselNode.scrollLeft,
    });
    setMobilePaneScrollProgress(
      getMobilePaneScrollProgress({
        ...geometry,
        scrollLeftPx: carouselNode.scrollLeft,
      }),
    );
    const isScrollSettled = isMobilePaneScrollSettled({
      ...geometry,
      pane: nextPane,
      scrollLeftPx: carouselNode.scrollLeft,
    });
    setIsMobilePaneSettled(isScrollSettled);

    if (geometry.mergedSurfaceSide !== null && !isScrollSettled) {
      return;
    }
    if (untrack(args.mobilePane) === nextPane) {
      return;
    }
    args.setMobilePane((currentPane) => {
      if (currentPane === nextPane) {
        return currentPane;
      }

      scrollDerivedMobilePane =
        geometry.mergedSurfaceSide !== null && currentPane === geometry.mergedSurfaceSide
          ? null
          : nextPane;
      return nextPane;
    });
  };

  createEffect(() => {
    if (args.isMobile()) {
      return;
    }

    hasAlignedInitialMobilePane = false;
    scrollDerivedMobilePane = null;
    setIsMobilePaneSettled(true);
  });

  createEffect(() => {
    const carouselNode = args.getCarousel();
    const isMobile = args.isMobile();
    const mainWidthPx = args.mainWidthPx();
    const hasLeftPane = args.hasLeftPane();
    const hasRightPane = args.hasRightPane();
    const leftWidthPx = args.leftWidthPx();
    const rightWidthPx = args.rightWidthPx();
    const mergedSurfaceSide = args.mergedSurfaceSide();
    const mobilePane = args.mobilePane();
    const viewportWidthPx = args.viewportWidthPx();

    if (!isMobile || carouselNode === undefined || mainWidthPx <= 0) {
      return;
    }
    if (!hasLeftPane && scrollDerivedMobilePane === "left") {
      scrollDerivedMobilePane = null;
    }
    if (!hasRightPane && scrollDerivedMobilePane === "right") {
      scrollDerivedMobilePane = null;
    }
    if (args.activeGripResizeSideRef.current !== null) {
      return;
    }

    const nextScrollLeftPx = getMobilePaneScrollLeftPx(mobilePane, {
      hasLeftPane,
      hasRightPane,
      leftWidthPx,
      mainWidthPx,
      mergedSurfaceSide,
      rightWidthPx,
      viewportWidthPx,
    });

    if (!hasAlignedInitialMobilePane) {
      if (nextScrollLeftPx > 0 && carouselNode.scrollWidth <= carouselNode.clientWidth) {
        return;
      }
      hasAlignedInitialMobilePane = true;
      carouselNode.scrollLeft = nextScrollLeftPx;
      setIsMobilePaneSettled(true);
      return;
    }

    if (scrollDerivedMobilePane === mobilePane) {
      scrollDerivedMobilePane = null;
      return;
    }
    if (touchOwnsScroll) {
      return;
    }

    carouselNode.scrollLeft = nextScrollLeftPx;
    setIsMobilePaneSettled(true);
  });

  createEffect(() => {
    const carouselNode = args.getCarousel();
    if (!canSyncScroll() || carouselNode === undefined) {
      setMobilePaneScrollProgress(0);
      return;
    }

    let settleTimeoutId: number | null = null;
    let isTouchDown = false;
    const settle = () => {
      settleTimeoutId = null;
      if (!isTouchDown) {
        touchOwnsScroll = false;
      }
      syncPaneFromScroll(carouselNode);
    };
    const scheduleSettle = () => {
      if (settleTimeoutId !== null) {
        window.clearTimeout(settleTimeoutId);
      }
      settleTimeoutId = window.setTimeout(settle, 80);
    };
    const handleScroll = () => {
      if (isTouchDown) {
        touchOwnsScroll = true;
      }
      syncPaneFromScroll(carouselNode);
      scheduleSettle();
    };
    const carouselTouchIds = new Set<number>();
    const handleTouchEnd = (event: TouchEvent) => {
      for (const touch of Array.from(event.changedTouches)) {
        carouselTouchIds.delete(touch.identifier);
      }
      if (carouselTouchIds.size > 0) {
        return;
      }
      isTouchDown = false;
      scheduleSettle();
    };
    const handleTouchStart = (event: TouchEvent) => {
      for (const touch of Array.from(event.changedTouches)) {
        carouselTouchIds.add(touch.identifier);
      }
      isTouchDown = true;
      const touchedNode: GlobalEventHandlers | null =
        event.target instanceof HTMLElement || event.target instanceof SVGElement
          ? event.target
          : null;
      if (touchedNode !== null && touchedNode !== carouselNode) {
        touchedNode.addEventListener("touchend", handleTouchEnd, { passive: true });
        touchedNode.addEventListener("touchcancel", handleTouchEnd, { passive: true });
      }
    };

    carouselNode.addEventListener("scroll", handleScroll, { passive: true });
    carouselNode.addEventListener("touchstart", handleTouchStart, { passive: true });
    carouselNode.addEventListener("touchend", handleTouchEnd, { passive: true });
    carouselNode.addEventListener("touchcancel", handleTouchEnd, { passive: true });
    syncPaneFromScroll(carouselNode);

    onCleanup(() => {
      carouselNode.removeEventListener("scroll", handleScroll);
      carouselNode.removeEventListener("touchstart", handleTouchStart);
      carouselNode.removeEventListener("touchend", handleTouchEnd);
      carouselNode.removeEventListener("touchcancel", handleTouchEnd);
      if (settleTimeoutId !== null) {
        window.clearTimeout(settleTimeoutId);
      }
      touchOwnsScroll = false;
    });
  });

  createEffect(() => {
    const carouselNode = args.getCarousel();
    const canSync = canSyncScroll();
    // Subscribe to geometry inputs so scroll progress stays current after resizes.
    args.hasLeftPane();
    args.hasRightPane();
    args.leftWidthPx();
    args.mainWidthPx();
    args.mergedSurfaceSide();
    args.rightWidthPx();
    args.viewportWidthPx();

    if (!canSync || carouselNode === undefined) {
      return;
    }

    syncPaneFromScroll(carouselNode);
  });
}
