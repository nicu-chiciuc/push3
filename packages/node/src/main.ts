#!/usr/bin/env node
// `push3-bridge [--static <dir>]` (Node runs the TypeScript directly).
// Ctrl+C interrupts the program; every scope closes in order: LEDs off, Push handed
// back to Live mode, MIDI ports closed, USB display released, HTTP server stopped.
import { parseArgs } from 'node:util';
import { NodeRuntime } from '@effect/platform-node';
import { Layer, Logger } from 'effect';
import { Device } from './Device.ts';
import { BridgeServer } from './Server.ts';

const { values } = parseArgs({ options: { static: { type: 'string' } } });

const Main = BridgeServer(values.static ? { staticDir: values.static } : {}).pipe(
  Layer.provide(Device.layer),
  Layer.provide(Logger.layer([Logger.consolePretty()])),
);

NodeRuntime.runMain(Layer.launch(Main));
