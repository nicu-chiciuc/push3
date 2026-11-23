import { render } from 'solid-js/web';
import { Effect, Layer, Stream, SubscriptionRef } from 'effect';
import { Engine } from './engine/engine.ts';
import { BridgeClient } from './services/BridgeClient.ts';
import { App } from './ui/App.tsx';
import { explore } from './demos/explore.tsx';
import { test } from './demos/test.tsx';
import { paint } from './demos/paint.tsx';
import { expression } from './demos/expression.tsx';
import { ripple } from './demos/ripple.tsx';
import { cssKnobs } from './demos/css-knobs.tsx';
import { studio } from './demos/studio.tsx';
import { snake } from './demos/snake.tsx';
import './styles.css';

const engine = new Engine([explore, test, paint, expression, ripple, cssKnobs, studio, snake]);
Object.assign(window, { push3: engine }); // handy for poking at things from DevTools

// The Effect side: a supervised connection to the bridge, piped into the engine.
const Wiring = Layer.effectDiscard(
  Effect.gen(function* () {
    const client = yield* BridgeClient;
    engine.attach(client);
    yield* client.midi.pipe(
      Stream.runForEach((m) => Effect.sync(() => engine.onMidi(m.port, m.data))),
      Effect.forkScoped,
    );
    yield* SubscriptionRef.changes(client.status).pipe(
      Stream.runForEach((s) => Effect.sync(() => engine.onStatus(s))),
      Effect.forkScoped,
    );
  }),
).pipe(Layer.provide(BridgeClient.layer));

render(() => <App engine={engine} />, document.getElementById('root')!);
Effect.runFork(Layer.launch(Wiring));
