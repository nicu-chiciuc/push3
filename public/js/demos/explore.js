// Explore: everything you do on the Push lights up and shows on its screen.
import { hsv, scale } from '../palette.js';
import { arcGauge, text } from '../screen.js';
import { describe } from '../protocol.js';
import { BUTTON_BY_CC } from '../layout.js';

const s = {
  values: new Array(8).fill(0.5),
  volume: 0.7,
  tempo: 120,
  jog: 0,
  last: 'Press a pad, turn a knob, touch the strip…',
  glow: new Map(), // note → { color, level }
};

export default {
  id: 'explore',
  name: 'Explore',
  color: [70, 215, 255],

  onEvent(ev, app) {
    if (!(ev.type === 'pad' && ev.action !== 'down' && ev.action !== 'up') && ev.type !== 'strip') s.last = describe(ev);
    if (ev.type === 'encoder') {
      const fine = app.held.has('shift') ? 0.2 : 1;
      if (/^e\d$/.test(ev.id)) {
        const i = +ev.id.slice(1) - 1;
        s.values[i] = Math.max(0, Math.min(1, s.values[i] + (ev.delta / 210) * fine));
      } else if (ev.id === 'volume') s.volume = Math.max(0, Math.min(1, s.volume + ev.delta / 210));
      else if (ev.id === 'tempo') s.tempo = Math.max(20, Math.min(300, s.tempo + ev.delta));
      else if (ev.id === 'jog') s.jog += ev.delta;
    }
    if (ev.type === 'button' && !/^upper/.test(ev.id)) {
      const b = BUTTON_BY_CC.get(ev.cc);
      if (b) app.leds.button(ev.cc, ev.pressed ? (b.rgb ? this.color : [255, 255, 255]) : null);
    }
  },

  tick(t, dt, app) {
    for (let note = 36; note <= 99; note++) {
      const p = app.pads.get(note);
      let g = s.glow.get(note);
      if (p?.down) {
        // soft hits are blue, hard hits red; pressure drives brightness
        const color = hsv(215 - (p.velocity / 127) * 215, 1, 1);
        g = { color, level: 0.25 + 0.75 * Math.max(p.pressure, 0.3) };
        s.glow.set(note, g);
      } else if (g) {
        g.level *= Math.exp(-dt * 2.5);
        if (g.level < 0.04) { s.glow.delete(note); g = null; }
      }
      app.leds.pad(note, g ? scale(g.color, g.level) : null);
    }
    // lower row mirrors the knob values as brightness
    s.values.forEach((v, i) => app.leds.button(20 + i, app.held.has(`lower${i + 1}`) ? [255, 255, 255] : scale(this.color, 0.1 + v * 0.9)));
  },

  draw(g, app) {
    for (let i = 0; i < 8; i++) {
      const cx = i * 120 + 60;
      const touched = app.touched.has(`e${i + 1}`);
      if (touched) { g.fillStyle = '#0f2a33'; g.fillRect(i * 120 + 4, 0, 112, 116); }
      text(g, `Knob ${i + 1}`, cx, 12, { size: 12, color: touched ? '#46e0ff' : '#8b96a3' });
      arcGauge(g, cx, 62, 30, s.values[i], touched ? '#7febff' : '#2bb5d8', { width: 6 });
      text(g, `${Math.round(s.values[i] * 100)}`, cx, 64, { size: 20, weight: 700 });
      text(g, touched ? 'touched' : '', cx, 104, { size: 11, color: '#46e0ff' });
    }
  },

  footer: () => `${s.last}   ·   Volume ${Math.round(s.volume * 100)}%   ·   Tempo ${s.tempo}   ·   Jog ${s.jog}`,

  panel(el) {
    el.innerHTML = `
      <h2>Explore</h2>
      <p>Everything you do on the Push shows up here, in the 3D model, and on the Push's own screen, which this page draws.</p>
      <ul class="tips">
        <li><b>Pads:</b> soft hits glow blue, hard hits red. Press harder while holding to make it brighter (pressure).</li>
        <li><b>8 knobs:</b> turn to change the gauges; touch one to highlight it. Hold <kbd>Shift</kbd> for fine steps.</li>
        <li><b>Buttons</b> light while held. <b>Upper display buttons</b> switch tabs.</li>
        <li><b>Touch strip, jog wheel, volume & tempo knobs</b> report in the footer of the Push screen.</li>
      </ul>
      <p class="muted">No Push handy? Click the 3D model: pads, buttons, knobs (drag up/down) and the strip all work virtually.</p>`;
  },
};
