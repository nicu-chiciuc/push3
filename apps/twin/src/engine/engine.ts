// The engine: owns all Push state and runs the 60 fps loop (plain TS, no framework in
// the hot path). UI-visible state is exposed as Solid signals; each demo's lifetime is
// an Effect fiber, so whatever a demo changes on the device is undone by its finalizers.
import { createSignal, type Accessor, type Component } from 'solid-js';
import { Effect, Fiber, type Scope } from 'effect';
import { describe, ENCODERS, hex, PushController, scale, type Bytes, type MidiPort, type PressureMode, type PushEvent, type RGB } from '@push3/protocol';
import type { LinkKind, LinkStatus } from '@push3/web';
import { Screen } from './screen.ts';
import { Twin, type View } from './twin.ts';

export interface Demo {
  readonly id: string;
  readonly name: string;
  readonly color: RGB;
  /** Upper-row presses go to the demo instead of switching tabs (Shift + upper still switches). */
  readonly captureUpper?: boolean;
  /** Draw directly into the full 960×160 Push display without permanent top/bottom chrome. */
  readonly fullBleed?: boolean;
  /** Runs for as long as the demo is active, inside its own Scope. Finalizers undo device changes. */
  activate?(app: Engine): Effect.Effect<void, never, Scope.Scope>;
  onEvent?(ev: PushEvent, app: Engine): void;
  tick?(t: number, dt: number, app: Engine): void;
  /** Draw into the 960×116 content area (or full 960×160 when fullBleed is true). */
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
  /** Device state, LEDs and modes (shared with any @push3 app). Sends through the attached link. */
  readonly push = new PushController({ sendMidi: (batch, port) => this.link?.sendMidi(batch, port) });
  readonly leds = this.push.leds;
  readonly pads = this.push.pads;
  readonly held = this.push.held;
  readonly touched = this.push.touched;
  readonly screen = new Screen();
  readonly seen = new Map<string, number>();
  readonly unmapped = new Map<number, number>();
  readonly store = store;
  time = 0;
  twin!: Twin;

  get strip() { return this.push.strip; }
  get stripHost() { return this.push.stripHost; }
  get pressureMode() { return this.push.pressureMode; }

  // ── reactive state for the UI ──
  readonly status: Accessor<Status>;
  readonly linkKind: Accessor<LinkKind | null>;
  readonly demoIndex: Accessor<number>;
  readonly log: Accessor<ReadonlyArray<LogEntry>>;
  readonly sent: Accessor<number>;
  readonly seenVersion: Accessor<number>;
  readonly logPaused: Accessor<boolean>;
  readonly logContinuous: Accessor<boolean>;
  readonly cameraView: Accessor<View>;
  readonly cameraMoved: Accessor<boolean>;
  private readonly set: {
    status: (s: Status) => void; linkKind: (k: LinkKind) => void; demoIndex: (i: number) => void; log: (fn: (l: ReadonlyArray<LogEntry>) => ReadonlyArray<LogEntry>) => void;
    sent: (n: number) => void; seenVersion: (n: number) => void; logPaused: (b: boolean) => void; logContinuous: (b: boolean) => void;
    cameraView: (v: View) => void; cameraMoved: (b: boolean) => void;
  };

  private link: Link | null = null;
  private demoFiber: Fiber.Fiber<never, never> | null = null;
  private logBuf: Array<LogEntry> = [];
  private seenDirty = false;
  private mobileTouch = false;
  private last = performance.now();

  readonly demos: ReadonlyArray<Demo>;

