// Blocks: a falling-block game whose well runs down the Push itself. A piece comes in on the
// display (two rows of cells as large as the pads, in the same eight columns), passes the lower
// display buttons (one row) and lands on the pads (eight rows). The rules are in blocks-game.ts.
import { createSignal } from 'solid-js';
import { Effect } from 'effect';
import { ANIM, css, hsv, padNote, type PushEvent, type RGB } from '@push3/protocol';
import { FONT, text } from '../engine/screen.ts';
import { store, type Demo } from '../engine/engine.ts';
import { CLEAR_TIME, COLS, Game, LINES_PER_LEVEL, ROWS, SHAPES, type Cell } from './blocks-game.ts';
import { Music, musicTempo } from './blocks-music.ts';
import { Sfx } from './blocks-sfx.ts';

// ── where each row of the well is on the device ──
/** Rows 0 and 1 are on the display, each cell 120 × 80 px: nearly the size of a pad. */
const CELL_W = 120, CELL_H = 80, DISPLAY_ROWS = 2;
/** Row 2 is the lower display buttons (CC 20-27); rows 3-10 are the pads. */
const BUTTON_ROW = 2, PAD_ROW0 = 3;

// ── colors ──
const WHITE: RGB = [255, 255, 255];
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
/** One piece kind in the states the LEDs show it in, each an exact palette color, and on the display. */
interface Tint { readonly live: RGB; readonly set: RGB; readonly dim: RGB; readonly faint: RGB; readonly ink: RGB }
const tintOf = (hue: number | null): Tint =>
  hue == null
    ? { live: WHITE, set: [128, 128, 128], dim: [38, 38, 38], faint: [20, 20, 20], ink: [206, 212, 226] }
    : { live: hsv(hue, 0.45, 1), set: hsv(hue, 1, 1), dim: hsv(hue, 1, 0.22), faint: hsv(hue, 1, 0.08), ink: hsv(hue, 0.84, 1) };
/** bar, square, tee, step up, step down, left hook, right hook */
const TINTS = [300, null, 45, 180, 225, 120, 0].map(tintOf);
const DEAD: RGB = [77, 77, 77];

// ── timing ──
/** Hold left or right: the first repeat comes after DAS seconds, then one each ARR seconds. */
const DAS = 0.17, ARR = 0.045;
const FLASH_TIME = 0.14, TRAIL_TIME = 0.2, CALLOUT_TIME = 1.6;

const game = new Game();
const sfx = new Sfx();
sfx.volume = store.get('blocksVolume', 0.7);
const music = new Music();

type Status = 'ready' | 'playing' | 'paused' | 'over';
const [status, setStatus] = createSignal<Status>('ready');
const [score, setScore] = createSignal(0);
const [best, setBest] = createSignal(store.get('blocksBest', 0));
const [level, setLevel] = createSignal(1);
const [lines, setLines] = createSignal(0);
const [soundOn, setSoundOn] = createSignal(store.get('blocksSound', true));
sfx.on = soundOn();
const [musicOn, setMusicOn] = createSignal(store.get('blocksMusic', true));

/** What the view remembers between frames: effects, and the keys held. */
const fx = {
  now: 0,
  flashes: [] as Array<{ cells: ReadonlyArray<Cell>; t0: number }>,
  trails: [] as Array<{ x: number; y0: number; y1: number; kind: number; t0: number }>,
  callout: null as { title: string; sub: string; color: string; t0: number } | null,
  scoreT: -9, levelT: -9, volumeT: -9, musicT: -9, overT: -9,
  shake: 0,
  newBest: false,
  left: false, right: false, das: { dir: 0, t: 0 },
};

// One look for each cell of the well, composed in tick() and used by the LEDs and the display.
const EMPTY = 0, SET = 1, LIVE = 2, GHOST = 3, TRAIL = 4, GONE = 5;
const look = { mode: new Uint8Array(COLS * ROWS), kind: new Int8Array(COLS * ROWS), white: new Float32Array(COLS * ROWS) };

