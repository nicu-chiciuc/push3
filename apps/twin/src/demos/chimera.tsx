// Chimera: CHIMERA, a physical model of the human voice by Jameson Hodge (MIT,
// github.com/jamesondh/chimera-vocal-synth), played from the Push. Its head sings on the Push
// screen. Pads (MPE, in fourths) play one voice, last note wins: roll bends the pitch, pressure is
// the breath, slide the brightness. Knobs shape the voice, the touch strip moves the mouth through
// U O A E I, and lower buttons 1-5 jump to a vowel.
import { createSignal, For, onCleanup, Show } from 'solid-js';
import { Effect } from 'effect';
import { css, hsv, type RGB } from '@push3/protocol';
import { BODIES, loadChimera, MOUTH, type Body, type Chimera, type Head, type VoiceSettings, type Vowel } from '@push3/chimera';
import { MONO, text } from '../engine/screen.ts';
import type { Demo, Engine } from '../engine/engine.ts';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (p: number) => NAMES[((Math.round(p) % 12) + 12) % 12]! + (Math.floor(Math.round(p) / 12) - 1);
const inScale = (p: number) => [0, 2, 4, 5, 7, 9, 11].includes(p % 12);
const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);
const hzMidi = (f: number) => 69 + 12 * Math.log2(f / 440);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
/** The lowest pad (C) per body: a man's voice sits an octave below a woman's or a child's. */
const ROOT: Record<Body, number> = { male: 36, female: 48, child: 48 };
const BODY_LABEL: Record<Body, string> = { male: 'Male', female: 'Female', child: 'Child' };
/** Lower buttons 1-5, in the order people say them; the strip runs U O A E I (see MOUTH). */
const VOWEL_BUTTONS: ReadonlyArray<Vowel> = ['A', 'E', 'I', 'O', 'U'];
const SPECTRUM_LO = 60, SPECTRUM_HI = 5000;
// The finger's expression, as CHIMERA's plugin maps MPE (crates/chimera-plugin/src/core.rs):
/** pressure adds up to this share of the breath knob (the knob is the breath at a light touch) */
const PRESSURE_DEPTH = 0.75;
/** brightness per unit of slide, counted from where the finger landed */
const SLIDE_DEPTH = 1;
/** a slide this soon after its note starts (s) is where the finger landed */
const SLIDE_LANDING = 0.05;

// ── the 8 knobs, left to right ──
type Key = Exclude<keyof VoiceSettings, 'f0'>;
interface Knob {
  readonly id: string;
  readonly key: Key;
  readonly label: string;
  readonly short: string;
  readonly color: number;
  readonly min: number;
  readonly max: number;
  /** change per encoder tick: added, or (log) multiplied */
  readonly step: number;
  readonly log?: boolean;
  readonly format: (v: number) => string;
}
const pct = (v: number) => `${Math.round(v * 100)}%`;
const KNOBS: ReadonlyArray<Knob> = [
  { id: 'e1', key: 'pressure', label: 'BREATH PRESSURE', short: 'BREATH', color: 0x38bdf8, min: 2, max: 22, step: 0.15, format: (v) => `${v.toFixed(1)} cmH₂O` },
  { id: 'e2', key: 'tension', label: 'PRESSED', short: 'PRESS', color: 0xf472b6, min: 0, max: 1, step: 0.01, format: pct },
  { id: 'e3', key: 'brightness', label: 'BRIGHTNESS', short: 'BRIGHT', color: 0xfacc15, min: 0, max: 1, step: 0.01, format: pct },
  { id: 'e4', key: 'breathiness', label: 'BREATHINESS', short: 'AIRY', color: 0x7de6ff, min: 0, max: 1, step: 0.01, format: pct },
  { id: 'e5', key: 'roughness', label: 'ROUGHNESS', short: 'ROUGH', color: 0xff551e, min: 0, max: 1, step: 0.01, format: pct },
  { id: 'e6', key: 'fry', label: 'VOCAL FRY', short: 'FRY', color: 0xc084fc, min: 0, max: 1, step: 0.01, format: pct },
  { id: 'e7', key: 'vibratoDepth', label: 'VIBRATO DEPTH', short: 'VIBRATO', color: 0x34d399, min: 0, max: 120, step: 1, format: (v) => `${Math.round(v)} cents` },
  { id: 'e8', key: 'glide', label: 'GLIDE', short: 'GLIDE', color: 0x60a5fa, min: 0.005, max: 0.6, step: 1.04, log: true, format: (v) => `${Math.round(v * 1000)} ms` },
];
const KNOB_BY_ID = new Map(KNOBS.map((k) => [k.id, k]));
const knobPos = (k: Knob, v: number) => (k.log ? Math.log(v / k.min) / Math.log(k.max / k.min) : (v - k.min) / (k.max - k.min));
const rgbOf = (c: number): RGB => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

