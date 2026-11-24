// Paint: the pad grid is an 8×8 canvas. Pick colors with knobs or swatches, paint with pads.
import { createStore } from 'solid-js/store';
import { For } from 'solid-js';
import { css, hsv, scale, toHex } from '@push3/protocol';
import { arcGauge, text } from '../engine/screen.ts';
import { store, type Demo } from '../engine/engine.ts';
import type { RGB } from '@push3/protocol';

interface Brush { h: number; s: number; v: number }
const saved = store.get<{ cells: Array<[number, RGB]>; brush: Brush } | null>('paint', null);
const cells = new Map<number, RGB>(saved?.cells ?? []);
const [ui, setUi] = createStore({ brush: saved?.brush ?? { h: 285, s: 1, v: 1 }, pick: false, erase: false });

const brushRGB = () => hsv(ui.brush.h, ui.brush.s, ui.brush.v);
const save = () => store.set('paint', { cells: [...cells], brush: ui.brush });
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
function rgb2hsv([r, g, b]: RGB): Brush {
  const R = r / 255, G = g / 255, B = b / 255, max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  let h = 0;
  if (d) h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

const ACTIONS: Record<number, () => void> = {
  0: () => cells.clear(),
  1: () => { for (let n = 36; n <= 99; n++) cells.set(n, brushRGB()); },
  2: () => { for (let n = 36; n <= 99; n++) { const i = n - 36; cells.set(n, hsv(((i % 8) + Math.floor(i / 8)) * 22, 1, 1)); } },
  3: () => { for (let n = 36; n <= 99; n++) Math.random() < 0.35 ? cells.set(n, hsv(Math.random() * 360, 1, 1)) : cells.delete(n); },
  6: () => setUi({ pick: !ui.pick, erase: false }),
  7: () => setUi({ erase: !ui.erase, pick: false }),
};

export const paint: Demo = {
  id: 'paint',
  name: 'Paint',
  color: [255, 92, 200],

  onEvent(ev, app) {
    if (ev.type === 'encoder') {
      const k = app.held.has('shift') ? 0.25 : 1;
      if (ev.id === 'e1') setUi('brush', 'h', (h) => (h + ev.delta * 1.5 * k + 360) % 360);
      if (ev.id === 'e2') setUi('brush', 's', (s) => clamp(s + (ev.delta / 210) * k, 0, 1));
      if (ev.id === 'e3') setUi('brush', 'v', (v) => clamp(v + (ev.delta / 210) * k, 0.05, 1));
    }
    if (ev.type === 'pad' && ev.action === 'down') {
      if (ui.pick || app.held.has('select')) {
        const c = cells.get(ev.note);
        if (c) setUi({ brush: rgb2hsv(c), pick: false });
      } else if (ui.erase || app.held.has('shift')) cells.delete(ev.note);
      else cells.set(ev.note, brushRGB());
      save();
    }
    if (ev.type === 'button' && ev.pressed && /^lower\d$/.test(ev.id)) {
      ACTIONS[+ev.id.slice(5) - 1]?.();
      save();
    }
  },

  tick(t, _dt, app) {
    for (let n = 36; n <= 99; n++) app.leds.pad(n, app.pads.get(n)?.down ? [255, 255, 255] : (cells.get(n) ?? null));
    const b = brushRGB();
    const lower: ReadonlyArray<RGB | null> = [[90, 90, 90], b, hsv(t * 60, 1, 1), [140, 140, 140], null, null, ui.pick ? b : scale(b, 0.2), ui.erase ? [255, 40, 40] : [60, 10, 10]];
    lower.forEach((c, i) => app.leds.button(20 + i, c));
  },

  draw(g, app) {
    const b = brushRGB();
    const knobs: ReadonlyArray<[string, number, string]> = [
      ['Hue', ui.brush.h / 360, `${Math.round(ui.brush.h)}°`],
      ['Saturation', ui.brush.s, `${Math.round(ui.brush.s * 100)}%`],
      ['Brightness', ui.brush.v, `${Math.round(ui.brush.v * 100)}%`],
    ];
    knobs.forEach(([label, v, str], i) => {
      const cx = i * 120 + 60;
      text(g, label, cx, 12, { size: 12, color: app.touched.has(`e${i + 1}`) ? css(b) : '#8b96a3' });
      arcGauge(g, cx, 62, 30, v, css(b), { width: 6 });
      text(g, str, cx, 64, { size: 16, weight: 700 });
    });
    g.fillStyle = css(b);
    g.beginPath();
    g.roundRect(380, 14, 200, 70, 12);
    g.fill();
    text(g, ui.erase ? 'ERASER' : ui.pick ? 'EYEDROPPER: tap a pad' : 'BRUSH', 480, 49, { size: 13, weight: 800, color: ui.brush.v > 0.5 ? '#000' : '#fff' });
    text(g, toHex(b).toUpperCase(), 480, 100, { size: 14, weight: 700 });
    const cell = 12, x0 = 720, y0 = 10;
    for (let n = 36; n <= 99; n++) {
      const i = n - 36, col = i % 8, row = 7 - Math.floor(i / 8);
      const c = cells.get(n);
      g.fillStyle = c ? css(c) : '#15181e';
      g.fillRect(x0 + col * (cell + 1), y0 + row * (cell + 1), cell, cell);
    }
    text(g, `${cells.size} / 64 painted`, 860, 70, { size: 12, color: '#8b96a3', align: 'left' });
  },

  footer: () => ['Clear', 'Fill', 'Rainbow', 'Random', '', '', 'Pick', 'Erase'],
  footerActive: (i) => (i === 6 && ui.pick) || (i === 7 && ui.erase),

  Panel: () => {
    const swatches: ReadonlyArray<RGB> = [...Array.from({ length: 24 }, (_, i) => hsv(i * 15, 1, 1)), [255, 255, 255], [128, 128, 128]];
    const pickColor = (c: RGB) => { setUi({ brush: rgb2hsv(c), pick: false, erase: false }); save(); };
    return (
      <>
        <h2>Paint</h2>
        <p>The 64 pads are a canvas. Pick a color, then press pads to paint. Your painting is saved in this browser.</p>
        <ul class="tips">
          <li><b>Knobs 1–3:</b> hue, saturation, brightness of the brush.</li>
          <li><kbd>Shift</kbd> + pad erases · <kbd>Select</kbd> + pad picks that pad's color.</li>
          <li><b>Lower display buttons:</b> Clear, Fill, Rainbow, Random … Pick, Erase.</li>
          <li>You can also click pads on the 3D model.</li>
        </ul>
        <div class="card-box">
          <div class="swatches">
            <For each={swatches}>{(c) => <button style={{ background: css(c) }} aria-label={toHex(c)} onClick={() => pickColor(c)} />}</For>
          </div>
        </div>
        <div class="row">
          <label class="color-field">Exact color <input type="color" value={toHex(brushRGB())} onInput={(e) => {
            const v = e.currentTarget.value;
            pickColor([1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)) as unknown as RGB);
          }} /></label>
          <span class="swatch-big" style={{ background: css(brushRGB()) }} />
        </div>
      </>
    );
  },
};
