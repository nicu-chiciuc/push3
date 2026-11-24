// `node scripts/sync-chimera.ts [<chimera checkout>] [--build]`: copy the CHIMERA modules that the
// Chimera tab needs into packages/chimera/upstream, unchanged, and record where they came from in
// packages/chimera/upstream/SOURCE.json.
//
// The checkout defaults to ~/dev/chimera-vocal-synth (or $CHIMERA_DIR). The engine (chimera.wasm) is
// copied from the checkout's own build (`bun run wasm` there). With --build, this script builds it
// with cargo into a temporary target directory instead, so the checkout itself does not change.
// Our own glue lives in packages/chimera/src and is never touched here.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** What the tab uses (the engine, the worklet, the 2D head) and everything those files import.
 *  Not AudioEngine: packages/chimera/src/engine.ts loads our worklet (src/worklet.ts) instead. */
const FILES = [
  'LICENSE',
  'src/wasm/chimera.ts',
  'src/wasm/engine.ts',
  'src/wasm/types.ts',
  'src/wasm/wasm.d.ts',
  'src/wasm/wire.ts',
  'src/worklet/processor.ts',
  'src/worklet/protocol.ts',
  'src/worklet/telemetry.ts',
  'src/ui/analysis.ts',
  'src/ui/body.ts',
  'src/ui/colors.ts',
  'src/ui/creatureVisuals.ts',
  'src/ui/render/anatomy.ts',
  'src/ui/render/expression.ts',
  'src/ui/render/geom.ts',
  'src/ui/render/profile.ts',
  'src/ui/render/readouts.ts',
  'src/ui/render/vector.ts',
];
const WASM = 'src/wasm/chimera.wasm';
const UPSTREAM = 'https://github.com/jamesondh/chimera-vocal-synth';

const args = process.argv.slice(2);
const build = args.includes('--build');
const from = resolve(args.find((a) => !a.startsWith('--')) ?? process.env.CHIMERA_DIR ?? join(homedir(), 'dev/chimera-vocal-synth'));
const to = resolve(import.meta.dirname, '../packages/chimera/upstream');
const git = (...a: string[]) => execFileSync('git', ['-C', from, ...a], { encoding: 'utf8' }).trim();

if (!existsSync(join(from, 'crates/chimera-wasm'))) throw new Error(`${from} is not a CHIMERA checkout (no crates/chimera-wasm)`);
const commit = git('rev-parse', 'HEAD');
// Local changes in the copied files or in the Rust engine make the copy differ from `commit`.
const dirty = git('status', '--porcelain', '--', ...FILES, 'crates', 'Cargo.toml', 'Cargo.lock');

let wasmFrom = join(from, WASM);
const target = build ? mkdtempSync(join(tmpdir(), 'chimera-target-')) : null;
if (target) {
  execFileSync('cargo', ['build', '-p', 'chimera-wasm', '--release', '--target', 'wasm32-unknown-unknown', '--target-dir', target], { cwd: from, stdio: 'inherit' });
  wasmFrom = join(target, 'wasm32-unknown-unknown/release/chimera_wasm.wasm');
} else if (!existsSync(wasmFrom)) {
  throw new Error(`${wasmFrom} is missing: run \`bun run wasm\` in ${from}, or pass --build`);
}

rmSync(to, { recursive: true, force: true });
for (const f of FILES) {
  mkdirSync(dirname(join(to, f)), { recursive: true });
  cpSync(join(from, f), join(to, f));
}
cpSync(wasmFrom, join(to, WASM));
const wasm = readFileSync(join(to, WASM));
if (target) rmSync(target, { recursive: true, force: true });

const source = {
  repository: UPSTREAM,
  commit,
  commitDate: git('show', '-s', '--format=%cI', commit),
  localChanges: dirty ? dirty.split('\n') : [],
  wasm: { built: build ? 'by this script (cargo, --release, wasm32-unknown-unknown)' : `copied from the checkout's ${WASM}`, bytes: wasm.length, sha256: createHash('sha256').update(wasm).digest('hex') },
  files: FILES,
};
writeFileSync(join(to, 'SOURCE.json'), `${JSON.stringify(source, null, 2)}\n`);
console.log(`Copied ${FILES.length + 1} files from ${UPSTREAM} at ${commit.slice(0, 7)}${dirty ? ' (with local changes)' : ''} to ${to}`);
