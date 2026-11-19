/**
 * The views beyond Earth orbit: one body at a time ("a place"), and the solar system as a map.
 *
 * The tracker's own scene is built around the Earth and 19,000 satellites, and none of it
 * (the globe shader, the point cloud, the hash grid) means anything at Mars. So this is a
 * second, much simpler scene drawn through the same renderer and bloom (SceneKit.show):
 *
 *   a place   The body sits at the origin, always 6.371 scene units in radius — the size the
 *             Earth has in the tracker — so the camera, its limits and the close-up ground
 *             behave the same at every world. Inside a place everything is at TRUE scale:
 *             moons at their real distances and sizes, spacecraft on their real orbits, the
 *             parent planet hanging in a moon's sky. Keeping the body at the origin is also
 *             what keeps the picture steady: 32-bit GPU numbers cannot hold a Mars orbiter's
 *             position measured from the Sun.
 *   the map   The whole solar system cannot be drawn at true scale (the planets would be
 *             invisible specks), so distances from the Sun are squeezed with a logarithm and
 *             the bodies drawn large. DIRECTIONS are true: every planet and probe is on the
 *             right side of the Sun for the date on the clock.
 *
 * Both are lists of "items" (a body or a craft with a position this frame), so name tags,
 * picking, following and the 3D model of a selected craft are written once.
 *
 * Positions come from src/space (ICRF kilometres) and are turned into this scene's axes by
 * toWorld(): ICRF (x, y, z) → (x, z, −y), then rotated so that the place's north pole (or,
 * on the map, the pole of the planets' common plane) points up the screen.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { KIND_LABEL, type ModelKind } from '../../data/describe.ts';
import { BODIES, BODY_LIST } from '../../space/bodies.ts';
import { craftPeriodMs, craftPosition } from '../../space/deep.ts';
import { bodyAxes, bodyPosition, bodyRelative } from '../../space/ephem.ts';
import { IMAGERY } from '../../space/imagery.ts';
import type { Body, BodyId, Craft, Vec } from '../../space/types.ts';
import { easeIn, easeOut } from '../cameraRig.ts';
import { buildModel } from '../satModels.ts';
import type { SceneKit } from '../scene.ts';
import { addRing, createBody, glowTexture, MAX_OCCLUDERS, type BodyMesh } from './bodyMesh.ts';

export type Where = { kind: 'system' } | { kind: 'place'; body: BodyId };
export type Target = { kind: 'body'; body: Body } | { kind: 'craft'; craft: Craft };
export const targetKey = (target: Target): string => (target.kind === 'body' ? `body:${target.body.id}` : `craft:${target.craft.id}`);

export interface SpaceHost {
  /** The element the name tags are put in (it covers the canvas). */
  tags: HTMLElement;
  /** A body or craft was chosen with a click or a tap (null = empty space). */
  onPick(target: Target | null): void;
  /** …or asked for outright (double-click): go there. */
  onOpen(target: Target): void;
  isPhone(): boolean;
  /** Turn slowly round the body while nothing is being touched (the tracker's own setting). */
  drift(): boolean;
}

const R = 6.371; // radius of a place's body, scene units
const AU = 149597870.7;
const SUN_RADIUS_KM = 695700;
const UP = new THREE.Vector3(0, 1, 0);
const ORIGIN = new THREE.Vector3();
const DAY = 86400000;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// ---- the map's scale -------------------------------------------------------------------------
//
// Distance from the Sun, squeezed: equal steps on the map are equal RATIOS of distance, so
// Mercury to Mars and Jupiter to Neptune each get a fair share of the picture and Voyager 1,
// 170 times further out than the Earth, is still on it.
const MAP_SCALE = 30;
const mapRadius = (km: number): number => MAP_SCALE * Math.log(1 + km / AU / 0.3);
/** How large each body is drawn on the map, scene units (nothing like true scale; just "big, middling, small"). */
const MAP_SIZE: Partial<Record<BodyId, number>> = {
  sun: 5, mercury: 1.3, venus: 2, earth: 2.1, moon: 0.7, mars: 1.6,
  jupiter: 4.2, saturn: 3.5, uranus: 2.6, neptune: 2.5, pluto: 1.1,
};

interface Item {
  target: Target;
  key: string;
  pos: THREE.Vector3; // where it is this frame, world
  radius: number; // drawn radius (0 for a craft)
  tag: HTMLElement | null;
  mesh: BodyMesh | null;
  /** Crafts only: is it shown at all right now (the Sun's place hides the ones far out). */
  shown: boolean;
  centre: boolean;
}

interface Flight {
  elapsed: number;
  duration: number;
  fromOffset: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toOffset: THREE.Vector3;
  ease: (t: number) => number;
  /** Where the look-at point ends up, if not on whatever is being followed. */
  toTarget: THREE.Vector3 | null;
}