// ── state ──
let voice: Chimera | null = null;
let head: Head | null = null;
let current: Engine | null = null;
/** The page's copy of the head (the Panel's canvas), drawn each frame while the panel is open. */
let panelCanvas: HTMLCanvasElement | null = null;
const [status, setStatus] = createSignal<'loading' | 'ready' | 'failed'>('loading');
/** Sound is on unless the user turns it off. */
const [soundOn, setSoundOn] = createSignal(true);
/** The browser lets audio start only after a click or key press on the page; until then this is false. */
const [audioRunning, setAudioRunning] = createSignal(false);
/** The knobs' values (the base the fingers play around). */
const [settings, setSettings] = createSignal<Record<Key, number> | null>(null);
const [mouth, setMouthSignal] = createSignal(MOUTH.indexOf('A'));
const [body, setBodySignal] = createSignal<Body>('male');
const [bendRange, setBendRange] = createSignal(2);
const s = {
  root: ROOT.male,
  /** pad notes held, in press order: the last one sings */
  held: [] as number[],
  /** per held pad: when it went down (s) and the slide it landed on */
  landed: new Map<number, { at: number; y: number }>(),
  /** what the voice plays now */
  pitch: NaN,
  breath: 0,
  bright: 0,
  spectrum: new Float32Array(136),
  hasSpectrum: false,
  hud: { label: '', value: '', until: 0 },
};

const pitchOf = (rowFromTop: number, col: number) => s.root + col + (7 - rowFromTop) * 5; // rows in fourths, like Push
const padPitch = (note: number) => { const i = note - 36; return pitchOf(7 - Math.floor(i / 8), i % 8); };

const showHud = (label: string, value: string) => { s.hud = { label, value, until: performance.now() / 1000 + 1.9 }; };
const showKnob = (k: Knob) => { const v = settings()?.[k.key]; if (v !== undefined) showHud(k.label, k.format(v)); };

function setKnob(k: Knob, v: number) {
  const cur = settings();
  if (!cur) return;
  const next = clamp(v, k.min, k.max);
  setSettings({ ...cur, [k.key]: next });
  // breath and brightness are what the finger plays around: apply() mixes them in
  if (k.key === 'pressure' || k.key === 'brightness') apply(current);
  else voice?.setSource({ [k.key]: next });
}
const turnKnob = (k: Knob, delta: number) => {
  const v = settings()?.[k.key];
  if (v !== undefined) setKnob(k, k.log ? v * k.step ** delta : v + delta * k.step);
};

const setMouth = (pos: number) => { setMouthSignal(clamp(pos, 0, MOUTH.length - 1)); voice?.setMouth(mouth()); };
const setVowel = (v: Vowel) => { setMouth(MOUTH.indexOf(v)); showHud('MOUTH', v); };
const nearVowel = () => { const m = mouth(), i = Math.round(m); return Math.abs(m - i) < 0.12 ? MOUTH[i] : null; };

function setBody(b: Body) {
  if (!voice) return;
  setBodySignal(b);
  voice.setBody(b);
  s.root = ROOT[b];
  apply(current);
}

/** Play the last held pad: its pitch with the roll, its pressure as breath, its slide as brightness. */
function apply(app: Engine | null) {
  const v = voice, set = settings();
  if (!v || !set) return;
  const note = s.held.at(-1), p = note === undefined ? undefined : app?.pads.get(note);
  if (note === undefined || !p) {
    s.breath = set.pressure;
    s.bright = set.brightness;
    v.setSource({ pressure: s.breath, brightness: s.bright });
    v.gate(0);
    return;
  }
  s.pitch = padPitch(note) + p.x * bendRange();
  s.breath = Math.min(22, set.pressure * (1 + PRESSURE_DEPTH * p.pressure));
  s.bright = clamp(set.brightness + (p.y - (s.landed.get(note)?.y ?? p.y)) * SLIDE_DEPTH, 0, 1);
  v.setSource({ f0: midiHz(s.pitch), pressure: s.breath, brightness: s.bright });
  v.gate(1);
}

