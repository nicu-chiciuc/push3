// Text subtitles embedded in a Matroska file (.mkv, .webm), read in the browser. Mediabunny does
// not read subtitle tracks, so this is a small reader of just enough of the format.
//
// Fast path: the file's index (Cues) usually lists every subtitle block, so only those blocks are
// read: a few MB of a 7 GB film. Otherwise every cluster is scanned in large sequential reads.
// Text codecs: S_TEXT/UTF8 (SRT), S_TEXT/ASS and S_TEXT/SSA, S_TEXT/WEBVTT, with zlib or
// header-stripping compression. Image subtitles (PGS, VobSub) are listed as not readable.
import { cleanCueText, type Cue } from './subtitles.ts';

export interface MkvSubtitleTrack {
  readonly number: number;
  readonly lang: string;
  readonly name: string;
  readonly codec: string;
  readonly forced: boolean;
  /** Text we can draw; image subtitles are false. */
  readonly text: boolean;
}

export interface ByteSource {
  readonly size: number;
  read(pos: number, len: number): Promise<Uint8Array>;
}

export interface ScanCallbacks {
  /** The subtitle tracks, as soon as the header is read. */
  onTracks(tracks: ReadonlyArray<MkvSubtitleTrack>): void;
  /** All cues found so far for a track (sorted), several times while the scan runs. */
  onCues(track: number, cues: ReadonlyArray<Cue>): void;
  onProgress?(fraction: number): void;
  readonly signal?: AbortSignal;
}

/** A File or Blob as a ByteSource. */
export const blobSource = (blob: Blob): ByteSource => ({
  size: blob.size,
  read: async (pos, len) => new Uint8Array(await blob.slice(pos, pos + len).arrayBuffer()),
});

const ID = {
  Segment: 0x18538067, SeekHead: 0x114d9b74, Seek: 0x4dbb, SeekID: 0x53ab, SeekPosition: 0x53ac,
  Info: 0x1549a966, TimecodeScale: 0x2ad7b1, Tracks: 0x1654ae6b, TrackEntry: 0xae, TrackNumber: 0xd7,
  TrackType: 0x83, CodecID: 0x86, Language: 0x22b59c, LanguageBCP47: 0x22b59d, Name: 0x536e,
  FlagForced: 0x55aa, ContentEncodings: 0x6d80, ContentEncoding: 0x6240, ContentCompression: 0x5034,
  ContentCompAlgo: 0x4254, ContentCompSettings: 0x4255, Cluster: 0x1f43b675, Timecode: 0xe7,
  SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1, BlockDuration: 0x9b, Cues: 0x1c53bb6b,
  CuePoint: 0xbb, CueTime: 0xb3, CueTrackPositions: 0xb7, CueTrack: 0xf7, CueClusterPosition: 0xf1,
  CueRelativePosition: 0xf0,
} as const;
/** Elements that can follow a Cluster at the top of a Segment: they end a cluster of unknown size. */
const TOP_LEVEL = new Set<number>([ID.Cluster, ID.Cues, ID.Tracks, ID.Info, ID.SeekHead, 0x1941a469, 0x1043a770, 0x1254c367]);
const UNKNOWN = -1;
const TEXT_CODECS = new Set(['S_TEXT/UTF8', 'S_TEXT/ASS', 'S_TEXT/SSA', 'S_TEXT/WEBVTT', 'S_TEXT/ASCII']);

/** Reads through a window, so many small reads near each other cost one real read. */
class Reader {
  private winStart = 0;
  private win: Uint8Array = new Uint8Array(0);
  readonly src: ByteSource;
  private readonly windowSize: number;
  constructor(src: ByteSource, windowSize: number) {
    this.src = src;
    this.windowSize = windowSize;
  }
  async bytes(pos: number, len: number): Promise<Uint8Array> {
    if (pos < this.winStart || pos + len > this.winStart + this.win.length) {
      const want = Math.min(Math.max(len, this.windowSize), this.src.size - pos);
      this.win = await this.src.read(pos, Math.max(0, want));
      this.winStart = pos;
    }
    return this.win.subarray(pos - this.winStart, pos - this.winStart + len);
  }
}

