import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { css } from '@push3/protocol';
import {
  createLocalStorageSidebarController,
  PaneFrame,
  SidebarLayout,
  SidebarRuntimeProvider,
  useSidebarActions,
  useSidebarLayoutPresentation,
} from 'sidebars-solid';
import type { Engine } from '../engine/engine.ts';

const IS_LOCALHOST = ['localhost', '127.0.0.1'].includes(location.hostname);

export const App: Component<{ engine: Engine }> = (props) => {
  const controller = createLocalStorageSidebarController({
    storageKey: 'push3twin:layout',
    defaults: {
      leftDesktopOpen: true,
      leftDesktopWidthPx: 336,
      leftMobileWidthPx: 320,
      mobilePane: 'main',
      mobileSurface: { kind: 'unmerged' },
      rightDesktopOpen: false,
      rightDesktopWidthPx: 320,
      rightMobileWidthPx: 320,
    },
  });

  return (
    <SidebarRuntimeProvider controller={controller}>
      <Shell engine={props.engine} />
    </SidebarRuntimeProvider>
  );
};

const Shell: Component<{ engine: Engine }> = (props) => {
  const e = props.engine;
  const [dismissedAlert, setDismissedAlert] = createSignal<string | null>(null);

  const onKey = (ev: KeyboardEvent) => {
    if (ev.target instanceof Element && ev.target.closest('input, textarea, select, [contenteditable]')) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const n = +ev.key;
    if (n >= 1 && n <= e.demos.length) e.switchDemo(n - 1);
  };
  onMount(() => addEventListener('keydown', onKey));
  onCleanup(() => removeEventListener('keydown', onKey));

  const direct = () => e.linkKind() === 'direct';
  const bridge = () => e.linkKind() === 'bridge';
  const needsConnect = () => direct() && e.status().link && (!e.status().midi || !e.status().display);
  const otherMode = () => `${location.pathname}?link=${direct() ? 'bridge' : 'direct'}`;

  const connectionSummary = createMemo((): {
    label: string;
    tone: 'ok' | 'warn' | 'bad' | 'idle';
    title: string;
  } => {
    const s = e.status();
    if (s.midi && s.display) {
      return {
        label: 'Connected',
        tone: 'ok',
        title: 'Push 3 MIDI & USB display active. Click to inspect device and event log.',
      };
    }
    if (s.midi) {
      return {
        label: 'Pads only',
        tone: 'warn',
        title: 'MIDI connected; display unavailable. Click to inspect device and event log.',
      };
    }
    if (s.display) {
      return {
        label: 'Screen only',
        tone: 'warn',
        title: 'Display connected; MIDI unavailable. Click to inspect device and event log.',
      };
    }
    if (bridge() && !s.link) {
      return {
        label: 'Bridge offline',
        tone: 'bad',
        title: 'Local bridge is offline. Click to inspect device and event log.',
      };
    }
    return {
      label: 'Virtual',
      tone: 'idle',
      title: 'Running in 3D virtual mode. Click to inspect device and event log.',
    };
  });

  // Only surface an inline alert on the 3D stage for actionable partial/broken hardware states:
  // never nag visitors who are just exploring the 3D twin without hardware plugged in.
  const stageAlert = createMemo((): { text: string; tone: 'warn' | 'bad' } | null => {
    const s = e.status();
    if (direct()) {
      if (s.midi && !s.display) {
        return {
          tone: 'warn',
          text: 'Pads connected, screen busy. quit Ableton Live and click Connect Push.',
        };
      }
      if (!s.midi && s.display) {
        return {
          tone: 'warn',
          text: 'Screen connected, MIDI blocked. click Connect Push and allow MIDI access.',
        };
      }
      return null;
    }
    if (bridge()) {
      if (!s.link) {
        return {
          tone: 'bad',
          text: 'Local bridge offline. run `pnpm dev` or switch to Direct mode in Hardware.',
        };
      }
      if (s.midi && !s.display) {
        return {
          tone: 'warn',
          text: 'Push display busy. quit Ableton Live so its background Push3 process releases USB.',
        };
      }
    }
    return null;
  });

  const visibleAlert = createMemo(() => {
    const a = stageAlert();
    return a && a.text !== dismissedAlert() ? a : null;
  });

  return (
    <SidebarLayout
      addressChrome={
        <TopBar
          engine={e}
          summary={connectionSummary()}
          needsConnect={needsConnect()}
          onConnect={() => e.connectDevice()}
        />
      }
      left={<DemosPane engine={e} />}
      main={
        <MainStagePane
          engine={e}
          alert={visibleAlert()}
          onDismissAlert={(text) => setDismissedAlert(text)}
        />
      }
      right={
        <RightPane
          engine={e}
          direct={direct()}
          needsConnect={needsConnect()}
          otherMode={otherMode()}
        />
      }
      resizeHandleLabels={{
        left: 'Resize demos pane',
        right: 'Resize hardware and log pane',
      }}
      formatResizeHandleValueText={({ widthPx }) => `${widthPx} pixels wide`}
    />
  );
};

