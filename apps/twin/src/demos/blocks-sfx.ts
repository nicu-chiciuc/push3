// Sounds for Blocks, made with Web Audio oscillators (no samples). Each column has a note of a
// five-note scale, so a piece that moves across the well plays a small run.

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);
/** C major pentatonic, one note for each column, left to right. */
const COLUMN_NOTES = [60, 62, 64, 67, 69, 72, 74, 76];
const SCALE = [0, 2, 4, 7, 9];
/** Scale step `i` above middle C. */
const step = (i: number) => 60 + 12 * Math.floor(i / 5) + SCALE[((i % 5) + 5) % 5]!;

interface Tone { type?: OscillatorType; gain?: number; dur?: number; at?: number; to?: number; attack?: number }

export class Sfx {
  on = true;
  /** 0..1 */
  volume = 0.7;
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;

  /** Start the audio clock. The browser allows it only after a click or key press on the page. */
  wake() {
    if (!this.on) return;
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.out = this.ctx.createGain();
        const comp = this.ctx.createDynamicsCompressor();
        this.out.connect(comp).connect(this.ctx.destination);
        this.setVolume(this.volume);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch { /* no audio device: the game plays silent */ }
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(this.volume * this.volume * 0.9, this.ctx.currentTime, 0.02);
  }

  setOn(on: boolean) {
    this.on = on;
    if (on) this.wake(); else void this.ctx?.suspend();
  }

  /** The audio clock when sound can play now, else null (sounds are dropped, not kept for later). */
  private now(): number | null {
    if (!this.on) return null;
    this.wake();
    return this.ctx && this.ctx.state === 'running' ? this.ctx.currentTime : null;
  }

  private tone(freq: number, { type = 'triangle', gain = 0.1, dur = 0.1, at = 0, to, attack = 0.004 }: Tone = {}) {
    const t0 = this.now();
    if (t0 == null || !this.ctx || !this.out) return;
    const t = t0 + at, osc = this.ctx.createOscillator(), amp = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(gain, t + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp).connect(this.out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** A short burst of filtered noise that sweeps from one frequency to another. */
  private hiss(from: number, to: number, dur: number, gain: number, at = 0) {
    const t0 = this.now();
    if (t0 == null || !this.ctx || !this.out) return;
    const c = this.ctx, t = t0 + at;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(), band = c.createBiquadFilter(), amp = c.createGain();
    src.buffer = buf;
    band.type = 'bandpass';
    band.Q.value = 1.2;
    band.frequency.setValueAtTime(from, t);
    band.frequency.exponentialRampToValueAtTime(to, t + dur);
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(band).connect(amp).connect(this.out);
    src.start(t);
  }

  /** `at`: seconds from now, so several moves in one frame play as a run. */
  move(col: number, at = 0) { this.tone(midi(COLUMN_NOTES[Math.max(0, Math.min(7, col))]!), { type: 'sine', gain: 0.07, dur: 0.07, at }); }

  rotate() {
    this.tone(midi(79), { gain: 0.06, dur: 0.05 });
    this.tone(midi(86), { gain: 0.05, dur: 0.07, at: 0.035 });
  }

  hold() { this.hiss(500, 2400, 0.14, 0.16); }

  lock(col: number) {
    this.tone(150, { type: 'sine', gain: 0.3, dur: 0.1, to: 60 });
    this.tone(midi(COLUMN_NOTES[Math.max(0, Math.min(7, col))]! - 12), { gain: 0.06, dur: 0.12 });
  }

  drop(col: number) {
    this.tone(190, { type: 'sine', gain: 0.5, dur: 0.18, to: 42 });
    this.hiss(1800, 300, 0.07, 0.2);
    this.tone(midi(COLUMN_NOTES[Math.max(0, Math.min(7, col))]! - 12), { gain: 0.07, dur: 0.16 });
  }

  /** A rising run: longer for more lines, higher for a longer combo. */
  clear(lines: number, combo: number) {
    const root = Math.min(combo - 1, 8) + 5;
    const notes = lines >= 4 ? [0, 2, 4, 5, 7, 9, 10] : [0, 2, 4, 5].slice(0, lines + 1);
    notes.forEach((n, i) => this.tone(midi(step(root + n)), { gain: 0.13, dur: lines >= 4 ? 0.3 : 0.2, at: i * 0.055 }));
    this.hiss(3000, 9000, 0.25, lines >= 4 ? 0.1 : 0.05);
    if (lines >= 4) this.tone(midi(step(root + 10) + 12), { type: 'sine', gain: 0.08, dur: 0.7, at: 0.4 });
  }

  sweep() { [0, 2, 4, 5, 7, 9, 10, 12].forEach((n, i) => this.tone(midi(step(10 + n)), { type: 'sine', gain: 0.09, dur: 0.5, at: 0.25 + i * 0.045 })); }

  level() { [67, 72, 76, 79, 84].forEach((n, i) => this.tone(midi(n), { type: 'square', gain: 0.05, dur: i === 4 ? 0.45 : 0.11, at: 0.3 + i * 0.085 })); }

  start() { [60, 67, 72].forEach((n, i) => this.tone(midi(n), { gain: 0.1, dur: 0.14, at: i * 0.07 })); }

  pause(on: boolean) { (on ? [72, 67] : [67, 72]).forEach((n, i) => this.tone(midi(n), { type: 'sine', gain: 0.08, dur: 0.1, at: i * 0.07 })); }

  over() {
    [64, 60, 57, 53, 48].forEach((n, i) => this.tone(midi(n), { type: 'sawtooth', gain: 0.06, dur: i === 4 ? 0.9 : 0.24, at: i * 0.17 }));
    this.tone(120, { type: 'sine', gain: 0.3, dur: 1.1, to: 35, at: 0.68 });
  }
}
