// Diagnostic without the app: switch the Push to User Mode, paint the pads, log input for 20 s.
// Run with the bridge stopped:  node scripts/probe-leds.ts
import { Input, Output } from '@julusian/midi';
import { Cmd } from '../src/shared/push.ts';
import { hex } from '../src/app/engine/protocol.ts';

const index = (names: ReadonlyArray<string>, re: RegExp) => names.findIndex((n) => re.test(n));
const inputs = ['Live', 'User', 'External'].map((name) => {
  const i = new Input();
  i.ignoreTypes(false, true, true);
  i.on('message', (_dt, msg) => console.log(`[in ${name}]`, hex(msg)));
  i.openPort(index(Input.getPortNames(), new RegExp(`Push 3 ${name}`)));
  return i;
});
const live = new Output(), user = new Output();
live.openPort(index(Output.getPortNames(), /Push 3 Live/));
user.openPort(index(Output.getPortNames(), /Push 3 User/));
live.sendMessage(Cmd.identityRequest());
live.sendMessage(Cmd.midiMode('user'));
setTimeout(() => {
  for (let i = 0; i < 64; i++) user.sendMessage([0x90, 36 + i, 1 + ((i * 2) % 126)]);
  console.log('Pads painted. Listening for 20 s: press pads, turn knobs…');
}, 300);
setTimeout(() => {
  for (let i = 0; i < 64; i++) user.sendMessage([0x90, 36 + i, 0]);
  live.sendMessage(Cmd.midiMode('live'));
  for (const p of [...inputs, live, user]) { p.closePort(); p.destroy(); }
}, 20000);
