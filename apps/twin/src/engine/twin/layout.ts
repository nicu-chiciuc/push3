// Where every control of the Push 3 sits, and what it looks like, in millimeters seen from above:
// x from the left edge, y from the back edge (toward the player). The MIDI side of each control
// is in @push3/protocol (controls.ts); this file only places them.
//
// Positions are traced from a straight top-down product photo (Thomann, 3000×2518), measured in
// pixels of a 1568 px wide copy and mapped onto the device outline (P.x0..P.x1, P.y0..P.y1).
import type { Legend } from './labels.ts';
import { inset, type KnobProfile, type Pt } from './shapes.ts';

// 380 × 318 mm (Thomann, Sound On Sound); the body is about 29 mm thick (44.5 mm with the knobs).
export const DEVICE = { w: 380, d: 318, h: 29, r: 4 } as const;

/** The device outline in the photo. */
const P = { x0: 45, x1: 1527, y0: 38, y1: 1272 } as const;
const mx = (px: number) => ((px - P.x0) / (P.x1 - P.x0)) * DEVICE.w;
const my = (py: number) => ((py - P.y0) / (P.y1 - P.y0)) * DEVICE.d;
const sx = (px: number) => (px / (P.x1 - P.x0)) * DEVICE.w;
const sy = (py: number) => (py / (P.y1 - P.y0)) * DEVICE.d;

/** Key caps rise this far above the top plate (mm). */
const KEY_HEIGHT = 1.3;
/** Groove between keys of one keypad (mm). */
const GROOVE = 0.9;

// ───────── pads ─────────
const PAD_COLS = [385, 497.5, 610.5, 724, 838, 951.5, 1065, 1178.5];
const PAD_ROWS = [592, 677, 762, 847, 932, 1017, 1102, 1187]; // top → bottom
export const PADS = {
  w: sx(104),
  h: sy(78),
  r: 1.6,
  height: 2.6,
  bed: { x: mx((332 + 1232) / 2), y: my((551 + 1229) / 2), w: sx(904), h: sy(680) },
} as const;
export const padCenter = (rowFromTop: number, col: number): readonly [number, number] => [mx(PAD_COLS[col]!), my(PAD_ROWS[rowFromTop]!)];

// ───────── display, touch strip ─────────
export const DISPLAY = {
  x: mx((328 + 1235) / 2), y: my((270 + 433) / 2), w: sx(907), h: sy(163),
  /** The 960×160 panel inside the glass (6:1). */
  screen: { w: sx(896), h: sx(896) / 6, dx: 0, dy: 0 },
} as const;

export const STRIP = {
  x: mx((213 + 292) / 2), y: my((552 + 1226) / 2), w: sx(79), h: sy(674),
  /** The LED column sits near the right edge of the strip. */
  ledDx: sx(26), ledInset: 6,
} as const;

// ───────── knobs ─────────
export interface KnobGeo { readonly id: string; readonly x: number; readonly y: number; readonly profile: KnobProfile }

const ENC_X = [376, 490, 604, 719, 835, 950, 1065, 1180];
export const KNOBS: ReadonlyArray<KnobGeo> = [
  ...ENC_X.map((x, i) => ({ id: `e${i + 1}`, x: mx(PAD_COLS[i]! * 0.5 + x * 0.5), y: my(117), profile: { r: 6.2, rBase: 6.4, h: 17, fillet: 1.4, dish: 0.15 } })),
  { id: 'volume', x: mx(117), y: my(352), profile: { r: 11.6, rBase: 11.8, h: 15, fillet: 1.8, dish: 0.2 } },
  { id: 'tempo', x: mx(118), y: my(588), profile: { r: 7.6, rBase: 7.8, h: 13, fillet: 1.5, dish: 0.15 } },
  { id: 'jog', x: mx(1426), y: my(355), profile: { r: 20, rBase: 20.2, h: 13, fillet: 1.6, dish: 0.3 } },
];

// ───────── keys ─────────
export interface KeyGeo {
  readonly id: string;
  /** Center (mm). */
  readonly cx: number;
  readonly cy: number;
  /** Rect size (mm), or the bounding box of `poly`. */
  readonly w: number;
  readonly h: number;
  /** Corner radius. */
  readonly r: number;
  readonly height: number;
  /** Outline relative to the center, in shape space (+y = toward the back). Rect if absent. */
  readonly poly?: ReadonlyArray<Pt>;
  readonly legend?: Legend;
  /** Where the legend texture goes, relative to the center (mm, y toward the player). */
  readonly legendBox: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** Light bar of a display button, relative to the center. */
  readonly bar?: { readonly w: number; readonly h: number; readonly y: number };
}

