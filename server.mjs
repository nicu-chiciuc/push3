// Push 3 Twin — local bridge.
// Owns the Push 3's MIDI ports and USB display, serves the web app, and relays
// everything to the browser over a WebSocket. Run with Ableton Live closed.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import midi from '@julusian/midi';
import { usb, findByIds } from 'usb';
import { WebSocketServer } from 'ws';
import { drawText, textWidth, rgb565 } from './lib/font5x7.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 7333;
const HOST = '127.0.0.1';
const VID = 0x2982, PID = 0x1969; // Ableton Push 3 (Push 2 is 0x1967)

const SYSEX = [0xf0, 0x00, 0x21, 0x1d, 0x01, 0x01];
const W = 960, H = 160, LINE = 2048;
const XOR = [0xe7, 0xf3, 0xe7, 0xff];
const FRAME_HEADER = Buffer.from([0xff, 0xcc, 0xaa, 0x88, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ───────────────────────────── MIDI ─────────────────────────────
let io = null; // { inputs: Input[], user: Output, live: Output }
const probe = new midi.Input(); // long-lived, only used to scan port names

function portIndex(dev, re) {
  for (let i = 0; i < dev.getPortCount(); i++) if (re.test(dev.getPortName(i))) return i;
  return -1;
}

function openMidi() {
  if (io) return true;
  if (portIndex(probe, /Push 3 User/i) < 0) return false;

  const inputs = [];
  for (const name of ['Live', 'User', 'External']) {
    const input = new midi.Input();
    const idx = portIndex(input, new RegExp(`Push 3 ${name}`, 'i'));
    if (idx < 0) continue;
    input.ignoreTypes(false, true, true); // keep sysex; drop clock + active sensing
    input.on('message', (_dt, bytes) => broadcast({ t: 'midi', port: name.toLowerCase(), d: bytes }));
    input.openPort(idx);
    inputs.push(input);
  }
  const user = new midi.Output();
  user.openPort(portIndex(user, /Push 3 User/i));
  const live = new midi.Output();
  live.openPort(portIndex(live, /Push 3 Live/i));
  io = { inputs, user, live };

  // User Mode: Push stops acting as Live's controller and sends raw MIDI on the User port.
  live.sendMessage([...SYSEX, 0x0a, 0x01, 0xf7]);
  live.sendMessage([...SYSEX, 0x06, 0x7f, 0xf7]); // LED brightness max (capped on bus power)
  live.sendMessage([...SYSEX, 0x08, 0x7f, 0x01, 0xf7]); // display brightness 255
  log('MIDI: connected, User Mode on');
  return true;
}

function closeMidi() {
  if (!io) return;
  for (const p of [...io.inputs, io.user, io.live]) try { p.closePort(); p.destroy(); } catch {}
  io = null;
  log('MIDI: closed');
}

function sendMidi(bytes, port = 'user') {
  if (!io || !Array.isArray(bytes) || bytes.length === 0 || bytes.length > 64) return;
  if (!bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) return;
  try { (port === 'live' ? io.live : io.user).sendMessage(bytes); } catch (e) { log('MIDI send failed', e.message); }
}

// Every LED the app might have lit, so we can turn them off when we quit.
function darkenEverything() {
  if (!io) return;
  for (let n = 36; n <= 99; n++) sendMidi([0x90, n, 0]);
  for (let cc = 0; cc < 128; cc++) if (![1, 64, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 14, 15].includes(cc)) sendMidi([0xb0, cc, 0]);
  sendMidi([...SYSEX, 0x17, 0x68, 0xf7]); // touch strip back to its default config
}

// ──────────────────────────── DISPLAY ────────────────────────────
let disp = null; // { dev, iface, ep }
let clientFrame = null; // encoded frame from the browser (Buffer H*LINE, already XORed)
let clientFrameAt = 0;
let lastDisplayError = '';

function openDisplay() {
  if (disp) return true;
  const dev = findByIds(VID, PID);
  if (!dev) return false;
  try {
    dev.open();
    const iface = dev.interface(0);
    iface.claim();
    const ep = iface.endpoints.find((e) => e.direction === 'out');
    disp = { dev, iface, ep };
    log('Display: claimed USB interface 0');
    return true;
  } catch (e) {
    if (lastDisplayError !== e.message) log('Display: could not claim (is Ableton Live running?) —', e.message);
    lastDisplayError = e.message;
    try { dev.close(); } catch {}
    return false;
  }
}

function closeDisplay() {
  if (!disp) return;
  const d = disp;
  disp = null;
  try { d.iface.release(true, () => { try { d.dev.close(); } catch {} }); } catch {}
  log('Display: released');
}

/** RGB565 little-endian pixels (W*H Uint16) -> Push wire format (padded lines, XOR mask). */
function encodeFrame(u16) {
  const out = Buffer.alloc(H * LINE);
  const src = Buffer.from(u16.buffer, u16.byteOffset, u16.byteLength);
  for (let y = 0; y < H; y++) src.copy(out, y * LINE, y * W * 2, (y + 1) * W * 2);
  for (let i = 0; i < out.length; i++) out[i] ^= XOR[i & 3];
  return out;
}

function idleFrame(lines) {
  const px = new Uint16Array(W * H).fill(rgb565(10, 12, 16));
  const green = rgb565(80, 230, 160), grey = rgb565(150, 160, 170);
  const title = 'PUSH 3 TWIN';
  drawText(px, title, (W - textWidth(title, 5)) >> 1, 22, 5, green);
  lines.forEach((line, i) => drawText(px, line, (W - textWidth(line, 3)) >> 1, 84 + i * 30, 3, grey));
  return encodeFrame(px);
}
const IDLE_NO_CLIENT = idleFrame([`OPEN LOCALHOST:${PORT}`, 'IN CHROME']);

const usbSend = (buf) => new Promise((res, rej) => disp.ep.transfer(buf, (e) => (e ? rej(e) : res())));

async function displayLoop() {
  for (;;) {
    const started = Date.now();
    if (disp) {
      const frame = clients.size > 0 && clientFrame ? clientFrame : IDLE_NO_CLIENT;
      try {
        await usbSend(FRAME_HEADER);
        for (let o = 0; o < frame.length; o += 16384) await usbSend(frame.subarray(o, o + 16384));
      } catch (e) {
        log('Display: transfer failed —', e.message);
        closeDisplay();
        broadcastStatus();
      }
    }
    // ~60 fps while someone is streaming, ~10 fps keep-alive otherwise (screen blanks after 2 s without frames)
    const target = clients.size && Date.now() - clientFrameAt < 1000 ? 16 : 100;
    await new Promise((r) => setTimeout(r, Math.max(1, target - (Date.now() - started))));
  }
}

// ─────────────────────────── HOT-PLUG ───────────────────────────
function connectAll() {
  const m = openMidi();
  const d = openDisplay();
  broadcastStatus();
  return m && d;
}

usb.on('attach', (dev) => {
  if (dev.deviceDescriptor.idVendor === VID && dev.deviceDescriptor.idProduct === PID) {
    log('USB: Push 3 attached');
    setTimeout(connectAll, 1500); // let CoreMIDI publish the ports first
  }
});
usb.on('detach', (dev) => {
  if (dev.deviceDescriptor.idVendor === VID && dev.deviceDescriptor.idProduct === PID) {
    log('USB: Push 3 detached');
    closeDisplay();
    closeMidi();
    broadcastStatus();
  }
});

// ───────────────────────── HTTP + WS ─────────────────────────
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const STATIC = [
  ['/vendor/three/', path.join(ROOT, 'node_modules/three/')],
  ['/', path.join(ROOT, 'public/')],
];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  for (const [prefix, dir] of STATIC) {
    if (!pathname.startsWith(prefix)) continue;
    const file = path.normalize(path.join(dir, pathname.slice(prefix.length)));
    if (!file.startsWith(dir)) break;
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    });
    return;
  }
  res.writeHead(404).end('not found');
});

