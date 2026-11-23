// Expression: MPE. Each finger reports pressure, left/right roll (per-note pitch bend) and
// up/down slide (CC 74) on its own MIDI channel. The pressure mode is a scoped resource:
// entering the tab switches the Push to it, leaving restores poly aftertouch.
import { createSignal, For, onCleanup, Show } from 'solid-js';
import { Effect, Stream, Fiber, Schedule } from 'effect';
import type { PressureMode } from '@push3/protocol';
import { css, hsv } from '@push3/protocol';
import { text } from '../engine/screen.ts';
import { Synth } from '../engine/synth.ts';
import type { Demo, Engine } from '../engine/engine.ts';

const synth = new Synth();
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const [mode, setModeSignal] = createSignal<PressureMode>('mpe');
const [soundOn, setSoundOn] = createSignal(false);
const [bendRange, setBendRange] = createSignal(2);
const s = { root: 48, trails: [] as Array<{ x: number; y: number; r: number; hue: number; age: number }> };

const pitchOf = (rowFromTop: number, col: number) => s.root + col + (7 - rowFromTop) * 5; // rows in fourths, like Push
const noteName = (p: number) => NAMES[p % 12]! + (Math.floor(p / 12) - 1);
const inScale = (p: number) => [0, 2, 4, 5, 7, 9, 11].includes(p % 12);
const MODES: Record<string, PressureMode> = { lower1: 'channel', lower2: 'poly', lower3: 'mpe' };
const MODE_LABEL: Record<PressureMode, string> = {
  channel: 'Channel pressure (one value for all pads)',
  poly: 'Poly aftertouch (pressure per pad)',
  mpe: 'MPE (pressure + roll + slide per finger)',
};

let current: Engine | null = null;
const setMode = (m: PressureMode) => { setModeSignal(m); current?.setPressureMode(m); };
const toggleSound = async () => {
  if (synth.running) await synth.ctx!.suspend(); else await synth.start();
  setSoundOn(synth.running);
};

