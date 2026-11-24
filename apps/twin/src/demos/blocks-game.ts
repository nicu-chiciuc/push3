// Blocks: the rules of a falling-block game, with no drawing and no input devices in it, so it
// runs (and is tested) outside a browser. The well is 8 wide, as the Push has 8 columns, and 11
// deep: 2 rows on the display, 1 on the lower display buttons, 8 on the pads.

export const COLS = 8;
export const ROWS = 11;
/** Cleared lines for each level. Eight, so the eight scene buttons can count them. */
export const LINES_PER_LEVEL = 8;
/** Seconds the full rows flash before the rows above come down. */
export const CLEAR_TIME = 0.34;

const LOCK_DELAY = 0.5;
/** Moves that may each put the lock off again, counted from the lowest row the piece has reached. */
const MAX_LOCK_RESETS = 12;
const SOFT_DROP_INTERVAL = 0.035;
const LINE_POINTS = [0, 100, 250, 450, 800];

export type Cell = readonly [x: number, y: number];
export type Phase = 'ready' | 'playing' | 'clearing' | 'over';
export interface Piece { kind: number; rot: number; x: number; y: number }

// Each piece in a square box, in its first rotation. The other three come from turning the box.
const BOXES: ReadonlyArray<{ readonly n: number; readonly cells: ReadonlyArray<Cell> }> = [
  { n: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] }, // bar
  { n: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] }, // square
  { n: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] }, // tee
  { n: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] }, // step up
  { n: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] }, // step down
  { n: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] }, // left hook
  { n: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] }, // right hook
];
export const KINDS = BOXES.length;
const BAR = 0, SQUARE = 1;

/** SHAPES[kind][rotation]: the four cells, relative to the corner of the piece's box. */
export const SHAPES: ReadonlyArray<ReadonlyArray<ReadonlyArray<Cell>>> = BOXES.map(({ n, cells }) => {
  const rots = [cells];
  for (let r = 1; r < 4; r++) rots.push(rots[r - 1]!.map(([x, y]): Cell => [n - 1 - y, x]));
  return rots;
});

// Where a turn may shift the piece when it does not fit in place: sideways from a wall or the
// stack, down from the ceiling, up from the floor (two cells for the bar).
const KICKS: ReadonlyArray<Cell> = [[0, 0], [-1, 0], [1, 0], [0, 1], [0, -1], [-2, 0], [2, 0], [0, -2]];

export type GameEvent =
  | { readonly type: 'start' }
  | { readonly type: 'move'; readonly x: number }
  | { readonly type: 'rotate' }
  | { readonly type: 'hold' }
  /** `dropped`: rows a hard drop fell through (0 when the piece locked by itself). */
  | { readonly type: 'lock'; readonly kind: number; readonly cells: ReadonlyArray<Cell>; readonly hard: boolean; readonly dropped: number }
  | { readonly type: 'clear'; readonly rows: ReadonlyArray<number>; readonly points: number; readonly combo: number; readonly sweep: boolean }
  | { readonly type: 'level'; readonly level: number }
  | { readonly type: 'over' };

/** Seconds for one row of fall at a level. */
export const fallInterval = (level: number) => Math.max(0.06, 0.8 * 0.85 ** (level - 1));

export class Game {
  /** Locked cells, row by row from the top: -1 is empty, else the kind of the piece it came from. */
  readonly well = new Int8Array(COLS * ROWS).fill(-1);
  phase: Phase = 'ready';
  paused = false;
  piece: Piece | null = null;
  hold: number | null = null;
  /** A piece may go to the hold once; the next one may again. */
  holdUsed = false;
  score = 0;
  lines = 0;
  level = 1;
  /** Pieces in a row that each cleared a line. */
  combo = 0;
  /** The full rows that flash now (phase 'clearing'), and for how long they have. */
  clearing: ReadonlyArray<number> = [];
  clearT = 0;
  softDrop = false;
  /** What happened since the view last looked. The view empties it. */
  events: Array<GameEvent> = [];

