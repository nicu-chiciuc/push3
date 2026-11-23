// Test: a coverage checklist. Every control you exercise turns green, on the hardware and
// in 3D, so you can verify the whole device (and our MIDI map) works.
import { createMemo, createSignal, For, Show } from 'solid-js';
import { BUTTONS, ENCODERS } from '../engine/layout.ts';
import { hsv } from '../engine/palette.ts';
import { FONT, text } from '../engine/screen.ts';
import type { Demo, Engine } from '../engine/engine.ts';
import type { RGB } from '../engine/types.ts';

const PADS = Array.from({ length: 64 }, (_, i) => 36 + i);
const [sweep, setSweep] = createSignal(false);
const [screenTest, setScreenTest] = createSignal(false);
const s = { sweepBase: 1, sweepAt: 0, allOnUntil: 0 };

const GREEN: RGB = [0, 200, 70], TODO: RGB = hsv(22, 1, 0.22);

function counts(app: Engine) {
  const has = (k: string) => app.seen.has(k);
  return [
    { label: 'Pads', n: PADS.filter((n) => has(`pad${n}`)).length, of: 64 },
    { label: 'Buttons', n: BUTTONS.filter((b) => has(`btn${b.cc}`)).length, of: BUTTONS.length },
    { label: 'Knob turns', n: ENCODERS.filter((e) => has(`enc:${e.id}`)).length, of: ENCODERS.length },
    { label: 'Knob touch', n: ENCODERS.filter((e) => has(`touch:${e.id}`)).length, of: ENCODERS.length },
    { label: 'Touch strip', n: (has('touch:strip') ? 1 : 0) + (has('strip') ? 1 : 0), of: 2 },
    { label: 'Pressure / roll / slide', n: ['expr:pressure', 'expr:bend', 'expr:slide'].filter(has).length, of: 3 },
  ];
}