export const expression: Demo = {
  id: 'expression',
  name: 'Expression',
  color: [255, 150, 40],

  activate: (app) =>
    Effect.gen(function* () {
      current = app;
      yield* app.usePressureMode(mode()); // restored to poly when we leave
      yield* Effect.addFinalizer(() => Effect.sync(() => { for (const id of [...synth.voices.keys()]) synth.noteOff(id); current = null; }));
    }),

  onEvent(ev, app) {
    if (ev.type === 'pad') {
      const p = app.pads.get(ev.note);
      if (ev.action === 'down') synth.noteOn(ev.note, pitchOf(ev.rowFromTop, ev.col), ev.velocity);
      else if (ev.action === 'up') synth.noteOff(ev.note);
      else if (p) synth.express(ev.note, { bend: p.x, slide: p.y, pressure: p.pressure });
    } else if (ev.type === 'channelPressure') {
      for (const [note, p] of app.pads) if (p.down) synth.express(note, { bend: p.x, slide: p.y, pressure: p.pressure });
    } else if (ev.type === 'encoder' && ev.id === 'e1') {
      synth.bendRange = Math.max(0, Math.min(24, synth.bendRange + ev.delta / 15));
      setBendRange(Math.round(synth.bendRange));
    } else if (ev.type === 'button' && ev.pressed) {
      const m = MODES[ev.id];
      if (m) setMode(m);
      if (ev.id === 'lower5' && synth.ctx) void toggleSound();
      if (ev.id === 'lower7' || ev.id === 'octaveDown') s.root = Math.max(12, s.root - 12);
      if (ev.id === 'lower8' || ev.id === 'octaveUp') s.root = Math.min(84, s.root + 12);
    }
  },

  tick(_t, dt, app) {
    for (let note = 36; note <= 99; note++) {
      const i = note - 36, pitch = pitchOf(7 - Math.floor(i / 8), i % 8), p = app.pads.get(note);
      app.leds.pad(note, p?.down ? hsv(15 + p.y * 45, 1 - Math.abs(p.x) * 0.5, 0.25 + 0.75 * p.pressure) : pitch % 12 === 0 ? [0, 90, 255] : inScale(pitch) ? [36, 36, 36] : null);
    }
    (['channel', 'poly', 'mpe'] as const).forEach((m, i) => app.leds.button(20 + i, mode() === m ? this.color : [70, 35, 0]));
    app.leds.button(23, null);
    app.leds.button(24, soundOn() ? [0, 220, 90] : [0, 40, 15]);
    app.leds.button(25, null);
    app.leds.button(26, [60, 60, 60]);
    app.leds.button(27, [60, 60, 60]);

    for (const tr of s.trails) tr.age += dt;
    s.trails = s.trails.filter((tr) => tr.age < 0.6);
    for (const [note, p] of app.pads) {
      if (p.down) s.trails.push({ x: ((note - 36) % 8) + 0.5 + p.x * 0.5, y: p.y, r: p.pressure, hue: 15 + p.y * 45, age: 0 });
    }
  },

  draw(g, app) {
    for (let c = 1; c < 8; c++) { g.fillStyle = '#14171d'; g.fillRect(c * 120, 0, 1, 116); }
    for (const tr of s.trails) {
      g.fillStyle = css(hsv(tr.hue, 1, 1), 0.25 * (1 - tr.age / 0.6));
      g.beginPath();
      g.arc(tr.x * 120, 8 + (1 - tr.y) * 100, 4 + tr.r * 30, 0, Math.PI * 2);
      g.fill();
    }
    const fingers = [...app.pads].filter(([, p]) => p.down);
    for (const [note, p] of fingers) {
      const i = note - 36, x = ((i % 8) + 0.5 + p.x * 0.5) * 120, y = 8 + (1 - p.y) * 100, r = 6 + p.pressure * 34;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, '#fff');
      grad.addColorStop(0.35, css(hsv(15 + p.y * 45, 1, 1)));
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      text(g, noteName(pitchOf(7 - Math.floor(i / 8), i % 8)), x, Math.max(10, y - r - 8), { size: 12, weight: 700 });
    }
    if (!fingers.length) {
      text(g, 'Hold pads. Press harder, roll your finger left/right, slide it up/down.', 480, 46, { size: 16 });
      text(g, MODE_LABEL[mode()], 480, 74, { size: 13, color: '#ffb35c' });
    } else {
      fingers.slice(0, 4).forEach(([note, p], k) => {
        const i = note - 36, name = noteName(pitchOf(7 - Math.floor(i / 8), i % 8)).padEnd(4);
        text(g, `${name} ↔ ${p.x >= 0 ? '+' : ''}${p.x.toFixed(2)}  ↕ ${p.y.toFixed(2)}  ● ${Math.round(p.pressure * 100)}%`, 8, 10 + k * 15, { size: 11, align: 'left', color: '#ffd9a8', font: '"SF Mono", Menlo, monospace' });
      });
    }
  },

  footer: () => ['Chan AT', 'Poly AT', 'MPE', '', soundOn() ? 'Sound on' : 'Sound off', '', 'Oct −', 'Oct +'],
  footerActive: (i) => (i === 0 && mode() === 'channel') || (i === 1 && mode() === 'poly') || (i === 2 && mode() === 'mpe') || (i === 4 && soundOn()),

  Panel: (props) => {
    // Live finger readout, refreshed by a small Effect schedule while the panel is mounted.
    const [fingers, setFingers] = createSignal<Array<[number, { x: number; y: number; pressure: number; ch: number }]>>([]);
    const poll = Effect.runFork(
      Stream.fromEffectSchedule(Effect.sync(() => [...props.app.pads].filter(([, p]) => p.down).map(([n, p]) => [n, { ...p }] as [number, typeof p])), Schedule.spaced('80 millis')).pipe(
        Stream.runForEach((f) => Effect.sync(() => setFingers(f))),
      ),
    );
    onCleanup(() => Effect.runFork(Fiber.interrupt(poll)));
    return (
      <>
        <h2>Expression (MPE)</h2>
        <p>Push 3 pads sense <b>pressure</b>, a left/right <b>roll</b> and an up/down <b>slide</b> while your finger is down. In MPE mode each finger gets its own MIDI channel, so all three are tracked per finger.</p>
        <div class="row">
          <For each={['channel', 'poly', 'mpe'] as const}>
            {(m) => <button classList={{ active: mode() === m }} onClick={() => setMode(m)}>{{ channel: 'Channel AT', poly: 'Poly AT', mpe: 'MPE' }[m]}</button>}
          </For>
        </div>
        <div class="row">
          <button onClick={toggleSound}>{soundOn() ? '🔊 Sound on' : '🔈 Enable sound'}</button>
          <label class="toggle">Bend range
            <input type="range" min="0" max="24" step="1" style={{ width: '120px' }} value={bendRange()} onInput={(e) => { synth.bendRange = +e.currentTarget.value; setBendRange(synth.bendRange); }} />
            {bendRange()} st
          </label>
        </div>
        <div class="card-box">
          <div class="stat-grid">
            <Show when={fingers().length} fallback={<><span class="muted">No fingers down</span><span /></>}>
              <For each={fingers()}>
                {([note, p]) => (
                  <>
                    <span>Pad {note}{p.ch ? ` · ch ${p.ch + 1}` : ''}</span>
                    <span class="v">↔ {p.x.toFixed(2)} ↕ {p.y.toFixed(2)} ● {Math.round(p.pressure * 100)}%</span>
                  </>
                )}
              </For>
            </Show>
          </div>
        </div>
        <p class="muted">Pads are laid out in fourths like Push's default (blue = C). Lower display buttons switch modes, toggle sound (after you enable it here once) and shift octaves. Knob 1 sets the bend range.</p>
      </>
    );
  },
};