// ── actions (the Push, the keyboard and the panel all call these) ──
function newGame() {
  Object.assign(fx, { flashes: [], trails: [], callout: null, shake: 0, newBest: false });
  game.start();
}
function releaseKeys() {
  Object.assign(fx, { left: false, right: false, das: { dir: 0, t: 0 } });
  game.softDrop = false;
}
function setPaused(on: boolean, quiet = false) {
  if ((game.phase !== 'playing' && game.phase !== 'clearing') || game.paused === on) return;
  game.setPaused(on);
  releaseKeys();
  if (!quiet) sfx.pause(on);
}
/** The Play button: start, pause, resume. */
function playPause() {
  if (game.phase === 'ready' || game.phase === 'over') newGame();
  else setPaused(!game.paused);
}
/** The big button: start, resume, or drop the piece. After a game ends it waits a moment, so a
 *  drop that came too late does not start the next game. */
function primary() {
  if (game.phase === 'ready') newGame();
  else if (game.phase === 'over') { if (fx.now - fx.overT > 0.9) newGame(); }
  else if (game.paused) setPaused(false);
  else game.hardDrop();
}
function pressDir(d: -1 | 1) {
  if (d < 0) fx.left = true; else fx.right = true;
  fx.das = { dir: d, t: 0 };
  game.move(d);
}
function releaseDir(d: -1 | 1) {
  if (d < 0) fx.left = false; else fx.right = false;
  if (fx.das.dir === d) fx.das = { dir: (d < 0 ? fx.right : fx.left) ? -d : 0, t: 0 };
}
/** A tap on the well. Beside the piece: it goes there. On it: it turns. Below it: it drops. */
function tap(x: number, y: number) {
  const p = game.piece;
  if (!game.active || !p) { primary(); return; }
  const cells = game.cells(p), xs = cells.map((c) => c[0]), lo = Math.min(...xs), hi = Math.max(...xs);
  if (x < lo) { for (let i = lo - x; i > 0 && game.move(-1); i--); }
  else if (x > hi) { for (let i = x - hi; i > 0 && game.move(1); i--); }
  else if (y > Math.max(...cells.filter((c) => c[0] === x).map((c) => c[1]))) game.hardDrop();
  else game.rotate(1);
}
function toggleSound() {
  setSoundOn(!soundOn());
  store.set('blocksSound', soundOn());
  sfx.setOn(soundOn());
  fx.volumeT = fx.now;
}
function toggleMusic() {
  setMusicOn(!musicOn());
  store.set('blocksMusic', musicOn());
  fx.musicT = fx.now;
}
/** The music plays while a game goes on, and not while it is paused. */
const updateMusic = (play = true) =>
  music.update(sfx.bus(), play && musicOn() && (game.phase === 'playing' || game.phase === 'clearing') && !game.paused, musicTempo(game.level));
function turnVolume(delta: number) {
  sfx.setVolume(sfx.volume + delta / 110);
  store.set('blocksVolume', sfx.volume);
  fx.volumeT = fx.now;
}

function onButton(ev: Extract<PushEvent, { type: 'button' }>) {
  const lower = /^lower(\d)$/.exec(ev.id);
  if (lower) { if (ev.pressed) tap(+lower[1]! - 1, BUTTON_ROW); return; }
  switch (ev.id) {
    case 'left': ev.pressed ? pressDir(-1) : releaseDir(-1); return;
    case 'right': ev.pressed ? pressDir(1) : releaseDir(1); return;
    case 'down': game.softDrop = ev.pressed && game.active; return;
  }
  if (!ev.pressed) return;
  switch (ev.id) {
    case 'up': game.rotate(1); break;
    case 'jogLeft': game.move(-1); break;
    case 'jogRight': game.move(1); break;
    case 'center': case 'jogPress': primary(); break;
    case 'swap': case 'tempoPress': game.swapHold(); break;
    case 'play': playPause(); break;
    case 'new': newGame(); break;
    case 'mute': toggleSound(); break;
    case 'metronome': toggleMusic(); break;
  }
}

// ── keyboard, for a page with no Push ──
const typing = (ev: KeyboardEvent) =>
  ev.metaKey || ev.ctrlKey || ev.altKey || (ev.target instanceof Element && ev.target.closest('input, textarea, select, [contenteditable]') !== null);
