# Push 3 Twin

A 3D digital twin and demo suite for a USB-tethered **Ableton Push 3** (controller version). No Ableton Live needed and no hacking: it talks to the Push over plain MIDI plus the documented USB display protocol.

## Two ways to connect

| | **Direct mode** (default on any deployed site) | **Bridge mode** (default on localhost) |
|---|---|---|
| How | Web MIDI (pads, knobs, LEDs) + WebUSB (screen), straight from the page | WebSocket to a small local Node process that owns the Push |
| Install | Nothing. Click **Connect Push** once; Chrome remembers it | `npm install` + `npm run dev` |
| Browsers | Chrome / Edge (Chromium) | Any |
| Screen while the tab is hidden | Stays on (frozen): a worker keeps it alive | Stays on |

Measured on macOS with a Push 3: Web MIDI handled 6,400 LED messages/s; WebUSB drove the screen at 60 fps with one 327 KB transfer per frame. Add `?link=direct` or `?link=bridge` to the URL to force a mode, or use the link in the top bar. People without a Push can still use the 3D model with the mouse.

## Run it

```bash
npm install
npm run dev      # bridge + Vite with hot reload → http://localhost:5173 (?link=direct to skip the bridge)
npm start        # production: build, then the bridge serves it → http://localhost:7333
```

`spikes/direct.html` (served by `npm run dev`) is the raw Web MIDI/WebUSB benchmark page.

Quit Ableton Live first. Live grabs the MIDI ports, and its background `Push3` process holds the screen. Plug the Push's power supply in for full LED brightness; on USB power alone the LEDs are capped very dim. Use Chrome or another browser for the page.

When no browser is connected, the Push screen shows "OPEN LOCALHOST:7333". `Ctrl+C` closes every scope in order: LEDs off, Push handed back to Live mode, MIDI ports closed, USB display released.

Other scripts: `npm run typecheck` checks both projects. `node scripts/probe-leds.ts` and `node scripts/probe-display.ts` are hardware diagnostics; run them with the bridge stopped.

## Deploy

Production: [push.tsx.md](https://push.tsx.md). One Alchemy stack, deployed from GitHub Actions:

- `alchemy.run.ts` is the one Alchemy stack. It holds one Cloudflare Worker that serves `dist/` as static assets.
- `.github/workflows/alchemy.yml` installs, builds with `npm run typecheck && npm run build` (no secrets), then runs `alchemy deploy`.
- Stages: `prod` deploys on each push to `main` and serves `push.tsx.md`. `pr-<number>` deploys on each pull request to its own `workers.dev` URL and is destroyed when the pull request closes.
- State lives on the branch `alchemy-state-store` of this repository ([`@samebase/alchemy-kit/github-state`](https://github.com/samebase/samebase/tree/main/packages/alchemy-kit#github-state-store)). The run writes it with its own `GITHUB_TOKEN`; no Convex token is needed.
- The repository needs three secrets: `ALCHEMY_GITHUB_STATE_KEY` (seals secrets in the state), `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The API token is account-owned, named "push3-twin GitHub Actions (Alchemy deploy)", with Workers Scripts Write on the account plus Zone Read, Workers Routes Write and DNS Write on `tsx.md` only.

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
  services/PushLink.ts       The one interface the app uses to reach the Push, with two Layers:
    BridgeLink.ts            WebSocket to the Node bridge, reconnecting, Schema-decoded Stream
    DirectLink.ts            Web MIDI + WebUSB; display-worker.ts pumps the screen
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
