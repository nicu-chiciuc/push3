import { children, Show, type JSX } from "solid-js";

export type PaneFrameProps = {
  header?: JSX.Element;
  content?: JSX.Element;
  footer?: JSX.Element;
  headerVisibility?: "all" | "desktop";
  scrollRestorationId?: string;
};

/**
The header row and content scroller each declare an anonymous CSS container.
Pane content can respond to its own width instead of the window width.
*/
export function PaneFrame(props: PaneFrameProps) {
  const header = children(() => props.header);
  const footer = children(() => props.footer);

  return (
    <section data-sidebar-layout-part="pane-frame">
      <Show when={header()}>
        <div
          data-header-visibility={props.headerVisibility ?? "all"}
          data-sidebar-layout-part="pane-header"
        >
          {header()}
        </div>
      </Show>

      <div
        data-scroll-restoration-id={props.scrollRestorationId}
        data-sidebar-layout-part="pane-scrollport"
      >
        <div data-sidebar-layout-part="pane-content">{props.content}</div>
      </div>

      <Show when={footer()}>
        <div data-sidebar-layout-part="pane-footer">{footer()}</div>
      </Show>
    </section>
  );
}
