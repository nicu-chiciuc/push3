// The engine: owns all Push state and runs the 60 fps loop (plain TS, no framework in
// the hot path). UI-visible state is exposed as Solid signals; each demo's lifetime is
// an Effect fiber, so whatever a demo changes on the device is undone by its finalizers.
import { createSignal, type Accessor, type Component } from 'solid-js';
import { Effect, Fiber, type Scope } from 'effect';
import { Cmd, STRIP_HOST_DRAWS, STRIP_PUSH_DRAWS, type Bytes, type PressureMode } from '../../shared/push.ts';
import type { MidiPort } from '../../shared/wire.ts';
import type { LinkKind, LinkStatus } from '../services/PushLink.ts';
import { ENCODERS } from './layout.ts';
import { Leds } from './leds.ts';
import { paletteMessages, scale } from './palette.ts';
import { MidiParser, describe, hex } from './protocol.ts';
import { Screen } from './screen.ts';
import { Twin } from './twin.ts';
import type { PadState, PushEvent, RGB } from './types.ts';

export interface Demo {
  readonly id: string;
  readonly name: string;
  readonly color: RGB;
  /** Upper-row presses go to the demo instead of switching tabs (Shift + upper still switches). */
  readonly captureUpper?: boolean;
  /** Runs for as long as the demo is active, inside its own Scope. Finalizers undo device changes. */
  activate?(app: Engine): Effect.Effect<void, never, Scope.Scope>;
  onEvent?(ev: PushEvent, app: Engine): void;
  tick?(t: number, dt: number, app: Engine): void;
  /** Draw into the 960×116 content area of the Push screen. */
  draw?(g: CanvasRenderingContext2D, app: Engine, t: number): void;
  /** Eight lower-button labels, or a status line. */
  footer?(app: Engine): string | ReadonlyArray<string>;
  footerActive?(i: number, app: Engine): boolean;
  readonly Panel?: Component<{ app: Engine }>;
}

/** What the engine needs from a PushLink (bridge or direct). */
export interface Link {
  readonly kind: LinkKind;
  sendMidi(batch: ReadonlyArray<Bytes>, port?: MidiPort): void;
  sendFrame(pixels: Uint16Array<ArrayBuffer>): void;
  connect(): void;
}

export type Status = LinkStatus;
export interface LogEntry { readonly text: string; readonly source: 'hw' | 'virtual'; readonly raw: string; readonly kind: string }

export const store = {
  get<T>(key: string, fallback: T): T {
    try { const v = localStorage.getItem(`push3twin:${key}`); return v == null ? fallback : (JSON.parse(v) as T); } catch { return fallback; }
  },
  set(key: string, value: unknown) {
    try { localStorage.setItem(`push3twin:${key}`, JSON.stringify(value)); } catch { /* private mode etc. */ }
  },
};

const CONTINUOUS = new Set(['pressure', 'bend', 'slide']);

export class Engine {
  readonly leds = new Leds();
  readonly screen = new Screen();
  readonly pads = new Map<number, PadState>();
  readonly held = new Set<string>();
  readonly touched = new Set<string>();
  readonly seen = new Map<string, number>();
  readonly unmapped = new Map<number, number>();
  readonly store = store;
  strip = 0.5;
  time = 0;
  stripHost = false;
  pressureMode: PressureMode = 'poly';
  twin!: Twin;

  // ── reactive state for the UI ──
  readonly status: Accessor<Status>;
  readonly linkKind: Accessor<LinkKind | null>;
  readonly demoIndex: Accessor<number>;
  readonly log: Accessor<ReadonlyArray<LogEntry>>;
  readonly sent: Accessor<number>;
  readonly seenVersion: Accessor<number>;
  readonly logPaused: Accessor<boolean>;
  readonly logContinuous: Accessor<boolean>;
  private readonly set: {
    status: (s: Status) => void; linkKind: (k: LinkKind) => void; demoIndex: (i: number) => void; log: (fn: (l: ReadonlyArray<LogEntry>) => ReadonlyArray<LogEntry>) => void;
    sent: (n: number) => void; seenVersion: (n: number) => void; logPaused: (b: boolean) => void; logContinuous: (b: boolean) => void;
  };

  private link: Link | null = null;
  private readonly parser = new MidiParser();
  private demoFiber: Fiber.Fiber<never, never> | null = null;
  private logBuf: Array<LogEntry> = [];
  private sentCount = 0;
  private seenDirty = false;
  private last = performance.now();

  readonly demos: ReadonlyArray<Demo>;

