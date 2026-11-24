// What is printed on each key, drawn as white-on-transparent canvas textures. The twin lights
// them up as an emissive map, the way the real keys are backlit through the printed legend.
// Icons are vector paths measured on a 3000 px top-down photo (0.134 mm/px): sizes and stroke
// widths are in millimeters.
import * as THREE from 'three';

export type Icon =
  | 'page' | 'gear' | 'bulb' | 'user' | 'device' | 'mix' | 'clip' | 'browse'
  | 'plus' | 'swap' | 'lock' | 'square' | 'bar' | 'metronome' | 'capture' | 'record' | 'play'
  | 'grid' | 'bars' | 'up' | 'down' | 'left' | 'right' | 'thinLeft' | 'thinRight' | 'dot';

/** One printed element, positioned in absolute device millimeters (x from the left edge, y from the back). */
export interface LegendPart {
  readonly text?: string;
  readonly icon?: Icon;
  readonly x: number;
  readonly y: number;
  /** 'tl': (x, y) is the top-left of the first line's capitals. 'c': (x, y) is the center. */
  readonly anchor?: 'tl' | 'c';
  /** Cap height (mm). */
  readonly size?: number;
  /** Baseline-to-baseline distance for multi-line text (mm). */
  readonly pitch?: number;
  /** Icon box (mm). */
  readonly w?: number;
  readonly h?: number;
}

const PX_PER_MM = 20;
const FONT = '"Helvetica Neue", "Inter", Arial, sans-serif';
/** Cap height / font size of the font above. */
const CAP = 0.717;

