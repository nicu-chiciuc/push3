// Where every control of the Push 3 sits, and what it looks like, in millimeters seen from above:
// x from the left edge, y from the back edge (toward the player). The MIDI side of each control
// is in @push3/protocol (controls.ts); this file only places them.
//
// Positions are traced from a straight top-down product photo (Thomann, 3000×2518), measured in
// pixels of a 1568 px wide copy (or of the full 3000 px photo, through X/Y below) and mapped onto
// the device outline (P.x0..P.x1, P.y0..P.y1). The fit was checked by rendering the twin with the
// photo's own camera and drawing its edges over the photo.
import type { Icon, LegendPart } from './labels.ts';
import type { KnobProfile, Pt } from './shapes.ts';

// 380 × 318 mm (Thomann, Sound On Sound). Heights are measured on an eye-level photo of the rear
// (press-rear-panel.jpg, 0.178 mm/px): the body is 23.3 mm, a 21.5 mm block with a softly rounded
// top edge on a 1.8 mm base plate that is inset 2 mm. Plan-view corners are rounded by about 2 mm.
export const DEVICE = { w: 380, d: 318, h: 23.3, r: 2.2, edge: 1.2, base: { h: 1.8, inset: 2 } } as const;

/** The device outline in the photo. */
const P = { x0: 45, x1: 1527, y0: 38, y1: 1272 } as const;
const mx = (px: number) => ((px - P.x0) / (P.x1 - P.x0)) * DEVICE.w;
const my = (py: number) => ((py - P.y0) / (P.y1 - P.y0)) * DEVICE.d;
const sx = (px: number) => (px / (P.x1 - P.x0)) * DEVICE.w;
const sy = (py: number) => (py / (P.y1 - P.y0)) * DEVICE.d;

/** Full-size photo (3000 px wide) → the same mapping. */
const K = 3000 / 1568;
const X = (px3: number) => mx(px3 / K);
const Y = (py3: number) => my(py3 / K);

/** Keypads rise this far above the top plate (mm): they are nearly flush in low-angle photos. */
export const KEY_HEIGHT = 0.5;