function onKeyDown(ev: KeyboardEvent) {
  if (typing(ev)) return;
  const once = !ev.repeat;
  switch (ev.key.length === 1 ? ev.key.toLowerCase() : ev.key) {
    case 'ArrowLeft': if (once) pressDir(-1); break;
    case 'ArrowRight': if (once) pressDir(1); break;
    case 'ArrowDown': if (once) game.softDrop = game.active; break;
    case 'ArrowUp': case 'x': if (once) game.rotate(1); break;
    case 'z': if (once) game.rotate(-1); break;
    case ' ': if (once) primary(); break;
    case 'c': if (once) game.swapHold(); break;
    case 'p': if (once) playPause(); break;
    case 'n': if (once) newGame(); break;
    case 'm': if (once) toggleSound(); break;
    case 'b': if (once) toggleMusic(); break;
    default: return;
  }
  ev.preventDefault(); // no page scroll
  // a button that was clicked keeps the focus, and Space would press it again
  if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
}
function onKeyUp(ev: KeyboardEvent) {
  if (ev.key === 'ArrowLeft') releaseDir(-1);
  else if (ev.key === 'ArrowRight') releaseDir(1);
  else if (ev.key === 'ArrowDown') game.softDrop = false;
}
const onGesture = () => sfx.wake();

// ── what happened in the game → sound and effects ──
function react(t: number) {
  let moves = 0;
  for (const ev of game.events.splice(0)) {
    switch (ev.type) {
      case 'start': sfx.start(); music.rewind(); break;
      case 'move': sfx.move(ev.x + 1, moves++ * 0.02); break;
      case 'rotate': sfx.rotate(); break;
      case 'hold': sfx.hold(); break;
      case 'lock': {
        game.softDrop = false; // a held Down is for this piece only: the next one waits for a new press
        fx.flashes.push({ cells: ev.cells, t0: t });
        const col = Math.round(ev.cells.reduce((sum, c) => sum + c[0], 0) / ev.cells.length);
        if (!ev.hard) { sfx.lock(col); break; }
        sfx.drop(col);
        fx.shake = Math.min(1, 0.3 + ev.dropped * 0.07);
        // the path it fell through glows for a moment, column by column
        for (const x of new Set(ev.cells.map((c) => c[0]))) {
          const y1 = Math.min(...ev.cells.filter((c) => c[0] === x).map((c) => c[1]));
          fx.trails.push({ x, y0: Math.max(0, y1 - ev.dropped), y1, kind: ev.kind, t0: t });
        }
        break;
      }
      case 'clear': {
        const n = ev.rows.length;
        sfx.clear(n, ev.combo);
        if (ev.sweep) sfx.sweep();
        fx.callout = {
          title: ev.sweep ? 'CLEAN SWEEP' : ['', 'LINE', 'DOUBLE', 'TRIPLE', 'QUAD'][n]!,
          sub: `+${ev.points.toLocaleString('en-US')}${ev.combo > 1 ? `  ·  combo ×${ev.combo}` : ''}`,
          color: ev.sweep || n >= 4 ? '#ffd166' : '#ffffff',
          t0: t,
        };
        fx.scoreT = t;
        if (n >= 4) fx.shake = 1;
        break;
      }
      case 'level':
        sfx.level();
        fx.levelT = t;
        if (fx.callout) fx.callout.sub += `  ·  level ${ev.level}`;
        break;
      case 'over':
        sfx.over();
        fx.overT = t;
        fx.newBest = game.score > best();
        if (fx.newBest) { setBest(game.score); store.set('blocksBest', game.score); }
        break;
    }
  }
}

