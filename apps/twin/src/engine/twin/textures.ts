// Procedural textures: no image files to load.
import * as THREE from 'three';

/**
 * Fine surface grain for roughness maps (bead-blasted aluminum, soft-touch silicone).
 * Values stay near white, so it varies the roughness a little and never makes it glossy.
 * One tile covers 4 mm of an extruded surface (whose UVs are in millimeters).
 */
export function grainTexture(): THREE.CanvasTexture {
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const img = g.createImageData(n, n);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n * n; i++) {
    const v = 205 + rand() * 50;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(0.25, 0.25);
  t.anisotropy = 4;
  return t;
}

/** The same grain, repeated `rx × ry` times over a 0..1 UV range. */
export function grainOver(base: THREE.Texture, rx: number, ry: number): THREE.Texture {
  const t = base.clone();
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  return t;
}

/**
 * How an LED lights a silicone pad from below: bright and even over most of the pad, hottest at
 * the center, dimmer toward the rounded edges. Used as the emissive map (0..1 UVs over the pad).
 */
export function padGlowTexture(): THREE.CanvasTexture {
  const w = 128, h = 96;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  const img = g.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w * 2 - 1, v = (y + 0.5) / h * 2 - 1;
      // a broad hot center over a floor of about a third: bright colors clip to white or yellow in the
      // middle and stay saturated at the edges, as in photos of the lit pads
      const core = Math.exp(-(u * u * 1.15 + v * v) * 1.95);
      const k = Math.min(1, 0.3 + 0.7 * core);
      const o = (y * w + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.round(k * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c); // linear values: 1 = full LED brightness
}

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
export function woodTexture(wMm: number, hMm: number): THREE.CanvasTexture {
  const w = 1792, h = Math.round((w * hMm) / wMm);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  const noise = valueNoise(11), fine = valueNoise(23), pore = valueNoise(37);
  const mmPerPx = wMm / w, plankMm = 185;
  // dark oiled walnut, in sRGB: thin darker grain lines and fibers on a warm brown
  const base = [70, 47, 32], line = [34, 22, 15];
  for (let y = 0; y < h; y++) {
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
      const o = (y * w + x) * 4;
      for (let i = 0; i < 3; i++) img.data[o + i] = (base[i]! + (line[i]! - base[i]!) * d) * tone;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A soft dark footprint for the ground under an object (w×h mm with a margin of `blur` mm). */
export function contactShadowTexture(wMm: number, hMm: number, blurMm: number): THREE.CanvasTexture {
  const k = 2; // px per mm
  const c = document.createElement('canvas');
  c.width = Math.round((wMm + 4 * blurMm) * k);
  c.height = Math.round((hMm + 4 * blurMm) * k);
  const g = c.getContext('2d')!;
  g.filter = `blur(${blurMm * k}px)`;
  g.fillStyle = '#000';
  g.beginPath();
  g.roundRect(2 * blurMm * k, 2 * blurMm * k, wMm * k, hMm * k, 6 * k);
  g.fill();
  return new THREE.CanvasTexture(c);
}
