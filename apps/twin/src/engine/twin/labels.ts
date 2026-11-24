// What is printed on each key, drawn as white-on-transparent canvas textures. The twin lights
// them up as an emissive map, the way the real keys are backlit through the printed legend.
// Icons are vector paths traced from Ableton's product photos, not font glyphs.
import * as THREE from 'three';

export type Icon =
  | 'page' | 'gear' | 'bulb' | 'user' | 'device' | 'mix' | 'clip' | 'browse'
  | 'plus' | 'swap' | 'lock' | 'square' | 'bar' | 'metronome' | 'capture' | 'record' | 'play'
  | 'grid' | 'bars' | 'up' | 'down' | 'left' | 'right' | 'dot';

export type Align = 'center' | 'topLeft' | 'left';

/** A legend: lines of text, an icon, or both (icon after the text, e.g. "Octave" + chevron). */
export interface Legend {
  readonly text?: string;
  readonly icon?: Icon;
  readonly align?: Align;
  /** Text cap size in mm. */
  readonly size?: number;
  /** Icon size in mm. */
  readonly iconSize?: number;
  /** Icon first, then text (e.g. "‹ Page"). */
  readonly iconFirst?: boolean;
  /** Stack icon and text vertically instead of side by side. */
  readonly stack?: boolean;
}

const PX_PER_MM = 18;
const FONT = '"Helvetica Neue", "Inter", Arial, sans-serif';

/** Draw an icon centered on (0,0) in a box of `s` pixels, stroke in white. */
function drawIcon(g: CanvasRenderingContext2D, icon: Icon, s: number) {
  const lw = Math.max(1.5, s * 0.11);
  g.lineWidth = lw;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = g.fillStyle = '#fff';
  const h = s / 2;
  const line = (pts: ReadonlyArray<readonly [number, number]>, close = false) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x * h, y * h) : g.moveTo(x * h, y * h)));
    if (close) g.closePath();
    g.stroke();
  };
  const chevron = (rot: number) => {
    g.save();
    g.rotate(rot);
    line([[-0.55, 0.28], [0, -0.27], [0.55, 0.28]]);
    g.restore();
  };
  switch (icon) {
    case 'page': line([[-0.6, -0.9], [0.2, -0.9], [0.6, -0.5], [0.6, 0.9], [-0.6, 0.9]], true); break;
    case 'gear': {
      g.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2, r = i % 2 ? 0.62 : 0.9;
        const a0 = a - Math.PI / 16 * 0.55, a1 = a + Math.PI / 16 * 0.55;
        g.lineTo(Math.cos(a0) * r * h, Math.sin(a0) * r * h);
        g.lineTo(Math.cos(a1) * r * h, Math.sin(a1) * r * h);
      }
      g.closePath();
      g.stroke();
      g.beginPath(); g.arc(0, 0, 0.28 * h, 0, Math.PI * 2); g.stroke();
      break;
    }
    case 'bulb':
      g.beginPath(); g.arc(0, -0.3 * h, 0.52 * h, Math.PI * 0.8, Math.PI * 0.2); g.stroke();
      line([[-0.42, 0.02], [-0.25, 0.45], [0.25, 0.45], [0.42, 0.02]]);
      line([[-0.25, 0.75], [0.25, 0.75]]);
      break;
    case 'user':
      g.beginPath(); g.arc(0, -0.5 * h, 0.32 * h, 0, Math.PI * 2); g.stroke();
      g.strokeRect(-0.6 * h, -0.02 * h, 1.2 * h, 0.85 * h);
      break;
    case 'device': g.beginPath(); g.arc(0, 0, 0.75 * h, Math.PI * 0.8, Math.PI * 2.55); g.stroke(); break; // open circle, gap at lower left
    case 'mix':
      [[-0.75, 0.15], [-0.25, -0.75], [0.25, 0.05], [0.75, -0.55]].forEach(([x, top]) => line([[x!, 0.85], [x!, top!]]));
      break;
    case 'clip':
      g.strokeRect(-0.95 * h, -0.7 * h, 1.9 * h, 1.4 * h);
      g.beginPath(); g.moveTo(-0.22 * h, -0.36 * h); g.lineTo(0.38 * h, 0); g.lineTo(-0.22 * h, 0.36 * h); g.closePath(); g.fill();
      break;
    case 'browse': [-0.6, 0, 0.6].forEach((x) => line([[x, -0.85], [x, 0.85]])); break;
    case 'bars': [-0.6, 0, 0.6].forEach((x) => line([[x, -0.9], [x, 0.9]])); break;
    case 'plus': line([[-0.75, 0], [0.75, 0]]); line([[0, -0.75], [0, 0.75]]); break;
    case 'swap':
      g.beginPath(); g.arc(0, 0, 0.62 * h, Math.PI * 1.05, Math.PI * 1.85); g.stroke();
      g.beginPath(); g.arc(0, 0, 0.62 * h, Math.PI * 0.05, Math.PI * 0.85); g.stroke();
      line([[0.3, -0.85], [0.6, -0.45], [0.95, -0.7]]);
      line([[-0.3, 0.85], [-0.6, 0.45], [-0.95, 0.7]]);
      break;
    case 'lock':
      g.beginPath(); g.arc(0, -0.25 * h, 0.4 * h, Math.PI, 0); g.stroke();
      g.fillRect(-0.62 * h, -0.2 * h, 1.24 * h, 1.0 * h);
      break;
    case 'square': g.strokeRect(-0.55 * h, -0.55 * h, 1.1 * h, 1.1 * h); break;
    case 'bar': g.fillRect(-0.95 * h, -0.14 * h, 1.9 * h, 0.28 * h); break;
    case 'metronome':
      g.beginPath(); g.arc(-0.45 * h, 0, 0.38 * h, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(0.5 * h, 0, 0.45 * h, 0, Math.PI * 2); g.fill();
      break;
    case 'capture':
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) line([[0.8 * sx, 0.35 * sy], [0.8 * sx, 0.8 * sy], [0.35 * sx, 0.8 * sy]]);
      break;
    case 'record': g.beginPath(); g.arc(0, 0, 0.78 * h, 0, Math.PI * 2); g.stroke(); break;
    case 'play': line([[-0.6, -0.85], [0.8, 0], [-0.6, 0.85]], true); break;
    case 'grid':
      for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) g.fillRect((-0.95 + c * 0.5) * h, (-0.9 + r * 0.42) * h, 0.4 * h, 0.16 * h);
      break;
    case 'up': chevron(0); break;
    case 'down': chevron(Math.PI); break;
    case 'left': chevron(-Math.PI / 2); break;
    case 'right': chevron(Math.PI / 2); break;
    case 'dot': g.beginPath(); g.arc(0, 0, 0.2 * h, 0, Math.PI * 2); g.fill(); break;
    default: icon satisfies never;
  }
}

