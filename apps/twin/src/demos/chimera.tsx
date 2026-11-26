// Chimera: CHIMERA, a physical model of the human voice by Jameson Hodge (MIT,
// github.com/jamesondh/chimera-vocal-synth), played from the Push. Its 2D head (a cut through the
// middle of the head, as on chimera.audio) sings on the Push screen. Pads (MPE, in fourths) play
// chords: each pad held has a whole voice of its own (1 to 4 voices, Page left and right), and its
// finger shapes that voice: roll bends the pitch, pressure is the breath, slide the brightness.
// With one voice the last pad sings, as it did.
// Knobs move the throat (jaw, tongue, lips, soft palate, larynx, body size); with Shift held they
// shape the voice. The touch strip moves the mouth through U O A E I, lower buttons 3-7 jump to a
// vowel.
import { createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import { Effect } from 'effect';
import { css, hsv, type RGB } from '@push3/protocol';
import { loadChimera, MAX_VOICES, MOUTH, type Articulation, type ArticKey, type BodyMix, type Chimera, type HandleId, type Head, type VoiceSettings, type Vowel } from '@push3/chimera';
import { MONO, text } from '../engine/screen.ts';
import type { Demo, Engine } from '../engine/engine.ts';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (p: number) => NAMES[((Math.round(p) % 12) + 12) % 12]! + (Math.floor(Math.round(p) / 12) - 1);
const inScale = (p: number) => [0, 2, 4, 5, 7, 9, 11].includes(p % 12);
const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);
const hzMidi = (f: number) => 69 + 12 * Math.log2(f / 440);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
/** Lower buttons 3-7, in the order people say them; the strip runs U O A E I (see MOUTH). Buttons
 *  1 and 2 sit under the head and stay free. */
const VOWEL_BUTTONS: ReadonlyArray<Vowel> = ['A', 'E', 'I', 'O', 'U'];
const FIRST_VOWEL_BUTTON = 3;
const SPECTRUM_LO = 60, SPECTRUM_HI = 5000;
// The finger's expression, as CHIMERA's plugin maps MPE (crates/chimera-plugin/src/core.rs):
/** pressure adds up to this share of the breath knob (the knob is the breath at a light touch) */
const PRESSURE_DEPTH = 0.75;
/** brightness per unit of slide, counted from where the finger landed */
const SLIDE_DEPTH = 1;
/** a slide this soon after its note starts (s) is where the finger landed */
const SLIDE_LANDING = 0.05;
/** The size knob rebuilds the voice (a new airway) once it rests this long (ms), or on release. */
const SIZE_SETTLE = 400;

