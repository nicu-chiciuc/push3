# Push 3 Twin

A 3D digital twin and demo suite for a USB-tethered **Ableton Push 3** (controller version). No Ableton Live needed and no hacking: it talks to the Push over plain MIDI plus the documented USB display protocol.

## Run it

```bash
npm install
npm start            # → http://localhost:7333 (open in Chrome)
```

Quit Ableton Live first. Live grabs the MIDI ports, and its background `Push3` process holds the screen. Plug the Push's power supply in for full LED brightness. On USB power alone the LEDs are capped very dim.

When no browser is connected, the Push screen shows "OPEN LOCALHOST:7333". `Ctrl+C` turns the LEDs off and hands the Push back to Live mode.

## How it works

```
Browser (Three.js twin, demos, screen canvas)
   ⇅ WebSocket (JSON MIDI + binary RGB565 frames)
server.mjs: Node bridge on 127.0.0.1:7333
   ⇅ CoreMIDI (@julusian/midi): Push 3 Live / User ports
   ⇅ libusb (usb): display interface 0, bulk endpoint 0x01
Ableton Push 3 (USB 0x2982:0x1969)
```

- **Push → browser:** every MIDI message is relayed raw. `protocol.js` turns it into events (pad down/up/pressure/roll/slide, button, encoder delta, touch, strip).
- **Browser → Push LEDs:** demos set colors freely every frame. `leds.js` sends only what changed. The app rewrites the 128-entry color palette at startup (`palette.js`), so it knows exactly what each LED shows.
- **Browser → Push screen:** the 960×160 display is a normal `<canvas>`. It's converted to RGB565 and streamed at about 30 fps. The bridge pads and XOR-masks each frame and keeps resending it, because the screen blanks after 2 s without frames.
- **3D twin:** mirrors all of the above. You can click, drag or turn its controls, and those virtual events go through the same pipeline as hardware events.

## Tabs (upper display buttons 1–8, or keys 1–8)

| Tab | Shows off |
|---|---|
| Explore | Every control mirrored. Velocity-colored pads, knob gauges on the screen |
| Test | Coverage checklist: every pad/button/knob you use turns green. Palette sweep, screen test pattern |
| Paint | Pads as an 8×8 canvas; knobs = hue/sat/brightness |
| Expression | Channel AT / Poly AT / MPE modes, per-finger pressure + roll + slide, Web Audio synth |
| Ripple | Light show at hundreds of LED messages/s, or the Push's own hardware pulse/blink animation |
| CSS Knobs | 8 knobs → 8 CSS custom properties on a live card, presets on pads, generated CSS |
| Screen | Scrolling text, plasma, dropped images, clock on the Push display; pads mirror it |
| Snake | A game on the pad grid (arrows, jog wheel or pads to steer) |

## Files

- `server.mjs`: the bridge (MIDI, USB display, static server, WebSocket with a localhost-only origin check)
- `lib/font5x7.mjs`: bitmap font for the idle screen
- `public/js/layout.js`: **physical layout + MIDI numbers.** Fix mappings here.
- `public/js/protocol.js`: MIDI parser and SysEx builders
- `public/js/twin.js`: Three.js model
- `public/js/demos/*.js`: one file per tab. Each has `onEvent`, `tick`, `draw` (screen) and `panel` (side UI).

## Protocol sources

- Official: Ableton's [Push 2 MIDI & Display Interface Manual](https://github.com/Ableton/push-interface). The display format, palette, LED animations and touch strip all work unchanged on Push 3.
- Community (Push 3 extras such as MPE mode `0x1E 02` and the per-pad MPE options): [danielknng/push3-protocol-docs](https://github.com/danielknng/push3-protocol-docs) and [DrivenByMoss](https://github.com/git-moss/DrivenByMoss).
- Only documented commands are sent. Ableton warns that undocumented SysEx can wipe factory calibration.