  constructor(demos: ReadonlyArray<Demo>) {
    this.demos = demos;
    const [status, setStatus] = createSignal<Status>({ link: false, midi: false, display: false });
    const [linkKind, setLinkKind] = createSignal<LinkKind | null>(null);
    const [demoIndex, setDemoIndex] = createSignal(Math.min(demos.length - 1, Math.max(0, store.get('demo', 0))));
    const [log, setLog] = createSignal<ReadonlyArray<LogEntry>>([]);
    const [sent, setSent] = createSignal(0);
    const [seenVersion, setSeenVersion] = createSignal(0);
    const [logPaused, setLogPaused] = createSignal(false);
    const [logContinuous, setLogContinuous] = createSignal(false);
    this.status = status;
    this.linkKind = linkKind;
    this.demoIndex = demoIndex;
    this.log = log;
    this.sent = sent;
    this.seenVersion = seenVersion;
    this.logPaused = logPaused;
    this.logContinuous = logContinuous;
    this.set = { status: setStatus, linkKind: setLinkKind, demoIndex: setDemoIndex, log: setLog, sent: setSent, seenVersion: setSeenVersion, logPaused: setLogPaused, logContinuous: setLogContinuous };
  }

  get demo(): Demo { return this.demos[this.demoIndex()]!; }

  /** Create the 3D twin in `stage` and start the frame loop. */
  mount(stage: HTMLElement) {
    this.twin = new Twin(stage, this.screen.canvas);
    this.leds.onChange((key, s) => this.twin.setLed(key, s));
    this.twin.on((ev) => this.handle(ev, 'virtual'));
    this.activate(this.demo);
    requestAnimationFrame(this.frame);
  }

  attach(link: Link) { this.link = link; this.set.linkKind(link.kind); }

  // ── input ──
  onStatus(s: Status) {
    const before = this.status();
    this.set.status(s);
    if (s.midi && (!before.midi || !before.link)) this.initDevice();
  }

  onMidi(_port: MidiPort, data: ReadonlyArray<number>) {
    this.handle(this.parser.parse(data), 'hw', data);
  }

  handle(ev: PushEvent, source: 'hw' | 'virtual', raw?: ReadonlyArray<number>) {
    if (!this.twin) return; // not mounted yet
    switch (ev.type) {
      case 'pad': {
        const p = this.pads.get(ev.note) ?? { down: false, velocity: 0, pressure: 0, x: 0, y: 0.5, ch: 0 };
        if (ev.action === 'down') Object.assign(p, { down: true, velocity: ev.velocity, pressure: ev.velocity / 127, x: 0, y: 0.5, ch: ev.ch });
        else if (ev.action === 'up') Object.assign(p, { down: false, pressure: 0 });
        else if (ev.action === 'pressure') p.pressure = ev.pressure;
        else if (ev.action === 'bend') p.x = ev.x;
        else p.y = ev.y;
        this.pads.set(ev.note, p);
        break;
      }
      case 'channelPressure': for (const p of this.pads.values()) if (p.down) p.pressure = ev.pressure; break;
      case 'button': ev.pressed ? this.held.add(ev.id) : this.held.delete(ev.id); break;
      case 'touch': ev.touched ? this.touched.add(ev.id) : this.touched.delete(ev.id); break;
      case 'strip': this.strip = ev.value; break;
    }
    this.track(ev);
    this.twin.applyEvent(ev);
    this.logEvent(ev, source, raw);

    // Upper display buttons pick the tab (a demo may capture them unless Shift is held).
    if (ev.type === 'button' && /^upper\d$/.test(ev.id) && ev.pressed && !(this.demo.captureUpper && !this.held.has('shift'))) {
      this.switchDemo(+ev.id.slice(5) - 1);
    } else {
      this.demo.onEvent?.(ev, this);
    }
    this.flushLeds();
  }

  // ── output ──
  send(msgs: ReadonlyArray<Bytes>) {
    if (!msgs.length) return;
    this.link?.sendMidi(msgs);
    this.sentCount += msgs.length;
  }

  private flushLeds() { this.send(this.leds.flush(this.stripHost)); }

  private initDevice() {
    this.send([...paletteMessages(), Cmd.pressureMode(this.pressureMode), Cmd.stripConfig(this.stripHost ? STRIP_HOST_DRAWS : STRIP_PUSH_DRAWS)]);
    if (this.pressureMode === 'mpe') this.send([Cmd.mpeParam(0x08, 0x02)]);
    this.leds.invalidate();
    this.flushLeds();
  }

  /** Re-send palette, modes and every LED (bridge: also reconnect the device). */
  resync() { if (this.link?.kind === 'bridge') this.link.connect(); this.initDevice(); }