/** Draw an icon centered on (0, 0) in a w×h box; `k` converts millimeters to pixels. */
function drawIcon(g: CanvasRenderingContext2D, icon: Icon, w: number, h: number, k: number) {
  const hw = (w / 2) * k, hh = (h / 2) * k;
  const stroke = (mm: number) => { g.lineWidth = mm * k; };
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = g.fillStyle = '#fff';
  const path = (pts: ReadonlyArray<readonly [number, number]>, close = false) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k)));
    if (close) g.closePath();
    g.stroke();
  };
  const circle = (x: number, y: number, r: number, fill = false) => { g.beginPath(); g.arc(x * k, y * k, r * k, 0, Math.PI * 2); fill ? g.fill() : g.stroke(); };
  const bar = (x: number, y0: number, y1: number, wMm: number) => { stroke(wMm); path([[x, y0], [x, y1]]); };
  const a = w / 2, b = h / 2; // half sizes in mm
  switch (icon) {
    case 'page': stroke(0.55); path([[-a, -b], [a - 1.2, -b], [a, -b + 1.2], [a, b], [-a, b]], true); break;
    case 'gear': {
      stroke(0.5);
      const ro = Math.min(a, b) - 0.25, ri = ro - 0.65, teeth = 8;
      g.beginPath();
      for (let i = 0; i < teeth * 2; i++) {
        const r = i % 2 ? ri : ro, a0 = ((i - 0.5) / (teeth * 2)) * Math.PI * 2, a1 = ((i + 0.5) / (teeth * 2)) * Math.PI * 2;
        g.lineTo(Math.cos(a0) * r * k, Math.sin(a0) * r * k);
        g.lineTo(Math.cos(a1) * r * k, Math.sin(a1) * r * k);
      }
      g.closePath();
      g.stroke();
      circle(0, 0, ri * 0.48);
      break;
    }
    case 'bulb': {
      stroke(0.5);
      const r = a - 0.25, cy = -b + r + 0.25;
      g.beginPath(); g.arc(0, cy * k, r * k, Math.PI * 0.78, Math.PI * 0.22); g.stroke();
      path([[-r * 0.62, cy + r * 0.78], [-r * 0.5, b - 1.3], [r * 0.5, b - 1.3], [r * 0.62, cy + r * 0.78]]);
      path([[-r * 0.45, b - 0.3], [r * 0.45, b - 0.3]]);
      break;
    }
    case 'user':
      stroke(0.45); circle(0, -b + 0.75, 0.62);
      stroke(0.5); g.beginPath(); g.roundRect(-a * k, (-b + 1.75) * k, w * k, (h - 1.75) * k, 0.45 * k); g.stroke();
      path([[-a, -b + 1.75 + (h - 1.75) / 2], [a, -b + 1.75 + (h - 1.75) / 2]]);
      break;
    case 'device': // an open circle, the gap at the bottom
      stroke(0.7); g.beginPath(); g.arc(0, 0, (Math.min(a, b) - 0.35) * k, Math.PI * 0.68, Math.PI * 2.32); g.stroke(); break;
    case 'mix': [[-2.33, 0.7], [-0.78, 1], [0.78, 0.4], [2.33, 1]].forEach(([x, f]) => bar(x!, b, b - h * f!, 0.5)); break;
    case 'clip':
      stroke(0.5); g.strokeRect(-hw, -hh, 2 * hw, 2 * hh);
      g.beginPath(); g.moveTo(-0.55 * k, -0.75 * k); g.lineTo(0.75 * k, 0); g.lineTo(-0.55 * k, 0.75 * k); g.closePath(); g.fill();
      break;
    case 'browse': [-2.1, 0, 2.1].forEach((x) => bar(x, -b + 0.3, b - 0.3, 0.55)); break;
    case 'bars': [-2.45, 0, 2.45].forEach((x) => bar(x, -b + 0.3, b - 0.3, 0.65)); break;
    case 'grid':
      for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
        g.beginPath(); g.roundRect((-a + c * ((w - 1.6) / 2)) * k, (-b + r * ((h - 0.55) / 3)) * k, 1.6 * k, 0.55 * k, 0.27 * k); g.fill();
      }
      break;
    case 'plus': stroke(0.6); path([[-a, 0], [a, 0]]); path([[0, -b], [0, b]]); break;
    case 'swap': {
      stroke(0.55);
      const r = Math.min(a, b) - 0.5;
      g.beginPath(); g.arc(0, 0, r * k, Math.PI * 1.1, Math.PI * 1.75); g.stroke();
      g.beginPath(); g.arc(0, 0, r * k, Math.PI * 0.1, Math.PI * 0.75); g.stroke();
      const head = (ang: number, dir: number) => {
        const x = Math.cos(ang) * r, y = Math.sin(ang) * r, t = ang + (dir * Math.PI) / 2;
        const tx = Math.cos(t), ty = Math.sin(t), l = 0.9;
        path([[x - tx * l + ty * l * 0.8, y - ty * l - tx * l * 0.8], [x, y], [x - tx * l - ty * l * 0.8, y - ty * l + tx * l * 0.8]]);
      };
      head(Math.PI * 1.75, 1);
      head(Math.PI * 0.75, 1);
      break;
    }
    case 'lock':
      stroke(0.45); g.beginPath(); g.arc(0, (-b + 1.2) * k, 0.8 * k, Math.PI, 0); g.stroke();
      path([[-0.8, -b + 1.2], [-0.8, -b + 1.8]]); path([[0.8, -b + 1.2], [0.8, -b + 1.8]]);
      g.beginPath(); g.roundRect(-hw, (-b + 1.75) * k, 2 * hw, (h - 1.75) * k, 0.3 * k); g.fill();
      break;
    case 'square': stroke(0.5); g.strokeRect(-hw + 0.25 * k, -hh + 0.25 * k, 2 * hw - 0.5 * k, 2 * hh - 0.5 * k); break;
    case 'bar': g.beginPath(); g.roundRect(-hw, -hh, 2 * hw, 2 * hh, 0.2 * k); g.fill(); break;
    case 'metronome': stroke(0.45); circle(-a + 1.3, 0, 1.08); circle(a - 1.45, 0, 1.45, true); break;
    case 'capture':
      stroke(0.6);
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        path([[sx * (a - 0.3), sy * (b - 1.8)], [sx * (a - 0.3), sy * (b - 0.3)], [sx * (a - 1.8), sy * (b - 0.3)]]);
      }
      break;
    case 'record': stroke(0.9); circle(0, 0, Math.min(a, b) - 0.45); break;
    case 'play': { const s = Math.min(0.7, Math.min(w, h) * 0.17); stroke(s); path([[-a + s / 2, -b + s / 2], [a - s / 2, 0], [-a + s / 2, b - s / 2]], true); break; }
    case 'up': stroke(0.7); path([[-a + 0.35, b - 0.35], [0, -b + 0.35], [a - 0.35, b - 0.35]]); break;
    case 'down': stroke(0.7); path([[-a + 0.35, -b + 0.35], [0, b - 0.35], [a - 0.35, -b + 0.35]]); break;
    case 'left': stroke(0.7); path([[a - 0.35, -b + 0.35], [-a + 0.35, 0], [a - 0.35, b - 0.35]]); break;
    case 'right': stroke(0.7); path([[-a + 0.35, -b + 0.35], [a - 0.35, 0], [-a + 0.35, b - 0.35]]); break;
    case 'thinLeft': stroke(0.42); path([[a - 0.2, -b + 0.2], [-a + 0.2, 0], [a - 0.2, b - 0.2]]); break;
    case 'thinRight': stroke(0.42); path([[-a + 0.2, -b + 0.2], [a - 0.2, 0], [-a + 0.2, b - 0.2]]); break;
    case 'dot': circle(0, 0, Math.min(a, b), true); break;
    default: icon satisfies never;
  }
}

/** A texture covering a key's bounding box (absolute mm), with its printed parts. */
export function legendTexture(parts: ReadonlyArray<LegendPart>, box: { readonly x0: number; readonly y0: number; readonly w: number; readonly h: number }): THREE.CanvasTexture {
  const k = Math.min(PX_PER_MM, 1024 / Math.max(box.w, box.h));
  const c = document.createElement('canvas');
  c.width = Math.max(16, Math.round(box.w * k));
  c.height = Math.max(16, Math.round(box.h * k));
  const g = c.getContext('2d')!;
  for (const p of parts) {
    const x = (p.x - box.x0) * k, y = (p.y - box.y0) * k;
    if (p.icon) {
      g.save();
      g.translate(x, y);
      drawIcon(g, p.icon, p.w ?? 3.6, p.h ?? p.w ?? 3.6, k);
      g.restore();
    }
    if (p.text) {
      const cap = (p.size ?? 2.3) * k, pitch = (p.pitch ?? 4.2) * k;
      g.font = `600 ${cap / CAP}px ${FONT}`;
      g.fillStyle = '#fff';
      g.textBaseline = 'alphabetic';
      const lines = p.text.split('\n');
      const center = p.anchor === 'c';
      g.textAlign = center ? 'center' : 'left';
      const top = center ? y - (cap + pitch * (lines.length - 1)) / 2 : y;
      lines.forEach((line, i) => g.fillText(line, x, top + cap + pitch * i));
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
