// The package ships JavaScript only; these types follow its README (version 1.3.2).
declare module 'signalsmith-stretch' {
  export interface StretchChange {
    /** Audio context time of the change. */
    output?: number;
    active?: boolean;
    /** Buffer mode only: position and rate in the input buffer. */
    input?: number;
    rate?: number;
    semitones?: number;
    /** Tonality limit (default 8000). */
    tonalityHz?: number;
    formantSemitones?: number;
    formantCompensation?: boolean;
    /** Rough fundamental for formant analysis, or 0 to track the pitch. */
    formantBaseHz?: number;
    loopStart?: number;
    loopEnd?: number;
  }
  export interface StretchNode extends AudioWorkletNode {
    readonly inputTime: number;
    // Every method is a call into the audio thread, answered asynchronously.
    schedule(change: StretchChange): Promise<unknown>;
    start(when?: number): Promise<unknown>;
    stop(when?: number): Promise<unknown>;
    /** Live-input latency in seconds. */
    latency(): Promise<number>;
    configure(config: { blockMs?: number | null; intervalMs?: number; splitComputation?: boolean; preset?: 'default' | 'cheaper' }): Promise<unknown>;
    addBuffers(buffers: ReadonlyArray<Float32Array>): Promise<number>;
    dropBuffers(toSeconds?: number): Promise<{ start: number; end: number }>;
    /** How often `inputTime` updates; the callback gets the input time heard at the current output time. */
    setUpdateInterval(seconds: number, callback?: (inputTime: number) => void): Promise<unknown>;
  }
  export default function SignalsmithStretch(context: BaseAudioContext, channelOptions?: AudioWorkletNodeOptions): Promise<StretchNode>;
}
