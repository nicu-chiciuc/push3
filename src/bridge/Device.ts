// The Push 3 as an Effect service. A supervisor fiber keeps a "session" alive while the
// Push is plugged in: the session scope owns the MIDI ports and the USB display, so
// unplugging, Ctrl+C, or a reconnect request all release everything the same way.
import { Context, Deferred, Effect, Layer, PubSub, Schedule, Schema, Stream, SubscriptionRef } from 'effect';
import { Input, Output } from '@julusian/midi';
import { findByIds, usb, type OutEndpoint } from 'usb';
import { DISPLAY_FRAME_BYTES, USB_PRODUCT_ID, USB_VENDOR_ID, type Bytes } from '../shared/push.ts';
import { darken as darkenMessages, sessionEnd, sessionStart } from '../shared/session.ts';
import { BRIDGE_PORT, type MidiPort } from '../shared/wire.ts';
import { encodeFrame, FRAME_HEADER, idleFrame, USB_CHUNK } from './frames.ts';

export class PushNotFound extends Schema.TaggedError<PushNotFound>()('PushNotFound', { what: Schema.String }) {}
export class DisplayError extends Schema.TaggedError<DisplayError>()('DisplayError', { message: Schema.String }) {}

export interface DeviceStatus {
  readonly midi: boolean;
  readonly display: boolean;
}
export interface IncomingMidi {
  readonly port: MidiPort;
  readonly data: ReadonlyArray<number>;
}

export class Device extends Context.Service<Device, {
  readonly status: SubscriptionRef.SubscriptionRef<DeviceStatus>;
  readonly incoming: Stream.Stream<IncomingMidi>;
  /** Hot path: fire-and-forget MIDI to the Push (no-op while disconnected). */
  sendMidi(port: MidiPort, batch: ReadonlyArray<Bytes>): void;
  /** Hot path: latest RGB565 frame from the browser. */
  setFrame(pixels: Uint8Array): void;
  /** Number of connected browsers; when it drops to 0 we darken the LEDs and show the idle screen. */
  setViewers(n: number): void;
  readonly reconnect: Effect.Effect<void>;
}>()('push3-twin/Device') {
  static readonly layer = Layer.effect(Device, makeDevice());
}

const PORT_PATTERN: Record<MidiPort, RegExp> = { live: /Push 3 Live/i, user: /Push 3 User/i, external: /Push 3 External/i };
const portIndex = (names: ReadonlyArray<string>, port: MidiPort) => names.findIndex((n) => PORT_PATTERN[port].test(n));
const isPush = (d: usb.Device) => d.deviceDescriptor.idVendor === USB_VENDOR_ID && d.deviceDescriptor.idProduct === USB_PRODUCT_ID;

/** Turn off every LED the app may have lit and restore the touch strip. */
function darken(send: (port: MidiPort, bytes: Bytes) => void) {
  for (const [port, bytes] of darkenMessages()) send(port, bytes);
}

/** Open the Push's MIDI ports in the current scope. */
const openMidi = Effect.fnUntraced(function* (onMessage: (msg: IncomingMidi) => void) {
  const inputs = Input.getPortNames();
  if (portIndex(inputs, 'user') < 0) return yield* new PushNotFound({ what: 'Push 3 MIDI ports' });

  for (const port of ['live', 'user', 'external'] as const) {
    const index = portIndex(inputs, port);
    if (index < 0) continue;
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const input = new Input();
        input.ignoreTypes(false, true, true); // keep SysEx; drop clock + active sensing
        input.on('message', (_dt, data) => onMessage({ port, data }));
        input.openPort(index);
        return input;
      }),
      (input) => Effect.sync(() => { input.closePort(); input.destroy(); }),
    );
  }

  const outputs = Output.getPortNames();
  const openOutput = (port: MidiPort) =>
    Effect.acquireRelease(
      Effect.sync(() => { const out = new Output(); out.openPort(portIndex(outputs, port)); return out; }),
      (out) => Effect.sync(() => { out.closePort(); out.destroy(); }),
    );
  const live = yield* openOutput('live');
  const user = yield* openOutput('user');
  const send = (port: MidiPort, bytes: Bytes) => {
    try { (port === 'live' ? live : user).sendMessage(bytes as Array<number>); } catch { /* device vanished mid-send */ }
  };

  // Added after the outputs, so it runs before they close: leave the Push tidy and hand it back to Live.
  yield* Effect.addFinalizer(() => Effect.sync(() => { for (const [port, bytes] of sessionEnd()) send(port, bytes); }));
  for (const [port, bytes] of sessionStart()) send(port, bytes);
  yield* Effect.logInfo('MIDI connected, Push 3 in User Mode');
  return send;
});

/** Claim USB interface 0 (the display) in the current scope. */
const openDisplay = Effect.acquireRelease(
  Effect.try({
    try: () => {
      const dev = findByIds(USB_VENDOR_ID, USB_PRODUCT_ID);
      if (!dev) throw new Error('Push 3 not found on USB');
      dev.open();
      const iface = dev.interface(0);
      try { iface.claim(); } catch (e) { dev.close(); throw e; }
      const ep = iface.endpoints.find((e) => e.direction === 'out') as OutEndpoint;
      return { dev, iface, ep };
    },
    catch: (e) => new DisplayError({ message: e instanceof Error ? e.message : String(e) }),
  }),
  ({ dev, iface }) => Effect.callback<void>((resume) => {
    iface.release(true, () => { try { dev.close(); } catch {} resume(Effect.void); });
  }),
);