// ── the knobs: the throat, or (Shift held) the voice ──
interface Knob {
  readonly id: string;
  readonly label: string;
  readonly short: string;
  readonly color: number;
  /** the handle on the head this knob moves */
  readonly ring?: HandleId;
  readonly min: number;
  readonly max: number;
  /** change per encoder tick: added, or (log) multiplied */
  readonly step: number;
  readonly log?: boolean;
  readonly get: () => number | undefined;
  readonly set: (v: number) => void;
  readonly format: (v: number) => string;
  /** a shorter value for the cells on the screen */
  readonly brief?: (v: number) => string;
}
const pct = (v: number) => `${Math.round(v * 100)}%`;
const cm = (v: number) => `${v.toFixed(2)} cm`;
const signedCm = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)} cm`;

// ── state ──
let voice: Chimera | null = null;
let head: Head | null = null;
let panelHead: Head | null = null;
let current: Engine | null = null;
/** The page's copy of the head (the Panel's canvas), drawn each frame while the panel is open. */
let panelCanvas: HTMLCanvasElement | null = null;
const [status, setStatus] = createSignal<'loading' | 'ready' | 'failed'>('loading');
/** Sound is on unless the user turns it off. */
const [soundOn, setSoundOn] = createSignal(true);
/** The browser lets audio start only after a click or key press on the page; until then this is false. */
const [audioRunning, setAudioRunning] = createSignal(false);
/** The voice knobs' values (breath and brightness are the base the fingers play around). */
type SourceKey = Exclude<keyof VoiceSettings, 'f0'>;
const [settings, setSettings] = createSignal<Record<SourceKey, number> | null>(null);
/** Where the articulators are going. */
const [artic, setArticSignal] = createSignal<Articulation | null>(null);
/** The mouth on the U O A E I line, or null once a knob has moved an articulator away from it. */
const [mouth, setMouthSignal] = createSignal<number | null>(MOUTH.indexOf('A'));
/** Body size: 0 adult male, 0.5 adult female, 1 child (blends between). */
const [size, setSizeSignal] = createSignal(0);
const [bendRange, setBendRange] = createSignal(2);
/** How many voices play: two pads are a chord with no setting to find. (Each voice is a whole
 *  engine, so more of them cost a slow computer more.) */
const [voices, setVoicesSignal] = createSignal(2);
const s = {
  root: 36,
  /** per held pad: when it went down (s) and the slide it landed on */
  landed: new Map<number, { at: number; y: number }>(),
  /** the pitches that sound now, low to high */
  notes: [] as number[],
  /** what the newest voice plays now (the one the head shows) */
  pitch: NaN,
  breath: 0,
  bright: 0,
  spectrum: new Float32Array(100),
  hasSpectrum: false,
  hud: { label: '', value: '', until: 0 },
  /** the knob turned last, and when (s): its handle stays ringed a moment */
  lastKnob: null as Knob | null,
  lastAt: 0,
  sizeTimer: 0 as ReturnType<typeof setTimeout> | 0,
};

const bodyOf = (z: number): BodyMix => ({ female: Math.min(1, 2 * z), child: Math.max(0, 2 * z - 1) });
const sizeName = (z: number) => (z < 0.01 ? 'Male' : Math.abs(z - 0.5) < 0.01 ? 'Female' : z > 0.99 ? 'Child' : z < 0.5 ? `${Math.round(z * 200)}% female` : `${Math.round((z - 0.5) * 200)}% child`);

function setSize(z: number, rebuild: boolean) {
  z = clamp(Math.round(z * 100) / 100, 0, 1);
  setSizeSignal(z);
  if (s.sizeTimer) clearTimeout(s.sizeTimer);
  s.sizeTimer = 0;
  if (rebuild) z = Math.round(z * 20) / 20; // CHIMERA's body pad: 5 % steps
  voice?.setBody(bodyOf(z), rebuild);
  if (!rebuild) s.sizeTimer = setTimeout(() => setSize(size(), true), SIZE_SETTLE);
  else setSizeSignal(z);
}

const range = (k: ArticKey) => voice?.articRange[k] ?? { min: 0, max: 1 };
function moveArtic(k: ArticKey, v: number) {
  if (!voice) return;
  voice.setArtic({ [k]: v });
  setArticSignal(voice.articulation());
  setMouthSignal(null);
}
const throatKnob = (id: string, key: ArticKey, label: string, short: string, color: number, ring: HandleId, format: (v: number) => string, brief?: (v: number) => string): Knob => ({
  id, label, short, color, ring, format, brief,
  get min() { return range(key).min; },
  get max() { return range(key).max; },
  get step() { return (range(key).max - range(key).min) / 120; },
  get: () => artic()?.[key],
  set: (v) => moveArtic(key, v),
});
/** where a value sits in its range, as a share (the tongue's own units mean little to a player) */
const share = (key: ArticKey) => (v: number) => `${Math.round(((v - range(key).min) / (range(key).max - range(key).min)) * 100)}%`;

const THROAT: ReadonlyArray<Knob> = [
  throatKnob('e1', 'jaw', 'JAW OPEN', 'JAW', 0xf87171, 'jaw', cm, (v) => v.toFixed(1)),
  throatKnob('e2', 'tbX', 'TONGUE BACK / FRONT', 'TNG FRONT', 0x4ade80, 'tongue', share('tbX')),
  throatKnob('e3', 'tbY', 'TONGUE LOW / HIGH', 'TNG HIGH', 0x86efac, 'tongue', share('tbY')),
  throatKnob('e4', 'lipAp', 'LIPS OPEN', 'LIPS', 0xf472b6, 'lips', (v) => (v <= 0 ? 'CLOSED' : cm(v)), (v) => (v <= 0 ? 'SHUT' : v.toFixed(1))),
  throatKnob('e5', 'lipProt', 'LIPS FORWARD', 'LIPS FWD', 0xf9a8d4, 'lips', cm, (v) => v.toFixed(1)),
  throatKnob('e6', 'velum', 'SOFT PALATE (NOSE)', 'NOSE', 0xe5e7eb, 'velum', (v) => (v <= 0 ? 'SHUT' : `${v.toFixed(2)} cm²`), (v) => (v <= 0 ? 'SHUT' : v.toFixed(2))),
  throatKnob('e7', 'larynx', 'LARYNX DOWN / UP', 'LARYNX', 0x60a5fa, 'larynx', signedCm, (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`),
  {
    id: 'e8', label: 'BODY SIZE', short: 'SIZE', color: 0xfbbf24, min: 0, max: 1, step: 0.01,
    get: () => size(), set: (v) => setSize(v, false), format: sizeName,
    brief: (z) => (z < 0.01 ? 'MALE' : Math.abs(z - 0.5) < 0.01 ? 'FEM' : z > 0.99 ? 'CHILD' : z < 0.5 ? `F${Math.round(z * 200)}` : `C${Math.round((z - 0.5) * 200)}`),
  },
];

