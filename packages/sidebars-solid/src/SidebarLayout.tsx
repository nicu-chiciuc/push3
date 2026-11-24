import {
  children,
  createEffect,
  createMemo,
  createRenderEffect,
  createSignal,
  createUniqueId,
  Show,
  type Accessor,
  type JSX,
} from "solid-js";
import "./structure.css";
import { createElementSize } from "./useElementSize.ts";
import { createAnyFineHoverPointer } from "./pointerCapabilities.ts";
import {
  useSidebarLayoutActions,
  useSidebarLayoutStore,
  useSidebarRuntimeActions,
  useSidebarRuntimeState,
} from "./SidebarRuntimeInternal.tsx";
import {
  SIDEBAR_LAYOUT_DESKTOP_MAIN_MIN_WIDTH_PX,
  SIDEBAR_LAYOUT_DESKTOP_SIDEBAR_MIN_WIDTH_PX,
  SIDEBAR_LAYOUT_MOBILE_MAIN_MIN_WIDTH_PX,
  SIDEBAR_LAYOUT_MOBILE_SIDEBAR_MIN_WIDTH_PX,
  SIDEBAR_LAYOUT_UNMERGED_MOBILE_SURFACE,
  getDesktopPaneWidths,
  getMergedMobileMainWidthPx,
  getMobileSidebarMaxWidthPx,
  getMobileSidebarMinWidthPx,
  getMobileSidebarWidthPx,
  type SidebarLayoutMobileMinResizeBehavior,
} from "./SidebarLayoutGeometryInternal.ts";
import {
  SidebarLayoutDisplayedMobileStateContext,
  type SidebarLayoutDisplayedMobileState,
} from "./SidebarLayoutPresentation.ts";
import {
  getAvailableMobilePane,
  getSidebarLayoutRootState,
  type SidebarLayoutRootAttributes,
} from "./SidebarLayoutRootState.ts";
import type { SidebarSide } from "./SidebarLayoutState.ts";
import { SidebarLayoutResizeHandle } from "./SidebarLayoutResizeHandle.tsx";
import { SidebarLayoutViewport } from "./SidebarLayoutViewports.tsx";
import {
  getSidebarLayoutDesktopResizeHandles,
  getSidebarLayoutMobileResizeHandles,
  type SidebarLayoutResizeHandleConfig,
} from "./SidebarLayoutResizeHandleConfigs.ts";
import { createSidebarLayoutMobileCarouselController } from "./useSidebarLayoutMobileCarousel.ts";
import { createSidebarLayoutMobileGripResizeController } from "./useSidebarLayoutMobileResize.ts";

export type SidebarLayoutResizeHandleLabels = Record<SidebarSide, string>;

export type SidebarLayoutResizeHandleValueTextFormatter = (args: {
  side: SidebarSide;
  widthPx: number;
}) => string;

export type SidebarLayoutProps = {
  addressChrome: JSX.Element;
  formatResizeHandleValueText?: SidebarLayoutResizeHandleValueTextFormatter;
  left?: JSX.Element;
  main: JSX.Element;
  mobileMinResizeBehavior?: SidebarLayoutMobileMinResizeBehavior;
  resizeHandleLabels: SidebarLayoutResizeHandleLabels;
  right?: JSX.Element;
};

export function SidebarLayout(props: SidebarLayoutProps) {
  const runtimeState = useSidebarRuntimeState();
  const [displayedMobileState, setDisplayedMobileState] =
    createSignal<SidebarLayoutDisplayedMobileState>({
      mobileMergeAvailableSides: { left: false, right: false },
      mobilePane: runtimeState().mobilePane,
      mobileSurface: SIDEBAR_LAYOUT_UNMERGED_MOBILE_SURFACE,
    });

  return (
    <SidebarLayoutDisplayedMobileStateContext.Provider value={displayedMobileState}>
      <SidebarLayoutInner
        layoutProps={props}
        setDisplayedMobileState={setDisplayedMobileState}
      />
    </SidebarLayoutDisplayedMobileStateContext.Provider>
  );
}

