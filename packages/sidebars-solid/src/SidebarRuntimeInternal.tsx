import {
  createContext,
  createMemo,
  createSignal,
  onCleanup,
  useContext,
  type Accessor,
  type JSX,
} from "solid-js";
import {
  SIDEBAR_LAYOUT_DESKTOP_MIN_WIDTH_PX,
  SIDEBAR_LAYOUT_IDLE_MOBILE_GRIP,
  SIDEBAR_LAYOUT_UNMERGED_MOBILE_SURFACE,
  type SidebarLayoutActiveResizeSide,
  type SidebarLayoutMobileGrip,
} from "./SidebarLayoutGeometryInternal.ts";
import type {
  MobilePane,
  SidebarLayoutState,
  SidebarLayoutStateController,
  SidebarLayoutStatePersistenceMode,
  SidebarSide,
} from "./SidebarLayoutState.ts";

export type { MobilePane, SidebarSide } from "./SidebarLayoutState.ts";

export type StateUpdater<T> = T | ((currentValue: T) => T);

export type SidebarRuntimeState = SidebarLayoutState & {
  isMobile: boolean;
};

export type SidebarRuntimeActions = {
  setLeftDesktopOpen: (nextOpen: StateUpdater<boolean>) => void;
  setDesktopWidths: (widths: { leftWidthPx: number; rightWidthPx: number }) => void;
  setLeftMobileWidthPx: (nextWidthPx: StateUpdater<number>) => void;
  setMobilePane: (nextPane: StateUpdater<MobilePane>) => void;
  setMobileSurface: (nextSurface: StateUpdater<SidebarLayoutState["mobileSurface"]>) => void;
  setRightDesktopOpen: (nextOpen: StateUpdater<boolean>) => void;
  setRightMobileWidthPx: (nextWidthPx: StateUpdater<number>) => void;
  settleMobileMergedSurface: (args: {
    mainWidthPx: number;
    side: SidebarSide;
    sideWidthPx: number;
  }) => void;
  toggleLeftPane: () => void;
  toggleRightPane: () => void;
};

export type SidebarLayoutLocalStoreState = {
  activeResizeSide: SidebarLayoutActiveResizeSide;
  mobile: {
    grip: SidebarLayoutMobileGrip;
    isPaneSettled: boolean;
    paneScrollProgress: number;
  };
  viewportSize: {
    heightPx: number;
    widthPx: number;
  };
};

export type SidebarLayoutLocalActions = {
  setActiveResizeSide: (activeResizeSide: SidebarLayoutActiveResizeSide) => void;
  setIsMobilePaneSettled: (isPaneSettled: boolean) => void;
  setMobileGrip: (grip: SidebarLayoutMobileGrip) => void;
  setMobilePaneScrollProgress: (paneScrollProgress: number) => void;
  setViewportSize: (viewportSize: SidebarLayoutLocalStoreState["viewportSize"]) => void;
};

type SidebarLayoutStore = {
  actions: SidebarLayoutLocalActions;
  activeResizeSide: Accessor<SidebarLayoutActiveResizeSide>;
  isMobilePaneSettled: Accessor<boolean>;
  mobileGrip: Accessor<SidebarLayoutMobileGrip>;
  mobilePaneScrollProgress: Accessor<number>;
  state: Accessor<SidebarLayoutLocalStoreState>;
  viewportSize: Accessor<SidebarLayoutLocalStoreState["viewportSize"]>;
};

export function readIsMobileSidebarLayout() {
  if (typeof window === "undefined") {
    return false;
  }
  return window.innerWidth < SIDEBAR_LAYOUT_DESKTOP_MIN_WIDTH_PX;
}

function createIsMobileSidebarLayout(): Accessor<boolean> {
  const [isMobile, setIsMobile] = createSignal(readIsMobileSidebarLayout());

  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    const mediaQuery = window.matchMedia(
      `(max-width: ${SIDEBAR_LAYOUT_DESKTOP_MIN_WIDTH_PX - 1}px)`,
    );
    const onChange = () => {
      setIsMobile(readIsMobileSidebarLayout());
    };
    mediaQuery.addEventListener("change", onChange);
    onCleanup(() => {
      mediaQuery.removeEventListener("change", onChange);
    });
  }

  return isMobile;
}

