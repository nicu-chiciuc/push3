// Raw MIDI bytes from the Push → typed PushEvents (hot path, plain TS).
import { BUTTON_BY_CC, ENCODER_BY_CC, EXTRA_CC_NAMES, TOUCH_NOTES, padPos } from './controls.ts';
import type { PushEvent } from './events.ts';

const rel = (v: number) => (v < 64 ? v : v - 128); // relative encoders: 1..63 right, 127..64 left

export class MidiParser {
  /** MPE gives each finger its own channel; remember which pad each channel belongs to. */
  private readonly channelNote = new Map<number, number>();

  parse(d: ReadonlyArray<number>): PushEvent {
    const status = d[0]!;
    if (status === 0xf0) return { type: 'sysex', data: d };
    const kind = status & 0xf0, ch = status & 0x0f;
    const a = d[1] ?? 0, b = d[2] ?? 0;

    if (kind === 0x90 || kind === 0x80) {
      const on = kind === 0x90 && b > 0;
      if (a >= 36 && a <= 99) {
        if (ch > 0) on ? this.channelNote.set(ch, a) : this.channelNote.delete(ch);
        const base = { type: 'pad', note: a, ...padPos(a), ch } as const;
        return on ? { ...base, action: 'down', velocity: b } : { ...base, action: 'up' };
      }
      const touch = TOUCH_NOTES[a];
      if (touch) return { type: 'touch', id: touch, touched: on };
      return { type: 'other', what: `note ${a}` };
    }

    if (kind === 0xa0) return { type: 'pad', action: 'pressure', note: a, ...padPos(a), pressure: b / 127, ch };

    if (kind === 0xd0) {
      const note = this.channelNote.get(ch);
      if (ch > 0 && note != null) return { type: 'pad', action: 'pressure', note, ...padPos(note), pressure: a / 127, ch };
      return { type: 'channelPressure', pressure: a / 127 };
    }

    if (kind === 0xe0) {
      const v = (b << 7) | a; // 0..16383
      const note = this.channelNote.get(ch);
      if (ch > 0 && note != null) return { type: 'pad', action: 'bend', note, ...padPos(note), x: (v - 8192) / 8192, ch };
      return { type: 'strip', value: v / 16383 };
    }

    if (kind === 0xb0) {
      // 120–127 are MIDI channel-mode messages (e.g. All Notes Off when the pad mode changes)
      if (a >= 120) return { type: 'other', what: `${a === 123 ? 'All notes off' : `Channel mode CC ${a}`}${ch ? ` ch${ch + 1}` : ''}` };
      if (ch > 0) {
        const note = this.channelNote.get(ch);
        if (a === 74 && note != null) return { type: 'pad', action: 'slide', note, ...padPos(note), y: b / 127, ch };
        return { type: 'other', what: `CC ${a} ch${ch + 1}` };
      }
      if (a === 15) {
        // Shared: tempo-knob press sends exactly 0/127; swing rotation sends 1..126.
        if (b === 0 || b === 127) return { type: 'button', id: 'tempoPress', cc: 15, label: 'Tempo knob press', pressed: b === 127 };
        return { type: 'encoder', id: 'tempo', delta: rel(b) };
      }
      if (a === 11) return { type: 'touch', id: 'jog', touched: b > 0 };
      if (a === 1) return { type: 'strip', value: b / 127 };
      const enc = ENCODER_BY_CC.get(a);
      if (enc) return { type: 'encoder', id: enc.id, delta: rel(b) };
      if (a === 93 || a === 95) return { type: 'button', id: a === 93 ? 'jogLeft' : 'jogRight', cc: a, label: EXTRA_CC_NAMES[a]!, pressed: b > 0 };
      if (a === 94) return { type: 'button', id: 'jogPress', cc: a, label: 'Jog press', pressed: b > 0 };
      const btn = BUTTON_BY_CC.get(a);
      if (btn) return { type: 'button', id: btn.id, cc: a, label: btn.label, pressed: b > 0 };
      return { type: 'button', id: `cc${a}`, cc: a, label: EXTRA_CC_NAMES[a] ?? `CC ${a}`, pressed: b > 0, unmapped: true };
    }
    return { type: 'other', what: `status ${status.toString(16)}` };
  }
}

export const hex = (d: ReadonlyArray<number>) => d.map((x) => x.toString(16).padStart(2, '0')).join(' ').toUpperCase();

export function describe(ev: PushEvent): string {
  switch (ev.type) {
    case 'pad': {
      const where = `Pad r${8 - ev.rowFromTop}c${ev.col + 1}`;
      switch (ev.action) {
        case 'down': return `${where} down · vel ${ev.velocity}${ev.ch ? ` · ch${ev.ch + 1}` : ''}`;
        case 'up': return `${where} up`;
        case 'pressure': return `${where} pressure ${Math.round(ev.pressure * 100)}%`;
        case 'bend': return `${where} roll ↔ ${ev.x.toFixed(2)}`;
        case 'slide': return `${where} slide ↕ ${ev.y.toFixed(2)}`;
      }
    }
    case 'button': return `${ev.label} ${ev.pressed ? 'pressed' : 'released'}`;
    case 'encoder': return `${ev.id} turned ${ev.delta > 0 ? '+' : ''}${ev.delta}`;
    case 'touch': return `${ev.id} ${ev.touched ? 'touched' : 'released'}`;
    case 'strip': return `Touch strip ${Math.round(ev.value * 100)}%`;
    case 'channelPressure': return `Pressure ${Math.round(ev.pressure * 100)}%`;
    case 'sysex': return 'SysEx reply';
    case 'other': return ev.what;
  }
}
