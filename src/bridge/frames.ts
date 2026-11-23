// Push display wire format (Ableton Push 2 manual, unchanged on Push 3): a 16-byte
// header, then 160 lines of 960 RGB565 pixels padded to 2048 bytes, XOR-masked.
import { DISPLAY_HEIGHT as H, DISPLAY_WIDTH as W } from '../shared/push.ts';
import { drawText, rgb565, textWidth } from './font5x7.ts';

const LINE_BYTES = 2048;
const XOR_MASK = [0xe7, 0xf3, 0xe7, 0xff] as const;

export const FRAME_HEADER = Buffer.from([0xff, 0xcc, 0xaa, 0x88, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
export const USB_CHUNK = 16384;

/** RGB565 little-endian pixels (W×H) → padded, masked frame ready for the bulk endpoint. */
export function encodeFrame(pixels: Uint8Array): Buffer {
  const out = Buffer.alloc(H * LINE_BYTES);
  for (let y = 0; y < H; y++) out.set(pixels.subarray(y * W * 2, (y + 1) * W * 2), y * LINE_BYTES);
  for (let i = 0; i < out.length; i++) out[i]! ^= XOR_MASK[i & 3]!;
  return out;
}

/** What the Push shows when no browser is connected. */
export function idleFrame(port: number): Buffer {
  const px = new Uint16Array(W * H).fill(rgb565(10, 12, 16));
  const green = rgb565(80, 230, 160), grey = rgb565(150, 160, 170);
  const title = 'PUSH 3 TWIN';
  drawText(px, title, (W - textWidth(title, 5)) >> 1, 22, 5, green);
  [`OPEN LOCALHOST:${port}`, 'IN CHROME'].forEach((line, i) => drawText(px, line, (W - textWidth(line, 3)) >> 1, 84 + i * 30, 3, grey));
  return encodeFrame(new Uint8Array(px.buffer));
}
