// 3D digital twin of the Push 3. Mirrors every hardware event and LED, shows the live
// screen canvas, and lets you press/turn/slide controls with the mouse ("virtual" events).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BUTTONS, ENCODERS, COLS, PAD_ROWS, PAD_SIZE, DISPLAY, STRIP, DEVICE, CENTER, padNote, padPos, type ButtonSpec, type EncoderSpec } from './layout.ts';
import { rgbOf, type RGBW } from './palette.ts';
import type { LedState } from './leds.ts';
import type { PushEvent } from './types.ts';

export type View = 'angled' | 'top' | 'front';
type Ctrl = { kind: 'pad'; note: number } | { kind: 'button'; cc: number; id: string; label: string } | { kind: 'encoder'; id: string } | { kind: 'strip' };
interface PadVis { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; dot: THREE.Mesh; down: boolean; pressure: number; x: number; y: number; depth: number }
interface ButtonVis { spec: ButtonSpec; cap: THREE.Mesh; label: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> | null; bar: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null; h: number; pressed: boolean; depth: number }
interface EncoderVis { spec: EncoderSpec; spinner: THREE.Group; ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>; angle: number; shown: number; touched: boolean; mark: number | null; pressDepth: number; nudge: number }
type Drag = { ctrl: Ctrl; lastY: number; acc: number };

const S = 1 / 100; // photo pixels → scene units
const X = (px: number) => (px - CENTER.x) * S;
const Z = (py: number) => (py - CENTER.y) * S;
const SRGB = THREE.SRGBColorSpace;

const VIEWS: Record<View, THREE.Vector3> = {
  angled: new THREE.Vector3(0, 1.08, 0.92).normalize(),
  top: new THREE.Vector3(0, 1, 0.0001).normalize(),
  front: new THREE.Vector3(0, 0.42, 1).normalize(),
};