// ── the look of each cell ──
function compose(t: number) {
  const { mode, kind, white } = look;
  for (let i = 0; i < mode.length; i++) { kind[i] = game.well[i]!; mode[i] = kind[i]! >= 0 ? SET : EMPTY; white[i] = 0; }
  if (game.phase === 'ready') { rain(t); return; }

  fx.trails = fx.trails.filter((tr) => t - tr.t0 < TRAIL_TIME);
  for (const tr of fx.trails) for (let y = tr.y0; y < tr.y1; y++) { const i = y * COLS + tr.x; if (mode[i] === EMPTY) { mode[i] = TRAIL; kind[i] = tr.kind; } }

  const p = game.piece;
  if (p && game.phase === 'playing') {
    const gy = game.ghostY();
    if (gy !== p.y && !game.paused) for (const [x, y] of game.cells({ ...p, y: gy })) { mode[y * COLS + x] = GHOST; kind[y * COLS + x] = p.kind; }
    for (const [x, y] of game.cells(p)) { mode[y * COLS + x] = LIVE; kind[y * COLS + x] = p.kind; }
  }

  fx.flashes = fx.flashes.filter((f) => t - f.t0 < FLASH_TIME);
  for (const f of fx.flashes) for (const [x, y] of f.cells) white[y * COLS + x] = Math.max(white[y * COLS + x]!, 1 - (t - f.t0) / FLASH_TIME);

  if (game.phase === 'clearing') {
    // full rows go white, then open from the middle outward
    const k = game.clearT / CLEAR_TIME, open = ((k - 0.4) / 0.6) * (COLS / 2 + 0.2);
    for (const y of game.clearing) for (let x = 0; x < COLS; x++) {
      const i = y * COLS + x;
      if (Math.abs(x - (COLS - 1) / 2) < open) { mode[i] = EMPTY; white[i] = 0; } else white[i] = 1;
    }
  }
  if (game.phase === 'over') {
    // the stack loses its color from the floor up
    const from = ROWS - Math.floor((t - fx.overT) / 0.06);
    for (let i = Math.max(0, from) * COLS; i < mode.length; i++) if (mode[i] === SET) mode[i] = GONE;
  }
}

/** Before a game: drops of color run down the columns. */
function rain(t: number) {
  const { mode, kind } = look, span = ROWS + 5;
  for (let x = 0; x < COLS; x++) {
    const run = t * (3 + ((x * 5) % 4) * 0.8) + x * 4.3, head = BUTTON_ROW + (run % span);
    for (let y = BUTTON_ROW; y < ROWS; y++) {
      const d = head - y;
      if (d < 0 || d >= 4) continue;
      mode[y * COLS + x] = d < 1 ? LIVE : d < 2 ? SET : d < 3 ? GHOST : TRAIL;
      kind[y * COLS + x] = (x + Math.floor(run / span)) % TINTS.length;
    }
  }
}

function ledColor(i: number): RGB | null {
  const m = look.mode[i]!, tint = TINTS[look.kind[i]!], w = look.white[i]!;
  let c: RGB | null = null;
  if (m === GONE) c = DEAD;
  else if (m !== EMPTY && tint) {
    if (game.paused) c = m === SET || m === LIVE ? tint.dim : null;
    else c = m === SET ? tint.set : m === LIVE ? tint.live : m === GHOST ? tint.dim : tint.faint;
  }
  return w > 0 ? mix(c ?? [0, 0, 0], WHITE, w) : c;
}

// ── drawing on the display ──
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** A cell on the display, drawn as a lit pad. */
function tile(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: RGB, { glow = 0, alpha = 1, r = 12 } = {}) {
  const pad = Math.max(1, Math.round(Math.min(w, h) * 0.07));
  g.save();
  g.globalAlpha = alpha;
  const body = g.createLinearGradient(0, y, 0, y + h);
  body.addColorStop(0, css(mix(c, WHITE, 0.3)));
  body.addColorStop(0.55, css(c));
  body.addColorStop(1, css(mix(c, [0, 0, 0], 0.32)));
  if (glow > 0) { g.shadowColor = css(c, 0.9); g.shadowBlur = glow; }
  g.fillStyle = body;
  roundRect(g, x + pad, y + pad, w - 2 * pad, h - 2 * pad, r);
  g.fill();
  g.shadowBlur = 0;
  if (Math.min(w, h) > 30) {
    g.strokeStyle = 'rgba(255,255,255,0.28)';
    g.lineWidth = 1.5;
    roundRect(g, x + pad + 3, y + pad + 3, w - 2 * pad - 6, h - 2 * pad - 6, Math.max(2, r - 3));
    g.stroke();
  }
  g.restore();
}

