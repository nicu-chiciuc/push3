// Expression: MPE. Each finger reports three dimensions — pressure, left/right roll
// (per-note pitch bend) and up/down slide (CC 74) — on its own MIDI channel.
import { hsv, css } from '../palette.js';
import { text } from '../screen.js';
import { Synth } from '../synth.js';

const synth = new Synth();
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const s = { mode: 'mpe', root: 48, trails: [] };
const pitchOf = (rowFromTop, col) => s.root + col + (7 - rowFromTop) * 5; // rows in fourths, like Push
const noteName = (p) => NAMES[p % 12] + (Math.floor(p / 12) - 1);
const inScale = (p) => [0, 2, 4, 5, 7, 9, 11].includes(p % 12);
const MODES = { lower1: 'channel', lower2: 'poly', lower3: 'mpe' };
const MODE_LABEL = { channel: 'Channel pressure (one value for all pads)', poly: 'Poly aftertouch (pressure per pad)', mpe: 'MPE (pressure + roll + slide per finger)' };

export default {
  id: 'expression',
  name: 'Expression',
  color: [255, 150, 40],

  enter(app) { app.setPressureMode(s.mode); },
  exit() { for (const id of [...synth.voices.keys()]) synth.noteOff(id); this.syncPanel = null; },

  setMode(app, mode) { s.mode = mode; app.setPressureMode(mode); this.syncPanel?.(); },

  onEvent(ev, app) {
    if (ev.type === 'pad') {
      const p = app.pads.get(ev.note);
      if (ev.action === 'down') synth.noteOn(ev.note, pitchOf(ev.rowFromTop, ev.col), ev.velocity);
      else if (ev.action === 'up') synth.noteOff(ev.note);
      else if (p) synth.express(ev.note, { bend: p.x, slide: p.y, pressure: p.pressure });
    } else if (ev.type === 'channelPressure') {
      for (const [note, p] of app.pads) if (p.down) synth.express(note, { bend: p.x, slide: p.y, pressure: p.pressure });
    } else if (ev.type === 'encoder' && ev.id === 'e1') {
      synth.bendRange = Math.max(0, Math.min(24, synth.bendRange + ev.delta / 15));
    } else if (ev.type === 'button' && ev.pressed) {
      if (MODES[ev.id]) this.setMode(app, MODES[ev.id]);
      if (ev.id === 'lower5' && synth.ctx) synth.running ? synth.ctx.suspend() : synth.start();
      if (ev.id === 'lower7' || ev.id === 'octaveDown') s.root = Math.max(12, s.root - 12);
      if (ev.id === 'lower8' || ev.id === 'octaveUp') s.root = Math.min(84, s.root + 12);
    }
  },

  tick(t, dt, app) {
    for (let note = 36; note <= 99; note++) {
      const i = note - 36, rowFromTop = 7 - Math.floor(i / 8), col = i % 8;
      const pitch = pitchOf(rowFromTop, col), p = app.pads.get(note);
      let c = null;
      if (p?.down) c = hsv(15 + p.y * 45, 1 - Math.abs(p.x) * 0.5, 0.25 + 0.75 * p.pressure);
      else if (pitch % 12 === 0) c = [0, 90, 255];
      else if (inScale(pitch)) c = [36, 36, 36];
      app.leds.pad(note, c);
    }
    const dim = [70, 35, 0];
    ['channel', 'poly', 'mpe'].forEach((m, i) => app.leds.button(20 + i, s.mode === m ? this.color : dim));
    app.leds.button(23, null);
    app.leds.button(24, synth.running ? [0, 220, 90] : [0, 40, 15]);
    app.leds.button(25, null);
    app.leds.button(26, [60, 60, 60]);
    app.leds.button(27, [60, 60, 60]);

    // fading trails for the screen
    for (const tr of s.trails) tr.age += dt;
    s.trails = s.trails.filter((tr) => tr.age < 0.6);
    for (const [note, p] of app.pads) {
      if (!p.down) continue;
      const i = note - 36;
      s.trails.push({ x: (i % 8) + 0.5 + p.x * 0.5, y: p.y, r: p.pressure, hue: 15 + p.y * 45, age: 0 });
    }
  },

  draw(g, app) {
    for (let c = 1; c < 8; c++) { g.fillStyle = '#14171d'; g.fillRect(c * 120, 0, 1, 116); }
    for (const tr of s.trails) {
      g.fillStyle = css(hsv(tr.hue, 1, 1), 0.25 * (1 - tr.age / 0.6));
      g.beginPath();
      g.arc(tr.x * 120, 8 + (1 - tr.y) * 100, 4 + tr.r * 30, 0, Math.PI * 2);
      g.fill();
    }
    const fingers = [...app.pads].filter(([, p]) => p.down);
    for (const [note, p] of fingers) {
      const i = note - 36, x = ((i % 8) + 0.5 + p.x * 0.5) * 120, y = 8 + (1 - p.y) * 100, r = 6 + p.pressure * 34;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, '#fff');
      grad.addColorStop(0.35, css(hsv(15 + p.y * 45, 1, 1)));
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      text(g, noteName(pitchOf(7 - Math.floor(i / 8), i % 8)), x, Math.max(10, y - r - 8), { size: 12, weight: 700 });
    }
    if (!fingers.length) {
      text(g, 'Hold pads. Press harder, roll your finger left/right, slide it up/down.', 480, 46, { size: 16, weight: 600 });
      text(g, MODE_LABEL[s.mode], 480, 74, { size: 13, color: '#ffb35c' });
    } else {
      fingers.slice(0, 4).forEach(([note, p], k) => {
        const i = note - 36;
        text(g, `${noteName(pitchOf(7 - Math.floor(i / 8), i % 8)).padEnd(4)} ↔ ${p.x >= 0 ? '+' : ''}${p.x.toFixed(2)}  ↕ ${p.y.toFixed(2)}  ● ${Math.round(p.pressure * 100)}%`, 8, 10 + k * 15, { size: 11, align: 'left', color: '#ffd9a8', font: '"SF Mono", Menlo, monospace' });
      });
    }
  },

  footer: () => ['Chan AT', 'Poly AT', 'MPE', '', synth.running ? 'Sound on' : 'Sound off', '', 'Oct −', 'Oct +'],
  footerActive: (i) => (i === 0 && s.mode === 'channel') || (i === 1 && s.mode === 'poly') || (i === 2 && s.mode === 'mpe') || (i === 4 && synth.running),

  panel(el, app) {
    el.innerHTML = `
      <h2>Expression (MPE)</h2>
      <p>Push 3 pads sense <b>pressure</b>, a left/right <b>roll</b> and an up/down <b>slide</b> while your finger is down. In MPE mode, each finger gets its own MIDI channel so all three are tracked per finger.</p>
      <div class="row" id="x-modes">
        <button data-m="channel">Channel AT</button>
        <button data-m="poly">Poly AT</button>
        <button data-m="mpe">MPE</button>
      </div>
      <div class="row">
        <button id="x-sound">🔈 Enable sound</button>
        <label class="toggle">Bend range <input type="range" id="x-bend" min="0" max="24" step="1" style="width:120px" /> <span id="x-bend-v"></span> st</label>
      </div>
      <div class="card-box"><div class="stat-grid" id="x-fingers"></div></div>
      <p class="muted">Pads are laid out in fourths like Push's default (blue = C). Lower display buttons switch modes, toggle sound (after you enable it here once) and shift octaves. Knob 1 sets the bend range.</p>`;
    const modeBtns = [...el.querySelectorAll('[data-m]')];
    modeBtns.forEach((b) => (b.onclick = () => this.setMode(app, b.dataset.m)));
    const snd = el.querySelector('#x-sound');
    snd.onclick = async () => { synth.running ? await synth.ctx.suspend() : await synth.start(); sync(); };
    const bend = el.querySelector('#x-bend');
    bend.oninput = () => { synth.bendRange = +bend.value; sync(); };
    const fingers = el.querySelector('#x-fingers');
    const sync = () => {
      modeBtns.forEach((b) => b.classList.toggle('active', b.dataset.m === s.mode));
      snd.textContent = synth.running ? '🔊 Sound on' : '🔈 Enable sound';
      bend.value = Math.round(synth.bendRange);
      el.querySelector('#x-bend-v').textContent = Math.round(synth.bendRange);
    };
    this.syncPanel = sync;
    sync();
    const refresh = () => {
      if (!fingers.isConnected) return;
      const down = [...app.pads].filter(([, p]) => p.down);
      fingers.innerHTML = down.length
        ? down.map(([note, p]) => `<span>Pad ${note}${p.ch ? ` · ch ${p.ch + 1}` : ''}</span><span class="v">↔ ${p.x.toFixed(2)} ↕ ${p.y.toFixed(2)} ● ${Math.round(p.pressure * 100)}%</span>`).join('')
        : '<span class="muted">No fingers down</span><span></span>';
      if (synth.running !== snd.textContent.includes('on')) sync();
      setTimeout(refresh, 80);
    };
    refresh();
  },
};