// ── sound on/off, as in Expression ──
/** Never await this outside a click: while the browser blocks audio, the start stays pending. */
const startAudio = () => voice?.start().catch((e: unknown) => console.warn('[chimera] audio:', e));
const flipSound = () => {
  setSoundOn(!soundOn());
  if (soundOn()) void startAudio(); else void voice?.suspend();
};
/** The panel button. */
const toggleSound = () => {
  // On but still blocked: this click is what the browser waits for, so start, do not turn off.
  if (soundOn() && voice && !voice.running) { void startAudio(); return; }
  flipSound();
};
/** Any click or key press on the page starts the sound, if it is on and the browser blocked it.
 *  The sound button handles its own click. */
const onGesture = (ev: Event) => {
  if (ev.target instanceof Element && ev.target.closest('[data-sound-toggle]')) return;
  if (soundOn() && voice && !voice.running) void startAudio();
};

// ── the Push screen: head | note, pitch, mouth, breath | spectrum over the 8 knob values ──
function drawInfo(g: CanvasRenderingContext2D) {
  const x = 166, sounding = s.held.length > 0, r = voice?.readout();
  text(g, Number.isNaN(s.pitch) ? '·' : noteName(s.pitch), x, 26, { size: 32, weight: 700, align: 'left', color: sounding ? '#ffffff' : '#5b6672' });
  const hz = r && r.voicing > 0.2 ? r.f0 : Number.isNaN(s.pitch) ? NaN : midiHz(s.pitch);
  const cents = Number.isNaN(hz) || Number.isNaN(s.pitch) ? 0 : Math.round((hzMidi(hz) - Math.round(s.pitch)) * 100);
  text(g, Number.isNaN(hz) ? 'f0 ---' : `${hz.toFixed(1)} Hz`, x, 56, { size: 13, align: 'left', font: MONO, color: '#c8d0d8' });
  if (sounding) text(g, `${cents >= 0 ? '+' : ''}${cents}¢`, x + 196, 56, { size: 11, align: 'right', font: MONO, color: '#7c8792' });

  // the mouth: U O A E I with a marker at the blend
  const m = mouth(), mx = (i: number) => x + 10 + i * 44;
  g.fillStyle = '#1b2028';
  g.fillRect(mx(0), 90, mx(4) - mx(0), 2);
  MOUTH.forEach((v, i) => text(g, v, mx(i), 80, { size: 14, weight: 700, color: Math.abs(m - i) < 0.5 ? '#78dcff' : '#4b5560' }));
  g.fillStyle = '#78dcff';
  g.beginPath();
  g.arc(mx(0) + (m / 4) * (mx(4) - mx(0)), 91, 4, 0, Math.PI * 2);
  g.fill();

  // breath: lung pressure now (from the audio thread) against the 22 cmH2O top
  const lung = r ? r.pLung : sounding ? s.breath : 0;
  text(g, 'BREATH', x, 112, { size: 10, weight: 700, align: 'left', font: MONO, color: '#7c8792' });
  text(g, `${lung.toFixed(1)}`, x + 196, 112, { size: 11, align: 'right', font: MONO, color: '#c8d0d8' });
  g.fillStyle = '#1b2028';
  g.fillRect(x, 122, 196, 6);
  g.fillStyle = css(hsv(195 - clamp(lung / 22, 0, 1) * 160, 0.8, 1));
  g.fillRect(x, 122, 196 * clamp(lung / 22, 0, 1), 6);
}

