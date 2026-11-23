// Test: a coverage checklist. Every control you exercise turns green, on the hardware
// and in 3D, so you can verify the whole device (and our MIDI map) works.
import { hsv } from '../palette.js';
import { text, FONT } from '../screen.js';
import { BUTTONS, ENCODERS } from '../layout.js';

const PADS = Array.from({ length: 64 }, (_, i) => 36 + i);
const s = { sweep: false, sweepBase: 1, sweepAt: 0, screenTest: false, allOn: 0 };

function counts(app) {
  const has = (k) => app.seen.has(k);
  return [
    { label: 'Pads', n: PADS.filter((n) => has(`pad${n}`)).length, of: 64 },
    { label: 'Buttons', n: BUTTONS.filter((b) => has(`btn${b.cc}`)).length, of: BUTTONS.length },
    { label: 'Knob turns', n: ENCODERS.filter((e) => has(`enc:${e.id}`)).length, of: ENCODERS.length },
    { label: 'Knob touch', n: ENCODERS.filter((e) => has(`touch:${e.id}`)).length, of: ENCODERS.length },
    { label: 'Strip', n: (has('touch:strip') ? 1 : 0) + (has('strip') ? 1 : 0), of: 2 },
    { label: 'Pressure / slide', n: ['expr:pressure', 'expr:bend', 'expr:slide'].filter(has).length, of: 3 },
  ];
}

