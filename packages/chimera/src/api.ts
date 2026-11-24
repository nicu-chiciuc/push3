// The Chimera package as an app sees it: these types, and `loadChimera()`. The implementation
// (src/index.ts, src/voice.ts) and the upstream CHIMERA files behind it are checked with CHIMERA's
// own compiler options, so an app's stricter options never apply to them.
export * from './settings.ts';
import type { Body } from './settings.ts';

/** The voice settings a player moves (a part of CHIMERA's `VoiceSource`). */
export interface VoiceSettings {
  /** pitch, Hz */
  f0: number;
  /** breath (lung) pressure, cmH2O */
  pressure: number;
  /** pressed phonation, 0..1 */
  tension: number;
  /** 0 dark .. 1 bright */
  brightness: number;
  breathiness: number;
  roughness: number;
  /** vocal fry, 0..1 */
  fry: number;
  /** cents */
  vibratoDepth: number;
  /** pitch glide time, s */
  glide: number;
}

/** What the audio thread reports, about 60 times a second. */
export interface Readout {
  /** the pitch the folds vibrate at now, Hz */
  f0: number;
  /** 0..1 */
  voicing: number;
  /** lung pressure now, cmH2O */
  pLung: number;
  /** output level (RMS) */
  outRms: number;
  /** share of the audio thread's time the engine uses, 0..1 */
  load: number;
}

export interface Head {
  /** The picture: a square 2D canvas of `size * pixelRatio` pixels, redrawn by `frame`. */
  readonly canvas: HTMLCanvasElement;
  /** Move the face and the airflow on by `dt` seconds and draw the head. */
  frame(dt: number): void;
  /** Free the WebGL context. */
  dispose(): void;
}

export interface Chimera {
  /** The engine's own value for each setting (f0 for the current body). */
  readonly defaults: Readonly<VoiceSettings>;
  readonly body: Body;
  /** The AudioContext runs (the browser allows audio only after a click or key press). */
  readonly running: boolean;
  /** Start or resume the audio. Do not wait for it outside a click: it stays pending while the browser blocks audio. */
  start(): Promise<void>;
  suspend(): Promise<void>;
  /** Called when the AudioContext starts or stops. */
  onRunningChange(fn: (running: boolean) => void): () => void;
  setSource(values: Partial<VoiceSettings>): void;
  /** Breath on (1) or off (0). */
  gate(level: number): void;
  /** The mouth along MOUTH (0 = U .. 4 = I); between two vowels it is a blend of them. */
  setMouth(position: number): void;
  setBody(body: Body): void;
  /** The latest telemetry, or null while the audio does not run. */
  readout(): Readout | null;
  /** The output spectrum: `out.length` values in dB, log-spaced from `lo` to `hi` Hz. False before the audio exists. */
  spectrum(out: Float32Array, lo: number, hi: number): boolean;
  /** A 3D head of `size` CSS pixels square, drawn at `pixelRatio`. */
  createHead(size: number, pixelRatio: number, options?: { zoom?: number }): Head;
}

/** Load the engine (about 1 MB of WASM) once and give the voice. */
export declare function loadChimera(): Promise<Chimera>;
