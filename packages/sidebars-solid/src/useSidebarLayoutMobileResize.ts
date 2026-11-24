import { createEffect, createMemo, type Accessor } from "solid-js";
import {
  MOBILE_PANE_SETTLED_TOLERANCE_PX,
  SIDEBAR_LAYOUT_IDLE_MOBILE_GRIP,
  SIDEBAR_LAYOUT_MOBILE_MAIN_MIN_WIDTH_PX,
  SIDEBAR_LAYOUT_UNMERGED_MOBILE_SURFACE,
  clampNumber,
  getMergedMobileMainWidthPx,
  getMobileMergeHandoffSide,
  getMobileMinResizeMergeWidthsPx,
  getMobilePaneScrollLeftPx,
  shouldCommitMobileMergedSurface,
  type SidebarLayoutMobileGrip,
  type SidebarLayoutMobileMergedSide,
  type SidebarLayoutMobileMinResizeBehavior,
  type SidebarLayoutMobileSurface,
} from "./SidebarLayoutGeometryInternal.ts";
import {
  useSidebarLayoutActions,
  useSidebarLayoutStore,
  useSidebarRuntimeActions,
  useSidebarRuntimeState,
} from "./SidebarRuntimeInternal.tsx";
import type { SidebarLayoutResizeHandleConfig } from "./SidebarLayoutResizeHandleConfigs.ts";
import type { MutableRef } from "./useSidebarLayoutMobileCarousel.ts";

