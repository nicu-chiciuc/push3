import { createMemo, type Accessor } from "solid-js";
import {
  SidebarRuntimeProvider,
  useSidebarLayoutStore,
  useSidebarRuntimeActions as useSidebarRuntimeActionsInternal,
  useSidebarRuntimeState,
  type StateUpdater,
} from "./SidebarRuntimeInternal.tsx";
import {
  getSidebarLayoutPresentation,
  useSidebarLayoutDisplayedMobileState,
  type SidebarLayoutPresentation,
} from "./SidebarLayoutPresentation.ts";
import type { MobilePane } from "./SidebarLayoutState.ts";

export { SidebarRuntimeProvider };
export type { SidebarRuntimeProviderProps, StateUpdater } from "./SidebarRuntimeInternal.tsx";
export type {
  SidebarLayoutPresentation,
  SidebarLayoutMobileMergeProgress,
} from "./SidebarLayoutPresentation.ts";
export type {
  MobilePane,
  SidebarSide,
  SidebarLayoutState,
  SidebarLayoutStateController,
} from "./SidebarLayoutState.ts";

export type SidebarActions = {
  setMobilePane: (nextPane: StateUpdater<MobilePane>) => void;
  toggleLeftPane: () => void;
  toggleRightPane: () => void;
};

export function useSidebarActions(): SidebarActions {
  const { setMobilePane, toggleLeftPane, toggleRightPane } = useSidebarRuntimeActionsInternal();
  return { setMobilePane, toggleLeftPane, toggleRightPane };
}

export function useSidebarLayoutPresentation(): Accessor<SidebarLayoutPresentation> {
  const displayedMobileState = useSidebarLayoutDisplayedMobileState();
  const paneState = useSidebarRuntimeState();
  const layoutStore = useSidebarLayoutStore();

  return createMemo(() =>
    getSidebarLayoutPresentation({
      displayedMobileState: displayedMobileState(),
      localState: layoutStore.state(),
      paneState: paneState(),
    }),
  );
}