  /** Direct mode: must be called from a click (the USB chooser needs the user gesture). */
  connectDevice() { this.link?.connect(); }

  setPressureMode(mode: PressureMode) {
    this.pressureMode = mode;
    this.send([Cmd.pressureMode(mode)]);
    if (mode === 'mpe') this.send([Cmd.mpeParam(0x08, 0x02)]); // per-pad pitch bend on
  }

  private setStripHost(on: boolean) {
    this.stripHost = on;
    this.send([Cmd.stripConfig(on ? STRIP_HOST_DRAWS : STRIP_PUSH_DRAWS)]);
    this.twin.setStripHost(on);
    if (on) this.leds.stripDirty = true;
  }

  // ── scoped device modes for demos (acquire on activate, release automatically) ──
  readonly usePressureMode = (mode: PressureMode) =>
    Effect.acquireRelease(Effect.sync(() => this.setPressureMode(mode)), () => Effect.sync(() => this.setPressureMode('poly')));

  readonly useStripHost = () =>
    Effect.acquireRelease(Effect.sync(() => this.setStripHost(true)), () => Effect.sync(() => this.setStripHost(false)));

  // ── demos ──
  switchDemo(i: number) {
    const next = this.demos[i];
    if (!next || next === this.demo) return;
    this.set.demoIndex(i);
    store.set('demo', i);
    this.activate(next);
  }

  private activate(demo: Demo) {
    const prev = this.demoFiber;
    this.leds.clear();
    for (const e of ENCODERS) this.twin.markEncoder(e.id, null);
    const run = demo.activate?.(this) ?? Effect.void;
    // A demo is a fiber: interrupting it closes its scope and runs its finalizers.
    this.demoFiber = Effect.runFork(
      Effect.gen(function* () {
        if (prev) yield* Fiber.interrupt(prev);
        return yield* Effect.scoped(Effect.andThen(run, Effect.never));
      }),
    );
  }

  // ── bookkeeping ──
  private track(ev: PushEvent) {
    const seen = (k: string) => { this.seen.set(k, (this.seen.get(k) ?? 0) + 1); this.seenDirty = true; };
    if (ev.type === 'pad') { if (ev.action !== 'up') seen(ev.action === 'down' ? `pad${ev.note}` : `expr:${ev.action}`); }
    else if (ev.type === 'button' && ev.pressed) {
      seen(`btn${ev.cc}`);
      if (ev.unmapped) this.unmapped.set(ev.cc, (this.unmapped.get(ev.cc) ?? 0) + 1);
    } else if (ev.type === 'encoder') seen(`enc:${ev.id}`);
    else if (ev.type === 'touch' && ev.touched) seen(`touch:${ev.id}`);
    else if (ev.type === 'strip') seen('strip');
  }

  resetCoverage() { this.seen.clear(); this.unmapped.clear(); this.seenDirty = true; }

  private logEvent(ev: PushEvent, source: 'hw' | 'virtual', raw?: ReadonlyArray<number>) {
    if (this.logPaused()) return;
    const continuous = (ev.type === 'pad' && CONTINUOUS.has(ev.action)) || ev.type === 'channelPressure' || ev.type === 'strip';
    if (continuous && !this.logContinuous()) return;
    this.logBuf.push({ text: describe(ev), source, raw: raw ? hex(raw) : '', kind: ev.type === 'button' && ev.unmapped ? 'warn' : ev.type });
  }

  readonly setLogPaused = (b: boolean) => this.set.logPaused(b);
  readonly setLogContinuous = (b: boolean) => this.set.logContinuous(b);
  readonly clearLog = () => this.set.log(() => []);

  // ── the 60 fps loop ──
  private readonly frame = (now: number) => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.time = now / 1000;
    // tab LEDs first, so a demo may override them
    this.demos.forEach((d, i) => this.leds.button(102 + i, d === this.demo ? d.color : scale(d.color, 0.22)));
    this.demo.tick?.(this.time, dt, this);
    this.flushLeds();
    this.screen.draw(this, this.time);
    if (this.status().display && this.screen.shouldSend(now)) this.link?.sendFrame(this.screen.toRGB565());
    this.twin.render(this.screen.version);

    if (this.logBuf.length) {
      const fresh = this.logBuf.reverse();
      this.logBuf = [];
      this.set.log((l) => [...fresh, ...l].slice(0, 200));
    }
    this.set.sent(this.sentCount);
    if (this.seenDirty) { this.seenDirty = false; this.set.seenVersion(this.seenVersion() + 1); }
    requestAnimationFrame(this.frame);
  };
}
