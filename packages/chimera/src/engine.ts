// The main thread's side of our worklet (worklet.ts): the AudioContext, the node, an analyser for
// the spectrum and the latest telemetry. It follows upstream/src/audio/AudioEngine.ts (messages
// coalesced to one per kind a frame), without what the tab does not use (the plugin bridge, the
// close-mic chain, speech, creatures), and it loads our worklet instead of CHIMERA's.
import workletUrl from './worklet.ts?worker&url';
import type { ExprMessage } from './worklet.ts';
import { chimeraModule } from '../upstream/src/wasm/chimera.ts';
import type { FromWorklet, TelemetryMessage, ToWorklet } from '../upstream/src/worklet/protocol.ts';
import type { BodyMix, HumanArtic, VoiceSource } from '../upstream/src/wasm/types.ts';

type Expression = Omit<ExprMessage, 'type' | 'voice'>;

export class VoiceEngine {
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  latest: TelemetryMessage | null = null;
  sampleRate = 48000;
  private node: AudioWorkletNode | null = null;
  private readonly readyFns = new Set<() => void>();
  /** `pitch` and `expr` are each voice's own, by its number */
  private pending: { source?: Partial<VoiceSource>; artic?: Partial<HumanArtic>; tipFree?: boolean; pitch?: Map<number, number>; expr?: Map<number, Expression> } = {};
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

  /** How many voices play: a chord's notes, one voice each. */
  setVoices(count: number): void {
    this.send({ type: 'voices', count });
  }

  /** The voice whose telemetry `latest` is of (what the head shows). */
  showVoice(voice: number): void {
    this.send({ type: 'show', voice });
  }

  /** One voice's breath, on or off. */
  gate(level: number, voice = 0): void {
    this.send({ type: 'gate', level, voice });
  }

  /** One voice's pitch: it glides there, a call a frame at most. With `snap` it is there at once,
   *  with no glide, and the message goes now (a note that starts from silence: the gate follows it). */
  setPitch(voice: number, f0: number, snap = false): void {
    if (snap) {
      this.pending.pitch?.delete(voice);
      this.send({ type: 'source', values: { f0 }, voice, snap });
      return;
    }
    (this.pending.pitch ??= new Map()).set(voice, f0);
    this.flushSoon();
  }

  /** What every voice shares (the dials; never a pitch, which is each voice's own: see setPitch).
   *  Coalesced, as the following two: many calls in a frame become one message. */
  setSource(values: Partial<VoiceSource>): void {
    this.pending.source = { ...this.pending.source, ...values };
    this.flushSoon();
  }

  setArtic(values: Partial<HumanArtic>, tipFree?: boolean): void {
    this.pending.artic = { ...this.pending.artic, ...values };
    if (tipFree !== undefined) this.pending.tipFree = tipFree;
    this.flushSoon();
  }

  /** One voice's pressure and brightness targets: the worklet glides to them. */
  setExpression(voice: number, values: Expression): void {
    const expr = (this.pending.expr ??= new Map());
    expr.set(voice, { ...expr.get(voice), ...values });
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
      for (const [voice, f0] of p.pitch ?? []) this.send({ type: 'source', values: { f0 }, voice });
      for (const [voice, values] of p.expr ?? []) this.send({ type: 'expr', voice, ...values });
    });
  }
}
