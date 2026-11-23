// Push display wire format (Ableton Push 2 manual, unchanged on Push 3): a 16-byte header,
// then 160 lines of 960 RGB565 pixels padded to 2048 bytes, XOR-masked. Pure — runs in
// Node (bridge) and in the browser (WebUSB) alike.
import { DISPLAY_HEIGHT as H, DISPLAY_WIDTH as W } from './push.ts';

const LINE_BYTES = 2048;
const XOR_MASK = [0xe7, 0xf3, 0xe7, 0xff] as const;

export const FRAME_HEADER = new Uint8Array([0xff, 0xcc, 0xaa, 0x88, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
export const FRAME_BYTES = H * LINE_BYTES; // 327,680
export const USB_CHUNK = 16384;
/** The display's bulk OUT endpoint lives on USB interface 0. */
export const DISPLAY_INTERFACE = 0;
export const DISPLAY_ENDPOINT = 1;

/** RGB565 little-endian pixels (W×H×2 bytes) → padded, masked frame for the bulk endpoint. */
export function encodeFrame(pixels: Uint8Array, out: Uint8Array<ArrayBuffer> = new Uint8Array(FRAME_BYTES)): Uint8Array<ArrayBuffer> {
  out.fill(0);
  for (let y = 0; y < H; y++) out.set(pixels.subarray(y * W * 2, (y + 1) * W * 2), y * LINE_BYTES);
  for (let i = 0; i < out.length; i++) out[i]! ^= XOR_MASK[i & 3]!;
  return out;
}
