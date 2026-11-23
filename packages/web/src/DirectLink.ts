// PushLink straight from the browser: Web MIDI for pads/knobs/LEDs, WebUSB (in a worker)
// for the screen. No install; Chrome/Edge only. Permissions are asked once (a click on
// "Connect"), then remembered per site, so later visits reconnect automatically.
/// <reference types="w3c-web-usb" />
import { Effect, Layer, PubSub, Stream, SubscriptionRef } from 'effect';
import { sessionEnd, sessionStart, USB_PRODUCT_ID, USB_VENDOR_ID, type Bytes, type MidiPort } from '@push3/protocol';
import { PushLink, type IncomingMidi, type LinkStatus } from './PushLink.ts';
import type { FromWorker, ToWorker } from './display-worker.ts';

export const DirectLink = () => Layer.effect(PushLink, makeDirectLink());

export const directSupport = () => ({
  midi: typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator,
  usb: typeof navigator !== 'undefined' && 'usb' in navigator,
});

const PORT_PATTERN: Record<MidiPort, RegExp> = { live: /Push 3 Live/i, user: /Push 3 User/i, external: /Push 3 External/i };
const portOf = (name: string | null) => (Object.keys(PORT_PATTERN) as Array<MidiPort>).find((p) => PORT_PATTERN[p].test(name ?? ''));

/** Which Push port is which. macOS names them; Windows/Linux may not ("MIDIIN2 (Ableton Push 3)"),
 *  so fall back to enumeration order: Live, User, External. (Fallback untested on hardware.) */
function assignPorts<P extends MIDIPort>(ports: Iterable<P>): Partial<Record<MidiPort, P>> {
  const list = [...ports].filter((p) => p.state === 'connected');
  const named: Partial<Record<MidiPort, P>> = {};
  for (const p of list) { const k = portOf(p.name); if (k) named[k] = p; }
  if (named.live && named.user) return named;
  const push = list.filter((p) => /push\s*3/i.test(p.name ?? ''));
  return push.length >= 2 ? { live: push[0]!, user: push[1]!, ...(push[2] ? { external: push[2] } : {}) } : named;
}

function makeDirectLink() {
  return Effect.gen(function* () {
    const support = directSupport();
    const status = yield* SubscriptionRef.make<LinkStatus>({ link: support.midi && support.usb, midi: false, display: false });
    const incoming = yield* PubSub.unbounded<IncomingMidi>();
    const setStatus = (patch: Partial<LinkStatus>) => Effect.runSync(SubscriptionRef.update(status, (s) => ({ ...s, ...patch })));

    // ── MIDI ──
    let access: MIDIAccess | null = null;
    const outputs: Partial<Record<MidiPort, MIDIOutput>> = {};
    const send = (port: MidiPort, bytes: Bytes) => { try { outputs[port]?.send(bytes as Array<number>); } catch { /* unplugged mid-send */ } };

    /** (Re)bind to whatever Push ports exist right now; called on connect and on every hot-plug change. */
    const bind = (acc: MIDIAccess) => {
      const had = !!outputs.user;
      for (const k of Object.keys(outputs) as Array<MidiPort>) delete outputs[k];
      Object.assign(outputs, assignPorts(acc.outputs.values()));
      for (const input of acc.inputs.values()) input.onmidimessage = null;
      for (const [p, input] of Object.entries(assignPorts(acc.inputs.values())) as Array<[MidiPort, MIDIInput]>) {
        // drop active sensing + clock, like the bridge does
        input.onmidimessage = (e) => { const d = e.data; if (d && d[0] !== 0xfe && d[0] !== 0xf8) PubSub.publishUnsafe(incoming, { port: p, data: [...d] }); };
      }
      const has = !!outputs.user && !!outputs.live;
      if (has && !had) for (const [port, bytes] of sessionStart()) send(port, bytes);
      setStatus({ midi: has });
    };

    const connectMidi = async () => {
      if (!support.midi || access) return;
      access = await navigator.requestMIDIAccess({ sysex: true });
      access.onstatechange = () => access && bind(access);
      bind(access);
    };

    // ── Screen (WebUSB in a worker) ──
    const worker = yield* Effect.acquireRelease(
      Effect.sync(() => new Worker(new URL('./display-worker.ts', import.meta.url), { type: 'module' })),
      (w) => Effect.sync(() => { w.postMessage({ type: 'close' } satisfies ToWorker); setTimeout(() => w.terminate(), 500); }),
    );
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      setStatus({ display: e.data.type === 'open' });
      if (e.data.type === 'closed') console.info(`[push3] screen: ${e.data.reason}${e.data.retrying ? ' (retrying)' : ''}`);
    };
    // The worker opens any Push this site was granted, now or whenever one is plugged in.
    const openScreen = () => worker.postMessage({ type: 'open' } satisfies ToWorker);
    if (support.usb) openScreen();

    // Returning visitor: reconnect without prompts if permissions were granted before.
    yield* Effect.promise(async () => {
      try {
        const midi = await navigator.permissions.query({ name: 'midi', sysex: true } as unknown as PermissionDescriptor);
        if (midi.state === 'granted') await connectMidi();
      } catch { /* permissions API shape differs; user can click Connect */ }
    });

    // Leaving the page (or the app shutting down): dark LEDs, Push back to Live.
    const goodbye = () => { if (outputs.user) for (const [port, bytes] of sessionEnd()) send(port, bytes); };
    yield* Effect.acquireRelease(
      Effect.sync(() => addEventListener('pagehide', goodbye)),
      () => Effect.sync(() => { removeEventListener('pagehide', goodbye); goodbye(); }),
    );

    return PushLink.of({
      kind: 'direct',
      status,
      midi: Stream.fromPubSub(incoming),
      sendMidi: (batch, port = 'user') => { for (const bytes of batch) send(port, bytes); },
      sendFrame: (pixels) => {
        if (!SubscriptionRef.getUnsafe(status).display) return;
        const copy = pixels.slice().buffer; // transfer a copy; the engine reuses its buffer
        worker.postMessage({ type: 'frame', pixels: copy } satisfies ToWorker, [copy]);
      },
      connect: () => {
        // Must run inside the click: the USB chooser needs the user gesture, so ask for it first.
        const usb = support.usb
          ? navigator.usb.requestDevice({ filters: [{ vendorId: USB_VENDOR_ID, productId: USB_PRODUCT_ID }] }).then(openScreen, (e) => console.info('[push3] USB:', e.message))
          : Promise.resolve();
        // Chrome rejects a denied prompt with NotAllowedError (older docs say SecurityError).
        void usb.then(connectMidi).catch((e) => console.warn('[push3] MIDI permission:', e?.name, e?.message));
      },
    });
  });
}
