import { createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { css } from '../engine/palette.ts';
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

  const hint = createMemo(() => {
    const s = e.status();
    if (!s.bridge) return 'Bridge offline — run `npm run dev` (or `npm start`) in the push3-twin folder.';
    if (!s.midi) return 'Push 3 not found — plug it in and make sure Ableton Live is closed.';
    if (!s.display) return 'Push screen busy — quit Ableton Live (its background “Push3” process holds the display).';
    return '';
  });

  return (
    <>
      <header class="top">
        <div class="brand"><span class="logo" />Push 3 Twin</div>
        <div class="status">
          <Pill ok={e.status().bridge} label="Bridge" value={e.status().bridge ? 'connected' : 'offline'} />
          <Pill ok={e.status().midi} label="MIDI" value={e.status().midi ? 'User Mode' : 'not found'} />
          <Pill ok={e.status().display} label="Screen" value={e.status().display ? 'streaming' : 'not claimed'} />
        </div>
        <div class="tools">
          <div class="seg">
            <For each={VIEWS}>
              {([v, label]) => <button classList={{ active: view() === v }} onClick={() => { setView(v); e.twin.setView(v); }}>{label}</button>}
            </For>
          </div>
          <label class="toggle"><input type="checkbox" checked={glow()} onChange={(ev) => { setGlow(ev.currentTarget.checked); e.twin.setBloom(glow()); }} /> Glow</label>
          <button title="Re-send palette, modes and every LED to the Push" onClick={() => e.resync()}>Re-sync</button>
        </div>
      </header>

      <main>
        <section id="stage" aria-label="3D model of the Push 3">
          <div class="stage-canvas" ref={canvasHost} />
          <Show when={hint()}><div id="hint">{hint()}</div></Show>
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
                  title={`${d.name} — or upper display button ${i() + 1} on the Push (keyboard: ${i() + 1})`}
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