// ───────── pads ─────────
const PAD_COLS = [385, 497.5, 610.5, 724, 838, 951.5, 1065, 1178.5];
const PAD_ROWS = [592, 677, 762, 847, 932, 1017, 1102, 1187]; // top → bottom
export const PADS = {
  w: sx(104),
  h: sy(78),
  r: 1.6,
  /** Pads stand about 1.6 mm above the bed, with soft rounded top edges. */
  height: 1.6,
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

// Knob positions come from the centers of their tops in the top-down photo, corrected for its
// perspective: the camera was about 1190 mm above the device (the encoder tops, 15.7 mm up, show
// 1.3% wider apart than the pad columns they line up with), so a top at height h appears pushed
// away from the photo's center by h / 1190. Heights: rear photo (encoders; volume and jog scaled by
// their own widths there) and the low front photo (tempo, from its outline's height/width ratio,
// calibrated on an encoder). Volume and jog diameters agree between the top and the rear photos
// to within about 1 mm once the rear photo's camera is fitted with them.
const CAMERA_HEIGHT = 1190;
const IMG_CENTER = { x: (P.x0 + P.x1) / 2, y: (P.y0 + P.y1) / 2 };
const unproject = (px: number, py: number, h: number) =>
  [px - (px - IMG_CENTER.x) * (h / CAMERA_HEIGHT), py - (py - IMG_CENTER.y) * (h / CAMERA_HEIGHT)] as const;
const knobAt = (id: string, px: number, py: number, profile: KnobProfile): KnobGeo => {
  const [x, y] = unproject(px, py, profile.h);
  return { id, x: mx(x), y: my(y), profile };
};
export const KNOBS: ReadonlyArray<KnobGeo> = [
  // the 8 encoders sit exactly over the display-button columns
  ...PAD_COLS.map((x, i) => ({ ...knobAt(`e${i + 1}`, x, 117.1, { r: 5.78, h: 15.7, fillet: 0.6 }), x: mx(x) })),
  knobAt('volume', 111.6, 352.3, { r: 12.4, rBase: 12.8, h: 11.0, fillet: 0.8 }),
  knobAt('tempo', 116.6, 588.5, { r: 7.63, h: 10.8, fillet: 0.7 }),
  knobAt('jog', 1426.3, 354.9, { r: 20.1, h: 11.1, fillet: 0.6 }),
];

// ───────── keys ─────────
// Each keypad is one molded rubber part in a cutout of the top plate. Its keys are split by short
// grooves that stop about 2.5 mm before the edge and before each other, so the part reads as one
// piece. Legends are placed where they are printed (absolute mm), not relative to the key.
export interface KeyGeo {
  readonly id: string;
  /** Bounding box center and size (mm). */
  readonly cx: number;
  readonly cy: number;
  readonly w: number;
  readonly h: number;
  /** Outline relative to the center, in shape space (+y = toward the back). Rect if absent. */
  readonly poly?: ReadonlyArray<Pt>;
  readonly legends: ReadonlyArray<LegendPart>;
  /** Light bar of a display button, relative to the center (y toward the player). */
  readonly bar?: { readonly w: number; readonly h: number; readonly y: number };
}
export interface PanelGeo { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly r: number }
export interface GrooveGeo { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }

const keys: Array<KeyGeo> = [];
const panels: Array<PanelGeo> = [];
const grooves: Array<GrooveGeo> = [];
const STOP = 2.5;

// legend parts, from pixel positions in the 3000 px photo
const T = (text: string, px: number, py: number, size = 2.25, pitch?: number): LegendPart => ({ text, x: X(px), y: Y(py), anchor: 'tl', size, ...(pitch ? { pitch } : {}) });
const C = (text: string, px: number, py: number, size = 2.4): LegendPart => ({ text, x: X(px), y: Y(py), anchor: 'c', size });
const I = (icon: Icon, px: number, py: number, w: number, h = w): LegendPart => ({ icon, x: X(px), y: Y(py), w, h });

type Cell = { id: string; at: readonly [number, number]; legends?: ReadonlyArray<LegendPart>; bar?: number };

/** A keypad from its outline and the positions of its splits (all in 3000 px photo coordinates). */
function keypad(px0: number, py0: number, px1: number, py1: number, xSplits: ReadonlyArray<number>, ySplits: ReadonlyArray<number>, cells: ReadonlyArray<Cell>, r = 1.6) {
  const xs = [px0, ...xSplits, px1].map(X), ys = [py0, ...ySplits, py1].map(Y);
  panels.push({ x: (xs[0]! + xs.at(-1)!) / 2, y: (ys[0]! + ys.at(-1)!) / 2, w: xs.at(-1)! - xs[0]!, h: ys.at(-1)! - ys[0]!, r });
  const at = new Map(cells.map((c) => [`${c.at[0]},${c.at[1]}`, c]));
  for (const c of cells) {
    const [col, row] = c.at;
    const x0 = xs[col]!, x1 = xs[col + 1]!, y0 = ys[row]!, y1 = ys[row + 1]!;
    keys.push({
      id: c.id, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, legends: c.legends ?? [],
      ...(c.bar !== undefined ? { bar: { w: (x1 - x0) * 0.85, h: 1.1, y: c.bar } } : {}),
    });
    // grooves to the right and below, where another key continues
    if (at.has(`${col + 1},${row}`)) grooves.push({ x0: x1, y0: y0 + STOP, x1, y1: y1 - STOP });
    if (at.has(`${col},${row + 1}`)) grooves.push({ x0: x0 + STOP, y0: y1, x1: x1 - STOP, y1 });
  }
}

/** A key with a cutout of its own (3000 px photo coordinates). */
function single(cell: Omit<Cell, 'at'>, px0: number, py0: number, px1: number, py1: number, r = 1.4) {
  keypad(px0, py0, px1, py1, [], [], [{ ...cell, at: [0, 0] }], r);
}

/** The Octave/Page keypad: a square cut on both diagonals into four triangular keys. */
function diamondPad(px0: number, py0: number, px1: number, py1: number, cells: Record<'top' | 'right' | 'bottom' | 'left', Omit<Cell, 'at'>>) {
  const x0 = X(px0), y0 = Y(py0), x1 = X(px1), y1 = Y(py1);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hw = (x1 - x0) / 2, hh = (y1 - y0) / 2;
  panels.push({ x: cx, y: cy, w: x1 - x0, h: y1 - y0, r: 1.6 });
  // shape space (+y toward the back), counter-clockwise: two outer corners and the center
  const TL: Pt = [-hw, hh], TR: Pt = [hw, hh], BR: Pt = [hw, -hh], BL: Pt = [-hw, -hh], O: Pt = [0, 0];
  const tris = { top: [TR, TL, O], left: [TL, BL, O], bottom: [BL, BR, O], right: [BR, TR, O] } as const;
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    keys.push({ id: cells[side].id, cx, cy, w: hw * 2, h: hh * 2, poly: tris[side], legends: cells[side].legends ?? [] });
  }
  // the diagonal grooves start 2.6 mm in from each corner and stop 3.5 mm short of the center
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const len = Math.hypot(hw, hh), ux = (-sx * hw) / len, uy = (-sy * hh) / len;
    const ax = cx + sx * hw, ay = cy + sy * hh;
    grooves.push({ x0: ax + ux * 2.6, y0: ay + uy * 2.6, x1: cx - ux * 3.5, y1: cy - uy * 3.5 });
  }
}

