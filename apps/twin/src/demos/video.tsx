// Video Deck: full-bleed 960×160 Push 3 cinema & gag-FX deck.
// Supports both zero-upload client-side MP4/WebM drag-and-drop AND live Apple Silicon
// VideoToolbox streaming for multi-GB 4K HDR10 MKV + AC3 5.1 files via the local dev bridge.
import { createSignal, For, Show } from 'solid-js';
import { Effect } from 'effect';
import { css, type RGB } from '@push3/protocol';
import { MONO, text } from '../engine/screen.ts';
import type { Demo } from '../engine/engine.ts';
import { VideoAudioEngine, type AudioEngineState } from './video-audio.ts';
import { cuesAt, drawSubtitles, parseSubtitles, type Cue } from './subtitles.ts';

const W = 960;
const H = 160;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const FRAMING_MODES = [
  { id: 'cover-deck', label: 'Cover + Right Deck (Recommended)', short: 'COVER+DECK' },
  { id: 'cover-full', label: 'Naive Cover Fill (Full 960×160)', short: 'FULL COVER' },
  { id: 'cockpit', label: 'Push Cockpit (FFT · Video · FX)', short: 'COCKPIT' },
  { id: 'contain-deck', label: 'Uncropped + Wide Right Deck', short: 'FIT+DECK' },
  { id: 'ambient-wings', label: 'Ambient Wings (Blur Fill)', short: 'WINGS' },
  { id: 'time-echo', label: 'Time-Echo Triptych (-0.8s · LIVE · -0.4s)', short: 'TIME-ECHO' },
  { id: 'superview', label: 'SuperView Non-Linear Stretch', short: 'SUPERVIEW' },
] as const;

export type FramingMode = (typeof FRAMING_MODES)[number]['id'];

export const VISUAL_FX = [
  { id: 'clean', label: 'Clean' },
  { id: 'vhs', label: 'VHS Tape' },
  { id: 'glitch', label: 'RGB Glitch' },
  { id: 'deepfry', label: 'Deep-Fry' },
  { id: 'thermal', label: 'Thermal' },
  { id: 'noir', label: 'Noir B&W' },
  { id: 'invert', label: 'Invert' },
] as const;

export type VisualFx = (typeof VISUAL_FX)[number]['id'];

interface AudioTrackInfo {
  readonly index: number;
  readonly streamIndex: number;
  readonly lang: string;
  readonly title: string;
  readonly codec: string;
  readonly channels: number;
}

/** Embedded in the video (`mkv:<track>`) or an .srt/.vtt file (`file:<name>`). */
interface SubtitleTrackInfo {
  readonly id: string;
  readonly lang: string;
  readonly label: string;
}

type PadMode = 'ambilight' | 'fx';

interface GagPadSpec {
  readonly note: number;
  readonly label: string;
  readonly short: string;
  readonly color: RGB;
  readonly group: 'voice' | 'audio' | 'visual';
}

const GAG_PADS: ReadonlyArray<GagPadSpec> = [
  // Row 7 (top row: 92..99): Voice & Speed
  { note: 92, label: 'Chipmunk (+7st)', short: 'CHIP +7', color: [255, 110, 195], group: 'voice' },
  { note: 93, label: 'Helium (+12st)', short: 'HELI +12', color: [255, 170, 220], group: 'voice' },
  { note: 94, label: 'Demon (-7st)', short: 'DEMON -7', color: [255, 65, 55], group: 'voice' },
  { note: 95, label: 'Titan (-11st)', short: 'TITAN -11', color: [190, 30, 45], group: 'voice' },
  { note: 96, label: 'Slow-Mo (0.5×)', short: 'SLOW 0.5×', color: [70, 175, 255], group: 'voice' },
  { note: 97, label: 'Turbo (2.0×)', short: 'FAST 2×', color: [255, 190, 45], group: 'voice' },
  { note: 98, label: 'Tape Drag (0.65×)', short: 'TAPE DN', color: [155, 110, 255], group: 'voice' },
  { note: 99, label: 'Tape Chip (1.5×)', short: 'TAPE UP', color: [220, 130, 255], group: 'voice' },
  // Row 6 (84..91): Audio & Stutter
  { note: 84, label: 'Stutter 1/8', short: 'STUT 1/8', color: [60, 240, 170], group: 'audio' },
  { note: 85, label: 'Stutter 1/4', short: 'STUT 1/4', color: [40, 200, 140], group: 'audio' },
  { note: 86, label: 'Underwater LP', short: 'UNDERWTR', color: [50, 130, 255], group: 'audio' },
  { note: 87, label: 'Megaphone HP', short: 'MEGAPHNE', color: [255, 145, 50], group: 'audio' },
  { note: 88, label: 'Mega Dub Echo', short: 'DUB ECHO', color: [120, 230, 255], group: 'audio' },
  { note: 89, label: 'Bass Deep-Fry', short: 'BASS FRY', color: [255, 85, 30], group: 'audio' },
  { note: 90, label: 'Mute Drop', short: 'MUTE', color: [130, 138, 152], group: 'audio' },
  { note: 91, label: 'Replay -3s', short: '↺ -3s', color: [255, 225, 75], group: 'audio' },
  // Row 5 (76..83): Visual Gags
  { note: 76, label: 'Freeze Frame', short: 'FREEZE', color: [160, 230, 255], group: 'visual' },
  { note: 77, label: 'RGB Glitch', short: 'GLITCH', color: [255, 60, 150], group: 'visual' },
  { note: 78, label: 'VHS Tape', short: 'VHS', color: [185, 130, 255], group: 'visual' },
  { note: 79, label: 'Deep-Fry', short: 'DEEP-FRY', color: [255, 120, 25], group: 'visual' },
  { note: 80, label: 'Thermal Cam', short: 'THERMAL', color: [255, 200, 40], group: 'visual' },
  { note: 81, label: 'Noir B&W', short: 'NOIR', color: [200, 208, 220], group: 'visual' },
  { note: 82, label: 'Invert Flash', short: 'INVERT', color: [255, 255, 255], group: 'visual' },
  { note: 83, label: 'Zoom Punch 2.2×', short: 'ZOOM 2.2×', color: [95, 230, 125], group: 'visual' },
];

const GAG_BY_NOTE = new Map(GAG_PADS.map((p) => [p.note, p]));

// ── Reactive UI Signals ──
const [sourceLabel, setSourceLabel] = createSignal<string>('No video loaded');
const [sourceMeta, setSourceMeta] = createSignal<string>('Select a video file or drop one here');
/** The audio comes from the file decoded in the browser (Mediabunny + Signalsmith); the <video> is muted. */
const [decodedAudio, setDecodedAudio] = createSignal(false);
/** What the decoded audio was opened from, to reopen it after switching back from Direct audio. */
let decodeSource: Blob | null = null;
let decodeGen = 0;
const [audioTracks, setAudioTracks] = createSignal<ReadonlyArray<AudioTrackInfo>>([]);
const [audioTrackIdx, setAudioTrackIdx] = createSignal(0);
const [subtitleTracks, setSubtitleTracks] = createSignal<ReadonlyArray<SubtitleTrackInfo>>([]);
/** The track shown, or null for subtitles off. */
const [subtitleTrack, setSubtitleTrack] = createSignal<string | null>(null);
const [subtitleCues, setSubtitleCues] = createSignal<ReadonlyArray<Cue>>([]);
/** Seconds the subtitles come later (+) or earlier (-) than the video, for files that are out of sync. */
const [subtitleDelay, setSubtitleDelay] = createSignal(0);
const [subtitleMsg, setSubtitleMsg] = createSignal<string | null>(null);
/** Every track's cues, by track id (embedded tracks fill in while the file is read). */
const subtitleStore = new Map<string, ReadonlyArray<Cue>>();
let subtitleScan: AbortController | null = null;

/** Show a subtitle track (null hides subtitles). */
function selectSubtitleTrack(id: string | null) {
  setSubtitleTrack(id);
  setSubtitleCues(id === null ? [] : subtitleStore.get(id) ?? []);
}

/** Off, then each track in turn. */
function cycleSubtitles() {
  const ids: Array<string | null> = [null, ...subtitleTracks().map((t) => t.id)];
  const next = ids[(ids.indexOf(subtitleTrack()) + 1) % ids.length] ?? null;
  selectSubtitleTrack(next);
  const tr = subtitleTracks().find((t) => t.id === next);
  showHud('SUBTITLES', tr ? tr.label.toUpperCase() : 'OFF');
}

/** Prefer English, then the first track; skip forced-only tracks when a full one exists. */
function defaultSubtitleTrack(tracks: ReadonlyArray<SubtitleTrackInfo>): string | null {
  const full = tracks.filter((t) => !/forced/i.test(t.label));
  const pool = full.length ? full : tracks;
  return (pool.find((t) => /^EN/.test(t.lang)) ?? pool[0])?.id ?? null;
}

/** An .srt or .vtt file, added as a track of its own and shown. */
async function loadSubtitleFile(file: File) {
  const cues = parseSubtitles(await file.text());
  if (!cues.length) { setSubtitleMsg(`No subtitles found in ${file.name} (SRT or WebVTT)`); return; }
  const id = `file:${file.name}`;
  subtitleStore.set(id, cues);
  const lang = (/[._-]([a-z]{2,3})(?:[._-][^.]*)?\.(?:srt|vtt)$/i.exec(file.name)?.[1] ?? 'FILE').toUpperCase();
  setSubtitleTracks([...subtitleTracks().filter((t) => t.id !== id), { id, lang, label: file.name.replace(/\.(srt|vtt)$/i, '') }]);
  selectSubtitleTrack(id);
  setSubtitleMsg(null);
  showHud('SUBTITLES', `${cues.length} LINES`, 1.6);
}

/** Text subtitles inside the video file (Matroska: .mkv, .webm), read in the browser. */
async function scanEmbeddedSubtitles(file: File) {
  subtitleScan?.abort();
  const scan = (subtitleScan = new AbortController());
  const { scanMkvSubtitles, blobSource } = await import('./mkv-subtitles.ts');
  let images = 0;
  try {
    await scanMkvSubtitles(blobSource(file), {
      signal: scan.signal,
      onTracks: (tracks) => {
        if (scan.signal.aborted) return;
        images = tracks.filter((t) => !t.text).length;
        const text = tracks.filter((t) => t.text).map((t) => ({ id: `mkv:${t.number}`, lang: t.lang, label: `${t.name || t.lang}${t.forced ? ' (forced)' : ''}` }));
        setSubtitleTracks([...text, ...subtitleTracks().filter((t) => t.id.startsWith('file:'))]);
        if (subtitleTrack() === null) selectSubtitleTrack(defaultSubtitleTrack(text));
        if (text.length) setSubtitleMsg('Reading subtitles…');
      },
      onCues: (n, cues) => {
        if (scan.signal.aborted) return;
        subtitleStore.set(`mkv:${n}`, cues);
        if (subtitleTrack() === `mkv:${n}`) setSubtitleCues(cues);
      },
      onProgress: (f) => { if (!scan.signal.aborted) setSubtitleMsg(f < 1 ? `Reading subtitles… ${Math.round(f * 100)}%` : null); },
    });
    if (!scan.signal.aborted && images && !subtitleTracks().length) setSubtitleMsg('This file has only image subtitles (PGS), which cannot be shown here. Drop an .srt file.');
  } catch {
    // Not a Matroska file (MP4 and others): only dropped subtitle files.
    if (!scan.signal.aborted) setSubtitleMsg(null);
  }
}