const sourceKnob = (id: string, key: SourceKey, label: string, short: string, color: number, min: number, max: number, step: number, format: (v: number) => string, log = false, brief?: (v: number) => string): Knob => ({
  id, label, short, color, min, max, step, log, format, brief,
  get: () => settings()?.[key],
  set: (v) => {
    const cur = settings();
    if (!cur) return;
    setSettings({ ...cur, [key]: clamp(v, min, max) });
    // breath and brightness are what the finger plays around: apply() mixes them in
    if (key === 'pressure' || key === 'brightness') apply(current);
    else voice?.setSource({ [key]: clamp(v, min, max) });
  },
});
const VOICE: ReadonlyArray<Knob> = [
  sourceKnob('e1', 'pressure', 'BREATH PRESSURE', 'BREATH', 0x38bdf8, 2, 22, 0.15, (v) => `${v.toFixed(1)} cmH₂O`, false, (v) => v.toFixed(1)),
  sourceKnob('e2', 'tension', 'PRESSED', 'PRESS', 0xf472b6, 0, 1, 0.01, pct),
  sourceKnob('e3', 'brightness', 'BRIGHTNESS', 'BRIGHT', 0xfacc15, 0, 1, 0.01, pct),
  sourceKnob('e4', 'breathiness', 'BREATHINESS', 'AIRY', 0x7de6ff, 0, 1, 0.01, pct),
  sourceKnob('e5', 'roughness', 'ROUGHNESS', 'ROUGH', 0xff551e, 0, 1, 0.01, pct),
  sourceKnob('e6', 'fry', 'VOCAL FRY', 'FRY', 0xc084fc, 0, 1, 0.01, pct),
  sourceKnob('e7', 'vibratoDepth', 'VIBRATO DEPTH', 'VIBRATO', 0x34d399, 0, 120, 1, (v) => `${Math.round(v)} cents`, false, (v) => `${Math.round(v)}¢`),
  sourceKnob('e8', 'glide', 'GLIDE', 'GLIDE', 0x60a5fa, 0.005, 0.6, 1.04, (v) => `${Math.round(v * 1000)} ms`, true, (v) => `${Math.round(v * 1000)}ms`),
];

const voicePage = (app: Engine | null) => !!app?.held.has('shift');
const page = (app: Engine | null) => (voicePage(app) ? VOICE : THROAT);
const knobPos = (k: Knob, v: number) => (k.log ? Math.log(v / k.min) / Math.log(k.max / k.min) : (v - k.min) / (k.max - k.min));
const rgbOf = (c: number): RGB => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const markKnobs = (app: Engine) => { for (const k of page(app)) app.markEncoder(k.id, k.color); };

