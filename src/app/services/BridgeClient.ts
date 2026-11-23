// The browser's link to the Node bridge, as an Effect service: a supervised WebSocket that
// reconnects forever, validates every message with the shared Schema, and exposes the
// Push's MIDI as a Stream. Sending stays synchronous because it runs in the frame loop.
import { Context, Effect, Layer, Option, PubSub, Queue, Schema, Stream, SubscriptionRef } from 'effect';
import type { Bytes } from '../../shared/push.ts';
import { ClientMessageJson, ServerMessageJson, WS_PATH, type MidiPort, type ServerMessage } from '../../shared/wire.ts';
import type { Status } from '../engine/engine.ts';

export interface IncomingMidi { readonly port: MidiPort; readonly data: ReadonlyArray<number> }

export class BridgeClient extends Context.Service<BridgeClient, {
  readonly status: SubscriptionRef.SubscriptionRef<Status>;
  readonly midi: Stream.Stream<IncomingMidi>;
  sendMidi(batch: ReadonlyArray<Bytes>, port?: MidiPort): void;
  sendFrame(pixels: Uint16Array<ArrayBuffer>): void;
  reconnectDevice(): void;
}>()('push3-twin/BridgeClient') {
  static readonly layer = Layer.effect(BridgeClient, makeClient());
}

class SocketError extends Schema.TaggedError<SocketError>()('SocketError', { message: Schema.String }) {}

const OFFLINE: Status = { bridge: false, midi: false, display: false };

function makeClient() {
  return Effect.gen(function* () {
    const status = yield* SubscriptionRef.make<Status>(OFFLINE);
    const midi = yield* PubSub.unbounded<IncomingMidi>();
    const encode = Schema.encodeSync(ClientMessageJson);
    const decode = Schema.decodeUnknownOption(ServerMessageJson);
    let socket: WebSocket | null = null;

    const open = Effect.acquireRelease(
      Effect.callback<WebSocket, SocketError>((resume) => {
        const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${WS_PATH}`);
        ws.binaryType = 'arraybuffer';
        ws.onopen = () => resume(Effect.succeed(ws));
        ws.onerror = () => resume(Effect.fail(new SocketError({ message: 'could not reach the bridge' })));
        return Effect.sync(() => ws.close()); // interrupted while connecting
      }),
      (ws) => Effect.sync(() => ws.close()),
    );

    const handle = (m: ServerMessage) =>
      m._tag === 'Midi'
        ? PubSub.publish(midi, { port: m.port, data: m.data })
        : SubscriptionRef.update(status, (s) => ({ ...s, midi: m.midi, display: m.display }));

    // One connection: runs until the socket closes.
    const connection = Effect.gen(function* () {
      const ws = yield* open;
      yield* Effect.acquireRelease(
        Effect.sync(() => { socket = ws; }).pipe(Effect.andThen(SubscriptionRef.update(status, (s) => ({ ...s, bridge: true })))),
        () => Effect.sync(() => { socket = null; }).pipe(Effect.andThen(SubscriptionRef.set(status, OFFLINE))),
      );
      yield* Stream.callback<ServerMessage>((queue) =>
        Effect.sync(() => {
          ws.onmessage = (e) => {
            if (typeof e.data !== 'string') return;
            const msg = decode(e.data);
            if (Option.isSome(msg)) Queue.offerUnsafe(queue, msg.value);
          };
          ws.onclose = () => Queue.endUnsafe(queue);
        }),
      ).pipe(Stream.runForEach(handle));
    }).pipe(Effect.scoped);

    // Supervise: reconnect a second after any close or failure, forever.
    yield* connection.pipe(Effect.ignore, Effect.andThen(Effect.sleep('1 second')), Effect.forever, Effect.forkScoped);

    const send = (json: string) => { if (socket?.readyState === WebSocket.OPEN) socket.send(json); };
    let warned = false;

    return BridgeClient.of({
      status,
      midi: Stream.fromPubSub(midi),
      sendMidi: (batch, port = 'user') => {
        if (!socket || batch.length === 0) return;
        try {
          send(encode({ _tag: 'SendMidi', port, batch }));
        } catch (e) {
          if (!warned) { warned = true; console.error('[push3-twin] refused to send invalid MIDI', e); }
        }
      },
      sendFrame: (pixels) => {
        // Drop a frame rather than queue if the socket is backed up.
        if (socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < 1_000_000) socket.send(pixels);
      },
      reconnectDevice: () => send(encode({ _tag: 'Reconnect' })),
    });
  });
}