export default {
  id: 'test',
  name: 'Test',
  color: [61, 220, 132],
  captureUpper: true, // upper-row presses count as tests; Shift + upper switches tabs

  tick(t, dt, app) {
    const now = performance.now();
    if (s.allOn && now > s.allOn) s.allOn = 0;
    if (s.sweep && now - s.sweepAt > 90) { s.sweepAt = now; s.sweepBase = (s.sweepBase % 127) + 1; }
    for (const note of PADS) {
      if (s.allOn) app.leds.pad(note, 127);
      else if (s.sweep) app.leds.pad(note, ((s.sweepBase + note - 36 - 1) % 127) + 1); // raw palette index
      else app.leds.pad(note, app.pads.get(note)?.down ? [255, 255, 255] : app.seen.has(`pad${note}`) ? [0, 200, 70] : hsv(22, 1, 0.22));
    }
    for (const b of BUTTONS) {
      if (/^upper/.test(b.id) && !app.held.has(b.id) && !app.seen.has(`btn${b.cc}`)) continue; // keep tab colors until tested
      const seen = app.seen.has(`btn${b.cc}`), held = app.held.has(b.id);
      let c = held ? [255, 255, 255] : seen ? (b.rgb ? [0, 200, 70] : [255, 255, 255]) : b.rgb ? hsv(22, 1, 0.22) : [40, 40, 40];
      if (s.allOn) c = [255, 255, 255];
      app.leds.button(b.cc, c);
    }
    for (const e of ENCODERS) {
      const turned = app.seen.has(`enc:${e.id}`), touched = app.seen.has(`touch:${e.id}`);
      app.twin.markEncoder(e.id, turned && touched ? 0x3ddc84 : turned || touched ? 0xffd166 : 0xff8a3d);
    }
    app.leds.setStrip(Array.from({ length: 31 }, (_, i) => (s.allOn ? 7 : app.touched.has('strip') && Math.abs(i - app.strip * 30) < 1.5 ? 7 : 1)));
  },

  enter(app) { app.setStripHost(true); },

  draw(g, app) {
    if (s.screenTest) return drawTestPattern(g);
    const rows = counts(app);
    rows.forEach((r, i) => {
      const y = 12 + i * 18.5;
      text(g, r.label, 12, y, { align: 'left', size: 12, color: '#9aa4b0' });
      g.fillStyle = '#1a1f27';
      g.fillRect(130, y - 5, 360, 10);
      g.fillStyle = r.n === r.of ? '#3ddc84' : '#ffb347';
      g.fillRect(130, y - 5, (360 * r.n) / r.of, 10);
      text(g, `${r.n} / ${r.of}`, 500, y, { align: 'left', size: 12 });
    });
    const unknown = [...app.unmapped.keys()];
    text(g, 'Unmapped messages', 600, 12, { align: 'left', size: 12, color: '#9aa4b0' });
    text(g, unknown.length ? unknown.map((cc) => `CC ${cc}`).join('  ') : 'none yet — good', 600, 32, { align: 'left', size: 13, color: unknown.length ? '#ff9f7a' : '#3ddc84' });
    const total = rows.reduce((a, r) => a + r.n, 0), of = rows.reduce((a, r) => a + r.of, 0);
    text(g, `${Math.round((100 * total) / of)}%`, 600, 80, { align: 'left', size: 40, weight: 800, color: total === of ? '#3ddc84' : '#e8edf2' });
    text(g, 'of the device tested', 700, 86, { align: 'left', size: 12, color: '#9aa4b0' });
  },

  footer: () => (s.sweep ? `Palette sweep: entries ${s.sweepBase}–${((s.sweepBase + 62) % 127) + 1}` : 'Green = tested · orange = not yet · Shift + upper button switches tabs'),

  panel(el, app) {
    el.innerHTML = `
      <h2>Test every control</h2>
      <p>Press every pad and button, turn and touch every knob, and slide on the touch strip. Each control turns <b style="color:#3ddc84">green</b> once the page receives its message.</p>
      <div class="row">
        <button data-a="sweep">Palette sweep</button>
        <button data-a="all">All LEDs on (3 s)</button>
        <button data-a="screen">Screen test pattern</button>
        <button data-a="reset">Reset</button>
      </div>
      <div class="card-box"><div class="stat-grid" id="t-stats"></div></div>
      <p class="muted">If a button lights up the wrong spot in 3D, or shows under “Unmapped”, its MIDI number differs from our map. Tell Claude which button and the CC shown in the log, and it can fix <code>layout.js</code>.</p>`;
    el.querySelector('[data-a="sweep"]').onclick = (e) => { s.sweep = !s.sweep; e.target.classList.toggle('active', s.sweep); };
    el.querySelector('[data-a="all"]').onclick = () => { s.allOn = performance.now() + 3000; };
    el.querySelector('[data-a="screen"]').onclick = (e) => { s.screenTest = !s.screenTest; e.target.classList.toggle('active', s.screenTest); };
    el.querySelector('[data-a="reset"]').onclick = () => { app.seen.clear(); app.unmapped.clear(); };
    const stats = el.querySelector('#t-stats');
    const refresh = () => {
      if (!stats.isConnected) return;
      stats.innerHTML = counts(app).map((r) => `<span>${r.label}</span><span class="v">${r.n}/${r.of}</span><div class="bar"><i style="width:${(100 * r.n) / r.of}%;background:${r.n === r.of ? '#3ddc84' : '#ffb347'}"></i></div>`).join('');
      setTimeout(refresh, 250);
    };
    refresh();
  },

  exit() { s.sweep = false; s.screenTest = false; s.allOn = 0; },
};

function drawTestPattern(g) {
  const bars = [[255, 255, 255], [255, 255, 0], [0, 255, 255], [0, 255, 0], [255, 0, 255], [255, 0, 0], [0, 0, 255], [0, 0, 0]];
  bars.forEach((c, i) => { g.fillStyle = `rgb(${c})`; g.fillRect(i * 120, 0, 120, 60); });
  const grad = g.createLinearGradient(0, 0, 960, 0);
  grad.addColorStop(0, '#000');
  grad.addColorStop(1, '#fff');
  g.fillStyle = grad;
  g.fillRect(0, 60, 960, 24);
  for (let i = 0; i < 32; i++) { g.fillStyle = i % 2 ? '#fff' : '#000'; g.fillRect(i * 30, 84, 30, 32); }
  g.font = `800 22px ${FONT}`;
  g.fillStyle = '#ff2d55';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('960 × 160 · RGB565', 480, 100);
}
