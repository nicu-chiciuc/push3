import { Bridge } from './bridge.js';
import { Parser, CMD, PRESSURE, describe, hex } from './protocol.js';
import { Leds } from './leds.js';
import { paletteMessages, scale, css } from './palette.js';
import { Screen } from './screen.js';
import { Twin } from './twin.js';
import { BUTTONS, ENCODERS } from './layout.js';
import explore from './demos/explore.js';
import test from './demos/test.js';
import paint from './demos/paint.js';
import expression from './demos/expression.js';
import ripple from './demos/ripple.js';
import cssKnobs from './demos/css-knobs.js';
import studio from './demos/studio.js';
import snake from './demos/snake.js';

const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem(`push3twin:${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`push3twin:${k}`, JSON.stringify(v)); } catch {} },
};

const app = {
  demos: [explore, test, paint, expression, ripple, cssKnobs, studio, snake],
  demo: null,
  bridge: new Bridge(),
  parser: new Parser(),
  leds: new Leds(),
  screen: new Screen(),
  pads: new Map(), // note → { down, velocity, pressure, x, y, ch }
  held: new Set(), // ids of buttons currently held
  touched: new Set(), // ids of touched knobs / 'strip'
  strip: 0.5,
  stripHost: false,
  pressureMode: 'poly',
  seen: new Map(), // coverage for the Test tab
  unmapped: new Map(),
  time: 0,
  store,

  send(msgs) { this.bridge.sendMidi(msgs); },
  setPressureMode(mode) {
    this.pressureMode = mode;
    this.send([CMD.pressureMode(PRESSURE[mode])]);
    if (mode === 'mpe') this.send([CMD.mpeParam(0x08, 0x02)]); // per-pad pitch bend on
  },
  setStripHost(on) {
    this.stripHost = on;
    this.send([CMD.stripConfig(on ? 0x03 : 0x68)]);
    this.twin.setStripHost(on);
    if (on) this.leds.stripDirty = true;
  },
  switchDemo(i) {
    const next = this.demos[i];
    if (!next || next === this.demo) return;
    this.demo?.exit?.(this);
    this.leds.clear();
    if (this.stripHost) this.setStripHost(false);
    if (this.pressureMode !== 'poly') this.setPressureMode('poly');
    for (const e of ENCODERS) this.twin.markEncoder(e.id, null);
    this.demo = next;
    store.set('demo', i);
    const panel = $('#demo-panel');
    panel.innerHTML = '';
    panel.style.setProperty('--accent', css(next.color));
    next.panel?.(panel, this);
    next.enter?.(this);
    renderTabs();
  },
};
window.app = app; // handy for poking at things from DevTools

// ───────────── 3D twin ─────────────
app.twin = new Twin($('#stage'), app.screen.canvas);
app.leds.onChange((key, s) => app.twin.setLed(key, s));
app.twin.on((ev) => handle(ev, 'virtual'));

// ───────────── events ─────────────
function track(ev) {
  const seen = (k) => app.seen.set(k, (app.seen.get(k) ?? 0) + 1);
  if (ev.type === 'pad' && ev.action === 'down') seen(`pad${ev.note}`);
  if (ev.type === 'button' && ev.pressed) {
    seen(`btn${ev.cc}`);
    if (ev.unmapped) app.unmapped.set(ev.cc, (app.unmapped.get(ev.cc) ?? 0) + 1);
  }
  if (ev.type === 'encoder') seen(`enc:${ev.id}`);
  if (ev.type === 'touch' && ev.touched) seen(`touch:${ev.id}`);
  if (ev.type === 'strip') seen('strip');
  if (ev.type === 'pad' && ev.action !== 'down' && ev.action !== 'up') seen(`expr:${ev.action}`);
}

function handle(ev, source, raw) {
  if (ev.type === 'pad') {
    const p = app.pads.get(ev.note) ?? { down: false, velocity: 0, pressure: 0, x: 0, y: 0.5 };
    if (ev.action === 'down') Object.assign(p, { down: true, velocity: ev.velocity, pressure: ev.velocity / 127, x: 0, y: 0.5, ch: ev.ch, since: app.time });
    else if (ev.action === 'up') Object.assign(p, { down: false, pressure: 0 });
    else if (ev.action === 'pressure') p.pressure = ev.pressure;
    else if (ev.action === 'bend') p.x = ev.x;
    else if (ev.action === 'slide') p.y = ev.y;
    app.pads.set(ev.note, p);
  } else if (ev.type === 'channelPressure') {
    for (const p of app.pads.values()) if (p.down) p.pressure = ev.pressure;
  } else if (ev.type === 'button') {
    ev.pressed ? app.held.add(ev.id) : app.held.delete(ev.id);
  } else if (ev.type === 'touch') {
    ev.touched ? app.touched.add(ev.id) : app.touched.delete(ev.id);
  } else if (ev.type === 'strip') {
    app.strip = ev.value;
  }
  track(ev);
  app.twin.applyEvent(ev);
  logEvent(ev, source, raw);

  // The upper display buttons pick the tab (Test captures them unless Shift is held).
  const upper = ev.type === 'button' && /^upper\d$/.test(ev.id);
  if (upper && ev.pressed && !(app.demo.captureUpper && !app.held.has('shift'))) {
    app.switchDemo(+ev.id.slice(5) - 1);
  } else {
    app.demo.onEvent?.(ev, app);
  }
  flushLeds();
}

app.bridge.addEventListener('midi', (e) => {
  const { d, port } = e.detail;
  for (const ev of app.parser.parse(d, port)) handle(ev, port, d);
});

function initDevice() {
  app.send([
    ...paletteMessages(),
    CMD.pressureMode(PRESSURE[app.pressureMode]),
    CMD.stripConfig(app.stripHost ? 0x03 : 0x68),
  ]);
  if (app.pressureMode === 'mpe') app.send([CMD.mpeParam(0x08, 0x02)]);
  app.leds.invalidate();
  flushLeds();
}

app.bridge.addEventListener('status', (e) => {
  const { now, before } = e.detail;
  if (now.midi && (!before.midi || !before.bridge)) initDevice();
  renderStatus();
});

function flushLeds() {
  const msgs = app.leds.flush(app.stripHost);
  if (msgs.length) app.send(msgs);
}

// ───────────── frame loop ─────────────
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  app.time = now / 1000;
  // tab LEDs first, so a demo may override them
  app.demos.forEach((d, i) => app.leds.button(102 + i, d === app.demo ? d.color : scale(d.color, 0.22)));
  app.demo.tick?.(app.time, dt, app);
  flushLeds();
  app.screen.draw(app, app.time);
  app.screen.maybeSend(app.bridge, now);
  app.twin.render(app.screen.version);
  flushLog();
  requestAnimationFrame(frame);
}

// ───────────── UI chrome ─────────────
function renderTabs() {
  const nav = $('#tabs');
  nav.innerHTML = '';
  app.demos.forEach((d, i) => {
    const b = document.createElement('button');
    b.className = 'tab' + (d === app.demo ? ' active' : '');
    b.style.setProperty('--c', css(d.color));
    b.innerHTML = `<span class="num">${i + 1}</span>${d.name}`;
    b.title = `${d.name} — or press upper display button ${i + 1} on the Push (keyboard: ${i + 1})`;
    b.onclick = () => app.switchDemo(i);
    nav.append(b);
  });
}

function renderStatus() {
  const s = app.bridge.status;
  const pill = (id, ok, label) => {
    const el = $(id);
    el.classList.toggle('ok', ok);
    el.querySelector('b').textContent = label;
  };
  pill('#st-bridge', s.bridge, s.bridge ? 'connected' : 'offline');
  pill('#st-midi', s.midi, s.midi ? 'User Mode' : 'not found');
  pill('#st-display', s.display, s.display ? 'streaming' : 'not claimed');
  const hint = $('#hint');
  if (!s.bridge) hint.textContent = 'Bridge offline — run `npm start` in the push3-twin folder.';
  else if (!s.midi) hint.textContent = 'Push 3 not found — plug it in and make sure Ableton Live is closed.';
  else if (!s.display) hint.textContent = 'Push screen busy — quit Ableton Live (its background “Push3” process holds the display).';
  else hint.textContent = '';
  hint.hidden = !hint.textContent;
}

// event log
const logBuf = [];
let logPaused = false, hideContinuous = true;
const CONTINUOUS = new Set(['pressure', 'bend', 'slide']);
function logEvent(ev, source, raw) {
  if (logPaused) return;
  if (hideContinuous && ((ev.type === 'pad' && CONTINUOUS.has(ev.action)) || ev.type === 'channelPressure' || ev.type === 'strip')) return;
  logBuf.push({ text: describe(ev), source, raw: raw ? hex(raw) : '', cls: ev.type === 'button' && ev.unmapped ? 'warn' : ev.type });
}
function flushLog() {
  if (!logBuf.length) return;
  const list = $('#log-list');
  const frag = document.createDocumentFragment();
  for (const e of logBuf.splice(0)) {
    const li = document.createElement('li');
    li.className = e.cls;
    li.innerHTML = `<span class="src ${e.source}">${e.source === 'virtual' ? '3D' : 'HW'}</span><span class="txt"></span><code></code>`;
    li.querySelector('.txt').textContent = e.text;
    li.querySelector('code').textContent = e.raw;
    frag.prepend(li);
  }
  list.prepend(frag);
  while (list.children.length > 200) list.lastChild.remove();
  $('#log-count').textContent = `${app.bridge.sent.toLocaleString()} msgs sent`;
}

$('#log-pause').onclick = (e) => { logPaused = !logPaused; e.target.textContent = logPaused ? 'Resume' : 'Pause'; };
$('#log-clear').onclick = () => { $('#log-list').innerHTML = ''; };
$('#log-cont').onchange = (e) => { hideContinuous = !e.target.checked; };
document.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => {
  document.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('active', x === b));
  app.twin.setView(b.dataset.view);
}));
$('#bloom').onchange = (e) => app.twin.setBloom(e.target.checked);
$('#resync').onclick = () => { app.bridge.reconnectDevice(); initDevice(); };
addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select, [contenteditable]')) return;
  const n = +e.key;
  if (n >= 1 && n <= 8) app.switchDemo(n - 1);
});

renderStatus();
app.switchDemo(Math.min(app.demos.length - 1, Math.max(0, store.get('demo', 0))));
requestAnimationFrame(frame);
