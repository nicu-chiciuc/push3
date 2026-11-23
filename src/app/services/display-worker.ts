// Dedicated worker that owns the Push screen over WebUSB (DirectLink only).
// - Sends each new frame once: header as its own transfer, then all 327,680 pixel bytes in one
//   transfer (measured 60 fps on macOS vs 53 fps with 16 KB chunks).
// - Keep-alive: re-sends the last frame every 250 ms when nothing new arrives (hidden tab, idle
//   screen) — the display blanks after 2 s. Worker timers aren't throttled in hidden tabs.
// - Every transfer has a deadline; a stalled or failed transfer closes, reopens and re-claims.
// - If the screen is busy (Ableton Live, the Node bridge or another tab holds it), retries.
import { USB_PRODUCT_ID, USB_VENDOR_ID } from '../../shared/push.ts';
import { DISPLAY_ENDPOINT, DISPLAY_INTERFACE, encodeFrame, FRAME_BYTES, FRAME_HEADER } from '../../shared/display.ts';

export type ToWorker = { type: 'open' } | { type: 'frame'; pixels: ArrayBuffer } | { type: 'close' };
export type FromWorker = { type: 'open' } | { type: 'closed'; reason: string; retrying: boolean };

const KEEP_ALIVE_MS = 250;
const TRANSFER_DEADLINE_MS = 1500;
const RETRY_MS = 3000;

const post = (m: FromWorker) => self.postMessage(m); // DOM-lib typing; same member exists in workers
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isPush = (d: USBDevice) => d.vendorId === USB_VENDOR_ID && d.productId === USB_PRODUCT_ID;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let wanted = false; // the page wants the screen
let device: USBDevice | null = null;
let generation = 0; // bumps on every open/close so stale loops exit
let latest: Uint8Array | null = null;
let fresh = false;
let wake: (() => void) | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

async function open() {
  clearTimeout(retryTimer);
  if (device?.opened || !wanted) return;
  const gen = ++generation;
  try {
    const d = (await navigator.usb.getDevices()).find(isPush);
    if (!d) return post({ type: 'closed', reason: 'not permitted yet — click Connect Push', retrying: false });
    await d.open();
    if (d.configuration === null) await d.selectConfiguration(1); // never on Windows: there it's already set
    await d.claimInterface(DISPLAY_INTERFACE);
    if (gen !== generation) return void d.close().catch(() => {});
    device = d;
    post({ type: 'open' });
    void pump(gen, d);
  } catch (e) {
    void fail(`screen busy or unavailable: ${errText(e)}`);
  }
}

async function release(d: USBDevice | null) {
  try { await d?.releaseInterface(DISPLAY_INTERFACE); } catch {}
  try { await d?.close(); } catch {}
}

/** Drop the device and, if the page still wants the screen, try again shortly. */
async function fail(reason: string) {
  generation++;
  const d = device;
  device = null;
  await release(d);
  post({ type: 'closed', reason, retrying: wanted });
  if (wanted) retryTimer = setTimeout(() => void open(), RETRY_MS);
}

function withDeadline<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, sleep(TRANSFER_DEADLINE_MS).then(() => { throw new Error(`transfer stalled > ${TRANSFER_DEADLINE_MS} ms`); })]);
}

async function pump(gen: number, d: USBDevice) {
  const out = new Uint8Array(FRAME_BYTES);
  while (gen === generation) {
    // Wait for a new frame, or the keep-alive tick.
    if (!fresh) await Promise.race([new Promise<void>((r) => (wake = r)), sleep(KEEP_ALIVE_MS)]);
    wake = null;
    if (gen !== generation || !latest) continue;
    fresh = false;
    try {
      encodeFrame(latest, out);
      await withDeadline(d.transferOut(DISPLAY_ENDPOINT, FRAME_HEADER));
      await withDeadline(d.transferOut(DISPLAY_ENDPOINT, out));
    } catch (e) {
      if (gen === generation) await fail(errText(e)); // unplugged, stalled, or taken by someone else
      return;
    }
  }
}

navigator.usb.addEventListener('connect', (e) => { if (isPush(e.device) && wanted && !device) setTimeout(() => void open(), 500); });
navigator.usb.addEventListener('disconnect', (e) => {
  if (device && e.device === device) {
    generation++;
    device = null;
    post({ type: 'closed', reason: 'unplugged', retrying: false }); // reopens on 'connect'
  }
});

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'frame') {
    latest = new Uint8Array(m.pixels);
    fresh = true;
    wake?.();
  } else if (m.type === 'open') {
    wanted = true;
    void open();
  } else {
    wanted = false;
    clearTimeout(retryTimer);
    generation++;
    const d = device;
    device = null;
    void release(d).then(() => post({ type: 'closed', reason: 'closed by the page', retrying: false }));
  }
};
