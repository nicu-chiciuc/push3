// `pnpm dev`: the bridge (restarts on change) + the twin's Vite dev server, in one terminal.
import { spawn } from 'node:child_process';

const procs = [
  spawn(process.execPath, ['--watch-path=packages/node/src', '--watch-path=packages/protocol/src', 'packages/node/src/main.ts'], { stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit', cwd: 'apps/twin' }),
];
const stop = () => { for (const p of procs) if (p.exitCode === null) p.kill('SIGINT'); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => { stop(); process.exitCode ||= code ?? 0; });
