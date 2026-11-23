// The Push display is 960×160. We draw it on a normal <canvas>, show that canvas
// on the 3D twin, and stream it to the hardware as RGB565 (~30 fps).
import { css } from './palette.js';

export const W = 960, H = 160, HEADER = 22, FOOTER = 22;
export const CONTENT = { x: 0, y: HEADER, w: W, h: H - HEADER - FOOTER };
export const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif';
export const MONO = '"SF Mono", Menlo, Monaco, monospace';

export class Screen {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.g = this.canvas.getContext('2d', { willReadFrequently: true });
    this.pixels = new Uint16Array(W * H);
    this.lastSent = 0;
    this.version = 0;
  }

  /** Draw a full frame: tab header (upper buttons), demo content, footer (lower buttons). */
  draw(app, t) {
    const g = this.g;
    g.save();
    g.fillStyle = '#07080a';
    g.fillRect(0, 0, W, H);

    // content
    g.save();
    g.beginPath();
    g.rect(CONTENT.x, CONTENT.y, CONTENT.w, CONTENT.h);
    g.clip();
    g.translate(CONTENT.x, CONTENT.y);
    app.demo.draw?.(g, app, t);
    g.restore();

    // header: one tab per upper button
    app.demos.forEach((d, i) => {
      const active = d === app.demo;
      const x = i * 120;
      g.fillStyle = active ? css(d.color) : '#101216';
      g.fillRect(x + 4, 2, 112, HEADER - 4);
      g.fillStyle = active ? '#050505' : css(d.color, 0.85);
      g.font = `600 13px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(d.name, x + 60, HEADER / 2 + 1);
    });

    // footer: lower-button labels, or a status line
    const footer = app.demo.footer?.(app) ?? [];
    g.font = `600 12px ${FONT}`;
    g.textBaseline = 'middle';
    if (typeof footer === 'string') {
      g.fillStyle = '#9aa3ad';
      g.textAlign = 'left';
      g.fillText(footer, 10, H - FOOTER / 2);
    } else {
      footer.forEach((label, i) => {
        if (!label) return;
        const on = app.demo.footerActive?.(i, app);
        const x = i * 120;
        g.fillStyle = on ? css(app.demo.color) : '#14171c';
        g.fillRect(x + 4, H - FOOTER + 2, 112, FOOTER - 4);
        g.fillStyle = on ? '#050505' : '#c8d0d8';
        g.textAlign = 'center';
        g.fillText(label, x + 60, H - FOOTER / 2 + 1);
      });
    }
    g.restore();
    this.version++;
  }

  /** Convert to RGB565 (red in the low bits, as the Push expects). */
  toRGB565() {
    const d = this.g.getImageData(0, 0, W, H).data, out = this.pixels;
    for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = ((d[p + 2] >> 3) << 11) | ((d[p + 1] >> 2) << 5) | (d[p] >> 3);
    return out;
  }

  maybeSend(bridge, now) {
    if (now - this.lastSent < 33 || !bridge.status.display) return;
    this.lastSent = now;
    bridge.sendFrame(this.toRGB565());
  }
}

// Small drawing helpers shared by demos
export function arcGauge(g, cx, cy, r, value, color, { width = 5, track = '#23272e' } = {}) {
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  g.lineCap = 'round';
  g.lineWidth = width;
  g.strokeStyle = track;
  g.beginPath(); g.arc(cx, cy, r, a0, a1); g.stroke();
  g.strokeStyle = color;
  g.beginPath(); g.arc(cx, cy, r, a0, a0 + (a1 - a0) * Math.max(0, Math.min(1, value))); g.stroke();
}

export function text(g, str, x, y, { size = 13, weight = 600, color = '#e8edf2', align = 'center', base = 'middle', font = FONT } = {}) {
  g.font = `${weight} ${size}px ${font}`;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = base;
  g.fillText(str, x, y);
}
