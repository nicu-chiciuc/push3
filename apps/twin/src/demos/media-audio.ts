// The Video Deck's audio decoded in the browser: Mediabunny reads the file in pieces (even a 7 GB
// MKV) and decodes the chosen audio track, with WASM decoders for AC-3, E-AC-3 and DTS, which
// browsers cannot decode themselves. The samples feed a Signalsmith Stretch node in buffer mode,
// which plays them in step with the (muted) <video>: at its time, its speed, with pitch effects.
//
// Timeline: after each restart the node's input time 0 is the media time `base`. Decoding runs
// about AHEAD seconds ahead of the picture and drops what is more than BEHIND seconds behind, so
// short jumps back (stutter, replay) need no decoding.
import type { StretchNode } from 'signalsmith-stretch';
import type { AudioBufferSink, Input, InputAudioTrack } from 'mediabunny';

export interface DecodedTrack {
  readonly index: number;
  readonly lang: string;
  readonly title: string;
  readonly codec: string;
  readonly channels: number;
}

const AHEAD = 12;
const BEHIND = 25;
/** How far ahead the node is told of a change, so it can compensate for its own latency. */
const LEAD = 0.15;
/** Re-anchor when the audio drifts this far from the picture (seconds). */
const MAX_DRIFT = 0.05;

type Mediabunny = typeof import('mediabunny');

let ac3: Promise<void> | null = null;
let dts: Promise<void> | null = null;
/** The WASM decoders (300 to 450 kB gzipped each), loaded only for files that need them. */
function registerDecoders(codecs: ReadonlyArray<string | null>): Promise<unknown> {
  if (codecs.some((c) => c === 'ac3' || c === 'eac3')) ac3 ??= import('@mediabunny/ac3').then((m) => m.registerAc3Decoder());
  if (codecs.includes('dts')) dts ??= import('@mediabunny/dts').then((m) => m.registerDtsDecoder());
  return Promise.all([ac3, dts]);
}

