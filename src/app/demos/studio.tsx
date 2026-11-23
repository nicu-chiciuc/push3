// Screen: the Push display as a canvas you control from the browser: scrolling text, a
// generative plasma, any image you drop in, or a clock. The pads can mirror it at 8×8.
import { createSignal, For } from 'solid-js';
import { css, hsv } from '../engine/palette.ts';
import { FONT, text } from '../engine/screen.ts';
import type { Demo } from '../engine/engine.ts';

const MODES = ['text', 'plasma', 'image', 'clock'] as const;
type Mode = (typeof MODES)[number];
const [mode, setMode] = createSignal<Mode>('text');
const [mirror, setMirror] = createSignal(true);
const [message, setMessage] = createSignal('Hello from the browser 👋  This screen is a <canvas> streamed over USB');
const s = {
  speed: 1, hue: 280, size: 64,
  plasma: { speed: 1, scale: 1, hue: 0 },
  image: null as HTMLImageElement | null, zoom: 1, panX: 0, panY: 0,
};
const low = Object.assign(document.createElement('canvas'), { width: 120, height: 15 });
const lowG = low.getContext('2d')!;
const lowImg = lowG.createImageData(120, 15);
const probe = Object.assign(document.createElement('canvas'), { width: 8, height: 8 });
const probeG = probe.getContext('2d', { willReadFrequently: true })!;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function loadImage(file: File | undefined) {
  if (!file?.type.startsWith('image/')) return;
  const img = new Image();
  img.onload = () => { s.image = img; s.zoom = 1; s.panX = s.panY = 0; setMode('image'); };
  img.src = URL.createObjectURL(file);
}