/** A small piece for the HOLD and NEXT boxes, centered on (cx, cy). */
function mini(g: CanvasRenderingContext2D, kind: number, cx: number, cy: number, cell: number, alpha: number) {
  const cells = SHAPES[kind]![0]!, xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
  const x0 = cx - ((Math.min(...xs) + Math.max(...xs) + 1) * cell) / 2, y0 = cy - ((Math.min(...ys) + Math.max(...ys) + 1) * cell) / 2;
  for (const [x, y] of cells) tile(g, x0 + x * cell, y0 + y * cell, cell, cell, TINTS[kind]!.ink, { alpha, r: cell * 0.22 });
}

function label(g: CanvasRenderingContext2D, str: string, x: number, y: number, align: CanvasTextAlign = 'left') {
  g.letterSpacing = '1.5px';
  text(g, str, x, y, { size: 10.5, weight: 700, color: '#7c8796', align });
  g.letterSpacing = '0px';
}

/** Text with a dark edge, readable over the cells. */
function banner(g: CanvasRenderingContext2D, str: string, y: number, size: number, color: string, weight = 900, spacing = 3) {
  g.font = `${weight} ${size}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.letterSpacing = `${spacing}px`;
  g.lineJoin = 'round';
  g.lineWidth = Math.max(4, size * 0.2);
  g.strokeStyle = 'rgba(7,8,10,0.86)';
  g.strokeText(str, 480 + spacing / 2, y);
  g.fillStyle = color;
  g.fillText(str, 480 + spacing / 2, y);
  g.letterSpacing = '0px';
}

function drawHud(g: CanvasRenderingContext2D, t: number) {
  const pop = Math.max(0, 1 - (t - fx.scoreT) / 0.45), up = Math.max(0, 1 - (t - fx.levelT) / 1.2);
  label(g, 'SCORE', 20, 21);
  text(g, game.score.toLocaleString('en-US'), 19, 56, { size: 42 + pop * 5, weight: 800, align: 'left', color: css(mix([242, 245, 249], [255, 209, 102], pop)) });
  const call = fx.callout && game.phase !== 'over' && t - fx.callout.t0 < CALLOUT_TIME ? fx.callout : null;
  if (call) {
    // what the last piece earned, under the score it went into
    const age = t - call.t0;
    g.save();
    g.globalAlpha = Math.min(1, age / 0.06) * Math.min(1, (CALLOUT_TIME - age) / 0.3);
    text(g, call.title, 20, 106, { size: 20, weight: 850, align: 'left', color: call.color });
    text(g, call.sub, 20, 131, { size: 13, weight: 600, align: 'left', color: '#c8d0d8' });
    g.restore();
  } else {
    const stats: ReadonlyArray<readonly [string, number, number]> = [['LEVEL', game.level, up], ['LINES', game.lines, 0], ['BEST', Math.max(best(), game.score), 0]];
    stats.forEach(([name, value, hot], i) => {
      const x = 20 + i * 70;
      label(g, name, x, 104);
      text(g, value.toLocaleString('en-US'), x, 127, { size: 19, weight: 750, align: 'left', color: css(mix([214, 220, 228], [255, 209, 102], hot)) });
    });
  }

  label(g, 'HOLD', 780, 21, 'center');
  if (game.hold != null) mini(g, game.hold, 780, 90, 21, game.holdUsed ? 0.3 : 1);
  label(g, 'NEXT', 900, 21, 'center');
  if (game.phase !== 'ready') {
    const next = game.next(3);
    mini(g, next[0]!, 900, 58, 17, 1);
    mini(g, next[1]!, 900, 104, 11, 0.75);
    mini(g, next[2]!, 900, 137, 11, 0.5);
  }
}

function drawCells(g: CanvasRenderingContext2D) {
  for (let i = 0; i < DISPLAY_ROWS * COLS; i++) {
    const x = (i % COLS) * CELL_W, y = Math.floor(i / COLS) * CELL_H, m = look.mode[i]!, tint = TINTS[look.kind[i]!], w = look.white[i]!;
    if (m === EMPTY || (!tint && m !== GONE)) {
      if (w > 0) tile(g, x, y, CELL_W, CELL_H, WHITE, { glow: 16, alpha: w });
      continue;
    }
    const ink = m === GONE ? DEAD : tint!.ink;
    if (m === GHOST) {
      g.strokeStyle = css(ink, 0.55);
      g.lineWidth = 2;
      g.setLineDash([7, 6]);
      roundRect(g, x + 7, y + 7, CELL_W - 14, CELL_H - 14, 11);
      g.stroke();
      g.setLineDash([]);
    } else if (m === TRAIL) tile(g, x, y, CELL_W, CELL_H, ink, { alpha: 0.16 });
    else if (m === LIVE) tile(g, x, y, CELL_W, CELL_H, mix(ink, WHITE, Math.max(0.18, w)), { glow: 18, alpha: game.paused ? 0.35 : 1 });
    else tile(g, x, y, CELL_W, CELL_H, mix(mix(ink, [0, 0, 0], 0.16), WHITE, w), { glow: w > 0 ? 16 : 0, alpha: game.paused ? 0.35 : 1 });
  }
}

function drawOverlay(g: CanvasRenderingContext2D, t: number) {
  const shade = (a: number) => { g.fillStyle = `rgba(7,8,10,${a})`; g.fillRect(240, 0, 480, 160); };
  if (game.phase === 'ready') {
    const title = g.createLinearGradient(330, 0, 630, 0);
    [300, 0, 45, 120, 180, 225].forEach((h, i) => title.addColorStop(i / 5, css(hsv(h, 0.72, 1))));
    g.font = `900 58px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.letterSpacing = '12px';
    g.fillStyle = title;
    g.fillText('BLOCKS', 486, 62);
    g.letterSpacing = '0px';
    text(g, 'Press Play, Space, or tap a pad', 480, 118, { size: 15, weight: 600, color: css([200, 208, 216], 0.6 + 0.4 * Math.sin(t * 3) ** 2) });
  } else if (game.phase === 'over') {
    shade(Math.min(0.72, (t - fx.overT) * 1.2));
    banner(g, 'GAME OVER', 56, 40, '#ffffff');
    banner(g, fx.newBest ? `New best: ${game.score.toLocaleString('en-US')}` : `${game.score.toLocaleString('en-US')} points  ·  level ${game.level}`, 96, 16, fx.newBest ? '#ffd166' : '#c8d0d8', 700, 0.5);
    if (t - fx.overT > 0.9) text(g, 'Play again: Play, Space, or tap a pad', 480, 128, { size: 13, weight: 600, color: css([154, 164, 176], 0.6 + 0.4 * Math.sin(t * 3) ** 2) });
  } else if (game.paused) {
    shade(0.6);
    banner(g, 'PAUSED', 66, 42, '#ffffff');
    text(g, 'Play or P to resume', 480, 108, { size: 14, weight: 600, color: '#9aa4b0' });
  } else if (game.phase === 'clearing' && fx.callout) {
    // large in the middle while the rows flash: the next piece is not there yet
    const k = game.clearT / CLEAR_TIME;
    g.save();
    g.globalAlpha = Math.min(1, k / 0.12) * Math.min(1, (1 - k) / 0.25);
    banner(g, fx.callout.title, 80, 44 + Math.max(0, 1 - k / 0.3) * 10, fx.callout.color, 900, 6);
    g.restore();
  }

  const musicNote = fx.musicT > fx.volumeT, noteT = Math.max(fx.musicT, fx.volumeT);
  if (t - noteT < 1.3) {
    const a = Math.min(1, (1.3 - (t - noteT)) / 0.3);
    g.save();
    g.globalAlpha = a;
    g.fillStyle = 'rgba(16,19,24,0.94)';
    roundRect(g, 390, 126, 180, 26, 13);
    g.fill();
    if (musicNote) text(g, musicOn() ? (soundOn() ? 'Music on' : 'Music on (sound is off)') : 'Music off', 480, 139.5, { size: 12, color: musicOn() ? '#e8edf2' : '#ffb199' });
    else if (soundOn()) {
      text(g, 'Volume', 404, 139.5, { size: 12, align: 'left', color: '#9aa4b0' });
      g.fillStyle = '#2a303a';
      roundRect(g, 456, 136, 100, 6, 3);
      g.fill();
      g.fillStyle = '#e8edf2';
      roundRect(g, 456, 136, Math.max(6, 100 * sfx.volume), 6, 3);
      g.fill();
    } else text(g, 'Sound off', 480, 139.5, { size: 12, color: '#ffb199' });
    g.restore();
  }
}

