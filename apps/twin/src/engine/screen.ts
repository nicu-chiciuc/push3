// The Push display is 960×160. We draw it on a normal <canvas>, show that canvas on the
// 3D twin, and stream it to the hardware as RGB565 (~30 fps).
import { css, DISPLAY_HEIGHT as H, DISPLAY_WIDTH as W, rgbaToRgb565 } from '@push3/protocol';
import type { Engine } from './engine.ts';

export const HEADER = 22, FOOTER = 22;
export const CONTENT = { x: 0, y: HEADER, w: W, h: H - HEADER - FOOTER } as const;
export const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif';
export const MONO = '"SF Mono", Menlo, Monaco, monospace';

export class Screen {
  readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly pixels = new Uint16Array(W * H);
  private lastSent = 0;
  version = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.g = this.canvas.getContext('2d', { willReadFrequently: true })!;
  }

  /** Full frame: tab header (upper buttons), demo content, footer (lower buttons). */
  draw(app: Engine, t: number) {
    const g = this.g, demo = app.demo;
    g.save();
    g.fillStyle = '#07080a';
    g.fillRect(0, 0, W, H);

    if (demo.fullBleed) {
      g.save();
      demo.draw?.(g, app, t);
      g.restore();

      if (app.held.has('shift')) {
        g.fillStyle = 'rgba(7,8,10,0.82)';
        g.fillRect(0, 0, W, HEADER + 2);
        app.demos.slice(0, 8).forEach((d, i) => {
          const active = d === demo, x = i * 120;
          g.fillStyle = active ? css(d.color) : '#141820';
          g.fillRect(x + 4, 2, 112, HEADER - 4);
          text(g, d.name, x + 60, HEADER / 2 + 1, { size: 13, color: active ? '#050505' : css(d.color, 0.9) });
        });
      }
      g.restore();
      this.version++;
      return;
    }

    g.save();
    g.beginPath();
    g.rect(CONTENT.x, CONTENT.y, CONTENT.w, CONTENT.h);
    g.clip();
    g.translate(CONTENT.x, CONTENT.y);
    demo.draw?.(g, app, t);
    g.restore();

    app.demos.slice(0, 8).forEach((d, i) => {
      const active = d === demo, x = i * 120;
      g.fillStyle = active ? css(d.color) : '#101216';
      g.fillRect(x + 4, 2, 112, HEADER - 4);
      text(g, d.name, x + 60, HEADER / 2 + 1, { size: 13, color: active ? '#050505' : css(d.color, 0.85) });
    });

    const footer = demo.footer?.(app) ?? [];
    if (typeof footer === 'string') {
      text(g, footer, 10, H - FOOTER / 2, { size: 12, color: '#9aa3ad', align: 'left' });
    } else {
      footer.forEach((label, i) => {
        if (!label) return;
        const on = demo.footerActive?.(i, app) ?? false, x = i * 120;
        g.fillStyle = on ? css(demo.color) : '#14171c';
        g.fillRect(x + 4, H - FOOTER + 2, 112, FOOTER - 4);
        text(g, label, x + 60, H - FOOTER / 2 + 1, { size: 12, color: on ? '#050505' : '#c8d0d8' });
      });
    }
    g.restore();
    this.version++;
  }

  /** RGB565 with red in the low bits, as the Push expects. */
  toRGB565(): Uint16Array<ArrayBuffer> {
    return rgbaToRgb565(this.g.getImageData(0, 0, W, H).data, this.pixels);
  }

  /** Throttled to ~30 fps. */
  shouldSend(now: number) {
    if (now - this.lastSent < 33) return false;
    this.lastSent = now;
    return true;
  }
}

// ── drawing helpers shared by demos ──
export function arcGauge(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, value: number, color: string, { width = 5, track = '#23272e' } = {}) {
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  g.lineCap = 'round';
  g.lineWidth = width;
  g.strokeStyle = track;
  g.beginPath(); g.arc(cx, cy, r, a0, a1); g.stroke();
  g.strokeStyle = color;
  g.beginPath(); g.arc(cx, cy, r, a0, a0 + (a1 - a0) * Math.max(0, Math.min(1, value))); g.stroke();
}

interface TextOptions { size?: number; weight?: number; color?: string; align?: CanvasTextAlign; base?: CanvasTextBaseline; font?: string }
export function text(g: CanvasRenderingContext2D, str: string, x: number, y: number, { size = 13, weight = 600, color = '#e8edf2', align = 'center', base = 'middle', font = FONT }: TextOptions = {}) {
  g.font = `${weight} ${size}px ${font}`;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = base;
  g.fillText(str, x, y);
}
