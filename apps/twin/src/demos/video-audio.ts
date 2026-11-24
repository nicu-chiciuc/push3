// The Video Deck's audio, all in the browser (Web Audio + one WASM AudioWorklet), so it works the
// same on the deployed site and on the dev server:
//
//   decoded file ─ Signalsmith Stretch (buffer mode) ─ decoded ─┐
//   <video> ─┬─ dry ────────────────────────────────────────────┤
//            └─ Signalsmith Stretch (live) ─ wet ───────────────┴─ DJ filter ─ saturator ─┬────────── dialogue ─ master ─ limiter ─ analyser ─ out
//                                                                         └─ dub echo ─┘
//
// Decoded mode (the default when it works): Mediabunny decodes the file's audio track in the browser
// (also AC-3, E-AC-3, DTS) and Signalsmith Stretch (MIT, signalsmith-audio.co.uk) plays it in step
// with the muted <video>, doing speed, pitch and formant itself with no added delay.
// Live mode (fallback): the <video>'s own audio, with Stretch shifting it live (about 70 ms behind).
// The video plays without pitch correction and Stretch shifts the pitch back, which sounds better
// than the browser's own time-stretch; the dry path carries the audio when no shift is needed.
import type { StretchNode } from 'signalsmith-stretch';
import { DecodedAudio, type DecodedTrack } from './media-audio.ts';

export type { DecodedTrack };

export interface AudioFxParams {
  /** Pitch shift in semitones, the voice's formants kept (sounds like another singer, not a chipmunk). */
  pitchSemitones: number;
  /** Formant shift in semitones: the size of the voice (+ small/cartoon, - giant), pitch unchanged. */
  formantSemitones: number;
  /** Playback speed of the video. */
  speed: number;
  /** Tape: speed changes the pitch, like a tape machine. Otherwise the pitch is kept. */
  tape: boolean;
  /** -1 lowpass .. 0 open .. +1 highpass. */
  filter: number;
  /** 0..0.85 dub echo send. */
  echo: number;
  /** 0..1 saturation (deep fry). */
  drive: number;
  /** Compress loud and quiet parts together so speech stays clear at low volume. */
  dialogue: boolean;
  /** 0..2 master volume (a limiter keeps it from clipping). */
  volume: number;
}

export type AudioEngineState = 'off' | AudioContextState;


/** Smooth saturation: tanh, normalized to keep full scale at full scale. */
function saturationCurve(drive: number): Float32Array<ArrayBuffer> {
  const n = 4096, k = 1 + drive * 14, norm = Math.tanh(k);
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) curve[i] = Math.tanh(k * ((i * 2) / (n - 1) - 1)) / norm;
  return curve;
}

/** 4th-order Butterworth as two biquads. */
const BUTTERWORTH_Q = [0.5412, 1.3066] as const;

export class VideoAudioEngine {
  private ctx: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private dry: GainNode | null = null;
  private wet: GainNode | null = null;
  private stretch: StretchNode | null = null;
  private lowpass: Array<BiquadFilterNode> = [];
  private highpass: Array<BiquadFilterNode> = [];
  private shaper: WaveShaperNode | null = null;
  private shaperTrim: GainNode | null = null;
  private echoFeedback: GainNode | null = null;
  private echoWet: GainNode | null = null;
  private dialogue: DynamicsCompressorNode | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private fftData = new Uint8Array(64);
  private tdData = new Uint8Array(128);
  private attachedEl: HTMLVideoElement | null = null;
  private lastDrive = -1;
  private dialogueOn = false;
  private lastShift = { semitones: NaN, formant: NaN };
  private stretchLoading = false;
  private stretchLatency = 0;
  private decodedGain: GainNode | null = null;
  private decodedNode: StretchNode | null = null;
  private decoded: DecodedAudio | null = null;
  private lastParams: AudioFxParams | null = null;
  private stateListeners = new Set<(state: AudioEngineState) => void>();

  onStateChange(fn: (state: AudioEngineState) => void): () => void {
    this.stateListeners.add(fn);
    fn(this.getState());
    return () => this.stateListeners.delete(fn);
  }