interface Head { id: number; size: number; data: number }

/** EBML variable-length integer: returns value and length (marker removed for sizes, kept for IDs). */
function vint(b: Uint8Array, at: number, keepMarker: boolean): { value: number; len: number } | null {
  const first = b[at];
  if (first === undefined || first === 0) return null;
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (at + len > b.length) return null;
  let value = keepMarker ? first : first & (0xff >> len);
  let allOnes = value === (0xff >> len);
  for (let i = 1; i < len; i++) {
    value = value * 256 + b[at + i]!;
    if (b[at + i] !== 0xff) allOnes = false;
  }
  return { value: !keepMarker && allOnes ? UNKNOWN : value, len };
}

async function head(r: Reader, pos: number): Promise<Head | null> {
  if (pos >= r.src.size) return null;
  const b = await r.bytes(pos, Math.min(12, r.src.size - pos));
  const id = vint(b, 0, true);
  if (!id) return null;
  const size = vint(b, id.len, false);
  if (!size) return null;
  return { id: id.value, size: size.value, data: pos + id.len + size.len };
}

const uint = (b: Uint8Array) => b.reduce((v, x) => v * 256 + x, 0);
const str = (b: Uint8Array) => new TextDecoder().decode(b).replace(/\0+$/, '');

/** Children of an element with a known size, read whole (only for small elements: headers, cues). */
function* children(b: Uint8Array): Generator<{ id: number; body: Uint8Array }> {
  let p = 0;
  while (p < b.length) {
    const id = vint(b, p, true);
    if (!id) return;
    const size = vint(b, p + id.len, false);
    if (!size || size.value === UNKNOWN) return;
    const start = p + id.len + size.len;
    yield { id: id.value, body: b.subarray(start, start + size.value) };
    p = start + size.value;
  }
}

