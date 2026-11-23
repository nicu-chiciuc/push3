// Spike: can a plain web page drive the Push 3 with no Node bridge?
// Web MIDI for pads/LEDs, WebUSB for the screen. Results land in window.spike.
import { Cmd, DISPLAY_HEIGHT as H, DISPLAY_WIDTH as W, USB_PRODUCT_ID, USB_VENDOR_ID } from '../shared/push.ts';
import { DISPLAY_ENDPOINT, DISPLAY_INTERFACE, encodeFrame, FRAME_BYTES, FRAME_HEADER, USB_CHUNK } from '../shared/display.ts';
import type { WorkerReport, WorkerRequest } from './display-worker.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const results: Record<string, unknown> = {};
Object.assign(window, { spike: results });
const show = () => { $('results').textContent = JSON.stringify(results, null, 2); };
const log = (msg: string, cls = '') => {
  const line = document.createElement('div');
  line.className = cls;
  line.textContent = `${new Date().toISOString().slice(11, 23)}  ${msg}`;
  $('log').prepend(line);
  console.log('[spike]', msg);
};
const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

// ───────── test pattern (what we send to the screen) ─────────
const canvas = $<HTMLCanvasElement>('screen');
const g = canvas.getContext('2d', { willReadFrequently: true })!;
const rgb565 = new Uint16Array(W * H);
function render(frame: number, label: string) {
  const t = frame / 60;
  const grad = g.createLinearGradient(0, 0, W, 0);
  for (let k = 0; k <= 6; k++) grad.addColorStop(k / 6, `hsl(${(k * 60 + t * 90) % 360} 90% 55%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillRect(0, 40, W, 80);
  g.fillStyle = '#fff';
  g.fillRect(((frame * 8) % (W + 40)) - 20, 0, 12, H);
  g.font = '800 34px -apple-system, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(`BROWSER ONLY · ${label}`, W / 2, 68);
  g.font = '600 20px Menlo, monospace';
  g.fillText(`frame ${frame}`, W / 2, 100);
  const d = g.getImageData(0, 0, W, H).data;
  for (let i = 0, p = 0; i < rgb565.length; i++, p += 4) rgb565[i] = ((d[p + 2]! >> 3) << 11) | ((d[p + 1]! >> 2) << 5) | (d[p]! >> 3);
  return new Uint8Array(rgb565.buffer);
}

// ───────── 1 · Web MIDI ─────────
let midiOut: { live: MIDIOutput; user: MIDIOutput } | null = null;
let midiCount = 0;
$('midi-connect').onclick = async () => {
  try {
    const t0 = performance.now();
    const access = await navigator.requestMIDIAccess({ sysex: true });
    const inputs = [...access.inputs.values()].map((p) => p.name ?? '?');
    const outputs = [...access.outputs.values()].map((p) => p.name ?? '?');
    results.midi = { granted: true, sysexEnabled: access.sysexEnabled, msToGrant: Math.round(performance.now() - t0), inputs, outputs };
    const find = <P extends MIDIPort>(map: ReadonlyMap<string, P>, re: RegExp) => [...map.values()].find((p) => re.test(p.name ?? ''));
    const live = find(access.outputs, /Push 3 Live/i), user = find(access.outputs, /Push 3 User/i);
    if (!live || !user) { log('Push 3 MIDI ports not found', 'bad'); show(); return; }
    midiOut = { live, user };
    for (const input of access.inputs.values()) {
      if (!/Push 3/i.test(input.name ?? '')) continue;
      input.onmidimessage = (e) => {
        midiCount++;
        const d = [...(e.data ?? [])];
        if (d[0] !== 0xf8 && d[0] !== 0xfe) log(`in ${input.name?.replace('Ableton Push 3 ', '')}: ${d.map((b) => b.toString(16).padStart(2, '0')).join(' ')}`);
      };
    }
    access.onstatechange = (e) => log(`MIDI state: ${(e as MIDIConnectionEvent).port?.name} ${(e as MIDIConnectionEvent).port?.state}`);
    live.send(Cmd.identityRequest());
    live.send(Cmd.midiMode('user'));
    for (let i = 0; i < 64; i++) user.send([0x90, 36 + i, 1 + ((i * 2) % 126)]);
    log(`MIDI ok — ${inputs.length} inputs, ${outputs.length} outputs; User Mode + rainbow pads sent`, 'ok');
  } catch (e) {
    results.midi = { granted: false, error: errText(e) };
    log(`MIDI failed: ${errText(e)}`, 'bad');
  }
  show();
};
setInterval(() => { $('midi-rate').textContent = midiOut ? `${midiCount} msgs received` : ''; }, 500);

$('midi-stress').onclick = async () => {
  if (!midiOut) return log('Connect MIDI first', 'bad');
  const { user } = midiOut;
  let sent = 0, sendMs = 0, frame = 0;
  const end = performance.now() + 5000;
  while (performance.now() < end) {
    const t0 = performance.now();
    for (let i = 0; i < 64; i++) user.send([0x90, 36 + i, 1 + ((i + frame) % 96)]);
    sendMs += performance.now() - t0;
    sent += 64;
    frame++;
    await new Promise((r) => requestAnimationFrame(r));
  }
  results.ledStress = { seconds: 5, frames: frame, messages: sent, msgsPerSec: Math.round(sent / 5), avgSendMsPerFrame: +(sendMs / frame).toFixed(3) };
  log(`LED stress: ${sent} messages in 5 s`, 'ok');
  show();
};

// ───────── 2 · WebUSB, main thread ─────────
let device: USBDevice | null = null;
const describeDevice = (d: USBDevice) => ({
  product: d.productName, manufacturer: d.manufacturerName, usbVersion: `${d.usbVersionMajor}.${d.usbVersionMinor}`,
  interfaces: d.configurations[0]?.interfaces.map((i) => ({
    n: i.interfaceNumber,
    class: i.alternates[0]?.interfaceClass,
    endpoints: i.alternates[0]?.endpoints.map((e) => `${e.direction}${e.endpointNumber}/${e.type}`),
  })),
});

async function claim(d: USBDevice) {
  const steps: Record<string, string> = {};
  try { await d.open(); steps.open = 'ok'; } catch (e) { steps.open = errText(e); throw Object.assign(new Error('open failed'), { steps }); }
  if (d.configuration === null) {
    try { await d.selectConfiguration(1); steps.selectConfiguration = 'ok'; } catch (e) { steps.selectConfiguration = errText(e); }
  } else steps.selectConfiguration = `already ${d.configuration.configurationValue}`;
  try { await d.claimInterface(DISPLAY_INTERFACE); steps.claimInterface = 'ok'; } catch (e) { steps.claimInterface = errText(e); throw Object.assign(new Error('claim failed'), { steps }); }
  return steps;
}

$('usb-connect').onclick = async () => {
  if (!('usb' in navigator)) { results.usb = { supported: false }; show(); return log('WebUSB not available in this browser', 'bad'); }
  try {
    device = await navigator.usb.requestDevice({ filters: [{ vendorId: USB_VENDOR_ID, productId: USB_PRODUCT_ID }] });
    results.usbDevice = describeDevice(device);
    results.usbClaim = await claim(device);
    log('WebUSB: display interface claimed', 'ok');
    // one frame right away, so you can see it worked
    await sendFrame(device, encodeFrame(render(0, 'CONNECTED')), 'single');
  } catch (e) {
    results.usbClaim = (e as { steps?: unknown }).steps ?? errText(e);
    log(`WebUSB failed: ${errText(e)}`, 'bad');
  }
  show();
};

async function sendFrame(d: USBDevice, frame: Uint8Array<ArrayBuffer>, mode: 'single' | 'chunked') {
  await d.transferOut(DISPLAY_ENDPOINT, FRAME_HEADER);
  if (mode === 'single') {
    const r = await d.transferOut(DISPLAY_ENDPOINT, frame);
    if (r.status !== 'ok' || r.bytesWritten !== FRAME_BYTES) throw new Error(`transfer ${r.status}, ${r.bytesWritten} bytes`);
  } else {
    for (let o = 0; o < frame.length; o += USB_CHUNK) await d.transferOut(DISPLAY_ENDPOINT, frame.subarray(o, o + USB_CHUNK));
  }
}

async function bench(mode: 'single' | 'chunked') {
  if (!device?.opened) return log('Connect the screen first', 'bad');
  let frames = 0, renderMs = 0, encodeMs = 0, transferMs = 0, errors = 0, lastError = '';
  const out = new Uint8Array(FRAME_BYTES);
  const start = performance.now(), end = start + 5000;
  while (performance.now() < end) {
    const t0 = performance.now();
    const px = render(frames, mode === 'single' ? '1 TRANSFER' : '16 KB CHUNKS');
    const t1 = performance.now();
    encodeFrame(px, out);
    const t2 = performance.now();
    try { await sendFrame(device, out, mode); } catch (e) { errors++; lastError = errText(e); }
    transferMs += performance.now() - t2;
    renderMs += t1 - t0;
    encodeMs += t2 - t1;
    frames++;
  }
  const secs = (performance.now() - start) / 1000;
  const r = { fps: +(frames / secs).toFixed(1), renderMs: +(renderMs / frames).toFixed(2), encodeMs: +(encodeMs / frames).toFixed(2), transferMs: +(transferMs / frames).toFixed(2), mbPerSec: +((frames * (FRAME_BYTES + 16)) / secs / 1e6).toFixed(1), errors, lastError };
  results[`bench_${mode}`] = r;
  log(`bench ${mode}: ${r.fps} fps, transfer ${r.transferMs} ms/frame, ${r.mbPerSec} MB/s, errors ${errors}`, errors ? 'bad' : 'ok');
  show();
}
$('bench-single').onclick = () => bench('single');
$('bench-chunked').onclick = () => bench('chunked');

async function release() {
  if (!device?.opened) return;
  try { await device.releaseInterface(DISPLAY_INTERFACE); } catch {}
  try { await device.close(); } catch {}
  log('WebUSB: released');
}
$('usb-release').onclick = release;

// ───────── 3 · WebUSB in a worker ─────────
let worker: Worker | null = null;
let rafId = 0, workerFrame = 0;
const timeline: Array<{ at: string; visible: boolean } & WorkerReport> = [];
document.addEventListener('visibilitychange', () => log(`tab ${document.visibilityState}`));

$('worker-start').onclick = async () => {
  await release(); // only one claimant at a time
  worker = new Worker(new URL('./display-worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<WorkerReport>) => {
    const r = e.data;
    if (r.type === 'error') { log(`worker: ${r.message}`, 'bad'); results.worker = { error: r.message }; show(); return; }
    if (r.type === 'ready') { log(`worker: claimed display (${r.message})`, 'ok'); return; }
    timeline.push({ at: new Date().toISOString().slice(11, 19), visible: document.visibilityState === 'visible', ...r });
    $('worker-rate').textContent = `worker: ${r.fps} fps sent · newest frame ${r.frameAgeMs} ms old`;
    results.worker = { last: r, timeline: timeline.slice(-40) };
    show();
  };
  worker.postMessage({ type: 'open' } satisfies WorkerRequest);
  // Main thread renders at display rate; when the tab is hidden rAF stops and the worker keeps the screen alive.
  const loop = () => {
    const px = render(workerFrame++, 'WEB WORKER');
    const copy = px.slice().buffer;
    worker?.postMessage({ type: 'frame', pixels: copy } satisfies WorkerRequest, [copy]);
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
};
$('worker-stop').onclick = () => {
  cancelAnimationFrame(rafId);
  worker?.postMessage({ type: 'close' } satisfies WorkerRequest);
  setTimeout(() => { worker?.terminate(); worker = null; }, 300);
  log('worker stopped');
};

results.env = { userAgent: navigator.userAgent, webMidi: 'requestMIDIAccess' in navigator, webUsb: 'usb' in navigator, secureContext: isSecureContext };
show();
