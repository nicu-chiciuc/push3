// Probe: switch Push 3 to User Mode, paint pads, log every incoming message.
import midi from '@julusian/midi';

const hex = (a) => a.map((b) => b.toString(16).padStart(2, '0')).join(' ');
const find = (io, re) => {
  for (let n = 0; n < io.getPortCount(); n++) if (re.test(io.getPortName(n))) return n;
  return -1;
};

const inputs = ['Live', 'User', 'External'].map((name) => {
  const i = new midi.Input();
  i.ignoreTypes(false, true, true); // keep sysex, ignore timing & active sensing
  i.on('message', (_dt, msg) => console.log(`[in ${name}]`, hex(msg)));
  i.openPort(find(i, new RegExp(`Push 3 ${name}`)));
  return i;
});

const live = new midi.Output();
live.openPort(find(live, /Push 3 Live/));
const user = new midi.Output();
user.openPort(find(user, /Push 3 User/));

// Identity request (universal sysex, documented for Push 2)
live.sendMessage([0xf0, 0x7e, 0x01, 0x06, 0x01, 0xf7]);
// Select User Mode
const SYSEX = [0xf0, 0x00, 0x21, 0x1d, 0x01, 0x01];
live.sendMessage([...SYSEX, 0x0a, 0x01, 0xf7]);

await new Promise((r) => setTimeout(r, 300));

// Rainbow across the 8x8 grid: notes 36..99, velocity = palette index
for (let row = 0; row < 8; row++) {
  for (let col = 0; col < 8; col++) {
    const note = 36 + row * 8 + col;
    const color = 1 + ((row * 8 + col) * 2) % 126;
    user.sendMessage([0x90, note, color]);
  }
}
// Light a few buttons too (CC = button, value = color)
for (const cc of [102, 103, 104, 105, 106, 107, 108, 109, 20, 21, 22, 23, 24, 25, 26, 27]) user.sendMessage([0xb0, cc, 127]);

console.log('sent. listening 25s — press pads, turn knobs, touch the strip...');
setTimeout(() => {
  inputs.forEach((i) => i.closePort());
  live.closePort();
  user.closePort();
  process.exit(0);
}, 25000);
