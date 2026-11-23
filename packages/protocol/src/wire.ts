// The WebSocket protocol between the Node bridge and the browser, defined once with
// Effect Schema and validated on both ends. Display frames travel as raw binary
// messages (960×160 RGB565) and are not part of this schema.
// Needs `effect` (a peer dependency of this subpath only).
import { Schema } from 'effect';
import type { MidiPort as Port } from './device.ts';

export { BRIDGE_PORT, WS_PATH } from './device.ts';

export const MidiPort = Schema.Literals(['live', 'user', 'external'] as const satisfies ReadonlyArray<Port>);

const Byte = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }));
const MidiMessage = Schema.Array(Byte).check(Schema.isMinLength(1), Schema.isMaxLength(64));

// bridge → browser
export const ServerMessage = Schema.Union([
  Schema.TaggedStruct('Midi', { port: MidiPort, data: MidiMessage }),
  Schema.TaggedStruct('Status', { midi: Schema.Boolean, display: Schema.Boolean }),
]);
export type ServerMessage = typeof ServerMessage.Type;

// browser → bridge
export const ClientMessage = Schema.Union([
  Schema.TaggedStruct('SendMidi', { port: MidiPort, batch: Schema.Array(MidiMessage).check(Schema.isMaxLength(4096)) }),
  Schema.TaggedStruct('Reconnect', {}),
]);
export type ClientMessage = typeof ClientMessage.Type;

export const ServerMessageJson = Schema.fromJsonString(ServerMessage);
export const ClientMessageJson = Schema.fromJsonString(ClientMessage);