function labelTexture(text: string, wUnits: number, dUnits: number, size = 1) {
  const cw = 256, ch = Math.max(48, Math.round((cw * dUnits) / wUnits));
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const g = c.getContext('2d')!;
  const lines = text.split('\n');
  let px = Math.min(ch * (lines.length > 1 ? 0.3 : 0.42), 64) * size;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const font = (p: number) => `600 ${p}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
  g.font = font(px);
  const widest = Math.max(...lines.map((l) => g.measureText(l).width));
  if (widest > cw * 0.86) { px *= (cw * 0.86) / widest; g.font = font(px); }
  g.fillStyle = '#fff';
  lines.forEach((l, i) => g.fillText(l, cw / 2, ch / 2 + (i - (lines.length - 1) / 2) * px * 1.1));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = SRGB;
  t.anisotropy = 8;
  return t;
}

export class Twin {
  private readonly container: HTMLElement;
  private readonly listeners = new Set<(ev: PushEvent) => void>();
  private readonly pads = new Map<number, PadVis>();
  private readonly buttons = new Map<number, ButtonVis>();
  private readonly encoders = new Map<string, EncoderVis>();
  private readonly ledState = new Map<string, LedState>();
  private stripLevels: Array<number> = new Array(31).fill(0);
  private stripHost = false;
  private readonly strip = { touched: false, value: 0.5 };
  private screenVersion = -1;
  private readonly clock = new THREE.Clock();
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private composer!: EffectComposer;
  private bloom!: UnrealBloomPass;
  private screenTex!: THREE.CanvasTexture;
  private stripLeds: Array<THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>> = [];
  private stripFinger!: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private stripZ0 = 0;
  private stripZ1 = 0;
  private view: View = 'angled';
  private userMoved = false;
  private drag: Drag | null = null;
  private hoverPending = false;

  constructor(container: HTMLElement, screenCanvas: HTMLCanvasElement) {
    this.container = container;
    this.#init(screenCanvas);
  }

  on(fn: (ev: PushEvent) => void) { this.listeners.add(fn); }
  #emit(ev: PushEvent) { ev.virtual = true; for (const fn of this.listeners) fn(ev); }

  #init(screenCanvas: HTMLCanvasElement) {
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    this.container.appendChild(r.domElement);

    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0x0b0d11);
    scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.45;

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 45;
    this.controls.target.set(0, 0, 0.4);
    this.controls.addEventListener('start', () => { this.userMoved = true; });

    scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x1a1d24, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.7);
    sun.position.set(-5, 14, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x14171d, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.56;
    ground.receiveShadow = true;
    scene.add(ground);

    this.#buildBody();
    this.#buildPads();
    this.#buildEncoders();
    this.#buildButtons();
    this.#buildDisplay(screenCanvas);
    this.#buildStrip();

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.55, 0.5, 0.86);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.#bindPointer();
    new ResizeObserver(() => this.resize()).observe(this.container);
    this.resize();
    this.setView('angled');
  }

  // ───────── geometry ─────────
  #buildBody() {
    const bw = (DEVICE.x1 - DEVICE.x0) * S, bd = (DEVICE.y1 - DEVICE.y0) * S;
    const body = new THREE.Mesh(new RoundedBoxGeometry(bw, 0.55, bd, 4, 0.13), new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.48, metalness: 0.45 }));
    body.position.set(X((DEVICE.x0 + DEVICE.x1) / 2), -0.275, Z((DEVICE.y0 + DEVICE.y1) / 2));
    body.castShadow = body.receiveShadow = true;
    this.scene.add(body);
    // recessed wells under the pads and around the screen
    const well = (x0: number, y0: number, x1: number, y1: number, color = 0x0d0e10) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry((x1 - x0) * S, (y1 - y0) * S), new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(X((x0 + x1) / 2), 0.001, Z((y0 + y1) / 2));
      m.receiveShadow = true;
      this.scene.add(m);
    };
    well(COLS[0]! - 56, PAD_ROWS[0]! - 42, COLS[7]! + 56, PAD_ROWS[7]! + 42);
  }

  #buildPads() {
    const geo = new RoundedBoxGeometry(PAD_SIZE.w * S, 0.12, PAD_SIZE.h * S, 2, 0.035);
    const dotGeo = new THREE.CircleGeometry(0.075, 24);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const note = padNote(row, col);
        const mat = new THREE.MeshStandardMaterial({ color: 0x2b2c30, roughness: 0.42, metalness: 0 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(X(COLS[col]!), 0.06, Z(PAD_ROWS[row]!));
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.userData.ctrl = { kind: 'pad', note };
        const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, toneMapped: false }));
        dot.rotation.x = -Math.PI / 2;
        dot.position.y = 0.062;
        dot.visible = false;
        mesh.add(dot);
        this.scene.add(mesh);
        this.pads.set(note, { mesh, mat, dot, down: false, pressure: 0, x: 0, y: 0.5, depth: 0 });
      }
    }
  }

  #buildEncoders() {
    const knobMat = new THREE.MeshStandardMaterial({ color: 0x232428, roughness: 0.55, metalness: 0.35 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x2c2e33, roughness: 0.35, metalness: 0.5 });
    const tickMat = new THREE.MeshBasicMaterial({ color: 0xdfe6ee });
    for (const e of ENCODERS) {
      const r = e.r * S, h = e.h * S;
      const group = new THREE.Group();
      group.position.set(X(e.x), 0, Z(e.y));
      const spinner = new THREE.Group();
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.93, r, h, 64), knobMat);
      knob.position.y = h / 2;
      knob.castShadow = true;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.86, r * 0.9, 0.012, 64), capMat);
      cap.position.y = h + 0.004;
      const tick = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.022, r * 0.08), 0.012, r * 0.5), tickMat);
      tick.position.set(0, h + 0.012, -r * 0.5);
      spinner.add(knob, cap, tick);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(r * 1.2, 0.024, 8, 64),
        new THREE.MeshBasicMaterial({ color: 0x46e0ff, transparent: true, opacity: 0.95, toneMapped: false }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.014;
      ring.visible = false;
      group.add(spinner, ring);
      for (const m of [knob, cap, tick]) m.userData.ctrl = { kind: 'encoder', id: e.id } satisfies Ctrl;
      this.scene.add(group);
      this.encoders.set(e.id, { spec: e, spinner, ring, angle: 0, shown: 0, touched: false, mark: null, pressDepth: 0, nudge: 0 });
    }
  }

  #buildButtons() {
    const capMat = new THREE.MeshStandardMaterial({ color: 0x202125, roughness: 0.5, metalness: 0.25 });
    for (const b of BUTTONS) {
      const w = b.w * S * 0.92, d = b.h * S * 0.88, h = 0.07;
      const cap = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(0.022, w / 5, d / 5)), capMat);
      cap.position.set(X(b.x), h / 2, Z(b.y));
      cap.castShadow = true;
      cap.userData.ctrl = { kind: 'button', cc: b.cc, id: b.id, label: b.label };
      let label: ButtonVis['label'] = null, bar: ButtonVis['bar'] = null;
      if (b.text) {
        const tex = labelTexture(b.text, w, d, b.size);
        label = new THREE.Mesh(
          new THREE.PlaneGeometry(w * 0.96, d * 0.96),
          new THREE.MeshStandardMaterial({ map: tex, transparent: true, color: 0x8e959e, emissiveMap: tex, emissive: 0x000000, emissiveIntensity: 2, roughness: 0.6 }),
        );
        label.rotation.x = -Math.PI / 2;
        label.position.y = h / 2 + 0.001;
        label.userData.ctrl = cap.userData.ctrl;
        cap.add(label);
      }
      if (b.bar) {
        bar = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.74, 0.045), new THREE.MeshBasicMaterial({ color: 0x2a2e35, toneMapped: false }));
        bar.rotation.x = -Math.PI / 2;
        bar.position.set(0, h / 2 + 0.002, -d * 0.12);
        bar.userData.ctrl = cap.userData.ctrl;
        cap.add(bar);
      }
      this.scene.add(cap);
      this.buttons.set(b.cc, { spec: b, cap, label, bar, h, pressed: false, depth: 0 });
    }
  }

  #buildDisplay(screenCanvas: HTMLCanvasElement) {
    const w = DISPLAY.w * S, h = w / 6;
    const bezel = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.18, h + 0.18), new THREE.MeshStandardMaterial({ color: 0x040405, roughness: 0.12, metalness: 0.1 }));
    bezel.rotation.x = -Math.PI / 2;
    bezel.position.set(X(DISPLAY.x), 0.002, Z(DISPLAY.y));
    this.scene.add(bezel);
    this.screenTex = new THREE.CanvasTexture(screenCanvas);
    this.screenTex.colorSpace = SRGB;
    this.screenTex.anisotropy = 8;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false }));
    screen.rotation.x = -Math.PI / 2;
    screen.position.set(X(DISPLAY.x), 0.004, Z(DISPLAY.y));
    this.scene.add(screen);
  }

  #buildStrip() {
    const w = STRIP.w * S, d = STRIP.h * S;
    const body = new THREE.Mesh(new RoundedBoxGeometry(w, 0.03, d, 2, 0.012), new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.15, metalness: 0.2 }));
    body.position.set(X(STRIP.x), 0.015, Z(STRIP.y));
    body.userData.ctrl = { kind: 'strip' };
    this.scene.add(body);
    this.stripZ0 = Z(STRIP.y + STRIP.h / 2 - 14); // bottom LED
    this.stripZ1 = Z(STRIP.y - STRIP.h / 2 + 14); // top LED
    const geo = new THREE.BoxGeometry(0.05, 0.01, 0.1);
    for (let i = 0; i < 31; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x1b1c1f, toneMapped: false }));
      m.position.set(X(STRIP.x) + w * 0.3, 0.034, this.stripZ0 + ((this.stripZ1 - this.stripZ0) * i) / 30);
      this.scene.add(m);
      this.stripLeds.push(m);
    }
    this.stripFinger = new THREE.Mesh(new THREE.CircleGeometry(0.17, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, toneMapped: false }));
    this.stripFinger.rotation.x = -Math.PI / 2;
    this.stripFinger.position.set(X(STRIP.x), 0.036, 0);
    this.stripFinger.visible = false;
    this.scene.add(this.stripFinger);
  }

  // ───────── input from the hardware (mirror) ─────────
  applyEvent(ev: PushEvent) {
    if (ev.type === 'pad') {
      const p = this.pads.get(ev.note);
      if (!p) return;
      if (ev.action === 'down') Object.assign(p, { down: true, pressure: Math.max(0.35, ev.velocity / 127), x: 0, y: 0.5 });
      else if (ev.action === 'up') Object.assign(p, { down: false, pressure: 0 });
      else if (ev.action === 'pressure') p.pressure = ev.pressure;
      else if (ev.action === 'bend') p.x = ev.x;
      else if (ev.action === 'slide') p.y = ev.y;
    } else if (ev.type === 'channelPressure') {
      for (const p of this.pads.values()) if (p.down) p.pressure = ev.pressure;
    } else if (ev.type === 'button') {
      const b = this.buttons.get(ev.cc);
      if (b) b.pressed = ev.pressed;
      if (ev.id === 'jogPress' || ev.id === 'tempoPress') {
        const enc = this.encoders.get(ev.id === 'jogPress' ? 'jog' : 'tempo');
        if (enc) enc.pressDepth = ev.pressed ? 0.05 : 0;
      }
      const jog = this.encoders.get('jog');
      if (jog && (ev.id === 'jogLeft' || ev.id === 'jogRight')) jog.nudge = ev.pressed ? (ev.id === 'jogLeft' ? -1 : 1) : 0;
    } else if (ev.type === 'encoder') {
      const e = this.encoders.get(ev.id);
      if (e) e.angle -= (ev.delta * Math.PI * 2) / e.spec.steps;
    } else if (ev.type === 'touch') {
      if (ev.id === 'strip') {
        this.strip.touched = ev.touched;
        if (!ev.touched) this.strip.value = 0.5; // default mode auto-returns to center
      } else {
        const e = this.encoders.get(ev.id);
        if (e) e.touched = ev.touched;
      }
    } else if (ev.type === 'strip') {
      this.strip.value = ev.value;
    }
  }

  setLed(key: string, s: LedState | ReadonlyArray<number>) {
    if (key === 'strip' || !('idx' in s)) { this.stripLevels = (s as ReadonlyArray<number>).slice(); return; }
    this.ledState.set(key, s);
    this.#paintLed(key, s, 0);
  }

  setStripHost(on: boolean) { this.stripHost = on; }

  /** Persistent colored ring on a knob (e.g. "tested" marker). null removes it. */
  markEncoder(id: string, color: number | null) { const e = this.encoders.get(id); if (e) e.mark = color; }

  #ledColor(s: LedState, t: number): RGBW {
    const to = rgbOf(s.idx);
    if (!s.ch) return to;
    const from = rgbOf(s.from);
    const beats = [0, 4, 6, 12, 24, 48][((s.ch - 1) % 5) + 1]! / 24; // duration in beats at 120 BPM
    const period = beats * 0.5;
    if (s.ch <= 5) return to; // one-shot: settles on the target
    const phase = (t % (period * 2)) / (period * 2);
    if (s.ch <= 10) { const k = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2); return from.map((v, i) => v + (to[i]! - v) * k) as unknown as RGBW; }
    return phase < 0.5 ? to : from;
  }

  #paintLed(key: string, s: LedState, t: number) {
    const [r, g, b, w] = this.#ledColor(s, t);
    const num = +key.slice(1);
    if (key[0] === 'n') {
      const p = this.pads.get(num);
      if (!p) return;
      const lit = r + g + b > 0;
      p.mat.emissive.setRGB(r / 255, g / 255, b / 255, SRGB);
      p.mat.emissiveIntensity = lit ? 2.6 : 0;
      if (lit) p.mat.color.setRGB(0.06 + (r / 255) * 0.4, 0.06 + (g / 255) * 0.4, 0.06 + (b / 255) * 0.4, SRGB);
      else p.mat.color.setRGB(0.17, 0.17, 0.19, SRGB);
      return;
    }
    const btn = this.buttons.get(num);
    if (!btn) return;
    const { spec, label, bar } = btn;
    if (bar) bar.material.color.setRGB(r ? (r / 255) * 1.6 : 0.03, g ? (g / 255) * 1.6 : 0.033, b ? (b / 255) * 1.6 : 0.038, SRGB);
    if (label) {
      if (spec.rgb) label.material.emissive.setRGB(r / 255, g / 255, b / 255, SRGB);
      else label.material.emissive.setRGB(w / 255, w / 255, w / 255, SRGB);
    }
  }

  // ───────── mouse → virtual events ─────────
  #bindPointer() {
    const el = this.renderer.domElement;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pick = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      return ray.intersectObjects(this.scene.children, true).find((h) => h.object.userData.ctrl) as (THREE.Intersection & { object: { userData: { ctrl: Ctrl } } }) | undefined;
    };
    const padLocal = (note: number, point: THREE.Vector3) => {
      const p = this.pads.get(note)!.mesh.position;
      const x = Math.max(-1, Math.min(1, (point.x - p.x) / ((PAD_SIZE.w * S) / 2)));
      const y = Math.max(0, Math.min(1, 0.5 - (point.z - p.z) / (PAD_SIZE.h * S)));
      return { x, y };
    };
    const planeHit = (e: PointerEvent, y: number) => {
      const rect = el.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      const pt = new THREE.Vector3();
      return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), pt) ? pt : null;
    };
    const stripValue = (pt: THREE.Vector3) => Math.max(0, Math.min(1, (this.stripZ0 - pt.z) / (this.stripZ0 - this.stripZ1)));

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const hit = pick(e);
      if (!hit) return;
      const ctrl: Ctrl = hit.object.userData.ctrl;
      this.controls.enabled = false;
      el.setPointerCapture(e.pointerId);
      this.drag = { ctrl, lastY: e.clientY, acc: 0 };
      if (ctrl.kind === 'pad') {
        this.#emit({ type: 'pad', action: 'down', note: ctrl.note, ...padPos(ctrl.note), velocity: 100, ch: 0 });
        this.#emit({ type: 'pad', action: 'pressure', note: ctrl.note, ...padPos(ctrl.note), pressure: 0.75, ch: 0 });
        const { x, y } = padLocal(ctrl.note, hit.point);
        this.#emit({ type: 'pad', action: 'bend', note: ctrl.note, ...padPos(ctrl.note), x, ch: 0 });
        this.#emit({ type: 'pad', action: 'slide', note: ctrl.note, ...padPos(ctrl.note), y, ch: 0 });
      } else if (ctrl.kind === 'button') {
        this.#emit({ type: 'button', id: ctrl.id, cc: ctrl.cc, label: ctrl.label, pressed: true });
      } else if (ctrl.kind === 'encoder') {
        this.#emit({ type: 'touch', id: ctrl.id, touched: true });
      } else if (ctrl.kind === 'strip') {
        this.#emit({ type: 'touch', id: 'strip', touched: true });
        this.#emit({ type: 'strip', value: stripValue(hit.point) });
      }
    });

    el.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d) {
        if (!this.hoverPending) {
          this.hoverPending = true;
          requestAnimationFrame(() => { this.hoverPending = false; el.style.cursor = pick(e) ? 'pointer' : 'grab'; });
        }
        return;
      }
      if (d.ctrl.kind === 'encoder') {
        d.acc += d.lastY - e.clientY;
        d.lastY = e.clientY;
        const steps = Math.trunc(d.acc / 3);
        if (steps) { d.acc -= steps * 3; this.#emit({ type: 'encoder', id: d.ctrl.id, delta: steps }); }
      } else if (d.ctrl.kind === 'pad') {
        const pt = planeHit(e, 0.12);
        if (pt) {
          const { x, y } = padLocal(d.ctrl.note, pt);
          const base = { type: 'pad', note: d.ctrl.note, ...padPos(d.ctrl.note), ch: 0 } as const;
          this.#emit({ ...base, action: 'bend', x });
          this.#emit({ ...base, action: 'slide', y });
        }
      } else if (d.ctrl.kind === 'strip') {
        const pt = planeHit(e, 0.03);
        if (pt) this.#emit({ type: 'strip', value: stripValue(pt) });
      }
    });

    const end = (e: PointerEvent) => {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      this.controls.enabled = true;
      try { el.releasePointerCapture(e.pointerId); } catch {}
      if (d.ctrl.kind === 'pad') this.#emit({ type: 'pad', action: 'up', note: d.ctrl.note, ...padPos(d.ctrl.note), ch: 0 });
      else if (d.ctrl.kind === 'button') this.#emit({ type: 'button', id: d.ctrl.id, cc: d.ctrl.cc, label: d.ctrl.label, pressed: false });
      else if (d.ctrl.kind === 'encoder') this.#emit({ type: 'touch', id: d.ctrl.id, touched: false });
      else if (d.ctrl.kind === 'strip') this.#emit({ type: 'touch', id: 'strip', touched: false });
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  // ───────── view ─────────
  setView(name: View) {
    this.view = name;
    this.userMoved = false;
    const dist = this.#fitDistance();
    this.camera.position.copy(this.controls.target).addScaledVector(VIEWS[name], dist);
    this.controls.update();
  }

  #fitDistance() {
    const a = this.camera.aspect || 1.5, tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    return 1.12 * Math.max(7.1 / (tanV * a), 6.2 / tanV);
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.userMoved) this.setView(this.view);
  }

  setBloom(on: boolean) { this.bloom.enabled = on; }

  // ───────── per frame ─────────
  render(screenVersion: number) {
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    const ease = (cur: number, target: number, k: number) => cur + (target - cur) * Math.min(1, dt * k);

    for (const p of this.pads.values()) {
      const target = p.down ? 0.025 + 0.055 * p.pressure : 0;
      p.depth = ease(p.depth, target, 30);
      p.mesh.position.y = 0.06 - p.depth;
      p.dot.visible = p.down;
      if (p.down) {
        p.dot.position.x = p.x * (PAD_SIZE.w * S * 0.42);
        p.dot.position.z = (0.5 - p.y) * (PAD_SIZE.h * S * 0.84);
        p.dot.scale.setScalar(0.6 + p.pressure * 0.9);
      }
    }
    for (const b of this.buttons.values()) {
      b.depth = ease(b.depth, b.pressed ? 0.035 : 0, 30);
      b.cap.position.y = b.h / 2 - b.depth;
    }
    for (const e of this.encoders.values()) {
      e.shown = ease(e.shown, e.angle, 25);
      e.spinner.rotation.y = e.shown;
      e.spinner.position.y = -e.pressDepth;
      e.spinner.position.x = e.nudge * 0.06;
      e.ring.visible = e.touched || !!e.mark;
      e.ring.material.color.set(e.touched ? 0x46e0ff : (e.mark ?? 0x46e0ff));
      e.ring.material.opacity = e.touched ? 0.95 : 0.55;
    }
    for (const [key, s] of this.ledState) if (s.ch >= 6) this.#paintLed(key, s, t);

    // touch strip: host-drawn LEDs, or Push's own point display
    for (let i = 0; i < 31; i++) {
      let level = this.stripLevels[i] ?? 0;
      if (!this.stripHost) level = Math.abs(i - Math.round(this.strip.value * 30)) <= 0 ? 7 : 0;
      const k = level / 7;
      this.stripLeds[i]!.material.color.setRGB(0.1 + k * 1.5, 0.1 + k * 1.5, 0.11 + k * 1.5);
    }
    this.stripFinger.visible = this.strip.touched;
    this.stripFinger.position.z = this.stripZ0 + (this.stripZ1 - this.stripZ0) * this.strip.value;

    if (screenVersion !== this.screenVersion) {
      this.screenVersion = screenVersion;
      this.screenTex.needsUpdate = true;
    }
    this.controls.update();
    this.composer.render();
  }
}
