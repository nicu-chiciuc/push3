// Physical layout of the Push 3 and the MIDI numbers each control uses.
// Positions are pixels traced from Ableton's top-down product photo (1400×1170 crop);
// MIDI numbers come from Ableton's Push 2 interface spec plus community Push 3 notes.
// If a control turns out to send something else, fix it here — everything else follows.

export const DEVICE = { x0: 25, y0: 20, x1: 1365, y1: 1140 };
export const CENTER = { x: (DEVICE.x0 + DEVICE.x1) / 2, y: (DEVICE.y0 + DEVICE.y1) / 2 };
export const COLS = [330, 432, 535, 637, 740, 843, 945, 1047];
export const PAD_ROWS = [523, 599, 676, 752, 828, 904, 980, 1057]; // top → bottom
export const PAD_SIZE = { w: 94, h: 70 };
export const DISPLAY = { x: 690, y: 304, w: 814, h: 136 };
export const STRIP = { x: 211, y: 790, w: 52, h: 600 };

// Pads: note 36 is bottom-left, 99 top-right.
export const padNote = (rowFromTop, col) => 36 + (7 - rowFromTop) * 8 + col;
export const padPos = (note) => {
  const i = note - 36;
  return { rowFromTop: 7 - Math.floor(i / 8), col: i % 8 };
};

export const ENCODERS = [
  ...COLS.map((x, i) => ({ id: `e${i + 1}`, label: `Knob ${i + 1}`, cc: 71 + i, touch: i, x, y: 92, r: 23, h: 46, steps: 210 })),
  { id: 'volume', label: 'Volume', cc: 79, touch: 8, x: 95, y: 300, r: 42, h: 44, steps: 210 },
  { id: 'tempo', label: 'Tempo / Swing', cc: 14, touch: 10, x: 95, y: 515, r: 25, h: 40, steps: 18 },
  { id: 'jog', label: 'Jog wheel', cc: 70, touch: 11, x: 1270, y: 300, r: 70, h: 34, steps: 48 },
];

const B = (id, label, cc, x, y, w, h, o = {}) => ({ id, label, cc, x, y, w, h, rgb: !!o.rgb, bar: !!o.bar, text: o.text ?? label, size: o.size });

