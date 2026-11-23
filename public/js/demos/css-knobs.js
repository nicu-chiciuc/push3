// CSS Knobs: the original idea. Eight knobs drive eight CSS custom properties on a
// live component; the Push screen labels each knob like a Live device.
import { hsv, css } from '../palette.js';
import { text } from '../screen.js';

const PROPS = [
  { v: '--card-w', label: 'Width', unit: 'px', min: 180, max: 380, step: 1, val: 300, d: 0 },
  { v: '--pad', label: 'Padding', unit: 'px', min: 0, max: 48, step: 0.25, val: 20, d: 0 },
  { v: '--radius', label: 'Radius', unit: 'px', min: 0, max: 40, step: 0.2, val: 14, d: 0 },
  { v: '--hue', label: 'Hue', unit: '', min: 0, max: 360, step: 1, val: 265, d: 0, wrap: true },
  { v: '--sat', label: 'Saturation', unit: '%', min: 0, max: 100, step: 0.5, val: 70, d: 0 },
  { v: '--font', label: 'Font size', unit: 'px', min: 11, max: 26, step: 0.1, val: 15, d: 1 },
  { v: '--track', label: 'Tracking', unit: 'em', min: -0.05, max: 0.25, step: 0.002, val: 0, d: 3 },
  { v: '--shadow', label: 'Shadow', unit: 'px', min: 0, max: 60, step: 0.25, val: 18, d: 0 },
];
const DEFAULTS = PROPS.map((p) => p.val);
const s = { fine: false, presets: new Array(8).fill(null), el: null, codeEl: null, rows: [] };
const fmt = (p) => `${p.val.toFixed(p.d)}${p.unit}`;
const color = () => hsv(PROPS[3].val, PROPS[4].val / 100, 1);

let store = null;

function apply() {
  if (!s.el) return;
  for (const p of PROPS) s.el.style.setProperty(p.v, fmt(p));
  s.codeEl.textContent = `.card {\n${PROPS.map((p) => `  ${p.v}: ${fmt(p)};`).join('\n')}\n}`;
  s.rows.forEach((r, i) => (r.textContent = fmt(PROPS[i])));
}

