// Screen: the Push display as a canvas you control from the browser — scrolling text,
// a generative plasma, any image you drop in, or a clock. The pads can mirror it.
import { hsv, css } from '../palette.js';
import { text, FONT } from '../screen.js';

const s = {
  mode: 'text',
  message: 'Hello from the browser 👋  This screen is a <canvas> streamed over USB',
  speed: 1, hue: 280, size: 64,
  plasma: { speed: 1, scale: 1, hue: 0 },
  image: null, zoom: 1, panX: 0, panY: 0,
  mirror: true,
};
const MODES = ['text', 'plasma', 'image', 'clock'];
const low = Object.assign(document.createElement('canvas'), { width: 120, height: 15 });
const lowG = low.getContext('2d');
const lowImg = lowG.createImageData(120, 15);
const probe = Object.assign(document.createElement('canvas'), { width: 8, height: 8 });
const probeG = probe.getContext('2d', { willReadFrequently: true });

export default {
  id: 'screen',
  name: 'Screen',
  color: [255, 214, 60],

  onEvent(ev, app) {
    if (ev.type === 'button' && ev.pressed) {
      const i = /^lower\d$/.test(ev.id) ? +ev.id.slice(5) - 1 : -1;
      if (i >= 0 && i < 4) { s.mode = MODES[i]; this.syncPanel?.(); }
      if (i === 7) s.mirror = !s.mirror;
    }
    if (ev.type === 'encoder') {
      const d = ev.delta;
      if (s.mode === 'text') {
        if (ev.id === 'e1') s.speed = Math.max(0, Math.min(6, s.speed + d / 40));
        if (ev.id === 'e2') s.hue = (s.hue + d * 2 + 360) % 360;
        if (ev.id === 'e3') s.size = Math.max(20, Math.min(110, s.size + d / 2));
      } else if (s.mode === 'plasma') {
        if (ev.id === 'e1') s.plasma.speed = Math.max(0, Math.min(5, s.plasma.speed + d / 40));
        if (ev.id === 'e2') s.plasma.scale = Math.max(0.2, Math.min(4, s.plasma.scale + d / 60));
        if (ev.id === 'e3') s.plasma.hue = (s.plasma.hue + d * 2 + 360) % 360;
      } else if (s.mode === 'image') {
        if (ev.id === 'e1') s.zoom = Math.max(0.2, Math.min(8, s.zoom * (1 + d / 100)));
        if (ev.id === 'e2') s.panX += d * 4;
        if (ev.id === 'e3') s.panY += d * 2;
      }
    }
  },

  tick(t, dt, app) {
    if (s.mirror) {
      // Downsample the content area onto the 8×8 pads: the pads become a tiny second screen.
      probeG.imageSmoothingQuality = 'high';
      probeG.drawImage(app.screen.canvas, 0, 22, 960, 116, 0, 0, 8, 8);
      const d = probeG.getImageData(0, 0, 8, 8).data;
      for (let n = 36; n <= 99; n++) {
        const i = n - 36, row = 7 - Math.floor(i / 8), col = i % 8, p = (row * 8 + col) * 4;
        const boost = (v) => Math.min(255, v * 1.6) | 0;
        app.leds.pad(n, app.pads.get(n)?.down ? [255, 255, 255] : [boost(d[p]), boost(d[p + 1]), boost(d[p + 2])]);
      }
    } else for (let n = 36; n <= 99; n++) app.leds.pad(n, null);
    MODES.forEach((m, i) => app.leds.button(20 + i, s.mode === m ? this.color : [50, 40, 5]));
    app.leds.button(27, s.mirror ? [255, 255, 255] : [40, 40, 40]);
  },

  draw(g, app, t) {
    const W = 960, H = 116;
    if (s.mode === 'text') {
      g.font = `800 ${s.size}px ${FONT}`;
      const w = g.measureText(s.message).width;
      const x = W - ((t * 160 * s.speed) % (w + W));
      const grad = g.createLinearGradient(x, 0, x + w, 0);
      for (let k = 0; k <= 4; k++) grad.addColorStop(k / 4, css(hsv(s.hue + k * 40 + t * 30, 0.9, 1)));
      g.fillStyle = grad;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(s.message, x, H / 2 + 2);
    } else if (s.mode === 'plasma') {
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
    } else if (s.mode === 'image') {
      if (!s.image) {
        text(g, 'Drop an image on the side panel (or pick one) to show it here', W / 2, H / 2, { size: 16 });
      } else {
        const img = s.image, k = Math.max(W / img.width, H / img.height) * s.zoom;
        g.drawImage(img, (W - img.width * k) / 2 + s.panX, (H - img.height * k) / 2 + s.panY, img.width * k, img.height * k);
      }
    } else {
      const d = new Date();
      text(g, d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), W / 2, 50, { size: 64, weight: 800, color: css(hsv(t * 20, 0.6, 1)) });
      text(g, d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }), W / 2, 98, { size: 16, color: '#9aa4b0' });
    }
  },

  footer: () => ['Text', 'Plasma', 'Image', 'Clock', '', '', '', s.mirror ? 'Pads mirror ✓' : 'Pads mirror'],
  footerActive: (i) => MODES.indexOf(s.mode) === i || (i === 7 && s.mirror),

  panel(el) {
    el.innerHTML = `
      <h2>Screen studio</h2>
      <p>The Push display is a 960×160 <code>&lt;canvas&gt;</code> on this page, streamed to the hardware about 30 times a second. Lower buttons pick a mode; knobs 1–3 tweak it. The pads can mirror the screen at 8×8 pixels.</p>
      <div class="row" id="s-modes">${MODES.map((m) => `<button data-m="${m}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div>
      <div class="card-box">
        <label class="muted">Scrolling text</label>
        <textarea id="s-msg" rows="2" style="width:100%;margin-top:6px"></textarea>
      </div>
      <div class="card-box" id="s-drop" style="text-align:center">
        <p class="muted">Drop an image here, or</p>
        <input type="file" id="s-file" accept="image/*" />
      </div>
      <p class="muted">Knobs — Text: speed, hue, size · Plasma: speed, scale, hue · Image: zoom, pan X, pan Y.</p>`;
    const btns = [...el.querySelectorAll('[data-m]')];
    const sync = () => btns.forEach((b) => b.classList.toggle('active', b.dataset.m === s.mode));
    btns.forEach((b) => (b.onclick = () => { s.mode = b.dataset.m; sync(); }));
    this.syncPanel = sync;
    sync();
    const msg = el.querySelector('#s-msg');
    msg.value = s.message;
    msg.oninput = () => { s.message = msg.value || ' '; s.mode = 'text'; sync(); };
    const load = (file) => {
      if (!file?.type.startsWith('image/')) return;
      const img = new Image();
      img.onload = () => { s.image = img; s.zoom = 1; s.panX = s.panY = 0; s.mode = 'image'; sync(); };
      img.src = URL.createObjectURL(file);
    };
    el.querySelector('#s-file').onchange = (e) => load(e.target.files[0]);
    const drop = el.querySelector('#s-drop');
    drop.ondragover = (e) => { e.preventDefault(); drop.style.borderColor = 'var(--accent)'; };
    drop.ondragleave = () => (drop.style.borderColor = '');
    drop.ondrop = (e) => { e.preventDefault(); drop.style.borderColor = ''; load(e.dataTransfer.files[0]); };
  },

  exit() { this.syncPanel = null; },
};
