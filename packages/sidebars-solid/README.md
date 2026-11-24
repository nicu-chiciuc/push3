# sidebars-solid

`sidebars-solid` is a Solid port of `@samebase/sidebars` (version `0.1.3`, Samebase monorepo commit `195509111eebd8591fdaec520baa2beee9331881`).

It keeps the same DOM order, `data-sidebar-layout-part` names, `data-*` state attributes, CSS custom properties, desktop resizing rules, and mobile scroll-snap carousel contract so the original `structure.css` works unchanged.

## Included

- `SidebarLayout` with `addressChrome`, optional `left` and `right` panes, and `main` pane.
- `PaneFrame` with header, content scrollport (`container-type: inline-size`), and footer.
- `SidebarRuntimeProvider`, `useSidebarActions`, and `useSidebarLayoutPresentation` (returning a Solid accessor).
- `createLocalStorageSidebarController` for reactive client state persisted to `localStorage` with `try/catch` and deferred width writes.
- Desktop open/close toggles and pointer/keyboard resizing with the same 160 px main/sidebar minimum width rules.
- Mobile scroll-snap carousel, touch-owned scroll settling, and mobile grip/edge resizing (merge and slide behaviors).
- Verbatim `structure.css`, geometry calculations, root state helpers, resize handle configs, and body style lock.

## Left out

This port targets client-only Solid apps and intentionally leaves out:

- Server-side rendering (SSR) markup and hydration handoff (`useSyncExternalStore` server snapshots, `suppressHydrationWarning`, hydration root attribute patching).
- Prehydration inline scripts (`initialStateScript` prop on `SidebarLayout` and `<InitialPaneScript />` inside each pane).
- `@tanstack/react-store` (replaced with native Solid signals and memos).
- `SidebarLayoutTesting` harness and package build/publint scripts (this workspace package exports TypeScript source directly).