const transfer = (ep: OutEndpoint, buf: Buffer) =>
  Effect.callback<void, DisplayError>((resume) => {
    ep.transfer(buf, (err) => resume(err ? Effect.fail(new DisplayError({ message: err.message })) : Effect.void));
  });

function makeDevice() {
  return Effect.gen(function* () {
    const status = yield* SubscriptionRef.make<DeviceStatus>({ midi: false, display: false });
    const incoming = yield* PubSub.unbounded<IncomingMidi>();
    yield* Effect.addFinalizer(() => PubSub.shutdown(incoming));

    // Mutable hot-path state shared with the session.
    let send: ((port: MidiPort, bytes: Bytes) => void) | null = null;
    let viewers = 0;
    let clientFrame: Buffer | null = null;
    let clientFrameAt = 0;
    let endSession: Deferred.Deferred<void> | null = null;
    const idle = idleFrame(BRIDGE_PORT);
    const setStatus = (patch: Partial<DeviceStatus>) => SubscriptionRef.update(status, (s) => ({ ...s, ...patch }));

    // Stream frames until a transfer fails: ~60 fps while a browser streams, 10 fps keep-alive otherwise
    // (the screen goes black after 2 s without a frame).
    const pumpFrames = Effect.fnUntraced(function* (ep: OutEndpoint) {
      for (;;) {
        const started = Date.now();
        const streaming = viewers > 0 && clientFrame !== null;
        const frame = streaming ? clientFrame! : idle;
        yield* transfer(ep, FRAME_HEADER);
        for (let o = 0; o < frame.length; o += USB_CHUNK) yield* transfer(ep, frame.subarray(o, o + USB_CHUNK));
        const target = streaming && Date.now() - clientFrameAt < 1000 ? 16 : 100;
        yield* Effect.sleep(Math.max(1, target - (Date.now() - started)));
      }
    });

    let lastDisplayError = '';
    const display = Effect.gen(function* () {
      const { ep } = yield* openDisplay;
      yield* Effect.acquireRelease(setStatus({ display: true }), () => setStatus({ display: false }));
      yield* Effect.logInfo('Display claimed (USB interface 0)');
      lastDisplayError = '';
      return yield* pumpFrames(ep);
    }).pipe(
      Effect.scoped,
      Effect.tapError((e) =>
        e.message === lastDisplayError ? Effect.void : Effect.logWarning(`Display: ${(lastDisplayError = e.message)} (is Ableton Live running?)`),
      ),
      Effect.retry(Schedule.spaced('3 seconds')),
    );

    // One session = one continuous connection to a plugged-in Push.
    const session = Effect.gen(function* () {
      const end = yield* Deferred.make<void>();
      endSession = end;
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const onDetach = (d: usb.Device) => { if (isPush(d)) Deferred.doneUnsafe(end, Effect.void); };
          usb.on('detach', onDetach);
          return onDetach;
        }),
        (onDetach) => Effect.sync(() => usb.off('detach', onDetach)),
      );
      const midiSend = yield* openMidi((msg) => PubSub.publishUnsafe(incoming, msg));
      yield* Effect.acquireRelease(
        Effect.sync(() => { send = midiSend; }).pipe(Effect.andThen(setStatus({ midi: true }))),
        () => Effect.sync(() => { send = null; }).pipe(Effect.andThen(setStatus({ midi: false }))),
      );
      yield* Effect.forkScoped(display);
      yield* Deferred.await(end);
      yield* Effect.logInfo('Session ended (unplugged or reconnect requested)');
    }).pipe(Effect.scoped);

    let lastError = '';
    yield* session.pipe(
      Effect.tapError((e) => (e.what === lastError ? Effect.void : Effect.logInfo(`Waiting for the Push: ${(lastError = e.what)} not found — plug it in and quit Ableton Live`))),
      Effect.retry(Schedule.spaced('2 seconds')),
      Effect.andThen(Effect.sync(() => { lastError = ''; })),
      Effect.forever,
      Effect.forkScoped,
    );

    return Device.of({
      status,
      incoming: Stream.fromPubSub(incoming),
      sendMidi: (port, batch) => { if (send) for (const bytes of batch) send(port, bytes); },
      setFrame: (pixels) => {
        if (pixels.length !== DISPLAY_FRAME_BYTES) return;
        clientFrame = encodeFrame(pixels);
        clientFrameAt = Date.now();
      },
      setViewers: (n) => {
        if (n === 0 && viewers > 0) { clientFrame = null; if (send) darken(send); }
        viewers = n;
      },
      reconnect: Effect.suspend(() => (endSession ? Deferred.succeed(endSession, undefined) : Effect.void)).pipe(Effect.asVoid),
    });
  });
}