export interface PanelGeo {
  readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly r: number;
  /** Height of a rubber fill under the keys (mm), for keypads whose grooves should barely show. */
  readonly fill?: number;
}

const keys: Array<KeyGeo> = [];
const panels: Array<PanelGeo> = [];

type Cell = { id: string; legend?: Legend; bar?: number };

const rectKey = (cell: Cell, x0: number, y0: number, x1: number, y1: number, r = 1.1): KeyGeo => {
  const w = x1 - x0, h = y1 - y0;
  return {
    id: cell.id, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w, h, r, height: KEY_HEIGHT,
    ...(cell.legend ? { legend: cell.legend } : {}),
    legendBox: { x: 0, y: 0, w, h },
    ...(cell.bar !== undefined ? { bar: { w: w * 0.72, h: 0.9, y: cell.bar } } : {}),
  };
};

/**
 * A keypad: one rubber part in a cutout of the top plate, split into keys by grooves.
 * `cols`/`rows` are the relative sizes of the grid; each cell spans [c0, r0] to [c1, r1].
 */
function keypad(px0: number, py0: number, px1: number, py1: number, cols: ReadonlyArray<number>, rows: ReadonlyArray<number>, cells: ReadonlyArray<Cell & { at: readonly [number, number, number?, number?] }>, r = 1.6) {
  const x0 = mx(px0), y0 = my(py0), x1 = mx(px1), y1 = my(py1);
  panels.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, r });
  const edges = (sizes: ReadonlyArray<number>, a: number, b: number) => {
    const total = sizes.reduce((s, v) => s + v, 0);
    const out = [a];
    let acc = 0;
    for (const v of sizes) { acc += v; out.push(a + ((b - a) * acc) / total); }
    return out;
  };
  const xs = edges(cols, x0, x1), ys = edges(rows, y0, y1);
  for (const c of cells) {
    const [c0, r0, c1 = c0, r1 = r0] = c.at;
    const g = GROOVE / 2;
    const kx0 = xs[c0]! + (c0 === 0 ? 0 : g), kx1 = xs[c1 + 1]! - (c1 === cols.length - 1 ? 0 : g);
    const ky0 = ys[r0]! + (r0 === 0 ? 0 : g), ky1 = ys[r1 + 1]! - (r1 === rows.length - 1 ? 0 : g);
    keys.push(rectKey(c, kx0, ky0, kx1, ky1, c0 === 0 || r0 === 0 || c1 === cols.length - 1 || r1 === rows.length - 1 ? r * 0.85 : 0.6));
  }
}

/** The Octave/Page keypad: a square cut on both diagonals into four triangular keys. */
function diamondPad(px0: number, py0: number, px1: number, py1: number, cells: Record<'top' | 'right' | 'bottom' | 'left', Cell>) {
  const x0 = mx(px0), y0 = my(py0), x1 = mx(px1), y1 = my(py1);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hw = (x1 - x0) / 2, hh = (y1 - y0) / 2;
  panels.push({ x: cx, y: cy, w: x1 - x0, h: y1 - y0, r: 1.6 });
  // Shape space (+y toward the back), counter-clockwise: two outer corners and the center.
  const TL: Pt = [-hw, hh], TR: Pt = [hw, hh], BR: Pt = [hw, -hh], BL: Pt = [-hw, -hh], C: Pt = [0, 0];
  const tris = { top: [TR, TL, C], left: [TL, BL, C], bottom: [BL, BR, C], right: [BR, TR, C] } as const;
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const cell = cells[side];
    const vertical = side === 'top' || side === 'bottom';
    // The legend sits in the wide part of the triangle, near its outer edge (y toward the player).
    const legendBox = {
      x: side === 'left' ? -hw * 0.52 : side === 'right' ? hw * 0.52 : 0,
      y: side === 'top' ? -hh * 0.5 : side === 'bottom' ? hh * 0.5 : 0,
      w: vertical ? hw * 1.2 : hw * 0.9,
      h: vertical ? hh * 0.66 : hh * 0.5,
    };
    keys.push({
      id: cell.id, cx, cy, w: hw * 2, h: hh * 2, r: 0.9, height: KEY_HEIGHT, poly: inset(tris[side], GROOVE / 2),
      ...(cell.legend ? { legend: cell.legend } : {}),
      legendBox,
    });
  }
}

