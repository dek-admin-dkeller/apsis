/**
 * The views beyond Earth orbit: one body at a time ("a place"), and the solar system as a map.
 *
 * The tracker's own scene is built around the Earth and 19,000 satellites, and none of it
 * (the globe shader, the point cloud, the hash grid) means anything at Mars. So these are
 * separate, much simpler scenes drawn through the same renderer and bloom (SceneKit.show):
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
 *             right side of the Sun for the date on the clock, lit from the right side, and
 *             turned the right way.
 *
 * Both are lists of "items" (a body or a craft with a position this frame), so name tags,
 * picking, following and the 3D model of a selected craft are written once. ui/places.ts keeps
 * one view of each kind and moves between them (and the tracker).
 *
 * MOVING BETWEEN SCENES WITHOUT A CUT. A body looks the same in a place and as its dot on
 * the map (same shader, same map, same sunlight, same turn), and the stars behind are the
 * same stars. So if two scenes are drawn with the camera in the same position RELATIVE TO THE
 * BODY — same direction among the stars, same distance in body radii, same tilt — they show
 * the same picture apart from what surrounds the body, and a short dissolve from one to the
 * other (SceneKit.blend) reads as "the satellites faded away", not as a change of scene.
 * `pose()` reports that relative position and `update(…, slave)` holds a view to one.
 *
 * Positions come from src/space (ICRF kilometres) and are turned into a view's axes by
 * toWorld(): ICRF (x, y, z) → (x, z, −y) ("star axes", the tracker's own), then rotated by
 * `frame` so that the place's north pole (on the map, the pole of the planets' common plane)
 * points up the screen.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { isModelKind, type ModelKind } from '../../data/describe.ts';
import { BODIES, BODY_LIST } from '../../space/bodies.ts';
import { craftPeriodMs, craftPosition } from '../../space/deep.ts';
import { bodyAxes, bodyPosition, bodyRelative } from '../../space/ephem.ts';
import { IMAGERY, UNSEEN } from '../../space/imagery.ts';
import { loadRovers, onRoversRefresh, roverPath } from '../../space/rovers.ts';
import type { Body, BodyId, Craft, Vec } from '../../space/types.ts';
import { easeIn, easeOut } from '../cameraRig.ts';
import { buildModel, modelBase } from '../satModels.ts';
import { GroundTiles } from '../tiles.ts';
import type { OtherView, SceneKit } from '../scene.ts';
import { addRing, createBody, glowTexture, MAX_OCCLUDERS, type BodyMesh } from './bodyMesh.ts';

export type Where = { kind: 'system' } | { kind: 'place'; body: BodyId };
export type Target = { kind: 'body'; body: Body } | { kind: 'craft'; craft: Craft };
export const targetKey = (target: Target): string => (target.kind === 'body' ? `body:${target.body.id}` : `craft:${target.craft.id}`);

/**
 * Where a camera is relative to a body, in a form any scene can reproduce: its position from
 * the body's centre in body radii, and its orientation, both in star axes.
 */
export interface Pose {
  rel: THREE.Vector3;
  quat: THREE.Quaternion;
}

/** What is drawn besides the bodies themselves: the Layers switches that apply away from the tracker. */
export interface SpaceOptions {
  /** The paths of planets and moons. */
  orbits: boolean;
  /** The paths of spacecraft (other than the one being looked at, which has its own switch). */
  craftOrbits: boolean;
  /** Names over the picture. */
  names: boolean;
  /** Spacecraft at all. */
  craft: boolean;
  /** Moons (other than the one being visited or looked at). */
  moons: boolean;
  /** On the solar system: name every craft and draw every path, not only the well-known ones. */
  allCraft: boolean;
  /** Historic landing sites. */
  sites: boolean;
  /** The paths the rovers have driven (public/data/rovers.json). */
  roverPaths: boolean;
  /** Names of the constellations. */
  skyNames: boolean;
  /** For the craft being looked at: its orbit, its path over the ground, the ground that can see it, its 3D model. */
  selOrbit: boolean;
  selTrack: boolean;
  selFootprint: boolean;
  selModel: boolean;
}

export interface SpaceHost {
  /** The element the name tags are put in (it covers the canvas). */
  tags: HTMLElement;
  /** A body or craft was chosen with a click or a tap (null = empty space). */
  onPick(target: Target | null): void;
  /** …or asked for outright (a second click, zooming all the way in): go there. */
  onOpen(target: Target): void;
  /** The visitor zoomed out as far as this view goes and kept going. */
  onOut(): void;
  /** The pointer is over something that can be clicked (null: over nothing), at screen x, y. */
  onHover(target: Target | null, x: number, y: number): void;
  /** The constellation figures: name and direction among the stars (star axes). */
  figures(): { name: string; direction: THREE.Vector3 }[];
  isPhone(): boolean;
  /** Turn slowly round the body while nothing is being touched (the tracker's own setting). */
  drift(): boolean;
}

export const R = 6.371; // radius of a place's body, scene units (the Earth's in the tracker)
const AU = 149597870.7;
const SUN_RADIUS_KM = 695700;
const UP = new THREE.Vector3(0, 1, 0);
const ORIGIN = new THREE.Vector3();
const DAY = 86400000;
/** A rover's driven path: the warm amber of a craft's dot, and lighter for the rover being looked at. */
const ROVER_PATH = 0xffc56e;
const ROVER_PATH_CHOSEN = 0xffe2b0;
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
  sun: 5, mercury: 1.3, venus: 2, earth: 2.1, mars: 1.6,
  jupiter: 4.2, saturn: 3.5, uranus: 2.6, neptune: 2.5, pluto: 1.1,
};
/** How big a body's dot is when the camera has come to rest beside it on the map: its radius over the distance. */
export const MAP_REST = 1 / 8;
/** …and in a place, the ordinary whole-body view (further back on a phone, whose screen is narrow). */
export const PLACE_REST = 1 / 4.4;
export const PLACE_REST_PHONE = 1 / 8.5;
/**
 * The craft named on the whole solar system. There are two dozen out between the planets, most
 * of them dead and circling the Sun near the Earth's orbit; named and ringed all at once they
 * bury the inner planets. The rest are dots until the camera comes near or one is chosen.
 */
/** …and of those, the ones whose path is drawn on the whole picture: the five leaving for good. */
const LEAVING = new Set(['voyager-1', 'voyager-2', 'new-horizons', 'pioneer-10', 'pioneer-11']);
const HEADLINE = new Set(['voyager-1', 'voyager-2', 'new-horizons', 'pioneer-10', 'pioneer-11', 'parker', 'europa-clipper', 'juice', 'lucy', 'psyche', 'bepicolombo']);

// ---- maps shared by every view ---------------------------------------------------------------
//
// A body's map is the same picture in a place and on the solar-system map, and the dissolve
// between the two depends on both having it at the same moment, so the maps are kept in one
// table for all views: address → texture, most recently used last. Phones have little
// graphics memory, so beyond a limit the oldest map that nothing is showing is freed.
const MAPS = new Map<string, THREE.Texture>();
const WAITING = new Map<string, ((texture: THREE.Texture | null) => void)[]>();
const VIEWS: SpaceView[] = [];
/**
 * Fill in the parts of a world no camera has seen (Settings → "Fill in unseen ground"): such a
 * map is asked for as "<file>?guess" and goes through worker/unseen.worker.ts once it is decoded.
 */
