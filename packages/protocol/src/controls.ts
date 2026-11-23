// Every control of the Push 3 and the MIDI number it uses (User Mode, channel 1).
// Sources: Ableton's Push 2 MIDI & Display Interface manual, plus community Push 3 notes
// (danielknng/push3-protocol-docs, DrivenByMoss) for what changed on Push 3.
// Where each control sits on the device is not here: that is the 3D twin's business.

/** A knob. Turns send relative CC values; touching it sends a note (touch). */
export interface EncoderSpec {
  readonly id: string;
  readonly label: string;
  readonly cc: number;
  /** Note number sent on touch/release. */
  readonly touch: number;
  /** Relative steps per full turn (approximate). */
  readonly steps: number;
}

/** A button. Pressing sends CC 127, releasing CC 0; the same CC sets its LED. */
export interface ButtonSpec {
  readonly id: string;
  readonly label: string;
  readonly cc: number;
  /** true: full RGB LED (palette color). false: white only (palette index = brightness). */
  readonly rgb: boolean;
}

/** The 64 pads send notes 36 (bottom left) to 99 (top right). */
export const PAD_NOTES = { first: 36, last: 99 } as const;
export const padNote = (rowFromTop: number, col: number): number => 36 + (7 - rowFromTop) * 8 + col;
export const padPos = (note: number): { rowFromTop: number; col: number } => {
  const i = note - 36;
  return { rowFromTop: 7 - Math.floor(i / 8), col: i % 8 };
};
export const isPadNote = (note: number): boolean => note >= 36 && note <= 99;

const E = (id: string, label: string, cc: number, touch: number, steps = 210): EncoderSpec => ({ id, label, cc, touch, steps });

export const ENCODERS: ReadonlyArray<EncoderSpec> = [
  ...Array.from({ length: 8 }, (_, i) => E(`e${i + 1}`, `Knob ${i + 1}`, 71 + i, i)),
  E('volume', 'Volume', 79, 8),
  E('tempo', 'Tempo / Swing', 14, 10, 18),
  E('jog', 'Jog wheel', 70, 11, 48),
];

const B = (id: string, label: string, cc: number, rgb = false): ButtonSpec => ({ id, label, cc, rgb });

export const BUTTONS: ReadonlyArray<ButtonSpec> = [
  B('sets', 'Sets', 80), B('setup', 'Setup', 30), B('learn', 'Learn', 81), B('user', 'User', 59),
  ...Array.from({ length: 8 }, (_, i) => B(`upper${i + 1}`, `Upper ${i + 1}`, 102 + i, true)),
  ...Array.from({ length: 8 }, (_, i) => B(`lower${i + 1}`, `Lower ${i + 1}`, 20 + i, true)),
  B('device', 'Device', 110), B('mix', 'Mix', 112), B('clip', 'Clip', 113), B('browse', 'Browse', 111),
  B('undo', 'Undo', 119), B('save', 'Save', 82), B('add', 'Add', 32), B('swap', 'Swap', 33),
  B('lock', 'Lock', 83), B('stop', 'Stop Clip', 29, true), B('mute', 'Mute', 60, true), B('solo', 'Solo', 61, true),
  B('master', 'Master', 28),
  B('tapTempo', 'Tap Tempo', 3), B('metronome', 'Metronome', 9), B('quantize', 'Quantize', 116),
  B('fixedLength', 'Fixed Length', 90), B('automate', 'Automate', 89, true), B('new', 'New', 92),
  B('capture', 'Capture', 65), B('record', 'Record', 86, true), B('play', 'Play', 85, true),
  // scene launch / note repeat rates, top (CC 43, 1/32t) to bottom (CC 36, 1/4)
  ...['1/32t', '1/32', '1/16t', '1/16', '1/8t', '1/8', '1/4t', '1/4'].map((t, i) => B(`scene${i + 1}`, `Scene ${i + 1} (${t})`, 43 - i, true)),
  B('up', 'Up', 46), B('left', 'Left', 44), B('center', 'Center', 91), B('right', 'Right', 45), B('down', 'Down', 47),
  B('note', 'Note', 50), B('session', 'Session', 51), B('scale', 'Scale', 58), B('layout', 'Layout', 31),
  B('repeat', 'Repeat', 56), B('accent', 'Accent', 57), B('doubleLoop', 'Double Loop', 117), B('duplicate', 'Duplicate', 88),
  B('convert', 'Convert', 35), B('delete', 'Delete', 118),
  B('octaveUp', 'Octave Up', 55), B('octaveDown', 'Octave Down', 54), B('pageLeft', 'Page Left', 62), B('pageRight', 'Page Right', 63),
  B('shift', 'Shift', 49), B('select', 'Select', 48),
];

/** CCs with a known name that are not buttons of their own above. */
export const EXTRA_CC_NAMES: Readonly<Record<number, string>> = {
  52: 'Add Device', 53: 'Add Track', 87: 'New (Push 2 number)', 114: 'Volume button', 115: 'Pan/Send',
  64: 'Footswitch 1', 69: 'Footswitch 2', 93: 'Jog nudge left', 94: 'Jog press', 95: 'Jog nudge right',
};

/** Touch notes: which control a touch note belongs to. */
export const TOUCH_NOTES: Readonly<Record<number, string>> = {
  0: 'e1', 1: 'e2', 2: 'e3', 3: 'e4', 4: 'e5', 5: 'e6', 6: 'e7', 7: 'e8', 8: 'volume', 9: 'tempo', 10: 'tempo', 11: 'jog', 12: 'strip',
};

export const BUTTON_BY_CC: ReadonlyMap<number, ButtonSpec> = new Map(BUTTONS.map((b) => [b.cc, b]));
export const BUTTON_BY_ID: ReadonlyMap<string, ButtonSpec> = new Map(BUTTONS.map((b) => [b.id, b]));
export const ENCODER_BY_CC: ReadonlyMap<number, EncoderSpec> = new Map(ENCODERS.map((e) => [e.cc, e]));
export const ENCODER_BY_ID: ReadonlyMap<string, EncoderSpec> = new Map(ENCODERS.map((e) => [e.id, e]));
