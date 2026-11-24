import { createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from 'solid-js';
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
import type { View } from '../engine/twin.ts';

const VIEWS: ReadonlyArray<[View, string]> = [
  ['angled', 'Angled'],
  ['top', 'Top'],
  ['front', 'Front'],
];

const IS_LOCALHOST = ['localhost', '127.0.0.1'].includes(location.hostname);

export const App: Component<{ engine: Engine }> = (props) => {
  const controller = createLocalStorageSidebarController({
    storageKey: 'push3twin:layout',
    defaults: {
      leftDesktopOpen: true,
      leftDesktopWidthPx: 340,
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

  const [view, setView] = createSignal<View>('angled');
  const [glow, setGlow] = createSignal(true);
  const [dismissedHint, setDismissedHint] = createSignal<string | null>(null);

  const onKey = (ev: KeyboardEvent) => {
    if (ev.target instanceof Element && ev.target.closest('input, textarea, select, [contenteditable]')) return;
    const n = +ev.key;
    if (n >= 1 && n <= e.demos.length) e.switchDemo(n - 1);
  };
  onMount(() => addEventListener('keydown', onKey));
  onCleanup(() => removeEventListener('keydown', onKey));

  const direct = () => e.linkKind() === 'direct';
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
        label: 'Push connected',
        tone: 'ok',
        title: 'MIDI User Mode and USB display streaming. Click to toggle Device and Log.',
      };
    }
    if (s.midi) {
      return {
        label: 'Pads only',
        tone: 'warn',
        title: 'MIDI connected; display not connected. Click to toggle Device and Log.',
      };
    }
    if (s.display) {
      return {
        label: 'Screen only',
        tone: 'warn',
        title: 'Display connected; MIDI not connected. Click to toggle Device and Log.',
      };
    }
    if (!direct() && !s.link) {
      return {
        label: 'Bridge offline',
        tone: 'bad',
        title: 'Local bridge is offline. Click to toggle Device and Log.',
      };
    }
    if (direct() && !s.link) {
      return {
        label: 'Virtual only',
        tone: 'idle',
        title: 'This browser does not support Web MIDI or WebUSB. Click to toggle Device and Log.',
      };
    }
    return {
      label: 'Virtual',
      tone: 'idle',
      title: 'No Push 3 connected; using the 3D twin. Click to toggle Device and Log.',
    };
  });

  const hint = createMemo((): { text: string; tone: 'info' | 'bad' } | null => {
    const s = e.status();
    if (direct()) {
      if (!s.link) {
        return {
          tone: 'info',
          text: 'This browser cannot talk to USB/MIDI devices. Open in Chrome or Edge to connect a Push 3, or play with the 3D model.',
        };
      }
      if (!s.midi && !s.display) {
        return {
          tone: 'info',
          text: 'Quit Ableton Live, plug in Push 3, and click "Connect Push". No hardware? Drag to orbit and click controls on the 3D model.',
        };
      }
      if (!s.display) {
        return {
          tone: 'info',
          text: 'Pads connected. Click "Connect Push" and pick "Ableton Push 3" for the screen. Quit Ableton Live if busy.',
        };
      }
      if (!s.midi) {
        return {
          tone: 'info',
          text: 'Screen connected. Click "Connect Push" and allow MIDI for pads and lights.',
        };
      }
      return null;
    }
    if (!s.link) {
      return {
        tone: 'bad',
        text: 'Bridge offline: run `pnpm dev` in push3-twin, or switch to Direct mode in the Device pane.',
      };
    }
    if (!s.midi) {
      return {
        tone: 'bad',
        text: 'Push 3 not found: plug it in and make sure Ableton Live is closed.',
      };
    }
    if (!s.display) {
      return {
        tone: 'bad',
        text: 'Push screen busy: quit Ableton Live (its background "Push3" process holds the display).',
      };
    }
    return null;
  });

  const visibleHint = createMemo(() => {
    const h = hint();
    return h && h.text !== dismissedHint() ? h : null;
  });

  return (
    <SidebarLayout
      addressChrome={
        <TopBar
          summary={connectionSummary()}
          needsConnect={needsConnect()}
          onConnect={() => e.connectDevice()}
        />
      }
      left={<DemosPane engine={e} />}
      main={
        <MainStagePane
          engine={e}
          view={view()}
          onView={(v) => {
            setView(v);
            e.twin.setView(v);
          }}
          glow={glow()}
          onGlow={(on) => {
            setGlow(on);
            e.twin.setBloom(on);
          }}
          hint={visibleHint()}
          onDismissHint={(text) => setDismissedHint(text)}
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
        right: 'Resize device and log pane',
      }}
      formatResizeHandleValueText={({ widthPx }) => `${widthPx} pixels wide`}
    />
  );
};