function drawSpectrum(g: CanvasRenderingContext2D) {
  const x0 = 384, w = 568, y0 = 6, h = 66, n = s.spectrum.length, bw = w / n;
  g.fillStyle = '#0c0f14';
  g.fillRect(x0, y0, w, h);
  for (const f of [100, 200, 500, 1000, 2000]) {
    const fx = x0 + (Math.log(f / SPECTRUM_LO) / Math.log(SPECTRUM_HI / SPECTRUM_LO)) * w;
    g.fillStyle = '#1a1f27';
    g.fillRect(fx, y0, 1, h);
    text(g, f >= 1000 ? `${f / 1000}k` : `${f}`, fx + 3, y0 + h - 6, { size: 9, align: 'left', font: MONO, color: '#4b5560' });
  }
  if (!s.hasSpectrum) return;
  for (let j = 0; j < n; j++) {
    const k = clamp((s.spectrum[j]! + 100) / 80, 0, 1);
    if (k <= 0) continue;
    g.fillStyle = css(hsv(200 - k * 170, 0.85, 0.45 + 0.55 * k));
    g.fillRect(x0 + j * bw, y0 + h - k * h, Math.max(1, bw - 1), k * h);
  }
}

function drawKnobs(g: CanvasRenderingContext2D) {
  const set = settings();
  if (!set) return;
  const x0 = 384, cw = 71, y = 80;
  KNOBS.forEach((k, i) => {
    const x = x0 + i * cw, v = set[k.key], on = current?.touched.has(k.id);
    text(g, k.short, x + 2, y + 8, { size: 9, weight: 700, align: 'left', font: MONO, color: on ? '#ffffff' : css(rgbOf(k.color), 0.85) });
    const short = k.key === 'pressure' ? v.toFixed(1) : k.key === 'vibratoDepth' ? `${Math.round(v)}¢` : k.key === 'glide' ? `${Math.round(v * 1000)}ms` : pct(v);
    text(g, short, x + 2, y + 26, { size: 13, weight: 700, align: 'left', font: MONO, color: '#e8edf2' });
    g.fillStyle = '#1b2028';
    g.fillRect(x + 2, y + 40, cw - 10, 4);
    g.fillStyle = css(rgbOf(k.color));
    g.fillRect(x + 2, y + 40, (cw - 10) * clamp(knobPos(k, v), 0, 1), 4);
  });
}

function drawFooter(g: CanvasRenderingContext2D) {
  const labels = [...VOWEL_BUTTONS, !soundOn() ? 'Sound off' : audioRunning() ? 'Sound on' : 'Click page', 'Oct −', 'Oct +'];
  const near = nearVowel();
  labels.forEach((label, i) => {
    const on = (i < 5 && near === label) || (i === 5 && soundOn() && audioRunning());
    g.fillStyle = on ? css(chimera.color) : 'rgba(20,23,28,0.9)';
    g.fillRect(i * 120 + 4, 146, 112, 13);
    text(g, label, i * 120 + 60, 153, { size: 10, weight: 700, color: on ? '#050505' : '#c8d0d8' });
  });
}

