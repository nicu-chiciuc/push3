// The generic half of a Push app, independent of the transport: it turns raw MIDI into typed
// events, keeps pad/button/knob state, owns the LED state, and knows how to take the device over
// (User Mode, palette, pressure mode, touch strip). Give it anything that can send MIDI.
import { Cmd, STRIP_HOST_DRAWS, STRIP_PUSH_DRAWS, type Bytes, type MidiPort, type PressureMode } from './device.ts';
import type { PadState, PushEvent } from './events.ts';
import { Leds } from './leds.ts';
import { paletteMessages } from './palette.ts';
import { MidiParser } from './parser.ts';
import { sessionStart } from './session.ts';

export interface MidiSink {
  sendMidi(batch: ReadonlyArray<Bytes>, port?: MidiPort): void;
}

export class PushController {
  readonly leds = new Leds();
  /** Pads that were touched at least once, by note. */
  readonly pads = new Map<number, PadState>();
  /** Ids of the buttons held now. */
  readonly held = new Set<string>();
  /** Ids of the knobs (and 'strip') touched now. */
  readonly touched = new Set<string>();
  /** Touch strip position, 0 (bottom) to 1 (top). */
  strip = 0.5;
  pressureMode: PressureMode = 'poly';
  /** true: the app draws the touch strip LEDs (leds.setStrip). false: the Push draws a point. */
  stripHost = false;
  /** MIDI messages sent so far. */
  sent = 0;

  private readonly parser = new MidiParser();
  private readonly sink: MidiSink;

  constructor(sink: MidiSink) {
    this.sink = sink;
  }

  /** Raw MIDI from the Push → a typed event. Does not change any state: pass it to `apply`. */
  parse(data: ReadonlyArray<number>): PushEvent {
    return this.parser.parse(data);
  }

  /** Update pad/button/knob state from an event, from the hardware or a virtual one. */
  apply(ev: PushEvent) {
    switch (ev.type) {
      case 'pad': {
        const p = this.pads.get(ev.note) ?? { down: false, velocity: 0, pressure: 0, x: 0, y: 0.5, ch: 0 };
        if (ev.action === 'down') Object.assign(p, { down: true, velocity: ev.velocity, pressure: ev.velocity / 127, x: 0, y: 0.5, ch: ev.ch });
        else if (ev.action === 'up') Object.assign(p, { down: false, pressure: 0 });
        else if (ev.action === 'pressure') p.pressure = ev.pressure;
        else if (ev.action === 'bend') p.x = ev.x;
        else p.y = ev.y;
        this.pads.set(ev.note, p);
        break;
      }
      case 'channelPressure': for (const p of this.pads.values()) if (p.down) p.pressure = ev.pressure; break;
      case 'button': ev.pressed ? this.held.add(ev.id) : this.held.delete(ev.id); break;
      case 'touch': ev.touched ? this.touched.add(ev.id) : this.touched.delete(ev.id); break;
      case 'strip': this.strip = ev.value; break;
    }
  }

  /** Send MIDI to the User port (or another port). */
  send(msgs: ReadonlyArray<Bytes>, port?: MidiPort) {
    if (!msgs.length) return;
    this.sink.sendMidi(msgs, port);
    this.sent += msgs.length;
  }

  /** Send the LEDs that changed since the last flush. Call once per frame or after a batch of changes. */
  flush() {
    this.send(this.leds.flush(this.stripHost));
  }

  /**
   * Take the device over: User Mode, full brightness, our palette, the current pressure and strip
   * modes, and every LED again. Call it each time the Push (re)connects, since Live or another
   * app may have changed it in between.
   */
  init() {
    for (const [port, bytes] of sessionStart()) this.sink.sendMidi([bytes], port);
    this.send([...paletteMessages(), Cmd.pressureMode(this.pressureMode), Cmd.stripConfig(this.stripHost ? STRIP_HOST_DRAWS : STRIP_PUSH_DRAWS)]);
    if (this.pressureMode === 'mpe') this.send([Cmd.mpeParam(0x08, 0x02)]);
    this.leds.invalidate();
    this.flush();
  }

  /** channel: one pressure for all pads · poly: pressure per pad · mpe: pressure, roll and slide per finger. */
  setPressureMode(mode: PressureMode) {
    this.pressureMode = mode;
    this.send([Cmd.pressureMode(mode)]);
    if (mode === 'mpe') this.send([Cmd.mpeParam(0x08, 0x02)]); // per-pad pitch bend on
  }

  setStripHost(on: boolean) {
    this.stripHost = on;
    this.send([Cmd.stripConfig(on ? STRIP_HOST_DRAWS : STRIP_PUSH_DRAWS)]);
    if (on) this.leds.stripDirty = true;
  }
}
