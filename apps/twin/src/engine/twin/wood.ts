// The walnut desk's texture: pure pixel math with no three.js and no DOM, so it runs in a worker
// (wood.worker.ts) while the page loads. On the main thread it took about 0.3 s on a fast laptop.

/** The desk is this many millimeters on each side. */
export const DESK_MM = 2600;

/** Smooth value noise on a wrapping lattice (deterministic). */
function valueNoise(seed: number) {
  const n = 256, table = new Float32Array(n * n);
  let s = seed;
  for (let i = 0; i < table.length; i++) table[i] = (s = (s * 16807) % 2147483647) / 2147483647;
  const at = (x: number, y: number) => table[(((y % n) + n) % n) * n + (((x % n) + n) % n)]!;
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

/**
 * An oiled walnut desk top: planks along x with flowing grain, pores and slight color shifts per
 * plank. `wMm` × `hMm` of desk at about 0.9 mm per pixel.
 */
export const woodSize = (wMm: number, hMm: number) => ({ w: 1792, h: Math.round((1792 * hMm) / wMm) });

/** Rows `y0` to `y1` (not included) of the texture, as RGBA bytes. The rows do not depend on each
 *  other, so several workers can each make a band. */
export function woodRows(wMm: number, hMm: number, y0: number, y1: number): Uint8ClampedArray<ArrayBuffer> {
  const { w } = woodSize(wMm, hMm);
  const data = new Uint8ClampedArray(w * (y1 - y0) * 4);
  const noise = valueNoise(11), fine = valueNoise(23), pore = valueNoise(37);
  const mmPerPx = wMm / w, plankMm = 185;
  // dark oiled walnut, in sRGB: thin darker grain lines and fibers on a warm brown
  const base = [70, 47, 32], line = [34, 22, 15];
  for (let y = y0; y < y1; y++) {
    const yMm = y * mmPerPx, plank = Math.floor(yMm / plankMm), inPlank = yMm - plank * plankMm;
    const tone = 0.9 + 0.2 * ((plank * 0.618) % 1); // each plank a little lighter or darker
    const shift = plank * 517.3; // and its grain starts elsewhere
    for (let x = 0; x < w; x++) {
      const xMm = x * mmPerPx + shift;
      // long grain lines along the plank, gently bent; spacing varies a little
      const warp = noise(xMm / 700, yMm / 160) * 16 + noise(xMm / 160, yMm / 45) * 3;
      // two sets of grain lines with irregular spacing, so they never form regular stripes
      const ring1 = (yMm + warp) / (5 + 9 * noise(xMm / 900, yMm / 120));
      const ring2 = (yMm + warp * 1.3 + 40) / (11 + 7 * noise(xMm / 700 + 50, yMm / 90));
      const line1 = Math.pow(Math.abs(Math.cos((ring1 - Math.floor(ring1)) * Math.PI)), 14);
      const line2 = Math.pow(Math.abs(Math.cos((ring2 - Math.floor(ring2)) * Math.PI)), 8);
      const strength = 0.4 + 0.6 * noise(xMm / 300, yMm / 70); // lines fade in and out
      const fiber = fine(xMm / 30, yMm / 0.55); // long thin fibers
      const speck = pore(xMm / 1.1, yMm / 0.4) > 0.86 ? 0.5 : 0;
      let d = (0.32 * line1 + 0.2 * line2) * strength + 0.24 * fiber + 0.25 * speck; // 0 = base color, 1 = line color
      if (inPlank < 0.8 || plankMm - inPlank < 0.8) d = 1; // the seam between planks
      d = Math.min(1, d);
      const o = ((y - y0) * w + x) * 4;
      for (let i = 0; i < 3; i++) data[o + i] = (base[i]! + (line[i]! - base[i]!) * d) * tone;
      data[o + 3] = 255;
    }
  }
  return data;
}