  constructor(demos: ReadonlyArray<Demo>) {
    this.demos = demos;
    const [status, setStatus] = createSignal<Status>({ link: false, midi: false, display: false });
    const [linkKind, setLinkKind] = createSignal<LinkKind | null>(null);
    const wantedDemo = new URLSearchParams(location.search).get('demo');
    const wantedIdx = wantedDemo ? demos.findIndex((d) => d.id === wantedDemo) : -1;
    // The last tab, by id (an index would point at another tab when the order changes). A first visit
    // starts on Explore: it works without a Push or a video file.
    const saved = store.get<unknown>('demo', 'explore');
    const savedIdx = demos.findIndex((d) => d.id === saved);
    const initialIdx = wantedIdx >= 0 ? wantedIdx : savedIdx >= 0 ? savedIdx : Math.max(0, demos.findIndex((d) => d.id === 'explore'));
    const [demoIndex, setDemoIndex] = createSignal(initialIdx);
    const [log, setLog] = createSignal<ReadonlyArray<LogEntry>>([]);
    const [sent, setSent] = createSignal(0);
    const [seenVersion, setSeenVersion] = createSignal(0);
    const [logPaused, setLogPaused] = createSignal(false);
    const [logContinuous, setLogContinuous] = createSignal(false);
    const [cameraView, setCameraView] = createSignal<View>('angled');
    const [cameraMoved, setCameraMoved] = createSignal(false);
    this.status = status;
    this.linkKind = linkKind;
    this.demoIndex = demoIndex;
    this.log = log;
    this.sent = sent;
    this.seenVersion = seenVersion;
    this.logPaused = logPaused;
    this.logContinuous = logContinuous;
    this.cameraView = cameraView;
    this.cameraMoved = cameraMoved;
    this.set = {
      status: setStatus, linkKind: setLinkKind, demoIndex: setDemoIndex, log: setLog, sent: setSent,
      seenVersion: setSeenVersion, logPaused: setLogPaused, logContinuous: setLogContinuous,
      cameraView: setCameraView, cameraMoved: setCameraMoved,
    };
  }

  get demo(): Demo { return this.demos[this.demoIndex()]!; }

  /** Create the 3D twin in `stage` and start the frame loop. */
  mount(stage: HTMLElement) {
    this.twin = new Twin(stage, this.screen.canvas);
    this.twin.setMobileTouch(this.mobileTouch);
    this.twin.onCameraMoved((moved) => this.set.cameraMoved(moved));
    this.leds.onChange((key, s) => this.twin.setLed(key, s));
    this.twin.on((ev) => this.handle(ev, 'virtual'));
    this.activate(this.demo);
    requestAnimationFrame(this.frame);
  }

  setCameraView(v: View) {
    this.set.cameraView(v);
    this.twin?.setView(v, true);
  }

  resetCamera() {
    this.twin?.resetView();
  }

  setMobileTouch(mobile: boolean) {
    this.mobileTouch = mobile;
    this.twin?.setMobileTouch(mobile);
  }

  attach(link: Link) { this.link = link; this.set.linkKind(link.kind); }

  // ── input ──
  onStatus(s: Status) {
    const before = this.status();
    this.set.status(s);
    if (s.midi && (!before.midi || !before.link)) this.initDevice();
  }

  onMidi(_port: MidiPort, data: ReadonlyArray<number>) {
    this.handle(this.push.parse(data), 'hw', data);
  }

  handle(ev: PushEvent, source: 'hw' | 'virtual', raw?: ReadonlyArray<number>) {
    if (!this.twin) return; // not mounted yet
    this.push.apply(ev);
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
  send(msgs: ReadonlyArray<Bytes>) { this.push.send(msgs); }

  private flushLeds() { this.push.flush(); }

  /** Something else (Live, the bridge exiting) may have taken the Push back: take it over again. */
  private initDevice() { this.push.init(); }

  /** Re-send palette, modes and every LED (bridge: also reconnect the device). */
  resync() { if (this.link?.kind === 'bridge') this.link.connect(); this.initDevice(); }

  /** Direct mode: must be called from a click (the USB chooser needs the user gesture). */
  connectDevice() { this.link?.connect(); }

  setPressureMode(mode: PressureMode) { this.push.setPressureMode(mode); }

  private setStripHost(on: boolean) {
    this.push.setStripHost(on);
    this.twin.setStripHost(on);
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
    store.set('demo', next.id);
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
    // tab LEDs first, so a demo may override them (Push 3 has 8 physical upper buttons)
    this.demos.slice(0, 8).forEach((d, i) => this.leds.button(102 + i, d === this.demo ? d.color : scale(d.color, 0.22)));
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
    this.set.sent(this.push.sent);
    if (this.seenDirty) { this.seenDirty = false; this.set.seenVersion(this.seenVersion() + 1); }
    requestAnimationFrame(this.frame);
  };
}
