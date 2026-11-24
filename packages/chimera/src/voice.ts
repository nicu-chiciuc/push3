// Our glue around the upstream CHIMERA modules: one voice played by hand (we send `setSource`,
// `setArtic` and `gate` ourselves, as CHIMERA's store does for its keyboard and its head's
// handles; pressure and brightness glide in our worklet, see worklet.ts) and CHIMERA's 2D head.
// The head's per-frame code follows upstream/src/ui/components/AnatomyView.tsx (not copied: it is
// React), without the dragging and the readouts.
// Import this module only after initChimera() has resolved (see index.ts).
import type { Chimera, Head, Readout, VoiceSettings } from './api.ts';
import { ARTIC_KEYS, MOUTH, type ArticKey, type Articulation, type BodyMix, type HandleId } from './settings.ts';
import { VoiceEngine } from './engine.ts';
import { ARTIC_SPECS, DEFAULT_SOURCE, NEUTRAL, restTip, type HumanArtic } from '../upstream/src/wasm/engine.ts';
import { VoiceModel } from '../upstream/src/ui/analysis.ts';
import { PRESETS, bodyKey, defaultF0, sameBody } from '../upstream/src/ui/body.ts';
import { AnatomyRenderer, type ViewFlags } from '../upstream/src/ui/render/anatomy.ts';
import { VIEW } from '../upstream/src/ui/render/profile.ts';
import { Glow } from '../upstream/src/ui/render/vector.ts';
import type { TelemetryMessage } from '../upstream/src/worklet/protocol.ts';

/** The calibrated vowel behind each mouth position (IPA): "A" is the open back vowel of "hod". */
const MOUTH_IPA: Record<(typeof MOUTH)[number], string> = { U: 'u', O: 'o', A: 'ɑ', E: 'e', I: 'i' };
const VIEW_FLAGS: ViewFlags = { pressure: true, particles: true, grid: false, calipers: true };
/** What we frame (body cm): CHIMERA's view heights (the larynx to above the eyes), and the whole
 *  head across (its view is narrower: it cuts the back of the skull and keeps room in front of the
 *  face for readouts). Measured on the adult male profile, the largest: x -8.8 .. 9.3 cm. */
const BOX = { x0: -9.0, x1: 9.4, y0: VIEW.y0, y1: VIEW.y1 };
const SOURCE_KEYS = ['f0', 'pressure', 'tension', 'brightness', 'breathiness', 'roughness', 'fry', 'vibratoDepth', 'glide'] as const;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function createChimera(): Chimera {
  const engine = new VoiceEngine();
  /** the body the voice has, and the one the head shows (ahead of it while a size is chosen) */
  let body: BodyMix = PRESETS.male, shown: BodyMix = PRESETS.male;
  const source: VoiceSettings = { ...pick(DEFAULT_SOURCE), f0: defaultF0(body) };
  let gateLevel = 0;
  /** the articulation we asked for (tip free: it rests on the tongue body) */
  let artic: HumanArtic = withTip({ ...NEUTRAL });
  const runningFns = new Set<(running: boolean) => void>();

  // Acoustic models (the head's geometry, the vowels) per body and sample rate, a few kept, as upstream useModel.
  const models = new Map<string, VoiceModel>();
  const modelFor = (b: BodyMix): VoiceModel => {
    const key = `${bodyKey(b)}@${engine.ctx ? engine.sampleRate : 48000}`;
    let m = models.get(key);
    if (m) models.delete(key);
    else m = new VoiceModel(b, engine.ctx ? engine.sampleRate : 48000);
    models.set(key, m);
    if (models.size > 4) {
      const [oldest, old] = models.entries().next().value!;
      models.delete(oldest);
      old.dispose();
    }
    return m;
  };

  /** The articulation for a mouth position: the two nearest calibrated vowels, blended. */
  const mouthArtic = (pos: number): Partial<HumanArtic> => {
    const m = modelFor(body);
    const at = (i: number) => m.vowels.find((v) => v.ipa === MOUTH_IPA[MOUTH[i]!])?.artic ?? {};
    const p = clamp(pos, 0, MOUTH.length - 1), i = Math.min(MOUTH.length - 2, Math.floor(p)), u = p - i;
    const a = at(i), b = at(i + 1), out: Partial<HumanArtic> = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof HumanArtic>) {
      const x = a[k] ?? NEUTRAL[k], y = b[k] ?? NEUTRAL[k];
      out[k] = x + (y - x) * u;
    }
    return out;
  };
  const moveTo = (a: Partial<HumanArtic>) => {
    artic = withTip({ ...artic, ...a });
    engine.setArtic(a, true);
  };

  /** Send the voice again: messages sent before the worklet exists are lost. */
  const resync = () => {
    const { pressure, brightness, ...rest } = source;
    engine.setSource(rest);
    engine.setExpression({ pressure, brightness });
    engine.setArtic(artic, true);
    engine.gate(gateLevel);
  };
  // The worklet says "ready" when it starts and again after each body change, so
  // the body is sent only on the first one: sending it on each would never end.
  let booted = false;
  engine.onReady(() => {
    if (!booted) engine.setBody(body);
    booted = true;
    resync();
  });

  const articRange = Object.fromEntries(ARTIC_KEYS.map((k) => [k, { min: ARTIC_SPECS[k].min, max: ARTIC_SPECS[k].max }])) as Record<ArticKey, { min: number; max: number }>;

  const voice: Chimera = {
    get defaults() { return { ...pick(DEFAULT_SOURCE), f0: defaultF0(body) }; },
    articRange,
    get body() { return shown; },
    get running() { return engine.running; },
    start() {
      const first = !engine.ctx;
      const started = engine.start();
      if (first && engine.ctx) {
        engine.ctx.addEventListener('statechange', () => {
          for (const fn of runningFns) fn(engine.running);
        });
      }
      return started.then(resync);
    },
    suspend: () => engine.ctx?.suspend() ?? Promise.resolve(),
    onRunningChange(fn) {
      runningFns.add(fn);
      return () => runningFns.delete(fn);
    },
    setSource(values) {
      Object.assign(source, values);
      // a finger moves these many times a second: the worklet glides to them (see worklet.ts)
      const { pressure, brightness, ...rest } = values;
      if (pressure !== undefined || brightness !== undefined) engine.setExpression({ pressure, brightness });
      if (Object.keys(rest).length) engine.setSource(rest);
    },
    gate(level) {
      if (level === gateLevel) return;
      gateLevel = level;
      engine.gate(level);
    },
    articulation: () => Object.fromEntries(ARTIC_KEYS.map((k) => [k, artic[k]])) as Articulation,
    setArtic(values) {
      const a: Partial<HumanArtic> = {};
      for (const [k, v] of Object.entries(values) as [ArticKey, number][]) a[k] = clamp(v, articRange[k].min, articRange[k].max);
      moveTo(a);
    },
    setMouth: (position) => moveTo(mouthArtic(clamp(position, 0, MOUTH.length - 1))),
    setBody(b, rebuild) {
      shown = b;
      if (!rebuild || sameBody(b, body)) return;
      body = b;
      engine.setBody(b);
    },
    readout(): Readout | null {
      const t = engine.latest && engine.running ? engine.latest : null;
      return t ? { f0: t.t.f0, voicing: t.t.voicing, pLung: t.t.pLung, outRms: t.t.outRms, load: t.load } : null;
    },
    spectrum: (() => {
      let bins: Float32Array<ArrayBuffer> | null = null;
      return (out: Float32Array, lo: number, hi: number) => {
        const an = engine.analyser;
        if (!an || !engine.ctx) return false;
        if (!bins || bins.length !== an.frequencyBinCount) bins = new Float32Array(an.frequencyBinCount);
        an.getFloatFrequencyData(bins);
        const hz = engine.sampleRate / an.fftSize, n = out.length;
        for (let j = 0; j < n; j++) {
          const a = Math.floor((lo * (hi / lo) ** (j / n)) / hz), b = Math.max(a + 1, Math.floor((lo * (hi / lo) ** ((j + 1) / n)) / hz));
          let peak = -Infinity;
          for (let k = a; k < b && k < bins.length; k++) peak = Math.max(peak, bins[k]!);
          out[j] = peak;
        }
        return true;
      };
    })(),
    createHead: (width, height, pixelRatio, options) =>
      new Head2D(width, height, pixelRatio, options?.align ?? 'center', () => modelFor(shown), () => {
        // the voice's own movements, while it sings the body the head shows
        const t = engine.running ? engine.latest : null;
        return t && sameBody(t.body, shown) ? t : null;
      }, () => artic),
  };
  return voice;
}

