// How the app reaches the Push. One interface, two Layers:
//   BridgeLink: WebSocket to the local Node bridge (works in any browser)
//   DirectLink: Web MIDI + WebUSB straight from the page (Chrome/Edge, no install)
// The engine only ever sees this service, so swapping the Layer swaps the transport.
import { Context, type Stream, type SubscriptionRef } from 'effect';
import type { Bytes } from '../../shared/push.ts';
import type { MidiPort } from '../../shared/wire.ts';

export type LinkKind = 'bridge' | 'direct';

export interface LinkStatus {
  /** bridge: WebSocket connected · direct: browser supports Web MIDI + WebUSB */
  readonly link: boolean;
  readonly midi: boolean;
  readonly display: boolean;
}

export interface IncomingMidi {
  readonly port: MidiPort;
  readonly data: ReadonlyArray<number>;
}

export class PushLink extends Context.Service<PushLink, {
  readonly kind: LinkKind;
  readonly status: SubscriptionRef.SubscriptionRef<LinkStatus>;
  readonly midi: Stream.Stream<IncomingMidi>;
  /** Hot path: fire-and-forget (no-op while disconnected). */
  sendMidi(batch: ReadonlyArray<Bytes>, port?: MidiPort): void;
  /** Hot path: 960×160 RGB565 pixels. */
  sendFrame(pixels: Uint16Array<ArrayBuffer>): void;
  /** bridge: ask the bridge to reconnect · direct: ask for permissions and connect (call from a click). */
  connect(): void;
}>()('push3-twin/PushLink') {}