export default {
  id: 'css',
  name: 'CSS Knobs',
  color: [120, 130, 255],

  enter(app) {
    store = app.store;
    const saved = store.get('css', null);
    if (saved) { saved.vals?.forEach((v, i) => (PROPS[i].val = v)); s.presets = saved.presets ?? s.presets; }
    apply();
  },
  save() { store?.set('css', { vals: PROPS.map((p) => p.val), presets: s.presets }); },

  onEvent(ev, app) {
    if (ev.type === 'encoder' && /^e\d$/.test(ev.id)) {
      const p = PROPS[+ev.id.slice(1) - 1];
      const k = s.fine || app.held.has('shift') ? 0.2 : 1;
      let v = p.val + ev.delta * p.step * k;
      v = p.wrap ? ((v % p.max) + p.max) % p.max : Math.max(p.min, Math.min(p.max, v));
      p.val = v;
      apply();
      this.save();
    }
    if (ev.type === 'touch' && /^e\d$/.test(ev.id)) this.highlight(app);
    if (ev.type === 'pad' && ev.action === 'down') {
      if (ev.rowFromTop === 0) {
        const slot = ev.col;
        if (app.held.has('shift') || !s.presets[slot]) s.presets[slot] = PROPS.map((p) => p.val);
        else s.presets[slot].forEach((v, i) => (PROPS[i].val = v));
      } else if (ev.rowFromTop === 1) {
        PROPS[3].val = ev.col * 45;
      }
      apply();
      this.save();
    }
    if (ev.type === 'button' && ev.pressed) {
      if (ev.id === 'lower1') { PROPS.forEach((p, i) => (p.val = DEFAULTS[i])); apply(); this.save(); }
      if (ev.id === 'lower8') s.fine = !s.fine;
    }
  },

  highlight(app) {
    const touched = PROPS.map((_, i) => app.touched.has(`e${i + 1}`));
    s.rows.forEach((r, i) => r.parentElement && r.previousElementSibling.classList.toggle('on', touched[i]));
    s.el?.classList.toggle('focus', touched.some(Boolean));
  },

  tick(t, dt, app) {
    for (let n = 36; n <= 99; n++) {
      const i = n - 36, row = 7 - Math.floor(i / 8), col = i % 8;
      let c = null;
      if (row === 0) c = s.presets[col] ? hsv(s.presets[col][3], s.presets[col][4] / 100, 1) : [30, 30, 30];
      else if (row === 1) c = hsv(col * 45, 1, PROPS[3].val === col * 45 ? 1 : 0.25);
      if (app.pads.get(n)?.down) c = [255, 255, 255];
      app.leds.pad(n, c);
    }
    app.leds.button(20, [70, 70, 70]);
    app.leds.button(27, s.fine ? this.color : [20, 22, 50]);
    for (let i = 21; i < 27; i++) app.leds.button(i, null);
  },

  draw(g, app) {
    const c = color();
    PROPS.forEach((p, i) => {
      const x = i * 120, cx = x + 60, touched = app.touched.has(`e${i + 1}`);
      if (touched) { g.fillStyle = css(c, 0.18); g.fillRect(x + 4, 0, 112, 116); }
      text(g, p.label, cx, 14, { size: 12, color: touched ? css(c) : '#8b96a3' });
      text(g, p.v, cx, 32, { size: 10, color: '#5d6773', font: '"SF Mono", Menlo, monospace' });
      text(g, fmt(p), cx, 62, { size: p.unit === 'em' ? 17 : 20, weight: 700 });
      const k = (p.val - p.min) / (p.max - p.min);
      g.fillStyle = '#1d222b';
      g.fillRect(x + 16, 92, 88, 5);
      g.fillStyle = i === 3 ? css(hsv(p.val, 1, 1)) : css(c);
      g.fillRect(x + 16, 92, 88 * k, 5);
    });
  },

  footer: () => ['Reset', '', '', '', '', '', '', s.fine ? 'Fine ✓' : 'Fine'],
  footerActive: (i) => i === 7 && s.fine,

  panel(el, app) {
    el.innerHTML = `
      <h2>CSS Knobs</h2>
      <p>Your original idea: the 8 knobs drive 8 CSS custom properties on this card, live. Touch a knob to see which property it controls.</p>
      <div class="css-stage"><div class="demo-card" id="c-card">
        <h4>Tune me with hardware</h4>
        <p>Every value here is a CSS variable. The Push turns knobs, the browser re-renders. No reloads.</p>
        <button>Primary action</button>
      </div></div>
      <div class="props" id="c-props"></div>
      <ul class="tips">
        <li><b>Top pad row:</b> 8 preset slots (tap empty = save, tap = recall, <kbd>Shift</kbd>+tap = overwrite).</li>
        <li><b>Second row:</b> quick hues. <b>Lower button 1</b> resets, <b>8</b> toggles fine mode (or hold <kbd>Shift</kbd>).</li>
      </ul>
      <div class="row"><b style="font-size:13px">Generated CSS</b><button id="c-copy">Copy</button></div>
      <pre class="code" id="c-code"></pre>`;
    s.el = el.querySelector('#c-card');
    s.codeEl = el.querySelector('#c-code');
    const props = el.querySelector('#c-props');
    s.rows = PROPS.map((p, i) => {
      const k = document.createElement('span'); k.className = 'k'; k.textContent = `${i + 1}`;
      const name = document.createElement('span'); name.textContent = `${p.label}  `;
      const code = document.createElement('code'); code.className = 'k'; code.textContent = p.v; name.append(code);
      const v = document.createElement('span'); v.className = 'v';
      props.append(k, name, v);
      return v;
    });
    // keep the "on" class on the label column (previous sibling of the value)
    s.rows.forEach((v) => (v.previousElementSibling.dataset.role = 'name'));
    el.querySelector('#c-copy').onclick = async (e) => {
      try { await navigator.clipboard.writeText(s.codeEl.textContent); e.target.textContent = 'Copied ✓'; } catch { e.target.textContent = 'Select & copy manually'; }
      setTimeout(() => (e.target.textContent = 'Copy'), 1500);
    };
    apply();
  },

  exit() { s.el = null; s.rows = []; },
};
