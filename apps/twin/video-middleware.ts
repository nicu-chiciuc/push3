// Local dev middleware for Push 3 Video Deck: serves browser-native MP4/WebM via HTTP Range
// and live-transcodes MKV / HDR10 / AC3 5.1 files (e.g. 4K UHD Blu-Ray rips) on the fly using
// Apple Silicon VideoToolbox + AudioToolbox so 6+ GB movies seek & play in <1s with zero conversion wait.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const VIDEO_EXTS = new Set(['.mkv', '.mp4', '.mov', '.webm', '.m4v', '.avi']);
const NATIVE_EXTS = new Set(['.mp4', '.webm', '.m4v']);

interface AudioTrackInfo {
  readonly index: number;      // 0-based index among audio streams (for -map 0:a:N)
  readonly streamIndex: number;
  readonly lang: string;
  readonly title: string;
  readonly codec: string;
  readonly channels: number;
}

interface ProbeResult {
  readonly path: string;
  readonly name: string;
  readonly sizeBytes: number;
  readonly duration: number;
  readonly width: number;
  readonly height: number;
  readonly hdr: boolean;
  readonly needsTranscode: boolean;
  readonly audioTracks: ReadonlyArray<AudioTrackInfo>;
  readonly subtitleTracks: ReadonlyArray<SubtitleTrackInfo>;
}

/** A text subtitle track: embedded in the video (`s:<n>`, the n-th subtitle stream) or a file next to it (`f:<name>`). */
interface SubtitleTrackInfo {
  readonly id: string;
  readonly lang: string;
  readonly label: string;
}

const SUB_EXTS = new Set(['.srt', '.vtt', '.ass', '.ssa']);
/** Subtitle codecs that are text; image subtitles (PGS, DVD) cannot be drawn as text. */
const TEXT_SUB_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text']);

/** Subtitle files next to the video whose names start with the video's name, e.g. `Film.en.srt`. */
function sidecarSubtitles(videoPath: string): Array<SubtitleTrackInfo & { file: string }> {
  const dir = path.dirname(videoPath), base = path.basename(videoPath, path.extname(videoPath)).toLowerCase();
  let names: Array<string> = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names
    .filter((n) => SUB_EXTS.has(path.extname(n).toLowerCase()) && n.toLowerCase().startsWith(base))
    .sort()
    .map((n) => {
      const middle = n.slice(base.length, n.length - path.extname(n).length).replace(/^[ ._-]+/, '');
      return { id: `f:${n}`, file: path.join(dir, n), lang: (middle.split(/[ ._-]/)[0] || 'file').toUpperCase(), label: middle || 'Subtitle file' };
    });
}

const subtitleCache = new Map<string, string>();

/** One subtitle track as WebVTT text, converted by ffmpeg (from SRT, ASS or an embedded stream). */
function subtitleVtt(videoPath: string, trackId: string): Promise<string> {
  const key = `${videoPath}\n${trackId}`;
  const cached = subtitleCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  let input: string, map: Array<string> = [];
  if (trackId.startsWith('f:')) {
    // Only a file that the listing itself found: never an arbitrary path.
    const hit = sidecarSubtitles(videoPath).find((t) => t.id === trackId);
    if (!hit) return Promise.reject(new Error('Subtitle file not found'));
    input = hit.file;
  } else if (/^s:\d+$/.test(trackId)) {
    input = videoPath;
    map = ['-map', `0:${trackId}`];
  } else {
    return Promise.reject(new Error('Unknown subtitle track'));
  }
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', ['-v', 'error', '-i', input, ...map, '-f', 'webvtt', '-'], { maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(String(stderr || err.message).trim().split('\n').at(-1)));
      subtitleCache.set(key, stdout);
      resolve(stdout);
    });
  });
}

const probeCache = new Map<string, ProbeResult>();

function resolveSafePath(raw: string): string | null {
  if (!raw) return null;
  const expanded = raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(2)) : raw;
  const full = path.resolve(expanded);
  const ext = path.extname(full).toLowerCase();
  if (!VIDEO_EXTS.has(ext)) return null;
  try {
    const stat = fs.statSync(full);
    return stat.isFile() ? full : null;
  } catch {
    return null;
  }
}