interface TrackState {
  info: MkvSubtitleTrack;
  compression: { algo: number; settings: Uint8Array } | null;
  cues: Array<Cue>;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** One block's payload to cue text, by codec. */
async function blockText(t: TrackState, payload: Uint8Array): Promise<string> {
  let data = payload;
  if (t.compression?.algo === 0) data = await inflate(data);
  else if (t.compression?.algo === 3) { const s = t.compression.settings, joined = new Uint8Array(s.length + data.length); joined.set(s); joined.set(data, s.length); data = joined; }
  let text = new TextDecoder().decode(data);
  if (t.info.codec === 'S_TEXT/ASS' || t.info.codec === 'S_TEXT/SSA') {
    // ReadOrder, Layer, Style, Name, MarginL, MarginR, MarginV, Effect, Text (which may contain commas)
    const fields = text.split(',');
    if (fields.length >= 9) text = fields.slice(8).join(',');
    text = text.replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ');
  }
  return cleanCueText(text);
}

export async function scanMkvSubtitles(src: ByteSource, cb: ScanCallbacks): Promise<void> {
  const r = new Reader(src, 4 << 20);
  // EBML header, then the Segment.
  const ebml = await head(r, 0);
  if (!ebml || ebml.id !== 0x1a45dfa3) throw new Error('Not a Matroska file');
  const seg = await head(r, ebml.data + ebml.size);
  if (!seg || seg.id !== ID.Segment) throw new Error('No Matroska segment');
  const segStart = seg.data, segEnd = seg.size === UNKNOWN ? src.size : Math.min(src.size, seg.data + seg.size);

  let scale = 1_000_000; // ns per timecode tick
  const tracks = new Map<number, TrackState>();
  let cuesPos: number | null = null, firstCluster: number | null = null;

  // Header: everything up to the first Cluster (SeekHead tells where the Cues are).
  for (let p = segStart; p < segEnd;) {
    const h = await head(r, p);
    if (!h || h.size === UNKNOWN) break;
    if (h.id === ID.Cluster) { firstCluster = p; break; }
    if (h.id === ID.SeekHead || h.id === ID.Info || h.id === ID.Tracks) {
      const body = await r.bytes(h.data, h.size);
      if (h.id === ID.SeekHead) {
        for (const s of children(body)) if (s.id === ID.Seek) {
          let sid = 0, spos = 0;
          for (const c of children(s.body)) { if (c.id === ID.SeekID) sid = uint(c.body); else if (c.id === ID.SeekPosition) spos = uint(c.body); }
          if (sid === ID.Cues) cuesPos = segStart + spos;
        }
      } else if (h.id === ID.Info) {
        for (const c of children(body)) if (c.id === ID.TimecodeScale) scale = uint(c.body);
      } else {
        for (const e of children(body)) if (e.id === ID.TrackEntry) {
          let num = 0, type = 0, codec = '', lang = 'eng', bcp = '', name = '', forced = false, compression: TrackState['compression'] = null;
          for (const c of children(e.body)) {
            if (c.id === ID.TrackNumber) num = uint(c.body);
            else if (c.id === ID.TrackType) type = uint(c.body);
            else if (c.id === ID.CodecID) codec = str(c.body);
            else if (c.id === ID.Language) lang = str(c.body);
            else if (c.id === ID.LanguageBCP47) bcp = str(c.body);
            else if (c.id === ID.Name) name = str(c.body);
            else if (c.id === ID.FlagForced) forced = uint(c.body) === 1;
            else if (c.id === ID.ContentEncodings) {
              for (const enc of children(c.body)) if (enc.id === ID.ContentEncoding) for (const cc of children(enc.body)) if (cc.id === ID.ContentCompression) {
                let algo = 0, settings = new Uint8Array(0);
                for (const x of children(cc.body)) { if (x.id === ID.ContentCompAlgo) algo = uint(x.body); else if (x.id === ID.ContentCompSettings) settings = x.body.slice(); }
                compression = { algo, settings };
              }
            }
          }
          if (type !== 17) continue; // subtitles only
          const text = TEXT_CODECS.has(codec) && (!compression || compression.algo === 0 || compression.algo === 3);
          tracks.set(num, { info: { number: num, lang: (bcp || lang).toUpperCase(), name, codec, forced, text }, compression, cues: [] });
        }
      }
    }
    p = h.data + h.size;
  }
  cb.onTracks([...tracks.values()].map((t) => t.info));
  const textTracks = new Map([...tracks].filter(([, t]) => t.info.text));
  if (!textTracks.size || firstCluster === null) return;

  const publish = (only?: number) => {
    for (const [n, t] of textTracks) {
      if (only !== undefined && n !== only) continue;
      t.cues.sort((a, b) => a.start - b.start);
      // Cues without a duration end at the next cue (at most 5 s later).
      const fixed = t.cues.map((c, i) => (c.end > c.start ? c : { ...c, end: Math.min(c.start + 5, t.cues[i + 1]?.start ?? c.start + 5) }));
      cb.onCues(n, fixed);
    }
  };
  const addBlock = async (block: Uint8Array, clusterTime: number, duration: number | null) => {
    const tn = vint(block, 0, false);
    if (!tn) return;
    const t = textTracks.get(tn.value);
    if (!t) return;
    const rel = (block[tn.len]! << 24 >> 16) | block[tn.len + 1]!; // signed 16-bit
    const flags = block[tn.len + 2]!;
    if (flags & 0x06) return; // laced: never used for text subtitles
    const text = await blockText(t, block.subarray(tn.len + 3));
    if (!text) return;
    const start = ((clusterTime + rel) * scale) / 1e9;
    t.cues.push({ start, end: duration ? start + (duration * scale) / 1e9 : start, text });
  };

  // Read one cluster's subtitle blocks: all of them, or only the one at a known offset.
  const readCluster = async (rd: Reader, pos: number, onlyAt: number | null) => {
    const ch = await head(rd, pos);
    if (!ch || ch.id !== ID.Cluster) return pos + 1;
    const end = ch.size === UNKNOWN ? segEnd : ch.data + ch.size;
    let time = 0;
    let p = ch.data;
    if (onlyAt !== null) {
      // The cluster's time is among its first elements (after a CRC-32, for example); then go
      // straight to the indexed block.
      for (let q = p, i = 0; q < end && i < 4; i++) {
        const t = await head(rd, q);
        if (!t || t.size === UNKNOWN) break;
        if (t.id === ID.Timecode) { time = uint(await rd.bytes(t.data, t.size)); break; }
        q = t.data + t.size;
      }
      p = ch.data + onlyAt;
    }
    for (; p < end;) {
      const h = await head(rd, p);
      if (!h || h.size === UNKNOWN) break;
      if (ch.size === UNKNOWN && TOP_LEVEL.has(h.id)) return p;
      if (h.id === ID.Timecode) time = uint(await rd.bytes(h.data, h.size));
      else if (h.id === ID.SimpleBlock || h.id === ID.BlockGroup) {
        // Peek at the track number before reading a block whole: most blocks are video and audio.
        const peekAt = h.id === ID.SimpleBlock ? h.data : null;
        if (peekAt !== null) {
          const tn = vint(await rd.bytes(peekAt, Math.min(8, h.size)), 0, false);
          if (tn && textTracks.has(tn.value)) await addBlock(await rd.bytes(h.data, h.size), time, null);
        } else if (h.size < 1 << 20) {
          let block: Uint8Array | null = null, dur: number | null = null;
          for (const c of children(await rd.bytes(h.data, h.size))) {
            if (c.id === ID.Block) block = c.body.slice();
            else if (c.id === ID.BlockDuration) dur = uint(c.body);
          }
          if (block) await addBlock(block, time, dur);
        }
        if (onlyAt !== null) return end;
      }
      p = h.data + h.size;
    }
    return end;
  };

  // Fast path: the index points at each subtitle block.
  if (cuesPos !== null) {
    const ch = await head(r, cuesPos);
    if (ch && ch.id === ID.Cues && ch.size !== UNKNOWN && ch.size < 64 << 20) {
      const targets: Array<{ cluster: number; rel: number | null }> = [];
      for (const cp of children(await r.bytes(ch.data, ch.size))) {
        if (cp.id !== ID.CuePoint) continue;
        for (const ctp of children(cp.body)) {
          if (ctp.id !== ID.CueTrackPositions) continue;
          let track = 0, cluster = -1, rel: number | null = null;
          for (const c of children(ctp.body)) {
            if (c.id === ID.CueTrack) track = uint(c.body);
            else if (c.id === ID.CueClusterPosition) cluster = uint(c.body);
            else if (c.id === ID.CueRelativePosition) rel = uint(c.body);
          }
          if (textTracks.has(track) && cluster >= 0) targets.push({ cluster: segStart + cluster, rel });
        }
      }
      if (targets.length) {
        const rd = new Reader(src, 16 << 10); // subtitle blocks are tiny: read little around each
        targets.sort((a, b) => a.cluster - b.cluster || (a.rel ?? 0) - (b.rel ?? 0));
        const seen = new Set<string>();
        for (const [i, t] of targets.entries()) {
          if (cb.signal?.aborted) return;
          const key = `${t.cluster}:${t.rel}`;
          if (seen.has(key)) continue;
          seen.add(key);
          await readCluster(rd, t.cluster, t.rel);
          if (i % 200 === 199) { cb.onProgress?.(i / targets.length); publish(); }
        }
        cb.onProgress?.(1);
        publish();
        return;
      }
    }
  }

  // Slow path: every cluster, in order, in large reads.
  const rd = new Reader(src, 32 << 20);
  let lastPublish = 0;
  for (let p = firstCluster; p < segEnd;) {
    if (cb.signal?.aborted) return;
    const h = await head(rd, p);
    if (!h) break;
    if (h.id === ID.Cluster) p = await readCluster(rd, p, null);
    else if (h.size === UNKNOWN) break;
    else p = h.data + h.size;
    if (p - lastPublish > 256 << 20) { lastPublish = p; cb.onProgress?.(p / segEnd); publish(); }
  }
  cb.onProgress?.(1);
  publish();
}
