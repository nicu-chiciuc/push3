// The entry point: load the engine first, then the modules that read from it when they load
// (upstream/src/wasm/engine.ts asks the engine for its catalogue at import time).
import type * as Api from './api.ts';

export * from './settings.ts';

let loading: Promise<Api.Chimera> | null = null;

export const loadChimera: typeof Api.loadChimera = () => {
  if (!loading) {
    loading = (async () => {
      const { initChimera } = await import('../upstream/src/wasm/chimera.ts');
      await initChimera();
      const { createChimera } = await import('./voice.ts');
      return createChimera();
    })();
    loading.catch(() => (loading = null)); // a failed load may be retried
  }
  return loading;
};
