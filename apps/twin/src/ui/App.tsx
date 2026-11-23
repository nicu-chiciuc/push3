import { createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { css } from '@push3/protocol';
import type { Engine } from '../engine/engine.ts';
import type { View } from '../engine/twin.ts';

const VIEWS: ReadonlyArray<[View, string]> = [['angled', 'Angled'], ['top', 'Top'], ['front', 'Front']];

export const App: Component<{ engine: Engine }> = (props) => {
  const e = props.engine;
  let canvasHost!: HTMLDivElement;
  const [view, setView] = createSignal<View>('angled');
  const [glow, setGlow] = createSignal(true);

  onMount(() => e.mount(canvasHost));
  const onKey = (ev: KeyboardEvent) => {
    if ((ev.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
    const n = +ev.key;
    if (n >= 1 && n <= e.demos.length) e.switchDemo(n - 1);
  };
  onMount(() => addEventListener('keydown', onKey));
  onCleanup(() => removeEventListener('keydown', onKey));

  const direct = () => e.linkKind() === 'direct';
  const needsConnect = () => direct() && e.status().link && (!e.status().midi || !e.status().display);
  const otherMode = () => `${location.pathname}?link=${direct() ? 'bridge' : 'direct'}`;
  const hint = createMemo((): { text: string; tone: 'info' | 'bad' } | null => {
    const s = e.status();
    if (direct()) {
      if (!s.link) return { tone: 'info', text: 'This browser can’t talk to USB/MIDI devices. Open this page in Chrome or Edge to connect a Push 3, or just play with the virtual one.' };
      if (!s.midi && !s.display) return { tone: 'info', text: 'Have a Push 3? Quit Ableton Live, plug it in and click “Connect Push”. No Push? Click and drag the virtual one.' };
      if (!s.display) return { tone: 'info', text: 'Pads connected. For the screen, click “Connect Push” and pick “Ableton Push 3”. If it stays off, quit Ableton Live (and the Node bridge, or any other tab using the Push).' };
      if (!s.midi) return { tone: 'info', text: 'Screen connected. Click “Connect Push” and allow MIDI to use pads and lights.' };
      return null;
    }
    if (!s.link) return { tone: 'bad', text: 'Bridge offline: run `npm run dev` in the push3-twin folder, or switch to Direct mode (Chrome/Edge, nothing to install).' };
    if (!s.midi) return { tone: 'bad', text: 'Push 3 not found: plug it in and make sure Ableton Live is closed.' };
    if (!s.display) return { tone: 'bad', text: 'Push screen busy: quit Ableton Live (its background “Push3” process holds the display).' };
    return null;
  });

  return (
    <>
      <header class="top">
        <div class="brand"><span class="logo" />Push 3 Twin</div>
        <div class="status">
          <Show
            when={direct()}
            fallback={<Pill ok={e.status().link} label="Bridge" value={e.status().link ? 'connected' : 'offline'} />}
          >
            <Pill ok={e.status().link} label="Direct" value={e.status().link ? 'Web MIDI + WebUSB' : 'unsupported browser'} />
          </Show>
          <Pill ok={e.status().midi} label="MIDI" value={e.status().midi ? 'User Mode' : 'not connected'} />
          <Pill ok={e.status().display} label="Screen" value={e.status().display ? 'streaming' : 'not connected'} />
          <Show when={needsConnect()}>
            <button class="primary" onClick={() => e.connectDevice()}>Connect Push</button>
          </Show>
          <Show when={['localhost', '127.0.0.1'].includes(location.hostname)}>
            <a class="mode-link" href={otherMode()} title="Switch between the local Node bridge and talking to the Push directly from this page">
              {direct() ? 'Use local bridge' : 'Use direct mode'}
            </a>
          </Show>
        </div>
        <div class="tools">
          <div class="seg">
            <For each={VIEWS}>
              {([v, label]) => <button classList={{ active: view() === v }} onClick={() => { setView(v); e.twin.setView(v); }}>{label}</button>}
            </For>
          </div>
          <label class="toggle"><input type="checkbox" checked={glow()} onChange={(ev) => { setGlow(ev.currentTarget.checked); e.twin.setBloom(glow()); }} /> Glow</label>
          <button title="Re-send palette, modes and every LED to the Push" disabled={!e.status().midi} onClick={() => e.resync()}>Re-sync</button>
        </div>
      </header>

      <main>
        <section id="stage" aria-label="3D model of the Push 3">
          <div class="stage-canvas" ref={canvasHost} />
          <Show when={hint()}>{(h) => <div id="hint" class={h().tone}>{h().text}</div>}</Show>
          <div class="stage-help">Drag to orbit · scroll to zoom · click pads, buttons, knobs (drag up/down) and the touch strip to use them virtually</div>
        </section>

        <aside id="side">
          <nav id="tabs">
            <For each={e.demos}>
              {(d, i) => (
                <button
                  class="tab"
                  classList={{ active: e.demoIndex() === i() }}
                  style={{ '--c': css(d.color) }}
                  title={`${d.name} (or upper display button ${i() + 1} on the Push, keyboard ${i() + 1})`}
                  onClick={() => e.switchDemo(i())}
                >
                  <span class="num">{i() + 1}</span>{d.name}
                </button>
              )}
            </For>
          </nav>
          <div id="demo-panel" style={{ '--accent': css(e.demo.color) }}>
            <Dynamic component={e.demo.Panel} app={e} />
          </div>
          <EventLog engine={e} />
        </aside>
      </main>
    </>
  );
};

const Pill: Component<{ ok: boolean; label: string; value: string }> = (p) => (
  <span class="pill" classList={{ ok: p.ok }}>{p.label} <b>{p.value}</b></span>
);

const EventLog: Component<{ engine: Engine }> = (props) => {
  const e = props.engine;
  return (
    <section id="log">
      <header>
        <h3>Event log</h3>
        <span id="log-count">{e.sent().toLocaleString()} msgs sent</span>
        <label class="toggle small"><input type="checkbox" checked={e.logContinuous()} onChange={(ev) => e.setLogContinuous(ev.currentTarget.checked)} /> continuous</label>
        <button onClick={() => e.setLogPaused(!e.logPaused())}>{e.logPaused() ? 'Resume' : 'Pause'}</button>
        <button onClick={e.clearLog}>Clear</button>
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