function resetSubtitles() {
  subtitleScan?.abort();
  subtitleStore.clear();
  setSubtitleTracks([]);
  setSubtitleTrack(null);
  setSubtitleCues([]);
  setSubtitleDelay(0);
  setSubtitleMsg(null);
}
const [loadingMsg, setLoadingMsg] = createSignal<string | null>(null);
const [errorMsg, setErrorMsg] = createSignal<string | null>(null);

const [playing, setPlaying] = createSignal(false);
const [currentTime, setCurrentTime] = createSignal(0);
const [scrubTarget, setScrubTarget] = createSignal<number | null>(null);
const [duration, setDuration] = createSignal(0);

const [framingMode, setFramingMode] = createSignal<FramingMode>('cover-deck');
const [deckWidth, setDeckWidth] = createSignal(480); // right control deck width in cover-deck: half the screen by default

/** Knob turns needed for one step of a discrete knob (visual FX), so it is hard to skip a choice. */
const DETENT = 20; // the encoders send about 210 ticks per turn, so one step every ~35 degrees
const detentAcc = new Map<string, number>();
/** Accumulate a knob's turns and return whole steps (+1, -1 or 0); reversing direction starts over. */
function detent(id: string, d: number): number {
  let acc = detentAcc.get(id) ?? 0;
  if (Math.sign(acc) !== Math.sign(d)) acc = 0;
  acc += d;
  const steps = Math.trunc(acc / DETENT);
  detentAcc.set(id, acc - steps * DETENT);
  return steps;
}
const [autoCropBars, setAutoCropBars] = createSignal(true);

const [speed, setSpeed] = createSignal(1.0);
const [pitch, setPitch] = createSignal(0);          // -12..+12 semitones, voice character kept
const [formant, setFormant] = createSignal(0);      // -12..+12 semitones: voice size, pitch unchanged
const [dialogue, setDialogue] = createSignal(false); // compress loud and quiet together for clear speech
const [tapeLink, setTapeLink] = createSignal(false);
const [djFilter, setDjFilter] = createSignal(0);    // -1..+1
const [echoAmt, setEchoAmt] = createSignal(0);      // 0..0.85
const [driveAmt, setDriveAmt] = createSignal(0);    // 0..1 saturation ("deep fry" for the ears)
const [zoom, setZoom] = createSignal(1.0);          // 1.0..3.0
const [panY, setPanY] = createSignal(0.42);         // 0..1 (0.42 slightly favors eyes/faces!)
const [visualFx, setVisualFx] = createSignal<VisualFx>('clean');
const [volume, setVolume] = createSignal(1.0);      // 0..2.0
const [muted, setMuted] = createSignal(false);
const [audioState, setAudioState] = createSignal<AudioEngineState>('off');
const [audioMode, setAudioMode] = createSignal<'fx' | 'direct'>('fx');
const [audioPeak, setAudioPeak] = createSignal(0);
const [silentFxWarning, setSilentFxWarning] = createSignal(false);
const [padMode, setPadMode] = createSignal<PadMode>('fx');
const [cues, setCues] = createSignal<Array<number | null>>(Array(8).fill(null));

// ── Media & Canvas Scratch State ──
function createVideoElement(): HTMLVideoElement {
  const v = document.createElement('video');
  v.playsInline = true;
  v.preload = 'auto';
  v.muted = false;
  v.volume = 1.0;
  v.setAttribute('aria-hidden', 'true');
  Object.assign(v.style, {
    position: 'fixed',
    left: '-9999px',
    top: '-9999px',
    width: '1px',
    height: '1px',
    opacity: '0',
    pointerEvents: 'none',
  });
  if (typeof document !== 'undefined' && document.body) {
    document.body.appendChild(v);
  }
  v.addEventListener('loadedmetadata', () => {
    if (v !== video) return;
    if (Number.isFinite(v.duration)) {
      setDuration(v.duration);
    }
    setLoadingMsg(null);
  });
  v.addEventListener('playing', () => {
    if (v !== video) return;
    setPlaying(true);
    setLoadingMsg(null);
  });
  v.addEventListener('pause', () => {
    if (v !== video) return;
    setPlaying(false);
  });
  v.addEventListener('waiting', () => {
    if (v !== video) return;
    if (v.src && !hasLastFrame) setLoadingMsg('Buffering…');
  });
  v.addEventListener('canplay', () => {
    if (v !== video) return;
    setLoadingMsg(null);
  });
  v.addEventListener('seeked', () => {
    if (v === video && decodedAudio()) audioEngine.seekDecoded(getEffectiveTime());
  });
  v.addEventListener('error', () => {
    if (v !== video) return;
    const code = v.error?.code;
    if (code) setErrorMsg(`This browser cannot show this video's picture (error ${code}). MP4, MKV and WebM with H.264, HEVC, AV1 or VP9 work.`);
    setLoadingMsg(null);
  });
  return v;
}

let video = createVideoElement();

const audioEngine = new VideoAudioEngine();
audioEngine.onStateChange((st) => setAudioState(st));
if (import.meta.env.DEV) Object.assign(window, { videoAudio: audioEngine }); // for poking at the audio from DevTools
let objectUrl: string | null = null;
let pendingSeekTimer: number | null = null;
let lastPeakUiSec = 0;
let silentFxSeconds = 0;

// Auto-letterbox crop state (normalized fractions of videoHeight)
const cropState = { top: 0, bottom: 0, lastScan: 0 };
const scanCanvas = Object.assign(document.createElement('canvas'), { width: 64, height: 36 });
const scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true })!;

// Pad Ambilight 8×8 sampler
const padProbe = Object.assign(document.createElement('canvas'), { width: 8, height: 8 });
const padProbeCtx = padProbe.getContext('2d', { willReadFrequently: true })!;

// Time-Echo ring buffer (28 frames at 320×160 @ ~20fps -> ~1.4s history)
const ECHO_CAP = 28;
const echoFrames: Array<HTMLCanvasElement> = Array.from({ length: ECHO_CAP }, () =>
  Object.assign(document.createElement('canvas'), { width: 320, height: 160 }),
);
const echoCtxs = echoFrames.map((c) => c.getContext('2d')!);
let echoHead = 0;
let echoCount = 0;
let echoLastPush = 0;

// Last-frame hold buffer (keeps previous frame visible while seeking so screen never flashes black/buffering)
const lastFrameCanvas = Object.assign(document.createElement('canvas'), { width: W, height: 540 });
const lastFrameCtx = lastFrameCanvas.getContext('2d')!;
let hasLastFrame = false;
let lastFrameW = 0;
let lastFrameH = 0;

// Freeze-frame buffer + VFX scratch canvas
const freezeCanvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
const freezeCtx = freezeCanvas.getContext('2d')!;
let freezeCaptured = false;

const fxCanvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
const fxCtx = fxCanvas.getContext('2d', { willReadFrequently: true })!;

// Precomputed SuperView 80-strip non-linear mapping
const SV_STRIPS = 80;
const SV_LUT = Array.from({ length: SV_STRIPS }, (_, i) => {
  const u0 = (i / SV_STRIPS) * 2 - 1;
  const u1 = ((i + 1) / SV_STRIPS) * 2 - 1;
  const mapU = (u: number) => {
    const s = Math.sign(u);
    const a = Math.abs(u);
    // Center ~40% is nearly linear 1:1; periphery curves smoothly toward frame edge
    return s * (0.48 * a + 0.52 * Math.pow(a, 1.95));
  };
  return {
    dx: Math.floor((i / SV_STRIPS) * W),
    dw: Math.ceil(((i + 1) / SV_STRIPS) * W) - Math.floor((i / SV_STRIPS) * W),
    su0: (mapU(u0) + 1) * 0.5,
    su1: (mapU(u1) + 1) * 0.5,
  };
});

// Active momentary pads (hardware pads OR UI buttons)
const heldGags = new Set<number>();
const stutter = { active: false, anchor: 0, length: 0.16, lastJump: 0 };

// Transient HUD banner (for Cover Full or knob touch feedback)
const hud = { label: '', value: '', until: 0 };
function showHud(label: string, value: string, seconds = 1.9) {
  hud.label = label;
  hud.value = value;
  hud.until = performance.now() / 1000 + seconds;
}

// ── Helpers ──
function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00';
  const s = Math.floor(sec);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
}

function fmtSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.round(bytes / 1e3)} KB`;
}

function getEffectiveTime(): number {
  const t = video.currentTime || 0;
  const dur = duration();
  return dur > 0 ? clamp(t, 0, dur) : Math.max(0, t);
}

// ── Video Loading & Seeking ──
function revokeBlob() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

function resetCropAndEcho() {
  cropState.top = 0;
  cropState.bottom = 0;
  cropState.lastScan = 0;
  echoCount = 0;
  echoHead = 0;
  freezeCaptured = false;
  hasLastFrame = false;
  setScrubTarget(null);
  if (pendingSeekTimer !== null) {
    clearTimeout(pendingSeekTimer);
    pendingSeekTimer = null;
  }
}

function ensureAudioUnlocked() {
  if (audioMode() === 'fx') {
    audioEngine.unlock(video);
  }
}

function setAudioRouting(next: 'fx' | 'direct') {
  if (next === audioMode()) return;
  const t = getEffectiveTime();
  const wasPlaying = !video.paused || playing();
  const curSrc = video.src;

  setAudioMode(next);
  setSilentFxWarning(false);
  silentFxSeconds = 0;

  if (next === 'fx') {
    // Fresh Direct <video> was never attached to Web Audio, so we can attach immediately with zero reload!
    audioEngine.unlock(video);
    video.muted = false;
    video.volume = 1.0;
    if (decodeSource) void attachDecoded(decodeSource);
    showHud('AUDIO', 'WEB AUDIO FX');
    return;
  }
  detachDecoded();

  // Switching FX -> Direct: replace the hijacked <video> element with a clean native <video> element
  const old = video;
  old.pause();
  old.removeAttribute('src');
  old.load();
  old.remove();

  video = createVideoElement();
  video.muted = muted();
  video.volume = clamp(volume(), 0, 1);

  if (curSrc) {
    video.src = curSrc;
    video.load();
    video.currentTime = t;
    if (wasPlaying) void startPlay();
  }
  showHud('AUDIO', 'DIRECT NATIVE');
}

/** Decode the file's audio in the browser. Falls back to the <video>'s own audio when it cannot. */
async function attachDecoded(source: Blob) {
  const gen = ++decodeGen;
  decodeSource = source;
  if (audioMode() !== 'fx') return;
  const tracks = await audioEngine.openDecoded(source);
  if (gen !== decodeGen) return;
  if (!tracks) {
    setDecodedAudio(false);
    video.muted = false;
    return;
  }
  setDecodedAudio(true);
  video.muted = true;
  setAudioTracks(tracks.map((t) => ({ index: t.index, streamIndex: t.index, lang: t.lang, title: t.title, codec: t.codec, channels: t.channels })));
  const eng = tracks.findIndex((t) => /^EN/.test(t.lang));
  const idx = eng >= 0 ? eng : 0;
  setAudioTrackIdx(idx);
  audioEngine.selectDecodedTrack(idx);
  audioEngine.seekDecoded(getEffectiveTime());
}

function detachDecoded() {
  decodeGen++;
  audioEngine.closeDecoded();
  setDecodedAudio(false);
}

async function startPlay() {
  try {
    if (audioMode() === 'fx') {
      audioEngine.unlock(video);
      video.muted = decodedAudio();
      video.volume = 1.0;
    } else {
      video.muted = muted();
      video.volume = clamp(volume(), 0, 1);
    }
    await video.play();
    if (audioMode() === 'fx') audioEngine.resume();
    setPlaying(true);
    setErrorMsg(null);
  } catch (err) {
    setErrorMsg(`Playback blocked: ${String(err)}`);
  }
}

function togglePlay() {
  ensureAudioUnlocked();
  if (!video.src) return;
  if (video.paused) {
    void startPlay();
    showHud('TRANSPORT', 'PLAY');
  } else {
    video.pause();
    setPlaying(false);
    showHud('TRANSPORT', 'PAUSE');
  }
}

const SUBTITLE_FILE = /\.(srt|vtt)$/i;

/**
 * Files picked or dropped: the first video plays (everything happens in the browser; nothing is
 * uploaded), and every .srt/.vtt file becomes a subtitle track. Subtitles alone add to the current video.
 */
function loadFiles(files: ArrayLike<File> | null | undefined) {
  const list = Array.from(files ?? []);
  const subs = list.filter((f) => SUBTITLE_FILE.test(f.name));
  const file = list.find((f) => !SUBTITLE_FILE.test(f.name));
  if (file) loadVideoFile(file);
  for (const sub of subs) void loadSubtitleFile(sub);
}

function loadVideoFile(file: File) {
  ensureAudioUnlocked();
  setErrorMsg(null);
  setLoadingMsg(null);
  setSilentFxWarning(false);
  silentFxSeconds = 0;
  revokeBlob();
  resetCropAndEcho();
  setAudioTracks([]);
  setAudioTrackIdx(0);
  resetSubtitles();
  setCues(Array(8).fill(null));

  detachDecoded();
  objectUrl = URL.createObjectURL(file);
  video.src = objectUrl;
  video.load();
  void attachDecoded(file);
  void scanEmbeddedSubtitles(file);
  setSourceLabel('Video Loaded');
  setSourceMeta(`${fmtSize(file.size)} · played in the browser, nothing uploaded`);
  void startPlay();
  showHud('VIDEO', 'LOADED', 2.0);
}

function commitSeekNow(targetSec: number) {
  const dur = duration();
  const clamped = dur > 0 ? clamp(targetSec, 0, Math.max(0, dur - 0.5)) : Math.max(0, targetSec);
  if (pendingSeekTimer !== null) {
    clearTimeout(pendingSeekTimer);
    pendingSeekTimer = null;
  }
  setScrubTarget(null);
  if (!video.src) return;
  setCurrentTime(clamped);
  try { video.currentTime = clamped; } catch { /* not seekable yet */ }
}

function commitPendingScrub() {
  const pending = scrubTarget();
  if (pending !== null && pendingSeekTimer !== null) commitSeekNow(pending);
}

/** Jump at once, or (while a knob or the jog wheel turns) after a short pause in turning. */
function seekTo(targetSec: number, immediate = false, debounceMs = 65) {
  const dur = duration();
  const clamped = dur > 0 ? clamp(targetSec, 0, Math.max(0, dur - 0.5)) : Math.max(0, targetSec);
  if (!video.src) {
    setCurrentTime(clamped);
    return;
  }
  if (immediate) {
    commitSeekNow(clamped);
    return;
  }
  setScrubTarget(clamped);
  if (pendingSeekTimer !== null) clearTimeout(pendingSeekTimer);
  pendingSeekTimer = window.setTimeout(() => commitSeekNow(clamped), Math.min(debounceMs, 120));
}

function switchAudioTrack(idx: number) {
  ensureAudioUnlocked();
  const tracks = audioTracks();
  if (idx < 0 || idx >= tracks.length || !decodedAudio()) return;
  setAudioTrackIdx(idx);
  audioEngine.selectDecodedTrack(idx);
  showHud('AUDIO', `${tracks[idx]!.lang} · ${tracks[idx]!.title}`);
}

// ── The 8 knobs above the screen, left to right: six for the sound, two for the picture ──
// Zoom and the framing mode are set-and-forget: they live in the panel (framing also on the last
// button under the screen).
interface KnobSpec {
  readonly id: string;
  readonly label: string;
  /** Short name for the meters on the Push screen. */
  readonly short: string;
  readonly color: number;
  readonly turn: (delta: number) => void;
  readonly value: () => string;
}

const signed = (v: number, digits = 1) => `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`;
const filterText = (v: number) => (Math.abs(v) < 0.04 ? 'OPEN' : v < 0 ? `LP ${Math.round(-v * 100)}%` : `HP ${Math.round(v * 100)}%`);

const KNOBS: ReadonlyArray<KnobSpec> = [
  {
    id: 'e1', label: 'SPEED', short: 'SPD', color: 0x38bdf8,
    turn: (d) => setSpeed(clamp(Math.round((speed() + d * 0.025) * 100) / 100, 0.25, 3.0)),
    value: () => `${speed().toFixed(2)}×`,
  },
  {
    id: 'e2', label: 'VOICE PITCH', short: 'PIT', color: 0xf472b6,
    turn: (d) => setPitch(clamp(pitch() + d * 0.25, -12, 12)),
    value: () => `${signed(pitch())} st`,
  },
  {
    // Formant = the size of the body that speaks. Pitch stays; + is a small cartoon, - is a giant.
    id: 'e3', label: 'VOICE SIZE', short: 'SIZ', color: 0x34d399,
    turn: (d) => { const next = clamp(formant() + d * 0.1, -12, 12); setFormant(Math.abs(next) < 0.15 ? 0 : next); },
    value: () => (formant() === 0 ? 'NATURAL' : `${formant() > 0 ? 'SMALL' : 'BIG'} ${signed(formant())}`),
  },
  {
    id: 'e4', label: 'DJ FILTER', short: 'FLT', color: 0xfacc15,
    turn: (d) => { const next = clamp(djFilter() + d * 0.02, -1, 1); setDjFilter(Math.abs(next) < 0.03 ? 0 : next); },
    value: () => filterText(djFilter()),
  },
  {
    id: 'e5', label: 'DUB ECHO', short: 'ECH', color: 0x7de6ff,
    turn: (d) => setEchoAmt(clamp(echoAmt() + d * 0.01, 0, 0.85)),
    value: () => (echoAmt() < 0.005 ? 'OFF' : `${Math.round((echoAmt() / 0.85) * 100)}%`),
  },
  {
    id: 'e6', label: 'DRIVE', short: 'DRV', color: 0xff551e,
    turn: (d) => setDriveAmt(clamp(driveAmt() + d * 0.012, 0, 1)),
    value: () => (driveAmt() < 0.005 ? 'CLEAN' : `${Math.round(driveAmt() * 100)}%`),
  },
  {
    id: 'e7', label: 'VISUAL FX', short: 'VFX', color: 0xc084fc,
    turn: (d) => {
      const step = detent('e7', d);
      if (!step) return;
      const cur = VISUAL_FX.findIndex((f) => f.id === visualFx());
      setVisualFx(VISUAL_FX[(((cur + step) % VISUAL_FX.length) + VISUAL_FX.length) % VISUAL_FX.length]!.id);
    },
    value: () => (VISUAL_FX.find((f) => f.id === visualFx())?.label ?? '').toUpperCase(),
  },
  {
    id: 'e8', label: 'PICTURE UP / DOWN', short: 'PAN', color: 0x60a5fa,
    turn: (d) => setPanY(clamp(panY() + d * 0.015, 0, 1)),
    value: () => `${Math.round(panY() * 100)}%`,
  },
];
const KNOB_BY_ID = new Map(KNOBS.map((k) => [k.id, k]));
const showKnob = (k: KnobSpec) => showHud(k.label, k.value());

function resetFx() {
  setSpeed(1.0);
  setPitch(0);
  setFormant(0);
  setTapeLink(false);
  setDjFilter(0);
  setEchoAmt(0);
  setDriveAmt(0);
  setZoom(1.0);
  setPanY(0.42);
  setVisualFx('clean');
  showHud('FX', 'ALL RESET');
}

function cycleFraming(delta = 1) {
  const idx = FRAMING_MODES.findIndex((m) => m.id === framingMode());
  const next = FRAMING_MODES[(idx + delta + FRAMING_MODES.length) % FRAMING_MODES.length]!;
  setFramingMode(next.id);
  showHud('FRAMING', next.short);
}

// ── Auto-Letterbox Detection ──
function maybeScanLetterbox(nowSec: number) {
  if (!autoCropBars() || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
  if (nowSec - cropState.lastScan < 1.5) return;
  cropState.lastScan = nowSec;

  const sw = scanCanvas.width;
  const sh = scanCanvas.height;
  scanCtx.drawImage(video, 0, 0, sw, sh);
  const data = scanCtx.getImageData(0, 0, sw, sh).data;

  const rowMaxLuma = (y: number) => {
    let maxL = 0;
    let sumL = 0;
    for (let x = 2; x < sw - 2; x++) {
      const p = (y * sw + x) * 4;
      const l = 0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]!;
      if (l > maxL) maxL = l;
      sumL += l;
    }
    return { maxL, avgL: sumL / (sw - 4) };
  };

  // Skip completely dark frames (fades to black) so we don't falsely crop
  let frameMax = 0;
  for (let y = Math.floor(sh * 0.3); y < Math.floor(sh * 0.7); y++) {
    const r = rowMaxLuma(y);
    if (r.maxL > frameMax) frameMax = r.maxL;
  }
  if (frameMax < 42) return;

  const maxBarRows = Math.floor(sh * 0.24);
  let topRows = 0;
  for (let y = 0; y < maxBarRows; y++) {
    const r = rowMaxLuma(y);
    if (r.maxL < 16 && r.avgL < 8) topRows = y + 1;
    else break;
  }
  let botRows = 0;
  for (let y = sh - 1; y >= sh - maxBarRows; y--) {
    const r = rowMaxLuma(y);
    if (r.maxL < 16 && r.avgL < 8) botRows = sh - y;
    else break;
  }

  // Require near-symmetric top & bottom bars (true letterboxing, not dark floor/ceiling!)
  if (topRows >= 2 && botRows >= 2 && Math.abs(topRows - botRows) <= 2) {
    const sym = Math.min(topRows, botRows);
    const frac = sym / sh;
    cropState.top += (frac - cropState.top) * 0.5;
    cropState.bottom += (frac - cropState.bottom) * 0.5;
  } else {
    // Relax back toward 0 on full-frame 16:9 content
    cropState.top *= 0.6;
    cropState.bottom *= 0.6;
    if (cropState.top < 0.015) cropState.top = 0;
    if (cropState.bottom < 0.015) cropState.bottom = 0;
  }
}

// ── Effective FX Calculation (Base Knobs + Momentary Gag Pads) ──
function getEffectiveFx() {
  let effSpeed = speed();
  let effPitch = pitch();
  let effTape = tapeLink();
  let effFilter = djFilter();
  let effEcho = echoAmt();
  let effZoom = zoom();
  let effVfx = visualFx();
  let effDrive = Math.max(driveAmt(), effVfx === 'deepfry' ? 0.55 : 0);
  let effVol = muted() ? 0 : volume();
  let frozen = false;

  let effFormant = formant();
  // Cartoon voices: shifting the formants along with the pitch is what makes a chipmunk or a demon.
  if (heldGags.has(92)) { effPitch = 7; effFormant = 7; }
  if (heldGags.has(93)) { effPitch = 12; effFormant = 9; }
  if (heldGags.has(94)) { effPitch = -7; effFormant = -5; }
  if (heldGags.has(95)) { effPitch = -11; effFormant = -9; }
  if (heldGags.has(96)) effSpeed = 0.5;
  if (heldGags.has(97)) effSpeed = 2.0;
  if (heldGags.has(98)) { effSpeed = 0.65; effTape = true; }
  if (heldGags.has(99)) { effSpeed = 1.5; effTape = true; }

  if (heldGags.has(86)) effFilter = -0.86;
  if (heldGags.has(87)) effFilter = 0.86;
  if (heldGags.has(88)) effEcho = 0.8;
  if (heldGags.has(89)) { effDrive = Math.max(effDrive, 0.9); effVfx = 'deepfry'; }
  if (heldGags.has(90)) effVol = 0;

  if (heldGags.has(76)) frozen = true;
  if (heldGags.has(77)) effVfx = 'glitch';
  if (heldGags.has(78)) effVfx = 'vhs';
  if (heldGags.has(79)) effVfx = 'deepfry';
  if (heldGags.has(80)) effVfx = 'thermal';
  if (heldGags.has(81)) effVfx = 'noir';
  if (heldGags.has(82)) effVfx = 'invert';
  if (heldGags.has(83)) effZoom = Math.max(effZoom, 2.2);

  return { effSpeed, effPitch, effFormant, effTape, effFilter, effEcho, effZoom, effVfx, effDrive, effVol, frozen };
}

interface VideoFrame {
  readonly el: CanvasImageSource;
  readonly w: number;
  readonly h: number;
}

function getVideoFrame(): VideoFrame | null {
  if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
    const tw = Math.min(960, video.videoWidth);
    const th = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * tw));
    if (lastFrameCanvas.width !== tw || lastFrameCanvas.height !== th) {
      lastFrameCanvas.width = tw;
      lastFrameCanvas.height = th;
    }
    lastFrameCtx.drawImage(video, 0, 0, tw, th);
    lastFrameW = tw;
    lastFrameH = th;
    hasLastFrame = true;
    return { el: video, w: video.videoWidth, h: video.videoHeight };
  }
  if (hasLastFrame && lastFrameW > 0 && lastFrameH > 0) {
    return { el: lastFrameCanvas, w: lastFrameW, h: lastFrameH };
  }
  return null;
}

function getSourceRect(vw: number, vh: number) {
  const topPx = autoCropBars() ? Math.round(vh * cropState.top) : 0;
  const botPx = autoCropBars() ? Math.round(vh * cropState.bottom) : 0;
  const sh = Math.max(16, vh - topPx - botPx);
  return { sx: 0, sy: topPx, sw: vw, sh };
}

// ── Canvas Drawing Helpers for the 960×160 Push 3 Display ──
function drawCroppedVideo(
  g: CanvasRenderingContext2D,
  frame: VideoFrame,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  mode: 'cover' | 'contain',
  zoomFactor: number,
  panYFrac: number,
) {
  const { sx, sy, sw, sh } = getSourceRect(frame.w, frame.h);
  const srcAspect = sw / sh;
  const dstAspect = dw / dh;

  g.save();
  g.beginPath();
  g.rect(dx, dy, dw, dh);
  g.clip();

  if (mode === 'contain' && zoomFactor <= 1.005) {
    let rw = dw;
    let rh = dh;
    if (srcAspect > dstAspect) rh = dw / srcAspect;
    else rw = dh * srcAspect;
    g.drawImage(frame.el, sx, sy, sw, sh, dx + (dw - rw) / 2, dy + (dh - rh) / 2, rw, rh);
  } else {
    // Scale to cover destination * zoomFactor, with Y-Pan sliding cleanly inside the cropped height
    const baseScale = mode === 'cover'
      ? Math.max(dw / sw, dh / sh)
      : Math.min(dw / sw, dh / sh);
    const k = baseScale * zoomFactor;
    const rw = sw * k;
    const rh = sh * k;
    const rx = dx + (dw - rw) / 2;
    const extraY = rh - dh;
    const ry = extraY > 0 ? dy - extraY * clamp(panYFrac, 0, 1) : dy + (dh - rh) / 2;
    g.drawImage(frame.el, sx, sy, sw, sh, rx, ry, rw, rh);
  }

  g.restore();
}

function drawRightDeck(
  g: CanvasRenderingContext2D,
  x: number,
  w: number,
  fx: ReturnType<typeof getEffectiveFx>,
  spectrum: Uint8Array,
  nowSec: number,
) {
  // Subtle dark instrument panel background + crisp left divider
  g.fillStyle = '#090b0f';
  g.fillRect(x, 0, w, H);
  g.fillStyle = 'rgba(255,255,255,0.11)';
  g.fillRect(x, 0, 1, H);

  const pad = 12;
  const ix = x + pad;
  const iw = w - pad * 2;
  const wide = w >= 360;

  // Row 1: Play state dot + Title + Audio track badge
  const isPlay = playing();
  const target = scrubTarget();
  g.fillStyle = target !== null
    ? `rgba(56, 189, 248, ${0.55 + 0.45 * Math.sin(nowSec * 12)})`
    : isPlay ? '#3be68c' : '#ff9f43';
  g.beginPath();
  g.arc(ix + 5, 16, 4, 0, Math.PI * 2);
  g.fill();

  const tracks = audioTracks();
  const trackTag = tracks[audioTrackIdx()]?.lang ?? 'LOC';
  const badgeW = 40;
  g.fillStyle = '#181e28';
  g.fillRect(ix + iw - badgeW, 8, badgeW, 16);
  text(g, trackTag.slice(0, 4), ix + iw - badgeW / 2, 16, { size: 10, weight: 700, color: '#7dd3fc', font: MONO });

  const maxTitleChars = Math.max(10, Math.floor((iw - badgeW - 22) / 7.2));
  const rawTitle = sourceLabel();
  const shortTitle = rawTitle.length > maxTitleChars ? `${rawTitle.slice(0, maxTitleChars - 1)}…` : rawTitle;
  text(g, shortTitle, ix + 15, 16, { size: 12, weight: 700, color: '#f2f5f9', align: 'left' });

  // Row 2: Timecode + Progress bar with Hot Cue ticks + Smooth Scrub Target Cursor
  const cur = currentTime();
  const dur = duration();
  const displayTime = target ?? cur;
  const pct = dur > 0 ? clamp(cur / dur, 0, 1) : 0;

  text(g, `${fmtTime(displayTime)} / ${fmtTime(dur)}`, ix, 35, {
    size: 11,
    weight: 600,
    color: target !== null ? '#38bdf8' : '#b9c3d0',
    align: 'left',
    font: MONO,
  });
  text(g, FRAMING_MODES.find((m) => m.id === framingMode())?.short ?? '', ix + iw, 35, { size: 10, weight: 700, color: '#f59e0b', align: 'right', font: MONO });

  // Timeline track
  const barY = 46;
  g.fillStyle = '#1b2029';
  g.fillRect(ix, barY, iw, 6);
  g.fillStyle = isPlay ? '#ff6a3d' : '#7b8798';
  g.fillRect(ix, barY, Math.round(iw * pct), 6);
  // Playhead cap
  g.fillStyle = '#ffffff';
  g.fillRect(ix + Math.round(iw * pct) - 1, barY - 2, 2, 10);

  // Scrub target preview range & bright cyan needle while rotating Jog wheel
  if (target !== null && dur > 0) {
    const tPct = clamp(target / dur, 0, 1);
    const curX = ix + Math.round(iw * pct);
    const tgtX = ix + Math.round(iw * tPct);
    g.fillStyle = 'rgba(56, 189, 248, 0.5)';
    g.fillRect(Math.min(curX, tgtX), barY, Math.max(2, Math.abs(tgtX - curX)), 6);
    g.fillStyle = '#38bdf8';
    g.fillRect(tgtX - 1, barY - 3, 3, 12);
  }

  // Hot cue markers
  const cueList = cues();
  if (dur > 0) {
    for (let i = 0; i < cueList.length; i++) {
      const ct = cueList[i];
      if (ct == null) continue;
      const cx = ix + Math.round(iw * clamp(ct / dur, 0, 1));
      g.fillStyle = '#38bdf8';
      g.fillRect(cx, barY - 2, 2, 10);
    }
  }

  // Row 3: one meter per sound knob, in knob order (they show the held gag pads too)
  const meters: Array<{ label: string; val: string; frac: number; color: string; bipolar?: boolean }> = [
    { label: 'SPD', val: `${fx.effSpeed.toFixed(2)}×${fx.effTape ? 'T' : ''}`, frac: (fx.effSpeed - 0.25) / 2.75, color: '#38bdf8' },
    { label: 'PIT', val: `${signed(fx.effPitch, 0)}st`, frac: (fx.effPitch + 12) / 24, color: '#f472b6', bipolar: true },
    { label: 'SIZ', val: `${signed(fx.effFormant, 0)}st`, frac: (fx.effFormant + 12) / 24, color: '#34d399', bipolar: true },
    { label: 'FLT', val: filterText(fx.effFilter), frac: (fx.effFilter + 1) / 2, color: '#facc15', bipolar: true },
    { label: 'ECH', val: `${Math.round((fx.effEcho / 0.85) * 100)}%`, frac: fx.effEcho / 0.85, color: '#7de6ff' },
    { label: 'DRV', val: `${Math.round(fx.effDrive * 100)}%`, frac: fx.effDrive, color: '#ff551e' },
  ];

  const mTop = 61;
  const rowH = 11;
  const splitW = wide ? Math.floor(iw * 0.56) : iw;

  meters.forEach((m, idx) => {
    const ry = mTop + idx * rowH;
    text(g, m.label, ix, ry + 5, { size: 10, weight: 700, color: '#7c8796', align: 'left', font: MONO });
    text(g, m.val, ix + splitW, ry + 5, { size: 10, weight: 600, color: '#e6ecf5', align: 'right', font: MONO });

    const bx = ix + 28;
    const bw = Math.max(36, splitW - 86);
    g.fillStyle = '#181d26';
    g.fillRect(bx, ry + 3, bw, 4);
    g.fillStyle = m.color;
    if (m.bipolar) {
      const mid = bx + bw / 2;
      const curX = bx + clamp(m.frac, 0, 1) * bw;
      g.fillRect(Math.min(mid, curX), ry + 3, Math.max(2, Math.abs(curX - mid)), 4);
    } else {
      g.fillRect(bx, ry + 3, Math.max(2, bw * clamp(m.frac, 0, 1)), 4);
    }
  });

  // Mini FFT Audio Spectrum (on the bottom if narrow, or beside meters if wide!)
  const specX = wide ? ix + splitW + 14 : ix;
  const specY = wide ? 64 : 130;
  const specW = wide ? iw - splitW - 14 : iw - 74;
  const specH = wide ? 82 : 22;
  const bars = wide ? 18 : 16;
  const gap = 2;
  const barW = Math.max(2, (specW - gap * (bars - 1)) / bars);

  for (let i = 0; i < bars; i++) {
    const v = (spectrum[Math.min(spectrum.length - 1, i + 1)] ?? 0) / 255;
    const bh = Math.max(2, Math.round(v * specH));
    const hue = 195 + (i / bars) * 145;
    g.fillStyle = `hsl(${hue}, 88%, ${48 + v * 22}%)`;
    g.fillRect(specX + i * (barW + gap), specY + specH - bh, barW, bh);
  }

  // Bottom-right VFX + Zoom readout pill
  if (!wide) {
    const vfxLabel = fx.effVfx === 'clean' ? `Z ${fx.effZoom.toFixed(2)}×` : fx.effVfx.toUpperCase();
    g.fillStyle = fx.effVfx === 'clean' ? '#161b24' : '#3a1b2e';
    g.fillRect(ix + iw - 66, 130, 66, 22);
    text(g, vfxLabel, ix + iw - 33, 141, { size: 10, weight: 700, color: fx.effVfx === 'clean' ? '#aeb8c6' : '#f9a8d4', font: MONO });
  } else {
    text(g, `VFX ${fx.effVfx.toUpperCase()} · PAN ${Math.round(panY() * 100)}% · ZOOM ${fx.effZoom.toFixed(2)}×`, ix, 144, {
      size: 10,
      weight: 600,
      color: '#9aa5b4',
      align: 'left',
      font: MONO,
    });
  }
}

function drawLeftSpectrum(g: CanvasRenderingContext2D, w: number, spectrum: Uint8Array) {
  g.fillStyle = '#090b0f';
  g.fillRect(0, 0, w, H);
  g.fillStyle = 'rgba(255,255,255,0.1)';
  g.fillRect(w - 1, 0, 1, H);

  text(g, 'AUDIO SPECTRUM', 12, 16, { size: 10, weight: 700, color: '#788496', align: 'left', font: MONO });
  const bars = 22;
  const gx = 12;
  const gw = w - 24;
  const gap = 3;
  const bw = Math.max(3, (gw - gap * (bars - 1)) / bars);
  const topY = 30;
  const maxH = 104;
  for (let i = 0; i < bars; i++) {
    const v = (spectrum[Math.min(spectrum.length - 1, i + 1)] ?? 0) / 255;
    const bh = Math.max(4, Math.round(v * maxH));
    const hue = 205 + (i / bars) * 140;
    g.fillStyle = `hsl(${hue}, 88%, ${48 + v * 22}%)`;
    g.fillRect(gx + i * (bw + gap), topY + maxH - bh, bw, bh);
  }
  const st = playing() ? `PLAY ${speed().toFixed(2)}×` : 'PAUSED';
  text(g, st, 12, 148, { size: 10, weight: 700, color: playing() ? '#38bdf8' : '#f59e0b', align: 'left', font: MONO });
  text(g, padMode() === 'fx' ? 'PADS: FX' : 'PADS: AMBI', w - 12, 148, { size: 10, weight: 700, color: '#94a3b8', align: 'right', font: MONO });
}

function applyVisualFx(g: CanvasRenderingContext2D, vfx: VisualFx, t: number, regionW: number) {
  if (vfx === 'clean') return;
  const rw = Math.min(W, Math.max(1, Math.round(regionW)));

  if (vfx === 'noir') {
    g.save();
    g.globalCompositeOperation = 'saturation';
    g.fillStyle = '#000';
    g.fillRect(0, 0, rw, H);
    g.globalCompositeOperation = 'overlay';
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(0, 0, rw, H);
    g.restore();
    return;
  }

  if (vfx === 'invert') {
    g.save();
    g.globalCompositeOperation = 'difference';
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, rw, H);
    g.restore();
    return;
  }

  if (vfx === 'vhs') {
    // Scanlines + subtle horizontal tracking bar + warm chroma bleed
    g.save();
    g.fillStyle = 'rgba(0,0,0,0.28)';
    for (let y = 0; y < H; y += 3) g.fillRect(0, y, rw, 1);
    const trackY = ((t * 46) % (H + 28)) - 14;
    g.fillStyle = 'rgba(255,255,255,0.14)';
    g.fillRect(0, trackY, rw, 8);
    g.globalCompositeOperation = 'screen';
    g.fillStyle = 'rgba(255, 30, 120, 0.12)';
    g.fillRect(0, 0, rw, H);
    text(g, `VHS · SP  ${fmtTime(currentTime())}`, 12, 16, { size: 11, weight: 700, color: 'rgba(255,255,255,0.78)', align: 'left', font: MONO });
    g.restore();
    return;
  }

  if (vfx === 'glitch') {
    fxCtx.drawImage(g.canvas, 0, 0, rw, H, 0, 0, rw, H);
    const shift = Math.round(5 + Math.sin(t * 27) * 5);
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.35;
    g.drawImage(fxCanvas, 0, 0, rw, H, shift, 0, rw, H);
    g.drawImage(fxCanvas, 0, 0, rw, H, -shift, 0, rw, H);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    // 3 jittery horizontal slice tears
    for (let i = 0; i < 3; i++) {
      const sy = Math.floor(Math.abs(Math.sin(t * (13 + i * 7) + i)) * (H - 18));
      const sh = 6 + ((i * 5) % 12);
      const dx = Math.round(Math.sin(t * 39 + i * 3) * 18);
      g.drawImage(fxCanvas, 0, sy, rw, sh, dx, sy, rw, sh);
    }
    g.restore();
    return;
  }

  if (vfx === 'deepfry') {
    const img = g.getImageData(0, 0, rw, H);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i]!, gg = d[i + 1]!, b = d[i + 2]!;
      // Crushed contrast + fiery saturation boost
      r = clamp((r - 95) * 1.9 + 145, 0, 255);
      gg = clamp((gg - 115) * 1.65 + 115, 0, 255);
      b = clamp((b - 135) * 1.45 + 75, 0, 255);
      d[i] = r; d[i + 1] = gg; d[i + 2] = b;
    }
    g.putImageData(img, 0, 0);
    return;
  }

  if (vfx === 'thermal') {
    const img = g.getImageData(0, 0, rw, H);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const l = (0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!) / 255;
      // Classic FLIR ironbow palette: deep indigo -> magenta -> orange -> yellow -> white
      let r = 0, gg = 0, b = 0;
      if (l < 0.25) { const u = l / 0.25; r = u * 80; gg = 0; b = 45 + u * 155; }
      else if (l < 0.55) { const u = (l - 0.25) / 0.3; r = 80 + u * 175; gg = u * 55; b = 200 - u * 120; }
      else if (l < 0.82) { const u = (l - 0.55) / 0.27; r = 255; gg = 55 + u * 185; b = 80 - u * 80; }
      else { const u = (l - 0.82) / 0.18; r = 255; gg = 240 + u * 15; b = u * 255; }
      d[i] = r; d[i + 1] = gg; d[i + 2] = b;
    }
    g.putImageData(img, 0, 0);
  }
}

function drawHudOverlay(g: CanvasRenderingContext2D, nowSec: number) {
  if (nowSec > hud.until || !hud.label) return;
  const alpha = clamp((hud.until - nowSec) / 0.35, 0, 1);
  g.save();
  g.globalAlpha = alpha;
  const w = 290;
  const h = 34;
  const x = (W - w) / 2;
  const y = H - h - 10;
  g.fillStyle = 'rgba(10, 12, 16, 0.86)';
  g.beginPath();
  g.roundRect(x, y, w, h, 8);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.lineWidth = 1;
  g.stroke();
  text(g, hud.label, x + 14, y + h / 2 + 0.5, { size: 11, weight: 700, color: '#94a3b8', align: 'left', font: MONO });
  text(g, hud.value, x + w - 14, y + h / 2 + 0.5, { size: 13, weight: 700, color: '#ffffff', align: 'right', font: MONO });
  g.restore();
}

// ── Demo Definition ──
export const videoDeck: Demo = {
  id: 'video',
  name: 'Video',
  color: [255, 96, 62],
  fullBleed: true,

  activate(app) {
    return Effect.gen(function* () {
      yield* app.useStripHost();
      const onGesture = () => audioEngine.resume();
      yield* Effect.sync(() => {
        window.addEventListener('pointerdown', onGesture, { passive: true });
        window.addEventListener('keydown', onGesture, { passive: true });
        for (const k of KNOBS) app.twin.markEncoder(k.id, k.color);
      });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          window.removeEventListener('pointerdown', onGesture);
          window.removeEventListener('keydown', onGesture);
          heldGags.clear();
          stutter.active = false;
          if (!video.paused) video.pause();
        }),
      );
    });
  },

  onEvent(ev, app) {
    // ── Encoders (Top 8 knobs + Jog + Volume) ──
    if (ev.type === 'encoder') {
      const d = ev.delta;
      const knob = KNOB_BY_ID.get(ev.id);
      if (knob) {
        knob.turn(d);
        showKnob(knob);
      } else if (ev.id === 'volume') {
        const next = clamp(volume() + d * 0.03, 0, 2.0);
        setVolume(next);
        if (next > 0 && muted()) setMuted(false);
        showHud('VOLUME', `${Math.round(next * 100)}%`);
      } else if (ev.id === 'jog') {
        const step = app.held.has('shift') ? 2 : 8;
        const base = scrubTarget() ?? getEffectiveTime();
        const dur = duration();
        const t = dur > 0 ? clamp(base + d * step, 0, Math.max(0, dur - 0.5)) : Math.max(0, base + d * step);
        seekTo(t, false, 400);
        const delta = Math.round(t - getEffectiveTime());
        const sign = delta >= 0 ? '+' : '';
        showHud('JOG', `${fmtTime(t)} (${sign}${delta}s)`, 1.5);
      }
      return;
    }

    // ── Capacitive Touch Release: commit Jog / Strip seek immediately when fingers lift ──
    if (ev.type === 'touch' && !ev.touched && (ev.id === 'jog' || ev.id === 'strip')) {
      commitPendingScrub();
      return;
    }
    // Touch a knob (without turning it) to see what it controls.
    if (ev.type === 'touch' && ev.touched) {
      const knob = KNOB_BY_ID.get(ev.id);
      if (knob) showKnob(knob);
      return;
    }

    // ── Touch Strip: full-movie timeline scrub ──
    if (ev.type === 'strip') {
      const dur = duration();
      if (dur > 0) {
        const t = clamp(ev.value, 0, 1) * dur;
        seekTo(t, false, 360);
        showHud('SCRUB', `${fmtTime(t)} / ${fmtTime(dur)}`, 1.4);
      }
      return;
    }

    // ── Buttons ──
    if (ev.type === 'button' && ev.pressed) {
      if (ev.id === 'play' || ev.cc === 94) {
        togglePlay();
      } else if (ev.id === 'left' || ev.id === 'lower2') {
        const t = Math.max(0, getEffectiveTime() - 15);
        seekTo(t, true);
        showHud('JUMP', `-15s → ${fmtTime(t)}`);
      } else if (ev.id === 'right' || ev.id === 'lower3') {
        const t = getEffectiveTime() + 15;
        seekTo(t, true);
        showHud('JUMP', `+15s → ${fmtTime(t)}`);
      } else if (ev.id === 'lower1') {
        togglePlay();
      } else if (ev.id === 'lower4' && app.held.has('shift')) {
        cycleSubtitles();
      } else if (ev.id === 'lower4') {
        const tracks = audioTracks();
        if (tracks.length > 1) switchAudioTrack((audioTrackIdx() + 1) % tracks.length);
      } else if (ev.id === 'lower5') {
        setTapeLink(!tapeLink());
        showHud('TAPE LINK', tapeLink() ? 'ON (PITCH×SPD)' : 'OFF (INDEP)');
      } else if (ev.id === 'lower6') {
        const next: PadMode = padMode() === 'fx' ? 'ambilight' : 'fx';
        setPadMode(next);
        showHud('PADS', next === 'fx' ? 'GAG FX + CUES' : '8×8 AMBILIGHT');
      } else if (ev.id === 'lower7') {
        resetFx();
      } else if (ev.id === 'lower8') {
        cycleFraming(1);
      }
      return;
    }

    // ── 64 RGB Pads ──
    if (ev.type === 'pad') {
      if (padMode() !== 'fx') return;
      const n = ev.note;

      // Bottom row (36..43): 8 Hot Cues
      if (n >= 36 && n <= 43 && ev.action === 'down') {
        const idx = n - 36;
        const list = cues().slice();
        if (app.held.has('shift') || list[idx] == null) {
          const t = getEffectiveTime();
          list[idx] = t;
          setCues(list);
          showHud(`CUE ${idx + 1} SET`, fmtTime(t));
        } else {
          seekTo(list[idx]!, true);
          showHud(`CUE ${idx + 1}`, fmtTime(list[idx]!));
        }
        return;
      }

      // Momentary Gag FX pads
      const gag = GAG_BY_NOTE.get(n);
      if (!gag) return;
      if (ev.action === 'down') {
        if (n === 91) {
          const t = Math.max(0, getEffectiveTime() - 3);
          seekTo(t, true);
          showHud('REPLAY', '↺ -3s');
          return;
        }
        heldGags.add(n);
        if (n === 84 || n === 85) {
          stutter.active = true;
          stutter.anchor = Math.max(0, video.currentTime - 0.04);
          stutter.length = n === 84 ? 0.16 : 0.34;
          stutter.lastJump = performance.now();
        }
        showHud('GAG PAD', gag.short, 1.2);
      } else if (ev.action === 'up') {
        heldGags.delete(n);
        if ((n === 84 || n === 85) && !heldGags.has(84) && !heldGags.has(85)) {
          stutter.active = false;
        }
        if (n === 76) freezeCaptured = false;
      }
    }
  },

  tick(t, dt, app) {
    const eff = getEffectiveFx();

    // Sync HTMLVideoElement speed + preservesPitch
    if (video.src) {
      if (Math.abs(video.playbackRate - eff.effSpeed) > 0.005) {
        video.playbackRate = eff.effSpeed;
      }
      // FX audio: the video plays uncorrected and Signalsmith Stretch shifts the pitch back (better
      // than the browser's own time-stretch). Direct audio: the browser keeps the pitch itself.
      const wantsPreserve = audioMode() === 'direct' && !eff.effTape;
      const vAny = video as HTMLVideoElement & { preservesPitch?: boolean; webkitPreservesPitch?: boolean };
      if (vAny.preservesPitch !== wantsPreserve) vAny.preservesPitch = wantsPreserve;
      if (vAny.webkitPreservesPitch !== wantsPreserve) vAny.webkitPreservesPitch = wantsPreserve;

      // Momentary stutter loop
      if (stutter.active && !video.paused) {
        const nowMs = performance.now();
        if (nowMs - stutter.lastJump >= stutter.length * 1000) {
          stutter.lastJump = nowMs;
          try { video.currentTime = stutter.anchor; } catch { /* ignore */ }
        }
      }

      if (!video.paused && video.readyState >= 2) {
        setCurrentTime(getEffectiveTime());
      }
    }

    // Apply audio routing: Web Audio FX chain OR Direct Native <video> audio
    if (audioMode() === 'direct') {
      video.muted = eff.effVol <= 0.001;
      video.volume = clamp(eff.effVol, 0, 1);
      silentFxSeconds = 0;
      if (silentFxWarning()) setSilentFxWarning(false);
    } else {
      const wantMuted = decodedAudio();
      if (video.muted !== wantMuted) video.muted = wantMuted;
      if (video.volume !== 1.0) video.volume = 1.0;
      audioEngine.apply({
        pitchSemitones: eff.effPitch,
        formantSemitones: eff.effFormant,
        speed: eff.effSpeed,
        tape: eff.effTape,
        dialogue: dialogue(),
        filter: eff.effFilter,
        echo: eff.effEcho,
        drive: eff.effDrive,
        volume: eff.effVol,
      });

      if (decodedAudio()) audioEngine.syncDecoded(getEffectiveTime(), !video.paused && video.readyState >= 2);

      const peak = audioEngine.getPeakLevel();
      if (t - lastPeakUiSec >= 0.08) {
        lastPeakUiSec = t;
        setAudioPeak(peak);
      }
      if (!video.paused && video.readyState >= 2 && eff.effVol > 0.05 && audioState() === 'running') {
        if (peak > 0.002) {
          silentFxSeconds = 0;
          if (silentFxWarning()) setSilentFxWarning(false);
        } else {
          silentFxSeconds += Math.min(0.1, Math.max(0, dt));
          if (silentFxSeconds > 2.5 && !silentFxWarning()) {
            setSilentFxWarning(true);
          }
        }
      } else {
        silentFxSeconds = 0;
      }
    }

    // Scan letterbox bars periodically
    maybeScanLetterbox(t);

    // Push frame into Time-Echo ring buffer (~20fps when active)
    if (framingMode() === 'time-echo' && video.readyState >= 2 && video.videoWidth > 0 && !eff.frozen && t - echoLastPush >= 0.05) {
      echoLastPush = t;
      const ctx = echoCtxs[echoHead]!;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 320, 160);
      const { sx, sy, sw, sh } = getSourceRect(video.videoWidth, video.videoHeight);
      const k = Math.max(320 / sw, 160 / sh);
      const rw = sw * k;
      const rh = sh * k;
      ctx.drawImage(video, sx, sy, sw, sh, (320 - rw) / 2, -(rh - 160) * panY(), rw, rh);
      echoHead = (echoHead + 1) % ECHO_CAP;
      echoCount = Math.min(ECHO_CAP, echoCount + 1);
    }

    // ── Hardware LEDs: Transport + Lower buttons + Touch Strip + Pads ──
    app.leds.button(85, playing() ? [40, 255, 110] : [80, 35, 15]); // Play button
    app.leds.button(20, playing() ? [40, 255, 110] : [60, 65, 75]);
    app.leds.button(21, [90, 110, 140]);
    app.leds.button(22, [90, 110, 140]);
    app.leds.button(23, audioTracks().length > 1 ? [80, 195, 255] : [25, 30, 35]);
    app.leds.button(24, tapeLink() ? [220, 130, 255] : [45, 45, 55]);
    app.leds.button(25, padMode() === 'fx' ? [255, 110, 195] : [80, 220, 255]);
    app.leds.button(26, [180, 75, 55]);
    app.leds.button(27, [255, 185, 45]);

    // Touch Strip: 31-LED playback / scrub-target progress bar (bottom -> top)
    const dur = duration();
    const stripTime = scrubTarget() ?? currentTime();
    const frac = dur > 0 ? clamp(stripTime / dur, 0, 1) : 0;
    const lit = Math.round(frac * 31);
    const levels = Array.from({ length: 31 }, (_, i) => (i === lit - 1 ? 7 : i < lit ? 3 : 0));
    app.leds.setStrip(levels);

    // 64 RGB Pads: Sample 8×8 Ambilight from the rendered Push display
    padProbeCtx.imageSmoothingQuality = 'high';
    padProbeCtx.drawImage(app.screen.canvas, 0, 0, W, H, 0, 0, 8, 8);
    const px = padProbeCtx.getImageData(0, 0, 8, 8).data;
    const ambiColor = (n: number): RGB => {
      const i = n - 36;
      const p = ((7 - Math.floor(i / 8)) * 8 + (i % 8)) * 4;
      const boost = (v: number) => Math.min(255, Math.round(v * 1.55));
      return [boost(px[p]!), boost(px[p + 1]!), boost(px[p + 2]!)];
    };

    if (padMode() === 'ambilight') {
      for (let n = 36; n <= 99; n++) {
        app.leds.pad(n, app.pads.get(n)?.down ? [255, 255, 255] : ambiColor(n));
      }
    } else {
      const cueList = cues();
      for (let n = 36; n <= 99; n++) {
        if (n >= 36 && n <= 43) {
          const hasCue = cueList[n - 36] != null;
          app.leds.pad(n, app.pads.get(n)?.down ? [255, 255, 255] : hasCue ? [55, 195, 255] : [18, 26, 36]);
        } else {
          const gag = GAG_BY_NOTE.get(n);
          if (gag) {
            const active = heldGags.has(n);
            const [r, gg, b] = gag.color;
            app.leds.pad(n, active ? [255, 255, 255] : [Math.round(r * 0.48), Math.round(gg * 0.48), Math.round(b * 0.48)]);
          } else {
            // Middle 4 rows glow with live Ambilight!
            app.leds.pad(n, ambiColor(n));
          }
        }
      }
    }
  },

  draw(g, _app, t) {
    const eff = getEffectiveFx();
    const spectrum = audioEngine.getSpectrum();
    const mode = framingMode();

    g.fillStyle = '#050608';
    g.fillRect(0, 0, W, H);

    // Freeze frame gag: draw frozen snapshot straight onto display
    if (eff.frozen && freezeCaptured) {
      g.drawImage(freezeCanvas, 0, 0);
      text(g, '❄ FREEZE', 18, 20, { size: 13, weight: 800, color: '#7dd3fc', align: 'left', font: MONO });
      drawHudOverlay(g, t);
      return;
    }

    const frame = getVideoFrame();
    if (!frame) {
      // Idle splash on Push 3 display (only before first frame of a newly loaded file)
      text(g, 'PUSH 3 VIDEO DECK · 960×160 FULL-BLEED', W / 2, 54, { size: 18, weight: 800, color: '#ff7048' });
      const sub = loadingMsg() ?? errorMsg() ?? 'Select a video file or drop one in the left panel';
      text(g, sub, W / 2, 92, { size: 13, weight: 500, color: errorMsg() ? '#f87171' : '#9aa5b5' });
      text(g, 'K1 Speed · K2 Pitch · K3 Filter · K4 Zoom · K5 Pan · K6 VFX · K7 Formant · K8 Mode', W / 2, 128, {
        size: 11,
        weight: 600,
        color: '#677384',
        font: MONO,
      });
      return;
    }

    // The video's area on screen, where subtitles go.
    let subX = 0, subW = W;
    switch (mode) {
      case 'cover-deck': {
        const rw = clamp(deckWidth(), 220, 560);
        const vw = W - rw;
        subW = vw;
        drawCroppedVideo(g, frame, 0, 0, vw, H, 'cover', eff.effZoom, panY());
        applyVisualFx(g, eff.effVfx, t, vw);
        drawRightDeck(g, vw, rw, eff, spectrum, t);
        break;
      }

      case 'cover-full': {
        drawCroppedVideo(g, frame, 0, 0, W, H, 'cover', eff.effZoom, panY());
        applyVisualFx(g, eff.effVfx, t, W);
        // Subtle 3px bottom progress hairline (plus cyan scrub target marker when jogging)
        const dur = duration();
        if (dur > 0) {
          const curX = Math.round(W * clamp(currentTime() / dur, 0, 1));
          g.fillStyle = 'rgba(0,0,0,0.45)';
          g.fillRect(0, H - 3, W, 3);
          g.fillStyle = '#ff6a3d';
          g.fillRect(0, H - 3, curX, 3);
          const tgt = scrubTarget();
          if (tgt !== null) {
            const tgtX = Math.round(W * clamp(tgt / dur, 0, 1));
            g.fillStyle = '#38bdf8';
            g.fillRect(Math.min(curX, tgtX), H - 3, Math.max(3, Math.abs(tgtX - curX)), 3);
            g.fillRect(tgtX - 1, H - 7, 3, 7);
          }
        }
        break;
      }

      case 'contain-deck': {
        const { sw, sh } = getSourceRect(frame.w, frame.h);
        const fitW = Math.min(480, Math.max(260, Math.round((sw / sh) * H)));
        drawCroppedVideo(g, frame, 0, 0, fitW, H, 'contain', eff.effZoom, panY());
        subW = fitW;
        applyVisualFx(g, eff.effVfx, t, fitW);
        drawRightDeck(g, fitW, W - fitW, eff, spectrum, t);
        break;
      }

      case 'cockpit': {
        const { sw, sh } = getSourceRect(frame.w, frame.h);
        const centerW = clamp(Math.round((sw / sh) * H), 260, 420);
        const sideW = Math.floor((W - centerW) / 2);
        drawLeftSpectrum(g, sideW, spectrum);
        drawCroppedVideo(g, frame, sideW, 0, centerW, H, 'contain', eff.effZoom, panY());
        subX = sideW;
        subW = centerW;
        if (eff.effVfx !== 'clean') {
          g.save();
          g.beginPath();
          g.rect(sideW, 0, centerW, H);
          g.clip();
          applyVisualFx(g, eff.effVfx, t, sideW + centerW);
          g.restore();
        }
        drawRightDeck(g, sideW + centerW, W - (sideW + centerW), eff, spectrum, t);
        break;
      }

      case 'ambient-wings': {
        const { sx, sy, sw, sh } = getSourceRect(frame.w, frame.h);
        // Blurred ambient fill across full 960×160
        g.save();
        g.filter = 'blur(18px) brightness(0.45) saturate(1.3)';
        const bgK = Math.max(W / sw, H / sh);
        g.drawImage(frame.el, sx, sy, sw, sh, (W - sw * bgK) / 2, (H - sh * bgK) / 2, sw * bgK, sh * bgK);
        g.restore();

        // Crisp center (grows smoothly with Zoom)
        const baseW = Math.round((sw / sh) * H);
        const cw = Math.min(W, Math.round(baseW * eff.effZoom));
        const cx = Math.round((W - cw) / 2);
        drawCroppedVideo(g, frame, cx, 0, cw, H, eff.effZoom > 1.02 ? 'cover' : 'contain', 1.0, panY());
        applyVisualFx(g, eff.effVfx, t, W);
        break;
      }

      case 'time-echo': {
        const pw = 320;
        const getEcho = (framesAgo: number): HTMLCanvasElement | null => {
          if (echoCount === 0) return null;
          const ago = Math.min(framesAgo, echoCount - 1);
          const idx = (echoHead - 1 - ago + ECHO_CAP * 2) % ECHO_CAP;
          return echoFrames[idx]!;
        };
        const left = getEcho(16);  // ~-0.8s
        const right = getEcho(8);  // ~-0.4s

        if (left) {
          g.save();
          g.globalAlpha = 0.72;
          g.drawImage(left, 0, 0);
          g.restore();
        }
        drawCroppedVideo(g, frame, pw, 0, pw, H, 'cover', eff.effZoom, panY());
        subX = pw;
        subW = pw;
        if (right) {
          g.save();
          g.globalAlpha = 0.72;
          g.drawImage(right, pw * 2, 0);
          g.restore();
        }
        g.fillStyle = 'rgba(0,0,0,0.75)';
        g.fillRect(pw - 1, 0, 2, H);
        g.fillRect(pw * 2 - 1, 0, 2, H);

        text(g, '-0.8s', 10, 14, { size: 10, weight: 700, color: 'rgba(255,255,255,0.65)', align: 'left', font: MONO });
        text(g, '● LIVE', pw + 10, 14, { size: 10, weight: 700, color: '#38bdf8', align: 'left', font: MONO });
        text(g, '-0.4s', pw * 2 + 10, 14, { size: 10, weight: 700, color: 'rgba(255,255,255,0.65)', align: 'left', font: MONO });
        applyVisualFx(g, eff.effVfx, t, W);
        break;
      }

      case 'superview': {
        const { sx, sy, sw, sh } = getSourceRect(frame.w, frame.h);
        // Vertical crop driven by Zoom & Y-Pan so user can still frame faces
        const cropH = sh / eff.effZoom;
        const cropY = sy + (sh - cropH) * clamp(panY(), 0, 1);
        for (let i = 0; i < SV_STRIPS; i++) {
          const st = SV_LUT[i]!;
          const srcX = sx + st.su0 * sw;
          const srcW = Math.max(1, (st.su1 - st.su0) * sw);
          g.drawImage(frame.el, srcX, cropY, srcW, cropH, st.dx, 0, st.dw + 0.5, H);
        }
        applyVisualFx(g, eff.effVfx, t, W);
        break;
      }
    }

    if (subtitleTrack() !== null) {
      const shown = cuesAt(subtitleCues(), getEffectiveTime() - subtitleDelay());
      if (shown.length) drawSubtitles(g, shown.map((c) => c.text).join('\n'), subX, subW, H, subW < 400 ? 0.9 : 1);
    }

    // Capture freeze-frame right when Freeze pad is first pressed
    if (eff.frozen && !freezeCaptured) {
      freezeCtx.drawImage(g.canvas, 0, 0);
      freezeCaptured = true;
    }

    drawHudOverlay(g, t);
  },

  Panel: () => {
    const [dragging, setDragging] = createSignal(false);
    let fileInput: HTMLInputElement | undefined;

    const pressGag = (note: number) => {
      if (note === 91) {
        seekTo(Math.max(0, getEffectiveTime() - 3), true);
        return;
      }
      heldGags.add(note);
      if (note === 84 || note === 85) {
        stutter.active = true;
        stutter.anchor = Math.max(0, video.currentTime - 0.04);
        stutter.length = note === 84 ? 0.16 : 0.34;
        stutter.lastJump = performance.now();
      }
    };
    const releaseGag = (note: number) => {
      heldGags.delete(note);
      if ((note === 84 || note === 85) && !heldGags.has(84) && !heldGags.has(85)) stutter.active = false;
      if (note === 76) freezeCaptured = false;
    };

    return (
      <div class="vdeck">
        <h2>Video Deck</h2>
        <p>Full-bleed 960×160 cinema mode. The upper display buttons on Push switch to the other tabs.</p>

        {/* File chooser + drag and drop: the file stays on this computer */}
        <div
          class="card-box drop vdeck-section"
          classList={{ over: dragging() }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); loadFiles(e.dataTransfer?.files); }}
        >
          <button type="button" class="primary" onClick={() => fileInput?.click()}>
            Select Video File…
          </button>
          <p class="muted">Or drop a video here (MKV, MP4, WebM), with .srt or .vtt subtitle files if you have them.</p>
          <input
            ref={fileInput}
            type="file"
            multiple
            style={{ display: 'none' }}
            accept="video/*,.mkv,.webm,.srt,.vtt"
            onChange={(e) => { loadFiles(e.currentTarget.files); e.currentTarget.value = ''; }}
          />
        </div>

        {/* Now Playing + Transport + Timeline */}
        <div class="card-box vdeck-section">
          <div class="vdeck-now">
            <div class="vdeck-now-title">{sourceLabel()}</div>
            <div class="vdeck-now-meta">{sourceMeta()}</div>
            <Show when={loadingMsg()}><div class="vdeck-status warn">{loadingMsg()}</div></Show>
            <Show when={errorMsg()}><div class="vdeck-status err">{errorMsg()}</div></Show>
          </div>

          <div class="row">
            <button type="button" classList={{ active: playing() }} onClick={togglePlay}>
              {playing() ? 'Pause' : 'Play'}
            </button>
            <button type="button" onClick={() => seekTo(getEffectiveTime() - 15, true)}>-15s</button>
            <button type="button" onClick={() => seekTo(getEffectiveTime() + 15, true)}>+15s</button>
            <Show when={duration() > 600}>
              <button type="button" onClick={() => seekTo(getEffectiveTime() + 300, true)}>+5m</button>
            </Show>
            <button
              type="button"
              classList={{ active: muted() }}
              onClick={() => { ensureAudioUnlocked(); setMuted(!muted()); }}
            >
              {muted() ? 'Unmute' : 'Mute'}
            </button>
          </div>

          <Show when={audioMode() === 'fx' && audioState() === 'suspended'}>
            <button
              type="button"
              class="primary"
              onClick={() => {
                audioEngine.unlock(video);
                audioEngine.resume();
                if (video.paused && video.src) void startPlay();
              }}
            >
              Click to Enable Sound
            </button>
          </Show>

          <Show when={silentFxWarning()}>
            <button
              type="button"
              class="primary"
              onClick={() => setAudioRouting('direct')}
            >
              No FX Signal Detected: Switch to Direct Audio
            </button>
          </Show>

          <div class="vdeck-slider">
            <div class="vdeck-slider-head">
              <span>Volume (Push Vol)</span>
              <span class="mono">{muted() ? 'MUTED' : `${Math.round(volume() * 100)}%`}</span>
            </div>
            <input
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={muted() ? 0 : volume()}
              onInput={(e) => {
                ensureAudioUnlocked();
                const v = Number(e.currentTarget.value);
                setVolume(v);
                if (v > 0 && muted()) setMuted(false);
              }}
            />
          </div>

          <div class="vdeck-audio-bar">
            <div class="vdeck-slider-head">
              <span>Audio Output</span>
              <div class="row">
                <button
                  type="button"
                  class="vdeck-mini-btn"
                  classList={{ active: audioMode() === 'fx' }}
                  title="Routes audio through the effects: pitch, formant, filter, echo, limiter"
                  onClick={() => setAudioRouting('fx')}
                >
                  FX Chain
                </button>
                <button
                  type="button"
                  class="vdeck-mini-btn"
                  classList={{ active: audioMode() === 'direct' }}
                  title="Bypasses Web Audio completely and plays native browser <video> audio"
                  onClick={() => setAudioRouting('direct')}
                >
                  Direct
                </button>
                <button
                  type="button"
                  class="vdeck-mini-btn"
                  title="Play a short test chime to check browser speaker output"
                  onClick={() => audioEngine.playTestTone()}
                >
                  Test Tone
                </button>
              </div>
            </div>
            <div class="vdeck-meter-row">
              <div class="vdeck-meter">
                <div
                  class="vdeck-meter-fill"
                  style={{ width: `${audioMode() === 'fx' ? Math.min(100, Math.round(audioPeak() * 160)) : playing() && !muted() ? 100 : 0}%` }}
                  classList={{ direct: audioMode() === 'direct' }}
                />
              </div>
              <span class="mono vdeck-meter-label">
                {audioMode() === 'direct'
                  ? 'NATIVE'
                  : audioState() === 'running'
                    ? `${Math.round(audioPeak() * 100)}%`
                    : audioState().toUpperCase()}
              </span>
            </div>
          </div>

          <div class="vdeck-slider">
            <div class="vdeck-slider-head">
              <span>Timeline</span>
              <span class="mono">{fmtTime(scrubTarget() ?? currentTime())} / {fmtTime(duration())}</span>
            </div>
            <input
              type="range"
              min="0"
              max={Math.max(1, duration())}
              step="0.5"
              value={scrubTarget() ?? currentTime()}
              onInput={(e) => { ensureAudioUnlocked(); seekTo(Number(e.currentTarget.value), false, 320); }}
              onChange={(e) => { ensureAudioUnlocked(); seekTo(Number(e.currentTarget.value), true); }}
            />
          </div>

          <Show when={audioTracks().length > 1}>
            <div class="vdeck-field">
              <label class="muted">Audio Track</label>
              <select
                class="vdeck-select"
                value={audioTrackIdx()}
                onChange={(e) => switchAudioTrack(Number(e.currentTarget.value))}
              >
                <For each={audioTracks()}>
                  {(tr) => <option value={tr.index}>{tr.lang}: {tr.title}</option>}
                </For>
              </select>
            </div>
          </Show>

          <div class="vdeck-field">
            <label class="muted">Subtitles (Shift + Lower 4)</label>
            <select
              class="vdeck-select"
              value={subtitleTrack() ?? ''}
              onChange={(e) => selectSubtitleTrack(e.currentTarget.value || null)}
            >
              <option value="">Off</option>
              <For each={subtitleTracks()}>
                {(tr) => <option value={tr.id}>{tr.label === tr.lang ? tr.lang : `${tr.lang}: ${tr.label}`}</option>}
              </For>
            </select>
          </div>
          <Show when={subtitleMsg()}><div class="vdeck-status warn">{subtitleMsg()}</div></Show>
          <Show when={subtitleTracks().length === 0 && sourceLabel() !== 'No video loaded'}>
            <div class="muted">No subtitles in this video. Drop an .srt or .vtt file here.</div>
          </Show>
          <Show when={subtitleTrack() !== null}>
            <div class="vdeck-slider">
              <div class="vdeck-slider-head">
                <span class="muted">Subtitle delay</span>
                <span class="mono">{subtitleDelay() > 0 ? '+' : ''}{subtitleDelay().toFixed(1)} s</span>
              </div>
              <input type="range" min="-10" max="10" step="0.1" value={subtitleDelay()} onInput={(e) => setSubtitleDelay(Number(e.currentTarget.value))} />
            </div>
          </Show>
        </div>

        {/* Framing Mode Dropdown & Geometry */}
        <div class="card-box vdeck-section">
          <div class="vdeck-field">
            <label class="muted">Framing Mode (last button under the screen)</label>
            <select
              class="vdeck-select"
              value={framingMode()}
              onChange={(e) => {
                const next = e.currentTarget.value as FramingMode;
                setFramingMode(next);
                showHud('FRAMING', FRAMING_MODES.find((m) => m.id === next)?.short ?? next);
              }}
            >
              <For each={FRAMING_MODES}>
                {(m) => <option value={m.id}>{m.label}</option>}
              </For>
            </select>
          </div>

          <div class="vdeck-slider">
            <div class="vdeck-slider-head">
              <span>Zoom</span>
              <span class="mono">{zoom().toFixed(2)}×</span>
            </div>
            <input type="range" min="1" max="3" step="0.02" value={zoom()} onInput={(e) => setZoom(Number(e.currentTarget.value))} />
          </div>

          <div class="vdeck-slider">
            <div class="vdeck-slider-head">
              <span>Picture up / down (K8)</span>
              <span class="mono">{Math.round(panY() * 100)}%</span>
            </div>
            <input type="range" min="0" max="1" step="0.01" value={panY()} onInput={(e) => setPanY(Number(e.currentTarget.value))} />
          </div>

          <Show when={framingMode() === 'cover-deck'}>
            <div class="vdeck-slider">
              <div class="vdeck-slider-head">
                <span>Right Deck Width</span>
                <span class="mono">{deckWidth()}px (Video {W - deckWidth()}px)</span>
              </div>
              <input type="range" min="220" max="560" step="10" value={deckWidth()} onInput={(e) => setDeckWidth(Number(e.currentTarget.value))} />
            </div>
          </Show>

          <label class="toggle">
            <input type="checkbox" checked={autoCropBars()} onChange={(e) => setAutoCropBars(e.currentTarget.checked)} />
            Auto-strip baked letterbox bars
          </label>
        </div>

        {/* Knob FX Controls */}
        <div class="card-box vdeck-section">
          <div class="vdeck-slider-head">
            <label class="muted">Sound (Knobs 1-6) &amp; Visual FX (Knob 7)</label>
            <button type="button" class="vdeck-mini-btn" onClick={resetFx}>Reset FX</button>
          </div>

          <div class="vdeck-slider">
            <div class="vdeck-slider-head">
              <span>Speed (K1)</span>
              <span class="mono">{speed().toFixed(2)}×</span>
            </div>
            <input type="range" min="0.25" max="3" step="0.05" value={speed()} onInput={(e) => setSpeed(Number(e.currentTarget.value))} />
          </div>

          <div class="vdeck-slider">
            <div class="vdeck-slider-head">
              <span>Voice Pitch (K2)</span>
              <span class="mono">{pitch() >= 0 ? '+' : ''}{pitch().toFixed(1)} st</span>
            </div>
            <input type="range" min="-12" max="12" step="0.5" value={pitch()} onInput={(e) => setPitch(Number(e.currentTarget.value))} />
          </div>

          <div class="vdeck-slider">
            <div class="vdeck-slider-head">
              <span>Voice size: formant (K3)</span>
              <span class="mono">{Math.abs(formant()) < 0.15 ? 'natural' : `${formant() > 0 ? '+' : ''}${formant().toFixed(1)} st`}</span>
            </div>
            <input type="range" min="-12" max="12" step="0.5" value={formant()} onInput={(e) => setFormant(Number(e.currentTarget.value))} />
          </div>

          <label class="toggle">
            <input type="checkbox" checked={tapeLink()} onChange={(e) => setTapeLink(e.currentTarget.checked)} />
            Tape Link (speed changes pitch naturally)
          </label>
          <label class="toggle">
            <input type="checkbox" checked={dialogue()} onChange={(e) => setDialogue(e.currentTarget.checked)} />
            Dialogue boost (quiet voices louder, explosions softer)
          </label>

          <div class="vdeck-slider">
            <div class="vdeck-slider-head">
              <span>DJ Filter (K4)</span>
              <span class="mono">
                {Math.abs(djFilter()) < 0.04 ? 'OPEN' : djFilter() < 0 ? `LP ${Math.round(-djFilter() * 100)}%` : `HP ${Math.round(djFilter() * 100)}%`}
              </span>
            </div>
            <input type="range" min="-1" max="1" step="0.02" value={djFilter()} onInput={(e) => setDjFilter(Number(e.currentTarget.value))} />
          </div>

          <div class="vdeck-slider">
            <div class="vdeck-slider-head">
              <span>Dub Echo (K5)</span>
              <span class="mono">{Math.round(echoAmt() * 100)}%</span>
            </div>
            <input type="range" min="0" max="0.85" step="0.02" value={echoAmt()} onInput={(e) => setEchoAmt(Number(e.currentTarget.value))} />
          </div>

          <div class="vdeck-slider">
            <div class="vdeck-slider-head">
              <span>Drive (K6)</span>
              <span class="mono">{Math.round(driveAmt() * 100)}%</span>
            </div>
            <input type="range" min="0" max="1" step="0.02" value={driveAmt()} onInput={(e) => setDriveAmt(Number(e.currentTarget.value))} />
          </div>

          <div class="vdeck-field">
            <label class="muted">Visual FX (K7)</label>
            <select
              class="vdeck-select"
              value={visualFx()}
              onChange={(e) => setVisualFx(e.currentTarget.value as VisualFx)}
            >
              <For each={VISUAL_FX}>
                {(f) => <option value={f.id}>{f.label}</option>}
              </For>
            </select>
          </div>
        </div>

        {/* 64 Pads Mode + Mouse-playable Momentary Gag FX */}
        <div class="card-box vdeck-section">
          <div class="vdeck-slider-head">
            <label class="muted">64 Pads Mode</label>
            <div class="row">
              <button type="button" class="vdeck-mini-btn" classList={{ active: padMode() === 'fx' }} onClick={() => setPadMode('fx')}>Gag FX</button>
              <button type="button" class="vdeck-mini-btn" classList={{ active: padMode() === 'ambilight' }} onClick={() => setPadMode('ambilight')}>Ambilight</button>
            </div>
          </div>
          <p class="muted">Hold pads (or buttons below) for instant gags. Bottom pad row = 8 Hot Cues (Shift+Pad to overwrite).</p>
          <div class="vdeck-gag-grid">
            <For each={GAG_PADS}>
              {(g) => (
                <button
                  type="button"
                  class="vdeck-gag-btn"
                  style={{ '--gc': css(g.color) }}
                  title={g.label}
                  onPointerDown={() => pressGag(g.note)}
                  onPointerUp={() => releaseGag(g.note)}
                  onPointerLeave={() => releaseGag(g.note)}
                  onPointerCancel={() => releaseGag(g.note)}
                >
                  {g.short}
                </button>
              )}
            </For>
          </div>
        </div>
      </div>
    );
  },
};
