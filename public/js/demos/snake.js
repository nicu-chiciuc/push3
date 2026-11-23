// Snake on the 8×8 pad grid. Steer with the arrow buttons, the jog wheel, or by
// tapping a pad next to the head. Food pulses using the Push's own LED animation.
import { hsv } from '../palette.js';
import { text } from '../screen.js';
import { ANIM } from '../leds.js';

const s = { body: [], dir: [0, 1], next: [0, 1], food: null, alive: false, score: 0, best: 0, acc: 0, stepMs: 300, deadAt: 0 };
const key = ([r, c]) => r * 8 + c;
const noteAt = ([r, c]) => 36 + (7 - r) * 8 + c;

function reset() {
  Object.assign(s, { body: [[4, 2], [4, 1], [4, 0]], dir: [0, 1], next: [0, 1], alive: true, score: 0, acc: 0, stepMs: 300 });
  placeFood();
}
function placeFood() {
  const taken = new Set(s.body.map(key));
  const free = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (!taken.has(r * 8 + c)) free.push([r, c]);
  s.food = free[Math.floor(Math.random() * free.length)];
}
function steer(dr, dc) {
  if (dr === -s.dir[0] && dc === -s.dir[1]) return; // no reversing into yourself
  s.next = [dr, dc];
}
function step() {
  s.dir = s.next;
  const head = [(s.body[0][0] + s.dir[0] + 8) % 8, (s.body[0][1] + s.dir[1] + 8) % 8];
  const eating = s.food && key(head) === key(s.food);
  const body = eating ? s.body : s.body.slice(0, -1);
  if (body.some((p) => key(p) === key(head))) { s.alive = false; s.deadAt = performance.now(); s.best = Math.max(s.best, s.score); return; }
  s.body = [head, ...body];
  if (eating) { s.score++; s.stepMs = Math.max(110, s.stepMs - 12); placeFood(); }
}

export default {
  id: 'snake',
  name: 'Snake',
  color: [255, 70, 70],

  enter(app) { s.best = app.store.get('snakeBest', 0); if (!s.body.length) reset(); },

  onEvent(ev, app) {
    if (ev.type === 'button' && ev.pressed) {
      const dirs = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
      if (dirs[ev.id]) steer(...dirs[ev.id]);
      if (ev.id === 'lower1' || (!s.alive && ev.id === 'center')) reset();
    }
    if (ev.type === 'encoder' && (ev.id === 'jog' || ev.id === 'e1')) {
      // rotate the direction: clockwise turns right
      const [dr, dc] = s.next;
      ev.delta > 0 ? steer(dc, -dr) : steer(-dc, dr);
    }
    if (ev.type === 'pad' && ev.action === 'down') {
      if (!s.alive) { if (performance.now() - s.deadAt > 600) reset(); return; }
      const [hr, hc] = s.body[0], dr = ev.rowFromTop - hr, dc = ev.col - hc;
      if (Math.abs(dr) > Math.abs(dc)) steer(Math.sign(dr), 0);
      else if (dc) steer(0, Math.sign(dc));
    }
    if (!s.alive) app.store.set('snakeBest', s.best);
  },

  tick(t, dt, app) {
    if (s.alive) {
      s.acc += dt * 1000;
      while (s.acc >= s.stepMs && s.alive) { s.acc -= s.stepMs; step(); }
    }
    const lit = new Map();
    s.body.forEach((p, i) => lit.set(key(p), i === 0 ? [255, 255, 255] : hsv(120 + i * 6, 1, Math.max(0.25, 1 - i / (s.body.length + 4)))));
    const deadFlash = !s.alive && Math.floor(t * 4) % 2 === 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const n = noteAt([r, c]);
        if (s.food && key(s.food) === r * 8 + c && s.alive) app.leds.pad(n, [255, 0, 0], { ch: ANIM.pulse, from: [40, 0, 0] });
        else app.leds.pad(n, deadFlash && lit.has(r * 8 + c) ? [255, 0, 0] : lit.get(r * 8 + c) ?? null);
      }
    }
    for (const cc of [46, 47, 44, 45]) app.leds.button(cc, [255, 255, 255]);
    app.leds.button(20, s.alive ? [60, 10, 10] : this.color);
  },

  draw(g, app, t) {
    text(g, `${s.score}`, 120, 52, { size: 64, weight: 800, color: '#ff6b6b' });
    text(g, 'score', 120, 98, { size: 13, color: '#9aa4b0' });
    text(g, `${s.best}`, 840, 52, { size: 44, weight: 800, color: '#ffd166' });
    text(g, 'best', 840, 98, { size: 13, color: '#9aa4b0' });
    if (s.alive) {
      text(g, 'Steer with ◀ ▲ ▼ ▶, the jog wheel, or tap a pad beside the head', 480, 46, { size: 15 });
      text(g, `Length ${s.body.length} · speed ${Math.round(1000 / s.stepMs * 10) / 10} moves/s`, 480, 74, { size: 13, color: '#9aa4b0' });
    } else {
      text(g, 'GAME OVER', 480, 44, { size: 40, weight: 900, color: Math.floor(t * 3) % 2 ? '#ff4d4d' : '#fff' });
      text(g, 'Tap any pad (or lower button 1) to play again', 480, 84, { size: 14, color: '#c8d0d8' });
    }
  },

  footer: () => ['New game', '', '', '', '', '', '', ''],

  panel(el) {
    el.innerHTML = `
      <h2>Snake</h2>
      <p>A tiny game on the 8×8 pad grid, to show the Push works as a general input and output device.</p>
      <ul class="tips">
        <li>Steer with the <b>arrow buttons</b>, the <b>jog wheel</b> / knob 1, or tap a <b>pad</b> next to the head.</li>
        <li>The red food pulses using the Push's built-in LED animation, not browser updates.</li>
        <li>The snake wraps around the edges. Each bite makes it faster.</li>
      </ul>`;
  },
};