export class SpaceView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.5, 200000);
  readonly controls: OrbitControls;
  where: Where | null = null;
  focus: Target | null = null;

  private readonly kit: SceneKit;
  private readonly host: SpaceHost;
  private readonly backdrop: THREE.Group;
  private readonly frame = new THREE.Quaternion(); // scene-equatorial axes → this view's axes
  private readonly content = new THREE.Group(); // everything that belongs to the current view
  private items: Item[] = [];
  private crafts: Craft[] = [];
  private unitsPerKm = 1;
  private extent = 100; // how far out the view reaches, scene units
  private readonly sunDir = new THREE.Vector3(1, 0, 0); // towards the Sun, world (places only)
  private readonly sunSprite: THREE.Sprite;
  private readonly corona: THREE.Sprite;
  private readonly sunLight = new THREE.DirectionalLight(0xfff4e0, 2.4);
  private readonly fillLight = new THREE.DirectionalLight(0xbcd6ff, 0.9);
  private readonly modelHolder = new THREE.Group();
  private modelKey = '';
  private dots: THREE.Points | null = null;
  private lines: { line: THREE.Line; key: string; anchor: Item | null }[] = [];
  private readonly textures = new Map<string, THREE.Texture>(); // address → map, most recently used last
  private flight: Flight | null = null;
  private idle = 0;
  private interacting = false;
  private downAt: { x: number; y: number; time: number } | null = null;
  private lastTap = { key: '', time: 0 };
  private builtAt = 0;
  private linked = new Set<string>();
  private readonly shift = { x: 0, y: 0, wantX: 0, wantY: 0 }; // how far the picture is moved aside, fractions of the screen
  private readonly scratch = new THREE.Vector3();
  private readonly vec: Vec = [0, 0, 0];

  constructor(kit: SceneKit, backdrop: THREE.Group, host: SpaceHost) {
    this.kit = kit;
    this.host = host;
    this.backdrop = backdrop;
    this.scene.add(backdrop, this.content, this.modelHolder);
    this.scene.add(this.sunLight, this.sunLight.target, this.fillLight, this.fillLight.target, new THREE.AmbientLight(0x8fb0e0, 0.45));

    const glow = glowTexture();
    // The Sun as seen from another world: a point of light with a glow, kept a fixed distance from the camera.
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true }));
    this.sunSprite.renderOrder = 40;
    // …and its corona when the Sun itself is the place (or the middle of the map).
    this.corona = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 }));
    this.corona.renderOrder = 3;
    this.scene.add(this.sunSprite, this.corona);

    const canvas = kit.renderer.domElement;
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.9;
    this.controls.enablePan = false;
    this.controls.enabled = false;
    this.controls.addEventListener('start', () => {
      this.flight = null;
      this.interacting = true;
    });
    this.controls.addEventListener('end', () => {
      this.interacting = false;
      this.idle = 0;
    });

    canvas.addEventListener('pointerdown', (event) => {
      if (this.where) this.downAt = { x: event.clientX, y: event.clientY, time: performance.now() };
    });
    canvas.addEventListener('pointerup', (event) => {
      const down = this.downAt;
      this.downAt = null;
      if (!this.where || !down) return;
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6 || performance.now() - down.time > 600) return; // a drag, not a tap
      this.tap(this.pick(event.clientX, event.clientY));
    });
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.applyShift();
    });
  }

  get active(): boolean {
    return this.where !== null;
  }

  /** Is the slow idle turn happening right now? (The interface dims itself then.) */
  get drifting(): boolean {
    return this.active && !this.flight && !this.interacting && this.idle > 4 && this.host.drift();
  }

  /**
   * Draw the picture off-centre, to clear the card: `x` of the screen's width to the left,
   * `y` of its height upwards. Eased, so opening the card does not jolt the view.
   */
  setShift(x: number, y: number): void {
    this.shift.wantX = x;
    this.shift.wantY = y;
  }

  private applyShift(): void {
    const w = window.innerWidth, h = window.innerHeight;
    if (Math.abs(this.shift.x) + Math.abs(this.shift.y) < 0.002) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, h, w * this.shift.x, h * this.shift.y, w, h);
  }

  /** Mark the craft a ground station is in contact with right now (a small live dot on their name tags). */
  setLinked(keys: Set<string>): void {
    this.linked = keys;
    for (const item of this.items) item.tag?.classList.toggle('is-linked', keys.has(item.key));
  }

  /** The spacecraft from public/data/deep.json (may arrive after a view is already open). */
  setCraft(crafts: Craft[], tMs: number): void {
    this.crafts = crafts;
    if (this.where) this.enter(this.where, tMs, this.focus, false);
  }

  // ---- entering and leaving ------------------------------------------------------------------

  /**
   * Show a place or the map. `glide` starts the camera further out and eases it in; without
   * it the camera is simply put in place (a rebuild of the view the visitor is already in).
   */
  enter(where: Where, tMs: number, focus: Target | null = null, glide = true, apparent = 0): void {
    const sameView = this.where !== null && this.where.kind === where.kind && (where.kind === 'system' || (this.where as { body: BodyId }).body === where.body);
    const keepCamera = sameView && !glide;
    this.clear();
    this.where = where;
    this.builtAt = tMs;
    this.kit.controls.enabled = false;
    this.controls.enabled = true;
    this.kit.show(this.scene, this.camera, this.controls.target);
    if (where.kind === 'system') this.buildMap(tMs);
    else this.buildPlace(where.body, tMs);
    this.place(tMs);
    this.focus = null;
    if (!keepCamera) this.homeCamera(glide, apparent);
    this.setFocus(focus, tMs, glide && !keepCamera ? 0 : 1.4);
  }

  /** Back to the tracker's own scene. */
  leave(): void {
    this.clear();
    this.where = null;
    this.focus = null;
    this.controls.enabled = false;
    this.kit.controls.enabled = true;
    this.kit.show();
  }

  private clear(): void {
    for (const item of this.items) {
      item.tag?.remove();
      item.mesh?.dispose();
    }
    this.items = [];
    for (const { line } of this.lines) {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.lines = [];
    if (this.dots) {
      this.dots.geometry.dispose();
      (this.dots.material as THREE.Material).dispose();
      this.dots = null;
    }
    this.content.clear();
    this.modelHolder.clear();
    this.modelHolder.visible = false;
    this.modelKey = '';
    this.flight = null;
  }

  // ---- building a view -----------------------------------------------------------------------

  private toWorld(v: Vec, scale: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(v[0], v[2], -v[1]).multiplyScalar(scale).applyQuaternion(this.frame);
  }

  private get segments(): number {
    return this.kit.quality === 'high' ? 128 : this.kit.quality === 'balanced' ? 96 : 64;
  }

  private addBody(body: Body, radius: number, centre: boolean, detail: 'full' | 'small' | 'none'): Item {
    const mesh = createBody(body.id, body.color, radius, centre ? this.segments : 48);
    this.content.add(mesh.mesh);
    const item: Item = { target: { kind: 'body', body }, key: `body:${body.id}`, pos: new THREE.Vector3(), radius, tag: null, mesh, shown: true, centre };
    if (!centre || this.where?.kind === 'system') item.tag = this.makeTag(item, body.name, body.kind === 'moon' && this.where?.kind === 'system' ? 'is-minor' : 'is-body');
    this.items.push(item);

    const imagery = IMAGERY[body.id];
    if (imagery && detail !== 'none') {
      // The sharp copy only where it can be seen and afforded: the body being visited, on the
      // High setting, on a computer (a 4096-pixel map is 85 MB of graphics memory with its mipmaps).
      const sharp = detail === 'full' && this.kit.quality === 'high' && !this.host.isPhone() && imagery.baseHigh;
      const address = detail === 'small' ? imagery.base.replace(/\.(jpg|webp|png)$/, '_s.$1') : sharp || imagery.base;
      this.loadMap(address, (texture) => {
        if (this.items.includes(item)) mesh.setMap(texture);
      }, detail === 'small' ? imagery.base : undefined);
      if (body.id === 'earth' && detail === 'full' && this.kit.quality !== 'fast' && !this.host.isPhone()) {
        // The same two pictures the tracker's globe uses (already in the browser's cache).
        this.loadMap('textures/earth-night.jpg', (night) => {
          this.loadMap('textures/clouds.png', (clouds) => {
            if (this.items.includes(item)) mesh.setExtras(night, clouds);
          });
        });
      }
      const ring = imagery.ring;
      if (ring) {
        const scale = radius / body.radiusKm;
        this.loadMap(ring.strip, (strip) => {
          if (this.items.includes(item) && !mesh.ring) addRing(mesh, strip, ring.innerKm * scale, ring.outerKm * scale, radius);
        });
      }
    }
    return item;
  }

  private addCraft(craft: Craft): Item {
    const item: Item = { target: { kind: 'craft', craft }, key: `craft:${craft.id}`, pos: new THREE.Vector3(), radius: 0, tag: null, mesh: null, shown: true, centre: false };
    item.tag = this.makeTag(item, craft.short, craft.passing ? 'is-craft is-rock' : craft.status === 'silent' ? 'is-craft is-silent' : 'is-craft');
    this.items.push(item);
    return item;
  }

  private makeTag(item: Item, text: string, className: string): HTMLElement {
    const tag = document.createElement('button');
    tag.type = 'button';
    tag.className = `sp-tag ${className}`;
    tag.textContent = text;
    if (this.linked.has(item.key)) tag.classList.add('is-linked');
    tag.addEventListener('click', () => this.tap(item));
    this.host.tags.append(tag);
    return tag;
  }

  private buildPlace(id: BodyId, tMs: number): void {
    const body = BODIES[id];
    this.unitsPerKm = R / body.radiusKm;
    // North up: turn the whole view so this body's pole is the screen's vertical.
    const pole = bodyAxes(id, tMs).pole;
    this.frame.setFromUnitVectors(this.scratch.set(pole[0], pole[2], -pole[1]).normalize(), UP);

    this.addBody(body, R, true, 'full');
    // Company: its moons; and for a moon, the planet it circles and the other moons there.
    const family = BODY_LIST.filter((other) => other.id !== id && (other.parent === id || (body.kind === 'moon' && (other.id === body.parent || other.parent === body.parent))));
    // Their maps too, except from the Sun: at true scale a planet seen from there is less than a pixel.
    const detail = this.kit.quality === 'fast' || id === 'sun' ? 'none' : 'full';
    for (const other of family) this.addBody(other, other.radiusKm * this.unitsPerKm, false, detail);
    for (const craft of this.crafts) if (craft.centre === id) this.addCraft(craft);

    // Orbits: the path of everything here that circles something else here (moons round their
    // planet; from the Sun, the planets themselves, at true scale), and each craft's round this body.
    let reach = R * 8;
    for (const item of this.items) {
      if (item.target.kind === 'body') {
        const other = item.target.body;
        if (item.centre || !other.parent) continue;
        const anchor = other.parent === id ? null : this.items.find((candidate) => candidate.key === `body:${other.parent}`) ?? null;
        if (other.parent !== id && !anchor) continue;
        const points = this.sample(other.periodDays * DAY, 240, tMs, (t) => this.toWorld(bodyRelative(other.id, other.parent!, t, this.vec), this.unitsPerKm, this.scratch));
        this.addLine(points, item.key, other.color, 0.3, anchor, true);
      } else {
        this.craftLine(item, tMs, (v) => this.toWorld(v, this.unitsPerKm, this.scratch));
      }
    }
    this.place(tMs);
    for (const item of this.items) reach = Math.max(reach, item.pos.length() * 1.5);
    this.extent = Math.min(reach, 60000);
    this.buildDots();
    const star = id === 'sun';
    this.corona.visible = star;
    this.corona.scale.setScalar(R * 5.2);
    this.corona.position.set(0, 0, 0);
    this.sunSprite.visible = !star;
  }

  private buildMap(tMs: number): void {
    // The planets' common plane lies flat: the pole of the ecliptic is the screen's vertical.
    const tilt = 23.4393 * (Math.PI / 180);
    this.frame.setFromUnitVectors(this.scratch.set(0, Math.cos(tilt), Math.sin(tilt)), UP);
    this.unitsPerKm = 0;
    const detail = this.kit.quality === 'fast' ? 'none' : 'small';
    for (const body of BODY_LIST) {
      const size = MAP_SIZE[body.id];
      if (size === undefined) continue;
      const item = this.addBody(body, size, body.id === 'sun', detail);
      if (body.kind === 'planet' || body.kind === 'dwarf') {
        const points = this.sample(body.periodDays * DAY, 256, tMs, (t) => this.mapPoint(bodyPosition(body.id, t, this.vec), this.scratch));
        this.addLine(points, item.key, body.color, 0.26, null, true);
      }
    }
    for (const craft of this.crafts) {
      if (craft.centre !== 'sun') continue;
      this.craftLine(this.addCraft(craft), tMs, (v) => this.mapPoint(v, this.scratch));
    }
    this.extent = 520;
    this.buildDots();
    this.corona.visible = true;
    this.corona.scale.setScalar(MAP_SIZE.sun! * 6);
    this.corona.position.set(0, 0, 0);
    this.sunSprite.visible = false;
  }

  /** A heliocentric position (km) → its place on the map. */
  private mapPoint(v: Vec, out: THREE.Vector3): THREE.Vector3 {
    const km = Math.hypot(v[0], v[1], v[2]);
    return this.toWorld(v, km > 1 ? mapRadius(km) / km : 0, out);
  }

  /** `count` points along one period (or any span) of something that moves, starting now. */
  private sample(spanMs: number, count: number, tMs: number, at: (t: number) => THREE.Vector3): Float32Array {
    const points = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) at(tMs + (spanMs * i) / count).toArray(points, i * 3);
    return points;
  }

  private craftLine(item: Item, tMs: number, toScene: (v: Vec) => THREE.Vector3): void {
    if (item.target.kind !== 'craft') return;
    const craft = item.target.craft;
    const motion = craft.motion;
    if (motion.type === 'surface') return;
    const at = (t: number) => toScene(craftPosition(craft, t, this.vec).pos);
    let points: Float32Array;
    let closed = false;
    if (motion.type === 'samples') {
      const total = motion.xyz.length / 3;
      const count = Math.min(total, 360);
      points = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) at(motion.t0Ms + (motion.stepMs * i * (total - 1)) / Math.max(1, count - 1)).toArray(points, i * 3);
    } else {
      const period = craftPeriodMs(craft);
      if (period !== null && period < 40 * 365.25 * DAY) {
        points = this.sample(period, 240, tMs, at);
        closed = true;
      } else {
        // Leaving for good (or on a very long orbit): where it has come from and where it is going.
        const span = 8 * 365.25 * DAY;
        points = new Float32Array(160 * 3);
        for (let i = 0; i < 160; i++) at(tMs - span / 2 + (span * i) / 159).toArray(points, i * 3);
      }
    }
    this.addLine(points, item.key, craft.status === 'silent' ? [0.5, 0.56, 0.66] : [1, 0.78, 0.46], 0.34, null, closed);
  }

  private addLine(points: Float32Array, key: string, color: readonly number[], opacity: number, anchor: Item | null, closed: boolean): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
    const material = new THREE.LineBasicMaterial({ color: new THREE.Color(color[0], color[1], color[2]), transparent: true, opacity, depthWrite: false });
    const line = closed ? new THREE.LineLoop(geometry, material) : new THREE.Line(geometry, material);
    line.frustumCulled = false;
    this.content.add(line);
    this.lines.push({ line, key, anchor });
  }

  /** Every craft as a small round dot of a fixed size on screen (one draw call). */
  private buildDots(): void {
    const crafts = this.items.filter((item) => item.target.kind === 'craft');
    if (crafts.length === 0) return;
    const colors = new Float32Array(crafts.length * 3);
    crafts.forEach((item, i) => {
      const craft = (item.target as { craft: Craft }).craft;
      colors.set(craft.passing ? [0.78, 0.7, 0.62] : craft.status === 'silent' ? [0.55, 0.62, 0.74] : [1, 0.84, 0.56], i * 3);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(crafts.length * 3), 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    this.dots = new THREE.Points(geometry, new THREE.ShaderMaterial({
      uniforms: { uSize: { value: 7 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        uniform float uSize;
        varying vec3 vColor;
        void main() {
          vColor = aColor;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float core = 1.0 - smoothstep(0.45, 0.7, r);
          float halo = (1.0 - smoothstep(0.5, 1.0, r)) * 0.35;
          gl_FragColor = vec4(vColor * (core * 1.25 + halo), max(core, halo));
        }`,
      transparent: true,
      depthWrite: false,
    }));
    this.dots.frustumCulled = false;
    this.dots.renderOrder = 5;
    this.content.add(this.dots);
  }

  /** Fetch a map once and keep the few most recently used (older ones are freed: phones have little graphics memory). */
  private loadMap(address: string, ready: (texture: THREE.Texture) => void, fallback?: string): void {
    const kept = this.textures.get(address);
    if (kept) {
      this.textures.delete(address);
      this.textures.set(address, kept); // most recently used last
      ready(kept);
      return;
    }
    new THREE.TextureLoader().load(address, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = this.kit.quality === 'fast' ? 1 : Math.min(8, this.kit.renderer.capabilities.getMaxAnisotropy());
      texture.wrapS = THREE.RepeatWrapping; // the map joins up across longitude 180°
      this.textures.set(address, texture);
      const limit = this.host.isPhone() ? 10 : 22;
      for (const [old, stale] of this.textures) {
        if (this.textures.size <= limit) break;
        if (this.items.some((item) => item.mesh && Object.values(item.mesh.uniforms).some((uniform) => uniform.value === stale))) continue;
        stale.dispose();
        this.textures.delete(old);
      }
      ready(texture);
    }, undefined, () => {
      if (fallback) this.loadMap(fallback, ready);
    });
  }

  // ---- every frame ---------------------------------------------------------------------------

  /** Put every item where it is at `tMs`. */
  private place(tMs: number): void {
    const where = this.where;
    if (!where) return;
    if (where.kind === 'place') {
      const centre = where.body;
      // Sunlight comes from where the Sun is as seen from this body.
      const toSun = bodyPosition(centre, tMs, this.vec);
      const sunKm = Math.hypot(toSun[0], toSun[1], toSun[2]);
      if (centre !== 'sun') this.toWorld(toSun, -1, this.sunDir).normalize();
      for (const item of this.items) {
        if (item.target.kind === 'body') {
          if (item.centre) item.pos.set(0, 0, 0);
          else this.toWorld(bodyRelative(item.target.body.id, centre, tMs, this.vec), this.unitsPerKm, item.pos);
        } else {
          const craft = item.target.craft;
          const state = craftPosition(craft, tMs, this.vec);
          this.toWorld(state.pos, this.unitsPerKm, item.pos);
          // From the Sun, only what the true-scale view reaches: the far probes belong on the map.
          // A passing asteroid is here only for the few days its path is known for.
          item.shown = (centre !== 'sun' || item.pos.length() < 60000) && !(craft.passing && state.held);
        }
      }
      const sunSize = sunKm > 1 ? SUN_RADIUS_KM / sunKm : 0.0046;
      for (const item of this.items) if (item.mesh) this.light(item, tMs, this.sunDir, sunSize);
    } else {
      const earth = this.items.find((item) => item.key === 'body:earth');
      for (const item of this.items) {
        if (item.target.kind === 'craft') {
          this.mapPoint(craftPosition(item.target.craft, tMs, this.vec).pos, item.pos);
        } else if (item.target.body.id === 'moon' && earth) {
          // The Moon would sit inside the Earth's dot: hold it a little way off, on its true side.
          this.toWorld(bodyRelative('moon', 'earth', tMs, this.vec), 1, item.pos).normalize().multiplyScalar(4.3).add(earth.pos);
        } else if (item.target.body.id === 'sun') {
          item.pos.set(0, 0, 0);
        } else {
          this.mapPoint(bodyPosition(item.target.body.id, tMs, this.vec), item.pos);
        }
      }
      for (const item of this.items) {
        if (!item.mesh) continue;
        this.scratch.copy(item.pos).multiplyScalar(-1);
        if (this.scratch.lengthSq() < 1e-9) this.scratch.set(1, 0, 0);
        this.light(item, tMs, this.scratch.normalize(), 0.004);
      }
    }
  }

  /** Position, spin and light one body. */
  private light(item: Item, tMs: number, sunDir: THREE.Vector3, sunSize: number): void {
    const mesh = item.mesh!;
    const body = (item.target as { body: Body }).body;
    const axes = bodyAxes(body.id, tMs);
    const x = this.toWorld(axes.prime, 1, new THREE.Vector3()).normalize();
    const y = this.toWorld(axes.pole, 1, new THREE.Vector3()).normalize();
    // Longitude 0 on +X, north on +Y: the same layout as the Earth in the tracker (CLAUDE.md, "Coordinate frames").
    mesh.mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, new THREE.Vector3().crossVectors(x, y)));
    mesh.mesh.position.copy(item.pos);
    const u = mesh.uniforms;
    (u.uSunDir.value as THREE.Vector3).copy(sunDir);
    (u.uCentre.value as THREE.Vector3).copy(item.pos);
    (u.uPole.value as THREE.Vector3).copy(y);
    u.uSunSize.value = sunSize;
    // Everything else here that could come between this body and the Sun.
    const occluders = u.uOcc.value as THREE.Vector4[];
    let count = 0;
    if (this.where?.kind === 'place') {
      for (const other of this.items) {
        if (other === item || !other.mesh || count >= MAX_OCCLUDERS) continue;
        if ((other.target as { body: Body }).body.id === 'sun') continue;
        occluders[count++].set(other.pos.x, other.pos.y, other.pos.z, other.radius);
      }
    }
    u.uOccCount.value = count;
  }

  update(dt: number, tMs: number, realSeconds: number): void {
    if (!this.where) return;
    // Orbits are drawn from "now" for one period; after a long jump in time they would be stale.
    if (Math.abs(tMs - this.builtAt) > 120 * DAY) {
      this.enter(this.where, tMs, this.focus, false);
      return;
    }
    this.place(tMs);
    const map = this.where.kind === 'system';
    const focusItem = this.focus ? this.items.find((item) => item.key === targetKey(this.focus!)) ?? null : null;

    for (const item of this.items) if (item.mesh) item.mesh.uniforms.uTime.value = realSeconds;
    for (const { line, key, anchor } of this.lines) {
      if (anchor) line.position.copy(anchor.pos);
      const owner = this.items.find((item) => item.key === key);
      line.visible = owner?.shown ?? true;
      (line.material as THREE.LineBasicMaterial).opacity = focusItem?.key === key ? 0.85 : map ? 0.26 : 0.32;
    }
    if (this.dots) {
      const position = this.dots.geometry.getAttribute('position') as THREE.BufferAttribute;
      let i = 0;
      for (const item of this.items) {
        if (item.target.kind !== 'craft') continue;
        // A craft that is not shown, or is shown as its model, has its dot parked out of sight.
        if (item.shown && !(item === focusItem && this.modelHolder.visible)) position.setXYZ(i, item.pos.x, item.pos.y, item.pos.z);
        else position.setXYZ(i, 0, 0, 0);
        i++;
      }
      position.needsUpdate = true;
      (this.dots.material as THREE.ShaderMaterial).uniforms.uSize.value = 7 * this.kit.pixelRatio;
    }

    const ease = 1 - Math.exp(-dt * 5);
    if (Math.abs(this.shift.wantX - this.shift.x) + Math.abs(this.shift.wantY - this.shift.y) > 0.0005) {
      this.shift.x += (this.shift.wantX - this.shift.x) * ease;
      this.shift.y += (this.shift.wantY - this.shift.y) * ease;
      this.applyShift();
    }
    this.moveCamera(dt, focusItem);
    this.camera.updateMatrixWorld();
    this.backdrop.position.copy(this.camera.position);
    this.backdrop.quaternion.copy(this.frame);

    if (this.sunSprite.visible) {
      // Hidden when a body is in the way: is the line from the camera to the Sun blocked?
      let clear = 1;
      for (const item of this.items) {
        if (!item.mesh) continue;
        const toBody = this.scratch.copy(item.pos).sub(this.camera.position);
        const along = toBody.dot(this.sunDir);
        if (along <= 0) continue;
        const miss = toBody.addScaledVector(this.sunDir, -along).length();
        clear = Math.min(clear, THREE.MathUtils.smoothstep(miss, item.radius * 0.985, item.radius * 1.05));
      }
      this.sunSprite.position.copy(this.camera.position).addScaledVector(this.sunDir, 5000);
      const sunKm = Math.hypot(...bodyPosition((this.where as { body: BodyId }).body, tMs, this.vec));
      // Smaller and fainter the further out the place is, but never lost: it is the only light there.
      this.sunSprite.scale.setScalar(5000 * THREE.MathUtils.clamp(0.5 / Math.sqrt(Math.max(sunKm / AU, 0.2)), 0.12, 0.75));
      (this.sunSprite.material as THREE.SpriteMaterial).opacity = clear;
    }

    this.updateModel(focusItem, tMs, realSeconds);
    this.updateTags(focusItem);
  }

  // ---- the camera ----------------------------------------------------------------------------

  /**
   * How big the body in the middle of the view looks right now: its radius over its distance
   * from the camera. When the scene changes mid-move, the next scene opens with its body
   * looking the same size, so the eye sees one thing shrinking or growing, not a swap.
   * In a place that is the place's body; on the map, the dot of `body`.
   */
  apparentOf(body?: BodyId): number {
    if (this.where?.kind === 'system') {
      const item = body ? this.mapItem(body) : null;
      return item ? item.radius / Math.max(this.camera.position.distanceTo(item.pos), 1e-6) : 0;
    }
    return R / Math.max(this.camera.position.length(), 1e-6);
  }

  private homeCamera(glide: boolean, apparent = 0): void {
    const map = this.where?.kind === 'system';
    const phone = this.host.isPhone();
    let offset: THREE.Vector3;
    if (map) {
      offset = new THREE.Vector3(0, 135, 190).multiplyScalar(phone ? 1.55 : 1);
    } else {
      // From the sunlit side, a little above and to one side, so the edge of night is in view.
      const side = new THREE.Vector3().crossVectors(UP, this.sunDir);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      offset = this.sunDir.clone().multiplyScalar(0.78).addScaledVector(side.normalize(), 0.55).addScaledVector(UP, 0.28).normalize().multiplyScalar(R * (phone ? 6 : 4.4));
    }
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = map ? 12 : R * 1.06;
    this.controls.maxDistance = this.extent;
    if (glide) {
      // Arriving: already moving fast from a long way back, settling into place (the second
      // half of the move that began in the scene the visitor came from).
      // In a place it starts where the body looks as big as the dot the visitor was diving at.
      const far = map ? 2.2 : apparent > 0 ? THREE.MathUtils.clamp(R / apparent / offset.length(), 2, 12) : 6;
      this.camera.position.copy(offset).multiplyScalar(far);
      this.fly(offset, 2.4, easeOut);
    } else {
      this.camera.position.copy(offset);
    }
    this.idle = 0;
  }

  private fly(toOffset: THREE.Vector3, duration: number, ease = easeInOut, toTarget: THREE.Vector3 | null = null): void {
    this.flight = {
      elapsed: 0,
      duration,
      fromOffset: this.camera.position.clone().sub(this.controls.target),
      fromTarget: this.controls.target.clone(),
      toOffset,
      ease,
      toTarget,
    };
  }

  // Moves that begin here and finish in another scene, or the other way round (ui/places.ts
  // changes the scene at their fast end, behind a moment of darkness).

  /** Pull straight back from what is being looked at, gathering speed. */
  pullBack(duration: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.fly(offset.multiplyScalar(this.where?.kind === 'system' ? 2.4 : 7), duration, easeIn, this.controls.target.clone());
  }

  /** On the map: dive towards one body's dot, gathering speed (the way into its place). */
  diveTo(body: BodyId, duration: number): void {
    const item = this.mapItem(body);
    if (!item) return this.pullBack(duration);
    const offset = this.camera.position.clone().sub(item.pos).normalize().multiplyScalar(item.radius * 3.2);
    this.fly(offset, duration, easeIn, item.pos.clone());
  }

  /** On the map: start right beside one body's dot and draw back to the whole picture (the way out of its place). */
  emergeFrom(body: BodyId, apparent = 0): void {
    const item = this.mapItem(body);
    if (!item) return;
    // Where the view is meant to end up: the flight enter() has just set off on, if there is one.
    const home = this.flight ? this.flight.toOffset.clone() : this.camera.position.clone().sub(this.controls.target);
    this.controls.target.copy(item.pos);
    // Begin where the dot looks as big as the world just left did at the moment of the change.
    const start = THREE.MathUtils.clamp(apparent > 0 ? item.radius / apparent : 0, item.radius * 3.2, home.length() * 0.6);
    this.camera.position.copy(item.pos).addScaledVector(home.clone().normalize(), start);
    this.fly(home, 2.6, easeOut, ORIGIN.clone());
  }

  /** A body's dot on the map; a moon that has none stands where its planet does. */
  private mapItem(body: BodyId): Item | null {
    if (this.where?.kind !== 'system') return null;
    const find = (id: BodyId | null) => (id ? this.items.find((item) => item.key === `body:${id}`) ?? null : null);
    return find(body) ?? find(BODIES[body].parent);
  }

  /** Look at a body or craft (the camera then stays with it), or back at the middle with null. */
  setFocus(target: Target | null, tMs: number, duration = 1.4): void {
    const item = target ? this.items.find((candidate) => candidate.key === targetKey(target)) ?? null : null;
    const previous = this.focus;
    this.focus = item ? item.target : null;
    if (!this.where) return;
    this.place(tMs);
    const map = this.where.kind === 'system';
    if (!item || item.centre) {
      this.controls.minDistance = map ? 12 : R * 1.06;
      if (previous && !item) this.fly(this.camera.position.clone().normalize().multiplyScalar(map ? 233 : R * 4.4), duration);
      return;
    }
    // Stop a comfortable distance from it, on the side the camera is already on.
    const distance = item.radius > 0 ? item.radius * 3.6 : map ? 5 : 0.13;
    this.controls.minDistance = item.radius > 0 ? item.radius * 1.15 : map ? 0.6 : 0.03;
    const away = this.camera.position.clone().sub(item.pos);
    if (away.lengthSq() < 1e-9) away.set(0, 0.3, 1);
    const toOffset = away.normalize().multiplyScalar(distance);
    if (duration <= 0) {
      // Arriving straight at it (a link, a search): start a little way back and ease in.
      this.controls.target.copy(item.pos);
      this.camera.position.copy(item.pos).addScaledVector(toOffset, 3);
      this.fly(toOffset, 2);
    } else {
      this.fly(toOffset, duration);
    }
  }

  private moveCamera(dt: number, focusItem: Item | null): void {
    const { camera, controls } = this;
    const anchor = focusItem && !focusItem.centre ? focusItem.pos : ORIGIN;
    if (this.flight) {
      const f = this.flight;
      f.elapsed += dt;
      const e = f.ease(Math.min(1, f.elapsed / f.duration));
      // Swing round (turn the direction, change the distance) instead of cutting straight across.
      const from = f.fromOffset.clone().normalize(), to = f.toOffset.clone().normalize();
      const dir = from.applyQuaternion(new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(from, to), e));
      const length = THREE.MathUtils.lerp(f.fromOffset.length(), f.toOffset.length(), e);
      controls.target.lerpVectors(f.fromTarget, f.toTarget ?? anchor, e);
      camera.position.copy(controls.target).addScaledVector(dir, length);
      if (f.elapsed >= f.duration) this.flight = null;
    } else {
      // Stay with whatever is being looked at as it moves.
      const offset = camera.position.clone().sub(controls.target);
      this.idle = this.interacting ? 0 : this.idle + dt;
      if (this.host.drift() && this.idle > 4) offset.applyAxisAngle(UP, dt * 0.022 * Math.min(1, (this.idle - 4) / 4));
      controls.target.copy(anchor);
      camera.position.copy(anchor).add(offset);
    }
    // Close to the ground a zoom step or a drag must cover less, or the surface races past.
    if (this.where?.kind === 'place' && anchor === ORIGIN) {
      const distance = camera.position.length();
      const altitude = Math.max(0, distance - R);
      controls.zoomSpeed = 0.9 * THREE.MathUtils.clamp((altitude / distance) * 1.3, 0.06, 1);
      controls.rotateSpeed = THREE.MathUtils.clamp(altitude * 0.033, 0.02, 0.55);
    } else {
      controls.zoomSpeed = 0.9;
      controls.rotateSpeed = 0.55;
    }
    controls.maxDistance = this.flight ? Infinity : this.extent; // a flight may pass beyond the limit on its way out
    controls.update();
  }

  // ---- the selected craft's model ------------------------------------------------------------

  private updateModel(focusItem: Item | null, tMs: number, realSeconds: number): void {
    const craft = focusItem?.target.kind === 'craft' ? focusItem.target.craft : null;
    if (!craft || !focusItem) {
      this.modelHolder.visible = false;
      return;
    }
    if (this.modelKey !== craft.id) {
      this.modelKey = craft.id;
      this.modelHolder.clear();
      // The data file names its model; an unknown name falls back to the generic probe.
      const kinds = KIND_LABEL as Record<string, string>;
      const kind = (craft.model in kinds ? craft.model : 'probe' in kinds ? 'probe' : 'telescope') as ModelKind;
      this.modelHolder.add(buildModel(kind));
    }
    const map = this.where?.kind === 'system';
    const position = focusItem.pos;
    const distance = this.camera.position.distanceTo(position);
    // Far too small to see at true size, so it is drawn much larger than life, as in the tracker.
    const size = map ? THREE.MathUtils.clamp(distance * 0.07, 0.25, 2.5) : THREE.MathUtils.clamp(distance * 0.058, 0.024, 0.2);
    this.modelHolder.visible = true;
    this.modelHolder.scale.setScalar(size);

    const surface = craft.motion.type === 'surface';
    const up = position.lengthSq() > 1e-9 && !map ? position.clone().normalize() : UP.clone();
    this.modelHolder.position.copy(position);
    if (surface) this.modelHolder.position.addScaledVector(up, size * 0.3); // standing on the ground, not half sunk in it
    // Which way it is travelling: where it will be a moment from now.
    const ahead = new THREE.Vector3();
    if (surface) ahead.crossVectors(UP, up);
    else if (map) this.mapPoint(craftPosition(craft, tMs + 3600000, this.vec).pos, ahead).sub(position);
    else this.toWorld(craftPosition(craft, tMs + 1000, this.vec).pos, this.unitsPerKm, ahead).sub(position);
    const forward = ahead.addScaledVector(up, -ahead.dot(up));
    if (forward.lengthSq() < 1e-14) forward.set(1, 0, 0).addScaledVector(up, -up.x);
    forward.normalize();
    this.modelHolder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(forward, up, new THREE.Vector3().crossVectors(forward, up)));
    if (map && craft.status === 'silent') this.modelHolder.rotateY(realSeconds * 0.05); // a dead craft turns slowly
    if (craft.passing) this.modelHolder.rotation.set(realSeconds * 0.11, realSeconds * 0.17, 0); // a rock tumbles

    const sunDir = map ? this.scratch.copy(position).multiplyScalar(-1).normalize() : this.sunDir;
    this.sunLight.position.copy(position).addScaledVector(sunDir, 50);
    this.sunLight.target.position.copy(position);
    this.fillLight.position.copy(this.camera.position);
    this.fillLight.target.position.copy(position);
  }

  // ---- name tags and picking -----------------------------------------------------------------

  private project(pos: THREE.Vector3, out: THREE.Vector3): boolean {
    out.copy(pos).project(this.camera);
    if (out.z > 1 || out.z < -1) return false;
    out.x = (out.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-out.y * 0.5 + 0.5) * window.innerHeight;
    return true;
  }

  /** Is `pos` behind one of the bodies as seen from the camera? */
  private hidden(pos: THREE.Vector3, self: Item): boolean {
    const eye = this.camera.position;
    const ray = pos.clone().sub(eye);
    const reach = ray.length();
    ray.divideScalar(Math.max(reach, 1e-9));
    for (const item of this.items) {
      // A smaller body passing in front does not hide a bigger one's name (the Moon across the Earth on the map).
      if (item === self || !item.mesh || item.radius < self.radius) continue;
      const toBody = item.pos.clone().sub(eye);
      const along = toBody.dot(ray);
      if (along <= 0 || along >= reach) continue;
      if (toBody.addScaledVector(ray, -along).length() < item.radius) return true;
    }
    return false;
  }

  private updateTags(focusItem: Item | null): void {
    const screen = new THREE.Vector3();
    const taken: { x: number; y: number; w: number }[] = [];
    // Bodies first, then craft: when two names would overlap, the earlier one keeps its place.
    const order = [...this.items].sort((a, b) => Number(b === focusItem) - Number(a === focusItem) || Number(a.target.kind === 'craft') - Number(b.target.kind === 'craft'));
    for (const item of order) {
      const tag = item.tag;
      if (!tag) continue;
      let visible = item.shown && this.project(item.pos, screen) && !this.hidden(item.pos, item);
      const x = screen.x, y = screen.y;
      if (visible && (x < -40 || x > window.innerWidth + 40 || y < -20 || y > window.innerHeight + 20)) visible = false;
      // How far below the centre the name goes: under the body's disc, or just under a craft's dot.
      const distance = this.camera.position.distanceTo(item.pos);
      const disc = item.radius > 0 ? (item.radius / Math.max(distance, 1e-6)) * (window.innerHeight / (2 * Math.tan((this.camera.fov * Math.PI) / 360))) : 0;
      // A body that fills the screen needs no name on it.
      if (visible && disc > window.innerHeight * 0.3) visible = false;
      const drop = disc + 12;
      const width = tag.textContent!.length * 6.5 + 16;
      if (visible && item !== focusItem && taken.some((box) => Math.abs(box.x - x) < (box.w + width) / 2 && Math.abs(box.y - (y + drop)) < 18)) visible = false;
      tag.classList.toggle('is-hidden', !visible);
      tag.classList.toggle('is-on', item === focusItem);
      if (!visible) continue;
      taken.push({ x, y: y + drop, w: width });
      tag.style.transform = `translate(${Math.round(x)}px, ${Math.round(y + drop)}px) translate(-50%, 0)`;
    }
  }

  /** What is under the pointer: the nearest craft dot within reach, else the nearest body whose disc is under it. */
  private pick(clientX: number, clientY: number): Item | null {
    const screen = new THREE.Vector3();
    let best: Item | null = null;
    let bestDistance = this.host.isPhone() ? 26 : 16;
    for (const item of this.items) {
      if (item.target.kind !== 'craft' || !item.shown || !this.project(item.pos, screen) || this.hidden(item.pos, item)) continue;
      const d = Math.hypot(screen.x - clientX, screen.y - clientY);
      if (d < bestDistance) {
        bestDistance = d;
        best = item;
      }
    }
    if (best) return best;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1), this.camera);
    let nearest = Infinity;
    for (const item of this.items) {
      if (!item.mesh) continue;
      // A small body is hard to hit: give it a few pixels of grace.
      const grace = this.camera.position.distanceTo(item.pos) * 0.012;
      const hit = ray.ray.intersectSphere(new THREE.Sphere(item.pos, item.radius + grace), screen);
      if (!hit) continue;
      const d = hit.distanceTo(this.camera.position);
      if (d < nearest) {
        nearest = d;
        best = item;
      }
    }
    return best;
  }

  private tap(item: Item | null): void {
    const now = performance.now();
    const key = item?.key ?? '';
    const again = item !== null && key === this.lastTap.key && now - this.lastTap.time < 450;
    this.lastTap = { key, time: now };
    if (item && again) this.host.onOpen(item.target);
    else this.host.onPick(item ? item.target : null);
  }
}
