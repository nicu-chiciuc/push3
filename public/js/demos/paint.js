// Paint: the pad grid is an 8×8 canvas. Pick colors with knobs or swatches, paint with pads.
import { hsv, css, scale } from '../palette.js';
import { arcGauge, text } from '../screen.js';

const s = {
  cells: new Map(), // note → [r,g,b]
  brush: { h: 285, s: 1, v: 1 },
  pick: false,
  erase: false,
};
const brushRGB = () => hsv(s.brush.h, s.brush.s, s.brush.v);
const rgb2hsv = ([r, g, b]) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
};

let save = () => {};

const ACTIONS = {
  0: () => s.cells.clear(),
  1: () => { for (let n = 36; n <= 99; n++) s.cells.set(n, brushRGB()); },
  2: () => { for (let n = 36; n <= 99; n++) { const i = n - 36; s.cells.set(n, hsv(((i % 8) + Math.floor(i / 8)) * 22, 1, 1)); } },
  3: () => { for (let n = 36; n <= 99; n++) if (Math.random() < 0.35) s.cells.set(n, hsv(Math.random() * 360, 1, 1)); else s.cells.delete(n); },
  6: () => { s.pick = !s.pick; s.erase = false; },
  7: () => { s.erase = !s.erase; s.pick = false; },
};

export default {
  id: 'paint',
  name: 'Paint',
  color: [255, 92, 200],

  enter(app) {
    const saved = app.store.get('paint', null);
    if (saved) { s.cells = new Map(saved.cells); s.brush = saved.brush; }
    save = () => app.store.set('paint', { cells: [...s.cells], brush: s.brush });
    this.syncPanel?.();
  },

  onEvent(ev, app) {
    if (ev.type === 'encoder') {
      const k = app.held.has('shift') ? 0.25 : 1;
      if (ev.id === 'e1') s.brush.h = (s.brush.h + ev.delta * 1.5 * k + 360) % 360;
      if (ev.id === 'e2') s.brush.s = Math.max(0, Math.min(1, s.brush.s + (ev.delta / 210) * k));
      if (ev.id === 'e3') s.brush.v = Math.max(0.05, Math.min(1, s.brush.v + (ev.delta / 210) * k));
      this.syncPanel?.();
    }
    if (ev.type === 'pad' && ev.action === 'down') {
      if (s.pick || app.held.has('select')) {
        const c = s.cells.get(ev.note);
        if (c) { s.brush = rgb2hsv(c); s.pick = false; this.syncPanel?.(); }
      } else if (s.erase || app.held.has('shift')) s.cells.delete(ev.note);
      else s.cells.set(ev.note, brushRGB());
      save();
    }
    if (ev.type === 'button' && ev.pressed && /^lower\d$/.test(ev.id)) {
      ACTIONS[+ev.id.slice(5) - 1]?.();
      save();
    }
  },

  tick(t, dt, app) {
    for (let n = 36; n <= 99; n++) {
      const held = app.pads.get(n)?.down;
      app.leds.pad(n, held ? [255, 255, 255] : s.cells.get(n) ?? null);
    }
    const b = brushRGB();
    const lower = [[90, 90, 90], b, hsv(t * 60, 1, 1), [140, 140, 140], null, null, s.pick ? b : scale(b, 0.2), s.erase ? [255, 40, 40] : [60, 10, 10]];
    lower.forEach((c, i) => app.leds.button(20 + i, c));
  },

  draw(g, app) {
    const b = brushRGB();
    const knobs = [['Hue', s.brush.h / 360, `${Math.round(s.brush.h)}°`], ['Saturation', s.brush.s, `${Math.round(s.brush.s * 100)}%`], ['Brightness', s.brush.v, `${Math.round(s.brush.v * 100)}%`]];
    knobs.forEach(([label, v, str], i) => {
      const cx = i * 120 + 60;
      text(g, label, cx, 12, { size: 12, color: app.touched.has(`e${i + 1}`) ? css(b) : '#8b96a3' });
      arcGauge(g, cx, 62, 30, v, css(b), { width: 6 });
      text(g, str, cx, 64, { size: 16, weight: 700 });
    });
    // brush swatch
    g.fillStyle = css(b);
    g.beginPath();
    g.roundRect(380, 14, 200, 70, 12);
    g.fill();
    const hex = '#' + b.map((v) => v.toString(16).padStart(2, '0')).join('');
    text(g, hex.toUpperCase(), 480, 100, { size: 14, weight: 700 });
    text(g, s.erase ? 'ERASER' : s.pick ? 'EYEDROPPER — tap a pad' : 'BRUSH', 480, 49, { size: 13, weight: 800, color: s.brush.v > 0.5 ? '#000' : '#fff' });
    // canvas preview
    const cell = 12, x0 = 720, y0 = 10;
    for (let n = 36; n <= 99; n++) {
      const i = n - 36, col = i % 8, row = 7 - Math.floor(i / 8);
      g.fillStyle = s.cells.has(n) ? css(s.cells.get(n)) : '#15181e';
      g.fillRect(x0 + col * (cell + 1), y0 + row * (cell + 1), cell, cell);
    }
    text(g, `${s.cells.size} / 64 painted`, 860, 70, { size: 12, color: '#8b96a3', align: 'left' });
  },

  footer: () => ['Clear', 'Fill', 'Rainbow', 'Random', '', '', 'Pick', 'Erase'],
  footerActive: (i) => (i === 6 && s.pick) || (i === 7 && s.erase),

  panel(el) {
    const swatches = Array.from({ length: 24 }, (_, i) => hsv(i * 15, 1, 1)).concat([[255, 255, 255], [128, 128, 128]]);
    el.innerHTML = `
      <h2>Paint</h2>
      <p>The 64 pads are a canvas. Pick a color, then press pads to paint. Your painting is saved in this browser.</p>
      <ul class="tips">
        <li><b>Knobs 1–3:</b> hue, saturation, brightness of the brush.</li>
        <li><kbd>Shift</kbd> + pad erases · <kbd>Select</kbd> + pad picks that pad's color.</li>
        <li><b>Lower display buttons:</b> Clear, Fill, Rainbow, Random … Pick, Erase.</li>
        <li>You can also click pads on the 3D model.</li>
      </ul>
      <div class="card-box"><div class="swatches" id="p-sw"></div></div>
      <div class="row"><label>Exact color <input type="color" id="p-color" /></label></div>`;
    const sw = el.querySelector('#p-sw');
    for (const c of swatches) {
      const btn = document.createElement('button');
      btn.style.background = css(c);
      btn.onclick = () => { s.brush = rgb2hsv(c); s.pick = s.erase = false; sync(); };
      sw.append(btn);
    }
    const input = el.querySelector('#p-color');
    input.oninput = () => {
      const v = input.value;
      s.brush = rgb2hsv([1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)));
    };
    const sync = () => { input.value = '#' + brushRGB().map((v) => v.toString(16).padStart(2, '0')).join(''); };
    this.syncPanel = sync;
    sync();
  },

  exit() { this.syncPanel = null; },
};
