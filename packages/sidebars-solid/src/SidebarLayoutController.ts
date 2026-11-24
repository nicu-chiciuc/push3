import { createSignal } from "solid-js";
import type {
  MobilePane,
  MobileSurface,
  SidebarLayoutState,
  SidebarLayoutStateController,
  SidebarLayoutStatePersistenceMode,
  SidebarLayoutStateUpdate,
} from "./SidebarLayoutState.ts";

export const DEFAULT_SIDEBAR_LAYOUT_STATE: SidebarLayoutState = {
  leftDesktopOpen: true,
  leftDesktopWidthPx: 320,
  leftMobileWidthPx: 300,
  mobilePane: "main",
  mobileSurface: { kind: "unmerged" },
  rightDesktopOpen: false,
  rightDesktopWidthPx: 320,
  rightMobileWidthPx: 300,
};

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isMobilePane(value: unknown): value is MobilePane {
  return value === "left" || value === "main" || value === "right";
}

function parseMobileSurface(value: unknown): MobileSurface | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.kind === "unmerged") return { kind: "unmerged" };
  if (
    record.kind === "merged" &&
    (record.side === "left" || record.side === "right") &&
    isFinitePositive(record.mainWidthPx)
  ) {
    return { kind: "merged", mainWidthPx: record.mainWidthPx, side: record.side };
  }
  return null;
}

function readStoredState(
  storageKey: string,
  fallback: SidebarLayoutState,
): SidebarLayoutState {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed === null) return fallback;

    const surface = parseMobileSurface(parsed.mobileSurface);
    return {
      leftDesktopOpen:
        typeof parsed.leftDesktopOpen === "boolean"
          ? parsed.leftDesktopOpen
          : fallback.leftDesktopOpen,
      leftDesktopWidthPx: isFinitePositive(parsed.leftDesktopWidthPx)
        ? parsed.leftDesktopWidthPx
        : fallback.leftDesktopWidthPx,
      leftMobileWidthPx: isFinitePositive(parsed.leftMobileWidthPx)
        ? parsed.leftMobileWidthPx
        : fallback.leftMobileWidthPx,
      mobilePane: isMobilePane(parsed.mobilePane) ? parsed.mobilePane : fallback.mobilePane,
      mobileSurface: surface ?? fallback.mobileSurface,
      rightDesktopOpen:
        typeof parsed.rightDesktopOpen === "boolean"
          ? parsed.rightDesktopOpen
          : fallback.rightDesktopOpen,
      rightDesktopWidthPx: isFinitePositive(parsed.rightDesktopWidthPx)
        ? parsed.rightDesktopWidthPx
        : fallback.rightDesktopWidthPx,
      rightMobileWidthPx: isFinitePositive(parsed.rightMobileWidthPx)
        ? parsed.rightMobileWidthPx
        : fallback.rightMobileWidthPx,
    };
  } catch {
    return fallback;
  }
}

export type LocalStorageSidebarControllerOptions = {
  storageKey: string;
  defaults?: Partial<SidebarLayoutState>;
  widthPersistDebounceMs?: number;
};

export function createLocalStorageSidebarController(
  options: LocalStorageSidebarControllerOptions,
): SidebarLayoutStateController {
  const fallback: SidebarLayoutState = {
    ...DEFAULT_SIDEBAR_LAYOUT_STATE,
    ...options.defaults,
  };
  const debounceMs = options.widthPersistDebounceMs ?? 250;
  const [state, setStateSignal] = createSignal<SidebarLayoutState>(
    readStoredState(options.storageKey, fallback),
  );

  let persistTimer: number | null = null;
  const write = (next: SidebarLayoutState) => {
    try {
      window.localStorage.setItem(options.storageKey, JSON.stringify(next));
    } catch {
      /* Ignore storage quota or private-mode errors. */
    }
  };

  const schedulePersist = (
    next: SidebarLayoutState,
    mode: SidebarLayoutStatePersistenceMode,
  ) => {
    if (persistTimer !== null) {
      window.clearTimeout(persistTimer);
      persistTimer = null;
    }
    if (mode === "immediate") {
      write(next);
      return;
    }
    persistTimer = window.setTimeout(() => {
      persistTimer = null;
      write(next);
    }, debounceMs);
  };

  return {
    get state() {
      return state();
    },
    setState(
      updateState: SidebarLayoutStateUpdate,
      persistenceMode: SidebarLayoutStatePersistenceMode,
    ) {
      setStateSignal((current) => {
        const next = updateState(current);
        if (next !== current) {
          schedulePersist(next, persistenceMode);
        }
        return next;
      });
    },
  };
}