function SidebarLayoutInner(innerProps: {
  layoutProps: SidebarLayoutProps;
  setDisplayedMobileState: (state: SidebarLayoutDisplayedMobileState) => void;
}) {
  const props = innerProps.layoutProps;
  const paneIdPrefix = createUniqueId();
  const leftPaneId = `${paneIdPrefix}-pane-left`;
  const rightPaneId = `${paneIdPrefix}-pane-right`;
  const hasAnyFineHoverPointer = createAnyFineHoverPointer();

  const [viewportEl, setViewportEl] = createSignal<HTMLDivElement | undefined>(undefined);
  const [carouselEl, setCarouselEl] = createSignal<HTMLDivElement | undefined>(undefined);

  const layoutStore = useSidebarLayoutStore();
  const { setActiveResizeSide, setViewportSize } = useSidebarLayoutActions();
  createElementSize(viewportEl, setViewportSize);

  const runtimeState = useSidebarRuntimeState();
  const { setDesktopWidths, setLeftMobileWidthPx, setMobilePane, setRightMobileWidthPx } =
    useSidebarRuntimeActions();

  const leftResolved = children(() => props.left);
  const rightResolved = children(() => props.right);

  const mobileMinResizeBehavior = () => props.mobileMinResizeBehavior ?? "min_resize_to_merge";
  const hasLeftPane = createMemo(() => {
    const resolved = leftResolved();
    return resolved !== undefined && resolved !== null && resolved !== false;
  });
  const hasRightPane = createMemo(() => {
    const resolved = rightResolved();
    return resolved !== undefined && resolved !== null && resolved !== false;
  });
  const hasMeasuredViewport = createMemo(() => layoutStore.viewportSize().widthPx > 0);

  let previousViewportWidth = 0;
  const [enableDesktopPaneTransitions, setEnableDesktopPaneTransitions] = createSignal(false);
  createEffect(() => {
    const widthPx = layoutStore.viewportSize().widthPx;
    const activeResizeSide = layoutStore.activeResizeSide();
    setEnableDesktopPaneTransitions(
      widthPx > 0 && previousViewportWidth === widthPx && activeResizeSide === null,
    );
    previousViewportWidth = widthPx;
  });

  const mobilePane = createMemo(() =>
    getAvailableMobilePane({
      hasLeftPane: hasLeftPane(),
      hasRightPane: hasRightPane(),
      mobilePane: runtimeState().mobilePane,
    }),
  );

  const desktopWidths = createMemo(() => {
    const state = runtimeState();
    return getDesktopPaneWidths({
      leftOpen: hasLeftPane() && state.leftDesktopOpen,
      leftWidthPx: state.leftDesktopWidthPx,
      mainMinWidthPx: SIDEBAR_LAYOUT_DESKTOP_MAIN_MIN_WIDTH_PX,
      rightOpen: hasRightPane() && state.rightDesktopOpen,
      rightWidthPx: state.rightDesktopWidthPx,
      sidebarMinWidthPx: SIDEBAR_LAYOUT_DESKTOP_SIDEBAR_MIN_WIDTH_PX,
      viewportWidthPx: layoutStore.viewportSize().widthPx,
    });
  });

  const mobileSidebarMaxWidthPx = createMemo(() =>
    getMobileSidebarMaxWidthPx(layoutStore.viewportSize().widthPx),
  );
  const mobileSidebarMinWidthPx = createMemo(() =>
    getMobileSidebarMinWidthPx({
      configuredMinWidthPx: SIDEBAR_LAYOUT_MOBILE_SIDEBAR_MIN_WIDTH_PX,
      maxWidthPx: mobileSidebarMaxWidthPx(),
      viewportWidthPx: layoutStore.viewportSize().widthPx,
    }),
  );
  const canDisplayMobileMerge = createMemo(() => {
    const viewportWidthPx = layoutStore.viewportSize().widthPx;
    return (
      mobileMinResizeBehavior() === "min_resize_to_merge" &&
      getMergedMobileMainWidthPx({
        mainMaxWidthPx: Math.max(1, viewportWidthPx),
        mainMinWidthPx: SIDEBAR_LAYOUT_MOBILE_MAIN_MIN_WIDTH_PX,
        sideMinWidthPx: mobileSidebarMinWidthPx(),
        viewportWidthPx,
      }) !== null
    );
  });

  const mobileLeftWidthPx = createMemo(() =>
    hasLeftPane()
      ? getMobileSidebarWidthPx({
          maxWidthPx: mobileSidebarMaxWidthPx(),
          minWidthPx: mobileSidebarMinWidthPx(),
          storedWidthPx: runtimeState().leftMobileWidthPx,
        })
      : 0,
  );
  const mobileRightWidthPx = createMemo(() =>
    hasRightPane()
      ? getMobileSidebarWidthPx({
          maxWidthPx: mobileSidebarMaxWidthPx(),
          minWidthPx: mobileSidebarMinWidthPx(),
          storedWidthPx: runtimeState().rightMobileWidthPx,
        })
      : 0,
  );

  const activeMobileGripResizeSideRef = { current: null as "left" | "right" | null };
  const isMobile = createMemo(() => runtimeState().isMobile);
  const viewportWidthPx = createMemo(() => layoutStore.viewportSize().widthPx);

  const mobileGripResize = createSidebarLayoutMobileGripResizeController({
    activeGripResizeSideRef: activeMobileGripResizeSideRef,
    getCarousel: carouselEl,
    hasLeftPane,
    hasRightPane,
    isMobile,
    leftWidthPx: mobileLeftWidthPx,
    mobileMinResizeBehavior,
    rightWidthPx: mobileRightWidthPx,
    viewportWidthPx,
  });

  const activeMobileSurface = createMemo(() => {
    const surface = mobileGripResize.mobileSurface();
    return surface.kind === "merged" && mobilePane() !== "main" ? surface : null;
  });

  const activeMobileMergedSurfaceSide = createMemo(() => {
    const surface = activeMobileSurface();
    return surface !== null && mobileGripResize.isMobileMergedFit() ? surface.side : null;
  });

  const displayedMobileSurface = createMemo(() => {
    const surface = activeMobileSurface();
    return isMobile() && surface !== null && activeMobileMergedSurfaceSide() !== null
      ? surface
      : SIDEBAR_LAYOUT_UNMERGED_MOBILE_SURFACE;
  });

  const mobileMainWidthPx = createMemo(() => {
    const surface = activeMobileSurface();
    return surface ? surface.mainWidthPx : mobileGripResize.mobileDefaultMainWidthPx();
  });

  createRenderEffect(() => {
    innerProps.setDisplayedMobileState({
      mobileMergeAvailableSides: {
        left: isMobile() && hasLeftPane() && canDisplayMobileMerge(),
        right: isMobile() && hasRightPane() && canDisplayMobileMerge(),
      },
      mobilePane: mobilePane(),
      mobileSurface: displayedMobileSurface(),
    });
  });

  const rootState = createMemo(() => {
    if (hasMeasuredViewport()) {
      return null;
    }
    const state = runtimeState();
    return getSidebarLayoutRootState({
      hasLeftPane: hasLeftPane(),
      hasRightPane: hasRightPane(),
      mobileMinResizeBehavior: mobileMinResizeBehavior(),
      state: {
        leftDesktopOpen: state.leftDesktopOpen,
        leftDesktopWidthPx: state.leftDesktopWidthPx,
        leftMobileWidthPx: state.leftMobileWidthPx,
        mobilePane: mobilePane(),
        mobileSurface: state.mobileSurface,
        rightDesktopOpen: state.rightDesktopOpen,
        rightDesktopWidthPx: state.rightDesktopWidthPx,
        rightMobileWidthPx: state.rightMobileWidthPx,
      },
    });
  });

  const layoutRootAttributes = createMemo<SidebarLayoutRootAttributes>(() => {
    const unmeasured = rootState();
    if (unmeasured !== null) {
      return unmeasured.attributes;
    }
    const mergedSide = activeMobileMergedSurfaceSide();
    return {
      "data-left-desktop-open": desktopWidths().leftWidthPx > 0 ? "" : undefined,
      "data-mobile-pane": mobilePane(),
      "data-right-desktop-open": desktopWidths().rightWidthPx > 0 ? "" : undefined,
      "data-sidebar-layout-mobile-merged-side":
        isMobile() && mergedSide !== null ? mergedSide : undefined,
    };
  });

  const layoutRootStyle = createMemo<JSX.CSSProperties>(() => {
    const unmeasured = rootState();
    if (unmeasured !== null) {
      return unmeasured.variables;
    }
    const widths = desktopWidths();
    return {
      "--sidebar-layout-left-desktop-width": `${widths.leftWidthPx}px`,
      "--sidebar-layout-left-mobile-width": `${mobileLeftWidthPx()}px`,
      "--sidebar-layout-main-mobile-width": `${mobileMainWidthPx()}px`,
      "--sidebar-layout-right-desktop-width": `${widths.rightWidthPx}px`,
      "--sidebar-layout-right-mobile-width": `${mobileRightWidthPx()}px`,
    };
  });

  createSidebarLayoutMobileCarouselController({
    activeGripResizeSideRef: activeMobileGripResizeSideRef,
    getCarousel: carouselEl,
    hasLeftPane,
    hasRightPane,
    isMobile,
    leftWidthPx: mobileLeftWidthPx,
    mainWidthPx: mobileMainWidthPx,
    mergedSurfaceSide: activeMobileMergedSurfaceSide,
    mobilePane,
    rightWidthPx: mobileRightWidthPx,
    setMobilePane,
    viewportWidthPx,
  });

  const desktopResizeHandles = createMemo(() => {
    const state = runtimeState();
    const widths = desktopWidths();
    return getSidebarLayoutDesktopResizeHandles({
      desktopLeftWidthPx: widths.leftWidthPx,
      desktopRightWidthPx: widths.rightWidthPx,
      desktopMainMinWidthPx: widths.mainMinWidthPx,
      desktopSidebarMinWidthPx: widths.sidebarMinWidthPx,
      hasLeftPane: hasLeftPane(),
      hasRightPane: hasRightPane(),
      leftDesktopOpen: state.leftDesktopOpen,
      rightDesktopOpen: state.rightDesktopOpen,
      setDesktopWidths: ({ leftWidthPx, rightWidthPx }) => {
        const current = runtimeState();
        setDesktopWidths({
          leftWidthPx:
            hasLeftPane() && current.leftDesktopOpen ? leftWidthPx : current.leftDesktopWidthPx,
          rightWidthPx:
            hasRightPane() && current.rightDesktopOpen
              ? rightWidthPx
              : current.rightDesktopWidthPx,
        });
      },
      viewportWidthPx: viewportWidthPx(),
    });
  });

  const mobileResizeHandles = createMemo(() =>
    getSidebarLayoutMobileResizeHandles({
      hasLeftPane: hasLeftPane(),
      hasRightPane: hasRightPane(),
      isMobilePaneSettled: layoutStore.isMobilePaneSettled(),
      mobileLeftWidthPx: mobileLeftWidthPx(),
      mobilePane: mobilePane(),
      mobileRightWidthPx: mobileRightWidthPx(),
      mobileSidebarMaxWidthPx: mobileSidebarMaxWidthPx(),
      mobileSidebarMinWidthPx: mobileSidebarMinWidthPx(),
      setLeftMobileWidthPx,
      setRightMobileWidthPx,
      viewportWidthPx: viewportWidthPx(),
    }),
  );

  const activeResizeHandles = createMemo(() =>
    isMobile() ? mobileResizeHandles() : desktopResizeHandles(),
  );
  const leftHandle = createMemo(() => activeResizeHandles().find((h) => h.side === "left"));
  const rightHandle = createMemo(() => activeResizeHandles().find((h) => h.side === "right"));
  const pointerTarget = createMemo<"edge" | "grip">(() =>
    isMobile() && !hasAnyFineHoverPointer() ? "grip" : "edge",
  );

  let activeResizeSession: {
    handle: SidebarLayoutResizeHandleConfig;
    isMobile: boolean;
    side: SidebarSide;
  } | null = null;

  function startResizeSession(resizeHandle: SidebarLayoutResizeHandleConfig) {
    const mobile = isMobile();
    if (activeResizeSession?.isMobile === mobile && activeResizeSession.side === resizeHandle.side) {
      return;
    }

    activeResizeSession = {
      handle: resizeHandle,
      isMobile: mobile,
      side: resizeHandle.side,
    };
    if (mobile) {
      mobileGripResize.startResize(resizeHandle);
    }
    setActiveResizeSide(resizeHandle.side);
  }

  function finishResizeSession(side: SidebarSide) {
    const session = activeResizeSession;
    if (session === null || session.side !== side) {
      return;
    }

    const currentHandle = (side === "left" ? leftHandle() : rightHandle()) ?? session.handle;
    activeResizeSession = null;
    if (session.isMobile) {
      const { shouldSyncPaneFromScroll } = mobileGripResize.endResize(currentHandle);
      if (shouldSyncPaneFromScroll) {
        carouselEl()?.dispatchEvent(new Event("scroll", { bubbles: true }));
      }
    } else {
      carouselEl()?.dispatchEvent(new Event("scroll", { bubbles: true }));
    }
    setActiveResizeSide(null);
  }

  function renderResizeHandle(
    side: SidebarSide,
    getHandle: Accessor<SidebarLayoutResizeHandleConfig | undefined>,
  ) {
    const handle = () => getHandle()!;
    return (
      <SidebarLayoutResizeHandle
        ariaControls={side === "left" ? leftPaneId : rightPaneId}
        ariaLabel={props.resizeHandleLabels[side]}
        ariaValueText={props.formatResizeHandleValueText?.({
          side,
          widthPx: Math.round(handle().currentWidthPx),
        })}
        currentSizePx={handle().currentWidthPx}
        minSizePx={handle().minWidthPx}
        maxSizePx={handle().maxWidthPx}
        pointerTarget={pointerTarget()}
        positionPx={isMobile() ? mobileGripResize.getGripPositionPx(handle()) : handle().positionPx}
        resizeFrom={side}
        onResizeStart={() => {
          const current = getHandle();
          if (current) startResizeSession(current);
        }}
        onResizeEnd={() => {
          finishResizeSession(side);
        }}
        onRawSizeChange={
          isMobile()
            ? (rawWidthPx: number) => {
                const current = getHandle();
                if (current) mobileGripResize.changeRawSize(current, rawWidthPx);
              }
            : undefined
        }
        onSizeChange={(nextWidthPx) => {
          getHandle()?.onWidthChange(nextWidthPx);
        }}
      />
    );
  }

  return (
    <div data-sidebar-layout-part="root">
      <div data-sidebar-layout-part="address-chrome">{props.addressChrome}</div>
      <div
        ref={setViewportEl}
        data-has-left-pane={hasLeftPane() ? "" : undefined}
        data-has-right-pane={hasRightPane() ? "" : undefined}
        data-left-desktop-open={layoutRootAttributes()["data-left-desktop-open"]}
        data-mobile-pane={layoutRootAttributes()["data-mobile-pane"]}
        data-mobile-min-resize-behavior={mobileMinResizeBehavior()}
        data-right-desktop-open={layoutRootAttributes()["data-right-desktop-open"]}
        data-sidebar-layout-mobile-merged-side={
          layoutRootAttributes()["data-sidebar-layout-mobile-merged-side"]
        }
        data-sidebar-layout-part="viewport"
        style={layoutRootStyle()}
      >
        <SidebarLayoutViewport
          activeResizeSide={layoutStore.activeResizeSide()}
          carouselRef={setCarouselEl}
          desktopLeftWidthPx={desktopWidths().leftWidthPx}
          desktopRightWidthPx={desktopWidths().rightWidthPx}
          enableDesktopPaneTransitions={enableDesktopPaneTransitions()}
          hasMeasuredViewport={hasMeasuredViewport()}
          inertClosedDesktopPanes={hasMeasuredViewport() && !isMobile()}
          leftContent={leftResolved()}
          leftPaneId={leftPaneId}
          leftWidthPx={mobileLeftWidthPx()}
          lockCarouselScroll={isMobile() && mobileGripResize.lockCarouselScroll()}
          mainContent={props.main}
          paneWidthPx={mobileMainWidthPx()}
          rightContent={rightResolved()}
          rightPaneId={rightPaneId}
          rightWidthPx={mobileRightWidthPx()}
          showLeftPane={hasLeftPane()}
          showRightPane={hasRightPane()}
        />
        <Show when={leftHandle() !== undefined}>{renderResizeHandle("left", leftHandle)}</Show>
        <Show when={rightHandle() !== undefined}>{renderResizeHandle("right", rightHandle)}</Show>
      </div>
    </div>
  );
}
