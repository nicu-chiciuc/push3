// LED state for pads, buttons and the touch strip. Demos set colors freely every frame;
// only real changes go to the hardware, and the 3D twin mirrors the same state.
import { Cmd, type Bytes } from './device.ts';
import { nearest } from './palette.ts';
import type { RGB } from './events.ts';

// MIDI channel = animation (official): 0 static · 1–5 one-shot · 6–10 pulse · 11–15 blink
export const ANIM = { pulseSlow: 9, pulse: 8, pulseFast: 7, blinkSlow: 14, blink: 13, blinkFast: 12 } as const;

export interface LedState { readonly idx: number; readonly ch: number; readonly from: number }
export type LedKey = `n${number}` | `c${number}`;
export type Color = RGB | number | null; // RGB, raw palette index, or off
export interface Anim { readonly ch: number; readonly from?: RGB }

type Listener = (key: LedKey | 'strip', state: LedState | ReadonlyArray<number>) => void;

export class Leds {
  private readonly state = new Map<LedKey, LedState>();
  private readonly pending = new Map<LedKey, LedState>();
  private strip: Array<number> = new Array(31).fill(0);
  stripDirty = false;
  private readonly listeners = new Set<Listener>();

  onChange(fn: Listener) { this.listeners.add(fn); }

  pad(note: number, color: Color, anim?: Anim) { this.set(`n${note}`, color, anim); }
  button(cc: number, color: Color, anim?: Anim) { this.set(`c${cc}`, color, anim); }

  private set(key: LedKey, color: Color, anim?: Anim) {
    const idx = color == null ? 0 : typeof color === 'number' ? color : nearest(color);
    const ch = anim?.ch ?? 0;
    const from = anim ? nearest(anim.from ?? [0, 0, 0]) : 0;
    const prev = this.state.get(key);
    if (prev ? prev.idx === idx && prev.ch === ch && prev.from === from : idx === 0 && ch === 0) return;
    const s = { idx, ch, from };
    this.state.set(key, s);
    this.pending.set(key, s);
    for (const fn of this.listeners) fn(key, s);
  }

  /** levels: 31 values 0..7, bottom → top. Only shown when the strip is in host mode. */
  setStrip(levels: ReadonlyArray<number>) {
    if (levels.every((v, i) => v === this.strip[i])) return;
    this.strip = levels.slice();
    this.stripDirty = true;
    for (const fn of this.listeners) fn('strip', this.strip);
  }

  clear() {
    for (const key of this.state.keys()) this.set(key, null);
  }

  /** Re-send everything (after the Push reconnects or the page reloads). */
  invalidate() {
    for (const [k, s] of this.state) this.pending.set(k, s);
    this.stripDirty = true;
  }

  /** MIDI messages for everything that changed since the last flush. */
  flush(stripHostMode: boolean): Array<Bytes> {
    const out: Array<Bytes> = [];
    for (const [key, s] of this.pending) {
      const num = +key.slice(1), status = key[0] === 'n' ? 0x90 : 0xb0;
      if (s.ch) out.push([status, num, s.from], [status | s.ch, num, s.idx]); // animate from → to
      else out.push([status, num, s.idx]);
    }
    this.pending.clear();
    if (this.stripDirty && stripHostMode) out.push(Cmd.stripLeds(this.strip));
    this.stripDirty = false;
    return out;
  }
}
