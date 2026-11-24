// Geometry builders for the twin, in millimeters. Shapes are drawn in a 2D plane where +y points
// to the back of the device, then extruded upward (+Y in the scene).
import * as THREE from 'three';

export type Pt = readonly [number, number];

/** Rounded rectangle centered on (0,0). */
export function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const x = -w / 2, y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  const s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Convex polygon (counter-clockwise) with every edge moved inward by d. */
export function inset(poly: ReadonlyArray<Pt>, d: number): Array<Pt> {
  const n = poly.length;
  const lines = poly.map((p, i) => {
    const q = poly[(i + 1) % n]!;
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
    const nx = -dy / len, ny = dx / len; // inward normal for a CCW polygon
    return { p: [p[0] + nx * d, p[1] + ny * d] as Pt, d: [dx, dy] as Pt };
  });
  return lines.map((l, i) => {
    const m = lines[(i + n - 1) % n]!;
    // intersect line m (previous edge) with line l
    const det = m.d[0] * l.d[1] - m.d[1] * l.d[0];
    const t = ((l.p[0] - m.p[0]) * l.d[1] - (l.p[1] - m.p[1]) * l.d[0]) / det;
    return [m.p[0] + m.d[0] * t, m.p[1] + m.d[1] * t] as Pt;
  });
}

/** Polygon with its corners rounded by r (each corner cut back along both edges). */
export function roundedPoly(poly: ReadonlyArray<Pt>, r: number): THREE.Shape {
  const n = poly.length;
  const s = new THREE.Shape();
  poly.forEach((p, i) => {
    const a = poly[(i + n - 1) % n]!, b = poly[(i + 1) % n]!;
    const toward = (q: Pt) => {
      const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy), k = Math.min(r, len / 2.5) / len;
      return [p[0] + dx * k, p[1] + dy * k] as Pt;
    };
    const p0 = toward(a), p1 = toward(b);
    if (i === 0) s.moveTo(p0[0], p0[1]);
    else s.lineTo(p0[0], p0[1]);
    s.quadraticCurveTo(p[0], p[1], p1[0], p1[1]);
  });
  s.closePath();
  return s;
}

/** Extrude a shape up from y = 0 to y = height, with rounded top edges of radius `bevel`. */
export function slab(shape: THREE.Shape, height: number, bevel: number, segments = 3): THREE.BufferGeometry {
  bevel = Math.min(bevel, height / 2.01);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, height - 2 * bevel),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: segments,
    curveSegments: 8,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, bevel, 0);
  geo.computeVertexNormals();
  return geo;
}

export interface KnobProfile {
  /** Radius at the top and at the base. */
  readonly r: number;
  readonly rBase?: number;
  readonly h: number;
  /** Radius of the rounded top edge. */
  readonly fillet: number;
  /** How far the center of the top sinks (a slight dish). */
  readonly dish?: number;
}

/** A turned knob: a cylinder with a rounded top edge, optionally tapered and dished. */
export function knob({ r, rBase = r, h, fillet, dish = 0 }: KnobProfile, segments = 72): THREE.BufferGeometry {
  const pts: Array<THREE.Vector2> = [new THREE.Vector2(0.001, 0), new THREE.Vector2(rBase, 0)];
  const steps = 8;
  pts.push(new THREE.Vector2(r, h - fillet));
  for (let i = 1; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r - fillet + Math.cos(a) * fillet, h - fillet + Math.sin(a) * fillet));
  }
  const top = r - fillet;
  for (let i = 1; i <= 6; i++) {
    const x = top * (1 - i / 6);
    pts.push(new THREE.Vector2(Math.max(0.001, x), h - dish * (1 - (x / top) ** 2)));
  }
  return new THREE.LatheGeometry(pts, segments); // its own normals are seamless; don't recompute them
}
