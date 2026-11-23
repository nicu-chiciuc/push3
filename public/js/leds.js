// LED state for pads, buttons and the touch strip. Demos set colors freely every frame;
// only real changes are sent to the hardware, and the 3D twin mirrors the same state.
import { nearest } from './palette.js';
import { CMD } from './protocol.js';

// MIDI channel = animation (official): 0 static · 1–5 one-shot · 6–10 pulse · 11–15 blink
export const ANIM = { pulseSlow: 9, pulse: 8, pulseFast: 7, blinkSlow: 14, blink: 13, blinkFast: 12 };

export class Leds {
  constructor() {
    this.state = new Map(); // key ('n36' / 'c102') -> { idx, ch, from }
    this.pending = new Map();
    this.strip = new Array(31).fill(0);
    this.stripDirty = false;
    this.listeners = new Set();
  }

  onChange(fn) { this.listeners.add(fn); }

  pad(note, color, anim) { this.#set(`n${note}`, color, anim); }
  button(cc, color, anim) { this.#set(`c${cc}`, color, anim); }
  get(key) { return this.state.get(key) ?? { idx: 0, ch: 0, from: 0 }; }

  /** Pass a palette index directly, an [r,g,b], or null for off. anim = { ch, from: [r,g,b] } */
  #set(key, color, anim) {
    const idx = color == null ? 0 : typeof color === 'number' ? color : nearest(color);
    const ch = anim?.ch ?? 0;
    const from = anim ? nearest(anim.from ?? [0, 0, 0]) : 0;
    const prev = this.state.get(key);
    if (prev && prev.idx === idx && prev.ch === ch && prev.from === from) return;
    if (!prev && idx === 0 && ch === 0) return;
    const s = { idx, ch, from };
    this.state.set(key, s);
    this.pending.set(key, s);
    for (const fn of this.listeners) fn(key, s);
  }

  /** levels: 31 values 0..7, bottom → top. Only shown when the strip is in host mode. */
  setStrip(levels) {
    if (levels.every((v, i) => v === this.strip[i])) return;
    this.strip = levels.slice();
    this.stripDirty = true;
    for (const fn of this.listeners) fn('strip', this.strip);
  }

  clear() {
    for (const key of this.state.keys()) {
      const type = key[0], num = +key.slice(1);
      type === 'n' ? this.pad(num, null) : this.button(num, null);
    }
  }

  /** Re-send everything (after the Push reconnects or the page reloads). */
  invalidate() {
    for (const [k, s] of this.state) this.pending.set(k, s);
    this.stripDirty = true;
  }

  /** @returns {number[][]} MIDI messages for everything that changed */
  flush(stripHostMode) {
    const out = [];
    for (const [key, s] of this.pending) {
      const num = +key.slice(1), status = key[0] === 'n' ? 0x90 : 0xb0;
      if (s.ch) out.push([status, num, s.from], [status | s.ch, num, s.idx]); // animate from → to
      else out.push([status, num, s.idx]);
    }
    this.pending.clear();
    if (this.stripDirty && stripHostMode) out.push(CMD.stripLeds(this.strip));
    this.stripDirty = false;
    return out;
  }
}