export const studio: Demo = {
  id: 'screen',
  name: 'Screen',
  color: [255, 214, 60],

  onEvent(ev) {
    if (ev.type === 'button' && ev.pressed && /^lower\d$/.test(ev.id)) {
      const i = +ev.id.slice(5) - 1;
      if (i < 4) setMode(MODES[i]!);
      if (i === 7) setMirror(!mirror());
    }
    if (ev.type === 'encoder') {
      const d = ev.delta;
      if (mode() === 'text') {
        if (ev.id === 'e1') s.speed = clamp(s.speed + d / 40, 0, 6);
        if (ev.id === 'e2') s.hue = (s.hue + d * 2 + 360) % 360;
        if (ev.id === 'e3') s.size = clamp(s.size + d / 2, 20, 110);
      } else if (mode() === 'plasma') {
        if (ev.id === 'e1') s.plasma.speed = clamp(s.plasma.speed + d / 40, 0, 5);
        if (ev.id === 'e2') s.plasma.scale = clamp(s.plasma.scale + d / 60, 0.2, 4);
        if (ev.id === 'e3') s.plasma.hue = (s.plasma.hue + d * 2 + 360) % 360;
      } else if (mode() === 'image') {
        if (ev.id === 'e1') s.zoom = clamp(s.zoom * (1 + d / 100), 0.2, 8);
        if (ev.id === 'e2') s.panX += d * 4;
        if (ev.id === 'e3') s.panY += d * 2;
      }
    }
  },

  tick(_t, _dt, app) {
    if (mirror()) {
      // Downsample the content area onto the 8×8 pads: the pads become a tiny second screen.
      probeG.imageSmoothingQuality = 'high';
      probeG.drawImage(app.screen.canvas, 0, 22, 960, 116, 0, 0, 8, 8);
      const d = probeG.getImageData(0, 0, 8, 8).data;
      const boost = (v: number) => Math.min(255, v * 1.6) | 0;
      for (let n = 36; n <= 99; n++) {
        const i = n - 36, p = ((7 - Math.floor(i / 8)) * 8 + (i % 8)) * 4;
        app.leds.pad(n, app.pads.get(n)?.down ? [255, 255, 255] : [boost(d[p]!), boost(d[p + 1]!), boost(d[p + 2]!)]);
      }
    } else for (let n = 36; n <= 99; n++) app.leds.pad(n, null);
    MODES.forEach((m, i) => app.leds.button(20 + i, mode() === m ? this.color : [50, 40, 5]));
    app.leds.button(27, mirror() ? [255, 255, 255] : [40, 40, 40]);
  },

  draw(g, _app, t) {
    const W = 960, H = 116;
    switch (mode()) {
      case 'text': {
        g.font = `800 ${s.size}px ${FONT}`;
        const msg = message() || ' ', w = g.measureText(msg).width, x = W - ((t * 160 * s.speed) % (w + W));
        const grad = g.createLinearGradient(x, 0, x + w, 0);
        for (let k = 0; k <= 4; k++) grad.addColorStop(k / 4, css(hsv(s.hue + k * 40 + t * 30, 0.9, 1)));
        g.fillStyle = grad;
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.fillText(msg, x, H / 2 + 2);
        break;
      }
      case 'plasma': {
        const { speed, scale, hue } = s.plasma, tt = t * speed, data = lowImg.data;
        for (let y = 0; y < 15; y++) {
          for (let x = 0; x < 120; x++) {
            const u = (x / 120) * 8 * scale, v = (y / 15) * 2 * scale;
            const val = Math.sin(u + tt) + Math.sin(v * 2 + tt * 1.3) + Math.sin((u + v + tt) * 0.7) + Math.sin(Math.hypot(u - 4, v - 1) * 1.5 - tt * 2);
            const [r, gg, b] = hsv(hue + val * 50 + tt * 20, 0.85, 0.55 + 0.45 * Math.sin(val));
            const p = (y * 120 + x) * 4;
            data[p] = r; data[p + 1] = gg; data[p + 2] = b; data[p + 3] = 255;
          }
        }
        lowG.putImageData(lowImg, 0, 0);
        g.imageSmoothingEnabled = true;
        g.drawImage(low, 0, 0, W, H);
        break;
      }
      case 'image': {
        if (!s.image) { text(g, 'Drop an image on the side panel (or pick one) to show it here', W / 2, H / 2, { size: 16 }); break; }
        const img = s.image, k = Math.max(W / img.width, H / img.height) * s.zoom;
        g.drawImage(img, (W - img.width * k) / 2 + s.panX, (H - img.height * k) / 2 + s.panY, img.width * k, img.height * k);
        break;
      }
      case 'clock': {
        const d = new Date();
        text(g, d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), W / 2, 50, { size: 64, weight: 800, color: css(hsv(t * 20, 0.6, 1)) });
        text(g, d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }), W / 2, 98, { size: 16, color: '#9aa4b0' });
      }
    }
  },

  footer: () => ['Text', 'Plasma', 'Image', 'Clock', '', '', '', mirror() ? 'Pads mirror ✓' : 'Pads mirror'],
  footerActive: (i) => MODES.indexOf(mode()) === i || (i === 7 && mirror()),

  Panel: () => {
    const [dragging, setDragging] = createSignal(false);
    return (
      <>
        <h2>Screen studio</h2>
        <p>The Push display is a 960×160 <code>&lt;canvas&gt;</code> on this page, streamed to the hardware about 30 times a second. Lower buttons pick a mode; knobs 1–3 tweak it. The pads can mirror the screen at 8×8 pixels.</p>
        <div class="row">
          <For each={MODES}>{(m) => <button classList={{ active: mode() === m }} onClick={() => setMode(m)}>{m[0]!.toUpperCase() + m.slice(1)}</button>}</For>
          <label class="toggle"><input type="checkbox" checked={mirror()} onChange={(e) => setMirror(e.currentTarget.checked)} /> Pads mirror</label>
        </div>
        <div class="card-box">
          <label class="muted">Scrolling text</label>
          <textarea rows="2" style={{ width: '100%', 'margin-top': '6px' }} value={message()} onInput={(e) => { setMessage(e.currentTarget.value); setMode('text'); }} />
        </div>
        <div
          class="card-box drop"
          classList={{ over: dragging() }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); loadImage(e.dataTransfer?.files[0]); }}
        >
          <p class="muted">Drop an image here, or</p>
          <input type="file" accept="image/*" onChange={(e) => loadImage(e.currentTarget.files?.[0])} />
        </div>
        <p class="muted">Knobs. Text: speed, hue, size · Plasma: speed, scale, hue · Image: zoom, pan X, pan Y.</p>
      </>
    );
  },
};
