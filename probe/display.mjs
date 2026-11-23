// Probe: draw an animated test pattern on the Push 3 display for ~12 s.
// Frame format per Ableton's Push 2 interface manual (same on Push 3, PID 0x1969).
import { findByIds } from 'usb';

const W = 960, H = 160, LINE = 2048;
const HEADER = Buffer.from([0xff, 0xcc, 0xaa, 0x88, ...new Array(12).fill(0)]);
const XOR = [0xe7, 0xf3, 0xe7, 0xff];

const dev = findByIds(0x2982, 0x1969);
if (!dev) throw new Error('Push 3 not found');
dev.open();
const iface = dev.interface(0);
iface.claim();
const ep = iface.endpoints.find((e) => e.direction === 'out');

const rgb565 = (r, g, b) => ((b >> 3) << 11) | ((g >> 2) << 5) | (r >> 3); // red in low bits
const frame = Buffer.alloc(H * LINE);

function render(t) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r, g, b;
      if (y < 40) {
        // 8 color bars, one per knob column
        const bars = [[255,0,0],[255,128,0],[255,255,0],[0,255,0],[0,255,255],[0,0,255],[255,0,255],[255,255,255]];
        [r, g, b] = bars[Math.floor(x / 120)];
      } else {
        // moving gradient
        const v = (x + t * 4) % W;
        r = Math.floor((v / W) * 255);
        g = Math.floor((y / H) * 255);
        b = 255 - r;
        // moving white bar
        if (Math.abs(x - ((t * 8) % W)) < 6) r = g = b = 255;
      }
      const px = rgb565(r, g, b);
      const o = y * LINE + x * 2;
      frame[o] = px & 0xff;
      frame[o + 1] = px >> 8;
    }
  }
  for (let i = 0; i < frame.length; i++) frame[i] ^= XOR[i & 3];
  // re-zero filler so it's XORed consistently next time
}

const send = (buf) => new Promise((res, rej) => ep.transfer(buf, (e) => (e ? rej(e) : res())));

let t = 0, frames = 0;
const start = Date.now();
while (Date.now() - start < 12000) {
  frame.fill(0);
  render(t++);
  await send(HEADER);
  for (let o = 0; o < frame.length; o += 16384) await send(frame.subarray(o, o + 16384));
  frames++;
}
console.log(`sent ${frames} frames in 12s (${(frames / 12).toFixed(1)} fps), no USB errors`);
iface.release(true, () => dev.close());
