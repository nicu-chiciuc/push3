import { defineConfig, type Plugin } from 'vite';
import solid from 'vite-plugin-solid';
import { BRIDGE_PORT, WS_PATH } from '@push3/protocol';

/**
 * The 3D twin (three.js, most of the code) is a chunk of its own that the page imports after it
 * is up. A modulepreload link for it and its imports makes the browser fetch it at once, side by
 * side with the main script, instead of after it.
 */
function preloadTwin(): Plugin {
  return {
    name: 'preload-twin',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return [];
        const entry = Object.values(bundle).find((c) => c.type === 'chunk' && c.isEntry);
        const twin = Object.values(bundle).find((c) => c.type === 'chunk' && c.facadeModuleId?.endsWith('/src/engine/twin.ts'));
        if (twin?.type !== 'chunk') throw new Error('preload-twin: no chunk for src/engine/twin.ts');
        const skip = new Set(entry?.type === 'chunk' ? [entry.fileName, ...entry.imports] : []);
        const files = new Set<string>();
        const add = (name: string) => {
          const c = bundle[name];
          if (skip.has(name) || files.has(name) || c?.type !== 'chunk') return;
          files.add(name);
          c.imports.forEach(add);
        };
        add(twin.fileName);
        return [...files].map((f) => ({ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: '', href: `/${f}` }, injectTo: 'head' as const }));
      },
    },
  };
}

export default defineConfig({
  plugins: [solid(), preloadTwin()],
  server: {
    port: 5173,
    // In bridge mode the page talks to the Node bridge over /ws; in dev, Vite forwards it.
    proxy: { [WS_PATH]: { target: `ws://127.0.0.1:${BRIDGE_PORT}`, ws: true } },
  },
  // The DTS decoder (loaded only for DTS films) is the largest chunk
  build: { outDir: 'dist', target: 'es2023', chunkSizeWarningLimit: 1700 },
});