/** The navigation keypad: four arrow keys in a ring around a square center key. */
function navPad(px0: number, py0: number, px1: number, py1: number, inner: number, cells: Record<'up' | 'right' | 'down' | 'left' | 'center', Cell>) {
  const x0 = mx(px0), y0 = my(py0), x1 = mx(px1), y1 = my(py1);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hw = (x1 - x0) / 2, hh = (y1 - y0) / 2, iw = hw * inner, ih = hh * inner;
  panels.push({ x: cx, y: cy, w: x1 - x0, h: y1 - y0, r: 1.6 });
  // Shape space (+y toward the back), counter-clockwise. The arrow keys meet on the diagonals with
  // hairline grooves (they read as one surface); the center key has a full groove around it.
  const o = { tl: [-hw, hh], tr: [hw, hh], br: [hw, -hh], bl: [-hw, -hh] } as const satisfies Record<string, Pt>;
  const i = { tl: [-iw, ih], tr: [iw, ih], br: [iw, -ih], bl: [-iw, -ih] } as const satisfies Record<string, Pt>;
  panels[panels.length - 1] = { ...panels[panels.length - 1]!, fill: KEY_HEIGHT - 0.25 };
  const ring = { up: [o.tr, o.tl, i.tl, i.tr], left: [o.tl, o.bl, i.bl, i.tl], down: [o.bl, o.br, i.br, i.bl], right: [o.br, o.tr, i.tr, i.br] } as const;
  for (const side of ['up', 'right', 'down', 'left'] as const) {
    const cell = cells[side];
    const mid = (hh + ih) / 2, midX = (hw + iw) / 2;
    keys.push({
      id: cell.id, cx, cy, w: hw * 2, h: hh * 2, r: 0.8, height: KEY_HEIGHT, poly: inset(ring[side], 0.3),
      ...(cell.legend ? { legend: cell.legend } : {}),
      legendBox: side === 'up' || side === 'down'
        ? { x: 0, y: side === 'up' ? -mid : mid, w: iw * 2, h: hh - ih }
        : { x: side === 'left' ? -midX : midX, y: 0, w: hw - iw, h: ih * 2 },
    });
  }
  const c = cells.center, g = GROOVE * 0.8;
  keys.push({
    id: c.id, cx, cy, w: (iw - g) * 2, h: (ih - g) * 2, r: 0.8, height: KEY_HEIGHT,
    ...(c.legend ? { legend: c.legend } : {}),
    legendBox: { x: 0, y: 0, w: (iw - g) * 2, h: (ih - g) * 2 },
  });
}

/** A single key with its own cutout. */
function single(cell: Cell, px0: number, py0: number, px1: number, py1: number) {
  keypad(px0, py0, px1, py1, [1], [1], [{ ...cell, at: [0, 0] }], 1.4);
}

const icon = (i: Legend['icon'], iconSize = 3.6): Legend => ({ icon: i, iconSize });
const tl = (text: string, size = 2.05): Legend => ({ text, align: 'topLeft', size });
const center = (text: string, size = 2.1): Legend => ({ text, size });

// top row: Sets · Setup · Learn · User, and Device · Mix · Clip · Browse
keypad(70, 178, 290, 228, [1, 1, 1, 1], [1], [
  { id: 'sets', legend: icon('page'), at: [0, 0] }, { id: 'setup', legend: icon('gear'), at: [1, 0] },
  { id: 'learn', legend: icon('bulb'), at: [2, 0] }, { id: 'user', legend: icon('user'), at: [3, 0] },
]);
keypad(1272, 180, 1491, 230, [1, 1, 1, 1], [1], [
  { id: 'device', legend: icon('device'), at: [0, 0] }, { id: 'mix', legend: icon('mix'), at: [1, 0] },
  { id: 'clip', legend: icon('clip', 4.2), at: [2, 0] }, { id: 'browse', legend: icon('browse'), at: [3, 0] },
]);

// display buttons: each its own key with a light bar
PAD_COLS.forEach((x, i) => {
  // the light bar sits toward the display: lower half of the upper keys, upper half of the lower keys
  single({ id: `upper${i + 1}`, bar: sy(8) }, x - 50, 180, x + 50, 228);
  single({ id: `lower${i + 1}`, bar: -sy(10) }, x - 50, 474, x + 50, 522);
});

// beside the display
single({ id: 'undo', legend: center('Undo') }, 242, 270, 290, 318);
single({ id: 'save', legend: center('Save') }, 242, 384, 290, 432);
single({ id: 'add', legend: icon('plus', 3.4) }, 1272, 271, 1320, 319);
single({ id: 'swap', legend: icon('swap', 3.6) }, 1272, 385, 1320, 433);

// Lock · Stop Clip · Mute · Solo, and Master
keypad(70, 474, 290, 524, [1, 1, 1, 1], [1], [
  { id: 'lock', legend: icon('lock', 3.0), at: [0, 0] }, { id: 'stop', legend: icon('square', 2.6), at: [1, 0] },
  { id: 'mute', legend: center('M', 2.3), at: [2, 0] }, { id: 'solo', legend: center('S', 2.3), at: [3, 0] },
]);
single({ id: 'master', legend: icon('bar', 4.4) }, 1272, 474, 1320, 522);

