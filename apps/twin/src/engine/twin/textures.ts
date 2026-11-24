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