/** The arrow keypad: four arrow keys around a square center key, which alone has a groove around it. */
function navPad(px0: number, py0: number, px1: number, py1: number, center: readonly [number, number, number, number], cells: Record<'up' | 'right' | 'down' | 'left' | 'center', Omit<Cell, 'at'>>) {
  const x0 = X(px0), y0 = Y(py0), x1 = X(px1), y1 = Y(py1);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hw = (x1 - x0) / 2, hh = (y1 - y0) / 2;
  panels.push({ x: cx, y: cy, w: x1 - x0, h: y1 - y0, r: 1.6 });
  const [ix0, iy0, ix1, iy1] = [X(center[0]), Y(center[1]), X(center[2]), Y(center[3])];
  const icx = (ix0 + ix1) / 2, icy = (iy0 + iy1) / 2, iw = (ix1 - ix0) / 2, ih = (iy1 - iy0) / 2;
  // shape space relative to the panel center, +y toward the back
  const dx = icx - cx, dy = -(icy - cy);
  const o = { tl: [-hw, hh], tr: [hw, hh], br: [hw, -hh], bl: [-hw, -hh] } as const satisfies Record<string, Pt>;
  const i = { tl: [dx - iw, dy + ih], tr: [dx + iw, dy + ih], br: [dx + iw, dy - ih], bl: [dx - iw, dy - ih] } as const satisfies Record<string, Pt>;
  const ring = { up: [o.tr, o.tl, i.tl, i.tr], left: [o.tl, o.bl, i.bl, i.tl], down: [o.bl, o.br, i.br, i.bl], right: [o.br, o.tr, i.tr, i.br] } as const;
  for (const side of ['up', 'right', 'down', 'left'] as const) keys.push({ id: cells[side].id, cx, cy, w: hw * 2, h: hh * 2, poly: ring[side], legends: cells[side].legends ?? [] });
  keys.push({ id: cells.center.id, cx: icx, cy: icy, w: iw * 2, h: ih * 2, legends: cells.center.legends ?? [] });
  grooves.push({ x0: ix0, y0: iy0, x1: ix1, y1: iy0 }, { x0: ix1, y0: iy0, x1: ix1, y1: iy1 }, { x0: ix1, y0: iy1, x1: ix0, y1: iy1 }, { x0: ix0, y0: iy1, x1: ix0, y1: iy0 });
}