// left column
keypad(72, 640, 178, 798, [1], [0.44, 0.27, 0.29], [
  { id: 'tapTempo', legend: tl('Tap\nTempo'), at: [0, 0] },
  { id: 'metronome', legend: { icon: 'metronome', iconSize: 3.4, align: 'left' }, at: [0, 1] },
  { id: 'quantize', legend: { text: 'Quantize', align: 'left', size: 2.05 }, at: [0, 2] },
]);
keypad(72, 848, 178, 932, [1], [1, 1], [
  { id: 'fixedLength', legend: { text: 'Fixed Length', align: 'left', size: 2.05 }, at: [0, 0] },
  { id: 'automate', legend: { text: 'Automate', align: 'left', size: 2.05 }, at: [0, 1] },
]);
keypad(72, 980, 178, 1138, [1], [0.3, 0.33, 0.37], [
  { id: 'new', legend: { text: 'New', align: 'left', size: 2.05 }, at: [0, 0] },
  { id: 'capture', legend: { icon: 'capture', iconSize: 3.8, align: 'left' }, at: [0, 1] },
  { id: 'record', legend: { icon: 'record', iconSize: 4.4, align: 'left' }, at: [0, 2] },
]);
single({ id: 'play', legend: { icon: 'play', iconSize: 4.8, align: 'left' } }, 72, 1150, 180, 1225);

// scene / note-repeat column, one key per pad row
['1/32t', '1/32', '1/16t', '1/16', '1/8t', '1/8', '1/4t', '1/4'].forEach((t, i) => {
  const y = PAD_ROWS[i]!;
  single({ id: `scene${i + 1}`, legend: { text: t, icon: 'play', iconSize: 2.2, align: 'topLeft', size: 1.7, stack: true } }, 1272, y - 40, 1320, y + 40);
});

// right column
navPad(1347, 478, 1498, 628, 0.36, {
  up: { id: 'up', legend: icon('up', 3.2) },
  left: { id: 'left', legend: icon('left', 3.2) },
  center: { id: 'center', legend: icon('dot', 2.6) },
  right: { id: 'right', legend: icon('right', 3.2) },
  down: { id: 'down', legend: icon('down', 3.2) },
});
keypad(1347, 642, 1498, 765, [1, 1], [1, 1], [
  { id: 'note', legend: { icon: 'grid', iconSize: 4.4, align: 'left' }, at: [0, 0] },
  { id: 'session', legend: { icon: 'bars', iconSize: 4.4, align: 'left' }, at: [1, 0] },
  { id: 'scale', legend: { text: 'Scale', align: 'left', size: 2.05 }, at: [0, 1] },
  { id: 'layout', legend: { text: 'Layout', align: 'left', size: 2.05 }, at: [1, 1] },
]);
keypad(1347, 812, 1498, 882, [1, 1], [1], [
  { id: 'repeat', legend: tl('Repeat'), at: [0, 0] }, { id: 'accent', legend: tl('Accent'), at: [1, 0] },
]);
keypad(1347, 897, 1498, 1010, [1, 1], [1.1, 0.9], [
  { id: 'doubleLoop', legend: tl('Double\nLoop'), at: [0, 0] }, { id: 'duplicate', legend: tl('Duplicate'), at: [1, 0] },
  { id: 'convert', legend: tl('Convert'), at: [0, 1] }, { id: 'delete', legend: tl('Delete'), at: [1, 1] },
]);
diamondPad(1347, 1025, 1498, 1175, {
  top: { id: 'octaveUp', legend: { text: 'Octave', icon: 'up', iconSize: 2.8, size: 2.05, stack: true } },
  bottom: { id: 'octaveDown', legend: { text: 'Octave', icon: 'down', iconSize: 2.8, size: 2.05, stack: true, iconFirst: true } },
  left: { id: 'pageLeft', legend: { text: 'Page', icon: 'left', iconSize: 2.6, size: 1.8 } },
  right: { id: 'pageRight', legend: { text: 'Page', icon: 'right', iconSize: 2.6, size: 1.8, iconFirst: true } },
});
keypad(1347, 1188, 1498, 1222, [1, 1], [1], [
  { id: 'shift', legend: center('Shift'), at: [0, 0] }, { id: 'select', legend: center('Select'), at: [1, 0] },
]);

export const KEYS: ReadonlyArray<KeyGeo> = keys;
export const PANELS: ReadonlyArray<PanelGeo> = panels;
