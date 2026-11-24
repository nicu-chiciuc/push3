// Subtitles for the Video Deck: parse SRT or WebVTT text into cues, find the cue for a time, and
// draw it on the 160 px tall Push screen, where the browser's own <track> rendering cannot reach.

export interface Cue {
  readonly start: number;
  readonly end: number;
  /** Plain text, lines separated by \n (tags removed). */
  readonly text: string;
}

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;
const seconds = (m: RegExpMatchArray) => (+(m[1] ?? 0)) * 3600 + +m[2]! * 60 + +m[3]! + +m[4]!.padEnd(3, '0') / 1000;

/** SRT and WebVTT share the shape that matters: blocks with a "start --> end" line, then text. */
export function parseSubtitles(raw: string): Array<Cue> {
  const cues: Array<Cue> = [];
  for (const block of raw.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0) continue;
    const [a, b] = lines[at]!.split('-->');
    const ma = a?.match(TIME), mb = b?.match(TIME);
    if (!ma || !mb) continue;
    const text = cleanCueText(lines.slice(at + 1).join('\n'));
    if (text) cues.push({ start: seconds(ma), end: seconds(mb), text });
  }
  return cues.sort((x, y) => x.start - y.start);
}

/** Plain text of a cue: tags and formatting codes removed. */
export function cleanCueText(raw: string): string {
  return raw
    .replace(/\r/g, '')
    .replace(/<[^>]+>/g, '') // <i>, <b>, <font>, <c.x>, voice tags
    .replace(/\{\\[^}]*\}/g, '') // ASS override codes such as {\an8}
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .trim();
}

/** The cues showing at time t (usually one; overlapping cues stack). */
export function cuesAt(cues: ReadonlyArray<Cue>, t: number): Array<Cue> {
  // binary search for the last cue starting at or before t, then walk back over overlaps
  let lo = 0, hi = cues.length - 1, last = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid]!.start <= t) { last = mid; lo = mid + 1; } else hi = mid - 1;
  }
  const out: Array<Cue> = [];
  for (let i = last; i >= 0 && i > last - 8; i--) if (cues[i]!.end > t) out.unshift(cues[i]!);
  return out;
}

const FONT = '"Helvetica Neue", Arial, sans-serif';

function wrap(g: CanvasRenderingContext2D, line: string, maxW: number): Array<string> {
  const words = line.split(/\s+/), out: Array<string> = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && g.measureText(next).width > maxW) { out.push(cur); cur = w; } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Draw subtitle text at the bottom of a video area (x, w) of the 160 px screen: white on a dark
 * outline, shrunk to fit at most three lines.
 */
export function drawSubtitles(g: CanvasRenderingContext2D, text: string, x: number, w: number, h: number, scale = 1) {
  const maxW = w - 24;
  let size = Math.round(19 * scale), lines: Array<string> = [];
  for (; size >= 11; size--) {
    g.font = `700 ${size}px ${FONT}`;
    lines = text.split('\n').flatMap((l) => wrap(g, l, maxW));
    if (lines.length <= 3 && lines.every((l) => g.measureText(l).width <= maxW)) break;
  }
  lines = lines.slice(-3);
  const lineH = Math.round(size * 1.18);
  const bottom = h - 9;
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.lineJoin = 'round';
  g.lineWidth = Math.max(2.5, size * 0.2);
  g.strokeStyle = 'rgba(0,0,0,0.92)';
  g.fillStyle = '#ffffff';
  lines.forEach((l, i) => {
    const y = bottom - (lines.length - 1 - i) * lineH;
    g.strokeText(l, x + w / 2, y);
    g.fillText(l, x + w / 2, y);
  });
  g.restore();
}