export const blocks: Demo = {
  id: 'blocks',
  name: 'Blocks',
  color: [176, 112, 255],
  fullBleed: true,

  // Keys work while the tab is open. Leaving the tab pauses the game.
  activate: () =>
    Effect.acquireRelease(
      Effect.sync(() => {
        addEventListener('keydown', onKeyDown);
        addEventListener('keyup', onKeyUp);
        addEventListener('blur', releaseKeys);
        for (const type of ['pointerdown', 'keydown'] as const) addEventListener(type, onGesture, { capture: true, passive: true });
      }),
      () =>
        Effect.sync(() => {
          removeEventListener('keydown', onKeyDown);
          removeEventListener('keyup', onKeyUp);
          removeEventListener('blur', releaseKeys);
          for (const type of ['pointerdown', 'keydown'] as const) removeEventListener(type, onGesture, { capture: true });
          setPaused(true, true);
          releaseKeys();
          updateMusic(false);
        }),
    ),

  onEvent(ev) {
    if (ev.type === 'pad') { if (ev.action === 'down') tap(ev.col, PAD_ROW0 + ev.rowFromTop); }
    else if (ev.type === 'button') onButton(ev);
    else if (ev.type === 'encoder') {
      // the jog wheel clicks once for each column; the tempo knob clicks once for each turn of the piece
      if (ev.id === 'jog') { for (let i = Math.abs(ev.delta); i > 0 && game.move(Math.sign(ev.delta)); i--); }
      else if (ev.id === 'tempo') game.rotate(ev.delta > 0 ? 1 : -1);
      else if (ev.id === 'volume') turnVolume(ev.delta);
    }
  },

  tick(t, dt, app) {
    fx.now = t;
    if (fx.das.dir && game.active) {
      fx.das.t += dt;
      while (fx.das.t >= DAS) {
        fx.das.t -= ARR;
        if (!game.move(fx.das.dir)) { fx.das.t = DAS; break; } // at a wall: stay ready
      }
    }
    game.update(dt);
    react(t);
    updateMusic();
    fx.shake *= Math.exp(-dt * 11);
    setScore(game.score);
    setLevel(game.level);
    setLines(game.lines);
    setStatus(game.phase === 'ready' || game.phase === 'over' ? game.phase : game.paused ? 'paused' : 'playing');
    compose(t);

    // the well: one row on the lower display buttons, eight on the pads
    for (let x = 0; x < COLS; x++) app.leds.button(20 + x, ledColor(BUTTON_ROW * COLS + x));
    for (let y = PAD_ROW0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const i = y * COLS + x;
        // the stack of a lost game breathes: an animation the Push runs by itself
        if (look.mode[i] === GONE) app.leds.pad(padNote(y - PAD_ROW0, x), DEAD, { ch: ANIM.pulseSlow, from: [20, 20, 20] });
        else app.leds.pad(padNote(y - PAD_ROW0, x), ledColor(i));
      }
    }

    // the scene buttons count the lines of this level, from the bottom up
    const hue = (150 + game.level * 45) % 360, done = game.lines % LINES_PER_LEVEL;
    const levelUp = t - fx.levelT < 0.6 && Math.floor((t - fx.levelT) * 10) % 2 === 0;
    for (let i = 0; i < 8; i++) app.leds.button(36 + i, game.phase === 'ready' ? null : levelUp ? WHITE : hsv(hue, 1, i < done ? 1 : 0.08));

    const live = game.active;
    for (const cc of [44, 45, 46, 47, 91]) app.leds.button(cc, live ? WHITE : [38, 38, 38]);
    app.leds.button(33, live && !game.holdUsed ? WHITE : [38, 38, 38]); // Swap
    app.leds.button(92, [77, 77, 77]); // New
    app.leds.button(60, soundOn() ? [38, 38, 38] : [255, 64, 0]); // Mute
    app.leds.button(9, musicOn() ? WHITE : [38, 38, 38]); // Metronome: the music
    if (status() === 'playing') app.leds.button(85, [0, 255, 0]);
    else app.leds.button(85, [0, 255, 0], { ch: status() === 'paused' ? ANIM.blinkSlow : ANIM.pulse, from: [0, 56, 0] });
  },

  draw(g, _app, t) {
    const back = g.createLinearGradient(0, 0, 0, 160);
    back.addColorStop(0, '#0d1016');
    back.addColorStop(1, '#07080a');
    g.fillStyle = back;
    g.fillRect(0, 0, 960, 160);

    g.save();
    if (fx.shake > 0.02) g.translate(0, Math.sin(t * 95) * fx.shake * 3.5);
    // empty cells, as unlit pads: the well goes on above the pad grid. The two columns at each
    // side are also cells of the well, but most of the time they are free, so the numbers go there.
    g.strokeStyle = 'rgba(255,255,255,0.05)';
    g.lineWidth = 1;
    for (let i = 0; i < DISPLAY_ROWS * COLS; i++) {
      if (i % COLS < 2 || i % COLS >= COLS - 2) continue;
      roundRect(g, (i % COLS) * CELL_W + 6.5, Math.floor(i / COLS) * CELL_H + 6.5, CELL_W - 13, CELL_H - 13, 11);
      g.stroke();
    }
    for (const x of [0, (COLS - 2) * CELL_W]) {
      g.fillStyle = 'rgba(255,255,255,0.018)';
      roundRect(g, x + 6.5, 6.5, 2 * CELL_W - 13, DISPLAY_ROWS * CELL_H - 13, 11);
      g.fill();
      g.stroke();
    }
    drawHud(g, t);
    drawCells(g);
    g.restore();

    // the stack is near the top: the display warns from below
    if (game.active && game.top() <= PAD_ROW0 + 1) {
      const warn = g.createLinearGradient(0, 96, 0, 160);
      warn.addColorStop(0, 'rgba(255,48,48,0)');
      warn.addColorStop(1, `rgba(255,48,48,${0.14 + 0.16 * Math.sin(t * 6) ** 2})`);
      g.fillStyle = warn;
      g.fillRect(0, 96, 960, 64);
    }
    drawOverlay(g, t);
  },

  Panel: () => (
    <>
      <h2>Blocks</h2>
      <p>
        A falling-block game. The well is as wide as the Push and runs down three parts of it: a piece comes in on the <b>display</b>, passes the{' '}
        <b>lower display buttons</b> and lands on the <b>pads</b>. Fill a row to clear it.
      </p>
      <div class="score-row">
        <div><b>{score().toLocaleString('en-US')}</b><span>score</span></div>
        <div><b>{best().toLocaleString('en-US')}</b><span>best</span></div>
        <div><b>{level()}</b><span>level</span></div>
        <div><b>{lines()}</b><span>lines</span></div>
      </div>
      <div class="row">
        <button class="primary" onClick={playPause}>{status() === 'playing' ? 'Pause' : status() === 'paused' ? 'Resume' : 'Play'}</button>
        <button onClick={newGame}>New game</button>
        <button onClick={toggleSound}>{soundOn() ? 'Sound on' : 'Sound off'}</button>
        <button onClick={toggleMusic}>{musicOn() ? 'Music on' : 'Music off'}</button>
      </div>
      <ul class="tips">
        <li><b>Keyboard:</b> <kbd>←</kbd> <kbd>→</kbd> move, <kbd>↓</kbd> faster, <kbd>↑</kbd> or <kbd>X</kbd> turn, <kbd>Z</kbd> turn back, <kbd>Space</kbd> drop, <kbd>C</kbd> hold, <kbd>P</kbd> pause, <kbd>N</kbd> new game, <kbd>M</kbd> sound, <kbd>B</kbd> music.</li>
        <li><b>Push arrows:</b> left and right move (hold to repeat), down is faster, up turns, the center drops.</li>
        <li><b>Push knobs:</b> the jog wheel moves, one click for each column. The tempo knob turns the piece both ways. The volume knob sets the volume.</li>
        <li><b>Push buttons:</b> Swap holds a piece for later, Play pauses, New starts again, Mute stops the sound, Metronome stops the music.</li>
        <li><b>Pads:</b> tap beside the piece and it goes to that column. Tap the piece to turn it. Tap below it to drop it.</li>
        <li>The dim cells show where the piece lands. The scene buttons count lines: eight make a level, and each level falls faster.</li>
      </ul>
    </>
  ),
};
