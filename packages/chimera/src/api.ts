// The Chimera package as an app sees it: these types, and `loadChimera()`. The implementation
// (src/index.ts, src/voice.ts) and the upstream CHIMERA files behind it are checked with CHIMERA's
// own compiler options, so an app's stricter options never apply to them.
export * from './settings.ts';
import type { ArticKey, Articulation, BodyMix, HandleId } from './settings.ts';

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

/** What each voice of a chord has of its own: its note's pitch, its finger's breath and brightness. */
export type VoiceNote = Pick<VoiceSettings, 'f0' | 'pressure' | 'brightness'>;
/** What the voices share: every other setting. */
export type VoiceDials = Omit<VoiceSettings, keyof VoiceNote>;

/** Which voice holds which key, by CHIMERA's own rules (upstream/src/ui/voiceAlloc.ts): the voice
 *  that has the key already; or the voice free for the longest; or, with every voice busy, the
 *  voice whose note started longest ago, which takes the key as one voice takes a second key
 *  (legato, and back to the older key when the new one lifts). It only keeps count: the caller
 *  makes the sound (`setVoice`, `gate`). */
export interface KeyVoices {
  /** voices that play (`Chimera.setVoices` sets it) */
  readonly count: number;
  /** the keys down on each voice, oldest first: a voice sounds its last one */
  readonly keys: ReadonlyArray<ReadonlyArray<number>>;
  busy(voice: number): boolean;
  /** The voice that holds this key, if one does. */
  voiceOf(key: number): number | undefined;
  /** The voice the rules give this key (nothing changes until `press`). */
  pick(key: number): number;
  press(key: number, voice: number): void;
  /** The key lifts: its voice, and the key that voice goes back to. */
  lift(key: number): { voice: number; back: number | null } | null;
  /** The voice with the newest note among those with a key down. */
  newest(): number | null;
  /** No key down anywhere. */
  clear(): void;
}

/** What the audio thread reports, about 60 times a second, of the voice shown (`showVoice`). */
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
  /** each voice's pitch (Hz) and voicing now */
  voices: ReadonlyArray<{ f0: number; voicing: number }>;
}

export interface Head {
  /** The picture: a 2D canvas of `width × height` CSS pixels at `pixelRatio`, redrawn by `frame`. */
  readonly canvas: HTMLCanvasElement;
  /** Move the face and the airflow on by `dt` seconds and draw the head, with `ring` marked. */
  frame(dt: number, ring?: HandleId | null): void;
}

export interface Chimera {
  /** The engine's own value for each setting (f0 for the current body). */
  readonly defaults: Readonly<VoiceSettings>;
  /** Each articulator's range (cm, or cm² for the soft palate; the tongue in the engine's template coordinates). */
  readonly articRange: Readonly<Record<ArticKey, { min: number; max: number }>>;
  /** The body the head shows (a size being chosen runs ahead of the voice, see setBody). */
  readonly body: BodyMix;
  /** The AudioContext runs (the browser allows audio only after a click or key press). */
  readonly running: boolean;
  /** Start or resume the audio. Do not wait for it outside a click: it stays pending while the browser blocks audio. */
  start(): Promise<void>;
  suspend(): Promise<void>;
  /** Called when the AudioContext starts or stops. */
  onRunningChange(fn: (running: boolean) => void): () => void;
  /** Which voice holds which key. */
  readonly keys: KeyVoices;
  /** How many voices play (1 to MAX_VOICES): a chord's notes, one voice each. The keys still down
   *  are let go. A voice taken away rings on for a second. */
  setVoices(count: number): void;
  /** What every voice shares. */
  setSource(values: Partial<VoiceDials>): void;
  /** One voice's own note. With `start` its pitch is there at once, with no glide (a note that
   *  starts from silence); else the voice glides to it. */
  setVoice(voice: number, values: Partial<VoiceNote>, start?: boolean): void;
  /** One voice's breath on (1) or off (0); the first voice's, with no `voice`. */
  gate(level: number, voice?: number): void;
  /** The voice the head and `readout` show. All the voices have one mouth; their folds and
   *  their breath are their own. */
  showVoice(voice: number): void;
  /** Where the articulators are going (what setArtic and setMouth asked for). */
  articulation(): Articulation;
  setArtic(values: Partial<Articulation>): void;
  /** The mouth along MOUTH (0 = U .. 4 = I): all the articulators go to that vowel, or a blend of two. */
  setMouth(position: number): void;
  /** Show this body on the head; with `rebuild`, also rebuild the voice for it (a new airway, which
   *  takes a moment: do it when the choice is made, not on each step). */
  setBody(body: BodyMix, rebuild: boolean): void;
  /** The latest telemetry, or null while the audio does not run. */
  readout(): Readout | null;
  /** The output spectrum: `out.length` values in dB, log-spaced from `lo` to `hi` Hz. False before the audio exists. */
  spectrum(out: Float32Array, lo: number, hi: number): boolean;
  /** CHIMERA's 2D head (the midsagittal view), as large as the canvas allows: in the middle, or
   *  at the left edge (a ringed handle's name is drawn to its right, so leave room there). */
  createHead(width: number, height: number, pixelRatio: number, options?: { align?: 'left' | 'center' }): Head;
}

/** Load the engine (about 1 MB of WASM) once and give the voice. */
export declare function loadChimera(): Promise<Chimera>;
