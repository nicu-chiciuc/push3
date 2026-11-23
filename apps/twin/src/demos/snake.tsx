// Snake on the 8×8 pad grid. Steer with the arrow buttons, the jog wheel, or by tapping a
// pad next to the head. Food pulses using the Push's own LED animation.
import { createSignal } from 'solid-js';
import { ANIM } from '@push3/protocol';
import { hsv } from '@push3/protocol';
import { text } from '../engine/screen.ts';
import { store, type Demo } from '../engine/engine.ts';
import type { RGB } from '@push3/protocol';

type Cell = readonly [number, number]; // [rowFromTop, col]
const [score, setScore] = createSignal(0);
const [best, setBest] = createSignal(store.get('snakeBest', 0));
const s = { body: [] as Array<Cell>, dir: [0, 1] as Cell, next: [0, 1] as Cell, food: null as Cell | null, alive: false, acc: 0, stepMs: 300, deadAt: 0 };
const key = ([r, c]: Cell) => r * 8 + c;
const noteAt = ([r, c]: Cell) => 36 + (7 - r) * 8 + c;

function reset() {
  Object.assign(s, { body: [[4, 2], [4, 1], [4, 0]], dir: [0, 1], next: [0, 1], alive: true, acc: 0, stepMs: 300 });
  setScore(0);
  placeFood();
}
function placeFood() {
  const taken = new Set(s.body.map(key)), free: Array<Cell> = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (!taken.has(r * 8 + c)) free.push([r, c]);
  s.food = free[Math.floor(Math.random() * free.length)] ?? null;
}
function steer(dr: number, dc: number) {
  if (dr === -s.dir[0] && dc === -s.dir[1]) return; // no reversing into yourself
  s.next = [dr, dc];
}
function step() {
  s.dir = s.next;
  const head: Cell = [(s.body[0]![0] + s.dir[0] + 8) % 8, (s.body[0]![1] + s.dir[1] + 8) % 8];
  const eating = s.food !== null && key(head) === key(s.food);
  const body = eating ? s.body : s.body.slice(0, -1);
  if (body.some((p) => key(p) === key(head))) {
    s.alive = false;
    s.deadAt = performance.now();
    if (score() > best()) { setBest(score()); store.set('snakeBest', score()); }
    return;
  }
  s.body = [head, ...body];
  if (eating) { setScore(score() + 1); s.stepMs = Math.max(110, s.stepMs - 12); placeFood(); }
}

export const snake: Demo = {
  id: 'snake',
  name: 'Snake',
  color: [255, 70, 70],

  onEvent(ev) {
    if (ev.type === 'button' && ev.pressed) {
      const dirs: Record<string, Cell> = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
      const d = dirs[ev.id];
      if (d) steer(d[0], d[1]);
      if (ev.id === 'lower1' || (!s.alive && ev.id === 'center')) reset();
    }
    if (ev.type === 'encoder' && (ev.id === 'jog' || ev.id === 'e1')) {
      const [dr, dc] = s.next; // clockwise turns right
      ev.delta > 0 ? steer(dc, -dr) : steer(-dc, dr);
    }
    if (ev.type === 'pad' && ev.action === 'down') {
      if (!s.alive) { if (performance.now() - s.deadAt > 600) reset(); return; }
      const [hr, hc] = s.body[0]!, dr = ev.rowFromTop - hr, dc = ev.col - hc;
      if (Math.abs(dr) > Math.abs(dc)) steer(Math.sign(dr), 0);
      else if (dc) steer(0, Math.sign(dc));
    }
  },

  tick(t, dt, app) {
    if (!s.body.length) reset();
    if (s.alive) {
      s.acc += dt * 1000;
      while (s.acc >= s.stepMs && s.alive) { s.acc -= s.stepMs; step(); }
    }
    const lit = new Map<number, RGB>();
    s.body.forEach((p, i) => lit.set(key(p), i === 0 ? [255, 255, 255] : hsv(120 + i * 6, 1, Math.max(0.25, 1 - i / (s.body.length + 4)))));
    const flash = !s.alive && Math.floor(t * 4) % 2 === 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const n = noteAt([r, c]), k = r * 8 + c;
        if (s.alive && s.food && key(s.food) === k) app.leds.pad(n, [255, 0, 0], { ch: ANIM.pulse, from: [40, 0, 0] });
        else app.leds.pad(n, flash && lit.has(k) ? [255, 0, 0] : (lit.get(k) ?? null));
      }
    }
    for (const cc of [46, 47, 44, 45]) app.leds.button(cc, [255, 255, 255]);
    app.leds.button(20, s.alive ? [60, 10, 10] : this.color);
  },

  draw(g, _app, t) {
    text(g, `${score()}`, 120, 52, { size: 64, weight: 800, color: '#ff6b6b' });
    text(g, 'score', 120, 98, { size: 13, color: '#9aa4b0' });
    text(g, `${best()}`, 840, 52, { size: 44, weight: 800, color: '#ffd166' });
    text(g, 'best', 840, 98, { size: 13, color: '#9aa4b0' });
    if (s.alive) {
      text(g, 'Steer with ◀ ▲ ▼ ▶, the jog wheel, or tap a pad beside the head', 480, 46, { size: 15 });
      text(g, `Length ${s.body.length} · ${Math.round(10000 / s.stepMs) / 10} moves/s`, 480, 74, { size: 13, color: '#9aa4b0' });
    } else {
      text(g, 'GAME OVER', 480, 44, { size: 40, weight: 900, color: Math.floor(t * 3) % 2 ? '#ff4d4d' : '#fff' });
      text(g, 'Tap any pad (or lower button 1) to play again', 480, 84, { size: 14, color: '#c8d0d8' });
    }
  },

  footer: () => ['New game', '', '', '', '', '', '', ''],

  Panel: () => (
    <>
      <h2>Snake</h2>
      <p>A tiny game on the 8×8 pad grid, to show the Push works as a general input <i>and</i> output device.</p>
      <div class="score-row"><div><b>{score()}</b><span>score</span></div><div><b>{best()}</b><span>best</span></div></div>
      <ul class="tips">
        <li>Steer with the <b>arrow buttons</b>, the <b>jog wheel</b> / knob 1, or tap a <b>pad</b> next to the head.</li>
        <li>The red food pulses using the Push's built-in LED animation, not browser updates.</li>
        <li>The snake wraps around the edges. Each bite makes it faster.</li>
      </ul>
      <button onClick={reset}>New game</button>
    </>
  ),
};