  getState(): AudioEngineState {
    return this.ctx ? this.ctx.state : 'off';
  }

  private emitState() {
    const s = this.getState();
    for (const fn of this.stateListeners) fn(s);
  }

  /**
   * Call SYNCHRONOUSLY inside a user gesture (click, key, pad press): browsers only start audio there.
   * The dry path is wired at once; Stretch loads in the background and joins when it is ready.
   */
  unlock(video: HTMLVideoElement) {
    if (!this.ctx) {
      // 48 kHz, the rate of nearly all film audio, so decoded tracks need no resampling.
      const ctx = new AudioContext({ latencyHint: 'playback', sampleRate: 48000 });
      this.ctx = ctx;
      this.attachedEl = video;
      ctx.addEventListener('statechange', () => this.emitState());
      this.source = ctx.createMediaElementSource(video);
      this.build(ctx);
      this.emitState();
      void this.loadStretch();
    } else if (this.attachedEl !== video) {
      // The video element was replaced: attach the new one to the existing graph.
      try { this.source?.disconnect(); } catch { /* not connected */ }
      this.source = this.ctx.createMediaElementSource(video);
      this.attachedEl = video;
      if (this.dry) this.source.connect(this.dry);
      if (this.stretch) this.source.connect(this.stretch);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().then(() => this.emitState()).catch(() => {});
  }

  private build(ctx: AudioContext) {
    const gain = (v: number) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    this.dry = gain(1);
    this.wet = gain(0);
    this.decodedGain = gain(0);
    this.source!.connect(this.dry);

    // DJ filter: lowpass and highpass always in the path (24 dB/octave each), parked at the edges of
    // hearing when open, so sweeping through the center never switches anything and never clicks.
    const biquad = (type: BiquadFilterType, freq: number, q: number) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      return f;
    };
    this.lowpass = BUTTERWORTH_Q.map((q) => biquad('lowpass', 20000, q));
    this.highpass = BUTTERWORTH_Q.map((q) => biquad('highpass', 10, q));
    const filterIn = this.lowpass[0]!;
    this.dry.connect(filterIn);
    this.wet.connect(filterIn);
    this.decodedGain.connect(filterIn);
    [...this.lowpass, ...this.highpass].reduce((a, b) => (a.connect(b), b));

    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = null; // passthrough while drive is 0
    this.shaperTrim = gain(1);
    this.highpass.at(-1)!.connect(this.shaper);
    this.shaper.connect(this.shaperTrim);

    // Dialogue: a gentle compressor, a no-op (ratio 1) while off. Chrome adds the makeup gain itself.
    this.dialogue = ctx.createDynamicsCompressor();
    this.setDialogue(false, true);
    this.shaperTrim.connect(this.dialogue);

    // Dub echo: a send from after the saturator, darker on each repeat.
    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = 0.23;
    const damp = biquad('lowpass', 2800, 0.7);
    this.echoFeedback = gain(0.45);
    this.echoWet = gain(0);
    this.shaperTrim.connect(delay);
    delay.connect(damp);
    damp.connect(this.echoFeedback);
    this.echoFeedback.connect(delay);
    delay.connect(this.echoWet);
    this.echoWet.connect(this.dialogue);

    this.master = gain(1);
    this.dialogue.connect(this.master);

    // Limiter: nothing reaches the speakers above about -1 dBFS, whatever the volume and effects.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    this.master.connect(limiter);

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 128;
    this.analyser.smoothingTimeConstant = 0.78;
    this.fftData = new Uint8Array(this.analyser.frequencyBinCount);
    this.tdData = new Uint8Array(this.analyser.fftSize);
    limiter.connect(this.analyser);
    this.analyser.connect(ctx.destination);
  }

  private setDialogue(on: boolean, immediate = false) {
    const c = this.dialogue, ctx = this.ctx;
    if (!c || !ctx) return;
    const set = (p: AudioParam, v: number) => (immediate ? (p.value = v) : p.setTargetAtTime(v, ctx.currentTime, 0.05));
    set(c.threshold, on ? -30 : 0);
    set(c.ratio, on ? 3.5 : 1);
    set(c.knee, on ? 12 : 0);
    set(c.attack, 0.008);
    set(c.release, 0.25);
  }