const TopBar: Component<{
  engine: Engine;
  summary: { label: string; tone: 'ok' | 'warn' | 'bad' | 'idle'; title: string };
  needsConnect: boolean;
  onConnect: () => void;
}> = (props) => {
  const e = props.engine;
  const actions = useSidebarActions();
  const presentation = useSidebarLayoutPresentation();

  return (
    <header class="top" classList={{ mobile: presentation().isMobile }}>
      <Show
        when={presentation().isMobile}
        fallback={
          <>
            <div class="top-left">
              <button
                type="button"
                class="icon-btn"
                classList={{ active: presentation().leftDesktopOpen }}
                aria-pressed={presentation().leftDesktopOpen}
                aria-label="Toggle modes sidebar"
                title="Toggle modes sidebar"
                onClick={() => actions.toggleLeftPane()}
              >
                <SidebarLeftIcon />
              </button>

              <div class="brand">
                <BrandMark />
                <span class="brand-name">Push 3</span>
                <span class="brand-tag">Twin</span>
              </div>

              <Show when={!presentation().leftDesktopOpen}>
                <button
                  type="button"
                  class="active-demo-chip"
                  style={{ '--c': css(e.demo.color) }}
                  title="Open modes sidebar"
                  onClick={() => actions.toggleLeftPane()}
                >
                  <span class="chip-led" aria-hidden="true" />
                  <span>{e.demo.name}</span>
                </button>
              </Show>
            </div>

            <div class="top-right">
              <Show when={props.needsConnect}>
                <button type="button" class="primary connect-btn" onClick={() => props.onConnect()}>
                  <UsbIcon />
                  <span>Connect Push</span>
                </button>
              </Show>

              <button
                type="button"
                class={`inspector-pill ${props.summary.tone}`}
                classList={{ active: presentation().rightDesktopOpen }}
                aria-pressed={presentation().rightDesktopOpen}
                title={props.summary.title}
                onClick={() => actions.toggleRightPane()}
              >
                <span class="status-dot" aria-hidden="true" />
                <span class="status-label">{props.summary.label}</span>
                <SidebarRightIcon />
              </button>
            </div>
          </>
        }
      >
        <nav class="mobile-nav" aria-label="Workspace panes">
          <button
            type="button"
            class="mobile-seg"
            classList={{ active: presentation().mobilePane === 'left' }}
            aria-current={presentation().mobilePane === 'left' ? 'page' : undefined}
            onClick={() => actions.setMobilePane('left')}
          >
            <span
              class="seg-dot"
              style={{ background: css(e.demo.color) }}
              aria-hidden="true"
            />
            <span>Demos</span>
          </button>

          <button
            type="button"
            class="mobile-seg"
            classList={{ active: presentation().mobilePane === 'main' }}
            aria-current={presentation().mobilePane === 'main' ? 'page' : undefined}
            onClick={() => actions.setMobilePane('main')}
          >
            <span>Push 3</span>
          </button>

          <button
            type="button"
            class="mobile-seg"
            classList={{ active: presentation().mobilePane === 'right' }}
            aria-current={presentation().mobilePane === 'right' ? 'page' : undefined}
            onClick={() => actions.setMobilePane('right')}
          >
            <span class={`status-dot ${props.summary.tone}`} aria-hidden="true" />
            <span>Log</span>
          </button>
        </nav>

        <Show when={props.needsConnect}>
          <button type="button" class="primary mobile-connect-btn" onClick={() => props.onConnect()}>
            Connect
          </button>
        </Show>
      </Show>
    </header>
  );
};

