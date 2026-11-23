// Push 3 MIDI protocol: turns raw MIDI bytes into friendly events, and builds the
// SysEx commands we send back. Sources: Ableton's Push 2 MIDI & Display Interface
// manual (official) + danielknng/push3-protocol-docs and DrivenByMoss (Push 3 extras).
import { BUTTON_BY_CC, ENCODER_BY_CC, EXTRA_CC_NAMES, TOUCH_NOTES, padPos } from './layout.js';

export const sysex = (...bytes) => [0xf0, 0x00, 0x21, 0x1d, 0x01, 0x01, ...bytes, 0xf7];
const lsb = (v) => v & 0x7f, msb = (v) => (v >> 7) & 0x7f;

export const CMD = {
  // 0 = channel pressure, 1 = poly aftertouch, 2 = MPE (MPE value is Push 3 / community-sourced)
  pressureMode: (mode) => sysex(0x1e, mode),
  // MPE per-pad options (community-sourced from DrivenByMoss): 0x08 per-pad pitch bend (2 = on)
  mpeParam: (param, value) => sysex(0x26, 0x07, param, value, 0x00),
  // Touch strip flags (official): 0x68 = Push draws a point & auto-returns, 0x03 = host draws via SysEx
  stripConfig: (flags) => sysex(0x17, flags & 0x7f),
  // 31 LEDs, 0..7 each, two per byte (official packing)
  stripLeds: (levels) => {
    const bytes = [];
    for (let i = 0; i < 31; i += 2) bytes.push((levels[i] & 7) | (((levels[i + 1] ?? 0) & 7) << 3));
    return sysex(0x19, ...bytes);
  },
  paletteEntry: (i, r, g, b, w) => sysex(0x03, i, lsb(r), msb(r), lsb(g), msb(g), lsb(b), msb(b), lsb(w), msb(w)),
  reapplyPalette: () => sysex(0x05),
  ledBrightness: (v) => sysex(0x06, v & 0x7f),
};

export const PRESSURE = { channel: 0, poly: 1, mpe: 2 };

const rel = (v) => (v < 64 ? v : v - 128); // relative encoder: 1..63 right, 127..64 left

export class Parser {
  constructor() {
    this.mpeChannelNote = new Map(); // MPE: each finger gets its own channel
  }

  /** @returns {Array<object>} events */
  parse(d, port = 'user') {
    const status = d[0];
    if (status === 0xf0) return [{ type: 'sysex', data: d, port }];
    const kind = status & 0xf0, ch = status & 0x0f;
    const a = d[1], b = d[2];

    if (kind === 0x90 || kind === 0x80) {
      const on = kind === 0x90 && b > 0;
      if (a >= 36 && a <= 99) {
        if (ch > 0) on ? this.mpeChannelNote.set(ch, a) : this.mpeChannelNote.delete(ch);
        return [{ type: 'pad', action: on ? 'down' : 'up', note: a, ...padPos(a), velocity: on ? b : 0, ch }];
      }
      if (a in TOUCH_NOTES) return [{ type: 'touch', id: TOUCH_NOTES[a], touched: on }];
      return [{ type: 'unknown', what: `note ${a}`, d }];
    }

    if (kind === 0xa0) return [{ type: 'pad', action: 'pressure', note: a, ...padPos(a), pressure: b / 127, ch }];

    if (kind === 0xd0) {
      const note = this.mpeChannelNote.get(ch);
      if (ch > 0 && note != null) return [{ type: 'pad', action: 'pressure', note, ...padPos(note), pressure: a / 127, ch }];
      return [{ type: 'channelPressure', pressure: a / 127 }];
    }

    if (kind === 0xe0) {
      const v = (b << 7) | a; // 0..16383
      const note = this.mpeChannelNote.get(ch);
      if (ch > 0 && note != null) return [{ type: 'pad', action: 'bend', note, ...padPos(note), x: (v - 8192) / 8192, ch }];
      return [{ type: 'strip', value: v / 16383 }];
    }

    if (kind === 0xb0) {
      // 120–127 are MIDI "channel mode" messages (e.g. All Notes Off when the pad mode changes)
      if (a >= 120) return [{ type: 'unknown', what: `${a === 123 ? 'All notes off' : `Channel mode CC ${a}`}${ch ? ` ch${ch + 1}` : ''}`, d }];
      if (ch > 0) {
        const note = this.mpeChannelNote.get(ch);
        if (a === 74 && note != null) return [{ type: 'pad', action: 'slide', note, ...padPos(note), y: b / 127, ch }];
        return [{ type: 'unknown', what: `CC ${a} ch${ch + 1}`, d }];
      }
      if (a === 15) {
        // Shared: tempo-knob press sends exactly 0/127, swing rotation sends 1..126.
        if (b === 0 || b === 127) return [{ type: 'button', id: 'tempoPress', cc: 15, label: 'Tempo knob press', pressed: b === 127 }];
        return [{ type: 'encoder', id: 'tempo', delta: rel(b), cc: 15 }];
      }
      if (a === 11) return [{ type: 'touch', id: 'jog', touched: b > 0 }];
      if (a === 1) return [{ type: 'strip', value: b / 127 }];
      const enc = ENCODER_BY_CC.get(a);
      if (enc) return [{ type: 'encoder', id: enc.id, delta: rel(b), cc: a }];
      if (a === 93 || a === 95) return [{ type: 'button', id: a === 93 ? 'jogLeft' : 'jogRight', cc: a, label: EXTRA_CC_NAMES[a], pressed: b > 0 }];
      if (a === 94) return [{ type: 'button', id: 'jogPress', cc: a, label: 'Jog press', pressed: b > 0 }];
      const btn = BUTTON_BY_CC.get(a);
      if (btn) return [{ type: 'button', id: btn.id, cc: a, label: btn.label, pressed: b > 0 }];
      return [{ type: 'button', id: `cc${a}`, cc: a, label: EXTRA_CC_NAMES[a] ?? `CC ${a}`, pressed: b > 0, unmapped: true }];
    }
    return [{ type: 'unknown', what: 'other', d }];
  }
}

export const hex = (d) => d.map((x) => x.toString(16).padStart(2, '0')).join(' ').toUpperCase();

export function describe(ev) {
  switch (ev.type) {
    case 'pad': {
      const where = `Pad r${8 - ev.rowFromTop}c${ev.col + 1}`;
      if (ev.action === 'down') return `${where} down · vel ${ev.velocity}${ev.ch ? ` · ch${ev.ch + 1}` : ''}`;
      if (ev.action === 'up') return `${where} up`;
      if (ev.action === 'pressure') return `${where} pressure ${(ev.pressure * 100) | 0}%`;
      if (ev.action === 'bend') return `${where} slide ↔ ${ev.x.toFixed(2)}`;
      if (ev.action === 'slide') return `${where} slide ↕ ${ev.y.toFixed(2)}`;
      return where;
    }
    case 'button': return `${ev.label} ${ev.pressed ? 'pressed' : 'released'}`;
    case 'encoder': return `${ev.id} turned ${ev.delta > 0 ? '+' : ''}${ev.delta}`;
    case 'touch': return `${ev.id} ${ev.touched ? 'touched' : 'released'}`;
    case 'strip': return `Touch strip ${(ev.value * 100) | 0}%`;
    case 'channelPressure': return `Pressure ${(ev.pressure * 100) | 0}%`;
    case 'sysex': return `SysEx reply`;
    default: return ev.what ?? ev.type;
  }
}
