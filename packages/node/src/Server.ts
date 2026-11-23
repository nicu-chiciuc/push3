// HTTP + WebSocket (/ws) on 127.0.0.1, as a scoped Effect layer. Messages are validated with the
// shared Schema in both directions. Optionally serves a built web app (e.g. apps/twin/dist).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Effect, Layer, Option, Schema, Stream, SubscriptionRef } from 'effect';
import { WebSocketServer, WebSocket } from 'ws';
import { BRIDGE_PORT, DISPLAY_FRAME_BYTES, WS_PATH } from '@push3/protocol';
import { ClientMessageJson, ServerMessageJson, type ServerMessage } from '@push3/protocol/wire';
import { Device } from './Device.ts';

export interface ServerOptions {
  /** A built web app to serve on http://localhost:7333 (index.html + assets). */
  readonly staticDir?: string;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2',
};
const RUNNING = `<!doctype html><meta charset="utf-8"><title>Push 3 bridge</title>
<body style="font:15px system-ui;background:#0b0d11;color:#e7ebf0;padding:40px">
<h1>The Push 3 bridge is running</h1>
<p>Pages on localhost connect to <code>ws://127.0.0.1:${BRIDGE_PORT}${WS_PATH}</code>. To serve an app here, start the bridge with
<code>--static &lt;dir&gt;</code>. For the twin: <code>pnpm start</code>, or <code>pnpm dev</code> and open
<a style="color:#46d7ff" href="http://localhost:5173">localhost:5173</a>.</p>`;

function staticHandler(dir: string | undefined) {
  const root = dir ? path.resolve(dir) : null;
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    if (!root) return void res.writeHead(rel === '/index.html' ? 200 : 404, { 'content-type': TYPES['.html']! }).end(RUNNING);
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root + path.sep)) return void res.writeHead(404).end('not found');
    fs.readFile(file, (err, data) => {
      if (err) {
        if (rel === '/index.html') return void res.writeHead(200, { 'content-type': TYPES['.html']! }).end(RUNNING);
        return void res.writeHead(404).end('not found');
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    });
  };
}

// Only pages served from this machine (the bridge itself or the Vite dev server) may drive the Push.
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export const BridgeServer = (options: ServerOptions = {}) => Layer.effectDiscard(
  Effect.gen(function* () {
    const device = yield* Device;
    const encode = Schema.encodeSync(ServerMessageJson);
    const decode = Schema.decodeUnknownOption(ClientMessageJson);
    const clients = new Set<WebSocket>();
    const broadcast = (msg: ServerMessage) => {
      const json = encode(msg);
      for (const c of clients) if (c.readyState === WebSocket.OPEN) c.send(json);
    };

    const server = yield* Effect.acquireRelease(
      Effect.callback<http.Server, Error>((resume) => {
        const srv = http.createServer(staticHandler(options.staticDir));
        srv.once('error', (e) => resume(Effect.fail(e)));
        srv.listen(BRIDGE_PORT, '127.0.0.1', () => resume(Effect.succeed(srv)));
      }),
      (srv) => Effect.callback<void>((resume) => { srv.closeAllConnections(); srv.close(() => resume(Effect.void)); }),
    ).pipe(Effect.orDie);

    const wss = yield* Effect.acquireRelease(
      Effect.sync(() => new WebSocketServer({
        server,
        path: WS_PATH,
        maxPayload: 1 << 20,
        verifyClient: ({ origin }: { origin?: string }) => !origin || LOCAL_ORIGIN.test(origin),
      })),
      (w) => Effect.sync(() => { for (const c of w.clients) c.terminate(); w.close(); }),
    );

    wss.on('connection', (ws) => {
      clients.add(ws);
      device.setViewers(clients.size);
      ws.send(encode({ _tag: 'Status', ...SubscriptionRef.getUnsafe(device.status) }));
      Effect.runFork(Effect.logInfo(`Browser connected (${clients.size})`));

      ws.on('message', (data, isBinary) => {
        const buf = data as Buffer;
        if (isBinary) {
          if (buf.length === DISPLAY_FRAME_BYTES) device.setFrame(new Uint8Array(buf.buffer, buf.byteOffset, buf.length));
          return;
        }
        const msg = decode(buf.toString());
        if (Option.isNone(msg)) return;
        switch (msg.value._tag) {
          case 'SendMidi': return device.sendMidi(msg.value.port, msg.value.batch);
          case 'Reconnect': return void Effect.runFork(device.reconnect);
        }
      });
      ws.on('close', () => {
        clients.delete(ws);
        device.setViewers(clients.size);
        Effect.runFork(Effect.logInfo(`Browser disconnected (${clients.size})`));
      });
    });

    // Push → every browser
    yield* device.incoming.pipe(
      Stream.runForEach((m) => Effect.sync(() => broadcast({ _tag: 'Midi', port: m.port, data: m.data }))),
      Effect.forkScoped,
    );
    yield* SubscriptionRef.changes(device.status).pipe(
      Stream.runForEach((s) => Effect.sync(() => broadcast({ _tag: 'Status', ...s }))),
      Effect.forkScoped,
    );

    yield* Effect.logInfo(`Push 3 bridge → http://localhost:${BRIDGE_PORT}${options.staticDir ? ` (serving ${options.staticDir})` : ''}`);
  }),
);
