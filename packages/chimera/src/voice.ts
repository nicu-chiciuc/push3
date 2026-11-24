// Our glue around the upstream CHIMERA modules: one voice played by hand (we send `setSource` and
// `gate` ourselves, as CHIMERA's store does for its keyboard) and a 3D head drawn off screen. The
// per-frame head code follows upstream/src/ui/components/AnatomyView3D.tsx (not copied: it is
// React), without the orbit controls, the readouts and the petting.
// Import this module only after initChimera() has resolved (see index.ts).
import * as THREE from 'three';
import type { Chimera, Head, Readout, VoiceSettings } from './api.ts';
import { MOUTH, type Body } from './settings.ts';
import { engine } from '../upstream/src/audio/AudioEngine.ts';
import { DEFAULT_SOURCE, NEUTRAL, restTip, type HumanArtic } from '../upstream/src/wasm/engine.ts';
import { VoiceModel } from '../upstream/src/ui/analysis.ts';
import { PRESETS, defaultF0, sameBody } from '../upstream/src/ui/body.ts';
import { Anatomy3D } from '../upstream/src/ui/render/anatomy3d.ts';
import { Glow } from '../upstream/src/ui/render/vector.ts';
import type { ViewFlags } from '../upstream/src/ui/render/anatomy.ts';

/** The calibrated vowel behind each mouth position (IPA): "A" is the open back vowel of "hod". */
const MOUTH_IPA: Record<(typeof MOUTH)[number], string> = { U: 'u', O: 'o', A: 'ɑ', E: 'e', I: 'i' };
const VIEW: ViewFlags = { pressure: true, particles: true, grid: false, calipers: false };
const SOURCE_KEYS = ['f0', 'pressure', 'tension', 'brightness', 'breathiness', 'roughness', 'fry', 'vibratoDepth', 'glide'] as const;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function createChimera(): Chimera {
  let body: Body = 'male';
  const source: VoiceSettings = { ...pick(DEFAULT_SOURCE), f0: defaultF0(PRESETS[body]) };
  let gateLevel = 0;
  let mouth = MOUTH.indexOf('A');
  /** the articulation we asked for (the head shows it while there is no telemetry) */
  let artic: HumanArtic = withTip({ ...NEUTRAL });
  const runningFns = new Set<(running: boolean) => void>();

  // One acoustic model per body and sample rate (the head's geometry and the vowels), as upstream useModel.
  let model: VoiceModel | null = null, modelRate = 0;
  const modelNow = (): VoiceModel => {
    const rate = engine.ctx ? engine.sampleRate : 48000;
    if (!model || !sameBody(model.body, PRESETS[body]) || modelRate !== rate) {
      model?.dispose();
      model = new VoiceModel(PRESETS[body], rate);
      modelRate = rate;
    }
    return model;
  };

  /** The articulation for a mouth position: the two nearest calibrated vowels, blended. */
  const mouthArtic = (pos: number): Partial<HumanArtic> => {
    const m = modelNow();
    const at = (i: number) => m.vowels.find((v) => v.ipa === MOUTH_IPA[MOUTH[i]!])?.artic ?? {};
    const p = clamp(pos, 0, MOUTH.length - 1), i = Math.min(MOUTH.length - 2, Math.floor(p)), u = p - i;
    const a = at(i), b = at(i + 1), out: Partial<HumanArtic> = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof HumanArtic>) {
      const x = a[k] ?? NEUTRAL[k], y = b[k] ?? NEUTRAL[k];
      out[k] = x + (y - x) * u;
    }
    return out;
  };

  /** Send the voice again: messages sent before the worklet exists are lost. */
  const resync = () => {
    engine.setSource({ ...source });
    engine.setArtic(mouthArtic(mouth), true);
    engine.gate(gateLevel);
  };
  // The worklet says "ready" when it starts and again after each body change, so
  // the body is sent only on the first one: sending it on each would never end.
  let booted = false;
  engine.onReady(() => {
    if (!booted) engine.setBody(PRESETS[body]);
    booted = true;
    resync();
  });

  const voice: Chimera = {
    get defaults() { return { ...pick(DEFAULT_SOURCE), f0: defaultF0(PRESETS[body]) }; },
    get body() { return body; },
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
      engine.setSource(values);
    },
    gate(level) {
      if (level === gateLevel) return;
      gateLevel = level;
      engine.gate(level);
    },
    setMouth(position) {
      mouth = clamp(position, 0, MOUTH.length - 1);
      const a = mouthArtic(mouth);
      artic = withTip({ ...artic, ...a });
      engine.setArtic(a, true);
    },
    setBody(b) {
      if (b === body) return;
      body = b;
      engine.setBody(PRESETS[b]);
      voice.setMouth(mouth); // the vowels are calibrated per body
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
    createHead: (size, pixelRatio, options) => new HeadView(size, pixelRatio, options?.zoom ?? 1, modelNow, () => body, () => artic),
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

class HeadView implements Head {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly glCanvas = document.createElement('canvas');
  private readonly gl: THREE.WebGLRenderer;
  private readonly r = new Anatomy3D();
  private readonly glow = new Glow();
  private posed: VoiceModel | null = null;
  private readonly ratio: number;
  private readonly zoom: number;
  private readonly model: () => VoiceModel;
  private readonly body: () => Body;
  private readonly artic: () => HumanArtic;

  constructor(size: number, ratio: number, zoom: number, model: () => VoiceModel, body: () => Body, artic: () => HumanArtic) {
    this.ratio = ratio;
    this.zoom = zoom;
    this.model = model;
    this.body = body;
    this.artic = artic;
    this.canvas.width = this.canvas.height = Math.round(size * ratio);
    this.ctx = this.canvas.getContext('2d')!;
    this.gl = new THREE.WebGLRenderer({ canvas: this.glCanvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    // the palette's sRGB values go straight through, as on CHIMERA's 2D screens
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.gl.setClearColor(0x000000, 1);
    this.gl.setPixelRatio(ratio);
    this.gl.setSize(size, size, false);
    this.r.centred = true;
    this.r.resize(size, size);
  }

  frame(dt: number): void {
    const m = this.model(), r = this.r, cam = r.camera;
    if (this.posed !== m) {
      // the turned three-quarter view, a little closer than CHIMERA's (no readouts around it here)
      const p = r.poses(m);
      cam.position.copy(p.target).add(p.home.sub(p.target).multiplyScalar(1 / this.zoom));
      cam.lookAt(p.target);
      cam.updateMatrixWorld();
      this.posed = m;
    }
    const latest = engine.running && engine.latest && sameBody(engine.latest.body, PRESETS[this.body()]) ? engine.latest : null;
    const a = latest ? VoiceModel.articFromArray(latest.t.artic) : this.artic();
    r.face.update(latest, Math.min(0.5, dt));
    r.update(m, m.frame(a), a, latest, VIEW, Math.min(0.05, dt));
    this.gl.render(r.scene, cam);
    const g = this.ctx, px = this.canvas.width;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.drawImage(this.glCanvas, 0, 0, px, px);
    this.glow.apply(this.canvas, g, this.ratio);
  }

  dispose(): void {
    this.r.dispose();
    this.gl.dispose();
    // browsers allow few live WebGL contexts: give this one back now, not at garbage collection
    this.gl.forceContextLoss();
  }
}
