// Diagnostic without the app: animate a test pattern on the Push screen for 10 s.
// Run with the bridge stopped:  node scripts/probe-display.ts
import { findByIds, type OutEndpoint } from 'usb';
import { DISPLAY_HEIGHT as H, DISPLAY_WIDTH as W, USB_PRODUCT_ID, USB_VENDOR_ID } from '../src/shared/push.ts';
import { encodeFrame, FRAME_HEADER, USB_CHUNK } from '../src/bridge/frames.ts';

const dev = findByIds(USB_VENDOR_ID, USB_PRODUCT_ID);
if (!dev) throw new Error('Push 3 not found on USB');
dev.open();
const iface = dev.interface(0);
iface.claim();
const ep = iface.endpoints.find((e) => e.direction === 'out') as OutEndpoint;
const send = (buf: Buffer) => new Promise<void>((res, rej) => ep.transfer(buf, (e) => (e ? rej(e) : res())));

const px = new Uint16Array(W * H);
const start = Date.now();
let frames = 0;
while (Date.now() - start < 10_000) {
  const t = frames++;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = (x + t * 4) % W;
    px[y * W + x] = (((255 - (v * 255) / W) >> 3) << 11) | (((y * 255) / H) >> 2 << 5) | (((v * 255) / W) >> 3);
  }
  await send(FRAME_HEADER);
  const frame = encodeFrame(new Uint8Array(px.buffer));
  for (let o = 0; o < frame.length; o += USB_CHUNK) await send(frame.subarray(o, o + USB_CHUNK));
}
console.log(`${frames} frames in 10 s (${(frames / 10).toFixed(1)} fps)`);
iface.release(true, () => dev.close());
