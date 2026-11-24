// 3D digital twin of the Push 3. Mirrors every hardware event and LED, shows the live
// screen canvas, and lets you press/turn/slide controls with the mouse ("virtual" events).
// Geometry is in millimeters (engine/twin/layout.ts), scaled into the scene by MM.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BUTTON_BY_ID, ENCODER_BY_ID, padNote, padPos, rgbOf, type LedState, type PushEvent, type RGBW } from '@push3/protocol';
import { DEVICE, DISPLAY, GROOVES, KEY_HEIGHT, KEYS, KNOBS, PADS, PANELS, STRIP, padCenter, type KeyGeo, type KnobGeo } from './twin/layout.ts';
import { legendTexture } from './twin/labels.ts';
import { knob, roundedPoly, roundedRect, slab } from './twin/shapes.ts';
import { grainOver, grainTexture, padGlowTexture } from './twin/textures.ts';

export type View = 'angled' | 'top' | 'front';
type Ctrl = { kind: 'pad'; note: number } | { kind: 'button'; cc: number; id: string; label: string } | { kind: 'encoder'; id: string } | { kind: 'strip' };
interface PadVis { mesh: THREE.Mesh; mat: THREE.MeshPhysicalMaterial; dot: THREE.Mesh; down: boolean; pressure: number; x: number; y: number; depth: number }
interface KeyVis { geo: KeyGeo; shade: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; legend: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> | null; bar: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null; rgb: boolean; pressed: boolean; depth: number }
interface EncoderVis { geo: KnobGeo; steps: number; spinner: THREE.Group; tick: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>; active: number; ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>; angle: number; shown: number; touched: boolean; mark: number | null; pressDepth: number; nudge: number }
type Drag = { ctrl: Ctrl; lastY: number; acc: number };

/** Scene units per millimeter: the device is about 13.5 units wide. */
const MM = 1 / 28;
const X = (mm: number) => (mm - DEVICE.w / 2) * MM;
const Z = (mm: number) => (mm - DEVICE.d / 2) * MM;
const SRGB = THREE.SRGBColorSpace;
const TOP = 0; // the top plate of the device is at y = 0

const VIEWS: Record<View, THREE.Vector3> = {
  angled: new THREE.Vector3(0, 1.08, 0.92).normalize(),
  top: new THREE.Vector3(0, 1, 0.0001).normalize(),
  front: new THREE.Vector3(0, 0.42, 1).normalize(),
};

/** Legend print when the key is dark, and the LED color when lit. */
const PRINT_OFF = new THREE.Color(0x44474c);
/** An unlit light bar: a pale grey diffuser strip. */
const BAR_OFF = new THREE.Color(0x4a4c50);

export class Twin {
  private readonly container: HTMLElement;
  private readonly listeners = new Set<(ev: PushEvent) => void>();
  private readonly pads = new Map<number, PadVis>();
  private readonly keys = new Map<number, KeyVis>();
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
  private stripLeds: Array<THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>> = [];
  private stripFinger!: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private stripZ0 = 0;
  private stripZ1 = 0;
  private view: View = 'angled';
  private userMoved = false;
  private drag: Drag | null = null;
  private hoverPending = false;
  private readonly rubber: THREE.MeshPhysicalMaterial;
  private readonly grain: THREE.Texture;

  constructor(container: HTMLElement, screenCanvas: HTMLCanvasElement) {
    this.container = container;
    this.grain = grainTexture();
    // The keys are soft-touch silicone: very matte, with a faint velvet sheen at grazing angles.
    this.rubber = new THREE.MeshPhysicalMaterial({
      color: 0x17181a, roughness: 0.86, metalness: 0, roughnessMap: this.grain,
      sheen: 0.25, sheenRoughness: 0.8, sheenColor: new THREE.Color(0x4c4f55),
    });
    this.#init(screenCanvas);
  }

  on(fn: (ev: PushEvent) => void) { this.listeners.add(fn); }
  #emit(ev: PushEvent) { ev.virtual = true; for (const fn of this.listeners) fn(ev); }