const DemosPane: Component<{ engine: Engine }> = (props) => {
  const e = props.engine;

  return (
    <PaneFrame
      headerVisibility="desktop"
      header={
        <div class="pane-head">
          <span class="pane-title">Modes</span>
          <span class="pane-meta">Keys 1–8</span>
        </div>
      }
      content={
        <div class="demos-pane">
          <nav id="tabs" aria-label="Demos">
            <For each={e.demos}>
              {(d, i) => (
                <button
                  type="button"
                  class="tab"
                  classList={{ active: e.demoIndex() === i() }}
                  style={{ '--c': css(d.color) }}
                  title={i() < 8 ? `${d.name} (upper display button ${i() + 1} on Push, key ${i() + 1})` : `${d.name} (key ${i() + 1}; no button on Push)`}
                  onClick={() => e.switchDemo(i())}
                >
                  <span class="tab-led" aria-hidden="true" />
                  <span class="num">{i() + 1}</span>
                  <span class="tab-name">{d.name}</span>
                </button>
              )}
            </For>
          </nav>
          <div id="demo-panel" style={{ '--accent': css(e.demo.color) }}>
            <Dynamic component={e.demo.Panel} app={e} />
          </div>
        </div>
      }
    />
  );
};

const MainStagePane: Component<{
  engine: Engine;
  alert: { text: string; tone: 'warn' | 'bad' } | null;
  onDismissAlert: (text: string) => void;
}> = (props) => (
  <PaneFrame
    content={
      <Stage
        engine={props.engine}
        alert={props.alert}
        onDismissAlert={props.onDismissAlert}
      />
    }
  />
);

const RightPane: Component<{
  engine: Engine;
  direct: boolean;
  needsConnect: boolean;
  otherMode: string;
}> = (props) => (
  <PaneFrame
    headerVisibility="desktop"
    header={
      <div class="pane-head">
        <span class="pane-title">Hardware &amp; Log</span>
      </div>
    }
    content={
      <div class="right-pane">
        <DevicePanel
          engine={props.engine}
          direct={props.direct}
          needsConnect={props.needsConnect}
          otherMode={props.otherMode}
        />
        <EventLog engine={props.engine} />
      </div>
    }
  />
);

const Stage: Component<{
  engine: Engine;
  alert: { text: string; tone: 'warn' | 'bad' } | null;
  onDismissAlert: (text: string) => void;
}> = (props) => {
  const e = props.engine;
  const presentation = useSidebarLayoutPresentation();
  let canvasHost!: HTMLDivElement;

  createEffect(() => {
    e.setMobileTouch(presentation().isMobile);
  });

  onMount(() => e.mount(canvasHost));

  const isTop = () => e.cameraView() === 'top';
  const toggleView = () => e.setCameraView(isTop() ? 'angled' : 'top');

  return (
    <section id="stage" aria-label="3D model of the Push 3">
      <div class="stage-canvas" ref={canvasHost} />

      <Show when={props.alert}>
        {(a) => (
          <div id="stage-alert" class={a().tone} role="status">
            <span class="alert-dot" aria-hidden="true" />
            <span class="alert-text">{a().text}</span>
            <button
              type="button"
              class="alert-close"
              aria-label="Dismiss message"
              onClick={() => props.onDismissAlert(a().text)}
            >
              ×
            </button>
          </div>
        )}
      </Show>

      <div class="stage-cam" aria-label="Camera view">
        <Show when={e.cameraMoved()}>
          <button
            type="button"
            class="cam-btn"
            title="Reset camera view (or double-click desk)"
            onClick={() => e.resetCamera()}
          >
            <ResetIcon />
            <span>Reset</span>
          </button>
        </Show>
        <button
          type="button"
          class="cam-btn"
          classList={{ active: isTop() }}
          aria-pressed={isTop()}
          title={isTop() ? 'Switch to 3D angle' : 'Switch to top-down view'}
          onClick={toggleView}
        >
          <Show when={isTop()} fallback={<TopViewIcon />}>
            <AngledViewIcon />
          </Show>
          <span>{isTop() ? '3D' : 'Top'}</span>
        </button>
      </div>
    </section>
  );
};

const DevicePanel: Component<{
  engine: Engine;
  direct: boolean;
  needsConnect: boolean;
  otherMode: string;
}> = (props) => {
  const e = props.engine;
  const s = () => e.status();

  return (
    <section class="device-section" aria-label="Push 3 connection">
      <div class="device-tiles">
        <StatusTile
          ok={s().link}
          label={props.direct ? 'Browser' : 'Bridge'}
          value={
            props.direct
              ? s().link
                ? 'Ready'
                : 'Virtual'
              : s().link
                ? 'Online'
                : 'Offline'
          }
        />
        <StatusTile
          ok={s().midi}
          label="MIDI"
          value={s().midi ? 'User Mode' : 'Idle'}
        />
        <StatusTile
          ok={s().display}
          label="Display"
          value={s().display ? 'Live' : 'Idle'}
        />
      </div>

      <div class="device-actions">
        <Show when={props.needsConnect}>
          <button type="button" class="primary" onClick={() => e.connectDevice()}>
            Connect Push
          </button>
        </Show>
        <Show when={s().midi || !props.direct}>
          <button
            type="button"
            title="Re-send palette, modes and every LED to the Push"
            disabled={!s().midi}
            onClick={() => e.resync()}
          >
            Re-sync
          </button>
        </Show>
        <Show when={IS_LOCALHOST}>
          <a
            class="mode-link"
            href={props.otherMode}
            title="Switch between the local Node bridge and talking to the Push directly from this page"
          >
            {props.direct ? 'Use local bridge' : 'Use direct mode'}
          </a>
        </Show>
      </div>

      <Show when={props.direct && !s().link}>
        <p class="device-note">
          Running in 3D virtual mode. Open in Chrome or Edge on desktop to connect a USB Push 3.
        </p>
      </Show>
      <Show when={props.needsConnect}>
        <p class="device-note">
          Quit Ableton Live before connecting so it releases the USB display.
        </p>
      </Show>
    </section>
  );
};