export const BUTTONS = [
  // top-left cluster
  B('sets', 'Sets', 80, 72, 170, 40, 34, { text: '▤' }),
  B('setup', 'Setup', 30, 122, 170, 40, 34, { text: '⚙' }),
  B('learn', 'Learn', 81, 172, 170, 40, 34, { text: '✦' }),
  B('user', 'User', 59, 222, 170, 40, 34, { text: '◉' }),
  // two rows of display buttons
  ...COLS.map((x, i) => B(`upper${i + 1}`, `Upper ${i + 1}`, 102 + i, x, 170, 88, 44, { rgb: true, bar: true, text: '' })),
  ...COLS.map((x, i) => B(`lower${i + 1}`, `Lower ${i + 1}`, 20 + i, x, 433, 88, 44, { rgb: true, bar: true, text: '' })),
  // top-right cluster
  B('device', 'Device', 110, 1152, 170, 40, 34, { text: '◠' }),
  B('mix', 'Mix', 112, 1202, 170, 40, 34, { text: '▮▮' }),
  B('clip', 'Clip', 113, 1252, 170, 40, 34, { text: '▭' }),
  B('browse', 'Browse', 111, 1302, 170, 40, 34, { text: '≡' }),
  // beside the display
  B('undo', 'Undo', 119, 225, 252, 44, 56),
  B('save', 'Save', 82, 225, 352, 44, 56),
  B('add', 'Add', 32, 1152, 252, 44, 56, { text: '+' , size: 1.6 }),
  B('swap', 'Swap', 33, 1152, 352, 44, 56, { text: '⇄', size: 1.4 }),
  // left of the lower row
  B('lock', 'Lock', 83, 72, 435, 40, 34, { text: '🔒︎' }),
  B('stop', 'Stop Clip', 29, 122, 435, 40, 34, { rgb: true, text: '■' }),
  B('mute', 'Mute', 60, 172, 435, 40, 34, { rgb: true, text: 'M' }),
  B('solo', 'Solo', 61, 222, 435, 40, 34, { rgb: true, text: 'S' }),
  B('master', 'Master', 28, 1152, 427, 44, 34, { text: '—' }),
  // left column
  B('tapTempo', 'Tap Tempo', 3, 95, 597, 92, 52, { text: 'Tap\nTempo' }),
  B('metronome', 'Metronome', 9, 95, 646, 92, 40, { text: '◔◕' }),
  B('quantize', 'Quantize', 116, 95, 688, 92, 40),
  B('fixedLength', 'Fixed Length', 90, 95, 768, 92, 40),
  B('automate', 'Automate', 89, 95, 808, 92, 40, { rgb: true }),
  B('new', 'New', 92, 95, 888, 92, 38),
  B('capture', 'Capture', 65, 95, 932, 92, 44, { text: '⛶' }),
  B('record', 'Record', 86, 95, 982, 92, 50, { rgb: true, text: '○', size: 1.5 }),
  B('play', 'Play', 85, 95, 1058, 92, 72, { rgb: true, text: '▷', size: 1.6 }),
  // scene / note-repeat column (top = 1/32t = CC 43)
  ...['1/32t', '1/32', '1/16t', '1/16', '1/8t', '1/8', '1/4t', '1/4'].map((t, i) =>
    B(`scene${i + 1}`, `Scene ${i + 1} (${t})`, 43 - i, 1152, PAD_ROWS[i], 40, 66, { rgb: true, text: t })),
  // navigation pad
  B('up', 'Up', 46, 1267, 437, 60, 30, { text: '︿' }),
  B('left', 'Left', 44, 1217, 485, 36, 52, { text: '‹', size: 1.5 }),
  B('center', 'Center', 91, 1267, 485, 46, 44, { text: '·', size: 2 }),
  B('right', 'Right', 45, 1317, 485, 36, 52, { text: '›', size: 1.5 }),
  B('down', 'Down', 47, 1267, 533, 60, 30, { text: '﹀' }),
  // right cluster
  B('note', 'Note', 50, 1234, 591, 62, 48, { text: '▦' }),
  B('session', 'Session', 51, 1301, 591, 62, 48, { text: '▥' }),
  B('scale', 'Scale', 58, 1234, 645, 62, 48),
  B('layout', 'Layout', 31, 1301, 645, 62, 48),
  B('repeat', 'Repeat', 56, 1234, 748, 62, 64),
  B('accent', 'Accent', 57, 1301, 748, 62, 64),
  B('doubleLoop', 'Double Loop', 117, 1234, 822, 62, 48, { text: 'Double\nLoop' }),
  B('duplicate', 'Duplicate', 88, 1301, 822, 62, 48),
  B('convert', 'Convert', 35, 1234, 874, 62, 48),
  B('delete', 'Delete', 118, 1301, 874, 62, 48),
  B('octaveUp', 'Octave Up', 55, 1267, 945, 92, 40, { text: 'Octave ︿' }),
  B('pageLeft', 'Page Left', 62, 1220, 980, 40, 60, { text: '‹' , size: 1.4 }),
  B('pageRight', 'Page Right', 63, 1314, 980, 40, 60, { text: '›', size: 1.4 }),
  B('octaveDown', 'Octave Down', 54, 1267, 1015, 92, 40, { text: 'Octave ﹀' }),
  B('shift', 'Shift', 49, 1234, 1075, 62, 36),
  B('select', 'Select', 48, 1301, 1075, 62, 36),
];

// CCs we know a name for but don't draw as their own button.
export const EXTRA_CC_NAMES = {
  52: 'Add Device', 53: 'Add Track', 87: 'New (Push 2 number)', 114: 'Volume button', 115: 'Pan/Send',
  64: 'Footswitch 1', 69: 'Footswitch 2', 93: 'Jog nudge left', 94: 'Jog press', 95: 'Jog nudge right',
};

export const TOUCH_NOTES = { 0: 'e1', 1: 'e2', 2: 'e3', 3: 'e4', 4: 'e5', 5: 'e6', 6: 'e7', 7: 'e8', 8: 'volume', 9: 'tempo', 10: 'tempo', 11: 'jog', 12: 'strip' };

export const BUTTON_BY_CC = new Map(BUTTONS.map((b) => [b.cc, b]));
export const BUTTON_BY_ID = new Map(BUTTONS.map((b) => [b.id, b]));
export const ENCODER_BY_CC = new Map(ENCODERS.map((e) => [e.cc, e]));
export const ENCODER_BY_ID = new Map(ENCODERS.map((e) => [e.id, e]));