const pitchOf = (rowFromTop: number, col: number) => s.root + col + (7 - rowFromTop) * 5; // rows in fourths, like Push
const padPitch = (note: number) => { const i = note - 36; return pitchOf(7 - Math.floor(i / 8), i % 8); };

const showHud = (label: string, value: string) => { s.hud = { label, value, until: performance.now() / 1000 + 1.9 }; };
const showKnob = (k: Knob) => { const v = k.get(); if (v !== undefined) showHud(k.label, k.format(v)); };
const turnKnob = (k: Knob, delta: number) => {
  const v = k.get();
  if (v === undefined) return;
  k.set(clamp(k.log ? v * k.step ** delta : v + delta * k.step, k.min, k.max));
  s.lastKnob = k;
  s.lastAt = performance.now() / 1000;
};
/** The handle to ring on the head: the knob touched, or the one turned in the last moment. */
function ring(app: Engine | null): HandleId | null {
  const touched = page(app).find((k) => app?.touched.has(k.id));
  if (touched) return touched.ring ?? null;
  return s.lastKnob && performance.now() / 1000 - s.lastAt < 1.5 ? (s.lastKnob.ring ?? null) : null;
}

function setMouth(pos: number) {
  if (!voice) return;
  setMouthSignal(clamp(pos, 0, MOUTH.length - 1));
  voice.setMouth(mouth()!);
  setArticSignal(voice.articulation());
}
const setVowel = (v: Vowel) => { setMouth(MOUTH.indexOf(v)); showHud('MOUTH', v); };
const nearVowel = () => { const m = mouth(); if (m === null) return null; const i = Math.round(m); return Math.abs(m - i) < 0.12 ? MOUTH[i] : null; };

/** The pad a voice sounds: the last one of those it holds. */
const padOf = (i: number) => voice?.keys.keys[i]?.at(-1);
/** This pad is the one its voice sounds. */
const sounds = (note: number) => { const i = voice?.keys.voiceOf(note); return i !== undefined && padOf(i) === note; };

/** Play each voice's pad: its pitch with the roll, its pressure as breath, its slide as brightness.
 *  `start`: the voice whose note starts from silence, which goes to its pitch with no glide. */
function apply(app: Engine | null, start = -1) {
  const v = voice, set = settings();
  if (!v || !set) return;
  const newest = v.keys.newest(), notes: number[] = [];
  for (let i = 0; i < v.keys.count; i++) {
    const note = padOf(i), p = note === undefined ? undefined : app?.pads.get(note);
    if (note === undefined || !p) {
      // no finger: the knobs' own breath and brightness, for the release
      v.setVoice(i, { pressure: set.pressure, brightness: set.brightness });
      v.gate(0, i);
      continue;
    }
    const pitch = padPitch(note) + p.x * bendRange();
    const breath = Math.min(22, set.pressure * (1 + PRESSURE_DEPTH * p.pressure));
    const bright = clamp(set.brightness + (p.y - (s.landed.get(note)?.y ?? p.y)) * SLIDE_DEPTH, 0, 1);
    v.setVoice(i, { f0: midiHz(pitch), pressure: breath, brightness: bright }, i === start);
    v.gate(1, i);
    notes.push(pitch);
    if (i === newest) { s.pitch = pitch; s.breath = breath; s.bright = bright; }
  }
  s.notes = notes.sort((a, b) => a - b);
  if (newest === null) { s.breath = set.pressure; s.bright = set.brightness; }
  else v.showVoice(newest); // the head shows the newest note's voice, then its release
}

