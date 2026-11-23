// Ripple: a light show. Pads send color ripples across the grid; the scene column and
// touch strip act as level meters. Also shows the Push's built-in LED animations.
import { hsv, css } from '../palette.js';
import { text } from '../screen.js';
import { ANIM } from '../leds.js';

const s = { ripples: [], speed: 1, hue: 0, width: 1, idle: 0.3, mode: 'soft', energy: 0, history: new Array(240).fill(0) };

function add(acc, [r, g, b], k) { acc[0] += r * k; acc[1] += g * k; acc[2] += b * k; }

export default {
  id: 'ripple',
  name: 'Ripple',
  color: [150, 255, 60],

  enter(app) { app.setStripHost(true); },

  onEvent(ev, app) {
    if (ev.type === 'pad' && ev.action === 'down') {
      s.ripples.push({ r: ev.rowFromTop, c: ev.col, t0: app.time, hue: (ev.col * 45 + ev.rowFromTop * 20 + s.hue) % 360, k: 0.45 + (ev.velocity / 127) * 0.55 });
      if (s.ripples.length > 24) s.ripples.shift();
    }
    if (ev.type === 'encoder') {
      if (ev.id === 'e1') s.speed = Math.max(0.2, Math.min(4, s.speed + ev.delta / 60));
      if (ev.id === 'e2') s.hue = (s.hue + ev.delta * 2 + 360) % 360;
      if (ev.id === 'e3') s.width = Math.max(0.3, Math.min(3, s.width + ev.delta / 60));
      if (ev.id === 'e4') s.idle = Math.max(0, Math.min(1, s.idle + ev.delta / 210));
    }
    if (ev.type === 'button' && ev.pressed) {
      const modes = { lower1: 'soft', lower2: 'pulse', lower3: 'blink' };
      if (modes[ev.id]) s.mode = modes[ev.id];
      if (ev.id === 'lower8') s.ripples = [];
    }
  },

  tick(t, dt, app) {
    s.ripples = s.ripples.filter((r) => t - r.t0 < 3.5 / s.speed);
    let energy = 0;
    for (let note = 36; note <= 99; note++) {
      const i = note - 36, row = 7 - Math.floor(i / 8), col = i % 8;
      if (app.pads.get(note)?.down) { app.leds.pad(note, [255, 255, 255]); energy += 1; continue; }
      if (s.mode !== 'soft') {
        const hwHue = (col * 18 + row * 10 + s.hue) % 360; // static, so we don't restart the animation every frame
        // Hand the animation to the Push itself: one message, then the hardware animates.
        app.leds.pad(note, hsv(hwHue, 1, 1), { ch: s.mode === 'pulse' ? ANIM.pulseSlow : ANIM.blinkSlow, from: hsv(hwHue + 180, 1, 0.15) });
        continue;
      }
      const waveHue = (col * 18 + row * 10 + t * 50 * s.speed + s.hue) % 360;
      const acc = [0, 0, 0];
      add(acc, hsv(waveHue, 1, 1), s.idle * (0.35 + 0.25 * Math.sin(t * 2 * s.speed + col * 0.6 + row * 0.4)));
      for (const rp of s.ripples) {
        const age = (t - rp.t0) * s.speed, front = age * 5, d = Math.hypot(row - rp.r, col - rp.c);
        const k = rp.k * Math.exp(-((d - front) ** 2) / (0.6 * s.width)) * Math.exp(-age * 0.9);
        if (k > 0.01) { add(acc, hsv(rp.hue + d * 12, 1, 1), k); energy += k; }
      }
      app.leds.pad(note, acc.map((v) => Math.min(255, v) | 0));
    }
    s.energy += (Math.min(1, energy / 10) - s.energy) * Math.min(1, dt * 10);
    s.history.push(s.energy);
    s.history.shift();
    // scene column = level meter (bottom up), touch strip too
    for (let i = 0; i < 8; i++) {
      const lit = s.energy * 8 > 7 - i + 0.2; // i = 0 is the top button
      app.leds.button(43 - i, lit ? hsv(120 - (7 - i) * 15, 1, 1) : [0, 18, 0]);
    }
    app.leds.setStrip(Array.from({ length: 31 }, (_, i) => (i / 30 <= s.energy ? 7 : 0)));
    ['soft', 'pulse', 'blink'].forEach((m, i) => app.leds.button(20 + i, s.mode === m ? this.color : [20, 50, 8]));
    app.leds.button(27, [90, 20, 20]);
  },

  draw(g, app, t) {
    const h = 116, n = s.history.length, w = 960 / (n - 1);
    const grad = g.createLinearGradient(0, 0, 960, 0);
    for (let k = 0; k <= 6; k++) grad.addColorStop(k / 6, css(hsv((k * 60 + s.hue + t * 40 * s.speed) % 360, 1, 1)));
    g.beginPath();
    g.moveTo(0, h);
    s.history.forEach((v, i) => g.lineTo(i * w, h - 6 - v * (h - 20)));
    g.lineTo(960, h);
    g.closePath();
    g.globalAlpha = 0.35;
    g.fillStyle = grad;
    g.fill();
    g.globalAlpha = 1;
    g.lineWidth = 2.5;
    g.strokeStyle = grad;
    g.beginPath();
    s.history.forEach((v, i) => (i ? g.lineTo(i * w, h - 6 - v * (h - 20)) : g.moveTo(0, h - 6 - v * (h - 20))));
    g.stroke();
    const labels = [`Speed ${s.speed.toFixed(1)}×`, `Hue +${Math.round(s.hue)}°`, `Width ${s.width.toFixed(1)}`, `Glow ${Math.round(s.idle * 100)}%`];
    labels.forEach((l, i) => text(g, l, i * 120 + 60, 12, { size: 12, color: app.touched.has(`e${i + 1}`) ? '#c6ff8a' : '#9aa4b0' }));
    text(g, s.mode === 'soft' ? 'Animated by the browser (~30 updates/s)' : 'Animated by the Push itself — the browser sent one message per pad', 940, 12, { size: 12, align: 'right', color: '#c6ff8a' });
  },

  footer: () => ['Browser', 'HW Pulse', 'HW Blink', '', '', '', '', 'Clear'],
  footerActive: (i) => (i === 0 && s.mode === 'soft') || (i === 1 && s.mode === 'pulse') || (i === 2 && s.mode === 'blink'),

  panel(el) {
    el.innerHTML = `
      <h2>Ripple</h2>
      <p>A light show running on all 64 pads. Hit pads to send ripples; harder hits make bigger waves. The scene buttons and touch strip work as a level meter.</p>
      <ul class="tips">
        <li><b>Knobs 1–4:</b> speed, hue, ripple width, background glow.</li>
        <li><b>Lower buttons:</b> <i>Browser</i> animates every LED from this page; <i>HW Pulse/Blink</i> hand the animation to the Push's firmware: one message per pad, then the hardware animates on its own.</li>
      </ul>
      <p class="muted">This tab shows the LED bandwidth: in Browser mode the page streams hundreds of LED messages per second through the bridge.</p>`;
  },
};
