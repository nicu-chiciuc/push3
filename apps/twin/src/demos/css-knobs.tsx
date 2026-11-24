// CSS Knobs: eight knobs drive eight CSS custom properties on a live component; the Push
// screen labels each knob like a Live device. All values are Solid store state, so the
// panel re-renders exactly what changed.
import { createStore } from 'solid-js/store';
import { createMemo, createSignal, For } from 'solid-js';
import { css, hsv } from '@push3/protocol';
import { text } from '../engine/screen.ts';
import { store, type Demo } from '../engine/engine.ts';

interface Prop { readonly v: string; readonly label: string; readonly unit: string; readonly min: number; readonly max: number; readonly step: number; readonly digits: number; readonly wrap?: boolean }
const PROPS: ReadonlyArray<Prop> = [
  { v: '--card-w', label: 'Width', unit: 'px', min: 180, max: 380, step: 1, digits: 0 },
  { v: '--pad', label: 'Padding', unit: 'px', min: 0, max: 48, step: 0.25, digits: 0 },
  { v: '--radius', label: 'Radius', unit: 'px', min: 0, max: 40, step: 0.2, digits: 0 },
  { v: '--hue', label: 'Hue', unit: '', min: 0, max: 360, step: 1, digits: 0, wrap: true },
  { v: '--sat', label: 'Saturation', unit: '%', min: 0, max: 100, step: 0.5, digits: 0 },
  { v: '--font', label: 'Font size', unit: 'px', min: 11, max: 26, step: 0.1, digits: 1 },
  { v: '--track', label: 'Tracking', unit: 'em', min: -0.05, max: 0.25, step: 0.002, digits: 3 },
  { v: '--shadow', label: 'Shadow', unit: 'px', min: 0, max: 60, step: 0.25, digits: 0 },
];
const DEFAULTS = [300, 20, 14, 265, 70, 15, 0, 18];
const saved = store.get<{ vals?: Array<number>; presets?: Array<Array<number> | null> } | null>('css', null);
const [st, setSt] = createStore({ vals: saved?.vals ?? [...DEFAULTS], presets: saved?.presets ?? new Array<Array<number> | null>(8).fill(null), fine: false });
const [focus, setFocus] = createSignal<ReadonlyArray<boolean>>(new Array(8).fill(false));

const fmt = (i: number) => `${st.vals[i]!.toFixed(PROPS[i]!.digits)}${PROPS[i]!.unit}`;
const save = () => store.set('css', { vals: st.vals, presets: st.presets });
const setVal = (i: number, v: number) => {
  const p = PROPS[i]!;
  setSt('vals', i, p.wrap ? ((v % p.max) + p.max) % p.max : Math.max(p.min, Math.min(p.max, v)));
};