export function createSidebarLayoutMobileGripResizeController(args: {
  activeGripResizeSideRef: MutableRef<"left" | "right" | null>;
  getCarousel: () => HTMLDivElement | undefined;
  hasLeftPane: Accessor<boolean>;
  hasRightPane: Accessor<boolean>;
  isMobile: Accessor<boolean>;
  leftWidthPx: Accessor<number>;
  mobileMinResizeBehavior: Accessor<SidebarLayoutMobileMinResizeBehavior>;
  rightWidthPx: Accessor<number>;
  viewportWidthPx: Accessor<number>;
}) {
  const layoutStore = useSidebarLayoutStore();
  const runtimeState = useSidebarRuntimeState();
  const { setMobileGrip } = useSidebarLayoutActions();
  const { setMobileSurface, settleMobileMergedSurface } = useSidebarRuntimeActions();

  const mobileDefaultPaneWidthPx = createMemo(() => Math.max(1, args.viewportWidthPx()));

  const resolvedDurableMobileSurface = createMemo<SidebarLayoutMobileSurface>(() => {
    const mobileSurface = runtimeState().mobileSurface;
    const durableMobileMergedSide = mobileSurface.kind === "merged" ? mobileSurface.side : null;
    const durableMobileMergedSideWidthPx =
      durableMobileMergedSide === "left"
        ? args.leftWidthPx()
        : durableMobileMergedSide === "right"
          ? args.rightWidthPx()
          : 0;
    const hasDurableMobileMergedPane =
      (durableMobileMergedSide === "left" && args.hasLeftPane()) ||
      (durableMobileMergedSide === "right" && args.hasRightPane());
    const durableMobileMergedMainWidthPx =
      args.mobileMinResizeBehavior() === "min_resize_to_merge" && hasDurableMobileMergedPane
        ? getMergedMobileMainWidthPx({
            mainMaxWidthPx: mobileDefaultPaneWidthPx(),
            mainMinWidthPx: SIDEBAR_LAYOUT_MOBILE_MAIN_MIN_WIDTH_PX,
            sideMinWidthPx: durableMobileMergedSideWidthPx,
            viewportWidthPx: args.viewportWidthPx(),
          })
        : null;

    return mobileSurface.kind === "merged" && durableMobileMergedMainWidthPx !== null
      ? {
          ...mobileSurface,
          mainWidthPx: durableMobileMergedMainWidthPx,
        }
      : SIDEBAR_LAYOUT_UNMERGED_MOBILE_SURFACE;
  });

  const activeMobileSurface = createMemo<SidebarLayoutMobileSurface>(() => {
    const grip = layoutStore.mobileGrip();
    return grip.kind === "dragging" ? grip.previewSurface : resolvedDurableMobileSurface();
  });

  const isMobileMergedFit = createMemo(() => {
    const surface = activeMobileSurface();
    const mobileMergedSide = surface.kind === "merged" ? surface.side : null;
    const mobileMergedMainWidthPx = surface.kind === "merged" ? surface.mainWidthPx : null;
    const mobileMergedSideWidthPx =
      mobileMergedSide === "left"
        ? args.leftWidthPx()
        : mobileMergedSide === "right"
          ? args.rightWidthPx()
          : 0;
    const hasMobileMergedPane =
      (mobileMergedSide === "left" && args.hasLeftPane()) ||
      (mobileMergedSide === "right" && args.hasRightPane());

    return (
      hasMobileMergedPane &&
      mobileMergedMainWidthPx !== null &&
      mobileMergedMainWidthPx >= SIDEBAR_LAYOUT_MOBILE_MAIN_MIN_WIDTH_PX &&
      mobileMergedSideWidthPx + mobileMergedMainWidthPx <=
        args.viewportWidthPx() + MOBILE_PANE_SETTLED_TOLERANCE_PX
    );
  });

  const lockCarouselScroll = createMemo(() => {
    const surface = activeMobileSurface();
    const mobileMergedSide = surface.kind === "merged" ? surface.side : null;
    const hasOppositePaneForMergedSide =
      (mobileMergedSide === "left" && args.hasRightPane()) ||
      (mobileMergedSide === "right" && args.hasLeftPane());

    return (
      args.mobileMinResizeBehavior() === "min_resize_to_merge" &&
      isMobileMergedFit() &&
      !hasOppositePaneForMergedSide
    );
  });

  let mobileGripSnapshot: SidebarLayoutMobileGrip = SIDEBAR_LAYOUT_IDLE_MOBILE_GRIP;
  let mobileSurfaceSnapshot: SidebarLayoutMobileSurface = SIDEBAR_LAYOUT_UNMERGED_MOBILE_SURFACE;

  createEffect(() => {
    mobileGripSnapshot = layoutStore.mobileGrip();
    mobileSurfaceSnapshot = activeMobileSurface();
  });

  function setMobileGripState(nextMobileGrip: SidebarLayoutMobileGrip) {
    mobileGripSnapshot = nextMobileGrip;
    setMobileGrip(nextMobileGrip);
  }

  function setPreviewMobileSurface(surface: SidebarLayoutMobileSurface) {
    mobileSurfaceSnapshot = surface;
    const currentMobileGrip = mobileGripSnapshot;
    if (currentMobileGrip.kind !== "dragging") {
      return;
    }

    setMobileGripState({
      ...currentMobileGrip,
      previewSurface: surface,
    });
  }

  function clearPreviewMobileSurface() {
    setPreviewMobileSurface(SIDEBAR_LAYOUT_UNMERGED_MOBILE_SURFACE);
  }

  function setPreviewMobileMergedSurface(side: SidebarLayoutMobileMergedSide, mainWidthPx: number) {
    setPreviewMobileSurface({
      kind: "merged",
      mainWidthPx,
      side,
    });
  }

  function setMobileGripSlideOffsetPx(slideOffsetPx: number) {
    const currentMobileGrip = mobileGripSnapshot;
    if (currentMobileGrip.kind !== "dragging") {
      return;
    }

    setMobileGripState({
      ...currentMobileGrip,
      slideOffsetPx,
    });
  }

  createEffect(() => {
    if (args.isMobile()) {
      return;
    }

    args.activeGripResizeSideRef.current = null;
    setMobileGripState(SIDEBAR_LAYOUT_IDLE_MOBILE_GRIP);
  });

  function getGripPositionPx(resizeHandle: SidebarLayoutResizeHandleConfig) {
    const grip = layoutStore.mobileGrip();
    const slideOffsetPx = grip.kind === "dragging" ? grip.slideOffsetPx : 0;

    if (args.activeGripResizeSideRef.current !== resizeHandle.side) {
      return resizeHandle.positionPx;
    }

    if (resizeHandle.side === "left") {
      return clampNumber(resizeHandle.positionPx - slideOffsetPx, 0, resizeHandle.positionPx);
    }

    return clampNumber(
      resizeHandle.positionPx + slideOffsetPx,
      resizeHandle.positionPx,
      args.viewportWidthPx(),
    );
  }

  function startResize(resizeHandle: SidebarLayoutResizeHandleConfig) {
    const currentSurface = activeMobileSurface();
    mobileSurfaceSnapshot = currentSurface;
    const currentMergedSide = currentSurface.kind === "merged" ? currentSurface.side : null;
    const mergeTargetSide =
      args.mobileMinResizeBehavior() === "min_resize_to_merge" &&
      (currentMergedSide === null || currentMergedSide === resizeHandle.side)
        ? resizeHandle.side
        : null;

    args.activeGripResizeSideRef.current = resizeHandle.side;
    setMobileGripState({
      kind: "dragging",
      mergeTargetSide,
      previewSurface: currentSurface,
      shouldSettleMergedOnEnd: false,
      side: resizeHandle.side,
      slideOffsetPx: 0,
      startSideWidthPx: resizeHandle.currentWidthPx,
    });
    args.getCarousel()?.style.setProperty("scroll-snap-type", "none");
  }

  function endResize(resizeHandle: SidebarLayoutResizeHandleConfig) {
    const carouselNode = args.getCarousel();
    let didSettleMergedMainPane = false;
    const currentSurface = mobileSurfaceSnapshot;
    const currentMobileGrip = mobileGripSnapshot;
    const mergedMainWidthPx = currentSurface.kind === "merged" ? currentSurface.mainWidthPx : null;
    const viewportWidthPx = args.viewportWidthPx();
    const hasLeftPane = args.hasLeftPane();
    const hasRightPane = args.hasRightPane();
    const leftWidthPx = args.leftWidthPx();
    const rightWidthPx = args.rightWidthPx();
    const mobileMinResizeBehavior = args.mobileMinResizeBehavior();

    args.activeGripResizeSideRef.current = null;
    setMobileGripState(SIDEBAR_LAYOUT_IDLE_MOBILE_GRIP);

    if (
      mobileMinResizeBehavior === "min_resize_to_merge" &&
      currentMobileGrip.kind === "dragging" &&
      currentMobileGrip.mergeTargetSide === resizeHandle.side
    ) {
      const settledMainWidthPx = getMergedMobileMainWidthPx({
        mainMaxWidthPx: mobileDefaultPaneWidthPx(),
        mainMinWidthPx: SIDEBAR_LAYOUT_MOBILE_MAIN_MIN_WIDTH_PX,
        sideMinWidthPx: resizeHandle.minWidthPx,
        viewportWidthPx,
      });

      if (
        mergedMainWidthPx !== null &&
        settledMainWidthPx !== null &&
        currentMobileGrip.shouldSettleMergedOnEnd
      ) {
        settleMobileMergedSurface({
          mainWidthPx: settledMainWidthPx,
          side: resizeHandle.side,
          sideWidthPx: resizeHandle.minWidthPx,
        });
        if (carouselNode !== undefined) {
          carouselNode.scrollLeft = getMobilePaneScrollLeftPx(resizeHandle.side, {
            hasLeftPane,
            hasRightPane,
            leftWidthPx: resizeHandle.side === "left" ? resizeHandle.minWidthPx : leftWidthPx,
            mainWidthPx: settledMainWidthPx,
            rightWidthPx: resizeHandle.side === "right" ? resizeHandle.minWidthPx : rightWidthPx,
            viewportWidthPx,
            mergedSurfaceSide: resizeHandle.side,
          });
        }
        didSettleMergedMainPane = true;
      } else {
        setMobileSurface(SIDEBAR_LAYOUT_UNMERGED_MOBILE_SURFACE);
      }
    }
    if (
      mobileMinResizeBehavior === "min_resize_to_merge" &&
      currentMobileGrip.kind === "dragging" &&
      currentMobileGrip.mergeTargetSide === null &&
      currentSurface.kind === "merged" &&
      currentSurface.side !== resizeHandle.side
    ) {
      setMobileSurface(currentSurface);
    }

    carouselNode?.style.removeProperty("scroll-snap-type");

    return {
      shouldSyncPaneFromScroll: !didSettleMergedMainPane,
    };
  }

  function changeRawSize(resizeHandle: SidebarLayoutResizeHandleConfig, rawWidthPx: number) {
    const carouselNode = args.getCarousel();
    if (carouselNode === undefined) {
      return;
    }

    const viewportWidthPx = args.viewportWidthPx();
    const hasLeftPane = args.hasLeftPane();
    const hasRightPane = args.hasRightPane();
    const leftWidthPx = args.leftWidthPx();
    const rightWidthPx = args.rightWidthPx();
    const mobileMinResizeBehavior = args.mobileMinResizeBehavior();
    const defaultPaneWidthPx = mobileDefaultPaneWidthPx();

    const clampedRawWidthPx = clampNumber(
      Math.round(rawWidthPx),
      resizeHandle.minWidthPx,
      resizeHandle.maxWidthPx,
    );
    const pastMinimumPx = Math.max(0, resizeHandle.minWidthPx - rawWidthPx);
    const currentMobileGrip = mobileGripSnapshot;
    const currentSurface = mobileSurfaceSnapshot;
    const currentMergedSide = currentSurface.kind === "merged" ? currentSurface.side : null;
    const currentMergedMainWidthPx =
      currentSurface.kind === "merged" ? currentSurface.mainWidthPx : null;

    if (
      mobileMinResizeBehavior === "min_resize_to_merge" &&
      currentMobileGrip.kind === "dragging" &&
      currentMobileGrip.mergeTargetSide === resizeHandle.side
    ) {
      const mergeResizeWidths = getMobileMinResizeMergeWidthsPx({
        mainMaxWidthPx: defaultPaneWidthPx,
        mainMinWidthPx: SIDEBAR_LAYOUT_MOBILE_MAIN_MIN_WIDTH_PX,
        rawSideWidthPx: rawWidthPx,
        sideMaxWidthPx: resizeHandle.maxWidthPx,
        sideMinWidthPx: resizeHandle.minWidthPx,
        viewportWidthPx,
      });

      if (mergeResizeWidths !== null) {
        const shouldSettleMergedOnEnd = shouldCommitMobileMergedSurface({
          sideMinWidthPx: resizeHandle.minWidthPx,
          sideWidthPx: mergeResizeWidths.sideWidthPx,
        });
        setMobileGripState({
          ...currentMobileGrip,
          shouldSettleMergedOnEnd,
          slideOffsetPx: 0,
        });
        const handoffSide = getMobileMergeHandoffSide({
          currentMergedSide,
          hasLeftPane,
          hasRightPane,
          leftWidthPx,
          resizeSide: resizeHandle.side,
          rightWidthPx,
          shouldKeepCurrentMerge: shouldSettleMergedOnEnd,
          sidebarMinWidthPx: resizeHandle.minWidthPx,
        });
        const scrollOffsetArgs = {
          hasLeftPane,
          hasRightPane,
          leftWidthPx: resizeHandle.side === "left" ? mergeResizeWidths.sideWidthPx : leftWidthPx,
          mainWidthPx: mergeResizeWidths.mainWidthPx,
          mergedSurfaceSide: resizeHandle.side,
          rightWidthPx:
            resizeHandle.side === "right" ? mergeResizeWidths.sideWidthPx : rightWidthPx,
          viewportWidthPx,
        };

        if (handoffSide !== null) {
          const handoffSideWidthPx = handoffSide === "left" ? leftWidthPx : rightWidthPx;
          const handoffMainWidthPx = getMergedMobileMainWidthPx({
            mainMaxWidthPx: defaultPaneWidthPx,
            mainMinWidthPx: SIDEBAR_LAYOUT_MOBILE_MAIN_MIN_WIDTH_PX,
            sideMinWidthPx: handoffSideWidthPx,
            viewportWidthPx,
          });

          if (handoffMainWidthPx !== null) {
            setMobileGripState({
              ...currentMobileGrip,
              mergeTargetSide: null,
              shouldSettleMergedOnEnd: false,
              slideOffsetPx: 0,
            });
            resizeHandle.onWidthChange(mergeResizeWidths.sideWidthPx);
            setPreviewMobileMergedSurface(handoffSide, handoffMainWidthPx);
            carouselNode.scrollLeft = getMobilePaneScrollLeftPx(resizeHandle.side, {
              ...scrollOffsetArgs,
              mainWidthPx: handoffMainWidthPx,
              mergedSurfaceSide: handoffSide,
            });
            return;
          }
        }

        resizeHandle.onWidthChange(mergeResizeWidths.sideWidthPx);
        if (mergeResizeWidths.mainWidthPx >= defaultPaneWidthPx) {
          clearPreviewMobileSurface();
        } else {
          setPreviewMobileMergedSurface(resizeHandle.side, mergeResizeWidths.mainWidthPx);
        }
        carouselNode.scrollLeft = getMobilePaneScrollLeftPx(resizeHandle.side, scrollOffsetArgs);
        return;
      }
    }

    if (
      mobileMinResizeBehavior === "min_resize_to_merge" &&
      currentMobileGrip.kind === "dragging" &&
      currentMobileGrip.mergeTargetSide === null &&
      currentMergedSide !== null &&
      currentMergedSide !== resizeHandle.side &&
      currentMergedMainWidthPx !== null
    ) {
      const nextSideWidthPx = clampedRawWidthPx;
      const nextLeftWidthPx = resizeHandle.side === "left" ? nextSideWidthPx : leftWidthPx;
      const nextRightWidthPx = resizeHandle.side === "right" ? nextSideWidthPx : rightWidthPx;
      resizeHandle.onWidthChange(nextSideWidthPx);
      carouselNode.scrollLeft = getMobilePaneScrollLeftPx(resizeHandle.side, {
        hasLeftPane,
        hasRightPane,
        leftWidthPx: nextLeftWidthPx,
        mainWidthPx: currentMergedMainWidthPx,
        mergedSurfaceSide: currentMergedSide,
        rightWidthPx: nextRightWidthPx,
        viewportWidthPx,
      });
      setMobileGripSlideOffsetPx(0);
      return;
    }

    clearPreviewMobileSurface();
    const scrollOffsetArgs = {
      hasLeftPane,
      hasRightPane,
      leftWidthPx: resizeHandle.side === "left" ? clampedRawWidthPx : leftWidthPx,
      mainWidthPx: defaultPaneWidthPx,
      mergedSurfaceSide: null,
      rightWidthPx: resizeHandle.side === "right" ? clampedRawWidthPx : rightWidthPx,
      viewportWidthPx,
    };
    const sidebarScrollLeftPx = getMobilePaneScrollLeftPx(resizeHandle.side, scrollOffsetArgs);
    const mainScrollLeftPx = getMobilePaneScrollLeftPx("main", scrollOffsetArgs);
    const nextScrollLeftPx =
      resizeHandle.side === "left"
        ? Math.min(mainScrollLeftPx, sidebarScrollLeftPx + pastMinimumPx)
        : Math.max(mainScrollLeftPx, sidebarScrollLeftPx - pastMinimumPx);

    carouselNode.scrollLeft = nextScrollLeftPx;
    setMobileGripSlideOffsetPx(Math.abs(nextScrollLeftPx - sidebarScrollLeftPx));
  }

  return {
    changeRawSize,
    endResize,
    getGripPositionPx,
    isMobileMergedFit,
    lockCarouselScroll,
    mobileDefaultMainWidthPx: mobileDefaultPaneWidthPx,
    mobileSurface: activeMobileSurface,
    startResize,
  };
}
