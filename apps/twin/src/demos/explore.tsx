// Explore: everything you do on the Push lights up and shows on its screen.
import { BUTTON_BY_CC } from '@push3/protocol';
import { hsv, scale } from '@push3/protocol';
import { describe } from '@push3/protocol';
import { arcGauge, text } from '../engine/screen.ts';
import type { Demo } from '../engine/engine.ts';
import type { RGB } from '@push3/protocol';

const s = {
  values: new Array<number>(8).fill(0.5),
  volume: 0.7,
  tempo: 120,
  jog: 0,
  last: 'Press a pad, turn a knob, touch the strip…',
  glow: new Map<number, { color: RGB; level: number }>(),
};
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export const explore: Demo = {
  id: 'explore',
  name: 'Explore',
  color: [70, 215, 255],

  onEvent(ev, app) {
    const continuous = (ev.type === 'pad' && ev.action !== 'down' && ev.action !== 'up') || ev.type === 'strip';
    if (!continuous) s.last = describe(ev);
    if (ev.type === 'encoder') {
      const fine = app.held.has('shift') ? 0.2 : 1;
      if (/^e\d$/.test(ev.id)) {
        const i = +ev.id.slice(1) - 1;
        s.values[i] = clamp01(s.values[i]! + (ev.delta / 210) * fine);
      } else if (ev.id === 'volume') s.volume = clamp01(s.volume + ev.delta / 210);
      else if (ev.id === 'tempo') s.tempo = Math.max(20, Math.min(300, s.tempo + ev.delta));
      else if (ev.id === 'jog') s.jog += ev.delta;
    }
    if (ev.type === 'button' && !/^upper/.test(ev.id)) {
      const b = BUTTON_BY_CC.get(ev.cc);
      if (b) app.leds.button(ev.cc, ev.pressed ? (b.rgb ? this.color : [255, 255, 255]) : null);
    }
  },

  tick(_t, dt, app) {
    for (let note = 36; note <= 99; note++) {
      const p = app.pads.get(note);
      let g = s.glow.get(note);
      if (p?.down) {
        // soft hits are blue, hard hits red; pressure drives brightness
        g = { color: hsv(215 - (p.velocity / 127) * 215, 1, 1), level: 0.25 + 0.75 * Math.max(p.pressure, 0.3) };
        s.glow.set(note, g);
      } else if (g) {
        g.level *= Math.exp(-dt * 2.5);
        if (g.level < 0.04) { s.glow.delete(note); g = undefined; }
      }
      app.leds.pad(note, g ? scale(g.color, g.level) : null);
    }
    // lower row mirrors the knob values as brightness
    s.values.forEach((v, i) => app.leds.button(20 + i, app.held.has(`lower${i + 1}`) ? [255, 255, 255] : scale(this.color, 0.1 + v * 0.9)));
  },

  draw(g, app) {
    for (let i = 0; i < 8; i++) {
      const cx = i * 120 + 60, touched = app.touched.has(`e${i + 1}`);
      if (touched) { g.fillStyle = '#0f2a33'; g.fillRect(i * 120 + 4, 0, 112, 116); }
      text(g, `Knob ${i + 1}`, cx, 12, { size: 12, color: touched ? '#46e0ff' : '#8b96a3' });
      arcGauge(g, cx, 62, 30, s.values[i]!, touched ? '#7febff' : '#2bb5d8', { width: 6 });
      text(g, `${Math.round(s.values[i]! * 100)}`, cx, 64, { size: 20, weight: 700 });
      if (touched) text(g, 'touched', cx, 104, { size: 11, color: '#46e0ff' });
    }
  },

  footer: () => `${s.last}   ·   Volume ${Math.round(s.volume * 100)}%   ·   Tempo ${s.tempo}   ·   Jog ${s.jog}`,

  Panel: () => (
    <>
      <h2>Explore</h2>
      <p>Every pad, knob, button, and touch strip mirrors between the 3D Push and live hardware—including the 960×160 screen.</p>
      <div class="guide-list">
        <div class="guide-item">
          <span class="guide-k">64 Pads</span>
          <span class="guide-v">Soft hits glow blue, hard hits red. Hold and press harder for aftertouch brightness.</span>
        </div>
        <div class="guide-item">
          <span class="guide-k">8 Knobs</span>
          <span class="guide-v">Drag up/down or turn to dial gauges. Hold <kbd>Shift</kbd> for fine steps.</span>
        </div>
        <div class="guide-item">
          <span class="guide-k">Display Row</span>
          <span class="guide-v">Upper display buttons switch modes; lower buttons mirror knob levels.</span>
        </div>
        <div class="guide-item">
          <span class="guide-k">Strip &amp; Jog</span>
          <span class="guide-v">Touch strip, jog wheel, volume, and tempo report live in the screen footer.</span>
        </div>
      </div>
    </>
  ),
};
