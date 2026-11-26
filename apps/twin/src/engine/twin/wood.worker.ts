// Makes one band of rows of the desk's walnut texture off the main thread, and hands the bytes
// back (moved, not copied). wood-job.ts starts several of these.
import { woodRows } from './wood.ts';

interface Job { readonly wMm: number; readonly hMm: number; readonly y0: number; readonly y1: number }

// the page's type library has no worker scope: these are the worker's own onmessage and postMessage
const scope = self as unknown as { onmessage: (ev: MessageEvent<Job>) => void; postMessage(msg: unknown, transfer: Array<Transferable>): void };
scope.onmessage = ({ data: { wMm, hMm, y0, y1 } }) => {
  const rows = woodRows(wMm, hMm, y0, y1);
  scope.postMessage(rows, [rows.buffer]);
};
