// Starts making the desk texture as early as possible: main.tsx imports this module before
// anything else, so the pixels are made in workers while the page and three.js still load.
import { DESK_MM, woodRows, woodSize } from './wood.ts';

let job: Promise<ImageData> | null = null;

/** The walnut pixels, made by up to 4 workers side by side (each a band of rows), or here if a
 *  worker cannot start. Started once. */
export function woodJob(): Promise<ImageData> {
  return (job ??= make());
}

async function make(): Promise<ImageData> {
  const { w, h } = woodSize(DESK_MM, DESK_MM);
  const here = () => new ImageData(woodRows(DESK_MM, DESK_MM, 0, h), w, h);
  const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
  try {
    const bands = await Promise.all(
      Array.from({ length: n }, (_, i) => {
        const y0 = Math.round((h * i) / n), y1 = Math.round((h * (i + 1)) / n);
        return new Promise<{ y0: number; rows: Uint8ClampedArray<ArrayBuffer> }>((resolve, reject) => {
          const worker = new Worker(new URL('./wood.worker.ts', import.meta.url), { type: 'module' });
          worker.onmessage = (ev: MessageEvent<Uint8ClampedArray<ArrayBuffer>>) => { resolve({ y0, rows: ev.data }); worker.terminate(); };
          worker.onerror = (ev) => { worker.terminate(); reject(new Error(ev.message)); };
          worker.postMessage({ wMm: DESK_MM, hMm: DESK_MM, y0, y1 });
        });
      }),
    );
    const img = new ImageData(w, h);
    for (const { y0, rows } of bands) img.data.set(rows, y0 * w * 4);
    return img;
  } catch {
    return here();
  }
}

// Importing this module starts the job.
void woodJob();