function pickLocalFile(): Promise<{ path?: string; canceled?: boolean; error?: string }> {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') {
      resolve({ error: 'Native file dialog is only available on macOS; use drag-and-drop or enter a file path.' });
      return;
    }
    execFile(
      'osascript',
      // Only playable files: any movie type, plus the extensions themselves, because MKV and WebM count
      // as movies only when an app such as IINA or VLC has registered them.
      ['-e', `POSIX path of (choose file with prompt "Select a video file" of type {"public.movie", ${[...VIDEO_EXTS].map((e) => `"${e.slice(1)}"`).join(', ')}})`],
      { maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = `${stderr ?? ''} ${err.message ?? ''}`;
          if (msg.includes('-128') || /cancel/i.test(msg)) {
            resolve({ canceled: true });
            return;
          }
          resolve({ error: msg.trim() || 'Could not open file picker' });
          return;
        }
        const chosen = stdout.trim();
        const safe = resolveSafePath(chosen);
        if (!safe) {
          resolve({ error: 'Unsupported video format. Choose an MKV, MP4, MOV, WebM, M4V, or AVI file.' });
          return;
        }
        resolve({ path: safe });
      },
    );
  });
}

function probeFile(filePath: string): Promise<ProbeResult> {
  const cached = probeCache.get(filePath);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve, reject) => {
    execFile(
      'ffprobe',
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        try {
          const data = JSON.parse(stdout) as {
            format?: { duration?: string; size?: string };
            streams?: Array<{
              disposition?: Record<string, number>;
              index: number;
              codec_type?: string;
              codec_name?: string;
              width?: number;
              height?: number;
              color_transfer?: string;
              color_primaries?: string;
              channels?: number;
              tags?: Record<string, string>;
            }>;
          };
          const streams = data.streams ?? [];
          const v = streams.find((s) => s.codec_type === 'video');
          const audios = streams.filter((s) => s.codec_type === 'audio');
          const ext = path.extname(filePath).toLowerCase();
          const audioCodecs = new Set(audios.map((a) => (a.codec_name ?? '').toLowerCase()));
          const hasUnsupportedAudio = [...audioCodecs].some((c) => !['aac', 'opus', 'mp3', 'vorbis', 'flac'].includes(c));
          const hdr = v?.color_transfer === 'smpte2084' || v?.color_transfer === 'arib-std-b67';
          const needsTranscode = !NATIVE_EXTS.has(ext) || hasUnsupportedAudio || hdr;

          const result: ProbeResult = {
            path: filePath,
            name: path.basename(filePath),
            sizeBytes: Number(data.format?.size ?? fs.statSync(filePath).size),
            duration: Number(data.format?.duration ?? 0),
            width: v?.width ?? 1280,
            height: v?.height ?? 720,
            hdr,
            needsTranscode,
            audioTracks: audios.map((a, idx) => ({
              index: idx,
              streamIndex: a.index,
              lang: (a.tags?.language ?? `track${idx + 1}`).toUpperCase(),
              title: a.tags?.title ?? `${(a.codec_name ?? 'audio').toUpperCase()} ${a.channels ?? 2}ch`,
              codec: a.codec_name ?? 'unknown',
              channels: a.channels ?? 2,
            })),
            subtitleTracks: [
              ...streams
                .filter((st) => st.codec_type === 'subtitle')
                .map((st, n) => ({ st, n }))
                .filter(({ st }) => TEXT_SUB_CODECS.has((st.codec_name ?? '').toLowerCase()))
                .map(({ st, n }) => {
                  const lang = (st.tags?.language ?? 'und').toUpperCase();
                  const forced = st.disposition?.['forced'] ? ' (forced)' : '';
                  return { id: `s:${n}`, lang, label: `${st.tags?.title ?? lang}${forced}` };
                }),
              ...sidecarSubtitles(filePath).map(({ id, lang, label }) => ({ id, lang, label })),
            ],
          };
          probeCache.set(filePath, result);
          resolve(result);
        } catch (parseErr) {
          reject(parseErr);
        }
      },
    );
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function serveRangeFile(req: IncomingMessage, res: ServerResponse, filePath: string) {
  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.webm' ? 'video/webm' : 'video/mp4';
  const range = req.headers.range;

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) {
      res.statusCode = 416;
      res.end();
      return;
    }
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? Math.min(parseInt(m[2], 10), stat.size - 1) : stat.size - 1;
    if (start > end || start >= stat.size) {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${stat.size}`);
      res.end();
      return;
    }
    res.statusCode = 206;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', String(end - start + 1));
    res.setHeader('Content-Type', mime);
    const stream = fs.createReadStream(filePath, { start, end });
    req.on('close', () => stream.destroy());
    stream.pipe(res);
    return;
  }

  res.statusCode = 200;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('Content-Type', mime);
  const stream = fs.createReadStream(filePath);
  req.on('close', () => stream.destroy());
  stream.pipe(res);
}

async function serveTranscodedStream(req: IncomingMessage, res: ServerResponse, filePath: string, startSec: number, audioIdx: number) {
  const info = await probeFile(filePath);
  const safeStart = Math.max(0, Number.isFinite(startSec) ? startSec : 0);
  const safeAudio = Math.max(0, Math.min(Math.max(0, info.audioTracks.length - 1), audioIdx));

  // Push 3 display is 960×160, so 960px wide SDR preserves 100% of display sharpness while running ~4x realtime on Apple Silicon.
  const vf = info.hdr
    ? 'scale=960:-2,colorspace=all=bt709:iall=bt2020:fast=1,eq=brightness=0.04:contrast=1.12:saturation=1.22,format=yuv420p'
    : 'scale=960:-2,format=yuv420p';

  const track = info.audioTracks[safeAudio];
  const isSurround = (track?.channels ?? 2) > 2;
  const audioArgs =
    info.audioTracks.length > 0
      ? [
          ...(isSurround
            ? [
                '-af',
                // A standard 5.1 to stereo mix and nothing else: loudness and dynamics are the browser's job
                // (the Video Deck's limiter and its Dialogue boost), so they can change live.
                'aresample=ochl=stereo',
              ]
            : []),
          '-c:a', 'aac',
          '-ar', '48000',
          '-ac', '2',
          '-b:a', '192k',
        ]
      : ['-an'];

  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-hwaccel', 'videotoolbox',
    '-ss', safeStart.toFixed(3),
    '-i', filePath,
    '-map', '0:v:0',
    ...(info.audioTracks.length > 0 ? ['-map', `0:a:${safeAudio}`] : []),
    '-sn',
    '-dn',
    '-map_chapters', '-1',
    '-vf', vf,
    '-c:v', 'h264_videotoolbox',
    '-b:v', '2400k',
    '-allow_sw', '1',
    '-g', '48',
    ...audioArgs,
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
    'pipe:1',
  ];

  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (proc.exitCode === null) proc.kill('SIGKILL');
  };

  req.on('close', cleanup);
  res.on('close', cleanup);

  res.statusCode = 200;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Transfer-Encoding', 'chunked');

  proc.stdout.pipe(res);
  proc.stderr.on('data', (chunk) => {
    const msg = String(chunk).trim();
    if (msg) console.error('[video-middleware ffmpeg]', msg);
  });
  proc.on('error', (err) => {
    console.error('[video-middleware spawn error]', err);
    if (!res.headersSent) sendJson(res, 500, { error: String(err) });
    else res.end();
  });
}

export function videoBridgePlugin(): Plugin {
  return {
    name: 'push3-video-bridge',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url ?? '';
        if (!rawUrl.startsWith('/api/video/')) return next();

        const url = new URL(rawUrl, 'http://localhost');

        if (url.pathname === '/api/video/pick') {
          const picked = await pickLocalFile();
          return sendJson(res, picked.error ? 400 : 200, picked);
        }

        if (url.pathname === '/api/video/probe') {
          const filePath = resolveSafePath(url.searchParams.get('path') ?? '');
          if (!filePath) return sendJson(res, 404, { error: 'Video file not found or unsupported extension' });
          try {
            const info = await probeFile(filePath);
            return sendJson(res, 200, info);
          } catch (err) {
            return sendJson(res, 500, { error: String(err) });
          }
        }

        if (url.pathname === '/api/video/subtitles') {
          const filePath = resolveSafePath(url.searchParams.get('path') ?? '');
          if (!filePath) return sendJson(res, 404, { error: 'Video file not found or unsupported extension' });
          try {
            const vtt = await subtitleVtt(filePath, url.searchParams.get('track') ?? '');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(vtt);
          } catch (err) {
            return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
          }
          return;
        }

        if (url.pathname === '/api/video/stream') {
          const filePath = resolveSafePath(url.searchParams.get('path') ?? '');
          if (!filePath) return sendJson(res, 404, { error: 'Video file not found or unsupported extension' });
          try {
            const info = await probeFile(filePath);
            const forceTranscode = url.searchParams.get('transcode') === '1';
            // raw=1: the file as it is, with range requests. The browser plays the picture and decodes the
            // audio itself (Mediabunny); transcoding is only the fallback for a picture it cannot play.
            if (url.searchParams.get('raw') === '1' || (!info.needsTranscode && !forceTranscode)) {
              serveRangeFile(req, res, filePath);
            } else {
              const startSec = Number(url.searchParams.get('start') ?? '0');
              const audioIdx = Number(url.searchParams.get('audio') ?? '0');
              await serveTranscodedStream(req, res, filePath, startSec, audioIdx);
            }
            return;
          } catch (err) {
            if (!res.headersSent) return sendJson(res, 500, { error: String(err) });
            res.end();
            return;
          }
        }

        return next();
      });
    },
  };
}
