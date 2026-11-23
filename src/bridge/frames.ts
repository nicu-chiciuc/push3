// Node side of the display format: wraps the shared encoder in Buffers for node-usb.
import { DISPLAY_HEIGHT as H, DISPLAY_WIDTH as W } from '../shared/push.ts';
import { encodeFrame as encode, FRAME_HEADER as HEADER } from '../shared/display.ts';
import { drawText, rgb565, textWidth } from './font5x7.ts';

export { USB_CHUNK } from '../shared/display.ts';
export const FRAME_HEADER = Buffer.from(HEADER);

export function encodeFrame(pixels: Uint8Array): Buffer {
  const out = encode(pixels);
  return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
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
