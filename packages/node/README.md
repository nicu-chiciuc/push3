# @push3/node

Own an Ableton Push 3 from Node (node-usb for the screen, RtMidi for MIDI) and share it with web pages on localhost.

```bash
push3-bridge                  # WebSocket on ws://127.0.0.1:7333/ws
push3-bridge --static dist    # and serve a built web app on http://localhost:7333
```

Pages connect with `@push3/web` (`openPush({ link: 'bridge' })`). Only pages from `http://localhost` or `http://127.0.0.1` may connect.
The bridge survives unplugging and Ableton Live taking the device: it waits and reconnects. `Ctrl+C` turns the LEDs off,
hands the Push back to Live mode and releases the screen.

As Effect Layers: `Device.layer` (the Push as a service: status, incoming MIDI stream, `sendMidi`, `setFrame`) and
`BridgeServer({ staticDir })` (HTTP + WebSocket).

Hardware diagnostics, with the bridge stopped: `node scripts/probe-leds.ts`, `node scripts/probe-display.ts`.

Node 24 or later runs the TypeScript source directly.
