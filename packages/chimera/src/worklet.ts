// Our AudioWorklet: CHIMERA's processor (upstream/src/worklet/processor.ts, unchanged) with the
// glide that CHIMERA's plugin puts on pressure and brightness (crates/chimera-plugin/src/core.rs,
// `step_expression`). A pad sends its pressure and slide in steps (7-bit, many a second); set
// straight on the engine, each step changes the glottis at once and the stream crackles. Here the
// page sends targets ({ type: 'expr' }) and the voice glides to them: 12 ms, a step every 64
// samples, as in the plugin. Each voice of a chord has its own finger, so each has its own glide.
import { upstream } from './worklet-capture.ts';
import '../upstream/src/worklet/processor.ts';
import type { ToWorklet } from '../upstream/src/worklet/protocol.ts';

declare const sampleRate: number;

/** The glide's time constant (s) and step (samples), as the plugin's EXPR_GLIDE and EXPR_STEP. */
const GLIDE = 0.012;
const STEP = 64;
/** the upstream processor's most voices (upstream/src/worklet/processor.ts, MAX_VOICES) */
const MAX_VOICES = 8;
const KEYS = ['pressure', 'brightness'] as const;

/** A pressure and brightness target for one voice's glide (the first voice, with no `voice`). */
export interface ExprMessage {
  type: 'expr';
  voice?: number;
  pressure?: number;
  brightness?: number;
}

/** What we use of the upstream processor (its fields are private in TypeScript only). */
interface Upstream {
  readonly port: MessagePort;
  telemetryOn: boolean;
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
  handle(m: ToWorklet): void;
}
const Base = upstream.ctor as new (options: unknown) => Upstream;

class ChimeraGlide extends Base {
  /** where each voice is now, and where it goes; NaN until its first target */
  private readonly now = Array.from({ length: MAX_VOICES }, () => ({ pressure: NaN, brightness: NaN }));
  private readonly target = Array.from({ length: MAX_VOICES }, () => ({ pressure: NaN, brightness: NaN }));
  /** the voices not at their target yet, one bit each */
  private moving = 0;
  private readonly coef = 1 - Math.exp(-STEP / (sampleRate * GLIDE));
  /** views of the output, kept while the browser hands over the same buffers */
  private views: { of: Float32Array; parts: Float32Array[][] } | null = null;

  constructor(options: unknown) {
    super(options);
    const base = this.port.onmessage;
    this.port.onmessage = (e: MessageEvent<ToWorklet | ExprMessage>) => {
      const m = e.data;
      if (m.type !== 'expr') return base?.call(this.port, e as MessageEvent);
      const t = this.target[m.voice ?? 0];
      if (!t) return;
      if (m.pressure !== undefined) t.pressure = m.pressure;
      if (m.brightness !== undefined) t.brightness = m.brightness;
      this.moving |= 1 << (m.voice ?? 0);
    };
  }

  /** One step of each voice's glide (a voice's first target is taken at once). */
  private stepExpr(): void {
    for (let v = 0; this.moving >> v; v++) {
      if (!((this.moving >> v) & 1)) continue;
      const t = this.target[v]!, n = this.now[v]!;
      const values: { pressure?: number; brightness?: number } = {};
      for (const k of KEYS) {
        if (Number.isNaN(t[k])) continue;
        const d = t[k] - n[k];
        n[k] = Number.isNaN(d) || Math.abs(d) < (k === 'pressure' ? 0.01 : 0.001) ? t[k] : n[k] + d * this.coef;
        values[k] = n[k];
      }
      // (a value with no target yet is NaN, which is not equal to itself: it must not keep the voice moving)
      if (KEYS.every((k) => Number.isNaN(t[k]) || n[k] === t[k])) this.moving &= ~(1 << v);
      // to this voice only (the upstream processor drops it if the voice does not play)
      this.handle({ type: 'source', values, voice: v });
    }
  }

  override process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const len = out[0]!.length;
    if (!this.views || this.views.of !== out[0] || this.views.parts[0]?.length !== out.length) {
      const parts: Float32Array[][] = [];
      for (let k = 0; k < len; k += STEP) parts.push(out.map((ch) => ch.subarray(k, Math.min(len, k + STEP))));
      this.views = { of: out[0]!, parts };
    }
    const parts = this.views.parts, on = this.telemetryOn;
    for (let i = 0; i < parts.length; i++) {
      this.stepExpr();
      // telemetry once per render quantum (the upstream rate), not once per step
      this.telemetryOn = on && i === parts.length - 1;
      super.process(inputs, [parts[i]!]);
    }
    this.telemetryOn = on;
    return true;
  }
}

upstream.register('chimera', ChimeraGlide);
