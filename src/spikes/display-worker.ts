// Spike: pump frames to the Push screen from a dedicated worker, so the display stays
// alive when the tab is hidden (rAF stops; worker timers are throttled far less).
import { USB_PRODUCT_ID, USB_VENDOR_ID } from '../shared/push.ts';
import { DISPLAY_ENDPOINT, DISPLAY_INTERFACE, encodeFrame, FRAME_BYTES, FRAME_HEADER } from '../shared/display.ts';

export type WorkerRequest = { type: 'open' } | { type: 'frame'; pixels: ArrayBuffer } | { type: 'close' };
export type WorkerReport =
  | { type: 'ready'; message: string }
  | { type: 'error'; message: string }
  | { type: 'stats'; fps: number; frameAgeMs: number; errors: number };

// Typed with the DOM lib (mixing in the WebWorker lib conflicts); these members exist on both.
const post = (r: WorkerReport) => self.postMessage(r);
const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

let device: USBDevice | null = null;
let latest: Uint8Array<ArrayBuffer> | null = null;
let latestAt = 0;
let running = false;
let sent = 0, errors = 0;

async function open() {
  if (!('usb' in navigator)) return post({ type: 'error', message: 'navigator.usb is not available in workers here' });
  try {
    const devices = await navigator.usb.getDevices();
    device = devices.find((d) => d.vendorId === USB_VENDOR_ID && d.productId === USB_PRODUCT_ID) ?? null;
    if (!device) return post({ type: 'error', message: 'no permitted Push 3: connect it on the main page first (section 2)' });
    await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);
    await device.claimInterface(DISPLAY_INTERFACE);
    post({ type: 'ready', message: `${device.productName}, ${devices.length} permitted device(s)` });
    running = true;
    void pump();
    setInterval(() => {
      post({ type: 'stats', fps: sent, frameAgeMs: latest ? Math.round(performance.now() - latestAt) : -1, errors });
      sent = 0;
    }, 1000);
  } catch (e) {
    post({ type: 'error', message: `open/claim in worker failed: ${errText(e)}` });
  }
}

async function pump() {
  const out = new Uint8Array(FRAME_BYTES);
  while (running && device) {
    const started = performance.now();
    if (latest) {
      try {
        encodeFrame(latest, out);
        await device.transferOut(DISPLAY_ENDPOINT, FRAME_HEADER);
        await device.transferOut(DISPLAY_ENDPOINT, out);
        sent++;
      } catch { errors++; }
    }
    // Fresh frames: go as fast as they come (~60 fps). Stale (tab hidden): keep-alive at ~10 fps.
    const fresh = performance.now() - latestAt < 250;
    const wait = Math.max(0, (fresh ? 16 : 100) - (performance.now() - started));
    await new Promise((r) => setTimeout(r, wait));
  }
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const m = e.data;
  if (m.type === 'open') await open();
  else if (m.type === 'frame') { latest = new Uint8Array(m.pixels); latestAt = performance.now(); }
  else if (m.type === 'close') {
    running = false;
    try { await device?.releaseInterface(DISPLAY_INTERFACE); await device?.close(); } catch {}
  }
};