const TopBar: Component<{
  summary: { label: string; tone: 'ok' | 'warn' | 'bad' | 'idle'; title: string };
  needsConnect: boolean;
  onConnect: () => void;
}> = (props) => {
  const actions = useSidebarActions();
  const presentation = useSidebarLayoutPresentation();

  const leftActive = () =>
    presentation().isMobile ? presentation().mobilePane === 'left' : presentation().leftDesktopOpen;
  const rightActive = () =>
    presentation().isMobile ? presentation().mobilePane === 'right' : presentation().rightDesktopOpen;

  return (
    <header class="top">
      <div class="top-left">
        <button
          type="button"
          class="pane-toggle"
          classList={{ active: leftActive() }}
          aria-pressed={leftActive()}
          title="Toggle Demos pane"
          onClick={() => actions.toggleLeftPane()}
        >
          Demos
        </button>
        <div class="brand">
          <span class="logo" />
          <span>Push 3 Twin</span>
        </div>
      </div>

      <div class="top-right">
        <button
          type="button"
          class={`status-badge ${props.summary.tone}`}
          title={props.summary.title}
          onClick={() => actions.toggleRightPane()}
        >
          <span class="status-dot" aria-hidden="true" />
          <span class="status-label">{props.summary.label}</span>
        </button>

        <Show when={props.needsConnect}>
          <button type="button" class="primary" onClick={() => props.onConnect()}>
            Connect Push
          </button>
        </Show>

        <button
          type="button"
          class="pane-toggle"
          classList={{ active: rightActive() }}
          aria-pressed={rightActive()}
          title="Toggle Device and Log pane"
          onClick={() => actions.toggleRightPane()}
        >
          Log
        </button>
      </div>
    </header>
  );
};