function createSidebarLayoutStore(): SidebarLayoutStore {
  const [activeResizeSide, setActiveResizeSideSignal] =
    createSignal<SidebarLayoutActiveResizeSide>(null);
  const [mobileGrip, setMobileGripSignal] = createSignal<SidebarLayoutMobileGrip>(
    SIDEBAR_LAYOUT_IDLE_MOBILE_GRIP,
  );
  const [isMobilePaneSettled, setIsMobilePaneSettledSignal] = createSignal(true);
  const [mobilePaneScrollProgress, setMobilePaneScrollProgressSignal] = createSignal(0);
  const [viewportSize, setViewportSizeSignal] = createSignal({ heightPx: 0, widthPx: 0 });

  const actions: SidebarLayoutLocalActions = {
    setActiveResizeSide: (next) => {
      setActiveResizeSideSignal((current) => (current === next ? current : next));
    },
    setIsMobilePaneSettled: (next) => {
      setIsMobilePaneSettledSignal((current) => (current === next ? current : next));
    },
    setMobileGrip: (next) => {
      setMobileGripSignal((current) => (current === next ? current : next));
    },
    setMobilePaneScrollProgress: (next) => {
      setMobilePaneScrollProgressSignal((current) => (current === next ? current : next));
    },
    setViewportSize: (next) => {
      setViewportSizeSignal((current) =>
        current.heightPx === next.heightPx && current.widthPx === next.widthPx ? current : next,
      );
    },
  };

  const state = createMemo<SidebarLayoutLocalStoreState>(() => ({
    activeResizeSide: activeResizeSide(),
    mobile: {
      grip: mobileGrip(),
      isPaneSettled: isMobilePaneSettled(),
      paneScrollProgress: mobilePaneScrollProgress(),
    },
    viewportSize: viewportSize(),
  }));

  return {
    actions,
    activeResizeSide,
    isMobilePaneSettled,
    mobileGrip,
    mobilePaneScrollProgress,
    state,
    viewportSize,
  };
}

type SidebarRuntimeContextValue = {
  actions: SidebarRuntimeActions;
  layoutStore: SidebarLayoutStore;
  state: Accessor<SidebarRuntimeState>;
};

export type SidebarRuntimeProviderProps = {
  children?: JSX.Element;
  controller: SidebarLayoutStateController;
};

const SidebarRuntimeContext = createContext<SidebarRuntimeContextValue | null>(null);

export function useSidebarRuntimeActions() {
  return useSidebarRuntime().actions;
}

export function useSidebarRuntimeState() {
  return useSidebarRuntime().state;
}

export function useSidebarLayoutActions() {
  return useSidebarRuntime().layoutStore.actions;
}

export function useSidebarLayoutStore() {
  return useSidebarRuntime().layoutStore;
}

function resolveNextPaneValue<T>(currentValue: T, nextValue: StateUpdater<T>) {
  return typeof nextValue === "function"
    ? (nextValue as (current: T) => T)(currentValue)
    : nextValue;
}

function areMobileSurfacesEqual(
  left: SidebarLayoutState["mobileSurface"],
  right: SidebarLayoutState["mobileSurface"],
) {
  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "unmerged") {
    return true;
  }

  return (
    right.kind === "merged" && left.side === right.side && left.mainWidthPx === right.mainWidthPx
  );
}

