# @push3/web

Drive an Ableton Push 3 from a web page. Two ways to reach the device:

- **Direct** (default): Web MIDI for pads, knobs and LEDs, WebUSB for the screen. Chrome or Edge, no install.
  The first `connect()` must run in a click; Chrome then remembers the permission for the site.
- **Bridge**: a WebSocket to `push3-bridge` (`@push3/node`) on this machine. Any browser, pages on localhost only.

Quit Ableton Live first: it holds the MIDI ports and the screen.

## Plain TypeScript

```ts
import { openPush } from '@push3/web';

const push = await openPush(); // or openPush({ link: 'bridge' })
connectButton.onclick = () => push.connect();

push.onStatus((s) => console.log('midi', s.midi, 'screen', s.display));
push.onEvent((ev) => {
  if (ev.type === 'pad' && ev.action === 'down') {
    push.controller.leds.pad(ev.note, [255, 80, 0]); // any RGB, mapped to the palette
    push.flush();
  }
  if (ev.type === 'encoder') console.log(ev.id, ev.delta); // 'e1'..'e8', 'volume', 'tempo', 'jog'
});

// The screen: any canvas, image or video frame, scaled to 960×160. Up to about 60 fps.
const tick = () => { push.sendImage(myCanvas); requestAnimationFrame(tick); };
tick();
```

`push.controller` also keeps state (`pads`, `held`, `touched`, `strip`) and sets modes:
`setPressureMode('mpe')` gives each finger its own channel with pressure, roll (`bend`) and slide events.
See `@push3/protocol` for the event types and the control map.

## Effect

`PushLink` is an Effect service; provide `DirectLink()` or `BridgeLink({ url })`.

```ts
import { Effect, Layer, Stream } from 'effect';
import { DirectLink, PushLink } from '@push3/web';

const program = Effect.gen(function* () {
  const link = yield* PushLink;
  yield* link.midi.pipe(Stream.runForEach((m) => Effect.log(m.port, m.data)));
});
Effect.runFork(program.pipe(Effect.provide(DirectLink())));
```

The package exports TypeScript source; use it from a bundler that compiles TypeScript (Vite does).