function pick(s: Readonly<Record<(typeof SOURCE_KEYS)[number], number>>): VoiceSettings {
  const out = {} as VoiceSettings;
  for (const k of SOURCE_KEYS) out[k] = s[k];
  return out;
}

/** With the tongue tip free (as we send it), the engine rests the tip on the tongue body; so does the head. */
function withTip(a: HumanArtic): HumanArtic {
  const tip = restTip(a.jaw, a.tbX, a.tbY);
  return { ...a, ttX: tip.x, ttY: tip.y };
}

/** CHIMERA's midsagittal head. Its renderer leaves room for readouts beside the head (and puts them
 *  above and below it on a narrow canvas): we lay it out wide, without readouts, and move the head
 *  into our box, as large as the canvas allows. */
class Head2D implements Head {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly r = new AnatomyRenderer();
  private readonly glow = new Glow();
  private readonly ratio: number;
  private readonly dx: number;
  private readonly dy: number;
  private readonly model: () => VoiceModel;
  private readonly tele: () => TelemetryMessage | null;
  private readonly artic: () => HumanArtic;

  constructor(width: number, height: number, ratio: number, align: 'left' | 'center', model: () => VoiceModel, tele: () => TelemetryMessage | null, artic: () => HumanArtic) {
    this.ratio = ratio;
    this.model = model;
    this.tele = tele;
    this.artic = artic;
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.ctx = this.canvas.getContext('2d')!;
    // the renderer fits its view's height between 8 px pads (wide enough, it never fits the width)
    const scale = Math.min((height - 4) / (BOX.y1 - BOX.y0), (width - 4) / (BOX.x1 - BOX.x0));
    this.r.resize(Math.max(560, 2 * width + 600), scale * (VIEW.y1 - VIEW.y0) + 16);
    const k = this.r.pxPerCm, boxW = (BOX.x1 - BOX.x0) * k;
    this.dx = (align === 'left' ? 2 : (width - boxW) / 2) - this.r.X({ x: BOX.x0, y: 0 });
    this.dy = (height - (BOX.y1 - BOX.y0) * k) / 2 - this.r.Y({ x: 0, y: BOX.y1 });
  }

  frame(dt: number, ring: HandleId | null = null): void {
    const m = this.model(), tele = this.tele();
    const a = tele ? VoiceModel.articFromArray(tele.t.artic) : this.artic();
    this.r.face.update(tele, Math.min(0.5, dt));
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#000';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(this.ratio, 0, 0, this.ratio, this.dx * this.ratio, this.dy * this.ratio);
    this.r.draw(g, m, m.frame(a), a, tele, VIEW_FLAGS, { hover: ring, drag: null, dt: Math.min(0.05, dt), formants: [], slots: [], info: [] });
    this.glow.apply(this.canvas, g, this.ratio);
  }
}