export function SidebarRuntimeProvider(props: SidebarRuntimeProviderProps) {
  const isMobile = createIsMobileSidebarLayout();
  const sidebarLayoutStore = createSidebarLayoutStore();

  const updatePaneState = <Key extends keyof SidebarLayoutState>(
    key: Key,
    nextValue: StateUpdater<SidebarLayoutState[Key]>,
    persistenceMode: SidebarLayoutStatePersistenceMode,
  ) => {
    props.controller.setState((state) => {
      const nextFieldValue = resolveNextPaneValue(state[key], nextValue);
      if (state[key] === nextFieldValue) {
        return state;
      }

      const nextState = { ...state };
      nextState[key] = nextFieldValue;
      return nextState;
    }, persistenceMode);
  };

  const setLeftDesktopOpen = (nextOpen: StateUpdater<boolean>) => {
    updatePaneState("leftDesktopOpen", nextOpen, "immediate");
  };

  const setRightDesktopOpen = (nextOpen: StateUpdater<boolean>) => {
    updatePaneState("rightDesktopOpen", nextOpen, "immediate");
  };

  const setDesktopWidths = ({
    leftWidthPx,
    rightWidthPx,
  }: {
    leftWidthPx: number;
    rightWidthPx: number;
  }) => {
    props.controller.setState((state) => {
      if (
        state.leftDesktopWidthPx === leftWidthPx &&
        state.rightDesktopWidthPx === rightWidthPx
      ) {
        return state;
      }

      return { ...state, leftDesktopWidthPx: leftWidthPx, rightDesktopWidthPx: rightWidthPx };
    }, "width_deferred");
  };

  const setLeftMobileWidthPx = (nextWidthPx: StateUpdater<number>) => {
    updatePaneState("leftMobileWidthPx", nextWidthPx, "width_deferred");
  };

  const setRightMobileWidthPx = (nextWidthPx: StateUpdater<number>) => {
    updatePaneState("rightMobileWidthPx", nextWidthPx, "width_deferred");
  };

  const setMobilePane = (nextPane: StateUpdater<MobilePane>) => {
    props.controller.setState((state) => {
      const nextMobilePane = resolveNextPaneValue(state.mobilePane, nextPane);
      if (
        state.mobilePane === nextMobilePane &&
        (nextMobilePane !== "main" || state.mobileSurface.kind === "unmerged")
      ) {
        return state;
      }

      return {
        ...state,
        mobilePane: nextMobilePane,
        mobileSurface:
          nextMobilePane === "main"
            ? SIDEBAR_LAYOUT_UNMERGED_MOBILE_SURFACE
            : state.mobileSurface,
      };
    }, "immediate");
  };

  const setMobileSurface = (nextSurface: StateUpdater<SidebarLayoutState["mobileSurface"]>) => {
    props.controller.setState((state) => {
      const nextMobileSurface = resolveNextPaneValue(state.mobileSurface, nextSurface);
      if (areMobileSurfacesEqual(state.mobileSurface, nextMobileSurface)) {
        return state;
      }

      return { ...state, mobileSurface: nextMobileSurface };
    }, "immediate");
  };

  const settleMobileMergedSurface = ({
    mainWidthPx,
    side,
    sideWidthPx,
  }: {
    mainWidthPx: number;
    side: SidebarSide;
    sideWidthPx: number;
  }) => {
    props.controller.setState((state) => {
      const nextMobileSurface = {
        kind: "merged",
        mainWidthPx,
        side,
      } satisfies SidebarLayoutState["mobileSurface"];
      const nextState = {
        ...state,
        leftMobileWidthPx: side === "left" ? sideWidthPx : state.leftMobileWidthPx,
        mobilePane: side,
        mobileSurface: nextMobileSurface,
        rightMobileWidthPx: side === "right" ? sideWidthPx : state.rightMobileWidthPx,
      };

      if (
        state.mobilePane === nextState.mobilePane &&
        state.leftMobileWidthPx === nextState.leftMobileWidthPx &&
        state.rightMobileWidthPx === nextState.rightMobileWidthPx &&
        areMobileSurfacesEqual(state.mobileSurface, nextMobileSurface)
      ) {
        return state;
      }

      return nextState;
    }, "immediate");
  };

  const toggleLeftPane = () => {
    if (isMobile()) {
      setMobilePane((currentPane) => (currentPane === "left" ? "main" : "left"));
      return;
    }

    setLeftDesktopOpen((currentOpen) => !currentOpen);
  };

  const toggleRightPane = () => {
    if (isMobile()) {
      setMobilePane((currentPane) => (currentPane === "right" ? "main" : "right"));
      return;
    }

    setRightDesktopOpen((currentOpen) => !currentOpen);
  };

  const sidebarRuntimeState = createMemo<SidebarRuntimeState>(() => {
    const controllerState = props.controller.state;
    return {
      isMobile: isMobile(),
      leftDesktopOpen: controllerState.leftDesktopOpen,
      leftDesktopWidthPx: controllerState.leftDesktopWidthPx,
      leftMobileWidthPx: controllerState.leftMobileWidthPx,
      mobilePane: controllerState.mobilePane,
      mobileSurface: controllerState.mobileSurface,
      rightDesktopOpen: controllerState.rightDesktopOpen,
      rightDesktopWidthPx: controllerState.rightDesktopWidthPx,
      rightMobileWidthPx: controllerState.rightMobileWidthPx,
    };
  });

  const actions: SidebarRuntimeActions = {
    setLeftDesktopOpen,
    setDesktopWidths,
    setLeftMobileWidthPx,
    setMobilePane,
    setMobileSurface,
    setRightDesktopOpen,
    setRightMobileWidthPx,
    settleMobileMergedSurface,
    toggleLeftPane,
    toggleRightPane,
  };

  const runtime: SidebarRuntimeContextValue = {
    actions,
    layoutStore: sidebarLayoutStore,
    state: sidebarRuntimeState,
  };

  return (
    <SidebarRuntimeContext.Provider value={runtime}>
      {props.children}
    </SidebarRuntimeContext.Provider>
  );
}

function useSidebarRuntime() {
  const runtime = useContext(SidebarRuntimeContext);
  if (runtime === null) {
    throw new Error("Sidebar runtime context is missing.");
  }

  return runtime;
}