// top row: Sets · Setup · Learn · User, and Device · Mix · Clip · Browse (icons centered in their keys)
keypad(131, 340, 556, 435, [244.5, 346, 453.5], [], [
  { id: 'sets', at: [0, 0], legends: [I('page', 190, 390.5, 3.3, 4.4)] },
  { id: 'setup', at: [1, 0], legends: [I('gear', 296, 390, 4.7, 4.6)] },
  { id: 'learn', at: [2, 0], legends: [I('bulb', 401, 390.5, 3.1, 5.0)] },
  { id: 'user', at: [3, 0], legends: [I('user', 506.5, 390, 3.2, 4.6)] },
]);
keypad(2434, 342, 2855, 438, [2541, 2646, 2753.5], [], [
  { id: 'device', at: [0, 0], legends: [I('device', 2484, 393.5, 4.9, 4.7)] },
  { id: 'mix', at: [1, 0], legends: [I('mix', 2591.8, 393.5, 5.0, 4.7)] },
  { id: 'clip', at: [2, 0], legends: [I('clip', 2697, 390, 4.9, 3.2)] },
  { id: 'browse', at: [3, 0], legends: [I('browse', 2805.5, 390.5, 4.6, 4.8)] },
]);

// display buttons: each its own key; the light bar sits toward the display
PAD_COLS.forEach((x, i) => {
  const px = x * K;
  single({ id: `upper${i + 1}`, bar: 1.7 }, px - 96, 344, px + 96, 436);
  single({ id: `lower${i + 1}`, bar: -2.1 }, px - 96, 907, px + 96, 999);
});

// beside the display
single({ id: 'undo', legends: [C('Undo', 505, 562.5, 2.5)] }, 463, 517, 555, 608);
single({ id: 'save', legends: [C('Save', 503.8, 782.5, 2.5)] }, 463, 735, 555, 827);
single({ id: 'add', legends: [I('plus', 2480, 564, 4.0)] }, 2434, 518, 2526, 610);
single({ id: 'swap', legends: [I('swap', 2480, 782.5, 5.0)] }, 2434, 737, 2526, 828);

// Lock · Stop Clip · Mute · Solo, and Master
keypad(131, 907, 556, 1003, [246, 348.5, 453.5], [], [
  { id: 'lock', at: [0, 0], legends: [I('lock', 187.5, 954, 2.8, 4.0)] },
  { id: 'stop', at: [1, 0], legends: [I('square', 295, 956, 3.0, 2.8)] },
  { id: 'mute', at: [2, 0], legends: [C('M', 398.8, 956, 2.6)] },
  { id: 'solo', at: [3, 0], legends: [C('S', 504.5, 956, 2.6)] },
]);
single({ id: 'master', legends: [I('bar', 2480, 953, 6.5, 1.0)] }, 2434, 907, 2526, 999);

// left column
keypad(141, 1223, 340, 1530, [], [1364, 1453], [
  { id: 'tapTempo', at: [0, 0], legends: [T('Tap\nTempo', 156, 1243, 2.15, 4.25)] },
  { id: 'metronome', at: [0, 1], legends: [I('metronome', 178, 1399, 5.9, 2.9)] },
  { id: 'quantize', at: [0, 2], legends: [T('Quantize', 158.3, 1476.7, 2.15)] },
]);
keypad(141, 1622, 340, 1783, [], [1706], [
  { id: 'fixedLength', at: [0, 0], legends: [T('Fixed Length', 164, 1652, 2.15)] },
  { id: 'automate', at: [0, 1], legends: [T('Automate', 164, 1738, 2.15)] },
]);
keypad(141, 1879, 340, 2182, [], [1960.5, 2048.6], [
  { id: 'new', at: [0, 0], legends: [T('New', 162.8, 1904, 2.3)] },
  { id: 'capture', at: [0, 1], legends: [I('capture', 185.5, 2001.5, 5.2, 5.2)] },
  { id: 'record', at: [0, 2], legends: [I('record', 186.6, 2108.6, 5.6)] },
]);
single({ id: 'play', legends: [I('play', 185.7, 2272.5, 5.7, 6.0)] }, 141, 2200, 344, 2344);

