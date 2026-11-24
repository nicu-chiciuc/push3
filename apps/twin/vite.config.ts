import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { BRIDGE_PORT, WS_PATH } from '@push3/protocol';
import { videoBridgePlugin } from './video-middleware.ts';

export default defineConfig({
  plugins: [solid(), videoBridgePlugin()],
  server: {
    port: 5173,
    // In bridge mode the page talks to the Node bridge over /ws; in dev, Vite forwards it.
    proxy: { [WS_PATH]: { target: `ws://127.0.0.1:${BRIDGE_PORT}`, ws: true } },
  },
  build: { outDir: 'dist', target: 'es2023', chunkSizeWarningLimit: 1200 }, // three.js is most of the bundle
});
