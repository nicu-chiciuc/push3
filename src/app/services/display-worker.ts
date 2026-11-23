// Dedicated worker that owns the Push screen over WebUSB (DirectLink only). It keeps sending
// frames while the tab is hidden (rAF stops; the screen would blank after 2 s), and sends
// each frame as one 327 KB transfer — measured 60 fps on macOS vs 53 fps with 16 KB chunks.
import { USB_PRODUCT_ID, USB_VENDOR_ID } from '../../shared/push.ts';
import { DISPLAY_ENDPOINT, DISPLAY_INTERFACE, encodeFrame, FRAME_BYTES, FRAME_HEADER } from '../../shared/display.ts';

export type ToWorker = { type: 'open' } | { type: 'frame'; pixels: ArrayBuffer } | { type: 'close' };
export type FromWorker = { type: 'open' } | { type: 'closed'; reason: string };

const post = (m: FromWorker) => self.postMessage(m); // DOM-lib typing; same member exists in workers
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isPush = (d: USBDevice) => d.vendorId === USB_VENDOR_ID && d.productId === USB_PRODUCT_ID;

let device: USBDevice | null = null;
let latest: Uint8Array | null = null;
let latestAt = 0;
let generation = 0; // bumps on every open/close so a stale pump loop exits

async function open() {
  if (device?.opened) return post({ type: 'open' });
  try {
    device = (await navigator.usb.getDevices()).find(isPush) ?? null;
    if (!device) return post({ type: 'closed', reason: 'not permitted yet' });
    await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);
    await device.claimInterface(DISPLAY_INTERFACE);
    post({ type: 'open' });
    void pump(++generation, device);
  } catch (e) {
    device = null;
    post({ type: 'closed', reason: errText(e) });
  }
}

async function close(reason: string) {
  generation++;
  const d = device;
  device = null;
  try { await d?.releaseInterface(DISPLAY_INTERFACE); } catch {}
  try { await d?.close(); } catch {}
  post({ type: 'closed', reason });
}

async function pump(gen: number, d: USBDevice) {
  const out = new Uint8Array(FRAME_BYTES);
  while (gen === generation) {
    const started = performance.now();
    if (latest) {
      try {
        encodeFrame(latest, out);
        await d.transferOut(DISPLAY_ENDPOINT, FRAME_HEADER);
        await d.transferOut(DISPLAY_ENDPOINT, out);
      } catch (e) {
        if (gen === generation) await close(`transfer failed: ${errText(e)}`); // unplugged, or claimed elsewhere
        return;
      }
    }
    // Fresh frames: as fast as they arrive. Stale (tab hidden): 10 fps keep-alive.
    const wait = (performance.now() - latestAt < 250 ? 8 : 100) - (performance.now() - started);
    await new Promise((r) => setTimeout(r, Math.max(0, wait)));
  }
}

navigator.usb.addEventListener('disconnect', (e) => { if (device && e.device === device) void close('unplugged'); });

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'frame') { latest = new Uint8Array(m.pixels); latestAt = performance.now(); }
  else if (m.type === 'open') void open();
  else void close('closed by the page');
};