const clients = new Set();
const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 1 << 20,
  // Only pages served from this machine may drive the Push.
  verifyClient: ({ origin }) => !origin || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin),
});

function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const c of clients) if (c.readyState === 1) c.send(s);
}
function broadcastStatus() {
  broadcast({ t: 'status', midi: !!io, display: !!disp });
}

wss.on('connection', (ws) => {
  clients.add(ws);
  log(`Browser connected (${clients.size})`);
  ws.send(JSON.stringify({ t: 'status', midi: !!io, display: !!disp }));
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      if (data.length !== W * H * 2) return;
      const u16 = new Uint16Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.length));
      clientFrame = encodeFrame(u16);
      clientFrameAt = Date.now();
      return;
    }
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.t === 'midi') {
      if (Array.isArray(msg.batch)) for (const m of msg.batch.slice(0, 2048)) sendMidi(m, msg.port);
      else sendMidi(msg.d, msg.port);
    } else if (msg.t === 'reconnect') {
      connectAll();
    }
  });
  ws.on('close', () => {
    clients.delete(ws);
    log(`Browser disconnected (${clients.size})`);
    if (clients.size === 0) { clientFrame = null; darkenEverything(); }
  });
});

// ─────────────────────────── LIFECYCLE ───────────────────────────
function shutdown() {
  log('Shutting down: LEDs off, Push back to Live mode');
  darkenEverything();
  if (io) io.live.sendMessage([...SYSEX, 0x0a, 0x00, 0xf7]);
  closeDisplay();
  setTimeout(() => { closeMidi(); process.exit(0); }, 250);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, HOST, () => {
  log(`Push 3 Twin bridge → http://localhost:${PORT}`);
  if (!connectAll()) log('Push 3 not fully available yet — plug it in (and quit Ableton Live). Waiting…');
  displayLoop();
  // Retry periodically in case the device appeared without a USB event.
  setInterval(() => { if (!io || !disp) connectAll(); }, 3000);
});