/** How many voices play. The pads still down are let go: a voice taken away would keep its pad. */
function setVoices(n: number) {
  n = clamp(Math.round(n), 1, MAX_VOICES);
  showHud('VOICES', `${n}`);
  if (n === voices()) return;
  setVoicesSignal(n);
  s.landed.clear();
  voice?.setVoices(n);
  apply(current);
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

// ── the Push screen: head (full height) | note, pitch, mouth, breath | spectrum over the knobs ──
const HEAD_W = 236, INFO_X = 248, RIGHT_X = 456, RIGHT_W = 496;

function drawInfo(g: CanvasRenderingContext2D) {
  const x = INFO_X, w = 196, sounding = s.notes.length > 0, r = voice?.readout();
  // a chord's notes, low to high, smaller the more there are; with no pad down, the last note
  const names = sounding ? s.notes.map(noteName).join(' ') : Number.isNaN(s.pitch) ? '·' : noteName(s.pitch);
  text(g, names, x, 26, { size: [32, 32, 26, 20, 16][s.notes.length] ?? 16, weight: 700, align: 'left', color: sounding ? '#ffffff' : '#5b6672' });
  const hz = r && r.voicing > 0.2 ? r.f0 : Number.isNaN(s.pitch) ? NaN : midiHz(s.pitch);
  const cents = Number.isNaN(hz) || Number.isNaN(s.pitch) ? 0 : Math.round((hzMidi(hz) - Math.round(s.pitch)) * 100);
  text(g, Number.isNaN(hz) ? 'f0 ---' : `${hz.toFixed(1)} Hz`, x, 56, { size: 13, align: 'left', font: MONO, color: '#c8d0d8' });
  if (sounding) text(g, `${cents >= 0 ? '+' : ''}${cents}¢`, x + w, 56, { size: 11, align: 'right', font: MONO, color: '#7c8792' });

  // the mouth: U O A E I with a marker at the blend (none once a knob has moved the throat)
  const m = mouth(), mx = (i: number) => x + 10 + i * 44;
  g.fillStyle = '#1b2028';
  g.fillRect(mx(0), 90, mx(4) - mx(0), 2);
  MOUTH.forEach((v, i) => text(g, v, mx(i), 80, { size: 14, weight: 700, color: m !== null && Math.abs(m - i) < 0.5 ? '#78dcff' : '#4b5560' }));
  if (m !== null) {
    g.fillStyle = '#78dcff';
    g.beginPath();
    g.arc(mx(0) + (m / 4) * (mx(4) - mx(0)), 91, 4, 0, Math.PI * 2);
    g.fill();
  }

  // breath: lung pressure now (from the audio thread) against the 22 cmH2O top
  const lung = r ? r.pLung : sounding ? s.breath : 0;
  text(g, 'BREATH', x, 112, { size: 10, weight: 700, align: 'left', font: MONO, color: '#7c8792' });
  text(g, `${lung.toFixed(1)}`, x + w, 112, { size: 11, align: 'right', font: MONO, color: '#c8d0d8' });
  g.fillStyle = '#1b2028';
  g.fillRect(x, 122, w, 6);
  g.fillStyle = css(hsv(195 - clamp(lung / 22, 0, 1) * 160, 0.8, 1));
  g.fillRect(x, 122, w * clamp(lung / 22, 0, 1), 6);
}

function drawSpectrum(g: CanvasRenderingContext2D) {
  const x0 = RIGHT_X, w = RIGHT_W, y0 = 6, h = 62, n = s.spectrum.length, bw = w / n;
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
  const cw = RIGHT_W / 8, y = 76, knobs = page(current);
  text(g, voicePage(current) ? 'VOICE (SHIFT)' : 'THROAT · SHIFT: VOICE', RIGHT_X + RIGHT_W, y - 1, { size: 8, weight: 700, align: 'right', font: MONO, color: '#4b5560' });
  text(g, `VOICES ${voices()} · PAGE < >`, RIGHT_X + 2, y - 1, { size: 8, weight: 700, align: 'left', font: MONO, color: '#4b5560' });
  knobs.forEach((k, i) => {
    const x = RIGHT_X + i * cw, v = k.get(), on = current?.touched.has(k.id);
    text(g, k.short, x + 2, y + 10, { size: 9, weight: 700, align: 'left', font: MONO, color: on ? '#ffffff' : css(rgbOf(k.color), 0.9) });
    if (v === undefined) return;
    text(g, (k.brief ?? k.format)(v), x + 2, y + 28, { size: 13, weight: 700, align: 'left', font: MONO, color: '#e8edf2' });
    g.fillStyle = '#1b2028';
    g.fillRect(x + 2, y + 42, cw - 10, 4);
    g.fillStyle = css(rgbOf(k.color));
    g.fillRect(x + 2, y + 42, (cw - 10) * clamp(knobPos(k, v), 0, 1), 4);
  });
}

function drawFooter(g: CanvasRenderingContext2D) {
  const labels = [...VOWEL_BUTTONS, !soundOn() ? 'Sound off' : audioRunning() ? 'Sound on' : 'Click page'];
  const near = nearVowel();
  labels.forEach((label, j) => {
    const i = FIRST_VOWEL_BUTTON - 1 + j, on = (j < 5 && near === label) || (j === 5 && soundOn() && audioRunning());
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
  const w = 330, h = 34, x = RIGHT_X + (RIGHT_W - w) / 2, y = 90;
  g.fillStyle = 'rgba(10, 12, 16, 0.92)';
  g.fillRect(x, y, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  text(g, s.hud.label, x + 14, y + h / 2, { size: 11, weight: 700, color: '#94a3b8', align: 'left', font: MONO });
  text(g, s.hud.value, x + w - 14, y + h / 2, { size: 13, weight: 700, color: '#ffffff', align: 'right', font: MONO });
  g.restore();
}

/** Where the head will be, while the engine downloads (about 450 kB): three dots that rise in turn. */
function drawLoading(g: CanvasRenderingContext2D, t: number) {
  if (status() === 'failed') { text(g, 'No CHIMERA', HEAD_W / 2, 80, { size: 12, color: '#7c8792' }); return; }
  for (let i = 0; i < 3; i++) {
    const k = Math.max(0, Math.sin(t * 5 - i * 0.8));
    g.fillStyle = `rgba(120, 220, 255, ${0.22 + 0.6 * k})`;
    g.beginPath();
    g.arc(HEAD_W / 2 - 18 + i * 18, 68 - k * 6, 4, 0, Math.PI * 2);
    g.fill();
  }
  text(g, 'Loading the voice', HEAD_W / 2, 100, { size: 12, color: '#7c8792' });
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
      markKnobs(app);
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
      // our settings win over the engine's (they survive a tab switch); breath and brightness
      // are each voice's own, which apply() sends
      const { pressure: _breath, brightness: _bright, ...dials } = settings()!;
      v.setSource(dials);
      v.setVoices(voices());
      v.setBody(bodyOf(size()), true);
      const a = artic(), m = mouth();
      if (a && m === null) v.setArtic(a);
      else setMouth(m ?? MOUTH.indexOf('A'));
      setArticSignal(v.articulation());
      apply(app);
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          head = v.createHead(HEAD_W, 160, 2, { align: 'left' });
          return v.onRunningChange(setAudioRunning);
        }),
        (off) => Effect.sync(() => {
          off();
          s.landed.clear();
          s.notes = [];
          v.keys.clear();
          for (let i = 0; i < v.keys.count; i++) v.gate(0, i);
          if (s.sizeTimer) setSize(size(), true);
          // the voice runs a physical model all the time: no CPU for it while another tab plays
          void v.suspend();
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
      const keys = voice?.keys;
      if (!keys) return; // the engine is still loading
      const now = performance.now() / 1000, land = s.landed.get(ev.note);
      let start = -1;
      if (ev.action === 'down') {
        const i = keys.pick(ev.note);
        // a chord's voice that starts from silence starts on its pitch; one voice glides from
        // its last note, as it did
        if (keys.count > 1 && !keys.busy(i)) start = i;
        keys.press(ev.note, i);
        s.landed.set(ev.note, { at: now, y: 0.5 });
      } else if (ev.action === 'up') { keys.lift(ev.note); s.landed.delete(ev.note); }
      else if (ev.action === 'slide' && land && now - land.at < SLIDE_LANDING) land.y = ev.y;
      else if (!sounds(ev.note)) return; // only the finger a voice sounds shapes that voice
      apply(app, start);
    } else if (ev.type === 'channelPressure') {
      apply(app);
    } else if (ev.type === 'encoder') {
      const k = page(app).find((k) => k.id === ev.id);
      if (k) { turnKnob(k, ev.delta); showKnob(k); }
    } else if (ev.type === 'touch') {
      const k = page(app).find((k) => k.id === ev.id);
      if (k && ev.touched) showKnob(k);
      if (k?.id === 'e8' && !ev.touched && s.sizeTimer) setSize(size(), true); // the size knob let go: rebuild now
    } else if (ev.type === 'strip') {
      setMouth(ev.value * (MOUTH.length - 1));
    } else if (ev.type === 'button') {
      if (ev.id === 'shift') markKnobs(app); // the knobs change page while Shift is held
      if (!ev.pressed) return;
      const i = /^lower(\d)$/.exec(ev.id)?.[1];
      const vowel = i ? VOWEL_BUTTONS[+i - FIRST_VOWEL_BUTTON] : undefined;
      if (vowel) setVowel(vowel);
      if (ev.id === 'lower8') flipSound(); // a Push button is not a page click, so it cannot unblock audio
      if (ev.id === 'octaveDown') { s.root = Math.max(12, s.root - 12); showHud('OCTAVE', noteName(s.root)); }
      if (ev.id === 'octaveUp') { s.root = Math.min(72, s.root + 12); showHud('OCTAVE', noteName(s.root)); }
      if (ev.id === 'pageLeft') setVoices(voices() - 1);
      if (ev.id === 'pageRight') setVoices(voices() + 1);
    }
  },

  tick(_t, dt, app) {
    for (let note = 36; note <= 99; note++) {
      const pitch = padPitch(note), p = app.pads.get(note);
      app.leds.pad(note, p && sounds(note) ? hsv(195 - p.pressure * 150, 1 - Math.abs(p.x) * 0.4, 0.35 + 0.65 * p.pressure) : p?.down ? [40, 60, 80] : pitch % 12 === 0 ? [0, 90, 255] : inScale(pitch) ? [36, 36, 36] : null);
    }
    const near = nearVowel();
    app.leds.button(20, null);
    app.leds.button(21, null);
    VOWEL_BUTTONS.forEach((v, i) => app.leds.button(20 + FIRST_VOWEL_BUTTON - 1 + i, near === v ? this.color : [20, 45, 60]));
    app.leds.button(27, !soundOn() ? [0, 40, 15] : audioRunning() ? [0, 220, 90] : [255, 150, 0]);
    // the strip: a dim mark at each vowel, the mouth bright
    const m = mouth(), at = m === null ? -9 : (m / (MOUTH.length - 1)) * 30;
    app.leds.setStrip(Array.from({ length: 31 }, (_, i) => (Math.abs(i - at) < 0.75 ? 7 : Math.abs(i - at) < 1.5 ? 4 : i % 7.5 < 1 ? 1 : 0)));

    const r = ring(app);
    head?.frame(dt, r);
    if (panelCanvas && voice) {
      const w = Math.max(1, Math.round(panelCanvas.clientWidth)), h = Math.max(1, Math.round(panelCanvas.clientHeight)), dpr = Math.min(2, devicePixelRatio || 1);
      if (!panelHead || panelCanvas.width !== Math.round(w * dpr) || panelCanvas.height !== Math.round(h * dpr)) {
        panelCanvas.width = Math.round(w * dpr);
        panelCanvas.height = Math.round(h * dpr);
        panelHead = voice.createHead(w, h, dpr);
      }
      panelHead.frame(dt, r);
      panelCanvas.getContext('2d')!.drawImage(panelHead.canvas, 0, 0);
    }
    s.hasSpectrum = !!voice && audioRunning() && voice.spectrum(s.spectrum, SPECTRUM_LO, SPECTRUM_HI);
  },

  draw(g, _app, t) {
    if (head) g.drawImage(head.canvas, 0, 0, HEAD_W, 160);
    else drawLoading(g, t);
    drawInfo(g);
    drawSpectrum(g);
    drawKnobs(g);
    drawFooter(g);
    drawHud(g);
  },

  Panel: () => {
    onCleanup(() => { panelCanvas = null; panelHead = null; });
    // k.get() reads the signals, so each value follows its knob
    const sliders = (knobs: ReadonlyArray<Knob>, extra?: JSX.Element) => (
      <div class="stat-grid">
        <For each={knobs}>
          {(k, i) => {
            const v = () => k.get();
            return (
              <>
                <span>{i() + 1} · {k.label.charAt(0) + k.label.slice(1).toLowerCase()}</span>
                <label class="toggle">
                  <input type="range" class="range-input" min="0" max="1" step="0.001" value={clamp(knobPos(k, v() ?? k.min), 0, 1)}
                    onInput={(e) => { const u = +e.currentTarget.value; k.set(k.log ? k.min * (k.max / k.min) ** u : k.min + u * (k.max - k.min)); s.lastKnob = k; s.lastAt = performance.now() / 1000; }}
                    onChange={() => { if (k === THROAT[7]) setSize(size(), true); }} />
                  <span class="v">{v() === undefined ? '' : k.format(v()!)}</span>
                </label>
              </>
            );
          }}
        </For>
        {extra}
      </div>
    );
    return (
      <>
        <h2>Chimera</h2>
        <p>
          A physical model of the human voice: lungs, vocal folds and the airway of the throat and mouth, computed sample by sample. <a href="https://github.com/jamesondh/chimera-vocal-synth" target="_blank" rel="noreferrer">CHIMERA</a> by Jameson Hodge (MIT), in Rust compiled to WASM, here played from the Push.
        </p>
        <div class="chimera-head-box">
          <canvas ref={(c) => (panelCanvas = c)} class="chimera-head" aria-label="The singing head, cut through the middle" />
          <Show when={status() === 'loading'}>
            <div class="chimera-loading" role="status"><span class="dots" aria-hidden="true"><i /><i /><i /></span>Loading the voice</div>
          </Show>
        </div>
        <Show when={status() !== 'failed'} fallback={<p class="muted">The engine did not load. Reload the page to try again.</p>}>
          <div class="row">
            <button type="button" data-sound-toggle classList={{ active: soundOn() && audioRunning() }} onClick={toggleSound}>{!soundOn() ? 'Sound off' : audioRunning() ? 'Sound on' : 'Start sound'}</button>
            <Show when={soundOn() && !audioRunning() && status() === 'ready'}><span class="muted">Click anywhere on the page to start the sound (a browser rule).</span></Show>
          </div>
          <div class="row">
            <For each={VOWEL_BUTTONS}>{(v) => <button type="button" classList={{ active: nearVowel() === v }} onClick={() => setVowel(v)}>{v}</button>}</For>
            <span class="muted">or the touch strip</span>
          </div>
          <div class="row">
            <span class="muted">Voices</span>
            <For each={Array.from({ length: MAX_VOICES }, (_, i) => i + 1)}>{(n) => <button type="button" classList={{ active: voices() === n }} onClick={() => setVoices(n)}>{n}</button>}</For>
            <span class="muted">or Page left and right</span>
          </div>
          <Show when={artic()}>
            <b class="section-label">Throat (knobs)</b>
            <div class="card-box">{sliders(THROAT)}</div>
          </Show>
          <Show when={settings()}>
            <b class="section-label">Voice (Shift + knobs)</b>
            <div class="card-box">
              {sliders(VOICE, <>
                <span>Roll bend range</span>
                <label class="toggle">
                  <input type="range" class="range-input" min="0" max="12" step="1" value={bendRange()} onInput={(e) => { setBendRange(+e.currentTarget.value); apply(current); }} />
                  <span class="v">{bendRange()} st</span>
                </label>
              </>)}
            </div>
          </Show>
        </Show>
        <p class="muted">Pads play in fourths (blue = C). Each pad held sings with a voice of its own, up to the number of Voices (1 to {MAX_VOICES}: the Page left and right buttons); with more pads than voices, the oldest voice takes the new pad. Each finger shapes its own voice: press harder for more breath, roll left/right to bend, slide up/down from where you landed for brightness. Knobs 1-8 move the throat: jaw, tongue, lips, soft palate, larynx and body size; hold Shift for the voice (knob 1 is then the breath at a light touch). The touch strip moves the mouth from U to I; lower buttons 3-7 jump to A E I O U, 8 turns the sound on and off. The Octave buttons shift the pads.</p>
      </>
    );
  },
};