export const test: Demo = {
  id: 'test',
  name: 'Test',
  color: [61, 220, 132],
  captureUpper: true, // upper-row presses count as tests; Shift + upper switches tabs

  activate: (app) => app.useStripHost(),

  tick(t, _dt, app) {
    const now = performance.now(), allOn = now < s.allOnUntil;
    if (sweep() && now - s.sweepAt > 90) { s.sweepAt = now; s.sweepBase = (s.sweepBase % 127) + 1; }
    for (const note of PADS) {
      if (allOn) app.leds.pad(note, 127);
      else if (sweep()) app.leds.pad(note, ((s.sweepBase + note - 37) % 127) + 1); // raw palette index
      else app.leds.pad(note, app.pads.get(note)?.down ? [255, 255, 255] : app.seen.has(`pad${note}`) ? GREEN : TODO);
    }
    for (const b of BUTTONS) {
      const seen = app.seen.has(`btn${b.cc}`), held = app.held.has(b.id);
      if (/^upper/.test(b.id) && !held && !seen) continue; // keep the tab colors until tested
      const c: RGB = allOn || held ? [255, 255, 255] : seen ? (b.rgb ? GREEN : [255, 255, 255]) : b.rgb ? TODO : [40, 40, 40];
      app.leds.button(b.cc, c);
    }
    for (const e of ENCODERS) {
      const turned = app.seen.has(`enc:${e.id}`), touched = app.seen.has(`touch:${e.id}`);
      app.twin.markEncoder(e.id, turned && touched ? 0x3ddc84 : turned || touched ? 0xffd166 : 0xff8a3d);
    }
    const pulse = 1 + Math.round(Math.sin(t * 3) + 1);
    app.leds.setStrip(Array.from({ length: 31 }, (_, i) => (allOn ? 7 : app.touched.has('strip') && Math.abs(i - app.strip * 30) < 1.5 ? 7 : pulse)));
  },

  draw(g, app) {
    if (screenTest()) return drawTestPattern(g);
    const rows = counts(app);
    rows.forEach((r, i) => {
      const y = 12 + i * 18.5;
      text(g, r.label, 12, y, { align: 'left', size: 12, color: '#9aa4b0' });
      g.fillStyle = '#1a1f27';
      g.fillRect(170, y - 5, 320, 10);
      g.fillStyle = r.n === r.of ? '#3ddc84' : '#ffb347';
      g.fillRect(170, y - 5, (320 * r.n) / r.of, 10);
      text(g, `${r.n} / ${r.of}`, 500, y, { align: 'left', size: 12 });
    });
    const unknown = [...app.unmapped.keys()];
    text(g, 'Unmapped messages', 600, 12, { align: 'left', size: 12, color: '#9aa4b0' });
    text(g, unknown.length ? unknown.map((cc) => `CC ${cc}`).join('  ') : 'none yet (good)', 600, 32, { align: 'left', size: 13, color: unknown.length ? '#ff9f7a' : '#3ddc84' });
    const total = rows.reduce((a, r) => a + r.n, 0), of = rows.reduce((a, r) => a + r.of, 0);
    text(g, `${Math.round((100 * total) / of)}%`, 600, 80, { align: 'left', size: 40, weight: 800, color: total === of ? '#3ddc84' : '#e8edf2' });
    text(g, 'of the device tested', 700, 86, { align: 'left', size: 12, color: '#9aa4b0' });
  },

  footer: () => (sweep() ? `Palette sweep: entries ${s.sweepBase}–${((s.sweepBase + 62) % 127) + 1}` : 'Green = tested · orange = not yet · Shift + upper button switches tabs'),

  Panel: (props) => {
    const stats = createMemo(() => { props.app.seenVersion(); return counts(props.app); });
    const unmapped = createMemo(() => { props.app.seenVersion(); return [...props.app.unmapped]; });
    return (
      <>
        <h2>Test every control</h2>
        <p>Press every pad and button, turn and touch every knob, and slide on the touch strip. Each control turns <b style={{ color: '#3ddc84' }}>green</b> once the page receives its message.</p>
        <div class="row">
          <button classList={{ active: sweep() }} onClick={() => setSweep(!sweep())}>Palette sweep</button>
          <button onClick={() => (s.allOnUntil = performance.now() + 3000)}>All LEDs on (3 s)</button>
          <button classList={{ active: screenTest() }} onClick={() => setScreenTest(!screenTest())}>Screen test pattern</button>
          <button onClick={() => props.app.resetCoverage()}>Reset</button>
        </div>
        <div class="card-box">
          <div class="stat-grid">
            <For each={stats()}>
              {(r) => (
                <>
                  <span>{r.label}</span>
                  <span class="v">{r.n}/{r.of}</span>
                  <div class="bar"><i style={{ width: `${(100 * r.n) / r.of}%`, background: r.n === r.of ? '#3ddc84' : '#ffb347' }} /></div>
                </>
              )}
            </For>
          </div>
        </div>
        <Show when={unmapped().length}>
          <p class="warn-text">Unmapped: <For each={unmapped()}>{([cc, n]) => <code>CC {cc} ×{n} </code>}</For></p>
        </Show>
        <p class="muted">If a button lights up the wrong spot in 3D, or shows under “Unmapped”, its MIDI number differs from our map. Tell Claude which button and the CC from the log, and it can fix <code>src/app/engine/layout.ts</code>.</p>
      </>
    );
  },
};

function drawTestPattern(g: CanvasRenderingContext2D) {
  const bars: ReadonlyArray<RGB> = [[255, 255, 255], [255, 255, 0], [0, 255, 255], [0, 255, 0], [255, 0, 255], [255, 0, 0], [0, 0, 255], [0, 0, 0]];
  bars.forEach((c, i) => { g.fillStyle = `rgb(${c})`; g.fillRect(i * 120, 0, 120, 60); });
  const grad = g.createLinearGradient(0, 0, 960, 0);
  grad.addColorStop(0, '#000');
  grad.addColorStop(1, '#fff');
  g.fillStyle = grad;
  g.fillRect(0, 60, 960, 24);
  for (let i = 0; i < 32; i++) { g.fillStyle = i % 2 ? '#fff' : '#000'; g.fillRect(i * 30, 84, 30, 32); }
  g.font = `800 22px ${FONT}`;
  g.fillStyle = '#ff2d55';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('960 × 160 · RGB565', 480, 100);
}