// scene / note-repeat keys: one per pad row, 18.5 mm tall with 3.4 mm between them
['1/32t', '1/32', '1/16t', '1/16', '1/8t', '1/8', '1/4t', '1/4'].forEach((t, i) => {
  const cy = my(PAD_ROWS[i]!), x0 = X(2433), x1 = X(2526), y0 = cy - 9.25;
  keys.push({
    id: `scene${i + 1}`, cx: (x0 + x1) / 2, cy, w: x1 - x0, h: 18.5,
    legends: [
      { text: t, x: x0 + 3.35, y: y0 + 2.5, anchor: 'tl', size: 2.3 },
      { icon: 'play', x: x0 + 4.55, y: y0 + 9.6, w: 2.1, h: 3.0 },
    ],
  });
  panels.push({ x: (x0 + x1) / 2, y: cy, w: x1 - x0, h: 18.5, r: 1.4 });
});

// right column
navPad(2577, 912, 2865, 1209, [2668.8, 1010.4, 2768.4, 1108.8], {
  up: { id: 'up', legends: [I('up', 2719, 955, 4.0, 2.4)] },
  left: { id: 'left', legends: [I('left', 2612.5, 1059.7, 2.7, 4.0)] },
  center: { id: 'center', legends: [I('dot', 2719.8, 1058.6, 1.0)] },
  right: { id: 'right', legends: [I('right', 2826.7, 1059.7, 2.7, 4.0)] },
  down: { id: 'down', legends: [I('down', 2719, 1162, 4.0, 2.4)] },
});
keypad(2577, 1228, 2865, 1463, [2722], [1380], [
  { id: 'note', at: [0, 0], legends: [I('grid', 2623.8, 1267.8, 5.9, 5.4)] },
  { id: 'session', at: [1, 0], legends: [I('bars', 2773.6, 1267, 5.6, 5.1)] },
  { id: 'scale', at: [0, 1], legends: [T('Scale', 2603, 1408.8, 2.35)] },
  { id: 'layout', at: [1, 1], legends: [T('Layout', 2754.7, 1407, 2.35)] },
]);
keypad(2577, 1555, 2865, 1690, [2722], [], [
  { id: 'repeat', at: [0, 0], legends: [T('Repeat', 2598.3, 1576, 2.3)] },
  { id: 'accent', at: [1, 0], legends: [T('Accent', 2746.7, 1576, 2.3)] },
]);
keypad(2577, 1716, 2865, 1932, [2722], [1826], [
  { id: 'doubleLoop', at: [0, 0], legends: [T('Double\nLoop', 2594.5, 1740, 2.4, 4.3)] },
  { id: 'duplicate', at: [1, 0], legends: [T('Duplicate', 2741, 1739, 2.4)] },
  { id: 'convert', at: [0, 1], legends: [T('Convert', 2591.7, 1860, 2.4)] },
  { id: 'delete', at: [1, 1], legends: [T('Delete', 2740.3, 1860, 2.4)] },
]);
diamondPad(2577, 1960, 2865, 2245, {
  top: { id: 'octaveUp', legends: [C('Octave', 2717, 2003.5, 2.3), I('up', 2716.5, 2043.5, 4.2, 2.3)] },
  bottom: { id: 'octaveDown', legends: [I('down', 2716.5, 2158.5, 4.2, 2.3), C('Octave', 2717, 2198.5, 2.3)] },
  left: { id: 'pageLeft', legends: [C('Page', 2615, 2103.5, 1.85), I('thinLeft', 2659.2, 2103.5, 2.0, 4.0)] },
  right: { id: 'pageRight', legends: [I('thinRight', 2773.4, 2103.5, 2.0, 4.0), C('Page', 2818, 2103.5, 1.85)] },
});
keypad(2577, 2273, 2865, 2338, [2722], [], [
  { id: 'shift', at: [0, 0], legends: [C('Shift', 2641, 2297, 2.5)] },
  { id: 'select', at: [1, 0], legends: [C('Select', 2790, 2297, 2.5)] },
]);

export const KEYS: ReadonlyArray<KeyGeo> = keys;
export const PANELS: ReadonlyArray<PanelGeo> = panels;
export const GROOVES: ReadonlyArray<GrooveGeo> = grooves;