  private async loadStretch() {
    const ctx = this.ctx;
    if (!ctx || !this.source || !this.wet || this.stretch || this.stretchLoading) return;
    this.stretchLoading = true;
    try {
      // Loaded on first use: about 150 kB of WASM that visitors of the other tabs never download.
      const { default: SignalsmithStretch } = await import('signalsmith-stretch');
      const node = await SignalsmithStretch(ctx, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      // Shorter blocks than the default: less delay behind the picture, still clean on voices.
      await node.configure({ blockMs: 70 });
      await node.schedule({ formantCompensation: true, formantBaseHz: 0, tonalityHz: 8000 });
      await node.start();
      this.stretchLatency = await node.latency();
      this.source.connect(node);
      node.connect(this.wet);
      this.stretch = node;
    } catch (err) {
      console.warn('[VideoAudioEngine] Signalsmith Stretch unavailable; audio plays without pitch effects:', err);
    } finally {
      this.stretchLoading = false;
    }
  }

  /** True while the audio comes from the decoded file (the <video> must stay muted). */
  get isDecoded(): boolean {
    return this.decoded !== null;
  }

  /**
   * Decode the audio of a File or URL in the browser. Returns its tracks, or null when it has none
   * this browser can decode (then the <video>'s own audio plays through the live path).
   */
  async openDecoded(source: Blob | string): Promise<Array<DecodedTrack> | null> {
    this.closeDecoded();
    const ctx = this.ctx;
    if (!ctx || !this.decodedGain) return null;
    try {
      if (!this.decodedNode) {
        const { default: SignalsmithStretch } = await import('signalsmith-stretch');
        // One input, never connected: the processor needs an (empty) input list to pick buffer mode.
        const node = await SignalsmithStretch(ctx, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
        await node.configure({ blockMs: 70 });
        await node.schedule({ formantCompensation: true, formantBaseHz: 0, tonalityHz: 8000 });
        node.connect(this.decodedGain);
        this.decodedNode = node;
      }
      const opened = await DecodedAudio.open(ctx, this.decodedNode, source);
      if (!opened) return null;
      this.decoded = opened.audio;
      if (this.lastParams) this.apply(this.lastParams);
      return opened.tracks;
    } catch (err) {
      console.warn('[VideoAudioEngine] decoding in the browser failed; using the video element audio:', err);
      return null;
    }
  }

  closeDecoded() {
    this.decoded?.close();
    this.decoded = null;
  }

  selectDecodedTrack(index: number) {
    this.decoded?.selectTrack(index);
  }

  /** The picture jumped. */
  seekDecoded(time: number) {
    this.decoded?.seek(time);
  }

  /** Every frame: where the picture is and whether it plays. */
  syncDecoded(time: number, playing: boolean) {
    const p = this.lastParams;
    if (!this.decoded || !p) return;
    // Here the speed is Stretch's own, so the pitch stays unless tape mode moves it with the speed.
    const semitones = p.pitchSemitones + (p.tape ? 12 * Math.log2(Math.max(0.05, p.speed)) : 0);
    this.decoded.sync(time, playing, p.speed, semitones, p.formantSemitones);
  }

  resume() {
    if (this.ctx?.state === 'suspended') void this.ctx.resume().then(() => this.emitState()).catch(() => {});
  }

  /** A short two-note chime straight to the speakers, to test audio output. */
  playTestTone() {
    const owned = !this.ctx;
    const ctx = this.ctx ?? new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume().then(() => this.emitState()).catch(() => {});
    const now = ctx.currentTime;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.setValueAtTime(659.25, now + 0.11);
    g.gain.setValueAtTime(0.001, now);
    g.gain.exponentialRampToValueAtTime(0.28, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
    if (owned) window.setTimeout(() => void ctx.close().catch(() => {}), 450);
  }

  /** True once Signalsmith Stretch is running (pitch and formant effects available). */
  get hasPitchWorklet(): boolean {
    return this.stretch !== null;
  }

  /** Delay the pitch path adds behind the picture, in ms (0 while it is not in use). */
  get shiftLatencyMs(): number {
    return this.stretch && this.wet && this.wet.gain.value > 0.5 ? Math.round(this.stretchLatency * 1000) : 0;
  }

  /** Call every frame; only real changes reach the audio thread. */
  apply(p: AudioFxParams) {
    const ctx = this.ctx;
    this.lastParams = p;
    if (!ctx) return;
    const now = ctx.currentTime;
    const ramp = (param: AudioParam | undefined, v: number, tc = 0.015) => param?.setTargetAtTime(v, now, tc);
    ramp(this.decodedGain?.gain, this.decoded ? 1 : 0, 0.012);

    // Pitch: the video plays at `speed` without pitch correction, so its pitch moved by 12·log2(speed)
    // semitones. Keeping the pitch means shifting it back; tape mode keeps the moved pitch.
    const speedShift = p.tape ? 0 : -12 * Math.log2(Math.max(0.05, p.speed));
    const semitones = p.pitchSemitones + speedShift;
    const shifting = Math.abs(semitones) > 0.05 || Math.abs(p.formantSemitones) > 0.05;
    const useStretch = shifting && this.stretch !== null && !this.decoded;
    ramp(this.dry?.gain, useStretch || this.decoded ? 0 : 1, 0.012);
    ramp(this.wet?.gain, useStretch ? 1 : 0, 0.012);
    if (this.stretch && !this.decoded && (Math.abs(semitones - this.lastShift.semitones) > 0.01 || Math.abs(p.formantSemitones - this.lastShift.formant) > 0.01)) {
      this.lastShift = { semitones, formant: p.formantSemitones };
      void this.stretch.schedule({ semitones, formantSemitones: p.formantSemitones });
    }

    // DJ filter: lowpass sweeps 20 kHz -> 150 Hz, highpass 10 Hz -> 3 kHz; resonance grows with depth.
    const lp = p.filter < -0.02 ? -p.filter : 0, hp = p.filter > 0.02 ? p.filter : 0;
    const lpHz = 20000 * Math.pow(150 / 20000, lp), hpHz = 10 * Math.pow(3000 / 10, hp);
    for (const f of this.lowpass) ramp(f.frequency, lpHz);
    for (const f of this.highpass) ramp(f.frequency, hpHz);
    ramp(this.lowpass[1]?.Q, BUTTERWORTH_Q[1] + lp * 4);
    ramp(this.highpass[1]?.Q, BUTTERWORTH_Q[1] + hp * 4);

    if (this.shaper && Math.abs(p.drive - this.lastDrive) > 0.02) {
      this.lastDrive = p.drive;
      if (p.drive < 0.01) {
        this.shaper.curve = null;
        this.shaper.oversample = 'none';
      } else {
        this.shaper.curve = saturationCurve(p.drive);
        this.shaper.oversample = '4x';
      }
      // Saturation makes it louder; take that back so drive changes the color, not the level.
      ramp(this.shaperTrim?.gain, 1 / (1 + p.drive * 1.4), 0.03);
    }

    if (this.echoWet && this.echoFeedback) {
      ramp(this.echoWet.gain, p.echo, 0.02);
      ramp(this.echoFeedback.gain, Math.min(0.72, 0.25 + p.echo * 0.55), 0.02);
    }

    if (p.dialogue !== this.dialogueOn) { this.dialogueOn = p.dialogue; this.setDialogue(p.dialogue); }
    ramp(this.master?.gain, p.volume);
  }

  getSpectrum(): Uint8Array {
    this.analyser?.getByteFrequencyData(this.fftData);
    return this.fftData;
  }

  /** Output peak level (0..1). */
  getPeakLevel(): number {
    if (!this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this.tdData);
    let peak = 0;
    for (let i = 0; i < this.tdData.length; i++) peak = Math.max(peak, Math.abs(this.tdData[i]! - 128) / 128);
    return peak;
  }
}
