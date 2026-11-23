# Push 3 Twin

A 3D digital twin and demo suite for a USB-tethered **Ableton Push 3** (controller version). No Ableton Live needed and no hacking: it talks to the Push over plain MIDI plus the documented USB display protocol.

## Run it

```bash
npm install
npm run dev      # bridge + Vite with hot reload → http://localhost:5173
npm start        # production: build, then the bridge serves it → http://localhost:7333
```

Quit Ableton Live first. Live grabs the MIDI ports, and its background `Push3` process holds the screen. Plug the Push's power supply in for full LED brightness; on USB power alone the LEDs are capped very dim. Use Chrome or another browser for the page.

When no browser is connected, the Push screen shows "OPEN LOCALHOST:7333". `Ctrl+C` closes every scope in order: LEDs off, Push handed back to Live mode, MIDI ports closed, USB display released.

Other scripts: `npm run typecheck` checks both projects. `node scripts/probe-leds.ts` and `node scripts/probe-display.ts` are hardware diagnostics; run them with the bridge stopped.

## Stack, and where each piece fits

```
src/shared/      wire.ts: Effect Schema for every WebSocket message (validated on both ends)
                 push.ts: Push 3 constants + SysEx builders
src/bridge/      Node, run directly as TypeScript (Node's type stripping)
  Device.ts      Effect service: supervised "session" per plug-in (scoped MIDI ports + USB display),
                 retry schedules, hot-plug, status as a SubscriptionRef, incoming MIDI as a Stream
  Server.ts      HTTP (serves dist/) + WebSocket on 127.0.0.1, as a scoped Layer
  main.ts        Layer.launch + NodeRuntime.runMain
src/app/         Browser: Vite + Solid
  services/BridgeClient.ts   Effect service: WebSocket with reconnect, Schema-decoded Stream
  engine/        Plain TypeScript hot path: 60 fps loop, LED diffing, screen canvas → RGB565,
                 Three.js twin, MIDI parser. UI-visible state is exposed as Solid signals.
  demos/*.tsx    One file per tab: onEvent / tick / draw (hot path) + a Solid Panel component.
                 Each tab is an Effect fiber; `activate` acquires device modes in its Scope,
                 e.g. `app.usePressureMode('mpe')`, and they're restored when you switch tabs.
  ui/App.tsx     Solid shell: status, tabs, panel, event log
```

- **Effect** handles lifecycles, concurrency, retries and validation: the whole bridge, the browser's connection, and each tab's lifetime.
- **Plain TS** handles everything that runs per frame or per MIDI message.
- **Solid** handles the DOM. Its fine-grained signals update only what changed, and it coexists with the imperative Three.js and canvas code.

## Tabs (upper display buttons 1–8, or keys 1–8)

| Tab | Shows off |
|---|---|
| Explore | Every control mirrored. Velocity-colored pads, knob gauges on the screen |
| Test | Coverage checklist: every pad/button/knob you use turns green. Palette sweep, screen test pattern |
| Paint | Pads as an 8×8 canvas; knobs = hue/sat/brightness |
| Expression | Channel AT / Poly AT / MPE modes, per-finger pressure + roll + slide, Web Audio synth |
| Ripple | Light show from the browser every frame, or the Push's own hardware pulse/blink animation |
| CSS Knobs | 8 knobs → 8 CSS custom properties on a live card, presets on pads, generated CSS |
| Screen | Scrolling text, plasma, dropped images, clock on the Push display; pads mirror it |
| Snake | A game on the pad grid (arrows, jog wheel or pads to steer) |

## Fixing a control mapping

`src/app/engine/layout.ts` holds the physical layout (traced from a product photo) and the MIDI number of every control. Its numbers come from Ableton's Push 2 spec plus community Push 3 notes. If the Test tab shows a button as "Unmapped", or it lights up the wrong spot in 3D, fix it there.

## Protocol sources

- Official: Ableton's [Push 2 MIDI & Display Interface Manual](https://github.com/Ableton/push-interface). The display format, palette, LED animations and touch strip all work unchanged on Push 3.
- Community (Push 3 extras such as MPE mode `0x1E 02` and the per-pad MPE options): [danielknng/push3-protocol-docs](https://github.com/danielknng/push3-protocol-docs) and [DrivenByMoss](https://github.com/git-moss/DrivenByMoss).
- Only documented commands are sent. Ableton warns that undocumented SysEx can wipe factory calibration.