let GUESS = true;
const GUESS_TAG = '?guess';
const guessed = (id: BodyId, address: string): string => (GUESS && UNSEEN[id] ? address + GUESS_TAG : address);
let guessWorker: Worker | null = null;
let guessId = 0;
const guessWaiting = new Map<number, (bitmap: ImageBitmap) => void>();
/** The map with its unseen parts filled in, worked out off the main thread (the map as it is where that cannot be done). */
function fillUnseen(bitmap: ImageBitmap): Promise<ImageBitmap> {
  if (typeof OffscreenCanvas === 'undefined') return Promise.resolve(bitmap);
  try {
    if (!guessWorker) {
      guessWorker = new Worker(new URL('../../worker/unseen.worker.ts', import.meta.url), { type: 'module' });
      guessWorker.onmessage = (event: MessageEvent<{ id: number; bitmap: ImageBitmap }>) => {
        guessWaiting.get(event.data.id)?.(event.data.bitmap);
        guessWaiting.delete(event.data.id);
      };
    }
  } catch {
    return Promise.resolve(bitmap);
  }
  const id = ++guessId;
  return new Promise((resolve) => {
    guessWaiting.set(id, resolve);
    guessWorker!.postMessage({ id, bitmap }, [bitmap]);
  });
}
let WARM: THREE.WebGLRenderTarget | null = null; // the tiny buffer views are drawn into ahead of time (see prewarm)
/** Run something when the browser next has a moment (or soon, where it cannot say). */
const idle = (run: () => void): void => {
  const ask = (window as unknown as { requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
  if (ask) ask(run, { timeout: 600 });
  else setTimeout(run, 60);
};

interface Item {
  target: Target;
  key: string;
  pos: THREE.Vector3; // where it is this frame, world
  radius: number; // drawn radius (0 for a craft)
  tag: HTMLElement | null;
  mesh: BodyMesh | null;
  /** Is it drawn at all right now (far probes seen from the Sun's place are not; nor an asteroid outside its pass). */
  shown: boolean;
  centre: boolean;
  /** On the map: a moon drawn beside its planet, this many places out (0 = not one). */
  beside: number;
  /** Has it been given its full map (the map view starts every body on a small one)? */
  sharp: boolean;
  /** The radius it was built with, and how much of that it is drawn at (see `place`, the map's dots). */
  base: number;
  scale: number;
  /** On the map: a craft that is only a dot (no name, no path) until it is near or chosen. */
  quiet: boolean;
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
  private readonly tagRoot = document.createElement('div');
  private readonly frame = new THREE.Quaternion(); // star axes → this view's axes
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
  // Under something standing on the ground: a soft dark patch where it touches, and a longer
  // one stretched away from the Sun (see groundModel). Two textured quads; no shadow map.
  private readonly shadow = new THREE.Group();
  private readonly contact: THREE.Mesh;
  private readonly cast: THREE.Mesh;
  private footprint2 = { size: 1, x: 0, z: 0, base: -0.5 }; // the model's outline on the ground, in its own units
  private groundAt = { key: '', radius: 0, target: 0, checked: -Infinity, at: 0 }; // the drawn ground's radius under it: measured now and then, eased
  private readonly ray = new THREE.Raycaster();
  private modelKey = '';
  private modelKind: ModelKind = 'probe';
  private dots: THREE.Points | null = null;
  private lines: { line: THREE.Line; key: string; anchor: Item | null }[] = [];
  private readonly localUp = new THREE.Vector3();
  private flight: Flight | null = null;
  private live = false; // on screen and taking input
  private idle = 0;
  private interacting = false;
  private downAt: { x: number; y: number; time: number } | null = null;
  private lastTap = { key: '', time: 0 };
  private builtAt = 0;
  private linked = new Set<string>();
  private surface = false; // cloud-covered worlds are shown by their ground instead
  private snap = true; // size the map's dots outright on the next frame (a new view, a camera that was just placed)
  private readonly shift = { x: 0, y: 0, wantX: 0, wantY: 0 }; // how far the picture is moved aside, fractions of the screen
  private readonly scratch = new THREE.Vector3();
  private readonly vec: Vec = [0, 0, 0];
  private ground: GroundTiles | null = null; // close-up ground of the place's body, where its map is served in tiles
  private sharpGround = true; // the Layers switch (Settings.sharpGround)
  private lastT = 0; // the clock at the previous frame, to tell how fast time is running
  private options: SpaceOptions = { orbits: true, craftOrbits: true, names: true, craft: true, moons: true, allCraft: false, sites: true, roverPaths: true, skyNames: true, selOrbit: true, selTrack: false, selFootprint: false, selModel: true };
  private skyRoot: HTMLElement | null = null; // constellation names, made on first use
  private readonly skyTags: { tag: HTMLElement; direction: THREE.Vector3 }[] = [];
  private track: THREE.Line | null = null; // the selected craft's path over the ground (a child of the body, so it turns with it)
  private trackKey = '';
  private trackAt = 0;
  private cells: THREE.LineSegments | null = null; // occupied cells of the screening grid (see setCells)
  private casters: Item[] = []; // the bodies of a place that can cast a shadow, biggest first
  private readonly footprint: THREE.LineLoop; // the edge of the ground that can see the selected craft
  private roverLines: { line: THREE.Line; key: string; anchor: THREE.Vector3; checked: number }[] = []; // driven paths, children of the body (see roverPaths)
  private roverWatch = false; // listening for a newer rovers.json

  constructor(kit: SceneKit, backdrop: THREE.Group, host: SpaceHost) {
    this.kit = kit;
    this.host = host;
    this.backdrop = backdrop;
    VIEWS.push(this);
    host.tags.append(this.tagRoot);
    this.tagRoot.hidden = true;
    this.scene.add(backdrop, this.content, this.modelHolder, this.shadow);
    const blob = shadowTexture();
    const shadowMaterial = (opacity: number) => new THREE.MeshBasicMaterial({
      map: blob, color: 0x000000, transparent: true, opacity, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -16, // over the ground patches, which have their own nudge
    });
    const quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2); // lying flat: x along the ground, z across it
    this.contact = new THREE.Mesh(quad, shadowMaterial(0.5));
    this.cast = new THREE.Mesh(quad, shadowMaterial(0.5));
    this.contact.renderOrder = this.cast.renderOrder = 2;
    this.shadow.add(this.contact, this.cast);
    this.shadow.visible = false;
    this.scene.add(this.sunLight, this.sunLight.target, this.fillLight, this.fillLight.target, new THREE.AmbientLight(0x8fb0e0, 0.45));

    const glow = glowTexture();
    // The Sun as seen from another world: a point of light with a glow, kept a fixed distance from the camera.
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true }));
    this.sunSprite.renderOrder = 40;
    // …and its corona when the Sun itself is the place (or the middle of the map).
    this.corona = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 }));
    this.corona.renderOrder = 3;
    this.scene.add(this.sunSprite, this.corona);

    const rim = new THREE.BufferGeometry();
    rim.setAttribute('position', new THREE.BufferAttribute(new Float32Array(96 * 3), 3));
    this.footprint = new THREE.LineLoop(rim, new THREE.LineBasicMaterial({ color: 0x7fe3ff, transparent: true, opacity: 0.6, depthWrite: false }));
    this.footprint.frustumCulled = false;
    this.footprint.visible = false;
    this.scene.add(this.footprint);

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
      if (this.live) this.downAt = { x: event.clientX, y: event.clientY, time: performance.now() };
    });
    // Pointing at something that can be clicked: the hand cursor and a hover card (the same
    // test as a click, at most every 50 ms; a mouse only, a finger has no hover).
    let hoverAt = 0;
    canvas.addEventListener('pointermove', (event) => {
      if (!this.live || event.pointerType === 'touch') return;
      if (event.buttons !== 0) {
        this.host.onHover(null, 0, 0); // dragging the view
        return;
      }
      const now = performance.now();
      if (now - hoverAt < 50) return;
      hoverAt = now;
      const item = this.pick(event.clientX, event.clientY);
      canvas.style.cursor = item ? 'pointer' : '';
      this.host.onHover(item ? item.target : null, event.clientX, event.clientY);
    });
    canvas.addEventListener('pointerleave', () => {
      if (this.live) this.host.onHover(null, 0, 0);
    });
    canvas.addEventListener('pointerup', (event) => {
      const down = this.downAt;
      this.downAt = null;
      if (!this.live || !down) return;
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6 || performance.now() - down.time > 600) return; // a drag, not a tap
      this.tap(this.pick(event.clientX, event.clientY));
    });
    // Zooming past either end of a view carries on into the next one: out of a place to the
    // map, and on the map into the body the camera has been brought right up to.
    const pastEdge = (outwards: boolean): boolean => {
      if (!this.live || this.flight) return false;
      const distance = this.camera.position.distanceTo(this.controls.target);
      if (outwards && this.where?.kind === 'place' && distance > this.controls.maxDistance * 0.985) this.host.onOut();
      else if (!outwards && this.where?.kind === 'system' && this.focus?.kind === 'body' && distance < this.controls.minDistance * 1.04) this.host.onOpen(this.focus);
      else return false;
      return true;
    };
    canvas.addEventListener('wheel', (event) => void pastEdge(event.deltaY > 0), { passive: true });
    // The same with two fingers: a pinch that begins at the edge of a view and keeps going.
    // (One change of scene per pinch: `spent` stops a long pinch from skipping two steps.)
    const spread = (event: TouchEvent) => Math.hypot(event.touches[0].clientX - event.touches[1].clientX, event.touches[0].clientY - event.touches[1].clientY);
    let pinch = 0, spent = false;
    canvas.addEventListener('touchstart', (event) => {
      pinch = event.touches.length === 2 ? spread(event) : 0;
      spent = false;
    }, { passive: true });
    canvas.addEventListener('touchmove', (event) => {
      if (event.touches.length !== 2 || pinch <= 0 || spent) return;
      const ratio = spread(event) / pinch;
      if (ratio < 0.8) spent = pastEdge(true);
      else if (ratio > 1.25) spent = pastEdge(false);
    }, { passive: true });
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.applyShift();
    });
  }

  /** What SceneKit needs to draw this view. */
  get view(): OtherView {
    return { scene: this.scene, camera: this.camera, target: this.controls.target };
  }

  /** Is the slow idle turn happening right now? (The interface dims itself then.) */
  get drifting(): boolean {
    return this.live && !this.flight && !this.interacting && this.idle > 4 && this.host.drift();
  }

  get flying(): boolean {
    return this.flight !== null;
  }

  /** On screen and taking input, or built but out of sight (waiting for, or left behind by, a dissolve). */
  setLive(on: boolean): void {
    this.live = on;
    this.controls.enabled = on;
    this.tagRoot.hidden = !on;
    if (on) this.idle = 0;
  }

  /** The stars and Milky Way, and the constellation figures (the tracker's own Layers switches). */
  setSky(stars: boolean, figures: boolean): void {
    this.backdrop.children[0].visible = stars;
    this.backdrop.children[1].visible = stars;
    this.backdrop.children[2].visible = stars && figures;
  }

  /** The Layers switches that apply away from the tracker. */
  setOptions(options: SpaceOptions): void {
    this.options = options;
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

  /** The spacecraft from public/data/deep.json (may arrive after a view has been built). */
  setCraft(crafts: Craft[], tMs: number): void {
    this.crafts = crafts;
    if (this.where) this.build(this.where, tMs, true);
  }

  // ---- building and clearing -----------------------------------------------------------------

  /**
   * Make this view show a place or the map. The camera is put at the ordinary viewpoint unless
   * `keepCamera` (a rebuild of what is already here); a caller that is arriving mid-move then
   * takes the camera over with update(…, slave) and settle().
   */
  build(where: Where, tMs: number, keepCamera = false): void {
    const focus = keepCamera ? this.focus : null;
    this.clear();
    this.where = where;
    this.builtAt = tMs;
    if (where.kind === 'system') this.buildMap(tMs);
    else this.buildPlace(where.body, tMs);
    this.place(tMs);
    this.focus = focus && this.items.some((item) => item.key === targetKey(focus)) ? focus : null;
    if (!keepCamera) this.homeCamera();
    this.snap = true;
    this.limits();
  }

  /** Put everything away (the view is then not drawn or updated). */
  clear(): void {
    this.dropTrack();
    this.dropRoverPaths();
    this.cells = null; // (a child of `content`, which is emptied below; its buffers are small)
    this.casters = [];
    this.footprint.visible = false;
    this.ground?.dispose(); // its patches are children of the body's mesh, which goes next
    this.ground = null;
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
    this.shadow.visible = false;
    this.groundAt.key = '';
    this.modelKey = '';
    this.flight = null;
    this.where = null;
    this.focus = null;
  }

  private toWorld(v: Vec, scale: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(v[0], v[2], -v[1]).multiplyScalar(scale).applyQuaternion(this.frame);
  }

  private get segments(): number {
    return this.kit.quality === 'high' ? 128 : this.kit.quality === 'balanced' ? 96 : 64;
  }

  private addBody(body: Body, radius: number, centre: boolean, detail: 'full' | 'small' | 'none'): Item {
    const mesh = createBody(body.id, body.color, radius, centre ? this.segments : 64);
    this.content.add(mesh.mesh);
    const item: Item = { target: { kind: 'body', body }, key: `body:${body.id}`, pos: new THREE.Vector3(), radius, tag: null, mesh, shown: true, centre, beside: 0, sharp: false, base: radius, scale: 1, quiet: false };
    const map = this.where?.kind === 'system';
    if (!centre || map) item.tag = this.makeTag(item, body.name, body.kind === 'moon' && map ? 'is-minor' : 'is-body');
    this.items.push(item);
    if (detail === 'full') this.sharpen(item);
    else if (detail === 'small') {
      // The map starts every body on a small copy of its map (a few kilobytes each); the one the
      // camera goes up to is given the full one then. If there is no small copy, the full one.
      const imagery = IMAGERY[body.id];
      if (imagery) {
        this.loadMap(this.smallFace(body.id), (texture) => {
          if (texture && this.items.includes(item) && !item.sharp) mesh.setMap(texture);
          else if (!texture) this.sharpen(item);
        });
      }
    }
    return item;
  }

  /**
   * The picture a body is seen by. A world wrapped in cloud (Venus) is seen by its clouds, as
   * it is from space; `surface` swaps in the ground under them (radar, for Venus).
   */
  private face(id: BodyId): string {
    const imagery = IMAGERY[id]!;
    return imagery.clouds && id !== 'earth' && !this.surface ? imagery.clouds : guessed(id, imagery.base);
  }

  /** The small copy of that picture, which the solar system starts every body on. */
  private smallFace(id: BodyId): string {
    const face = this.face(id);
    const plain = face.endsWith(GUESS_TAG) ? face.slice(0, -GUESS_TAG.length) : face;
    return guessed(id, plain.replace(/\.(jpg|webp|png)$/, '_s.$1')).replace(GUESS_TAG + GUESS_TAG, GUESS_TAG);
  }

  /** "Fill in unseen ground" changed: every view gives those worlds their other map. */
  static setGuessUnseen(on: boolean): void {
    if (GUESS === on) return;
    GUESS = on;
    for (const view of VIEWS) view.refreshUnseen();
  }

  private refreshUnseen(): void {
    for (const item of this.items) {
      if (item.target.kind !== 'body' || !item.mesh || !UNSEEN[item.target.body.id]) continue;
      const mesh = item.mesh, id = item.target.body.id;
      if (item.sharp) {
        item.sharp = false;
        this.sharpen(item);
      } else {
        this.loadMap(this.smallFace(id), (texture) => {
          if (texture && this.items.includes(item) && !item.sharp) mesh.setMap(texture);
        });
      }
    }
  }

  /** Show the ground of cloud-covered worlds instead of their clouds (or the clouds again). */
  setSurface(on: boolean): void {
    if (this.surface === on) return;
    this.surface = on;
    for (const item of this.items) {
      if (item.target.kind !== 'body' || !item.mesh || !IMAGERY[item.target.body.id]?.clouds || item.target.body.id === 'earth') continue;
      item.sharp = false;
      this.sharpen(item);
    }
    if (this.ground && this.where?.kind === 'place') this.ground.enabled = this.groundWanted(this.where.body);
  }
  get showingSurface(): boolean {
    return this.surface;
  }

  /** Give a body its full map, its rings, and (the Earth) its night lights and clouds. */
  private sharpen(item: Item): void {
    if (item.sharp || !item.mesh || item.target.kind !== 'body') return;
    item.sharp = true;
    const body = item.target.body, mesh = item.mesh;
    const imagery = IMAGERY[body.id];
    if (!imagery) return;
    const here = () => this.items.includes(item);
    // The sharpest copy only where it can be seen and afforded: the body being visited, on the
    // High setting, on a computer (a 4096-pixel map is 85 MB of graphics memory with its mipmaps).
    const best = item.centre && this.kit.quality === 'high' && !this.host.isPhone() ? imagery.baseHigh : undefined;
    let haveBest = false;
    const face = this.face(body.id);
    this.loadMap(face, (texture) => {
      if (texture && here() && !haveBest && this.face(body.id) === face) mesh.setMap(texture);
    });
    if (best && face === guessed(body.id, imagery.base)) {
      this.loadMap(guessed(body.id, best), (texture) => {
        if (!texture || !here()) return;
        haveBest = true;
        mesh.setMap(texture);
      });
    }
    if (body.id === 'earth' && this.kit.quality !== 'fast' && !this.host.isPhone()) {
      // The same two pictures the tracker's globe uses (already in the browser's cache).
      this.loadMap('textures/earth-night.jpg', (night) => {
        this.loadMap('textures/clouds.png', (clouds) => {
          if (night && clouds && here()) mesh.setExtras(night, clouds);
        });
      });
    }
    const ring = imagery.ring;
    if (ring) {
      const scale = item.radius / body.radiusKm;
      this.loadMap(ring.strip, (strip) => {
        if (strip && here() && !mesh.ring) addRing(mesh, strip, ring.innerKm * scale, ring.outerKm * scale, item.radius);
      });
    }
  }

  private addCraft(craft: Craft): Item {
    const item: Item = { target: { kind: 'craft', craft }, key: `craft:${craft.id}`, pos: new THREE.Vector3(), radius: 0, tag: null, mesh: null, shown: true, centre: false, beside: 0, sharp: false, base: 0, scale: 1, quiet: this.where?.kind === 'system' && !HEADLINE.has(craft.id) };
    item.tag = this.makeTag(item, craft.short, craft.site ? 'is-craft is-site' : craft.passing ? 'is-craft is-rock' : craft.status === 'silent' ? 'is-craft is-silent' : 'is-craft');
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
    this.tagRoot.append(tag);
    return tag;
  }

  private buildPlace(id: BodyId, tMs: number): void {
    const body = BODIES[id];
    this.unitsPerKm = R / body.radiusKm;
    // North up: turn the whole view so this body's pole is the screen's vertical.
    const pole = bodyAxes(id, tMs).pole;
    this.frame.setFromUnitVectors(this.scratch.set(pole[0], pole[2], -pole[1]).normalize(), UP);

    const centre = this.addBody(body, R, true, 'full');
    // Close-up ground, where this world's map is served in tiles (render/tiles.ts): patches
    // that are children of the body's mesh, so they turn with it, lit through the body's own
    // uniforms, so they are lit exactly as it is. Nothing is fetched until the camera comes
    // close, and each patch fades in, so entering or leaving the place shows none of it.
    const tiles = IMAGERY[id]?.tiles;
    if (tiles && centre.mesh) {
      this.ground = new GroundTiles(centre.mesh.mesh, {
        // NASA Trek: a plain latitude / longitude map, two squares at level 0. Level 4 is the
        // first that shows more than a 4096-pixel map of the whole body does.
        source: { url: tiles.url, grid: 'degrees', lowZoom: 2, nearZoom: 4, maxZoom: tiles.maxZoom, quietWhenMissing: true },
        radiusKm: body.radiusKm,
        light: { like: 'body', uniforms: centre.mesh.uniforms, occluders: MAX_OCCLUDERS },
        farCover: 1, // no clouds to keep in view: the tiles cover the map completely from the start
        anisotropy: this.kit.quality === 'fast' ? 1 : Math.min(8, this.kit.renderer.capabilities.getMaxAnisotropy()),
        matchTone: true,
      });
      this.ground.enabled = this.groundWanted(id);
      // The tiles are toned to match the body's own map, once that has arrived (or failed to).
      const ground = this.ground, base = IMAGERY[id]!.base;
      this.loadMap(base, (texture) => {
        if (this.ground === ground) ground.setReference(texture ? (texture.image as CanvasImageSource) : null);
      });
    }
    // Company: its moons; and for a moon, the planet it circles and the other moons there.
    const family = BODY_LIST.filter((other) => other.id !== id && (other.parent === id || (body.kind === 'moon' && (other.id === body.parent || other.parent === body.parent))));
    // Their maps too, except from the Sun: at true scale a planet seen from there is less than a pixel.
    const detail = this.kit.quality === 'fast' || id === 'sun' ? 'none' : 'full';
    // The planet a moon circles gets its full map (it fills a moon's sky); the other moons a small
    // copy until one is looked at — a planet can have a dozen, and each full map is megabytes.
    for (const other of family) this.addBody(other, other.radiusKm * this.unitsPerKm, false, detail === 'full' && other.id !== body.parent ? 'small' : detail);
    for (const craft of this.crafts) if (craft.centre === id) this.addCraft(craft);
    this.roverPaths(id);

    this.drawLines(tMs);
    let reach = R * 8;
    this.casters = this.items.filter((item) => item.mesh && item.target.kind === 'body' && item.target.body.id !== 'sun').sort((a, b) => b.radius - a.radius);
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
      if (size !== undefined) {
        this.addBody(body, size, body.id === 'sun', detail);
      } else if (body.visitable && body.parent && MAP_SIZE[body.parent] !== undefined) {
        // A moon that can be visited is drawn beside its planet — on its true side, but nothing
        // like its true distance, which at this scale is inside the planet's dot.
        const beside = this.items.filter((other) => other.beside > 0 && (other.target as { body: Body }).body.parent === body.parent).length + 1;
        const item = this.addBody(body, THREE.MathUtils.clamp(MAP_SIZE[body.parent]! * 0.2, 0.42, 0.72), false, detail);
        item.beside = beside;
      }
    }
    for (const craft of this.crafts) if (craft.centre === 'sun') this.addCraft(craft);
    this.drawLines(tMs);
    this.extent = 620;
    this.buildDots();
    this.corona.visible = true;
    this.corona.scale.setScalar(MAP_SIZE.sun! * 5.2);
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

  /**
   * One period of a closed orbit, with points added wherever the path turns quickly as seen
   * from the body it circles. Evenly spaced in time alone, a stretched orbit was cut short:
   * Juno (e = 0.97) spends two hours of its 33 days close to Jupiter, so 240 even steps put
   * one point near the planet and the line ran straight THROUGH it (the owner asked whether
   * Juno was "going through Jupiter"; the craft itself was always placed right).
   */
  private sampleOrbit(period: number, tMs: number, at: (t: number) => THREE.Vector3): Float32Array {
    const BASE = 240, TURN = 0.04, DEPTH = 8; // a point at least every 2.3° round the centre
    const out: number[] = [];
    const fill = (t0: number, p0: THREE.Vector3, t1: number, p1: THREE.Vector3, depth: number): void => {
      if (depth >= DEPTH || p0.angleTo(p1) <= TURN) return;
      const tm = (t0 + t1) / 2, pm = at(tm).clone();
      fill(t0, p0, tm, pm, depth + 1);
      out.push(pm.x, pm.y, pm.z);
      fill(tm, pm, t1, p1, depth + 1);
    };
    let t0 = tMs, p0 = at(tMs).clone();
    for (let i = 1; i <= BASE; i++) {
      out.push(p0.x, p0.y, p0.z);
      const t1 = tMs + (period * i) / BASE, p1 = at(t1).clone();
      fill(t0, p0, t1, p1, 0);
      t0 = t1;
      p0 = p1;
    }
    return new Float32Array(out);
  }

  /**
   * Every path in this view, drawn from `tMs` on: at a place, everything here that circles
   * something else here (moons round their planet; from the Sun, the planets, at true scale) and
   * each craft round this body; on the map, each planet round the Sun and each craft between
   * them. Separate from build() so that a clock running at a month a second can renew the
   * paths alone (refreshLines) instead of rebuilding every world and reloading its map.
   */
  private drawLines(tMs: number): void {
    const where = this.where;
    if (!where) return;
    for (const item of this.items) {
      if (where.kind === 'system') {
        if (item.target.kind === 'craft') this.craftLine(item, tMs, (v) => this.mapPoint(v, this.scratch));
        else if (item.target.body.id !== 'sun' && item.beside === 0 && MAP_SIZE[item.target.body.id] !== undefined) {
          const body = item.target.body;
          this.addLine(this.sample(body.periodDays * DAY, 256, tMs, (t) => this.mapPoint(bodyPosition(body.id, t, this.vec), this.scratch)), item.key, body.color, 0.26, null, true);
        }
      } else if (item.target.kind === 'body') {
        const other = item.target.body;
        if (item.centre || !other.parent) continue;
        const anchor = other.parent === where.body ? null : this.items.find((candidate) => candidate.key === `body:${other.parent}`) ?? null;
        if (other.parent !== where.body && !anchor) continue;
        const points = this.sample(other.periodDays * DAY, 240, tMs, (t) => this.toWorld(bodyRelative(other.id, other.parent!, t, this.vec), this.unitsPerKm, this.scratch));
        this.addLine(points, item.key, other.color, 0.3, anchor, true);
      } else {
        this.craftLine(item, tMs, (v) => this.toWorld(v, this.unitsPerKm, this.scratch));
      }
    }
  }

  /** Renew the paths only (a long way on in time); the worlds, their maps and the camera stay as they are. */
  private refreshLines(tMs: number): void {
    for (const { line } of this.lines) {
      line.removeFromParent();
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.lines = [];
    this.drawLines(tMs);
    this.builtAt = tMs;
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
        points = this.sampleOrbit(period, tMs, at);
        closed = true;
      } else {
        // Leaving for good (or on a very long orbit): where it has come from and where it is going.
        const span = 8 * 365.25 * DAY;
        points = new Float32Array(160 * 3);
        for (let i = 0; i < 160; i++) at(tMs - span / 2 + (span * i) / 159).toArray(points, i * 3);
      }
    }
    this.addLine(points, item.key, craft.passing ? [0.78, 0.7, 0.62] : craft.status === 'silent' ? [0.5, 0.56, 0.66] : [1, 0.78, 0.46], 0.34, null, closed);
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
      colors.set(craft.site ? [0.74, 0.86, 1] : craft.passing ? [0.78, 0.7, 0.62] : craft.status === 'silent' ? [0.55, 0.62, 0.74] : [1, 0.84, 0.56], i * 3);
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

  /** Is a map in use by any body of this view? */
  private using(texture: THREE.Texture): boolean {
    return this.items.some((item) => item.mesh && Object.values(item.mesh.uniforms).some((uniform) => uniform.value === texture));
  }

  /** Fetch a map once for all views (see MAPS). `ready` gets null if it cannot be fetched. */
  private loadMap(address: string, ready: (texture: THREE.Texture | null) => void): void {
    const kept = MAPS.get(address);
    if (kept) {
      MAPS.delete(address);
      MAPS.set(address, kept); // most recently used last
      ready(kept);
      return;
    }
    const waiting = WAITING.get(address);
    if (waiting) {
      waiting.push(ready);
      return;
    }
    WAITING.set(address, [ready]);
    const done = (texture: THREE.Texture | null) => {
      const callbacks = WAITING.get(address) ?? [];
      WAITING.delete(address);
      for (const callback of callbacks) callback(texture);
    };
    const keep = (texture: THREE.Texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = this.kit.quality === 'fast' ? 1 : Math.min(8, this.kit.renderer.capabilities.getMaxAnisotropy());
      texture.wrapS = THREE.RepeatWrapping; // the map joins up across longitude 180°
      texture.flipY = false; // see the vertex shader in bodyMesh.ts
      texture.needsUpdate = true;
      MAPS.set(address, texture);
      const limit = this.host.isPhone() ? 16 : 40;
      for (const [old, stale] of MAPS) {
        if (MAPS.size <= limit) break;
        if (VIEWS.some((view) => view.using(stale))) continue;
        stale.dispose();
        MAPS.delete(old);
      }
      // Hand it to the graphics card in an idle moment, BEFORE anything draws with it: left to
      // the first frame that uses it, a 4096-pixel map costs that frame tens of milliseconds,
      // and that frame is usually in the middle of a camera move.
      idle(() => {
        this.kit.renderer.initTexture(texture);
        done(texture);
      });
    };
    // Decoded off the main thread where the browser can (as render/tiles.ts does); otherwise the ordinary way.
    const guess = address.endsWith(GUESS_TAG);
    const file = guess ? address.slice(0, -GUESS_TAG.length) : address;
    if (typeof createImageBitmap === 'function') {
      fetch(file)
        .then((response) => (response.ok ? response.blob() : Promise.reject(new Error(String(response.status)))))
        .then((blob) => createImageBitmap(blob))
        .then((bitmap) => (guess ? fillUnseen(bitmap) : bitmap))
        .then((bitmap) => keep(new THREE.Texture(bitmap as unknown as HTMLImageElement)))
        .catch(() => done(null));
    } else {
      new THREE.TextureLoader().load(file, keep, undefined, () => done(null)); // (no guess without image bitmaps)
    }
  }

  /**
   * Do the first-time work of drawing this view now, out of sight: compile its shaders and send
   * its shapes to the graphics card by drawing it once into a tiny buffer. Called in an idle
   * moment after a view is built, so the frame in which it first appears (always in the middle
   * of a change of scene) has nothing left to set up.
   */
  prewarm(): void {
    if (!this.where) return;
    const renderer = this.kit.renderer;
    this.camera.updateMatrixWorld();
    this.backdrop.position.copy(this.camera.position);
    renderer.compile(this.scene, this.camera);
    const tiny = (WARM ??= new THREE.WebGLRenderTarget(32, 32, { type: THREE.HalfFloatType }));
    const before = renderer.getRenderTarget();
    renderer.setRenderTarget(tiny);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(before);
  }

  // ---- every frame ---------------------------------------------------------------------------

  /**
   * Put every item where it is at `tMs`.
   *
   * On the map the dots are also sized here. Far off, every body is drawn at its map size. But
   * the dots are huge for the distances between them, so with the camera beside one planet
   * its neighbours would loom like a second world next door. A dot the camera is near is
   * therefore shrunk in proportion (it keeps the size on screen it had from further off) —
   * except the one being looked at and its moons, which are the real thing and grow as the
   * camera approaches. `dt` eases the change; without it sizes are left as they are.
   */
  private place(tMs: number, dt = -1): void {
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
          item.shown = this.wanted(item);
          if (item.mesh) item.mesh.mesh.visible = item.shown;
        } else {
          const craft = item.target.craft;
          const state = craftPosition(craft, tMs, this.vec);
          this.toWorld(state.pos, this.unitsPerKm, item.pos);
          // Something on the ground stands a hair above it: the close-up ground (render/tiles.ts)
          // is drawn as patches lifted up to 0.11 % of the radius, and would bury it otherwise.
          if (craft.motion.type === 'surface') item.pos.multiplyScalar(1.0014);
          // From the Sun, only what the true-scale view reaches: the far probes belong on the map.
          // A passing asteroid is here only for the few days its path is known for.
          item.shown = (centre !== 'sun' || item.pos.length() < 60000) && !(craft.passing && state.held) && this.wanted(item);
        }
      }
      const sunSize = sunKm > 1 ? SUN_RADIUS_KM / sunKm : 0.0046;
      for (const item of this.items) if (item.mesh) this.light(item, tMs, this.sunDir, sunSize);
    } else {
      for (const item of this.items) {
        if (item.target.kind === 'craft') {
          this.mapPoint(craftPosition(item.target.craft, tMs, this.vec).pos, item.pos);
          item.shown = this.wanted(item);
        } else if (item.target.body.id === 'sun') item.pos.set(0, 0, 0);
        else if (item.beside === 0) this.mapPoint(bodyPosition(item.target.body.id, tMs, this.vec), item.pos);
      }
      for (const item of this.items) {
        if (item.beside === 0 || item.target.kind !== 'body') continue;
        const moon = item.target.body;
        const planet = this.items.find((other) => other.key === `body:${moon.parent}`);
        if (!planet) continue;
        // (Measured from the planet's full size, whatever size it is drawn at just now: a moon
        // must not slide about as its planet's dot shrinks or grows.)
        this.toWorld(bodyRelative(moon.id, moon.parent!, tMs, this.vec), 1, item.pos).normalize().multiplyScalar(planet.base * (1.4 + 0.36 * item.beside)).add(planet.pos);
      }
      const focusKey = this.focus ? targetKey(this.focus) : '';
      const ease = dt < 0 ? 0 : this.snap ? 1 : 1 - Math.exp(-dt * 5);
      this.snap = false;
      for (const item of this.items) {
        if (!item.mesh || item.target.kind !== 'body') continue;
        const own = item.key === focusKey || (item.beside > 0 && `body:${item.target.body.parent}` === focusKey);
        // The planet of the moon being looked at stays at least half size: it is that moon's
        // world, and shrunk to a speck beside it the pair would look the wrong way round.
        const parentOfFocus = this.focus?.kind === 'body' && this.focus.body.parent === item.target.body.id && item.target.body.kind !== 'star';
        const near = THREE.MathUtils.clamp(this.camera.position.distanceTo(item.pos) / 110, 0.2, 1);
        const want = own ? 1 : parentOfFocus ? Math.max(near, 0.5) : near;
        item.shown = this.wanted(item);
        item.mesh.mesh.visible = item.shown;
        item.scale += (want - item.scale) * ease;
        item.radius = item.base * item.scale;
        item.mesh.mesh.scale.setScalar(item.scale);
        if (item.centre) this.corona.scale.setScalar(item.radius * 5.2);
        this.scratch.copy(item.pos).multiplyScalar(-1);
        if (this.scratch.lengthSq() < 1e-9) this.scratch.set(1, 0, 0);
        this.light(item, tMs, this.scratch.normalize(), 0.004);
      }
    }
  }

  /** Is a craft (or landing site) switched on in Layers? What is being looked at always is. */
  private wanted(item: Item): boolean {
    if (item.centre || (this.focus && targetKey(this.focus) === item.key)) return true;
    if (item.target.kind === 'body') return item.target.body.kind !== 'moon' || this.options.moons;
    return item.target.craft.site ? this.options.sites : this.options.craft;
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
      // The biggest first: a planet with a dozen moons has room for six shadows, and Titan's
      // crossing Saturn matters more than a 90-kilometre rock's.
      for (const other of this.casters) {
        if (other === item || !other.shown || count >= MAX_OCCLUDERS) continue;
        occluders[count++].set(other.pos.x, other.pos.y, other.pos.z, other.radius);
      }
    }
    u.uOccCount.value = count;
  }

  /**
   * One frame. With `slave`, the camera is not this view's own to move: it is held where
   * another scene's camera is, relative to the body `slave.key` (see the header), which is how
   * the two scenes of a dissolve are kept showing the same picture.
   */
  update(dt: number, tMs: number, realSeconds: number, slave: { key: string | null; pose: Pose } | null = null): void {
    if (!this.where) return;
    // Orbits are drawn from "now" for one period; after a long jump in time they would be stale.
    if (Math.abs(tMs - this.builtAt) > 120 * DAY) this.refreshLines(tMs);
    this.place(tMs, dt);
    const map = this.where.kind === 'system';
    const focusItem = this.focus ? this.item(targetKey(this.focus)) : null;

    for (const item of this.items) if (item.mesh) item.mesh.uniforms.uTime.value = realSeconds;
    for (const { line, key, anchor } of this.lines) {
      if (anchor) line.position.copy(anchor.pos);
      const owner = this.items.find((item) => item.key === key);
      const craft = owner?.target.kind === 'craft' ? owner.target.craft : null;
      const pathless = map && craft !== null && !this.options.allCraft && !LEAVING.has(craft.id);
      // The craft being looked at follows its own switch ("Orbit"), like a selected satellite in the tracker.
      line.visible = (owner?.shown ?? true) && (craft && owner === focusItem ? this.options.selOrbit : craft ? this.options.craftOrbits && !pathless : this.options.orbits);
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
    if (slave) this.adopt(slave.key, slave.pose);
    else this.moveCamera(dt, focusItem);
    this.camera.updateMatrixWorld();
    if (this.ground) {
      // The body turns under a camera that stays put among the stars, so with the clock running
      // fast the ground streams past; the tiles are told the rate and settle for a coarser level.
      const rate = dt > 0 ? Math.abs(tMs - this.lastT) / 1000 / dt : 1;
      this.ground.update(this.camera, this.sunDir, realSeconds, dt, undefined, rate);
    }
    this.lastT = tMs;
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
    this.updateGround(focusItem, tMs);
    this.updateRoverPaths(focusItem, realSeconds);
    if (this.live) this.updateTags(focusItem);
    this.updateSkyNames();
  }

  // ---- the selected craft's path over the ground, and the ground that can see it -----------------

  private dropTrack(): void {
    if (!this.track) return;
    this.track.removeFromParent();
    this.track.geometry.dispose();
    (this.track.material as THREE.Material).dispose();
    this.track = null;
    this.trackKey = '';
  }

  private updateGround(focusItem: Item | null, tMs: number): void {
    const where = this.where;
    const craft = where?.kind === 'place' && focusItem?.target.kind === 'craft' ? focusItem.target.craft : null;
    const centre = this.item(null);
    const aloft = craft !== null && focusItem !== null && craft.motion.type !== 'surface' && !craft.passing && focusItem.pos.length() > R * 1.002;

    // Footprint: the circle on the ground from which the craft is above the horizon. Seen from
    // the body's centre it lies acos(R / r) away from the point straight under the craft.
    this.footprint.visible = aloft && this.options.selFootprint;
    if (this.footprint.visible && focusItem) {
      const up = focusItem.pos.clone().normalize();
      const reach = Math.acos(Math.min(1, R / focusItem.pos.length()));
      const a = new THREE.Vector3().crossVectors(up, Math.abs(up.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0)).normalize();
      const b = new THREE.Vector3().crossVectors(up, a);
      const position = this.footprint.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < position.count; i++) {
        const turn = (i / position.count) * Math.PI * 2;
        this.scratch.copy(up).multiplyScalar(Math.cos(reach)).addScaledVector(a, Math.sin(reach) * Math.cos(turn)).addScaledVector(b, Math.sin(reach) * Math.sin(turn)).multiplyScalar(R * 1.006);
        position.setXYZ(i, this.scratch.x, this.scratch.y, this.scratch.z);
      }
      position.needsUpdate = true;
    }

    // Ground track: where the craft is straight above during one trip round, starting a little
    // behind it. The body turns underneath while the craft goes round, so the line is worked
    // out in the body's own turning frame (latitude and longitude at each moment) and hung on
    // the body's mesh; it does not close up, exactly as on the Earth.
    const period = craft ? craftPeriodMs(craft) : null;
    if (!aloft || !craft || !this.options.selTrack || !centre?.mesh || where?.kind !== 'place' || period === null || period > 12 * DAY) {
      this.dropTrack();
      return;
    }
    if (this.trackKey === craft.id && Math.abs(tMs - this.trackAt) < period * 0.03) return;
    this.dropTrack();
    const count = 240;
    const points = new Float32Array(count * 3);
    const east: Vec = [0, 0, 0];
    for (let i = 0; i < count; i++) {
      const t = tMs + period * (i / (count - 1) - 0.06);
      const p = craftPosition(craft, t, this.vec).pos;
      const { pole, prime } = bodyAxes(where.body, t);
      east[0] = pole[1] * prime[2] - pole[2] * prime[1];
      east[1] = pole[2] * prime[0] - pole[0] * prime[2];
      east[2] = pole[0] * prime[1] - pole[1] * prime[0];
      const r = Math.hypot(p[0], p[1], p[2]) || 1;
      const scale = (R * 1.006) / r;
      // The body's own axes: longitude 0 on +X, north on +Y, 90° east on −Z.
      points[i * 3] = (p[0] * prime[0] + p[1] * prime[1] + p[2] * prime[2]) * scale;
      points[i * 3 + 1] = (p[0] * pole[0] + p[1] * pole[1] + p[2] * pole[2]) * scale;
      points[i * 3 + 2] = -(p[0] * east[0] + p[1] * east[1] + p[2] * east[2]) * scale;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
    this.track = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffb454, transparent: true, opacity: 0.75, depthWrite: false }));
    this.track.frustumCulled = false;
    centre.mesh.mesh.add(this.track);
    this.trackKey = craft.id;
    this.trackAt = tMs;
  }

  // ---- the paths the rovers have driven ----------------------------------------------------------

  /**
   * Lines on the ground where each rover of this place has driven (public/data/rovers.json,
   * NASA's own traverse maps; space/rovers.ts). The file is fetched the first time a place with
   * something standing on its ground is built, so a visitor who never goes to Mars never loads
   * it. Each line is a child of the body's mesh (it turns with the ground) at radius R, and is
   * raised each frame to whatever ground is drawn there (see updateRoverPaths).
   */
  private roverPaths(id: BodyId): void {
    const mesh = this.item(null)?.mesh?.mesh;
    if (!mesh || !this.crafts.some((craft) => craft.centre === id && craft.motion.type === 'surface')) return;
    if (!this.roverWatch) {
      this.roverWatch = true;
      // A newer file (a tab left open overnight): draw the longer paths in place of the old ones.
      onRoversRefresh(() => {
        if (this.where?.kind !== 'place') return;
        this.dropRoverPaths();
        this.roverPaths(this.where.body);
      });
    }
    void loadRovers().then(() => {
      // The view may have moved on, or been rebuilt, while the file was on its way.
      if (this.where?.kind !== 'place' || this.where.body !== id || this.item(null)?.mesh?.mesh !== mesh || this.roverLines.length > 0) return;
      for (const craft of this.crafts) {
        const path = craft.centre === id ? roverPath(craft.id) : null;
        if (!path) continue;
        const position = new Float32Array(path.points.length * 3);
        const anchor = new THREE.Vector3();
        path.points.forEach(([latDeg, lonDeg], i) => {
          const lat = (latDeg * Math.PI) / 180, lon = (lonDeg * Math.PI) / 180;
          // The body's own axes: longitude 0 on +X, north on +Y, 90° east on −Z.
          position[i * 3] = R * Math.cos(lat) * Math.cos(lon);
          position[i * 3 + 1] = R * Math.sin(lat);
          position[i * 3 + 2] = -R * Math.cos(lat) * Math.sin(lon);
          anchor.x += position[i * 3];
          anchor.y += position[i * 3 + 1];
          anchor.z += position[i * 3 + 2];
        });
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
        // Lines take no polygonOffset (WebGL nudges only filled triangles), so the line is kept off
        // the tile patches by height instead; depthWrite off so it never hides what is on it.
        const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: ROVER_PATH, transparent: true, opacity: 0, depthWrite: false }));
        line.visible = false;
        mesh.add(line);
        this.roverLines.push({ line, key: `craft:${craft.id}`, anchor: anchor.setLength(R), checked: -Infinity });
      }
    });
  }

  private dropRoverPaths(): void {
    for (const { line } of this.roverLines) {
      line.removeFromParent();
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.roverLines = [];
  }

  /**
   * Show a path only once the camera has come down to it: a drive of a few tens of kilometres
   * is a speck from the ordinary view of the whole world, and would read as a stray mark beside
   * the rover's dot. The rover being looked at has its path drawn brighter.
   */
  private updateRoverPaths(focusItem: Item | null, realSeconds: number): void {
    if (this.roverLines.length === 0) return;
    const mesh = this.item(null)?.mesh?.mesh;
    for (const path of this.roverLines) {
      const line = path.line;
      if (!mesh || !this.options.roverPaths) {
        line.visible = false;
        continue;
      }
      const scale = mesh.scale.x || 1;
      const at = this.scratch.copy(path.anchor).applyMatrix4(mesh.matrixWorld);
      // Seen from up to a couple of radii away (a squiggle a few pixels long is still worth seeing:
      // the owner looked from the usual close view and found nothing), and always for the rover
      // being looked at.
      const chosenNow = focusItem?.key === path.key;
      const fade = chosenNow ? 1 : 1 - THREE.MathUtils.smoothstep(at.distanceTo(this.camera.position) / (R * scale), 1.4, 2.6);
      line.visible = fade > 0.01;
      if (!line.visible) continue;
      // The ground drawn here is the body's faceted sphere or a tile patch floating up to 0.11 %
      // above the radius, each level at its own height; the line sits just over whichever it is
      // (a ray straight down, twice a second: the patches change only as they load).
      if (realSeconds - path.checked > 0.5) {
        path.checked = realSeconds;
        line.scale.setScalar((this.groundUnder(at, R * scale * 1.0014) / (R * scale)) * 1.00005);
      }
      const chosen = focusItem?.key === path.key;
      const material = line.material as THREE.LineBasicMaterial;
      material.color.setHex(chosen ? ROVER_PATH_CHOSEN : ROVER_PATH);
      material.opacity = (chosen ? 1 : 0.6) * fade;
    }
  }

  // ---- screening cells --------------------------------------------------------------------------

  /**
   * Draw the cells of the spatial hash that hold something (ui/placeWatch.ts screens the craft
   * of a place with the same grid the tracker uses): `cells` is x, y, z of each cell's centre
   * in ICRF km about the place's body, then 1 if a pair inside the alert distance touches it;
   * `sizeKm` is the cell edge. Null takes the drawing away.
   */
  setCells(cells: Float64Array | null, sizeKm = 0): void {
    if (this.cells) {
      this.cells.removeFromParent();
      this.cells.geometry.dispose();
      (this.cells.material as THREE.Material).dispose();
      this.cells = null;
    }
    if (!cells || cells.length === 0 || this.where?.kind !== 'place') return;
    const count = cells.length / 4;
    const half = (sizeKm * this.unitsPerKm) / 2;
    const position = new Float32Array(count * 24 * 3), color = new Float32Array(count * 24 * 3);
    // The twelve edges of a cube, as pairs of corners (each corner a sign for x, y, z).
    const corners = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
    const edges = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
    for (let c = 0; c < count; c++) {
      // ICRF (x, y, z) → star axes (x, z, −y); the group below turns star axes into this view's.
      const cx = cells[c * 4] * this.unitsPerKm, cy = cells[c * 4 + 2] * this.unitsPerKm, cz = -cells[c * 4 + 1] * this.unitsPerKm;
      const hot = cells[c * 4 + 3] > 0;
      edges.forEach((corner, k) => {
        const at = (c * 24 + k) * 3;
        // In star axes a cube stays a cube with its y and z edges swapped, so the same signs serve.
        position[at] = cx + corners[corner][0] * half;
        position[at + 1] = cy + corners[corner][1] * half;
        position[at + 2] = cz + corners[corner][2] * half;
        color[at] = hot ? 1 : 0.5;
        color[at + 1] = hot ? 0.3 : 0.89;
        color[at + 2] = hot ? 0.37 : 1;
      });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
    this.cells = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false }));
    this.cells.quaternion.copy(this.frame);
    this.cells.frustumCulled = false;
    this.content.add(this.cells);
  }

  // ---- constellation names ---------------------------------------------------------------------

  /** The names of the constellation figures, as in the tracker: the same sky, so the same names. */
  private updateSkyNames(): void {
    const on = this.live && this.options.skyNames && this.backdrop.children[2].visible;
    if (!on) {
      if (this.skyRoot) this.skyRoot.hidden = true;
      return;
    }
    if (!this.skyRoot) {
      this.skyRoot = document.createElement('div');
      this.tagRoot.prepend(this.skyRoot);
      for (const figure of this.host.figures()) {
        const tag = document.createElement('div');
        tag.className = 'sky-label is-figure';
        tag.textContent = figure.name;
        this.skyRoot.append(tag);
        this.skyTags.push({ tag, direction: figure.direction });
      }
    }
    this.skyRoot.hidden = false;
    const eye = this.camera.position;
    const ray = new THREE.Vector3(), screen = new THREE.Vector3(), toBody = new THREE.Vector3();
    for (const { tag, direction } of this.skyTags) {
      ray.copy(direction).applyQuaternion(this.frame);
      let visible = this.project(screen.copy(eye).addScaledVector(ray, 1000), screen);
      // Behind a body? (The stars are at infinity: any body the sight line passes through hides them.)
      for (const item of this.items) {
        if (!visible) break;
        if (!item.mesh) continue;
        const along = toBody.copy(item.pos).sub(eye).dot(ray);
        if (along > 0 && toBody.addScaledVector(ray, -along).length() < item.radius) visible = false;
      }
      tag.style.display = visible ? '' : 'none';
      if (visible) tag.style.transform = `translate(${screen.x.toFixed(1)}px, ${screen.y.toFixed(1)}px) translate(-50%, -50%)`;
    }
  }

  // ---- the camera ----------------------------------------------------------------------------

  private item(key: string | null): Item | null {
    return (key ? this.items.find((candidate) => candidate.key === key) : this.items.find((candidate) => candidate.centre)) ?? null;
  }

  /** The key of the body that stands for `body` in this view: itself, or (a small moon on the map) its planet. */
  keyFor(body: BodyId): string | null {
    const has = (id: BodyId | null) => (id && this.items.some((item) => item.key === `body:${id}`) ? `body:${id}` : null);
    return has(body) ?? has(BODIES[body].parent);
  }

  /** How big one body looks: its radius over its distance from the camera. */
  apparent(key: string | null): number {
    const item = this.item(key);
    return item ? item.radius / Math.max(this.camera.position.distanceTo(item.pos), 1e-9) : 0;
  }

  /** Where the camera is relative to one body (null key = the body in the middle). */
  pose(key: string | null): Pose | null {
    const item = this.item(key);
    if (!item || item.radius <= 0) return null;
    const inverse = this.frame.clone().invert();
    return {
      rel: this.camera.position.clone().sub(item.pos).divideScalar(item.radius).applyQuaternion(inverse),
      quat: inverse.multiply(this.camera.quaternion),
    };
  }

  /** Put the camera where `pose` says, relative to one of this view's bodies. */
  private adopt(key: string | null, pose: Pose): void {
    const item = this.item(key);
    if (!item) return;
    const offset = pose.rel.clone().applyQuaternion(this.frame).multiplyScalar(item.radius);
    this.camera.position.copy(item.pos).add(offset);
    this.camera.quaternion.copy(this.frame).multiply(pose.quat);
    this.camera.up.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    // What it is looking at: the point straight ahead, as far away as the body.
    this.controls.target.copy(this.camera.position).add(this.scratch.set(0, 0, -1).applyQuaternion(this.camera.quaternion).multiplyScalar(offset.length()));
    this.flight = null;
  }

  /**
   * After a dissolve has ended on this view: carry the move on. The camera keeps the side it
   * is on, turns to look straight at the body, and comes to rest where the body looks
   * `apparent` big (its radius over the distance).
   */
  settle(key: string | null, apparent: number, duration: number): void {
    const item = this.item(key);
    if (!item) return;
    const offset = this.camera.position.clone().sub(item.pos);
    if (offset.lengthSq() < 1e-9) offset.set(0, 0.3, 1);
    this.limits();
    this.fly(offset.normalize().multiplyScalar(item.radius / apparent), duration, easeOut, item.pos.clone());
  }

  /**
   * The first half of a move that ends in another scene: towards (factor < 1) or away from
   * (factor > 1) what the camera is looking at, gathering speed.
   */
  surge(factor: number, duration: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.fly(offset.multiplyScalar(factor), duration, easeIn, this.controls.target.clone());
  }

  private homeOffset(): THREE.Vector3 {
    const phone = this.host.isPhone();
    if (this.where?.kind === 'system') return new THREE.Vector3(0, 135, 190).multiplyScalar(phone ? 1.55 : 1);
    // From the sunlit side, a little above and to one side, so the edge of night is in view.
    // A world with rings is seen from the side of the ring plane the Sun lights: from the other
    // side its rings show their dark face (true, but Saturn looked "off" to the owner: since its
    // 2025 equinox the Sun lights the rings' SOUTHERN face, while the view sat above the north).
    const side = new THREE.Vector3().crossVectors(UP, this.sunDir);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    const ringed = this.where?.kind === 'place' && !!IMAGERY[this.where.body]?.ring;
    const above = ringed && this.sunDir.y < 0 ? -0.28 : 0.28;
    return this.sunDir.clone().multiplyScalar(0.78).addScaledVector(side.normalize(), 0.55).addScaledVector(UP, above).normalize().multiplyScalar(R / (phone ? PLACE_REST_PHONE : PLACE_REST));
  }

  private homeCamera(): void {
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(this.homeOffset());
    this.camera.up.copy(UP);
    this.flight = null;
    this.idle = 0;
  }

  /** When this view was built, on the app's clock (its orbit lines are drawn from that moment). */
  get builtTime(): number {
    return this.builtAt;
  }

  /** Does the place have moons (or, for a moon, a planet and sister moons) to pull back and look at? */
  get hasCompany(): boolean {
    return this.items.some((item) => item.mesh !== null && !item.centre);
  }

  /**
   * For the status bar: at a place, the camera's height above this world's surface and the
   * latitude and (east) longitude under it, in the world's own turning frame; on the solar
   * system, the world the camera is beside (null: the whole of it).
   */
  readout(): { kind: 'place'; body: BodyId; heightKm: number; latDeg: number; lonDeg: number } | { kind: 'map'; beside: BodyId | null } | null {
    const where = this.where;
    if (!where) return null;
    if (where.kind === 'system') return { kind: 'map', beside: this.focus?.kind === 'body' ? this.focus.body.id : null };
    const mesh = this.item(null)?.mesh?.mesh;
    if (!mesh) return null;
    const local = mesh.worldToLocal(this.camera.position.clone());
    const r = local.length();
    const kmPerUnit = BODIES[where.body].radiusKm / R;
    return {
      kind: 'place', body: where.body,
      heightKm: Math.max(0, (r - R) * kmPerUnit),
      // The body's own axes: longitude 0 on +X, north on +Y, 90° east on −Z.
      latDeg: (Math.asin(THREE.MathUtils.clamp(local.y / Math.max(r, 1e-9), -1, 1)) * 180) / Math.PI,
      lonDeg: (Math.atan2(-local.z, local.x) * 180) / Math.PI,
    };
  }

  /** Give one body its full map now, ahead of the camera going up to it (see sharpen). */
  warmBody(body: BodyId): void {
    const item = this.item(`body:${body}`);
    if (item) this.sharpen(item);
  }

  /**
   * One of the standing views, like the tracker's "Whole Earth" and "Low orbit": of a place,
   * the whole of it from the sunlit side, low over the day side, the night side, or far enough
   * back to take in its moons; of the solar system, all of it, the inner planets, or straight
   * down on the planets' plane. Whatever was being followed is let go.
   */
  goView(name: 'whole' | 'close' | 'night' | 'moons' | 'inner' | 'above', tMs: number): void {
    if (!this.where) return;
    this.focus = null;
    this.place(tMs);
    this.limits();
    const phone = this.host.isPhone();
    let offset = this.homeOffset();
    if (this.where.kind === 'system') {
      if (name === 'inner') offset.multiplyScalar(0.36);
      else if (name === 'above') offset = new THREE.Vector3(0, phone ? 460 : 330, 0.5);
    } else {
      const side = new THREE.Vector3().crossVectors(UP, this.sunDir);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize();
      const rest = R / (phone ? PLACE_REST_PHONE : PLACE_REST);
      if (name === 'close') offset = this.sunDir.clone().multiplyScalar(0.88).addScaledVector(side, 0.32).addScaledVector(UP, 0.34).normalize().multiplyScalar(R * 1.3);
      else if (name === 'night') offset = this.sunDir.clone().multiplyScalar(-0.86).addScaledVector(side, 0.42).addScaledVector(UP, 0.28).normalize().multiplyScalar(rest);
      else if (name === 'moons') {
        let far = 0;
        for (const item of this.items) if (item.mesh && !item.centre && item.shown) far = Math.max(far, item.pos.length());
        offset.normalize().multiplyScalar(THREE.MathUtils.clamp(far * 1.9, R * 8, this.extent * 0.98));
      }
    }
    this.fly(offset, 1.8, easeInOut, ORIGIN.clone());
  }

  /** How close and how far the camera may go, for what is being looked at. */
  private limits(): void {
    const map = this.where?.kind === 'system';
    const item = this.focus ? this.item(targetKey(this.focus)) : null;
    if (item && !item.centre) this.controls.minDistance = item.base > 0 ? item.base * (map ? 2.2 : 1.15) : map ? 0.6 : 0.03; // full size, as in setFocus
    else this.controls.minDistance = map ? 12 : R * (1 + this.lowest);
  }

  /**
   * How close to the ground of the place's body the camera may come, in radii above the
   * surface. A whole-body map is not worth a closer look than 0.06 (400 km at the Earth).
   * Where there is close-up ground the camera may go on down until the finest level is drawn
   * about three times life size (below that only its pixels grow): 0.0375 for a map that
   * stops at level 7, less for a finer one. Never below 0.025: the camera looks at the body's
   * centre, and SceneKit sets its near plane at 2 % of the distance to what it looks at, so
   * ground closer than 0.02 radii would be cut away.
   */
  private get lowest(): number {
    if (!this.ground || this.where?.kind !== 'place') return 0.06;
    const finest = IMAGERY[this.where.body]?.tiles?.maxZoom ?? 0;
    return THREE.MathUtils.clamp(4.8 / 2 ** finest, 0.025, 0.06);
  }

  /** The Layers switch "Sharp ground": close-up tiles at a place whose body has them. */
  setSharpGround(on: boolean): void {
    this.sharpGround = on;
    if (this.ground && this.where?.kind === 'place') this.ground.enabled = this.groundWanted(this.where.body);
  }

  /** Close-up ground is of the GROUND: under a world's clouds it is drawn only while the visitor is looking beneath them. */
  private groundWanted(id: BodyId): boolean {
    const veiled = IMAGERY[id]?.clouds !== undefined && id !== 'earth';
    return this.sharpGround && (!veiled || this.surface);
  }

  private fly(toOffset: THREE.Vector3, duration: number, ease = easeInOut, toTarget: THREE.Vector3 | null = null): void {
    this.flight = {
      elapsed: 0,
      duration: Math.max(duration, 0.01),
      fromOffset: this.camera.position.clone().sub(this.controls.target),
      fromTarget: this.controls.target.clone(),
      toOffset,
      ease,
      toTarget,
    };
  }

  /**
   * Look at a body or craft (the camera then stays with it), or back at the middle with null.
   * On the map the body the camera goes up to is given its full map on the way.
   */
  setFocus(target: Target | null, tMs: number, duration = 1.4): void {
    const item = target ? this.item(targetKey(target)) : null;
    const previous = this.focus;
    this.focus = item ? item.target : null;
    if (!this.where) return;
    this.place(tMs);
    this.limits();
    const map = this.where.kind === 'system';
    if (!item || item.centre) {
      if (previous) this.fly(map ? this.homeOffset() : this.camera.position.clone().normalize().multiplyScalar(R / (this.host.isPhone() ? PLACE_REST_PHONE : PLACE_REST)), duration);
      return;
    }
    this.sharpen(item);
    // Stop a comfortable distance from it, on the side the camera is already on. Measured from
    // its FULL size (`base`), the size it grows back to once it is the one looked at: on the
    // solar system a dot the camera is near but not looking at is drawn shrunk (to a fifth),
    // and measured from that, the Moon chosen after a craft beside the Earth stopped five times
    // too close and then swelled to fill the screen (the owner: "it is just huge").
    const distance = item.base > 0 ? item.base / (map ? MAP_REST : 1 / 3.6) : map ? 5 : 0.13;
    const away = this.camera.position.clone().sub(item.pos);
    if (away.lengthSq() < 1e-9) away.set(0, 0.3, 1);
    away.normalize();
    if (!map && item.radius === 0 && item.pos.lengthSq() > 1e-6) {
      // A craft is looked at from above and to one side (the side the camera is on), so the
      // world it circles and that world's horizon are behind it — never from underneath, with
      // the world behind the camera and only stars in the picture.
      const outward = item.pos.clone().normalize();
      const lean = away.clone().addScaledVector(outward, -away.dot(outward));
      if (lean.lengthSq() < 1e-6) lean.crossVectors(outward, Math.abs(outward.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0));
      // (Something standing on the ground is looked at from higher up, or the view is all horizon.)
      const grounded = item.target.kind === 'craft' && item.target.craft.motion.type === 'surface';
      away.copy(outward).multiplyScalar(grounded ? 0.8 : 0.55).addScaledVector(lean.normalize(), grounded ? 0.6 : 0.84).normalize();
    }
    const toOffset = away.multiplyScalar(distance);
    if (duration <= 0) {
      // Put there outright (the body is about to be one side of a dissolve): at its full size now.
      if (item.mesh) {
        item.scale = 1;
        item.radius = item.base;
        item.mesh.mesh.scale.setScalar(1);
      }
      this.controls.target.copy(item.pos);
      this.camera.position.copy(item.pos).add(toOffset);
      this.flight = null;
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
      if (this.live && this.host.drift() && this.idle > 4) {
        // Close to the ground the same turn would send the surface racing past: slower there.
        const low = anchor === ORIGIN && this.where?.kind === 'place' ? THREE.MathUtils.clamp((offset.length() - R) / (R * 0.5), 0.03, 1) : 1;
        offset.applyAxisAngle(UP, dt * 0.022 * low * Math.min(1, (this.idle - 4) / 4));
      }
      controls.target.copy(anchor);
      camera.position.copy(anchor).add(offset);
    }
    // A view that was entered mid-move starts with the camera tilted the way it was in the
    // scene before (the stars must not jump); it comes upright gently. OrbitControls keeps a
    // rotation derived from camera.up that it only works out once, so that is refreshed too.
    //
    // Something standing on the ground (a lander, a rover, a landing site) is looked at with ITS
    // vertical as "up": turning the view then goes round it like walking round it, with the
    // horizon level, and the camera cannot swing below the ground. Round the body's pole instead
    // (the owner, at Surveyor: "the camera axis is not aligned", the view swung through the Moon).
    const grounded = this.where?.kind === 'place' && focusItem && !focusItem.centre && focusItem.target.kind === 'craft' && focusItem.target.craft.motion.type === 'surface' && focusItem.pos.lengthSq() > 1e-6;
    const wantUp = grounded ? this.localUp.copy(focusItem!.pos).normalize() : UP;
    if (camera.up.distanceToSquared(wantUp) > 1e-8) {
      camera.up.lerp(wantUp, 1 - Math.exp(-dt * (grounded ? 4 : 2.4))).normalize();
      if (camera.up.distanceToSquared(wantUp) < 1e-6) camera.up.copy(wantUp);
    }
    controls.maxPolarAngle = grounded ? Math.PI / 2 - 0.06 : Math.PI;
    controls.minPolarAngle = grounded ? 0.08 : 0; // straight overhead the view has no heading and flips (as it did over the Station)
    const internals = controls as unknown as { _quat: THREE.Quaternion; _quatInverse: THREE.Quaternion };
    internals._quat.setFromUnitVectors(camera.up, UP);
    internals._quatInverse.copy(internals._quat).invert();

    // Close to the ground a zoom step or a drag must cover less, or the surface races past.
    if (this.where?.kind === 'place' && anchor === ORIGIN) {
      const distance = camera.position.length();
      const altitude = Math.max(0, distance - R);
      controls.zoomSpeed = 0.9 * THREE.MathUtils.clamp((altitude / distance) * 1.3, 0.06, 1);
      controls.rotateSpeed = THREE.MathUtils.clamp(altitude * 0.033, 0.004, 0.55); // (the floor is for the lowest the camera goes: see `lowest`)
    } else {
      controls.zoomSpeed = 0.9;
      controls.rotateSpeed = 0.55;
    }
    // A flight may pass beyond the far limit on its way out and inside the near one on its way in.
    const near = controls.minDistance;
    controls.maxDistance = this.flight ? Infinity : this.extent;
    if (this.flight) controls.minDistance = 0;
    controls.update();
    controls.minDistance = near;
    // Never inside a world. Turning the view round something that stands ON the ground (a rover,
    // a landing site) would otherwise swing the camera down through the surface and show the
    // inside of the sphere; here it slides along just above the ground instead.
    if (this.where?.kind === 'place' && !this.flight) {
      const floor = R * 1.004;
      for (const item of this.items) {
        if (!item.mesh || !item.shown) continue;
        const reach = item.centre ? floor : item.radius * 1.004;
        const offset = this.scratch.copy(camera.position).sub(item.pos);
        if (offset.lengthSq() < reach * reach) camera.position.copy(item.pos).add(offset.lengthSq() > 1e-12 ? offset.setLength(reach) : offset.set(0, reach, 0));
      }
      camera.lookAt(controls.target);
    }
  }

  // ---- the selected craft's model ------------------------------------------------------------

  private updateModel(focusItem: Item | null, tMs: number, realSeconds: number): void {
    const craft = focusItem?.target.kind === 'craft' ? focusItem.target.craft : null;
    this.shadow.visible = false;
    if (!craft || !focusItem || !this.options.selModel) {
      this.modelHolder.visible = false;
      return;
    }
    if (this.modelKey !== craft.id) {
      this.modelKey = craft.id;
      this.modelHolder.clear();
      // The data file names its model; an unknown name falls back to the generic probe.
      this.modelKind = isModelKind(craft.model) ? craft.model : 'probe';
      const model = buildModel(this.modelKind);
      this.modelHolder.add(model);
      // Its outline seen from above, for the shadow (the model's own frame: +Y up, one unit across).
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      this.footprint2 = { size: Math.max(box.max.x - box.min.x, box.max.z - box.min.z), x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2, base: modelBase(this.modelKind) };
    }
    const map = this.where?.kind === 'system';
    const position = focusItem.pos;
    const distance = this.camera.position.distanceTo(position);
    // Far too small to see at true size, so it is drawn much larger than life, as in the tracker.
    // (Smaller for something standing on the ground: next to real hills a lander kilometres tall looks absurd.)
    const grounded = craft.motion.type === 'surface';
    const size = map ? THREE.MathUtils.clamp(distance * 0.07, 0.25, 2.5) : THREE.MathUtils.clamp(distance * 0.058, grounded ? 0.006 : 0.024, 0.2);
    this.modelHolder.visible = true;
    this.modelHolder.scale.setScalar(size);

    const surface = grounded;
    const up = position.lengthSq() > 1e-9 && !map ? position.clone().normalize() : UP.clone();
    this.modelHolder.position.copy(position);
    // Standing ON the ground, not half sunk in it and not hovering: its lowest point is put on
    // the ground actually drawn there (the sphere's facets, or a close-up patch lifted above it).
    if (surface) this.modelHolder.position.copy(up).multiplyScalar(this.groundRadius(craft.id, position, realSeconds)).addScaledVector(up, -this.footprint2.base * size);
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
    if (surface && !map) this.groundShadow();

    const sunDir = map ? this.scratch.copy(position).multiplyScalar(-1).normalize() : this.sunDir;
    this.sunLight.position.copy(position).addScaledVector(sunDir, 50);
    this.sunLight.target.position.copy(position);
    this.fillLight.position.copy(this.camera.position);
    this.fillLight.target.position.copy(position);
  }

  /**
   * How far from the centre the ground the visitor SEES is under a point: the body's sphere is
   * drawn with flat facets that lie a little inside the true radius, and close-up patches
   * float up to 0.11 % above it, each level at its own height. Both are more than a lander
   * drawn at its smallest is tall, so it was found hovering. One ray straight down, at most
   * twice a second (the craft is fixed to the ground, and the patches change only as they load).
   */
  private groundRadius(key: string, position: THREE.Vector3, realSeconds: number): number {
    const at = this.groundAt;
    const fresh = at.key !== key;
    if (fresh || realSeconds - at.checked >= 0.25) {
      at.key = key;
      at.checked = realSeconds;
      at.target = this.groundUnder(position, position.length() / 1.0014); // the true surface, if nothing is hit
      if (fresh) at.radius = at.target;
    }
    // Ease to a new height rather than jump: the levels of the close-up ground sit at slightly
    // different heights, and while they stream in the rover hopped between them (the owner saw it stutter).
    const dt = Math.min(0.2, Math.max(0, realSeconds - at.at));
    at.at = realSeconds;
    at.radius += (at.target - at.radius) * Math.min(1, dt * 4);
    return at.radius;
  }

  /** One ray straight down through `position` (world, near the ground): the radius of what is drawn there, or `fallback` if nothing is hit. */
  private groundUnder(position: THREE.Vector3, fallback: number): number {
    const globe = this.items.find((item) => item.centre)?.mesh?.mesh;
    if (!globe) return fallback;
    const down = position.clone().normalize().negate();
    this.ray.set(position.clone().multiplyScalar(1.01), down);
    this.ray.far = R * 0.02;
    globe.updateMatrixWorld(true);
    const hits = this.ray.intersectObjects([globe, ...(this.ground?.enabled ? this.ground.shownPatches(0.6) : [] /* only patches mostly faded in: one still arriving is nearly invisible */)], false);
    return hits.length ? hits[0].point.length() : fallback;
  }

  /** The shadow under a craft standing on the ground: where it touches, and cast away from the Sun. */
  private groundShadow(): void {
    const holder = this.modelHolder;
    const shadow = this.shadow;
    const f = this.footprint2;
    shadow.position.copy(holder.position);
    shadow.quaternion.copy(holder.quaternion);
    shadow.scale.copy(holder.scale);
    shadow.visible = true;
    // The Sun in the craft's own frame (+Y straight up): how high it stands, and which way the shadow falls.
    const sun = this.sunDir.clone().applyQuaternion(holder.quaternion.clone().invert());
    const day = THREE.MathUtils.smoothstep(sun.y, -0.03, 0.12); // no shadow from a Sun below the horizon
    const width = f.size * 1.05;
    this.contact.position.set(f.x, f.base + 0.004, f.z);
    this.contact.scale.set(width * 0.95, 1, width * 0.95);
    (this.contact.material as THREE.MeshBasicMaterial).opacity = 0.8 + 0.17 * day; // blended in linear light: 0.9 reads as about two-thirds dark
    // Long when the Sun is low (1 / tan of its height), capped so it never runs off to the horizon.
    const length = width * Math.min(3.2, 1 + 0.6 / Math.max(0.12, sun.y));
    const away = Math.atan2(sun.z, -sun.x); // turn about +Y that points the quad's +x away from the Sun
    this.cast.visible = day > 0.01;
    this.cast.rotation.set(0, away, 0);
    const reach = (length - width) / 2;
    this.cast.position.set(f.x + Math.cos(away) * reach, f.base + 0.003, f.z - Math.sin(away) * reach); // a turn θ about +Y sends +x to (cos θ, 0, −sin θ)
    this.cast.scale.set(length, 1, width * 0.9);
    (this.cast.material as THREE.MeshBasicMaterial).opacity = 0.94 * day;
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
    const pixelsPerRadian = window.innerHeight / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    // Bodies first, then craft: when two names would overlap, the earlier one keeps its place.
    const order = [...this.items].sort((a, b) => Number(b === focusItem) - Number(a === focusItem) || Number(a.target.kind === 'craft') - Number(b.target.kind === 'craft') || a.beside - b.beside);
    for (const item of order) {
      const tag = item.tag;
      if (!tag) continue;
      let visible = item.shown && this.project(item.pos, screen) && !this.hidden(item.pos, item);
      const x = screen.x, y = screen.y;
      if (visible && (x < -40 || x > window.innerWidth + 40 || y < -20 || y > window.innerHeight + 20)) visible = false;
      // How far below the centre the name goes: under the body's disc, or just under a craft's dot.
      const distance = this.camera.position.distanceTo(item.pos);
      const disc = item.radius > 0 ? (item.radius / Math.max(distance, 1e-6)) * pixelsPerRadian : 0;
      // A body that fills the screen needs no name on it; a moon beside its planet on the map
      // gets one only once the camera has come near enough for it to be more than a speck.
      if (visible && disc > window.innerHeight * 0.3) visible = false;
      if (visible && item.beside > 0 && disc < 5 && item !== focusItem) visible = false;
      if (visible && item.quiet && !this.options.allCraft && item !== focusItem && distance > 60) visible = false;
      if (visible && !this.options.names && item !== focusItem) visible = false;
      // A landing site is a dot on the ground from afar; its name appears as the camera comes down to it.
      if (visible && item.target.kind === 'craft' && item.target.craft.site && item !== focusItem && distance > R * 2.4) visible = false;
      if (item === focusItem && this.modelHolder.visible) visible = false; // its model is on screen and its card names it
      if (item === focusItem && item.mesh && this.where?.kind === 'system') visible = false; // the caption under it names it
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
    let bestDistance = this.host.isPhone() ? 34 : 16; // a fingertip needs more room than a pointer
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
      if (!item.mesh || !item.shown) continue;
      // A small body is hard to hit: give it a few pixels of grace.
      const grace = this.camera.position.distanceTo(item.pos) * (this.host.isPhone() ? 0.05 : 0.014);
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

  /** A second tap on what is already being looked at (or a quick double tap) means "go there". */
  private tap(item: Item | null): void {
    const now = performance.now();
    const key = item?.key ?? '';
    const again = item !== null && ((key === this.lastTap.key && now - this.lastTap.time < 450) || (this.focus !== null && targetKey(this.focus) === key && !this.flight));
    this.lastTap = { key, time: now };
    if (item && again) this.host.onOpen(item.target);
    else this.host.onPick(item ? item.target : null);
  }
}

/** A soft round shadow: dark in the middle, fading to nothing at the edge (shared by both shadow quads). */
function shadowTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d')!;
  const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
