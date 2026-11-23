// The plain-TypeScript way in, no Effect needed: `await openPush()` gives one object with typed
// events, LED state, the screen and the connection status. Under the hood it runs the same
// PushLink Layers an Effect app would use directly.
import { Effect, ManagedRuntime, Stream, SubscriptionRef } from 'effect';
import { DISPLAY_HEIGHT as H, DISPLAY_WIDTH as W, PushController, rgbaToRgb565, type Bytes, type MidiPort, type PushEvent } from '@push3/protocol';
import { BridgeLink } from './BridgeLink.ts';
import { DirectLink } from './DirectLink.ts';
import { PushLink, type IncomingMidi, type LinkKind, type LinkStatus } from './PushLink.ts';

export interface OpenPushOptions {
  /** 'direct': Web MIDI + WebUSB from the page (Chrome/Edge). 'bridge': the local Node bridge. Default 'direct'. */
  readonly link?: LinkKind;
  /** Bridge only. Default ws://127.0.0.1:7333/ws. */
  readonly bridgeUrl?: string;
  /** Take the device over each time it connects (User Mode, palette, modes, LEDs). Default true. */
  readonly takeOver?: boolean;
}

export interface Push {
  readonly kind: LinkKind;
  /** LEDs, pad/button/knob state, pressure and strip modes. Call `flush()` after LED changes. */
  readonly controller: PushController;
  status(): LinkStatus;
  onStatus(fn: (status: LinkStatus) => void): () => void;
  /** Every event from the hardware, already applied to `controller` state. */
  onEvent(fn: (ev: PushEvent, raw: IncomingMidi) => void): () => void;
  /** Send the LED changes made through `controller.leds`. */
  flush(): void;
  sendMidi(batch: ReadonlyArray<Bytes>, port?: MidiPort): void;
  /** 960×160 RGB565 pixels (see rgbaToRgb565). */
  sendFrame(pixels: Uint16Array<ArrayBuffer>): void;
  /** Draw any image, video frame or canvas on the Push screen, scaled to 960×160. */
  sendImage(source: CanvasImageSource): void;
  /** Direct mode: ask for USB + MIDI permission. Call it from a click. Bridge mode: reconnect. */
  connect(): void;
  /** Hand the Push back to Live mode with its LEDs off, and stop. */
  close(): Promise<void>;
}

export async function openPush(options: OpenPushOptions = {}): Promise<Push> {
  const kind = options.link ?? 'direct';
  const runtime = ManagedRuntime.make(kind === 'bridge' ? BridgeLink(options.bridgeUrl ? { url: options.bridgeUrl } : {}) : DirectLink());
  const link = await runtime.runPromise(PushLink);
  const controller = new PushController(link);
  const statusListeners = new Set<(s: LinkStatus) => void>();
  const eventListeners = new Set<(ev: PushEvent, raw: IncomingMidi) => void>();

  let before: LinkStatus = SubscriptionRef.getUnsafe(link.status);
  runtime.runFork(
    SubscriptionRef.changes(link.status).pipe(
      Stream.runForEach((s) => Effect.sync(() => {
        if (options.takeOver !== false && s.midi && (!before.midi || !before.link)) controller.init();
        before = s;
        for (const fn of statusListeners) fn(s);
      })),
    ),
  );
  runtime.runFork(
    link.midi.pipe(
      Stream.runForEach((m) => Effect.sync(() => {
        const ev = controller.parse(m.data);
        controller.apply(ev);
        for (const fn of eventListeners) fn(ev, m);
      })),
    ),
  );

  let canvas: OffscreenCanvas | null = null;
  let g: OffscreenCanvasRenderingContext2D | null = null;
  const pixels = new Uint16Array(W * H);

  return {
    kind,
    controller,
    status: () => SubscriptionRef.getUnsafe(link.status),
    onStatus: (fn) => { statusListeners.add(fn); return () => statusListeners.delete(fn); },
    onEvent: (fn) => { eventListeners.add(fn); return () => eventListeners.delete(fn); },
    flush: () => controller.flush(),
    sendMidi: (batch, port) => controller.send(batch, port),
    sendFrame: (px) => link.sendFrame(px),
    sendImage: (source) => {
      canvas ??= new OffscreenCanvas(W, H);
      g ??= canvas.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(source, 0, 0, W, H);
      link.sendFrame(rgbaToRgb565(g.getImageData(0, 0, W, H).data, pixels));
    },
    connect: () => link.connect(),
    close: () => runtime.dispose(),
  };
}