const StatusTile: Component<{ ok: boolean; label: string; value: string }> = (p) => (
  <div class="device-tile" classList={{ ok: p.ok }}>
    <div class="device-tile-top">
      <span class="device-dot" classList={{ ok: p.ok }} aria-hidden="true" />
      <span class="device-key">{p.label}</span>
    </div>
    <span class="device-val">{p.value}</span>
  </div>
);

const EventLog: Component<{ engine: Engine }> = (props) => {
  const e = props.engine;
  return (
    <section id="log" aria-label="Event log">
      <header>
        <div class="log-title-row">
          <h3>Event log</h3>
          <span id="log-count">{e.sent().toLocaleString()} tx</span>
        </div>
        <div class="log-controls">
          <label class="toggle small">
            <input
              type="checkbox"
              checked={e.logContinuous()}
              onChange={(ev) => e.setLogContinuous(ev.currentTarget.checked)}
            />
            Continuous
          </label>
          <button type="button" onClick={() => e.setLogPaused(!e.logPaused())}>
            {e.logPaused() ? 'Resume' : 'Pause'}
          </button>
          <button type="button" onClick={e.clearLog} disabled={e.log().length === 0}>
            Clear
          </button>
        </div>
      </header>
      <Show
        when={e.log().length > 0}
        fallback={
          <div class="log-empty">
            Press a pad, turn a knob, or touch the strip on the 3D Push or hardware to inspect live MIDI events.
          </div>
        }
      >
        <ul id="log-list">
          <For each={e.log()}>
            {(entry) => (
              <li class={entry.kind}>
                <span class={`src ${entry.source}`}>{entry.source === 'virtual' ? '3D' : 'HW'}</span>
                <span class="txt">{entry.text}</span>
                <code>{entry.raw}</code>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
};

/* Minimal crisp studio icons */
const BrandMark = () => (
  <svg class="brand-mark" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <rect x="1" y="1" width="7" height="7" rx="1.8" fill="#46d7ff" />
    <rect x="10" y="1" width="7" height="7" rx="1.8" fill="#ff9628" />
    <rect x="1" y="10" width="7" height="7" rx="1.8" fill="#ff5cc8" />
    <rect x="10" y="10" width="7" height="7" rx="1.8" fill="#3ddc84" />
  </svg>
);

const SidebarLeftIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="2" y="2.5" width="12" height="11" rx="2" />
    <line x1="6" y1="2.5" x2="6" y2="13.5" />
  </svg>
);

const SidebarRightIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="2" y="2.5" width="12" height="11" rx="2" />
    <line x1="10" y1="2.5" x2="10" y2="13.5" />
  </svg>
);

const UsbIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M8 2.5v11" />
    <path d="M5.5 5 8 2.5 10.5 5" />
    <circle cx="4" cy="9.5" r="1.2" fill="currentColor" stroke="none" />
    <path d="M4 9.5v1a2 2 0 0 0 2 2h2" />
    <rect x="10.8" y="6.8" width="2.4" height="2.4" rx="0.5" fill="currentColor" stroke="none" />
    <path d="M12 9.2v.3a2 2 0 0 1-2 2H8" />
  </svg>
);

const TopViewIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
    <path d="M6.2 7.2h3.6M6.2 9.6h3.6" />
  </svg>
);

const AngledViewIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M2.5 10.5 4.3 5h7.4l1.8 5.5z" />
    <path d="M2.5 10.5v1.3a.7.7 0 0 0 .7.7h9.6a.7.7 0 0 0 .7-.7v-1.3" />
  </svg>
);

const ResetIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3.5 8a4.5 4.5 0 1 0 1.2-3.1" />
    <path d="M3.5 2.5v3h3" />
  </svg>
);
