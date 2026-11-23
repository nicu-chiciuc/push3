// Tiny Web Audio synth with per-note expression (MPE-style): pitch bend, slide → filter, pressure → volume.
interface Voice { a: OscillatorNode; b: OscillatorNode; filter: BiquadFilterNode; amp: GainNode }

export class Synth {
  ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  readonly voices = new Map<number, Voice>();
  bendRange = 2; // semitones for a full left/right roll

  start() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.22;
      const comp = this.ctx.createDynamicsCompressor();
      this.out.connect(comp).connect(this.ctx.destination);
    }
    return this.ctx.resume();
  }

  get running() { return this.ctx?.state === 'running'; }

  noteOn(id: number, midiNote: number, velocity: number) {
    if (!this.running || !this.ctx || !this.out) return;
    this.noteOff(id);
    const c = this.ctx, t = c.currentTime;
    const freq = 440 * 2 ** ((midiNote - 69) / 12);
    const a = c.createOscillator(), b = c.createOscillator();
    a.type = 'sawtooth';
    b.type = 'square';
    a.frequency.value = freq;
    b.frequency.value = freq / 2;
    b.detune.value = 6;
    const mixB = c.createGain();
    mixB.gain.value = 0.35;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 6;
    filter.frequency.value = 900;
    const amp = c.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(0.25 + (velocity / 127) * 0.5, t + 0.01);
    a.connect(filter);
    b.connect(mixB).connect(filter);
    filter.connect(amp).connect(this.out);
    a.start(t);
    b.start(t);
    this.voices.set(id, { a, b, filter, amp });
  }

  express(id: number, { bend = 0, slide = 0.5, pressure = 0.5 }: { bend?: number; slide?: number; pressure?: number }) {
    const v = this.voices.get(id);
    if (!v || !this.ctx) return;
    const t = this.ctx.currentTime;
    const cents = bend * this.bendRange * 100;
    v.a.detune.setTargetAtTime(cents, t, 0.01);
    v.b.detune.setTargetAtTime(cents + 6, t, 0.01);
    v.filter.frequency.setTargetAtTime(200 + slide * slide * 6000, t, 0.02);
    v.amp.gain.setTargetAtTime(0.08 + pressure * 0.7, t, 0.02);
  }

  noteOff(id: number) {
    const v = this.voices.get(id);
    if (!v || !this.ctx) return;
    this.voices.delete(id);
    const t = this.ctx.currentTime;
    v.amp.gain.cancelScheduledValues(t);
    v.amp.gain.setTargetAtTime(0, t, 0.08);
    v.a.stop(t + 0.6);
    v.b.stop(t + 0.6);
  }
}