const DemosPane: Component<{ engine: Engine }> = (props) => {
  const e = props.engine;
  const actions = useSidebarActions();
  const presentation = useSidebarLayoutPresentation();

  return (
    <PaneFrame
      header={
        <div class="pane-head">
          <span class="pane-title">Demos</span>
          <Show when={presentation().isMobile} fallback={<span class="pane-meta">Keys 1-8</span>}>
            <button type="button" class="pane-back" onClick={() => actions.setMobilePane('main')}>
              3D Stage
            </button>
          </Show>
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
                  title={`${d.name} (upper display button ${i() + 1} on Push, key ${i() + 1})`}
                  onClick={() => e.switchDemo(i())}
                >
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
  view: View;
  onView: (v: View) => void;
  glow: boolean;
  onGlow: (on: boolean) => void;
  hint: { text: string; tone: 'info' | 'bad' } | null;
  onDismissHint: (text: string) => void;
}> = (props) => {
  const e = props.engine;
  const actions = useSidebarActions();
  const presentation = useSidebarLayoutPresentation();

  return (
    <PaneFrame
      content={
        <Stage
          engine={e}
          view={props.view}
          onView={props.onView}
          glow={props.glow}
          onGlow={props.onGlow}
          hint={props.hint}
          onDismissHint={props.onDismissHint}
        />
      }
      footer={
        presentation().isMobile ? (
          <div class="mobile-stage-bar">
            <button
              type="button"
              class="mobile-bar-btn"
              onClick={() => actions.setMobilePane('left')}
            >
              <span
                class="demo-dot"
                style={{ background: css(e.demo.color) }}
                aria-hidden="true"
              />
              {e.demo.name}
            </button>
          </div>
        ) : undefined
      }
    />
  );
};

const RightPane: Component<{
  engine: Engine;
  direct: boolean;
  needsConnect: boolean;
  otherMode: string;
}> = (props) => {
  const actions = useSidebarActions();
  const presentation = useSidebarLayoutPresentation();

  return (
    <PaneFrame
      header={
        <div class="pane-head">
          <span class="pane-title">Device &amp; Log</span>
          <Show when={presentation().isMobile}>
            <button type="button" class="pane-back" onClick={() => actions.setMobilePane('main')}>
              3D Stage
            </button>
          </Show>
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
};

const Stage: Component<{
  engine: Engine;
  view: View;
  onView: (v: View) => void;
  glow: boolean;
  onGlow: (on: boolean) => void;
  hint: { text: string; tone: 'info' | 'bad' } | null;
  onDismissHint: (text: string) => void;
}> = (props) => {
  let canvasHost!: HTMLDivElement;
  onMount(() => props.engine.mount(canvasHost));

  return (
    <section id="stage" aria-label="3D model of the Push 3">
      <div class="stage-canvas" ref={canvasHost} />

      <Show when={props.hint}>
        {(h) => (
          <div id="hint" class={h().tone}>
            <span class="hint-text">{h().text}</span>
            <button
              type="button"
              class="hint-close"
              aria-label="Dismiss message"
              onClick={() => props.onDismissHint(h().text)}
            >
              ×
            </button>
          </div>
        )}
      </Show>

      <div class="stage-toolbar" role="toolbar" aria-label="3D stage controls">
        <div class="seg">
          <For each={VIEWS}>
            {([v, label]) => (
              <button
                type="button"
                classList={{ active: props.view === v }}
                onClick={() => props.onView(v)}
              >
                {label}
              </button>
            )}
          </For>
        </div>
        <label class="toggle">
          <input
            type="checkbox"
            checked={props.glow}
            onChange={(ev) => props.onGlow(ev.currentTarget.checked)}
          />
          Glow
        </label>
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
  return (
    <section class="device-section" aria-label="Push 3 connection">
      <div class="device-grid">
        <StatusRow
          ok={e.status().link}
          label={props.direct ? 'Direct' : 'Bridge'}
          value={
            props.direct
              ? e.status().link
                ? 'Web MIDI + WebUSB'
                : 'unsupported browser'
              : e.status().link
                ? 'connected'
                : 'offline'
          }
        />
        <StatusRow
          ok={e.status().midi}
          label="MIDI"
          value={e.status().midi ? 'User Mode' : 'not connected'}
        />
        <StatusRow
          ok={e.status().display}
          label="Screen"
          value={e.status().display ? 'streaming' : 'not connected'}
        />
      </div>
      <div class="device-actions">
        <Show when={props.needsConnect}>
          <button type="button" class="primary" onClick={() => e.connectDevice()}>
            Connect Push
          </button>
        </Show>
        <button
          type="button"
          title="Re-send palette, modes and every LED to the Push"
          disabled={!e.status().midi}
          onClick={() => e.resync()}
        >
          Re-sync
        </button>
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
    </section>
  );
};

const StatusRow: Component<{ ok: boolean; label: string; value: string }> = (p) => (
  <div class="device-row">
    <span class="device-dot" classList={{ ok: p.ok }} aria-hidden="true" />
    <span class="device-key">{p.label}</span>
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
          <span id="log-count">{e.sent().toLocaleString()} sent</span>
        </div>
        <div class="log-controls">
          <label class="toggle small">
            <input
              type="checkbox"
              checked={e.logContinuous()}
              onChange={(ev) => e.setLogContinuous(ev.currentTarget.checked)}
            />
            continuous
          </label>
          <button type="button" onClick={() => e.setLogPaused(!e.logPaused())}>
            {e.logPaused() ? 'Resume' : 'Pause'}
          </button>
          <button type="button" onClick={e.clearLog}>
            Clear
          </button>
        </div>
      </header>
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
    </section>
  );
};
