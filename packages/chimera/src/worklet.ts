// Our AudioWorklet: CHIMERA's processor (upstream/src/worklet/processor.ts, unchanged) with the
// glide that CHIMERA's plugin puts on pressure and brightness (crates/chimera-plugin/src/core.rs,
// `step_expression`). A pad sends its pressure and slide in steps (7-bit, many a second); set
// straight on the engine, each step changes the glottis at once and the stream crackles. Here the
// page sends targets ({ type: 'expr' }) and the voice glides to them: 12 ms, a step every 64
// samples, as in the plugin.
import { upstream } from './worklet-capture.ts';
import '../upstream/src/worklet/processor.ts';
import type { ToWorklet } from '../upstream/src/worklet/protocol.ts';

declare const sampleRate: number;

/** The glide's time constant (s) and step (samples), as the plugin's EXPR_GLIDE and EXPR_STEP. */
const GLIDE = 0.012;
const STEP = 64;

/** A pressure and brightness target for the glide. */
export interface ExprMessage {
  type: 'expr';
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
  /** where the voice is now, and where it goes; NaN until the first target */
  private now = { pressure: NaN, brightness: NaN };
  private target = { pressure: NaN, brightness: NaN };
  private moving = false;
  private readonly coef = 1 - Math.exp(-STEP / (sampleRate * GLIDE));
  /** views of the output, kept while the browser hands over the same buffers */
  private views: { of: Float32Array; parts: Float32Array[][] } | null = null;

  constructor(options: unknown) {
    super(options);
    const base = this.port.onmessage;
    this.port.onmessage = (e: MessageEvent<ToWorklet | ExprMessage>) => {
      const m = e.data;
      if (m.type !== 'expr') return base?.call(this.port, e as MessageEvent);
      if (m.pressure !== undefined) this.target.pressure = m.pressure;
      if (m.brightness !== undefined) this.target.brightness = m.brightness;
      this.moving = true;
    };
  }

  /** One step of the glide (the first target is taken at once). */
  private stepExpr(): void {
    if (!this.moving) return;
    const t = this.target, n = this.now;
    for (const k of ['pressure', 'brightness'] as const) {
      if (Number.isNaN(t[k])) continue;
      const d = t[k] - n[k];
      n[k] = Number.isNaN(d) || Math.abs(d) < (k === 'pressure' ? 0.01 : 0.001) ? t[k] : n[k] + d * this.coef;
    }
    this.moving = n.pressure !== t.pressure || n.brightness !== t.brightness;
    const values: { pressure?: number; brightness?: number } = {};
    if (!Number.isNaN(n.pressure)) values.pressure = n.pressure;
    if (!Number.isNaN(n.brightness)) values.brightness = n.brightness;
    this.handle({ type: 'source', values });
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