  #init(screenCanvas: HTMLCanvasElement) {
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    // Linear: each color channel clips on its own, like a camera sensor, so a bright orange LED
    // reads yellow at its core and stays orange at its edges (ACES and Neutral wash it to peach).
    r.toneMapping = THREE.LinearToneMapping;
    r.toneMappingExposure = 1.0;
    this.container.appendChild(r.domElement);

    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0x0b0d11);
    scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;

    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 120); // a far-off near plane keeps depth precise for thin decals
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 45;
    this.controls.target.set(0, 0, 0.3);
    this.controls.addEventListener('start', () => { this.userMoved = true; });

    // Neutral light, mostly from above like a product shoot under soft boxes.
    scene.add(new THREE.HemisphereLight(0xf2f2f2, 0x1c1c1e, 0.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(-3, 15, 3.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40 });
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.01;
    sun.shadow.radius = 3;
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0xe8eef8, 0.45);
    rim.position.set(6, 5, -9);
    scene.add(rim);

    // The floor only catches the device's shadow; the page stays dark around it.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.55 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -DEVICE.h * MM;
    ground.receiveShadow = true;
    scene.add(ground);

    this.#buildBody();
    this.#buildPads();
    this.#buildKnobs();
    this.#buildKeys();
    this.#buildDisplay(screenCanvas);
    this.#buildStrip();

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.16, 0.25, 1.4);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.#bindPointer();
    new ResizeObserver(() => this.resize()).observe(this.container);
    this.resize();
    this.setView('angled');
  }

  // ───────── geometry ─────────
  /** Add a mesh built in millimeters at (x, z) on the top plate. */
  #place<T extends THREE.Object3D>(obj: T, xMm: number, zMm: number, yMm = 0): T {
    obj.position.set(X(xMm), TOP + yMm * MM, Z(zMm));
    obj.scale.setScalar(MM);
    return obj;
  }

  #buildBody() {
    // Anodized aluminum chassis: a flat slab with straight sides and softly rounded edges.
    const mat = new THREE.MeshPhysicalMaterial({ color: 0x212225, roughness: 0.58, metalness: 0.25, roughnessMap: this.grain, clearcoat: 0.05, clearcoatRoughness: 0.7 });
    const blockH = DEVICE.h - DEVICE.base.h;
    const body = new THREE.Mesh(slab(roundedRect(DEVICE.w, DEVICE.d, DEVICE.r), blockH, DEVICE.edge, 5), mat);
    this.#place(body, DEVICE.w / 2, DEVICE.d / 2, -blockH);
    body.castShadow = body.receiveShadow = true;
    this.scene.add(body);
    // the base plate underneath, set in from the sides
    const { inset } = DEVICE.base;
    const base = new THREE.Mesh(slab(roundedRect(DEVICE.w - 2 * inset, DEVICE.d - 2 * inset, DEVICE.r), DEVICE.base.h, 0.3, 2), mat);
    this.#place(base, DEVICE.w / 2, DEVICE.d / 2, -DEVICE.h);
    base.castShadow = true;
    this.scene.add(base);

    // Each keypad is one rubber part in a cutout of the top plate; the gap around it reads as a thin
    // dark outline. Its keys are split by short grooves that stop before the edges.
    const cutMat = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.9 });
    for (const p of PANELS) {
      const cut = new THREE.Mesh(slab(roundedRect(p.w + 0.8, p.h + 0.8, p.r + 0.4), 0.12, 0), cutMat);
      this.#place(cut, p.x, p.y, 0.01);
      cut.receiveShadow = true;
      this.scene.add(cut);
      const pad = new THREE.Mesh(slab(roundedRect(p.w, p.h, p.r), KEY_HEIGHT, 0.22, 3), this.rubber);
      this.#place(pad, p.x, p.y);
      pad.castShadow = pad.receiveShadow = true;
      this.scene.add(pad);
    }
    const grooveMat = new THREE.MeshBasicMaterial({ color: 0x0b0b0c, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    for (const g of GROOVES) {
      const len = Math.hypot(g.x1 - g.x0, g.y1 - g.y0);
      const groove = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(len, 0.6, 0.3)), grooveMat);
      groove.rotation.x = -Math.PI / 2;
      groove.rotation.z = -Math.atan2(g.y1 - g.y0, g.x1 - g.x0);
      this.#place(groove, (g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2, KEY_HEIGHT + 0.01);
      this.scene.add(groove);
    }
    // The pad grid sits on a black bed.
    const bed = new THREE.Mesh(slab(roundedRect(PADS.bed.w, PADS.bed.h, 1.5), 0.2, 0), cutMat);
    this.#place(bed, PADS.bed.x, PADS.bed.y, 0.01);
    bed.receiveShadow = true;
    this.scene.add(bed);
  }

  #buildPads() {
    const geo = slab(roundedRect(PADS.w, PADS.h, PADS.r), PADS.height, 0.75, 4);
    const glow = padGlowTexture();
    // Planar UVs over the pad top, so the glow map lines up with the pad.
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute, pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / PADS.w + 0.5, -pos.getZ(i) / PADS.h + 0.5);
    const padGrain = grainOver(this.grain, PADS.w / 4, PADS.h / 4);
    const dotGeo = new THREE.CircleGeometry(2.2, 24);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const note = padNote(row, col);
        // Translucent silicone: matte, lit from inside by an RGB LED that is brightest at the center.
        const mat = new THREE.MeshPhysicalMaterial({
          color: 0x232427, roughness: 0.7, metalness: 0, roughnessMap: padGrain,
          sheen: 0.3, sheenRoughness: 0.7, sheenColor: new THREE.Color(0x55585f),
          emissiveMap: glow, emissive: 0x000000,
        });
        // Photos of lit pads clip to white (or yellow) in the middle while the edges stay saturated:
        // add a white-hot core that scales with the LED's brightness.
        mat.onBeforeCompile = (shader) => {
          shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            float core = pow(emissiveColor.r, 3.0);
            totalEmissiveRadiance += emissive * core * 2.0 + vec3(core * emissiveColor.r) * max(max(emissive.r, emissive.g), emissive.b) * 0.35;`);
        };
        const mesh = this.#place(new THREE.Mesh(geo, mat), ...padCenter(row, col));
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.userData.ctrl = { kind: 'pad', note } satisfies Ctrl;
        const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, toneMapped: false }));
        dot.rotation.x = -Math.PI / 2;
        dot.position.y = PADS.height + 0.05;
        dot.visible = false;
        mesh.add(dot);
        this.scene.add(mesh);
        this.pads.set(note, { mesh, mat, dot, down: false, pressure: 0, x: 0, y: 0.5, depth: 0 });
      }
    }
  }

  #buildKnobs() {
    // Satin black plastic with a soft rubbery top.
    const knobGrain = grainOver(this.grain, 24, 6); // lathe UVs run 0..1 around and along the profile
    const mat = new THREE.MeshPhysicalMaterial({ color: 0x1a1b1e, roughness: 0.42, metalness: 0.1, roughnessMap: knobGrain, clearcoat: 0.25, clearcoatRoughness: 0.45 });
    // the volume knob and the jog wheel: satin anodized metal (a soft highlight runs down their sides)
    const jogMat = new THREE.MeshPhysicalMaterial({ color: 0x232428, roughness: 0.48, metalness: 0.6, roughnessMap: knobGrain });
    // A mark that shows only while a knob is touched or turning: the real knobs are plain.
    const tickMat = new THREE.MeshStandardMaterial({ color: 0xa0a6ae, roughness: 0.6, transparent: true, opacity: 0, depthWrite: false });
    for (const spec of KNOBS) {
      const enc = ENCODER_BY_ID.get(spec.id);
      if (!enc) throw new Error(`twin layout: unknown knob ${spec.id}`);
      const group = this.#place(new THREE.Group(), spec.x, spec.y);
      const spinner = new THREE.Group();
      const body = new THREE.Mesh(knob(spec.profile), spec.id === 'jog' || spec.id === 'volume' ? jogMat : mat);
      body.castShadow = true;
      body.receiveShadow = true;
      spinner.add(body);
      // A faint mark so turning is visible on the twin (the real knobs are plain).
      const r = spec.profile.r, h = spec.profile.h;
      const tick = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.6, r * 0.09), 0.08, r * 0.42), tickMat.clone());
      tick.position.set(0, h - (spec.profile.dish ?? 0) * 0.2 + 0.02, -r * 0.5);
      spinner.add(tick);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(r * 1.18, 0.45, 8, 64),
        new THREE.MeshBasicMaterial({ color: 0x46e0ff, transparent: true, opacity: 0.95, toneMapped: false }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.3;
      ring.visible = false;
      group.add(spinner, ring);
      for (const m of [body, tick]) m.userData.ctrl = { kind: 'encoder', id: spec.id } satisfies Ctrl;
      this.scene.add(group);
      this.encoders.set(spec.id, { geo: spec, steps: enc.steps, spinner, tick, active: 0, ring, angle: 0, shown: 0, touched: false, mark: null, pressDepth: 0, nudge: 0 });
    }
  }

  #buildKeys() {
    const legendBase = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 } as const;
    for (const k of KEYS) {
      const spec = BUTTON_BY_ID.get(k.id);
      if (!spec) throw new Error(`twin layout: unknown button ${k.id}`);
      const ctrl: Ctrl = { kind: 'button', cc: spec.cc, id: spec.id, label: spec.label };
      // The key's area on its keypad: what the mouse picks, and a shade that darkens while pressed.
      const area = k.poly ? new THREE.ShapeGeometry(roundedPoly(k.poly, 0.6)) : new THREE.ShapeGeometry(roundedRect(k.w - 0.3, k.h - 0.3, 1));
      const shade = new THREE.Mesh(area, new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, ...legendBase }));
      shade.rotation.x = -Math.PI / 2;
      this.#place(shade, k.cx, k.cy, KEY_HEIGHT + 0.02);
      shade.userData.ctrl = ctrl;
      this.scene.add(shade);

      let legend: KeyVis['legend'] = null;
      if (k.legends.length) {
        const box = { x0: k.cx - k.w / 2, y0: k.cy - k.h / 2, w: k.w, h: k.h };
        const tex = legendTexture(k.legends, box);
        legend = new THREE.Mesh(
          new THREE.PlaneGeometry(k.w, k.h),
          new THREE.MeshStandardMaterial({ map: tex, color: PRINT_OFF, emissiveMap: tex, emissive: 0x000000, emissiveIntensity: 1.6, roughness: 0.7, ...legendBase }),
        );
        legend.rotation.x = -Math.PI / 2;
        this.#place(legend, k.cx, k.cy, KEY_HEIGHT + 0.04);
        this.scene.add(legend);
      }
      let bar: KeyVis['bar'] = null;
      if (k.bar) {
        // The light bar of a display button: a thin diffuser line across the key.
        bar = new THREE.Mesh(slab(roundedRect(k.bar.w, k.bar.h, k.bar.h / 2), 0.08, 0), new THREE.MeshBasicMaterial({ color: BAR_OFF, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
        this.#place(bar, k.cx, k.cy + k.bar.y, KEY_HEIGHT);
        this.scene.add(bar);
      }
      this.keys.set(spec.cc, { geo: k, shade, legend, bar, rgb: spec.rgb, pressed: false, depth: 0 });
    }
  }

  #buildDisplay(screenCanvas: HTMLCanvasElement) {
    // A black glass window, flush with the top plate, with the 960×160 panel behind it.
    const frame = new THREE.Mesh(slab(roundedRect(DISPLAY.w, DISPLAY.h, 1.2), 0.25, 0.1, 2), new THREE.MeshStandardMaterial({ color: 0x040405, roughness: 0.3 }));
    this.#place(frame, DISPLAY.x, DISPLAY.y);
    this.scene.add(frame);
    this.screenTex = new THREE.CanvasTexture(screenCanvas);
    this.screenTex.colorSpace = SRGB;
    this.screenTex.anisotropy = 8;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(DISPLAY.screen.w, DISPLAY.screen.h), new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false }));
    screen.rotation.x = -Math.PI / 2;
    this.#place(screen, DISPLAY.x + DISPLAY.screen.dx, DISPLAY.y + DISPLAY.screen.dy, 0.27);
    this.scene.add(screen);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(DISPLAY.w - 0.4, DISPLAY.h - 0.4), new THREE.MeshPhysicalMaterial({
      color: 0x000000, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.1, clearcoat: 0.6, clearcoatRoughness: 0.05, depthWrite: false,
    }));
    glass.rotation.x = -Math.PI / 2;
    this.#place(glass, DISPLAY.x, DISPLAY.y, 0.31);
    this.scene.add(glass);
  }

  #buildStrip() {
    // A recessed, glossy touch strip with a column of 31 small LEDs along its right side.
    const body = new THREE.Mesh(slab(roundedRect(STRIP.w, STRIP.h, 1.2), 0.2, 0.08, 2), new THREE.MeshPhysicalMaterial({ color: 0x0c0c0e, roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.2 }));
    this.#place(body, STRIP.x, STRIP.y, -0.05);
    body.userData.ctrl = { kind: 'strip' } satisfies Ctrl;
    this.scene.add(body);
    const ledTop = STRIP.y - STRIP.h / 2 + STRIP.ledInset, ledBottom = STRIP.y + STRIP.h / 2 - STRIP.ledInset;
    this.stripZ0 = Z(ledBottom);
    this.stripZ1 = Z(ledTop);
    const geo = slab(roundedRect(0.6, ((ledBottom - ledTop) / 30) * 1.02, 0.2), 0.05, 0);
    for (let i = 0; i < 31; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x1b1c1f, toneMapped: false }));
      this.#place(m, STRIP.x + STRIP.ledDx, ledBottom + ((ledTop - ledBottom) * i) / 30, 0.16);
      this.scene.add(m);
      this.stripLeds.push(m);
    }
    this.stripFinger = new THREE.Mesh(new THREE.CircleGeometry(0.17, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, toneMapped: false }));
    this.stripFinger.rotation.x = -Math.PI / 2;
    this.stripFinger.position.set(X(STRIP.x), 0.3 * MM, 0);
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
      const b = this.keys.get(ev.cc);
      if (b) b.pressed = ev.pressed;
      if (ev.id === 'jogPress' || ev.id === 'tempoPress') {
        const enc = this.encoders.get(ev.id === 'jogPress' ? 'jog' : 'tempo');
        if (enc) enc.pressDepth = ev.pressed ? 1.2 : 0;
      }
      const jog = this.encoders.get('jog');
      if (jog && (ev.id === 'jogLeft' || ev.id === 'jogRight')) jog.nudge = ev.pressed ? (ev.id === 'jogLeft' ? -1 : 1) : 0;
    } else if (ev.type === 'encoder') {
      const e = this.encoders.get(ev.id);
      if (e) { e.angle -= (ev.delta * Math.PI * 2) / e.steps; e.active = 1; }
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
      // The pads' RGB LEDs mix full white to a faint lavender (as photos of the device show).
      p.mat.emissive.setRGB((r / 255) * 0.95, (g / 255) * 0.88, b / 255, SRGB);
      p.mat.emissiveIntensity = lit ? 1.6 : 0;
      // Lit silicone takes on the LED color; dark silicone is a cool dark grey.
      // A lit pad is dominated by its LED: little reflected light, so its edges keep their color.
      if (lit) p.mat.color.setRGB(0.012 + (r / 255) * 0.03, 0.012 + (g / 255) * 0.03, 0.012 + (b / 255) * 0.03, SRGB);
      else p.mat.color.setHex(0x232427);
      p.mat.sheen = lit ? 0 : 0.3;
      return;
    }
    const k = this.keys.get(num);
    if (!k) return;
    const { legend, bar, rgb } = k;
    const [lr, lg, lb] = rgb ? [r, g, b] : [w, w, w];
    const lit = lr + lg + lb > 0;
    if (bar) {
      if (lit) bar.material.color.setRGB((lr / 255) * 1.8, (lg / 255) * 1.8, (lb / 255) * 1.8, SRGB);
      else bar.material.color.copy(BAR_OFF);
    }
    if (legend) {
      legend.material.emissive.setRGB(lr / 255, lg / 255, lb / 255, SRGB);
      legend.material.color.copy(lit ? new THREE.Color(0xffffff) : PRINT_OFF);
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
      const x = Math.max(-1, Math.min(1, (point.x - p.x) / ((PADS.w * MM) / 2)));
      const y = Math.max(0, Math.min(1, 0.5 - (point.z - p.z) / (PADS.h * MM)));
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
        const pt = planeHit(e, PADS.height * MM);
        if (pt) {
          const { x, y } = padLocal(d.ctrl.note, pt);
          const base = { type: 'pad', note: d.ctrl.note, ...padPos(d.ctrl.note), ch: 0 } as const;
          this.#emit({ ...base, action: 'bend', x });
          this.#emit({ ...base, action: 'slide', y });
        }
      } else if (d.ctrl.kind === 'strip') {
        const pt = planeHit(e, 0.1 * MM);
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
    const halfW = (DEVICE.w / 2) * MM, halfD = (DEVICE.d / 2) * MM;
    return 1.1 * Math.max(halfW / (tanV * a), (halfD * 1.12) / tanV);
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
      const target = p.down ? 0.3 + 0.7 * p.pressure : 0; // mm of travel
      p.depth = ease(p.depth, target, 30);
      p.mesh.position.y = TOP - p.depth * MM;
      p.dot.visible = p.down;
      if (p.down) {
        p.dot.position.x = p.x * (PADS.w * 0.42);
        p.dot.position.z = (0.5 - p.y) * (PADS.h * 0.84);
        p.dot.scale.setScalar(0.6 + p.pressure * 0.9);
      }
    }
    // A pressed key sinks a little into its keypad: the legend drops and the area darkens.
    for (const k of this.keys.values()) {
      k.depth = ease(k.depth, k.pressed ? 1 : 0, 30);
      k.shade.material.opacity = k.depth * 0.38;
      if (k.legend) k.legend.position.y = TOP + (KEY_HEIGHT + 0.04 - k.depth * 0.3) * MM;
    }
    for (const e of this.encoders.values()) {
      e.shown = ease(e.shown, e.angle, 25);
      e.active = Math.max(0, e.active - dt * 0.7);
      e.tick.material.opacity = ease(e.tick.material.opacity, e.touched ? 1 : Math.min(1, e.active * 2), 12);
      e.spinner.rotation.y = e.shown;
      e.spinner.position.y = -e.pressDepth;
      e.spinner.position.x = e.nudge * 1.5;
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
      this.stripLeds[i]!.material.color.setRGB(0.075 + k * 1.6, 0.075 + k * 1.6, 0.08 + k * 1.6);
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
