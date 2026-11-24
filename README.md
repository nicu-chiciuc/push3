# Push 3 Twin

A 3D digital twin and demo suite for a USB-tethered **Ableton Push 3** (controller version), plus the packages it is built from, so other apps can drive a Push too. No Ableton Live needed and no hacking: it talks to the Push over plain MIDI plus the documented USB display protocol.

## Packages

| Folder | Package | What it is |
|---|---|---|
| [`packages/protocol`](packages/protocol) | `@push3/protocol` | The Push 3 as data: control map, MIDI parser, SysEx, LED palette and diffing, display frame encoder, a transport-agnostic `PushController`. No dependencies. |
| [`packages/web`](packages/web) | `@push3/web` | Drive a Push from a web page: `openPush()` (plain TS), or the `PushLink` Effect service with `DirectLink()` (Web MIDI + WebUSB) and `BridgeLink()` (local bridge). |
| [`packages/node`](packages/node) | `@push3/node` | The bridge: owns the Push from Node and shares it with pages on localhost. `push3-bridge [--static <dir>]`. |
| [`packages/sidebars-solid`](packages/sidebars-solid) | `sidebars-solid` | A Solid port of [`@samebase/sidebars`](https://github.com/samebase/samebase/tree/main/packages/sidebars): resizable side panes on desktop, a swipe carousel on phones. MIT. |
| [`apps/twin`](apps/twin) | `push3-twin` | The 3D twin and demo tabs. Deployed to [push.tsx.md](https://push.tsx.md). |

The packages export their TypeScript source and are private for now. Another app in this workspace, or a Vite app linked to it (`pnpm add link:../push3-twin/packages/web`), can use them as they are. Publishing them to npm needs a license and a build step first.

## Two ways to connect

| | **Direct mode** (default on any deployed site) | **Bridge mode** (default on localhost) |
|---|---|---|
| How | Web MIDI (pads, knobs, LEDs) + WebUSB (screen), straight from the page | WebSocket to a small local Node process that owns the Push |
| Install | Nothing. Click **Connect Push** once; Chrome remembers it | `pnpm install` + `pnpm dev` |
| Browsers | Chrome / Edge (Chromium) | Any |
| Screen while the tab is hidden | Stays on (frozen): a worker keeps it alive | Stays on |

Measured on macOS with a Push 3: Web MIDI handled 6,400 LED messages/s; WebUSB drove the screen at 60 fps with one 327 KB transfer per frame. Add `?link=direct` or `?link=bridge` to the URL to force a mode, or use the link in the top bar. People without a Push can still use the 3D model with the mouse.

## Run it

```bash
pnpm install
pnpm dev         # bridge + Vite with hot reload → http://localhost:5173 (?link=direct to skip the bridge)
pnpm start       # production: build, then the bridge serves it → http://localhost:7333
pnpm typecheck   # every package and the app
```

`apps/twin/spikes/direct.html` (served by `pnpm dev` at `/spikes/direct.html`) is the raw Web MIDI/WebUSB benchmark page.

Quit Ableton Live first. Live grabs the MIDI ports, and its background `Push3` process holds the screen. Plug the Push's power supply in for full LED brightness; on USB power alone the LEDs are capped very dim. Use Chrome or another browser for the page.

When no browser is connected, the Push screen shows "OPEN LOCALHOST:7333". `Ctrl+C` closes every scope in order: LEDs off, Push handed back to Live mode, MIDI ports closed, USB display released.

Hardware diagnostics, with the bridge stopped: `node packages/node/scripts/probe-leds.ts` and `node packages/node/scripts/probe-display.ts`.

## Deploy

Production: [push.tsx.md](https://push.tsx.md). One Alchemy stack, deployed from GitHub Actions:

- `apps/twin/alchemy.run.ts` is the one Alchemy stack. It holds one Cloudflare Worker that serves `apps/twin/dist` as static assets.
- `.github/workflows/alchemy.yml` installs, builds with `pnpm typecheck && pnpm build` (no secrets), then runs `alchemy deploy` in `apps/twin`.
- Stages: `prod` deploys on each push to `main` and serves `push.tsx.md`. `pr-<number>` deploys on each pull request to its own `workers.dev` URL and is destroyed when the pull request closes.
- State lives on the branch `alchemy-state-store` of this repository ([`@samebase/alchemy-kit/github-state`](https://github.com/samebase/samebase/tree/main/packages/alchemy-kit#github-state-store)). The run writes it with its own `GITHUB_TOKEN`; no Convex token is needed.
- The repository needs three secrets: `ALCHEMY_GITHUB_STATE_KEY` (seals secrets in the state), `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The API token is account-owned, named "push3-twin GitHub Actions (Alchemy deploy)", with Workers Scripts Write on the account plus Zone Read, Workers Routes Write and DNS Write on `tsx.md` only.

## Stack, and where each piece fits

```
packages/protocol/src/   Pure TypeScript, no dependencies (wire.ts alone needs effect)
  controls.ts            Every control and its MIDI number
  parser.ts, events.ts   Raw MIDI → typed PushEvents
  device.ts              Push 3 constants + SysEx builders
  palette.ts, leds.ts    128-color palette; LED state that sends only what changed
  display.ts             960×160 RGB565 frames for the USB display
  controller.ts          PushController: parse, pad/button state, LEDs, take-over, modes
  wire.ts                Effect Schema for every bridge WebSocket message (validated on both ends)
packages/web/src/
  PushLink.ts            The one interface an app uses to reach the Push, with two Layers:
    DirectLink.ts        Web MIDI + WebUSB; display-worker.ts pumps the screen
    BridgeLink.ts        WebSocket to the Node bridge, reconnecting, Schema-decoded Stream
  push.ts                openPush(): the same, as one plain object
packages/node/src/       Node, run directly as TypeScript (Node's type stripping)
  Device.ts              Effect service: supervised "session" per plug-in (scoped MIDI ports + USB display),
                         retry schedules, hot-plug, status as a SubscriptionRef, incoming MIDI as a Stream
  Server.ts              HTTP (optional static app) + WebSocket on 127.0.0.1, as a scoped Layer
  main.ts                push3-bridge: Layer.launch + NodeRuntime.runMain
apps/twin/src/           Browser: Vite + Solid
  engine/        Plain TypeScript hot path: 60 fps loop, screen canvas, Three.js twin (twin.ts)
  engine/twin/   The twin's model: layout.ts (every control in mm, traced from a top-down photo),
                 shapes.ts (rounded slabs, triangle keys, turned knobs), labels.ts (backlit legends
                 and icons as vector paths), textures.ts (surface grain, pad glow)
  demos/*.tsx    One file per tab: onEvent / tick / draw (hot path) + a Solid Panel component.
                 Each tab is an Effect fiber; `activate` acquires device modes in its Scope,
                 e.g. `app.usePressureMode('mpe')`, and they're restored when you switch tabs.
  ui/App.tsx     Solid shell on sidebars-solid: Demos (left), 3D stage (main), Device & Log (right)
```

- **Effect** handles lifecycles, concurrency, retries and validation: the whole bridge, the browser's connection, and each tab's lifetime.
- **Plain TS** handles everything that runs per frame or per MIDI message.
- **Solid** handles the DOM. Its fine-grained signals update only what changed, and it coexists with the imperative Three.js and canvas code.

## Tabs (upper display buttons 1-9, or keys 1-8)

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
| Video | A film on the Push screen beside a live effects deck: speed, pitch, formant, DJ filter, visual effects, framings, subtitles; pads trigger gags |

### Video deck: what runs where

Everything runs in the browser, on the deployed site too. Chrome's `<video>` shows the picture (MKV,
MP4 or WebM with H.264, HEVC including HDR, AV1 or VP9), muted. [Mediabunny](https://mediabunny.dev/)
(MPL-2.0) reads the same file in pieces and decodes its audio, with WASM decoders for AC-3, E-AC-3 and
DTS (LGPL FFmpeg builds, loaded only for files that need them). [Signalsmith
Stretch](https://signalsmith-audio.co.uk/code/stretch/) (MIT) plays that audio in step with the
picture and does speed, pitch and formant. `patches/signalsmith-stretch@1.3.2.patch` fixes a bug in
its buffer mode (silence once the audio is in more than one buffer).

Only on the dev server (`apps/twin/video-middleware.ts`, needs ffmpeg): the native macOS file dialog,
subtitles embedded in the file (dropped or sidecar `.srt`/`.vtt` files work everywhere), and a live
transcode for a picture the browser cannot show.

## Fixing a control mapping

`packages/protocol/src/controls.ts` holds the MIDI number of every control. Its numbers come from Ableton's Push 2 spec plus community Push 3 notes. If the Test tab shows a button as "Unmapped", fix it there. Where a control sits on the 3D model, and what is printed on it, is in `apps/twin/src/engine/twin/layout.ts`.

## Protocol sources

- Official: Ableton's [Push 2 MIDI & Display Interface Manual](https://github.com/Ableton/push-interface). The display format, palette, LED animations and touch strip all work unchanged on Push 3.
- Community (Push 3 extras such as MPE mode `0x1E 02` and the per-pad MPE options): [danielknng/push3-protocol-docs](https://github.com/danielknng/push3-protocol-docs) and [DrivenByMoss](https://github.com/git-moss/DrivenByMoss).
- Only documented commands are sent. Ableton warns that undocumented SysEx can wipe factory calibration.
