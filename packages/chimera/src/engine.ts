// The main thread's side of our worklet (worklet.ts): the AudioContext, the node, an analyser for
// the spectrum and the latest telemetry. It follows upstream/src/audio/AudioEngine.ts (messages
// coalesced to one per kind a frame), without what the tab does not use (the plugin bridge, the
// close-mic chain, speech, creatures), and it loads our worklet instead of CHIMERA's.
import workletUrl from './worklet.ts?worker&url';
import type { ExprMessage } from './worklet.ts';
import { chimeraModule } from '../upstream/src/wasm/chimera.ts';
import type { FromWorklet, TelemetryMessage, ToWorklet } from '../upstream/src/worklet/protocol.ts';
import type { BodyMix, HumanArtic, VoiceSource } from '../upstream/src/wasm/types.ts';

export class VoiceEngine {
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  latest: TelemetryMessage | null = null;
  sampleRate = 48000;
  private node: AudioWorkletNode | null = null;
  private readonly readyFns = new Set<() => void>();
  private pending: { source?: Partial<VoiceSource>; artic?: Partial<HumanArtic>; tipFree?: boolean; expr?: Omit<ExprMessage, 'type'> } = {};
  private flushing = false;

  get running(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Start or resume. The AudioContext exists when this returns (the promise waits for the browser). */
  start(): Promise<void> {
    if (this.ctx) return this.ctx.resume();
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.sampleRate = ctx.sampleRate;
    return (async () => {
      await ctx.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(ctx, 'chimera', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { module: chimeraModule() } });
      const master = ctx.createGain();
      master.gain.value = 0.8;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0.6;
      node.connect(master).connect(ctx.destination);
      master.connect(analyser);
      node.port.onmessage = (e: MessageEvent<FromWorklet>) => this.receive(e.data);
      this.node = node;
      this.analyser = analyser;
      await ctx.resume();
    })();
  }

  private receive(m: FromWorklet): void {
    if (m.type === 'telemetry') this.latest = m;
    else if (m.type === 'ready') for (const fn of this.readyFns) fn();
    else if (m.type === 'error') console.error('[chimera] worklet:', m.message);
  }

  /** Called when the worklet starts and after each body change. */
  onReady(fn: () => void): void {
    this.readyFns.add(fn);
  }

  private send(m: ToWorklet | ExprMessage): void {
    this.node?.port.postMessage(m);
  }

  setBody(body: BodyMix): void {
    this.send({ type: 'body', body });
  }

  gate(level: number): void {
    this.send({ type: 'gate', level });
  }

  /** Coalesced, as the following two: many calls in a frame become one message. */
  setSource(values: Partial<VoiceSource>): void {
    this.pending.source = { ...this.pending.source, ...values };
    this.flushSoon();
  }

  setArtic(values: Partial<HumanArtic>, tipFree?: boolean): void {
    this.pending.artic = { ...this.pending.artic, ...values };
    if (tipFree !== undefined) this.pending.tipFree = tipFree;
    this.flushSoon();
  }

  /** Pressure and brightness targets: the worklet glides to them. */
  setExpression(values: Omit<ExprMessage, 'type'>): void {
    this.pending.expr = { ...this.pending.expr, ...values };
    this.flushSoon();
  }

  private flushSoon(): void {
    if (this.flushing) return;
    this.flushing = true;
    requestAnimationFrame(() => {
      this.flushing = false;
      const p = this.pending;
      this.pending = {};
      if (p.artic || p.tipFree !== undefined) this.send({ type: 'artic', values: p.artic ?? {}, tipFree: p.tipFree });
      if (p.source) this.send({ type: 'source', values: p.source });
      if (p.expr) this.send({ type: 'expr', ...p.expr });
    });
  }
}
