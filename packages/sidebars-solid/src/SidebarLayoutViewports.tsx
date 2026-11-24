import { Show, type JSX } from "solid-js";
import type { SidebarLayoutActiveResizeSide } from "./SidebarLayoutGeometryInternal.ts";

export type SidebarLayoutViewportProps = {
  activeResizeSide: SidebarLayoutActiveResizeSide;
  carouselRef: (el: HTMLDivElement) => void;
  desktopLeftWidthPx: number;
  desktopRightWidthPx: number;
  enableDesktopPaneTransitions: boolean;
  hasMeasuredViewport: boolean;
  inertClosedDesktopPanes: boolean;
  leftContent?: JSX.Element;
  leftPaneId: string;
  leftWidthPx: number;
  lockCarouselScroll: boolean;
  mainContent: JSX.Element;
  paneWidthPx: number;
  rightContent?: JSX.Element;
  rightPaneId: string;
  rightWidthPx: number;
  showLeftPane: boolean;
  showRightPane: boolean;
};

export function SidebarLayoutViewport(props: SidebarLayoutViewportProps) {
  const leftWidth = () =>
    props.hasMeasuredViewport
      ? `${props.leftWidthPx}px`
      : "var(--sidebar-layout-left-mobile-width, 0px)";
  const rightWidth = () =>
    props.hasMeasuredViewport
      ? `${props.rightWidthPx}px`
      : "var(--sidebar-layout-right-mobile-width, 0px)";
  const mainWidth = () =>
    props.hasMeasuredViewport
      ? `${props.paneWidthPx}px`
      : "var(--sidebar-layout-main-mobile-width, 100%)";

  return (
    <div
      ref={props.carouselRef}
      data-carousel-scroll-locked={props.lockCarouselScroll ? "" : undefined}
      data-viewport-measured={props.hasMeasuredViewport ? "" : undefined}
      data-sidebar-layout-part="carousel"
      data-scroll-restoration-ignore=""
    >
      <Show when={props.showLeftPane}>
        <div
          data-active-resize={props.activeResizeSide === "left" ? "" : undefined}
          data-pane-side="left"
          data-transition-enabled={props.enableDesktopPaneTransitions ? "" : undefined}
          data-sidebar-layout-part="pane"
          id={props.leftPaneId}
          inert={props.inertClosedDesktopPanes && props.desktopLeftWidthPx === 0}
          style={{ width: leftWidth() }}
        >
          {props.leftContent}
        </div>
      </Show>

      <div
        data-pane-side="main"
        data-sidebar-layout-part="pane"
        style={{ width: mainWidth() }}
      >
        <div data-sidebar-layout-part="pane-surface">{props.mainContent}</div>
      </div>

      <Show when={props.showRightPane}>
        <div
          data-active-resize={props.activeResizeSide === "right" ? "" : undefined}
          data-pane-side="right"
          data-transition-enabled={props.enableDesktopPaneTransitions ? "" : undefined}
          data-sidebar-layout-part="pane"
          id={props.rightPaneId}
          inert={props.inertClosedDesktopPanes && props.desktopRightWidthPx === 0}
          style={{ width: rightWidth() }}
        >
          {props.rightContent}
        </div>
      </Show>
    </div>
  );
}