function drawHud(g: CanvasRenderingContext2D) {
  const now = performance.now() / 1000;
  if (now > s.hud.until || !s.hud.label) return;
  g.save();
  g.globalAlpha = clamp((s.hud.until - now) / 0.35, 0, 1);
  const w = 300, h = 34, x = 384 + (568 - w) / 2, y = 88;
  g.fillStyle = 'rgba(10, 12, 16, 0.92)';
  g.fillRect(x, y, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  text(g, s.hud.label, x + 14, y + h / 2, { size: 11, weight: 700, color: '#94a3b8', align: 'left', font: MONO });
  text(g, s.hud.value, x + w - 14, y + h / 2, { size: 13, weight: 700, color: '#ffffff', align: 'right', font: MONO });
  g.restore();
}

export const chimera: Demo = {
  id: 'chimera',
  name: 'Chimera',
  color: [120, 220, 255],
  fullBleed: true,

  activate: (app) =>
    Effect.gen(function* () {
      current = app;
      yield* app.usePressureMode('mpe'); // restored to poly when we leave
      yield* app.useStripHost(); // we light the strip: the mouth position
      for (const k of KNOBS) app.twin.markEncoder(k.id, k.color);
      yield* Effect.acquireRelease(
        Effect.sync(() => { for (const t of ['pointerdown', 'keydown'] as const) addEventListener(t, onGesture, { capture: true, passive: true }); }),
        () => Effect.sync(() => { for (const t of ['pointerdown', 'keydown'] as const) removeEventListener(t, onGesture, { capture: true }); current = null; }),
      );
      const loaded = yield* Effect.tryPromise(() => loadChimera()).pipe(
        Effect.tapError((e) => Effect.sync(() => { console.error('[chimera] load:', e.cause); setStatus('failed'); })),
        Effect.option,
      );
      if (loaded._tag === 'None') return;
      const v = loaded.value;
      voice = v;
      if (!settings()) {
        const d = v.defaults;
        setSettings({ pressure: d.pressure, tension: d.tension, brightness: d.brightness, breathiness: d.breathiness, roughness: d.roughness, fry: d.fry, vibratoDepth: d.vibratoDepth, glide: d.glide });
      }
      // our settings win over the engine's (they survive a tab switch)
      v.setSource({ ...settings()! });
      v.setBody(body());
      v.setMouth(mouth());
      s.root = ROOT[body()];
      apply(app);
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          head = v.createHead(144, 3);
          return v.onRunningChange(setAudioRunning);
        }),
        (off) => Effect.sync(() => {
          off();
          s.held = [];
          s.landed.clear();
          v.gate(0);
          // the voice runs a physical model all the time: no CPU for it while another tab plays
          void v.suspend();
          head?.dispose();
          head = null;
        }),
      );
      setStatus('ready');
      setAudioRunning(v.running);
      // Sound starts at once if the browser allows it, else on the first click or key press.
      if (soundOn()) void startAudio(); // no wait: the browser may hold it until the first click
    }),

  onEvent(ev, app) {
    if (ev.type === 'pad') {
      const now = performance.now() / 1000, land = s.landed.get(ev.note);
      if (ev.action === 'down') { s.held = [...s.held.filter((n) => n !== ev.note), ev.note]; s.landed.set(ev.note, { at: now, y: 0.5 }); }
      else if (ev.action === 'up') { s.held = s.held.filter((n) => n !== ev.note); s.landed.delete(ev.note); }
      else if (ev.action === 'slide' && land && now - land.at < SLIDE_LANDING) land.y = ev.y;
      else if (ev.note !== s.held.at(-1)) return; // only the singing finger shapes the voice
      apply(app);
    } else if (ev.type === 'channelPressure') {
      apply(app);
    } else if (ev.type === 'encoder') {
      const k = KNOB_BY_ID.get(ev.id);
      if (k) { turnKnob(k, ev.delta); showKnob(k); }
    } else if (ev.type === 'touch' && ev.touched) {
      const k = KNOB_BY_ID.get(ev.id);
      if (k) showKnob(k);
    } else if (ev.type === 'strip') {
      setMouth(ev.value * (MOUTH.length - 1));
    } else if (ev.type === 'button' && ev.pressed) {
      const i = /^lower(\d)$/.exec(ev.id)?.[1];
      const vowel = i ? VOWEL_BUTTONS[+i - 1] : undefined;
      if (vowel) setVowel(vowel);
      if (ev.id === 'lower6') flipSound(); // a Push button is not a page click, so it cannot unblock audio
      if (ev.id === 'lower7' || ev.id === 'octaveDown') { s.root = Math.max(12, s.root - 12); showHud('OCTAVE', noteName(s.root)); }
      if (ev.id === 'lower8' || ev.id === 'octaveUp') { s.root = Math.min(72, s.root + 12); showHud('OCTAVE', noteName(s.root)); }
    }
  },

  tick(_t, dt, app) {
    const singing = s.held.at(-1);
    for (let note = 36; note <= 99; note++) {
      const pitch = padPitch(note), p = app.pads.get(note);
      app.leds.pad(note, note === singing && p ? hsv(195 - p.pressure * 150, 1 - Math.abs(p.x) * 0.4, 0.35 + 0.65 * p.pressure) : p?.down ? [40, 60, 80] : pitch % 12 === 0 ? [0, 90, 255] : inScale(pitch) ? [36, 36, 36] : null);
    }
    const near = nearVowel();
    VOWEL_BUTTONS.forEach((v, i) => app.leds.button(20 + i, near === v ? this.color : [20, 45, 60]));
    app.leds.button(25, !soundOn() ? [0, 40, 15] : audioRunning() ? [0, 220, 90] : [255, 150, 0]);
    app.leds.button(26, [60, 60, 60]);
    app.leds.button(27, [60, 60, 60]);
    // the strip: a dim mark at each vowel, the mouth bright
    const at = (mouth() / (MOUTH.length - 1)) * 30;
    app.leds.setStrip(Array.from({ length: 31 }, (_, i) => (Math.abs(i - at) < 0.75 ? 7 : Math.abs(i - at) < 1.5 ? 4 : i % 7.5 < 1 ? 1 : 0)));

    if (head) {
      head.frame(dt);
      if (panelCanvas) {
        const pc = panelCanvas.getContext('2d')!;
        if (panelCanvas.width !== head.canvas.width) panelCanvas.width = panelCanvas.height = head.canvas.width;
        pc.drawImage(head.canvas, 0, 0);
      }
    }
    s.hasSpectrum = !!voice && audioRunning() && voice.spectrum(s.spectrum, SPECTRUM_LO, SPECTRUM_HI);
  },

  draw(g) {
    if (head) g.drawImage(head.canvas, 8, 0, 144, 144);
    else text(g, status() === 'failed' ? 'CHIMERA did not load' : 'Loading CHIMERA', 80, 72, { size: 12, color: '#7c8792' });
    drawInfo(g);
    drawSpectrum(g);
    drawKnobs(g);
    drawFooter(g);
    drawHud(g);
  },

  Panel: () => {
    onCleanup(() => (panelCanvas = null));
    return (
      <>
        <h2>Chimera</h2>
        <p>
          A physical model of the human voice: lungs, vocal folds and a 3D airway, computed sample by sample. <a href="https://github.com/jamesondh/chimera-vocal-synth" target="_blank" rel="noreferrer">CHIMERA</a> by Jameson Hodge (MIT), in Rust compiled to WASM, here played from the Push.
        </p>
        <canvas ref={(c) => (panelCanvas = c)} class="chimera-head" aria-label="The singing head" />
        <Show when={status() !== 'failed'} fallback={<p class="muted">The engine did not load. Reload the page to try again.</p>}>
          <div class="row">
            <button type="button" data-sound-toggle classList={{ active: soundOn() && audioRunning() }} onClick={toggleSound}>{!soundOn() ? 'Sound off' : audioRunning() ? 'Sound on' : 'Start sound'}</button>
            <Show when={soundOn() && !audioRunning() && status() === 'ready'}><span class="muted">Click anywhere on the page to start the sound (a browser rule).</span></Show>
            <Show when={status() === 'loading'}><span class="muted">Loading the engine…</span></Show>
          </div>
          <div class="row">
            <For each={VOWEL_BUTTONS}>{(v) => <button type="button" classList={{ active: MOUTH[Math.round(mouth())] === v && Math.abs(mouth() - Math.round(mouth())) < 0.12 }} onClick={() => setVowel(v)}>{v}</button>}</For>
            <span class="muted">or the touch strip</span>
          </div>
          <div class="row">
            <For each={BODIES}>{(b) => <button type="button" classList={{ active: body() === b }} onClick={() => setBody(b)}>{BODY_LABEL[b]}</button>}</For>
          </div>
          <Show when={settings()}>
            {(set) => (
              <div class="card-box">
                <div class="stat-grid">
                  <For each={KNOBS}>
                    {(k, i) => (
                      <>
                        <span>{i() + 1} · {k.label.charAt(0) + k.label.slice(1).toLowerCase()}</span>
                        <label class="toggle">
                          <input type="range" class="range-input" min="0" max="1" step="0.001" value={knobPos(k, set()[k.key])}
                            onInput={(e) => { const u = +e.currentTarget.value; setKnob(k, k.log ? k.min * (k.max / k.min) ** u : k.min + u * (k.max - k.min)); }} />
                          <span class="v">{k.format(set()[k.key])}</span>
                        </label>
                      </>
                    )}
                  </For>
                  <span>Roll bend range</span>
                  <label class="toggle">
                    <input type="range" class="range-input" min="0" max="12" step="1" value={bendRange()} onInput={(e) => { setBendRange(+e.currentTarget.value); apply(current); }} />
                    <span class="v">{bendRange()} st</span>
                  </label>
                </div>
              </div>
            )}
          </Show>
        </Show>
        <p class="muted">Pads play one voice in fourths (blue = C); the last pad held sings. Press harder for more breath, roll left/right to bend, slide up/down from where you landed for brightness. Knobs 1-8 shape the voice (knob 1 is the breath at a light touch). The touch strip moves the mouth from U to I; lower buttons 1-5 jump to A E I O U, 6 turns the sound on and off, 7 and 8 shift octaves.</p>
      </>
    );
  },
};
