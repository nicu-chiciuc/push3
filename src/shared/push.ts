// Push 3 hardware constants and SysEx command builders, shared by bridge and app.
// Sources: Ableton's Push 2 MIDI & Display Interface manual (official; the display,
// palette, LED animations and touch strip are unchanged on Push 3) plus community
// Push 3 notes (danielknng/push3-protocol-docs, DrivenByMoss) for MPE.

export const USB_VENDOR_ID = 0x2982;
export const USB_PRODUCT_ID = 0x1969; // Push 3 (Push 2 is 0x1967)

export const DISPLAY_WIDTH = 960;
export const DISPLAY_HEIGHT = 160;
export const DISPLAY_FRAME_BYTES = DISPLAY_WIDTH * DISPLAY_HEIGHT * 2; // RGB565

export type Bytes = ReadonlyArray<number>;

export const sysex = (...bytes: ReadonlyArray<number>): Array<number> => [0xf0, 0x00, 0x21, 0x1d, 0x01, 0x01, ...bytes, 0xf7];
const lsb = (v: number) => v & 0x7f;
const msb = (v: number) => (v >> 7) & 0x7f;

export type PressureMode = 'channel' | 'poly' | 'mpe';
const PRESSURE_CODE: Record<PressureMode, number> = { channel: 0, poly: 1, mpe: 2 };

export const Cmd = {
  /** 0 = Live mode (Live drives Push), 1 = User mode (raw MIDI on the User port). */
  midiMode: (mode: 'live' | 'user') => sysex(0x0a, mode === 'user' ? 1 : 0),
  ledBrightness: (v: number) => sysex(0x06, v & 0x7f),
  displayBrightness: (v: number) => sysex(0x08, v & 0x7f, (v >> 7) & 0x01),
  /** MPE value (2) is Push 3 / community-sourced; 0 and 1 are official. */
  pressureMode: (mode: PressureMode) => sysex(0x1e, PRESSURE_CODE[mode]),
  /** MPE per-pad options (community-sourced): 0x08 per-pad pitch bend (2 = on). */
  mpeParam: (param: number, value: number) => sysex(0x26, 0x07, param, value, 0x00),
  /** Touch strip flags (official): 0x68 = Push draws a point & auto-returns, 0x03 = host draws via SysEx. */
  stripConfig: (flags: number) => sysex(0x17, flags & 0x7f),
  /** 31 LEDs, 0..7 each, two per byte (official packing). */
  stripLeds: (levels: ReadonlyArray<number>) => {
    const bytes: Array<number> = [];
    for (let i = 0; i < 31; i += 2) bytes.push((levels[i]! & 7) | (((levels[i + 1] ?? 0) & 7) << 3));
    return sysex(0x19, ...bytes);
  },
  paletteEntry: (i: number, r: number, g: number, b: number, w: number) =>
    sysex(0x03, i, lsb(r), msb(r), lsb(g), msb(g), lsb(b), msb(b), lsb(w), msb(w)),
  reapplyPalette: () => sysex(0x05),
  identityRequest: () => [0xf0, 0x7e, 0x01, 0x06, 0x01, 0xf7],
} as const;

export const STRIP_PUSH_DRAWS = 0x68;
export const STRIP_HOST_DRAWS = 0x03;
