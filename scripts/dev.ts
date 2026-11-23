// `npm run dev`: the bridge (restarts on change) + Vite with hot reload, in one terminal.
import { spawn } from 'node:child_process';

const procs = [
  spawn(process.execPath, ['--watch-path=src/bridge', '--watch-path=src/shared', 'src/bridge/main.ts'], { stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' }),
];
const stop = () => { for (const p of procs) if (p.exitCode === null) p.kill('SIGINT'); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => { stop(); process.exitCode ||= code ?? 0; });
