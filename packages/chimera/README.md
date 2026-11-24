# @push3/chimera

[CHIMERA](https://github.com/jamesondh/chimera-vocal-synth) by Jameson Hodge, MIT licensed ([LICENSE](LICENSE)): a physical model of the human voice. Lungs, vocal folds and a 3D airway are computed sample by sample by a Rust engine, compiled to WASM and run in an AudioWorklet, and a 2D head (a cut through the middle of the head) shows them. The Chimera tab of the twin plays it from the Push.

This package is a pinned copy of the parts of CHIMERA the tab needs, plus a small API of our own.

| Folder | What it is |
|---|---|
| [`upstream/`](upstream) | CHIMERA's files, unchanged: the engine glue (`src/wasm`), the worklet processor, the acoustic model (`src/ui/analysis.ts`) and the 2D head (`src/ui/render`), with everything they import. [`upstream/SOURCE.json`](upstream/SOURCE.json) records the commit and the WASM build. |
| [`upstream/src/wasm/chimera.wasm`](upstream/src/wasm/chimera.wasm) | The engine, built from that commit (`cargo build -p chimera-wasm --release --target wasm32-unknown-unknown`). It is committed because this repository's CI has no Rust. |
| [`src/api.ts`](src/api.ts) | What an app sees: `loadChimera()`, the `Chimera` voice and its `Head`. |
| [`src/worklet.ts`](src/worklet.ts) | Our AudioWorklet: CHIMERA's processor, unchanged, with the glide that CHIMERA's plugin puts on pressure and brightness (12 ms, a step every 64 samples). A pad sends them in 7-bit steps many times a second; set straight on the engine, each step changes the glottis at once and the voice crackles. `src/worklet-capture.ts` catches the upstream class so the glide can extend it. |
| [`src/engine.ts`](src/engine.ts) | The main thread's side of that worklet, in place of CHIMERA's `AudioEngine` (which loads CHIMERA's own worklet). |
| [`src/voice.ts`](src/voice.ts) | Our glue: one voice played by hand (pitch, breath and the other source settings, the gate, the articulators, the mouth as a blend of calibrated vowels, the body size), and CHIMERA's 2D head drawn off screen, as its `AnatomyView` does it, framed to show the whole head. |

`src/api.ts` is the package's `types` entry. So the app type-checks only that file, and `upstream/` is checked here, with CHIMERA's own compiler options (`pnpm typecheck`).

## Copy it again

Do not edit the files in `upstream/`. Put changes in `src/` instead, so that a new copy stays a plain copy:

```bash
node scripts/sync-chimera.ts --build                 # from ~/dev/chimera-vocal-synth, building the WASM with cargo
node scripts/sync-chimera.ts ../chimera-vocal-synth  # another checkout; copies its own src/wasm/chimera.wasm
```

`--build` needs Rust with the `wasm32-unknown-unknown` target. It builds into a temporary folder, so the CHIMERA checkout does not change. If a new CHIMERA file imports another file, add it to `FILES` in [`scripts/sync-chimera.ts`](../../scripts/sync-chimera.ts).
