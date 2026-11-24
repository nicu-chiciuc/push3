import { render } from 'solid-js/web';
import { Effect, Layer, Stream, SubscriptionRef } from 'effect';
import { Engine } from './engine/engine.ts';
import { BridgeLink, DirectLink, PushLink, sameOriginBridgeUrl, type LinkKind } from '@push3/web';
import { App } from './ui/App.tsx';
import { explore } from './demos/explore.tsx';
import { test } from './demos/test.tsx';
import { paint } from './demos/paint.tsx';
import { expression } from './demos/expression.tsx';
import { chimera } from './demos/chimera.tsx';
import { ripple } from './demos/ripple.tsx';
import { cssKnobs } from './demos/css-knobs.tsx';
import { studio } from './demos/studio.tsx';
import { snake } from './demos/snake.tsx';
import { blocks } from './demos/blocks.tsx';
import { videoDeck } from './demos/video.tsx';
import './styles.css';

// The first 8 tabs sit on the 8 upper display buttons. Screen and CSS Knobs (both are driven from the
// page) and Test (a diagnostic tool, not a show) come after them and are reached from the page only:
// the tab list, or keys 9 and 0 for the ninth and tenth.
const engine = new Engine([chimera, videoDeck, explore, paint, expression, ripple, blocks, snake, studio, cssKnobs, test]);
Object.assign(window, { push3: engine }); // handy for poking at things from DevTools

// Which transport: ?link=bridge|direct, else the local bridge on localhost and direct everywhere else.
const requested = new URLSearchParams(location.search).get('link');
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
const kind: LinkKind = requested === 'bridge' || requested === 'direct' ? requested : local ? 'bridge' : 'direct';

// The Effect side: one PushLink (swapped by Layer), piped into the engine.
const Wiring = Layer.effectDiscard(
  Effect.gen(function* () {
    const link = yield* PushLink;
    engine.attach(link);
    yield* link.midi.pipe(Stream.runForEach((m) => Effect.sync(() => engine.onMidi(m.port, m.data))), Effect.forkScoped);
    yield* SubscriptionRef.changes(link.status).pipe(Stream.runForEach((s) => Effect.sync(() => engine.onStatus(s))), Effect.forkScoped);
  }),
).pipe(Layer.provide(kind === 'direct' ? DirectLink() : BridgeLink({ url: sameOriginBridgeUrl() })));

render(() => <App engine={engine} />, document.getElementById('root')!);
Effect.runFork(Layer.launch(Wiring));
