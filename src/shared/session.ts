// What we send when we take the Push over and when we hand it back, shared by the Node
// bridge and the browser-only (Web MIDI) link so both leave the device in the same state.
import { Cmd, STRIP_PUSH_DRAWS, type Bytes } from './push.ts';
import type { MidiPort } from './wire.ts';

export type Addressed = readonly [MidiPort, Bytes];

/** User Mode (raw MIDI on the User port), full LED + display brightness (capped on bus power). */
export const sessionStart = (): ReadonlyArray<Addressed> => [
  ['live', Cmd.midiMode('user')],
  ['live', Cmd.ledBrightness(127)],
  ['live', Cmd.displayBrightness(255)],
];

/** Every LED the app may have lit, off; touch strip back to Push-drawn. */
export function darken(): ReadonlyArray<Addressed> {
  const out: Array<Addressed> = [];
  for (let n = 36; n <= 99; n++) out.push(['user', [0x90, n, 0]]);
  const encoders = new Set([1, 14, 15, 64, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79]);
  for (let cc = 0; cc < 120; cc++) if (!encoders.has(cc)) out.push(['user', [0xb0, cc, 0]]);
  out.push(['user', Cmd.stripConfig(STRIP_PUSH_DRAWS)]);
  return out;
}

/** Dark LEDs, then hand the Push back to Ableton Live. */
export const sessionEnd = (): ReadonlyArray<Addressed> => [...darken(), ['live', Cmd.midiMode('live')]];