/** Any channel layout to stereo. Orders follow FFmpeg/WAVE: FL FR FC LFE (BL BR) SL SR; LFE is left out. */
function toStereo(b: AudioBuffer): [Float32Array, Float32Array] {
  const n = b.length, ch = b.numberOfChannels, at = (i: number) => b.getChannelData(Math.min(i, ch - 1));
  if (ch === 1) { const m = at(0); return [m.slice(), m.slice()]; }
  if (ch < 6) return [at(0).slice(), at(1).slice()];
  const fl = at(0), fr = at(1), c = at(2), sl = at(ch === 8 ? 6 : 4), sr = at(ch === 8 ? 7 : 5);
  const bl = ch === 8 ? at(4) : null, br = ch === 8 ? at(5) : null;
  const L = new Float32Array(n), R = new Float32Array(n), k = 0.7071, g = 0.7071; // ITU levels, then -3 dB
  for (let i = 0; i < n; i++) {
    const cc = k * c[i]!;
    L[i] = g * (fl[i]! + cc + k * sl[i]! + (bl ? k * bl[i]! : 0));
    R[i] = g * (fr[i]! + cc + k * sr[i]! + (br ? k * br[i]! : 0));
  }
  return [L, R];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class DecodedAudio {
  private readonly ctx: AudioContext;
  private readonly node: StretchNode;
  private readonly mb: Mediabunny;
  private readonly input: Input;
  private readonly all: ReadonlyArray<InputAudioTrack>;
  private track: InputAudioTrack;
  private gen = 0;
  /** Media time at the node's input time 0; null until the first buffer of a run arrives. */
  private base: number | null = null;
  /** Media time decoded and added so far, and dropped from the front. */
  private filledTo = 0;
  private droppedTo = 0;
  /** Source sample rate / context sample rate: the node counts time in context samples. */
  private k = 1;
  private time = 0;
  private playing = false;
  private rate = 1;
  private semitones = 0;
  private formant = 0;
  private lastAnchor = 0;
  private reportedInput = 0;
  private reportedAt = 0;
  private closed = false;
  /** How often playback was re-aligned (for diagnostics). */
  anchorCount = 0;

  /** The node's own latency: its reported input time runs this far (times the rate) ahead of what is heard. */
  private readonly nodeLatency: number;

  private constructor(ctx: AudioContext, node: StretchNode, nodeLatency: number, mb: Mediabunny, input: Input, all: ReadonlyArray<InputAudioTrack>, track: InputAudioTrack) {
    this.ctx = ctx;
    this.nodeLatency = nodeLatency;
    this.node = node;
    this.mb = mb;
    this.input = input;
    this.all = all;
    this.track = track;
    void node.setUpdateInterval(0.1, (t) => { this.reportedInput = t; this.reportedAt = ctx.currentTime; });
    void this.restart(0);
  }

  /** Open a File or a URL (with range requests). Null if it has no audio track this browser can decode. */
  static async open(ctx: AudioContext, node: StretchNode, source: Blob | string): Promise<{ audio: DecodedAudio; tracks: Array<DecodedTrack> } | null> {
    const mb = await import('mediabunny');
    const input = new mb.Input({ source: typeof source === 'string' ? new mb.UrlSource(source) : new mb.BlobSource(source), formats: mb.ALL_FORMATS });
    try {
      const found = await input.getAudioTracks();
      const codecs = await Promise.all(found.map((t) => t.getCodec()));
      await registerDecoders(codecs);
      const usable: Array<InputAudioTrack> = [], tracks: Array<DecodedTrack> = [];
      for (const [i, t] of found.entries()) {
        if (!(await t.canDecode())) continue;
        const lang = t.languageCode && t.languageCode !== 'und' ? t.languageCode.toUpperCase() : `TRACK ${i + 1}`;
        const channels = await t.getNumberOfChannels();
        const layout = channels === 6 ? '5.1' : channels === 8 ? '7.1' : channels === 1 ? 'mono' : `${channels}ch`;
        tracks.push({ index: usable.length, lang, title: t.name ?? `${(codecs[i] ?? 'audio').toUpperCase()} ${layout}`, codec: codecs[i] ?? 'unknown', channels });
        usable.push(t);
      }
      if (!usable.length) { input.dispose(); return null; }
      return { audio: new DecodedAudio(ctx, node, await node.latency(), mb, input, usable, usable[0]!), tracks };
    } catch (err) {
      input.dispose();
      throw err;
    }
  }

  /** Switch to another decodable track (index into the list `open` returned). */
  selectTrack(index: number) {
    const t = this.all[index];
    if (!t || t === this.track) return;
    this.track = t;
    void this.restart(this.time);
  }

  /** The picture jumped (seek, stutter, replay): reuse decoded audio when it covers the new time. */
  seek(time: number) {
    this.time = time;
    if (this.base !== null && time >= Math.max(this.base, this.droppedTo) && time < this.filledTo - 0.5) this.anchor();
    else {
      // Silent until the new position is decoded, instead of playing on from the old one.
      void this.node.schedule({ active: false });
      void this.restart(time);
    }
  }

  /** Call every frame with the picture's time and state, and the effect settings. */
  sync(time: number, playing: boolean, rate: number, semitones: number, formant: number) {
    if (this.closed) return;
    this.time = time;
    const transport = playing !== this.playing || Math.abs(rate - this.rate) > 0.001;
    const shift = Math.abs(semitones - this.semitones) > 0.01 || Math.abs(formant - this.formant) > 0.01;
    this.playing = playing;
    this.rate = rate;
    this.semitones = semitones;
    this.formant = formant;
    if (transport) { this.anchor(); return; }
    if (shift) void this.node.schedule({ semitones: this.semitones + 12 * Math.log2(this.k), formantSemitones: this.formant });
    // Drift check: the node reports where it reads; compare with where the picture is.
    if (playing && this.base !== null && this.reportedAt > 0 && this.ctx.currentTime - this.lastAnchor > 0.6) {
      const heardMedia = this.base + this.reportedInput / this.k - this.nodeLatency * rate;
      const age = this.ctx.currentTime - this.reportedAt;
      if (Math.abs(heardMedia + age * rate - (time + this.outLatency() * rate)) > MAX_DRIFT) this.anchor();
    }
  }

  close() {
    this.closed = true;
    this.gen++;
    void this.node.schedule({ active: false });
    void this.node.dropBuffers();
    this.input.dispose();
  }

  private outLatency() {
    return this.ctx.outputLatency || this.ctx.baseLatency || 0;
  }

  /** Tell the node which input time to play when, so the sound lines up with the picture. */
  private anchor() {
    const now = this.ctx.currentTime;
    this.lastAnchor = now;
    this.anchorCount++;
    if (this.base === null) return; // the first decoded buffer anchors
    if (!this.playing) { void this.node.schedule({ active: false, output: now }); return; }
    // The picture shows `time` now; what is heard at now + LEAD + output latency must be later by that much.
    const media = this.time + (LEAD + this.outLatency()) * this.rate;
    void this.node.schedule({
      active: true,
      output: now + LEAD,
      input: (media - this.base) * this.k,
      rate: this.rate * this.k,
      semitones: this.semitones + 12 * Math.log2(this.k),
      formantSemitones: this.formant,
    });
  }

  private async restart(from: number) {
    const gen = ++this.gen;
    await this.node.dropBuffers();
    if (gen !== this.gen) return;
    this.base = null;
    this.droppedTo = 0;
    const sink: AudioBufferSink = new this.mb.AudioBufferSink(this.track);
    try {
      for await (const { buffer, timestamp } of sink.buffers(Math.max(0, from - 0.05))) {
        if (gen !== this.gen) return;
        if (this.base === null) {
          this.base = timestamp;
          this.filledTo = timestamp;
          this.k = buffer.sampleRate / this.ctx.sampleRate;
        }
        // A gap in the file becomes silence, so later audio stays at the right time.
        const gap = timestamp - this.filledTo;
        if (gap > 0.005) {
          const z = new Float32Array(Math.round(gap * buffer.sampleRate));
          await this.node.addBuffers([z, z.slice()]);
          this.filledTo += gap;
        }
        await this.node.addBuffers(toStereo(buffer));
        if (gen !== this.gen) return;
        const firstOfRun = this.filledTo === this.base && gap <= 0.005;
        this.filledTo += buffer.length / buffer.sampleRate;
        if (firstOfRun) this.anchor();
        // Stay AHEAD seconds in front of the picture; let go of what is far behind it.
        while (gen === this.gen && this.filledTo - this.time > AHEAD) await sleep(200);
        if (gen === this.gen && this.time - BEHIND > this.droppedTo + 10) {
          this.droppedTo = this.time - BEHIND;
          void this.node.dropBuffers((this.droppedTo - this.base) * this.k);
        }
      }
    } catch (err) {
      if (gen === this.gen) console.warn('[DecodedAudio] decoding stopped:', err);
    }
  }
}