export const cssKnobs: Demo = {
  id: 'css',
  name: 'CSS Knobs',
  color: [120, 130, 255],

  onEvent(ev, app) {
    if (ev.type === 'encoder' && /^e\d$/.test(ev.id)) {
      const i = +ev.id.slice(1) - 1;
      const k = st.fine || app.held.has('shift') ? 0.2 : 1;
      setVal(i, st.vals[i]! + ev.delta * PROPS[i]!.step * k);
      save();
    }
    if (ev.type === 'touch') setFocus(PROPS.map((_, i) => app.touched.has(`e${i + 1}`)));
    if (ev.type === 'pad' && ev.action === 'down') {
      if (ev.rowFromTop === 0) {
        const slot = ev.col, preset = st.presets[slot];
        if (app.held.has('shift') || !preset) setSt('presets', slot, [...st.vals]);
        else setSt('vals', [...preset]);
      } else if (ev.rowFromTop === 1) setVal(3, ev.col * 45);
      save();
    }
    if (ev.type === 'button' && ev.pressed) {
      if (ev.id === 'lower1') { setSt('vals', [...DEFAULTS]); save(); }
      if (ev.id === 'lower8') setSt('fine', !st.fine);
    }
  },

  tick(_t, _dt, app) {
    for (let n = 36; n <= 99; n++) {
      const i = n - 36, row = 7 - Math.floor(i / 8), col = i % 8, preset = st.presets[col];
      let c = row === 0 ? (preset ? hsv(preset[3]!, preset[4]! / 100, 1) : ([30, 30, 30] as const)) : row === 1 ? hsv(col * 45, 1, st.vals[3] === col * 45 ? 1 : 0.25) : null;
      if (app.pads.get(n)?.down) c = [255, 255, 255];
      app.leds.pad(n, c);
    }
    app.leds.button(20, [70, 70, 70]);
    for (let i = 21; i < 27; i++) app.leds.button(i, null);
    app.leds.button(27, st.fine ? this.color : [20, 22, 50]);
  },

  draw(g, app) {
    const c = hsv(st.vals[3]!, st.vals[4]! / 100, 1);
    PROPS.forEach((p, i) => {
      const x = i * 120, cx = x + 60, touched = app.touched.has(`e${i + 1}`);
      if (touched) { g.fillStyle = css(c, 0.18); g.fillRect(x + 4, 0, 112, 116); }
      text(g, p.label, cx, 14, { size: 12, color: touched ? css(c) : '#8b96a3' });
      text(g, p.v, cx, 32, { size: 10, color: '#5d6773', font: '"SF Mono", Menlo, monospace' });
      text(g, fmt(i), cx, 62, { size: p.unit === 'em' ? 17 : 20, weight: 700 });
      g.fillStyle = '#1d222b';
      g.fillRect(x + 16, 92, 88, 5);
      g.fillStyle = i === 3 ? css(hsv(st.vals[3]!, 1, 1)) : css(c);
      g.fillRect(x + 16, 92, (88 * (st.vals[i]! - p.min)) / (p.max - p.min), 5);
    });
  },

  footer: () => ['Reset', '', '', '', '', '', '', st.fine ? 'Fine ✓' : 'Fine'],
  footerActive: (i) => i === 7 && st.fine,

  Panel: () => {
    const style = createMemo(() => Object.fromEntries(PROPS.map((p, i) => [p.v, fmt(i)])));
    const code = createMemo(() => `.card {\n${PROPS.map((p, i) => `  ${p.v}: ${fmt(i)};`).join('\n')}\n}`);
    const [copied, setCopied] = createSignal('Copy');
    const copy = async () => {
      try { await navigator.clipboard.writeText(code()); setCopied('Copied ✓'); } catch { setCopied('Select & copy manually'); }
      setTimeout(() => setCopied('Copy'), 1500);
    };
    return (
      <>
        <h2>CSS Knobs</h2>
        <p>Your original idea: the 8 knobs drive 8 CSS custom properties on this card, live. Touch a knob to see which property it controls.</p>
        <div class="css-stage" style={style()}>
          <div class="demo-card" classList={{ focus: focus().some(Boolean) }}>
            <h4>Tune me with hardware</h4>
            <p>Every value here is a CSS variable. The Push turns knobs, the browser re-renders. No reloads.</p>
            <button>Primary action</button>
          </div>
        </div>
        <div class="props">
          <For each={PROPS}>
            {(p, i) => (
              <>
                <span class="k">{i() + 1}</span>
                <span classList={{ on: focus()[i()] }}>{p.label} <code class="k">{p.v}</code></span>
                <span class="v">{fmt(i())}</span>
              </>
            )}
          </For>
        </div>
        <ul class="tips">
          <li><b>Top pad row:</b> 8 preset slots (tap empty = save, tap = recall, <kbd>Shift</kbd>+tap = overwrite).</li>
          <li><b>Second row:</b> quick hues. <b>Lower button 1</b> resets, <b>8</b> toggles fine mode (or hold <kbd>Shift</kbd>).</li>
        </ul>
        <div class="row row-between"><b class="section-label">Generated CSS</b><button type="button" onClick={copy}>{copied()}</button></div>
        <pre class="code">{code()}</pre>
      </>
    );
  },
};
