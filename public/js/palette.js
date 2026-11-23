// Push LEDs show one of 128 palette entries. We overwrite the palette with a known
// set of colors so the web app always knows exactly what the hardware shows, and
// map any requested RGB to the nearest entry.
import { CMD } from './protocol.js';

export function hsv(h, s, v) {
  h = (((h % 360) + 360) % 360) / 60;
  const c = v * s, x = c * (1 - Math.abs((h % 2) - 1)), m = v - c;
  const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export const scale = ([r, g, b], k) => [Math.min(255, r * k) | 0, Math.min(255, g * k) | 0, Math.min(255, b * k) | 0];
export const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
export const css = ([r, g, b], a = 1) => (a === 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`);

// 0 = off · 1–96: 24 hues × 4 brightness levels · 97–120: 24 pastel hues · 121–127: white ramp
export const PALETTE = (() => {
  const p = [[0, 0, 0, 0]];
  const levels = [1, 0.5, 0.22, 0.08];
  for (const v of levels) for (let i = 0; i < 24; i++) p.push([...hsv(i * 15, 1, v), Math.round(v * 255)]);
  for (let i = 0; i < 24; i++) p.push([...hsv(i * 15, 0.45, 1), 255]);
  for (const v of [0.04, 0.08, 0.15, 0.3, 0.5, 0.75, 1]) {
    const g = Math.round(v * 255);
    p.push([g, g, g, g]);
  }
  return p;
})();

export const paletteMessages = () => [
  ...PALETTE.map(([r, g, b, w], i) => CMD.paletteEntry(i, r, g, b, w)),
  CMD.reapplyPalette(),
];

const cache = new Map();
/** Nearest palette index for an [r,g,b] color (perceptual "redmean" distance). */
export function nearest(rgb) {
  if (!rgb) return 0;
  const [r, g, b] = rgb;
  if (r + g + b < 6) return 0;
  const key = (r << 16) | (g << 8) | b;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let best = 0, bestD = Infinity;
  for (let i = 1; i < PALETTE.length; i++) {
    const [pr, pg, pb] = PALETTE[i];
    const rm = (r + pr) / 2, dr = r - pr, dg = g - pg, db = b - pb;
    const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
    if (d < bestD) { bestD = d; best = i; }
  }
  if (cache.size > 50000) cache.clear();
  cache.set(key, best);
  return best;
}

export const rgbOf = (idx) => PALETTE[idx] ?? PALETTE[0];
