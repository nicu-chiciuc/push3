# @push3/protocol

The Ableton Push 3 as data. Pure TypeScript with no dependencies: runs in browsers, workers and Node.

- `controls.ts`: every pad, button and knob with its MIDI number (`BUTTONS`, `ENCODERS`, `padNote`, `padPos`).
- `parser.ts`: `MidiParser` turns raw MIDI into typed `PushEvent`s (pads with velocity, pressure, MPE roll and slide; buttons; knob turns and touches; touch strip).
- `device.ts`: USB ids, display size, and SysEx builders (`Cmd.midiMode`, `Cmd.pressureMode`, `Cmd.stripConfig`, ...).
- `palette.ts`, `leds.ts`: a 128-color palette and `Leds`, which keeps LED state and sends only what changed.
- `display.ts`: `encodeFrame` for the USB display (960×160 RGB565), `rgbaToRgb565` for canvas pixels.
- `controller.ts`: `PushController`, the transport-agnostic core of a Push app. Give it anything with `sendMidi`.
- `@push3/protocol/wire`: the Effect Schema of the bridge's WebSocket messages (needs `effect`).

Sources: Ableton's [Push 2 MIDI & Display Interface Manual](https://github.com/Ableton/push-interface) (display, palette, LED animations and touch strip are unchanged on Push 3), plus community Push 3 notes ([push3-protocol-docs](https://github.com/danielknng/push3-protocol-docs), [DrivenByMoss](https://github.com/git-moss/DrivenByMoss)). Only documented commands are here: Ableton warns that undocumented SysEx can wipe factory calibration.
