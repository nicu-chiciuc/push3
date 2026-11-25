// Music for Blocks: an original tune in D minor, played by a small chip-style band made of Web
// Audio oscillators (no samples): a pulse lead with an echo, a triangle bass, a quiet arpeggio and
// noise drums. The game calls update() each frame, and the notes are put on the audio clock a
// little ahead of time, so a slow frame does not make the music late.

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);
const LETTERS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const noteNum = (s: string): number => {
  const m = /^([A-G])([#b]?)(\d)$/.exec(s);
  if (!m) throw new Error(`blocks-music: bad note ${s}`);
  return 12 * (+m[3]! + 1) + LETTERS[m[1]!]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
};

interface Note { readonly note: number; readonly len: number }
/** One part of the tune. Tokens are eighth notes: a note name starts a note, `-` holds it, `.` is
 *  quiet. Eight bars of eight eighths. The result has a note (and its length) where one starts. */
function melody(src: string): ReadonlyArray<Note | null> {
  const toks = src.split(/\s+/).filter((t) => t && t !== '|');
  if (toks.length !== 64) throw new Error(`blocks-music: a part needs 64 eighths, not ${toks.length}`);
  return toks.map((tok, i) => {
    if (tok === '-' || tok === '.') return null;
    let len = 1;
    while (toks[i + len] === '-') len++;
    return { note: noteNum(tok), len };
  });
}

interface Chord { readonly root: number; readonly tones: ReadonlyArray<number> }
const minor = (root: number): Chord => ({ root, tones: [0, 3, 7, 12] });
const major = (root: number): Chord => ({ root, tones: [0, 4, 7, 12] });
/** Roots in the bass register (D3, B♭2, C3, A2, G2). */
const CHORDS: Record<string, Chord> = { Dm: minor(50), Bb: major(46), C: major(48), A: major(45), Gm: minor(43) };
/** One chord for each bar, or two (`Gm/A`): one for each half. The result has one for each half bar. */
const changes = (src: string): ReadonlyArray<Chord> =>
  src.split(/\s+/).filter(Boolean).flatMap((bar) => {
    const [a, b = a] = bar.split('/');
    return [CHORDS[a!]!, CHORDS[b!]!];
  });

const VERSE = melody(`
  D5 - A4 D5 F5 - E5 F5 | G5 - F5 E5 D5 - Bb4 - | C5 - E5 G5 C6 - Bb5 A5 | A5 - - G5 E5 - C#5 - |
  D5 - A4 D5 F5 - E5 F5 | G5 - A5 Bb5 A5 - G5 F5 | E5 - F5 G5 F5 E5 D5 C#5 | D5 - - - . . A4 C#5 |`);
const VERSE_CHORDS = changes('Dm Bb C A Dm Bb Gm/A Dm');

const BRIDGE = melody(`
  Bb5 - - A5 G5 - D5 - | F5 - - E5 D5 - A4 - | Bb4 C5 D5 E5 F5 - D5 - | E5 - C#5 - A4 - - - |
  G5 - Bb5 - D6 - C6 Bb5 | A5 - F5 - D5 - F5 A5 | G5 F5 E5 D5 E5 - G5 - | A5 - - - E5 - C#5 E5 |`);
const BRIDGE_CHORDS = changes('Gm Dm Bb A Gm Dm C A');

interface Section {
  readonly lead: ReadonlyArray<Note | null>;
  readonly chords: ReadonlyArray<Chord>;
  /** The quiet sixteenth-note arpeggio under the lead. */
  readonly arp: boolean;
  /** Kick and snare (else only the kick on the beat and the hats). */
  readonly full: boolean;
  /** A soft second lead an octave down. */
  readonly double: boolean;
  /** A snare run in the last bar, into the top of the tune. */
  readonly fill: boolean;
}
const SONG: ReadonlyArray<Section> = [
  { lead: VERSE, chords: VERSE_CHORDS, arp: false, full: false, double: false, fill: false },
  { lead: VERSE, chords: VERSE_CHORDS, arp: true, full: true, double: false, fill: false },
  { lead: BRIDGE, chords: BRIDGE_CHORDS, arp: true, full: true, double: false, fill: false },
  { lead: BRIDGE, chords: BRIDGE_CHORDS, arp: true, full: true, double: true, fill: true },
];
const SECTION_STEPS = 128; // 8 bars of 16 sixteenths
const SONG_STEPS = SONG.length * SECTION_STEPS;
/** Bass, in eighths: root, octave, root, octave ... with the fifth near the end of the bar. */
const BASS = [0, 12, 0, 12, 0, 12, 7, 12];
/** Kick on 1, 3 and the "and" after 3, snare on 2 and 4, in sixteenths. */
const KICK = new Set([0, 8, 10]), SNARE = new Set([4, 12]);
/** The snare run of the last bar: sixteenth → loudness. */
const FILL = new Map([[8, 0.5], [10, 0.6], [12, 0.7], [13, 0.75], [14, 0.85], [15, 1]]);

/** Beats per minute at a game level: each level is a little faster. */
export const musicTempo = (level: number) => Math.min(168, 126 + 6 * (level - 1));

/** The level of the whole band before the sound effects' volume. */
const LEVEL = 0.45;

/** A pulse wave that is high for `duty` of each cycle (0.5 is a square). */
function pulse(ctx: BaseAudioContext, duty: number): PeriodicWave {
  const n = 48, re = new Float32Array(n), im = new Float32Array(n);
  for (let k = 1; k < n; k++) {
    re[k] = Math.sin(2 * Math.PI * k * duty) / (Math.PI * k);
    im[k] = (1 - Math.cos(2 * Math.PI * k * duty)) / (Math.PI * k);
  }
  return ctx.createPeriodicWave(re, im);
}

interface Graph {
  readonly ctx: BaseAudioContext;
  readonly main: GainNode;
  readonly echo: DelayNode;
  readonly vibrato: OscillatorNode;
  readonly noise: AudioBuffer;
  readonly lead: PeriodicWave;
  readonly thin: PeriodicWave;
}
/** What one start of the music plays into. A stop fades it out, so the notes already put on the
 *  clock go quiet, and the next start makes a new one. */
interface Session { readonly dry: GainNode; readonly send: GainNode }

export interface AudioLink { readonly ctx: BaseAudioContext; readonly out: AudioNode }

export class Music {
  private g: Graph | null = null;
  private session: Session | null = null;
  private step = 0;
  private next = 0;
  private bpm = 126;
  /** Seconds of quiet before the first note after rewind(), so the start sound plays alone. */
  private wait = 0;

  /** Back to the top of the tune for a new game. */
  rewind() {
    this.stop();
    this.step = 0;
    this.wait = 0.32;
  }

  /** Call each frame. `play` false fades out; true again goes on from the same place. `ahead`:
   *  seconds of music to put on the clock now (a whole song at once for an offline render). */
  update(link: AudioLink | null, play: boolean, bpm: number, ahead = 0.15) {
    this.bpm = bpm;
    if (!play || !link) { this.stop(); return; }
    const g = this.graph(link), now = g.ctx.currentTime;
    if (!this.session) {
      const dry = g.ctx.createGain(), send = g.ctx.createGain();
      send.gain.value = 0.3;
      dry.connect(g.main);
      send.connect(g.echo);
      this.session = { dry, send };
      this.next = now + 0.04 + this.wait;
      this.wait = 0;
    }
    if (this.next < now) this.next = now + 0.03; // the page slept: go on from now
    g.echo.delayTime.setValueAtTime((60 / this.bpm) * 0.75, now);
    while (this.next < now + ahead) {
      this.play(g, this.session, this.step, this.next);
      this.next += 15 / this.bpm;
      this.step = (this.step + 1) % SONG_STEPS;
    }
  }

  private stop() {
    const s = this.session, g = this.g;
    if (!s || !g) return;
    const now = g.ctx.currentTime;
    for (const n of [s.dry, s.send]) { n.gain.cancelScheduledValues(now); n.gain.setTargetAtTime(0, now, 0.03); }
    // the notes put on the clock after now are not heard: play them again after the next start
    const sixteenth = 15 / this.bpm;
    this.step = (this.step - Math.max(0, Math.ceil((this.next - now) / sixteenth)) + SONG_STEPS) % SONG_STEPS;
    this.session = null;
  }

  private graph(link: AudioLink): Graph {
    if (this.g?.ctx === link.ctx) return this.g;
    const ctx = link.ctx;
    const main = ctx.createGain();
    main.gain.value = LEVEL;
    main.connect(link.out);
    // the echo: a dotted eighth, each repeat darker and quieter
    const echo = ctx.createDelay(1), dark = ctx.createBiquadFilter(), back = ctx.createGain();
    dark.type = 'lowpass';
    dark.frequency.value = 2200;
    back.gain.value = 0.32;
    echo.connect(dark).connect(back).connect(echo);
    dark.connect(main);
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 5.5;
    vibrato.start();
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.session = null;
    return (this.g = { ctx, main, echo, vibrato, noise, lead: pulse(ctx, 0.25), thin: pulse(ctx, 0.125) });
  }

  private play(g: Graph, s: Session, step: number, t: number) {
    const part = SONG[Math.floor(step / SECTION_STEPS)]!, i = step % SECTION_STEPS, beat = i & 15;
    const sixteenth = 15 / this.bpm;
    const chord = part.chords[i >> 3]!;

    if ((i & 1) === 0) {
      const n = part.lead[i >> 1];
      if (n) {
        this.lead(g, s, n.note, t, n.len * 2 * sixteenth);
        if (part.double) this.voice(g, s.dry, 'triangle', n.note - 12, t, n.len * 2 * sixteenth * 0.9, 0.09);
      }
      this.voice(g, s.dry, 'triangle', chord.root + BASS[(i >> 1) & 7]!, t, 2 * sixteenth * 0.8, 0.26);
    }
    if (part.arp) this.blip(g, s.dry, chord.root + 12 + chord.tones[beat & 3]!, t, sixteenth);

    const last = part.fill && i >= SECTION_STEPS - 16;
    if (part.full ? KICK.has(beat) : beat % 8 === 0) this.kick(g, s.dry, t);
    if (last && FILL.has(beat)) this.snare(g, s.dry, t, FILL.get(beat)!);
    else if (part.full && SNARE.has(beat)) this.snare(g, s.dry, t, 1);
    if (beat % 2 === 0 && !(last && beat >= 8)) this.hat(g, s.dry, t, beat % 4 === 2 ? 1 : 0.5);
  }

  /** The lead: a 25% pulse with a little vibrato that comes in on long notes, and the echo. */
  private lead(g: Graph, s: Session, note: number, t: number, dur: number) {
    const { ctx } = g, osc = ctx.createOscillator(), amp = ctx.createGain(), depth = ctx.createGain();
    osc.setPeriodicWave(g.lead);
    osc.frequency.value = midi(note);
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(dur > 0.3 ? 9 : 0, t + Math.min(dur, 0.4));
    g.vibrato.connect(depth).connect(osc.detune);
    const peak = 0.13, end = t + Math.max(0.03, dur * 0.92);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.006);
    amp.gain.linearRampToValueAtTime(peak * 0.7, t + 0.09);
    amp.gain.setValueAtTime(peak * 0.7, end - 0.02);
    amp.gain.linearRampToValueAtTime(0, end);
    osc.connect(amp);
    amp.connect(s.dry);
    amp.connect(s.send);
    osc.start(t);
    osc.stop(end + 0.02);
    osc.onended = () => depth.disconnect();
  }

  /** A plain note with a short attack and release (the bass, and the second lead). */
  private voice(g: Graph, out: AudioNode, type: OscillatorType, note: number, t: number, dur: number, gain: number) {
    const osc = g.ctx.createOscillator(), amp = g.ctx.createGain(), end = t + Math.max(0.03, dur);
    osc.type = type;
    osc.frequency.value = midi(note);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(gain, t + 0.005);
    amp.gain.setValueAtTime(gain, end - 0.02);
    amp.gain.linearRampToValueAtTime(0, end);
    osc.connect(amp).connect(out);
    osc.start(t);
    osc.stop(end + 0.01);
  }

  /** One note of the arpeggio: a thin pulse that dies away at once. */
  private blip(g: Graph, out: AudioNode, note: number, t: number, dur: number) {
    const osc = g.ctx.createOscillator(), amp = g.ctx.createGain();
    osc.setPeriodicWave(g.thin);
    osc.frequency.value = midi(note);
    amp.gain.setValueAtTime(0.035, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.95);
    osc.connect(amp).connect(out);
    osc.start(t);
    osc.stop(t + dur);
  }

  private kick(g: Graph, out: AudioNode, t: number) {
    const osc = g.ctx.createOscillator(), amp = g.ctx.createGain();
    osc.frequency.setValueAtTime(155, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    amp.gain.setValueAtTime(0.55, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(amp).connect(out);
    osc.start(t);
    osc.stop(t + 0.17);
  }

  private noiseHit(g: Graph, out: AudioNode, t: number, dur: number, gain: number, type: BiquadFilterType, freq: number) {
    const src = g.ctx.createBufferSource(), filter = g.ctx.createBiquadFilter(), amp = g.ctx.createGain();
    src.buffer = g.noise;
    filter.type = type;
    filter.frequency.value = freq;
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(amp).connect(out);
    src.start(t, Math.random() * 0.8, dur + 0.01);
  }

  private snare(g: Graph, out: AudioNode, t: number, loud: number) {
    this.noiseHit(g, out, t, 0.13, 0.24 * loud, 'highpass', 1300);
    const osc = g.ctx.createOscillator(), amp = g.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(140, t + 0.06);
    amp.gain.setValueAtTime(0.16 * loud, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    osc.connect(amp).connect(out);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  private hat(g: Graph, out: AudioNode, t: number, loud: number) {
    this.noiseHit(g, out, t, loud > 0.7 ? 0.05 : 0.025, 0.07 * loud, 'highpass', 7500);
  }
}