/** A texture the size of a key top (w×d mm) with its legend. */
export function legendTexture(legend: Legend, wMm: number, dMm: number): THREE.CanvasTexture {
  const scale = Math.min(PX_PER_MM, 1024 / Math.max(wMm, dMm));
  const cw = Math.max(16, Math.round(wMm * scale)), ch = Math.max(16, Math.round(dMm * scale));
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const g = c.getContext('2d')!;
  const mm = (v: number) => v * scale;
  const align = legend.align ?? 'center';
  const pad = mm(1.9);
  const fontPx = mm(legend.size ?? 2.1) * 1.38; // cap height → font size
  const iconPx = mm(legend.iconSize ?? 3.6);
  g.font = `600 ${fontPx}px ${FONT}`;
  g.fillStyle = '#fff';
  g.textBaseline = 'middle';
  const lines = legend.text ? legend.text.split('\n') : [];
  const lineH = fontPx * 1.12;
  const textW = lines.length ? Math.max(...lines.map((l) => g.measureText(l).width)) : 0;
  const textH = lines.length * lineH;
  const hasIcon = !!legend.icon;
  const gap = mm(1.1);
  const stack = legend.stack ?? false;
  const blockW = stack ? Math.max(textW, hasIcon ? iconPx : 0) : textW + (hasIcon ? iconPx + (lines.length ? gap : 0) : 0);
  const blockH = stack ? textH + (hasIcon ? iconPx + (lines.length ? gap : 0) : 0) : Math.max(textH, hasIcon ? iconPx : 0);
  const x0 = align === 'center' ? (cw - blockW) / 2 : pad;
  const y0 = align === 'topLeft' ? pad * 0.9 : (ch - blockH) / 2;

  const drawText = (x: number, y: number) => {
    g.textAlign = 'left';
    lines.forEach((l, i) => g.fillText(l, x, y + lineH * (i + 0.5)));
  };
  const drawIconAt = (cx: number, cy: number) => {
    g.save();
    g.translate(cx, cy);
    drawIcon(g, legend.icon!, iconPx);
    g.restore();
  };
  if (stack) {
    let y = y0;
    const centerX = (w: number) => (align === 'center' ? (cw - w) / 2 : x0);
    if (hasIcon && legend.iconFirst) { drawIconAt(centerX(iconPx) + iconPx / 2, y + iconPx / 2); y += iconPx + gap; }
    if (lines.length) { drawText(centerX(textW), y); y += textH + gap; }
    if (hasIcon && !legend.iconFirst) drawIconAt(centerX(iconPx) + iconPx / 2, y + iconPx / 2);
  } else {
    let x = x0;
    const cy = y0 + blockH / 2;
    if (hasIcon && legend.iconFirst) { drawIconAt(x + iconPx / 2, cy); x += iconPx + gap; }
    if (lines.length) { drawText(x, cy - textH / 2); x += textW + gap; }
    if (hasIcon && !legend.iconFirst) drawIconAt(x + iconPx / 2, cy);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