  private readonly rng: () => number;
  private queue: Array<number> = [];
  private fall = 0;
  private lockT = 0;
  private resets = 0;
  private lowest = 0;

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
  }

  /** True while a piece falls and takes input. */
  get active(): boolean { return this.phase === 'playing' && !this.paused && this.piece !== null; }

  at(x: number, y: number): number { return this.well[y * COLS + x]!; }

  cells(p: Piece): Array<Cell> {
    return SHAPES[p.kind]![p.rot]!.map(([cx, cy]): Cell => [p.x + cx, p.y + cy]);
  }

  /** The next `n` kinds, soonest first. */
  next(n: number): ReadonlyArray<number> {
    this.fill(n);
    return this.queue.slice(0, n);
  }

  /** The row the piece would land on if dropped now. */
  ghostY(): number {
    const p = this.piece;
    if (!p) return 0;
    let y = p.y;
    while (this.fits(p.kind, p.rot, p.x, y + 1)) y++;
    return y;
  }

  /** Highest row with a locked cell (ROWS when the well is empty). */
  top(): number {
    const i = this.well.findIndex((k) => k >= 0);
    return i < 0 ? ROWS : Math.floor(i / COLS);
  }

  start() {
    this.well.fill(-1);
    Object.assign(this, { phase: 'playing', paused: false, hold: null, holdUsed: false, score: 0, lines: 0, level: 1, combo: 0, clearing: [], clearT: 0, softDrop: false, queue: [] });
    this.events.push({ type: 'start' });
    this.spawn();
  }

  setPaused(on: boolean) {
    if (this.phase === 'playing' || this.phase === 'clearing') this.paused = on;
  }

  move(dx: number): boolean {
    const p = this.piece;
    if (!this.active || !p || !this.fits(p.kind, p.rot, p.x + dx, p.y)) return false;
    p.x += dx;
    this.shifted();
    this.events.push({ type: 'move', x: p.x });
    return true;
  }

  /** dir 1: clockwise, -1: the other way. */
  rotate(dir: 1 | -1): boolean {
    const p = this.piece;
    if (!this.active || !p || p.kind === SQUARE) return false;
    const rot = (p.rot + dir + 4) % 4;
    for (const [kx, ky] of KICKS) {
      if (Math.abs(kx) === 2 || ky === -2) { if (p.kind !== BAR) continue; }
      if (!this.fits(p.kind, rot, p.x + kx, p.y + ky)) continue;
      Object.assign(p, { rot, x: p.x + kx, y: p.y + ky });
      this.shifted();
      this.events.push({ type: 'rotate' });
      return true;
    }
    return false;
  }

  hardDrop() {
    const p = this.piece;
    if (!this.active || !p) return;
    const dropped = this.ghostY() - p.y;
    p.y += dropped;
    this.score += 2 * dropped;
    this.lock(true, dropped);
  }

  /** Put the piece aside and take the one that was there (or the next one). Once for each piece. */
  swapHold(): boolean {
    const p = this.piece;
    if (!this.active || !p || this.holdUsed) return false;
    const back = this.hold;
    this.hold = p.kind;
    this.events.push({ type: 'hold' });
    this.spawn(back ?? undefined);
    this.holdUsed = true;
    return true;
  }

  update(dt: number) {
    if (this.paused) return;
    if (this.phase === 'clearing') {
      this.clearT += dt;
      if (this.clearT < CLEAR_TIME) return;
      this.collapse();
      this.phase = 'playing';
      this.spawn();
      return;
    }
    const p = this.piece;
    if (this.phase !== 'playing' || !p) return;

    if (!this.fits(p.kind, p.rot, p.x, p.y + 1)) {
      // on the floor or the stack: it locks after a moment, unless a move puts that off
      this.fall = 0;
      this.lockT += dt;
      if (this.lockT >= LOCK_DELAY) this.lock(false, 0);
      return;
    }
    this.lockT = 0;
    const interval = this.softDrop ? Math.min(SOFT_DROP_INTERVAL, fallInterval(this.level)) : fallInterval(this.level);
    this.fall += dt;
    while (this.fall >= interval && this.fits(p.kind, p.rot, p.x, p.y + 1)) {
      this.fall -= interval;
      p.y++;
      if (this.softDrop) this.score++;
      if (p.y > this.lowest) { this.lowest = p.y; this.resets = 0; }
    }
  }

  private fits(kind: number, rot: number, x: number, y: number): boolean {
    for (const [cx, cy] of SHAPES[kind]![rot]!) {
      const px = x + cx, py = y + cy;
      if (px < 0 || px >= COLS || py < 0 || py >= ROWS || this.well[py * COLS + px]! >= 0) return false;
    }
    return true;
  }

  /** A move or turn on the ground puts the lock off, a limited number of times. */
  private shifted() {
    if (this.lockT > 0 && this.resets < MAX_LOCK_RESETS) { this.lockT = 0; this.resets++; }
  }

  /** Seven pieces in a random order, then the next seven: no kind stays away for long. */
  private fill(n: number) {
    while (this.queue.length < n) {
      const bag = Array.from({ length: KINDS }, (_, k) => k);
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [bag[i], bag[j]] = [bag[j]!, bag[i]!];
      }
      this.queue.push(...bag);
    }
  }

  private spawn(kind?: number) {
    this.fill(1);
    const k = kind ?? this.queue.shift()!;
    const x = (COLS - BOXES[k]!.n) >> 1, y = k === BAR ? -1 : 0; // its cells start in the top row
    this.holdUsed = false;
    Object.assign(this, { fall: 0, lockT: 0, resets: 0, lowest: y });
    if (!this.fits(k, 0, x, y)) {
      this.piece = null;
      this.phase = 'over';
      this.events.push({ type: 'over' });
      return;
    }
    this.piece = { kind: k, rot: 0, x, y };
  }

  private lock(hard: boolean, dropped: number) {
    const p = this.piece!;
    const cells = this.cells(p);
    for (const [x, y] of cells) this.well[y * COLS + x] = p.kind;
    this.piece = null;
    this.events.push({ type: 'lock', kind: p.kind, cells, hard, dropped });

    const rows: Array<number> = [];
    for (let y = 0; y < ROWS; y++) {
      let full = true;
      for (let x = 0; x < COLS; x++) if (this.well[y * COLS + x]! < 0) { full = false; break; }
      if (full) rows.push(y);
    }
    if (!rows.length) {
      this.combo = 0;
      this.spawn();
      return;
    }

    this.combo++;
    // a sweep: nothing is left in the well once these rows go
    const sweep = this.well.every((k, i) => k < 0 || rows.includes(Math.floor(i / COLS)));
    const points = (LINE_POINTS[rows.length]! + 50 * (this.combo - 1) + (sweep ? 1000 : 0)) * this.level;
    this.score += points;
    this.lines += rows.length;
    this.events.push({ type: 'clear', rows, points, combo: this.combo, sweep });
    const level = 1 + Math.floor(this.lines / LINES_PER_LEVEL);
    if (level > this.level) { this.level = level; this.events.push({ type: 'level', level }); }
    Object.assign(this, { phase: 'clearing', clearing: rows, clearT: 0 });
  }

  /** Take the full rows out and bring the rows above them down. */
  private collapse() {
    let to = ROWS - 1;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (this.clearing.includes(y)) continue;
      if (to !== y) this.well.copyWithin(to * COLS, y * COLS, (y + 1) * COLS);
      to--;
    }
    this.well.fill(-1, 0, (to + 1) * COLS);
    this.clearing = [];
  }
}
