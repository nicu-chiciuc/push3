// Entry point: `node src/bridge/main.ts` (Node runs the TypeScript directly).
// Ctrl+C interrupts the program; every scope closes in order: LEDs off, Push handed
// back to Live mode, MIDI ports closed, USB display released, HTTP server stopped.
import { NodeRuntime } from '@effect/platform-node';
import { Layer, Logger } from 'effect';
import { Device } from './Device.ts';
import { ServerLive } from './Server.ts';

const Main = ServerLive.pipe(
  Layer.provide(Device.layer),
  Layer.provide(Logger.layer([Logger.consolePretty()])),
);

NodeRuntime.runMain(Layer.launch(Main));
