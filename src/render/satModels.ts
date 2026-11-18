/**
 * Procedural 3D spacecraft models, built from three.js primitives and textures painted
 * onto canvases at start-up (no downloads). There is one representative shape per KIND of
 * object — a Starlink flat-panel, a geostationary comsat, the ISS, a rocket stage, a
 * debris fragment … — not an exact replica of each individual spacecraft.
 *
 * Model axes: +X = direction of travel, +Y = away from Earth, −Y = towards Earth (nadir).
 * Solar wings normally run along ±Z.
 *
 * How a model is made:
 *   1. a builder in BUILDERS adds many small parts (boxes, cylinders, dishes, wings) to a group
 *   2. mergeByMaterial() welds all parts that share a material into one mesh, so even the
 *      ISS (several hundred parts) costs about a dozen draw calls
 *   3. buildModel() centres the result and scales its largest dimension to 1 unit
 *
 *   SatelliteModel  the selected object's model, drawn at its position on the globe
 *   ModelPreview    the same model, slowly turning, inside the info card
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ModelKind } from '../data/describe.ts';
import type { SceneKit } from './scene.ts';

type V3 = readonly [number, number, number];
type Axis = 'x' | 'y' | 'z';
const UP = new THREE.Vector3(0, 1, 0);

/** Small repeatable random-number generator, so every model looks the same on every run. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------
// Textures and materials (made once, shared by every model)
// ---------------------------------------------------------------------------------------

function paint(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d')!, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8; // keeps the cell grid crisp when a panel is seen edge-on
  return texture;
}

/** A 4 × 4 block of solar cells: clipped corners, two bus bars each, metallic gaps between. */
function cellTexture(cell: string, shade: string, gap: string, bar: string): THREE.CanvasTexture {
  return paint(256, (ctx, size) => {
    const rand = random(7);
    ctx.fillStyle = gap;
    ctx.fillRect(0, 0, size, size);
    const step = size / 4, w = step - 3, c = 6;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const x = i * step + 1.5, y = j * step + 1.5;
      ctx.fillStyle = rand() < 0.5 ? cell : shade;
      ctx.beginPath();
      ctx.moveTo(x + c, y); ctx.lineTo(x + w - c, y); ctx.lineTo(x + w, y + c); ctx.lineTo(x + w, y + w - c);
      ctx.lineTo(x + w - c, y + w); ctx.lineTo(x + c, y + w); ctx.lineTo(x, y + w - c); ctx.lineTo(x, y + c);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = bar;
      ctx.lineWidth = 1;
      for (const f of [0.33, 0.67]) { ctx.beginPath(); ctx.moveTo(x, y + w * f); ctx.lineTo(x + w, y + w * f); ctx.stroke(); }
    }
  });
}

/** Crinkled insulation foil: overlapping random facets of slightly different brightness. */
function crinkleTexture(): THREE.CanvasTexture {
  return paint(256, (ctx, size) => {
    const rand = random(11);
    ctx.fillStyle = '#c4c4c4';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 700; i++) {
      const x = rand() * size, y = rand() * size, r = 6 + rand() * 22, v = Math.round(150 + rand() * 105);
      ctx.fillStyle = `rgba(${v},${v},${v},0.55)`;
      ctx.beginPath();
      for (let k = 0; k < 3; k++) { const a = rand() * Math.PI * 2; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
      ctx.closePath();
      ctx.fill();
    }
  });
}

/** Painted hull plating: seams every quarter tile, faint patches and access panels. */
function hullTexture(): THREE.CanvasTexture {
  return paint(256, (ctx, size) => {
    const rand = random(23);
    ctx.fillStyle = '#d5d9df';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 60; i++) {
      const v = Math.round(198 + rand() * 40);
      ctx.fillStyle = `rgba(${v},${v},${v + 6},0.35)`;
      ctx.fillRect(rand() * size, rand() * size, 20 + rand() * 60, 10 + rand() * 40);
    }
    ctx.strokeStyle = '#8d949e';
    ctx.lineWidth = 1.5;
    for (let p = 0; p <= size; p += size / 4) {
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
    }
    ctx.strokeStyle = '#a3a9b3';
    ctx.lineWidth = 1;
    for (let i = 0; i < 10; i++) ctx.strokeRect(8 + rand() * 200, 8 + rand() * 200, 12 + rand() * 30, 10 + rand() * 22);
  });
}

/** Radiator: white with fine parallel coolant-tube lines. */
function radiatorTexture(): THREE.CanvasTexture {
  return paint(64, (ctx, size) => {
    ctx.fillStyle = '#e3e7ec';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#b4bbc5';
    ctx.lineWidth = 1;
    for (let y = 4; y < size; y += 8) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke(); }
  });
}

/** Phased-array antenna face: a grid of small gold patch elements on a dark board. */
function arrayTexture(): THREE.CanvasTexture {
  return paint(128, (ctx, size) => {
    ctx.fillStyle = '#262a31';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#8c7b46';
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) ctx.fillRect(i * 16 + 3, j * 16 + 3, 10, 10);
  });
}

function makeMaterials() {
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
  const crinkle = crinkleTexture();
  const foil = (color: number, side: THREE.Side = THREE.FrontSide) =>
    std({ color, map: crinkle, bumpMap: crinkle, bumpScale: 1.5, metalness: 0.35, roughness: 0.45, side });
  // Cell faces sit a hair above their backing panel; the offset stops the two from flickering.
  const cells = (map: THREE.Texture, emissive: number) =>
    std({ map, metalness: 0.25, roughness: 0.38, emissive, emissiveIntensity: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const light = (color: number) => std({ color, emissive: color, emissiveIntensity: 1.1, roughness: 0.6 });
  return {
    foilGold: foil(0xd9a441),
    foilSilver: foil(0xb4bcc6),
    foilBlack: foil(0x3a3d44),
    foilTorn: foil(0xd9a441, THREE.DoubleSide),
    hull: std({ map: hullTexture(), metalness: 0.1, roughness: 0.68 }),
    white: std({ color: 0xcfd5dd, metalness: 0.08, roughness: 0.7 }),
    dish: std({ color: 0xcdd3db, metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide }),
    dark: std({ color: 0x30353f, metalness: 0.45, roughness: 0.5 }),
    metal: std({ color: 0x8b929c, metalness: 0.5, roughness: 0.42 }),
    nozzle: std({ color: 0x3b3a3d, metalness: 0.55, roughness: 0.38, side: THREE.DoubleSide }),
    lens: std({ color: 0x0a1422, metalness: 0.6, roughness: 0.15 }),
    yellow: std({ color: 0xc9a227, metalness: 0.2, roughness: 0.6 }),
    radiator: std({ map: radiatorTexture(), metalness: 0.1, roughness: 0.55 }),
    array: std({ map: arrayTexture(), metalness: 0.3, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    cellsBlue: cells(cellTexture('#14306f', '#183a82', '#9aa6bd', '#5c7cc4'), 0x06122e),
    cellsDark: cells(cellTexture('#0d1226', '#131a36', '#6f7890', '#39456e'), 0x05081a),
    cellsAmber: cells(cellTexture('#1d1a22', '#27212a', '#b98a3c', '#6e5226'), 0x120c05),
    panelBack: std({ color: 0x9aa0a8, metalness: 0.2, roughness: 0.6 }),
    panelBackGold: std({ color: 0xb8863a, metalness: 0.3, roughness: 0.5 }),
    scrap: std({ color: 0x8d939b, metalness: 0.3, roughness: 0.65, flatShading: true, side: THREE.DoubleSide }),
    navRed: light(0xff3b30),
    navGreen: light(0x35e07a),
    navWhite: light(0xdfe8ff),
  };
}
type Materials = ReturnType<typeof makeMaterials>;

let sharedMaterials: Materials | null = null;
function materials(): Materials {
  return (sharedMaterials ??= makeMaterials());
}

// ---------------------------------------------------------------------------------------
// Part helpers
// ---------------------------------------------------------------------------------------

// Docked visiting vehicles are drawn at a fraction of the station's size, so they are built
// with fewer facets: round parts divide their segment counts by this while dock() is running.
let coarse = 1;
const facets = (n: number, min = 6) => Math.max(min, Math.round(n / coarse));

function mesh(g: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const part = new THREE.Mesh(geometry, material);
  part.position.set(x, y, z);
  g.add(part);
  return part;
}

function box(g: THREE.Group, material: THREE.Material, w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.Mesh {
  return mesh(g, new THREE.BoxGeometry(w, h, d), material, x, y, z);
}

/** Turn an object whose length runs along +Y so that it runs along the given axis instead. */
function orient<T extends THREE.Object3D>(object: T, axis: Axis): T {
  if (axis === 'x') object.rotation.z = -Math.PI / 2;
  if (axis === 'z') object.rotation.x = Math.PI / 2;
  return object;
}

/** Cylinder or cone; `rTop` is the radius at the end that points along +axis. */
function cyl(g: THREE.Group, material: THREE.Material, rTop: number, rBottom: number, h: number, x = 0, y = 0, z = 0, axis: Axis = 'y', open = false, segments = 24): THREE.Mesh {
  return orient(mesh(g, new THREE.CylinderGeometry(rTop, rBottom, h, facets(segments), 1, open), material, x, y, z), axis);
}

function ball(g: THREE.Group, material: THREE.Material, r: number, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1): THREE.Mesh {
  const part = mesh(g, new THREE.SphereGeometry(r, facets(20, 8), facets(14, 6)), material, x, y, z);
  part.scale.set(sx, sy, sz);
  return part;
}

/** A thin rod between two points. */
function strut(g: THREE.Group, material: THREE.Material, a: V3, b: V3, radius = 0.012): THREE.Mesh {
  const from = new THREE.Vector3(a[0], a[1], a[2]);
  const along = new THREE.Vector3(b[0], b[1], b[2]).sub(from);
  const length = along.length();
  const part = mesh(g, new THREE.CylinderGeometry(radius, radius, length, facets(6, 4)), material);
  part.position.copy(from).addScaledVector(along, 0.5);
  part.quaternion.setFromUnitVectors(UP, along.normalize());
  return part;
}

/** A sub-group at `at` whose own +Y axis points along `dir` — parts built inside it aim that way. */
function aimed(g: THREE.Group, at: V3, dir: V3): THREE.Group {
  const sub = new THREE.Group();
  sub.position.set(at[0], at[1], at[2]);
  sub.quaternion.setFromUnitVectors(UP, new THREE.Vector3(dir[0], dir[1], dir[2]).normalize());
  g.add(sub);
  return sub;
}

/** Repeat a texture across a part: multiply its texture coordinates. */
function tileUV(geometry: THREE.BufferGeometry, su: number, sv: number): void {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
}

/**
 * A rigid solar panel lying flat: `w` along X, `l` along Z, cells facing +Y, plain backing
 * facing −Y. `tile` is the size (model units) of one 4 × 4 block of cells.
 */
function solarPanel(m: Materials, w: number, l: number, cells: THREE.Material = m.cellsBlue, back: THREE.Material = m.panelBack, tile = 0.35): THREE.Group {
  const panel = new THREE.Group();
  const thickness = Math.min(0.02, w * 0.03);
  box(panel, back, w, thickness, l);
  const face = new THREE.PlaneGeometry(w * 0.97, l * 0.985);
  tileUV(face, w / tile, l / tile);
  mesh(panel, face, cells, 0, thickness / 2 + 0.0008, 0).rotation.x = -Math.PI / 2;
  return panel;
}

interface WingSpec {
  width: number; // across the wing
  length: number; // total length of the panels along the boom
  panels?: number; // number of hinged panels
  yoke?: number; // length of the boom between the body and the first panel
  cells?: THREE.Material;
  back?: THREE.Material;
  tile?: number;
}

/** One fold-out solar wing in its own frame: root at the origin, running along +Z, cells facing +Y. */
function buildWing(m: Materials, s: WingSpec): THREE.Group {
  const wing = new THREE.Group();
  const panels = s.panels ?? 3, yoke = s.yoke ?? s.width * 0.4, hinge = s.width * 0.03;
  const each = (s.length - hinge * (panels - 1)) / panels;
  const rod = Math.max(0.006, s.width * 0.018);
  // Y-shaped yoke: one boom from the drive motor, forking to the first panel's edge
  strut(wing, m.dark, [0, 0, 0], [0, 0, yoke * 0.45], rod * 1.6);
  for (const side of [-1, 1]) strut(wing, m.dark, [0, 0, yoke * 0.45], [side * s.width * 0.32, 0, yoke], rod);
  for (let i = 0; i < panels; i++) {
    const z = yoke + i * (each + hinge) + each / 2;
    const panel = solarPanel(m, s.width, each, s.cells, s.back, s.tile);
    panel.position.z = z;
    wing.add(panel);
    if (i > 0) for (const side of [-1, 1]) cyl(wing, m.metal, rod, rod, s.width * 0.12, side * s.width * 0.3, 0, z - each / 2 - hinge / 2, 'x', false, 8);
  }
  return wing;
}

/** Two wings on opposite sides (±Z), both turned by `tilt` about their shared axis like a real array drive. */
function wingPair(g: THREE.Group, m: Materials, s: WingSpec & { root: number; x?: number; y?: number; tilt?: number }): void {
  for (const side of [-1, 1]) {
    const wing = buildWing(m, s);
    wing.position.set(s.x ?? 0, s.y ?? 0, side * s.root);
    wing.rotation.set(0, side === 1 ? 0 : Math.PI, side * (s.tilt ?? 0));
    g.add(wing);
  }
}

/** A roll-out "blanket" wing as used on space stations: two cell blankets either side of a mast. Runs along +Z. */
function blanketWing(m: Materials, length: number, width: number, tile: number): THREE.Group {
  const wing = new THREE.Group();
  const blanket = width * 0.44;
  strut(wing, m.metal, [0, 0, 0], [0, 0, length], width * 0.022);
  box(wing, m.dark, width, width * 0.05, width * 0.07, 0, 0, width * 0.06); // blanket box at the root
  for (const side of [-1, 1]) {
    const sheet = solarPanel(m, blanket, length * 0.92, m.cellsAmber, m.panelBackGold, tile);
    sheet.position.set((side * (width - blanket)) / 2, 0, length * 0.53);
    wing.add(sheet);
  }
  box(wing, m.dark, width, width * 0.03, width * 0.03, 0, 0, length); // tip bar
  return wing;
}

/** A parabolic dish antenna at `at`, opening towards `dir`, with feed horn, tripod and gimbal hub. */
function dish(g: THREE.Group, m: Materials, radius: number, at: V3, dir: V3): THREE.Group {
  const d = aimed(g, at, dir);
  const depth = radius * 0.3, focus = radius * 0.78;
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= 8; i++) profile.push(new THREE.Vector2((radius * i) / 8, depth * (i / 8) ** 2));
  mesh(d, new THREE.LatheGeometry(profile, facets(28, 10)), m.dish);
  mesh(d, new THREE.TorusGeometry(radius, radius * 0.025, facets(6, 4), facets(28, 10)), m.dark, 0, depth, 0).rotation.x = Math.PI / 2;
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI * 2) / 3;
    strut(d, m.dark, [radius * Math.cos(a), depth, radius * Math.sin(a)], [0, focus, 0], radius * 0.018);
  }
  cyl(d, m.metal, radius * 0.07, radius * 0.1, radius * 0.14, 0, focus, 0, 'y', false, 10); // feed horn
  cyl(d, m.dark, radius * 0.16, radius * 0.22, radius * 0.14, 0, -radius * 0.07, 0, 'y', false, 12); // gimbal hub
  return d;
}

/** A rocket-engine bell at `at`, exhaust pointing along `dir`. */
function nozzle(g: THREE.Group, m: Materials, radius: number, length: number, at: V3, dir: V3): void {
  const n = aimed(g, at, dir);
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= 6; i++) profile.push(new THREE.Vector2(radius * (0.3 + 0.7 * Math.sqrt(i / 6)), (length * i) / 6));
  mesh(n, new THREE.LatheGeometry(profile, facets(20, 8)), m.nozzle);
  cyl(n, m.dark, radius * 0.3, radius * 0.38, length * 0.25, 0, -length * 0.12, 0, 'y', false, 12); // combustion chamber
}

/** Star tracker: a small baffled camera looking along `dir`. */
function tracker(g: THREE.Group, m: Materials, at: V3, dir: V3, size = 1): void {
  const t = aimed(g, at, dir);
  cyl(t, m.nozzle, 0.05 * size, 0.032 * size, 0.12 * size, 0, 0.06 * size, 0, 'y', true, 12);
  cyl(t, m.lens, 0.03 * size, 0.03 * size, 0.01 * size, 0, 0.012 * size, 0, 'y', false, 12);
  box(t, m.dark, 0.08 * size, 0.03 * size, 0.08 * size, 0, -0.01 * size, 0);
}

/** Whip / rod antenna from `at` along `dir`. */
function whip(g: THREE.Group, m: Materials, at: V3, dir: V3, length: number, radius = 0.007): void {
  const d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize().multiplyScalar(length);
  strut(g, m.metal, at, [at[0] + d.x, at[1] + d.y, at[2] + d.z], radius);
}

/** Flat phased-array antenna board in the XY plane, elements facing +Z. */
function arrayPanel(m: Materials, w: number, h: number, elementsPerUnit = 14): THREE.Group {
  const panel = new THREE.Group();
  box(panel, m.dark, w, h, 0.03);
  const face = new THREE.PlaneGeometry(w * 0.97, h * 0.97);
  tileUV(face, (w * elementsPerUnit) / 8, (h * elementsPerUnit) / 8);
  mesh(panel, face, m.array, 0, 0, 0.0158);
  return panel;
}

/** Round patch antenna (a disc of array elements) facing −Y, e.g. on a satellite's Earth-facing deck. */
function arrayDisc(g: THREE.Group, m: Materials, radius: number, x: number, y: number, z: number): void {
  cyl(g, m.dark, radius, radius, 0.02, x, y, z);
  const face = new THREE.CircleGeometry(radius * 0.94, 24);
  tileUV(face, radius * 5, radius * 5);
  mesh(g, face, m.array, x, y - 0.0108, z).rotation.x = Math.PI / 2;
}

/**
 * A pressurised module: barrel with tapered ends, a berthing ring at each end and a
 * trunnion ring round the middle. `axis` is the direction of its length.
 */
function module(g: THREE.Group, m: Materials, r: number, len: number, x: number, y: number, z: number, axis: Axis, skin: THREE.Material = m.hull): THREE.Group {
  const s = new THREE.Group();
  const barrel = len * 0.8, cone = len * 0.1;
  const body = cyl(s, skin, r, r, barrel, 0, 0, 0, 'y', true);
  tileUV(body.geometry, 4, Math.max(1, Math.round(barrel / ((Math.PI * r) / 2))));
  cyl(s, skin, r * 0.6, r, cone, 0, barrel / 2 + cone / 2, 0, 'y', true);
  cyl(s, skin, r, r * 0.6, cone, 0, -barrel / 2 - cone / 2, 0, 'y', true);
  for (const end of [-1, 1]) cyl(s, m.dark, r * 0.62, r * 0.62, len * 0.02, 0, (end * len) / 2, 0, 'y', false, 16);
  for (const end of [-1, 1]) cyl(s, m.metal, r * 1.03, r * 1.03, len * 0.025, 0, end * barrel * 0.28, 0, 'y', true, 20);
  s.position.set(x, y, z);
  g.add(orient(s, axis));
  return s;
}

/** Open lattice truss along Z: four longerons, a square frame at every bay, zig-zag diagonals. */
function truss(g: THREE.Group, m: Materials, length: number, size: number, bays: number, x: number, y: number, z: number): void {
  const h = size / 2, t = size * 0.09, bay = length / bays;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) box(g, m.metal, t, t, length, x + sx * h, y + sy * h, z);
  for (let i = 0; i <= bays; i++) {
    const zf = z - length / 2 + i * bay;
    for (const s of [-1, 1]) {
      box(g, m.metal, size, t, t, x, y + s * h, zf);
      box(g, m.metal, t, size, t, x + s * h, y, zf);
    }
    if (i === bays) break;
    const flip = i % 2 === 0 ? 1 : -1;
    for (const s of [-1, 1]) {
      strut(g, m.metal, [x - flip * h, y + s * h, zf], [x + flip * h, y + s * h, zf + bay], t * 0.4);
      strut(g, m.metal, [x + s * h, y - flip * h, zf], [x + s * h, y + flip * h, zf + bay], t * 0.4);
    }
  }
}

/** Mount a ready-made part group in a parent: uniform scale, position, and facing (its +X turned to `facing`). */
function dock(parent: THREE.Group, build: (g: THREE.Group, m: Materials) => void, m: Materials, scale: number, at: V3, facing: V3): void {
  const sub = new THREE.Group();
  coarse = 2.5;
  build(sub, m);
  coarse = 1;
  sub.scale.setScalar(scale);
  sub.position.set(at[0], at[1], at[2]);
  sub.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(facing[0], facing[1], facing[2]).normalize());
  parent.add(sub);
}

// ---------------------------------------------------------------------------------------
// Crew and cargo vehicles (also reused, scaled down, as the craft docked to the stations).
// All have their docking end at +X.
// ---------------------------------------------------------------------------------------

/** SpaceX Dragon 2: gumdrop capsule, hinged nose cone, trunk half-covered in solar cells, four fins. */
function dragonParts(g: THREE.Group, m: Materials): void {
  cyl(g, m.hull, 0.26, 0.5, 0.75, 0.375, 0, 0, 'x', false, 32); // capsule
  cyl(g, m.dark, 0.5, 0.48, 0.05, -0.02, 0, 0, 'x', false, 32); // heat shield
  cyl(g, m.metal, 0.2, 0.2, 0.07, 0.78, 0, 0, 'x'); // docking ring
  cyl(g, m.dark, 0.14, 0.14, 0.075, 0.782, 0, 0, 'x'); // hatch
  // nose cone, swung open on its hinge
  const nose = mesh(g, new THREE.SphereGeometry(0.26, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), m.white, 0.82, 0.44, 0);
  nose.rotation.z = -1.0;
  nose.scale.set(1, 1.15, 1);
  // windows on the upper flank, laid along the cone's slope
  for (const z of [-0.13, 0.13]) box(g, m.lens, 0.13, 0.012, 0.1, 0.42, 0.362, z).rotation.z = -0.31;
  // launch-escape engine pods, 4 around the base
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    ball(g, m.white, 0.09, 0.14, 0.45 * Math.cos(a), 0.45 * Math.sin(a), 1.9, 1, 1);
    nozzle(g, m, 0.03, 0.04, [0.0, 0.5 * Math.cos(a), 0.5 * Math.sin(a)], [-1, 0.5 * Math.cos(a), 0.5 * Math.sin(a)]);
  }
  // trunk: white radiator half below, solar cells wrapped round the upper half
  cyl(g, m.hull, 0.5, 0.5, 0.75, -0.42, 0, 0, 'x', true, 32);
  const wrap = new THREE.CylinderGeometry(0.506, 0.506, 0.7, 24, 1, true, Math.PI, Math.PI);
  tileUV(wrap, 4, 2);
  orient(mesh(g, wrap, m.cellsDark, -0.42, 0, 0), 'x');
  cyl(g, m.nozzle, 0.47, 0.47, 0.7, -0.44, 0, 0, 'x', true, 24); // inside of the hollow trunk
  cyl(g, m.dark, 0.47, 0.47, 0.02, -0.06, 0, 0, 'x');
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const fin = box(g, m.white, 0.3, 0.14, 0.02, -0.62, 0.56 * Math.cos(a), 0.56 * Math.sin(a));
    fin.rotation.x = a;
  }
}

/** Soyuz / Progress / Shenzhou: round orbital module, bell-shaped descent module, service module with two wings. */
function soyuzParts(g: THREE.Group, m: Materials): void {
  ball(g, m.foilSilver, 0.4, 0.78, 0, 0, 1.1, 1, 1); // orbital module
  cyl(g, m.metal, 0.13, 0.16, 0.14, 1.26, 0, 0, 'x'); // docking collar
  strut(g, m.dark, [1.3, 0, 0], [1.5, 0, 0], 0.025); // docking probe
  cyl(g, m.foilSilver, 0.3, 0.42, 0.55, 0.12, 0, 0, 'x'); // descent module
  cyl(g, m.dark, 0.42, 0.42, 0.04, -0.17, 0, 0, 'x');
  const service = cyl(g, m.hull, 0.4, 0.4, 0.62, -0.5, 0, 0, 'x');
  tileUV(service.geometry, 4, 1);
  cyl(g, m.radiator, 0.405, 0.405, 0.3, -0.5, 0, 0, 'x', true); // radiator band
  cyl(g, m.hull, 0.4, 0.5, 0.2, -0.91, 0, 0, 'x'); // flared skirt
  nozzle(g, m, 0.16, 0.16, [-1.0, 0, 0], [-1, 0, 0]);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    nozzle(g, m, 0.035, 0.05, [-0.96, 0.44 * Math.cos(a), 0.44 * Math.sin(a)], [-0.3, Math.cos(a), Math.sin(a)]);
  }
  wingPair(g, m, { width: 0.42, length: 1.15, panels: 3, root: 0.4, x: -0.5, yoke: 0.12, tile: 0.14 });
  dish(g, m, 0.11, [0.95, 0.42, 0.25], [0.6, 1, 0.3]); // rendezvous radar
  strut(g, m.dark, [0.8, 0.3, 0.2], [0.95, 0.42, 0.25], 0.012);
  whip(g, m, [0.2, 0.38, 0], [0.4, 1, 0], 0.45);
  whip(g, m, [0.2, -0.38, 0], [0.4, -1, 0], 0.45);
  cyl(g, m.lens, 0.05, 0.05, 0.03, 0.15, 0, 0.37, 'z'); // window
}

/** Generic cargo ship (Tianzhou / HTV): big pressurised can, narrower service section, two wings. */
function cargoParts(g: THREE.Group, m: Materials): void {
  module(g, m, 0.45, 1.4, 0.25, 0, 0, 'x');
  cyl(g, m.metal, 0.22, 0.26, 0.1, 1.0, 0, 0, 'x'); // docking collar
  cyl(g, m.foilGold, 0.42, 0.38, 0.62, -0.75, 0, 0, 'x');
  cyl(g, m.dark, 0.38, 0.38, 0.03, -1.07, 0, 0, 'x');
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    nozzle(g, m, 0.07, 0.1, [-1.08, 0.2 * Math.cos(a), 0.2 * Math.sin(a)], [-1, 0, 0]);
  }
  wingPair(g, m, { width: 0.42, length: 1.3, panels: 3, root: 0.4, x: -0.75, yoke: 0.14, tile: 0.14 });
  dish(g, m, 0.1, [-0.6, 0.5, 0], [0, 1, 0.2]);
  whip(g, m, [0.7, 0.44, 0], [0.5, 1, 0], 0.35);
  ball(g, m.navWhite, 0.02, 0.98, 0.3, 0);
}

/** Core module of a modular station (Tianhe): node, small and large work sections, two wings, relay dish. */
function coreModuleParts(g: THREE.Group, m: Materials): void {
  ball(g, m.hull, 0.15, 0.85, 0, 0); // docking node
  for (const [dx, dy, dz] of [[1, 0, 0], [0, 1, 0], [0, -1, 0]] as V3[]) {
    orient(mesh(g, new THREE.CylinderGeometry(0.08, 0.09, 0.05, 20), m.dark, 0.85 + dx * 0.155, dy * 0.155, dz * 0.155), dx ? 'x' : 'y');
  }
  const small = cyl(g, m.hull, 0.14, 0.14, 0.6, 0.4, 0, 0, 'x');
  tileUV(small.geometry, 4, 3);
  cyl(g, m.hull, 0.14, 0.21, 0.1, 0.05, 0, 0, 'x');
  const large = cyl(g, m.hull, 0.21, 0.21, 0.6, -0.3, 0, 0, 'x');
  tileUV(large.geometry, 6, 2);
  cyl(g, m.radiator, 0.213, 0.213, 0.25, -0.3, 0, 0, 'x', true);
  cyl(g, m.metal, 0.12, 0.21, 0.07, -0.635, 0, 0, 'x');
  cyl(g, m.dark, 0.09, 0.09, 0.03, -0.68, 0, 0, 'x'); // aft docking port
  wingPair(g, m, { width: 0.26, length: 1.2, panels: 3, root: 0.14, x: 0.42, yoke: 0.1, tile: 0.1, tilt: 0.3, cells: m.cellsAmber, back: m.panelBackGold });
  dish(g, m, 0.08, [-0.35, 0.36, 0.05], [0.2, 1, 0.3]);
  strut(g, m.dark, [-0.35, 0.2, 0], [-0.35, 0.36, 0.05], 0.008);
  // robotic arm folded along the hull
  strut(g, m.white, [0.6, 0.15, 0.04], [0.25, 0.26, 0.1], 0.014);
  strut(g, m.white, [0.25, 0.26, 0.1], [-0.15, 0.25, 0.06], 0.014);
  ball(g, m.metal, 0.022, 0.25, 0.26, 0.1);
  for (const x of [0.2, 0.55]) mesh(g, new THREE.TorusGeometry(0.146, 0.006, 5, 24), m.yellow, x, 0, 0).rotation.y = Math.PI / 2;
}

// ---------------------------------------------------------------------------------------
// One builder per kind
// ---------------------------------------------------------------------------------------

const BUILDERS: Record<ModelKind, (g: THREE.Group, m: Materials) => void> = {
  /** Starlink: flat "pizza box" bus, four phased arrays facing Earth, one tall solar array. */
  starlink(g, m) {
    box(g, m.hull, 1.5, 0.09, 0.85);
    box(g, m.dark, 1.52, 0.03, 0.87); // edge frame
    for (const [x, z] of [[-0.42, -0.2], [0.05, -0.2], [-0.42, 0.2], [0.05, 0.2]]) arrayDisc(g, m, 0.19, x, -0.055, z);
    for (const z of [-0.26, 0.26]) dish(g, m, 0.1, [0.55, -0.1, z], [0.2, -1, z]); // gateway dishes
    for (const [x, z] of [[0.72, 0.4], [0.72, -0.4], [-0.72, -0.4]]) ball(g, m.lens, 0.035, x, 0.06, z); // laser links
    tracker(g, m, [0.3, 0.05, 0.25], [0.3, 1, 0.5], 0.8);
    tracker(g, m, [0.3, 0.05, -0.25], [0.3, 1, -0.5], 0.8);
    nozzle(g, m, 0.05, 0.07, [-0.76, 0, 0.25], [-1, 0, 0]); // ion thruster
    box(g, m.foilGold, 0.3, 0.06, 0.3, -0.45, 0.07, -0.2); // propellant tank cover
    // the single array stands straight up from the back edge, cells facing forwards
    const wing = buildWing(m, { width: 0.82, length: 2.7, panels: 6, yoke: 0.22, cells: m.cellsDark, tile: 0.27 });
    wing.position.set(-0.6, 0.05, 0);
    wing.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)));
    g.add(wing);
  },

  /** OneWeb: gold-foil box, two wings, two flat user antennas and two gimballed gateway dishes below. */
  oneweb(g, m) {
    box(g, m.foilGold, 0.8, 0.9, 0.7);
    for (const s of [-1, 1]) box(g, m.radiator, 0.02, 0.72, 0.56, s * 0.41, 0, 0);
    wingPair(g, m, { width: 0.7, length: 1.3, panels: 2, root: 0.35, y: 0.15, yoke: 0.22, tilt: 0.5 });
    for (const s of [-1, 1]) {
      const antenna = arrayPanel(m, 0.55, 0.3);
      antenna.position.set(0, -0.5, s * 0.2);
      antenna.rotation.set(Math.PI / 2 - s * 0.35, 0, 0); // facing down and slightly outwards
      g.add(antenna);
      strut(g, m.dark, [s * 0.3, -0.45, 0], [s * 0.42, -0.62, 0], 0.014);
      dish(g, m, 0.14, [s * 0.42, -0.62, 0], [s * 0.3, -1, 0]);
    }
    nozzle(g, m, 0.06, 0.08, [-0.4, 0.2, 0], [-1, 0, 0]);
    tracker(g, m, [0.2, 0.45, 0.2], [0.3, 1, 0.4]);
    whip(g, m, [0.3, 0.45, -0.25], [0, 1, 0], 0.35);
    whip(g, m, [-0.3, -0.45, 0.25], [0, -1, 0], 0.3);
    box(g, m.dark, 0.12, 0.02, 0.12, -0.2, 0.46, -0.1); // GPS antenna
  },

  /** LEO / MEO constellation comsat (Iridium-like): tall bus, two wings, three splayed phased-array panels. */
  comsat(g, m) {
    box(g, m.foilSilver, 0.6, 1.4, 0.6);
    box(g, m.foilBlack, 0.62, 0.3, 0.62, 0, -0.4, 0);
    wingPair(g, m, { width: 0.6, length: 1.5, panels: 3, root: 0.3, y: 0.55, yoke: 0.25, tilt: 0.3 });
    for (let k = 0; k < 3; k++) {
      // main mission antennas: hinged at the Earth-facing end, leaning outwards
      const holder = new THREE.Group();
      holder.rotation.y = Math.PI / 2 + (k * Math.PI * 2) / 3;
      const antenna = arrayPanel(m, 0.55, 0.95);
      antenna.position.set(0, -0.26, 0.52);
      antenna.rotation.x = 0.45;
      holder.add(antenna);
      g.add(holder);
    }
    for (const s of [-1, 1]) dish(g, m, 0.12, [s * 0.18, -0.78, 0.1 * s], [s * 0.25, -1, 0]); // feeder links
    box(g, m.dark, 0.4, 0.06, 0.4, 0, -0.73, 0);
    for (const [x, z] of [[0.31, 0.15], [-0.31, -0.15]]) box(g, m.dark, 0.03, 0.2, 0.14, x, 0.2, z); // crosslink antennas
    nozzle(g, m, 0.08, 0.1, [0, 0.72, 0], [0, 1, 0]);
    tracker(g, m, [0.2, 0.7, 0.2], [0.5, 1, 0.5]);
    whip(g, m, [-0.2, 0.7, -0.2], [-0.2, 1, -0.2], 0.4);
  },

  /** Big geostationary comsat: box bus, very long wings, two side reflectors with feed towers, deck antennas. */
  geocomsat(g, m) {
    box(g, m.foilGold, 1.0, 1.3, 1.0);
    for (const s of [-1, 1]) box(g, m.radiator, 0.9, 1.15, 0.02, 0, 0, s * 0.51); // north / south radiators
    box(g, m.foilBlack, 1.02, 0.04, 1.02, 0, -0.66, 0); // Earth deck
    wingPair(g, m, { width: 0.95, length: 3.4, panels: 4, root: 0.52, yoke: 0.4, tilt: 0.25, cells: m.cellsDark });
    for (const s of [-1, 1]) {
      // deployed east / west reflector, its boom, and the feed-horn tower that lights it
      strut(g, m.dark, [s * 0.5, -0.1, 0], [s * 1.2, -0.72, 0], 0.02);
      dish(g, m, 0.62, [s * 1.2, -0.72, 0], [-s * 0.5, -0.86, 0]);
      box(g, m.foilGold, 0.16, 0.3, 0.3, s * 0.36, -0.82, 0);
      for (const z of [-0.08, 0.08]) cyl(g, m.metal, 0.03, 0.055, 0.1, s * 0.4, -1.0, z, 'y', false, 10).rotation.z = s * 0.5;
    }
    dish(g, m, 0.3, [0, -0.74, 0.22], [0, -1, 0]);
    dish(g, m, 0.14, [0.3, -0.72, -0.3], [0.2, -1, -0.1]);
    strut(g, m.metal, [-0.4, -0.66, -0.4], [-0.4, -1.1, -0.4], 0.012); // omni antenna mast
    cyl(g, m.white, 0.01, 0.04, 0.08, -0.4, -1.13, -0.4, 'y', false, 10);
    nozzle(g, m, 0.16, 0.25, [0, 0.67, 0], [0, 1, 0]); // apogee engine
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) nozzle(g, m, 0.03, 0.05, [sx * 0.46, 0.66, sz * 0.46], [sx, 1, sz]);
    tracker(g, m, [0.3, 0.65, 0.2], [0.6, 1, 0.3]);
    tracker(g, m, [-0.3, 0.65, 0.2], [-0.6, 1, 0.3]);
    cyl(g, m.white, 0.02, 0.05, 0.1, 0.3, 0.7, -0.3, 'y', false, 10); // telemetry horn
  },

  /** Navigation satellite: box bus, two wings, a farm of helix antennas on the Earth deck. */
  gnss(g, m) {
    box(g, m.foilGold, 0.95, 0.95, 0.95);
    box(g, m.foilBlack, 0.97, 0.3, 0.97, 0, 0.2, 0);
    box(g, m.dark, 0.9, 0.04, 0.9, 0, -0.495, 0); // antenna deck
    wingPair(g, m, { width: 0.85, length: 1.9, panels: 2, root: 0.48, yoke: 0.32, tilt: 0.2 });
    const helix = (x: number, z: number, len: number) => {
      cyl(g, m.white, 0.055, 0.035, len, x, -0.52 - len / 2, z, 'y', false, 12);
      cyl(g, m.metal, 0.06, 0.06, 0.02, x, -0.52, z, 'y', false, 12);
    };
    for (let k = 0; k < 8; k++) helix(0.3 * Math.cos((k * Math.PI) / 4), 0.3 * Math.sin((k * Math.PI) / 4), 0.3);
    for (let k = 0; k < 4; k++) helix(0.12 * Math.cos(Math.PI / 4 + (k * Math.PI) / 2), 0.12 * Math.sin(Math.PI / 4 + (k * Math.PI) / 2), 0.36);
    for (const s of [-1, 1]) { // UHF crossed dipoles on the deck corners
      whip(g, m, [s * 0.42, -0.5, s * 0.42], [s * 0.4, -1, s * 0.4], 0.55);
      whip(g, m, [s * 0.42, -0.5, -s * 0.42], [s * 0.4, -1, -s * 0.4], 0.55);
    }
    const reflector = arrayPanel(m, 0.2, 0.2, 40); // laser retro-reflector array
    reflector.position.set(0.33, -0.52, -0.33);
    reflector.rotation.x = Math.PI / 2;
    g.add(reflector);
    nozzle(g, m, 0.11, 0.16, [0, 0.49, 0], [0, 1, 0]);
    dish(g, m, 0.14, [0.3, 0.52, 0.3], [0.3, 1, 0.3]); // crosslink
    for (const sx of [-1, 1]) nozzle(g, m, 0.03, 0.05, [sx * 0.46, 0.47, -0.3], [sx, 0.6, 0]);
    tracker(g, m, [-0.3, 0.48, 0.3], [-0.5, 1, 0.5]);
    cyl(g, m.white, 0.02, 0.05, 0.1, -0.3, 0.52, -0.3, 'y', false, 10);
  },

  /** A ~100 kg small satellite: box bus, two wings, camera and antennas on the Earth side. */
  smallsat(g, m) {
    box(g, m.foilGold, 0.7, 0.6, 0.6);
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) box(g, m.dark, 0.72, 0.03, 0.03, 0, sy * 0.3, sz * 0.3); // frame rails
    box(g, m.radiator, 0.6, 0.02, 0.5, 0, 0.305, 0);
    wingPair(g, m, { width: 0.55, length: 1.1, panels: 2, root: 0.3, yoke: 0.14, tilt: 0.35 });
    cyl(g, m.dark, 0.14, 0.15, 0.26, 0.12, -0.43, 0); // imager
    cyl(g, m.nozzle, 0.15, 0.15, 0.08, 0.12, -0.6, 0, 'y', true);
    cyl(g, m.lens, 0.12, 0.12, 0.01, 0.12, -0.56, 0);
    cyl(g, m.white, 0.05, 0.02, 0.16, -0.22, -0.38, 0.15, 'y', false, 10); // downlink helix
    box(g, m.dark, 0.12, 0.015, 0.12, -0.22, -0.305, -0.15); // S-band patch
    box(g, m.dark, 0.1, 0.02, 0.1, 0.2, 0.32, 0.15); // GPS patch
    tracker(g, m, [-0.2, 0.31, 0.15], [-0.4, 1, 0.5]);
    tracker(g, m, [-0.2, 0.31, -0.15], [-0.4, 1, -0.5]);
    nozzle(g, m, 0.06, 0.09, [-0.36, 0, 0], [-1, 0, 0]);
    whip(g, m, [0.3, 0.3, -0.25], [0.3, 1, -0.2], 0.4);
  },

  /** 3U CubeSat: a 10 × 10 × 30 cm frame clad in cells, two fold-out panels each side, tape antennas. */
  cubesat(g, m) {
    box(g, m.dark, 0.9, 0.29, 0.29);
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) box(g, m.metal, 0.92, 0.035, 0.035, 0, sy * 0.14, sz * 0.14); // launch rails
    for (const s of [-1, 1]) { // body-mounted cells on the two side faces
      const side = solarPanel(m, 0.84, 0.22, m.cellsDark, m.dark, 0.15);
      side.position.set(0, 0, s * 0.147);
      side.rotation.x = (s * Math.PI) / 2;
      g.add(side);
      // deployable panels, hinged along the top edges
      for (const k of [0, 1]) {
        const flap = solarPanel(m, 0.86, 0.29, m.cellsDark, m.panelBack, 0.15);
        flap.position.set(0, 0.15, s * (0.3 + k * 0.3));
        g.add(flap);
        for (const x of [-0.3, 0.3]) cyl(g, m.metal, 0.012, 0.012, 0.06, x, 0.15, s * (0.152 + k * 0.3), 'x', false, 8);
      }
    }
    const top = solarPanel(m, 0.84, 0.22, m.cellsDark, m.dark, 0.15);
    top.position.y = 0.147;
    g.add(top);
    const patch = arrayPanel(m, 0.24, 0.22, 34); // patch antenna on the Earth face
    patch.position.set(-0.2, -0.148, 0);
    patch.rotation.x = Math.PI / 2;
    g.add(patch);
    cyl(g, m.dark, 0.1, 0.1, 0.06, 0.47, 0, 0, 'x'); // camera
    cyl(g, m.lens, 0.08, 0.08, 0.01, 0.502, 0, 0, 'x');
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) whip(g, m, [-0.45, sy * 0.12, sz * 0.12], [-0.5, sy, sz], 0.5, 0.005); // tape antennas
    box(g, m.dark, 0.08, 0.012, 0.08, 0.3, 0.162, 0);
  },

  /** Optical Earth-imaging satellite: telescope barrel looking down, one canted array, gimballed downlink dish. */
  observer(g, m) {
    box(g, m.foilGold, 0.85, 1.0, 0.85);
    box(g, m.foilBlack, 0.87, 0.25, 0.87, 0, 0.3, 0);
    cyl(g, m.foilSilver, 0.38, 0.38, 0.9, 0, -0.95, 0, 'y', true, 28); // telescope barrel
    cyl(g, m.nozzle, 0.36, 0.36, 0.88, 0, -0.95, 0, 'y', true, 28); // its dark inside
    cyl(g, m.lens, 0.36, 0.36, 0.02, 0, -0.75, 0, 'y', false, 28); // primary mirror
    cyl(g, m.dark, 0.39, 0.39, 0.04, 0, -1.4, 0, 'y', true, 28);
    const door = new THREE.Group(); // aperture cover, swung open
    cyl(door, m.foilSilver, 0.38, 0.38, 0.02, -0.38, 0, 0, 'y', false, 28);
    door.position.set(0.38, -1.4, 0);
    door.rotation.z = 1.9;
    g.add(door);
    const wing = buildWing(m, { width: 0.8, length: 2.3, panels: 3, yoke: 0.35 });
    wing.position.set(0, 0.2, 0.43);
    wing.rotation.z = 0.5;
    g.add(wing);
    strut(g, m.dark, [-0.42, -0.3, -0.3], [-0.6, -0.62, -0.42], 0.016);
    dish(g, m, 0.16, [-0.6, -0.62, -0.42], [-0.2, -1, -0.2]); // data downlink
    tracker(g, m, [0.25, 0.5, -0.25], [0.5, 1, -0.6], 1.2);
    tracker(g, m, [-0.25, 0.5, -0.25], [-0.5, 1, -0.6], 1.2);
    box(g, m.dark, 0.14, 0.02, 0.14, 0, 0.51, 0.2);
    for (const sx of [-1, 1]) nozzle(g, m, 0.04, 0.06, [sx * 0.43, 0.4, -0.2], [sx, 0.5, 0]);
    cyl(g, m.white, 0.05, 0.02, 0.14, 0.3, -0.57, 0.3, 'y', false, 10);
    whip(g, m, [0.35, 0.5, 0.35], [0.2, 1, 0.2], 0.4);
  },

  /** Radar-imaging (SAR) satellite: a long flat radar antenna slung beneath the bus, looking sideways. */
  radarsat(g, m) {
    box(g, m.foilGold, 1.3, 0.6, 0.6);
    box(g, m.foilBlack, 0.4, 0.62, 0.62, -0.5, 0, 0);
    const radar = new THREE.Group();
    for (let i = -2; i <= 2; i++) { // five hinged antenna leaves
      const leaf = arrayPanel(m, 0.72, 0.95);
      leaf.position.x = i * 0.745;
      radar.add(leaf);
      if (i < 2) for (const y of [-0.3, 0.3]) cyl(radar, m.metal, 0.015, 0.015, 0.1, i * 0.745 + 0.372, y, -0.02);
    }
    radar.position.set(0, -0.55, 0.1);
    radar.rotation.x = Math.PI / 3; // elements face down and to one side
    g.add(radar);
    for (const x of [-1.3, -0.5, 0.5, 1.3]) strut(g, m.dark, [x * 0.45, -0.3, 0], [x, -0.52, 0.08], 0.014);
    wingPair(g, m, { width: 0.7, length: 1.3, panels: 2, root: 0.3, y: 0.15, yoke: 0.2, tilt: -0.3 });
    strut(g, m.dark, [0.65, -0.1, -0.3], [0.9, -0.3, -0.6], 0.014);
    dish(g, m, 0.13, [0.9, -0.3, -0.6], [0.2, -1, -0.4]); // data downlink
    tracker(g, m, [0.3, 0.3, -0.15], [0.4, 1, -0.5]);
    tracker(g, m, [0.0, 0.3, -0.15], [-0.4, 1, -0.5]);
    box(g, m.dark, 0.12, 0.02, 0.12, 0.45, 0.31, 0.1);
    nozzle(g, m, 0.05, 0.08, [-0.72, 0, 0], [-1, 0, 0]);
    whip(g, m, [0.6, 0.3, 0.2], [0.2, 1, 0.1], 0.4);
  },

  /** Weather satellite: long bus crowded with Earth-facing instruments, one big canted array on a boom. */
  weather(g, m) {
    box(g, m.foilGold, 2.0, 0.7, 0.7);
    box(g, m.foilBlack, 0.5, 0.72, 0.72, -0.6, 0, 0);
    box(g, m.radiator, 0.9, 0.02, 0.6, 0.4, 0.36, 0);
    // imaging radiometer with its scan-mirror drum
    box(g, m.foilSilver, 0.4, 0.3, 0.4, 0.65, -0.5, 0);
    cyl(g, m.dark, 0.12, 0.12, 0.42, 0.65, -0.68, 0, 'z');
    box(g, m.radiator, 0.3, 0.02, 0.3, 0.65, -0.5, 0.36).rotation.x = 0.5; // passive cooler
    // microwave sounder: box with a small spinning reflector
    box(g, m.white, 0.3, 0.22, 0.3, 0.15, -0.46, 0.12);
    dish(g, m, 0.14, [0.15, -0.6, 0.12], [0.3, -1, 0]);
    // infrared sounder
    box(g, m.foilSilver, 0.28, 0.26, 0.26, -0.25, -0.48, -0.1);
    cyl(g, m.nozzle, 0.09, 0.07, 0.12, -0.25, -0.66, -0.1, 'y', true);
    cyl(g, m.white, 0.06, 0.03, 0.6, -0.75, -0.65, 0.2, 'y', false, 12); // search-and-rescue antenna
    cyl(g, m.white, 0.05, 0.02, 0.2, 0.9, -0.45, -0.25, 'y', false, 10);
    whip(g, m, [-0.85, -0.35, -0.25], [-0.3, -1, -0.2], 0.7);
    whip(g, m, [0.9, 0.35, 0.3], [0.5, 1, 0.3], 0.5);
    // the array hangs off the back on a boom, canted towards the Sun
    const wing = buildWing(m, { width: 0.95, length: 2.6, panels: 4, yoke: 0.5 });
    wing.position.set(-1.0, 0.1, 0);
    wing.rotation.set(0, -Math.PI / 2, 0.6);
    g.add(wing);
    strut(g, m.metal, [0.95, 0.3, 0.3], [1.9, 0.75, 0.5], 0.012); // magnetometer boom
    box(g, m.dark, 0.08, 0.06, 0.06, 1.9, 0.75, 0.5);
    tracker(g, m, [0.6, 0.36, -0.2], [0.3, 1, -0.6]);
    for (const sz of [-1, 1]) nozzle(g, m, 0.04, 0.06, [1.0, 0.1, sz * 0.25], [1, 0, sz * 0.4]);
  },

  /** Space telescope (Hubble-like): stepped tube aimed away from Earth, open aperture door, two arrays, two dishes. */
  telescope(g, m) {
    const aft = cyl(g, m.foilSilver, 0.5, 0.5, 1.1, 0, -0.75, 0, 'y', false, 32); // aft shroud
    tileUV(aft.geometry, 3, 1);
    cyl(g, m.dark, 0.52, 0.52, 0.07, 0, -0.2, 0, 'y', false, 32);
    cyl(g, m.hull, 0.46, 0.46, 0.3, 0, -0.03, 0, 'y', false, 32); // equipment ring
    const tube = cyl(g, m.foilSilver, 0.4, 0.4, 1.25, 0, 0.72, 0, 'y', true, 32); // forward light shield
    tileUV(tube.geometry, 3, 1);
    cyl(g, m.nozzle, 0.385, 0.385, 1.25, 0, 0.72, 0, 'y', true, 32); // dark inside of the tube
    cyl(g, m.lens, 0.385, 0.385, 0.02, 0, 0.3, 0, 'y', false, 32); // primary mirror
    cyl(g, m.dark, 0.08, 0.08, 0.05, 0, 1.0, 0); // secondary mirror and its spider
    for (let k = 0; k < 4; k++) strut(g, m.dark, [0, 1.0, 0], [0.385 * Math.cos((k * Math.PI) / 2), 1.0, 0.385 * Math.sin((k * Math.PI) / 2)], 0.008);
    cyl(g, m.dark, 0.41, 0.41, 0.04, 0, 1.345, 0, 'y', true, 32);
    const door = new THREE.Group(); // aperture door, open
    cyl(door, m.foilSilver, 0.4, 0.4, 0.025, -0.4, 0, 0, 'y', false, 32);
    door.position.set(0.4, 1.36, 0);
    door.rotation.z = -1.85;
    g.add(door);
    for (const s of [-1, 1]) {
      // rigid solar array on a mast, cells facing sideways
      strut(g, m.metal, [0, 0.45, s * 0.4], [0, 0.45, s * 0.72], 0.022);
      const array = solarPanel(m, 1.9, 0.72, m.cellsBlue, m.panelBack, 0.24);
      array.position.set(0, 0.45, s * 1.08);
      array.rotation.z = -Math.PI / 2;
      g.add(array);
      // high-gain antenna on its own boom
      strut(g, m.metal, [s * 0.5, -0.35, 0], [s * 1.05, -0.35, 0], 0.014);
      dish(g, m, 0.2, [s * 1.05, -0.35, 0], [s * 0.5, -0.6, 0.6]);
    }
    for (const y of [0.3, 0.9]) mesh(g, new THREE.TorusGeometry(0.412, 0.01, 5, 32), m.yellow, 0, y, 0).rotation.x = Math.PI / 2; // handrails
    for (const y of [-0.5, -1.0]) mesh(g, new THREE.TorusGeometry(0.512, 0.01, 5, 32), m.yellow, 0, y, 0).rotation.x = Math.PI / 2;
    for (let k = 0; k < 3; k++) { // instrument bay doors
      const a = 0.6 + (k * Math.PI * 2) / 3;
      const bay = box(g, m.hull, 0.02, 0.6, 0.36, 0.5 * Math.cos(a), -0.8, 0.5 * Math.sin(a));
      bay.rotation.y = -a;
    }
    cyl(g, m.dark, 0.3, 0.3, 0.03, 0, -1.31, 0);
    cyl(g, m.white, 0.05, 0.02, 0.12, 0, -1.38, 0, 'y', false, 10); // low-gain antenna
  },

  /** International Space Station: 109 m truss with eight solar wings and radiators, and the line of modules below it. */
  iss(g, m) {
    const R = 0.15; // radius of a US-segment module (4.2 m); 1 model unit ≈ 14 m
    // --- US segment, front (+X) to back ---
    module(g, m, R, 0.6, 0, 0, 0, 'x'); // Destiny laboratory
    module(g, m, R, 0.5, 0.57, 0, 0, 'x'); // Harmony node
    module(g, m, R, 0.48, 0.57, 0, 0.39, 'z'); // Columbus
    module(g, m, R * 1.05, 0.78, 0.57, 0, -0.54, 'z'); // Kibo
    module(g, m, R * 0.95, 0.28, 0.57, 0.3, -0.72, 'y'); // Kibo logistics module
    box(g, m.metal, 0.4, 0.04, 0.34, 0.57, -0.02, -1.1); // Kibo's exposed platform and its experiments
    for (const [x, z] of [[0.45, -1.02], [0.7, -1.05], [0.5, -1.2], [0.68, -1.2]]) box(g, m.foilGold, 0.1, 0.1, 0.1, x, 0.05, z);
    cyl(g, m.dark, 0.07, 0.115, 0.16, 0.9, 0, 0, 'x'); // docking adapter
    dock(g, dragonParts, m, 0.28, [1.2, 0, 0], [-1, 0, 0]); // Crew Dragon, nose towards the station
    module(g, m, R, 0.38, -0.5, 0, 0, 'x'); // Unity node
    module(g, m, R * 0.95, 0.24, -0.5, 0, 0.28, 'z'); // Quest airlock (equipment lock)
    cyl(g, m.hull, 0.09, 0.09, 0.18, -0.5, 0, 0.49, 'z'); //   … and its narrower crew lock
    for (const s of [-1, 1]) ball(g, m.white, 0.06, -0.5 + s * 0.13, 0.08, 0.36); // airlock gas tanks
    module(g, m, R, 0.47, -0.5, 0, -0.39, 'z'); // Tranquility node
    cyl(g, m.dark, 0.06, 0.1, 0.08, -0.5, -0.19, -0.5); // Cupola
    cyl(g, m.lens, 0.058, 0.058, 0.01, -0.5, -0.232, -0.5);
    module(g, m, R * 0.75, 0.26, -0.78, 0, -0.5, 'x', m.white); // inflatable module
    module(g, m, R, 0.45, -0.12, 0, -0.5, 'x'); // storage module on Tranquility's forward port
    cyl(g, m.dark, 0.115, 0.07, 0.14, -0.76, 0, 0, 'x');
    // --- Russian segment ---
    module(g, m, 0.14, 0.88, -1.27, 0, 0, 'x', m.foilSilver); // Zarya
    wingPair(g, m, { width: 0.2, length: 0.3, panels: 1, root: 0.14, x: -1.27, yoke: 0.06, tile: 0.1 }); //   its retracted arrays
    ball(g, m.foilSilver, 0.1, -1.76, 0, 0); // Zvezda: node, narrow and wide sections
    cyl(g, m.foilSilver, 0.1, 0.1, 0.3, -1.97, 0, 0, 'x');
    cyl(g, m.foilSilver, 0.1, 0.14, 0.06, -2.15, 0, 0, 'x');
    cyl(g, m.foilSilver, 0.14, 0.14, 0.42, -2.39, 0, 0, 'x');
    cyl(g, m.dark, 0.08, 0.08, 0.1, -2.65, 0, 0, 'x');
    wingPair(g, m, { width: 0.22, length: 0.95, panels: 3, root: 0.14, x: -2.36, yoke: 0.08, tile: 0.1 });
    module(g, m, 0.14, 0.85, -1.76, -0.52, 0, 'y', m.hull); // Nauka laboratory
    wingPair(g, m, { width: 0.2, length: 0.7, panels: 2, root: 0.14, x: -1.76, y: -0.7, yoke: 0.08, tile: 0.1 });
    strut(g, m.white, [-1.62, -0.3, 0.06], [-1.62, -0.85, 0.12], 0.012); // European robotic arm
    ball(g, m.hull, 0.09, -1.76, -1.03, 0); // Prichal node
    dock(g, soyuzParts, m, 0.2, [-1.76, -1.42, 0], [0, 1, 0]); // Soyuz, docked below
    module(g, m, 0.09, 0.28, -1.76, 0.24, 0, 'y', m.foilSilver); // Poisk
    module(g, m, 0.09, 0.4, -1.05, -0.34, 0, 'y', m.foilSilver); // Rassvet
    dock(g, soyuzParts, m, 0.2, [-3.0, 0, 0], [1, 0, 0]); // Progress cargo ship at the aft port
    // --- truss ---
    const TY = 0.33; // truss height above the module centre line
    truss(g, m, 7.4, 0.26, 28, 0, TY, 0);
    box(g, m.foilSilver, 0.36, 0.24, 0.6, 0, TY, 0); // centre segment, bolted to Destiny
    for (const z of [-0.2, 0.2]) strut(g, m.metal, [0.1, 0.14, z], [0.12, TY - 0.1, z * 1.4], 0.012);
    box(g, m.foilGold, 0.2, 0.26, 0.2, -0.5, 0.3, 0); // Z1 segment on top of Unity …
    strut(g, m.metal, [-0.5, 0.43, 0], [-0.5, 0.62, 0.05], 0.01);
    dish(g, m, 0.09, [-0.5, 0.62, 0.05], [0.3, 1, 0.4]); //   … carrying the main relay dish
    for (const side of [-1, 1]) {
      // thermal radiators: three accordion panels pointing aft
      for (let k = -1; k <= 1; k++) {
        const panel = box(g, m.radiator, 1.5, 0.014, 0.26, -0.92, TY, side * (1.25 + k * 0.28));
        tileUV(panel.geometry, 1, 6);
        panel.rotation.x = k * 0.1;
      }
      box(g, m.dark, 0.16, 0.2, 0.9, -0.1, TY, side * 1.25);
      for (const y of [1, -1]) box(g, m.foilGold, 0.3, 0.12, 0.34, 0.02, TY + y * 0.2, side * 1.8); // external stowage platforms
      cyl(g, m.dark, 0.19, 0.19, 0.06, 0, TY, side * 2.15, 'z'); // rotary joint that turns the arrays
      // everything outboard of the rotary joint turns together to follow the Sun
      const outboard = new THREE.Group();
      outboard.position.set(0, TY, 0);
      outboard.rotation.z = 0.5;
      for (const z of [2.55, 3.45]) {
        for (const dir of [-1, 1]) {
          const wing = blanketWing(m, 2.4, 0.82, 0.2);
          wing.position.set(dir * 0.16, 0, side * z);
          wing.rotation.set(0, (dir * Math.PI) / 2, dir * 0.25);
          outboard.add(wing);
        }
        box(outboard, m.dark, 0.34, 0.18, 0.2, 0, 0, side * z); // array gimbal assembly
        const cooler = box(outboard, m.radiator, 0.012, 0.75, 0.26, 0, -0.5, side * (z + 0.3)); // array radiator
        tileUV(cooler.geometry, 4, 1);
      }
      g.add(outboard);
      ball(g, side === 1 ? m.navGreen : m.navRed, 0.03, 0, TY, side * 3.72);
    }
    // robotic arm, standing on the truss
    strut(g, m.white, [0.16, TY + 0.1, 0.35], [0.5, TY + 0.5, 0.55], 0.016);
    strut(g, m.white, [0.5, TY + 0.5, 0.55], [0.95, TY + 0.2, 0.3], 0.016);
    for (const p of [[0.16, TY + 0.1, 0.35], [0.5, TY + 0.5, 0.55], [0.95, TY + 0.2, 0.3]] as V3[]) ball(g, m.metal, 0.028, p[0], p[1], p[2]);
    ball(g, m.navWhite, 0.025, -2.72, 0.05, 0);
  },

  /** Tiangong: T-shaped station — core module, two laboratory modules with huge wings, docked crew and cargo ships. */
  tiangong(g, m) {
    coreModuleParts(g, m); // Tianhe; 1 model unit ≈ 10 m
    for (const side of [-1, 1]) {
      // laboratory module (Wentian / Mengtian): wide work section, then a narrow unpressurised section
      module(g, m, 0.21, 1.0, 0.85, 0, side * 0.64, 'z');
      cyl(g, m.radiator, 0.213, 0.213, 0.4, 0.85, 0, side * 0.64, 'z', true);
      cyl(g, m.foilSilver, 0.12, 0.12, 0.72, 0.85, 0, side * 1.5, 'z');
      box(g, m.foilGold, 0.2, 0.2, 0.25, 0.85, 0.16, side * 1.4);
      cyl(g, m.dark, 0.15, 0.15, 0.06, 0.85, 0, side * 1.86, 'z'); // array drive
      for (const dir of [-1, 1]) {
        const wing = blanketWing(m, 2.6, 0.5, 0.14);
        wing.position.set(0.85 + dir * 0.1, 0, side * 1.86);
        wing.rotation.set(0, (dir * Math.PI) / 2, dir * 0.35);
        g.add(wing);
      }
    }
    dock(g, soyuzParts, m, 0.2, [1.31, 0, 0], [-1, 0, 0]); // Shenzhou at the forward port
    dock(g, soyuzParts, m, 0.2, [0.85, -0.46, 0], [0, 1, 0]); // Shenzhou at the nadir port
    dock(g, cargoParts, m, 0.36, [-1.06, 0, 0], [1, 0, 0]); // Tianzhou cargo ship aft
    ball(g, m.navRed, 0.02, 0.85, 0.05, -1.9);
    ball(g, m.navGreen, 0.02, 0.85, 0.05, 1.9);
  },

  /** A single station core module with a visiting ship (used for station pieces the name table does not know). */
  station(g, m) {
    coreModuleParts(g, m);
    dock(g, soyuzParts, m, 0.2, [1.31, 0, 0], [-1, 0, 0]);
  },

  dragon: dragonParts,
  soyuz: soyuzParts,
  capsule: cargoParts,

  /** Cygnus: aluminium can, small service module, two round fan-fold arrays. */
  cygnus(g, m) {
    module(g, m, 0.5, 1.4, 0.3, 0, 0, 'x', m.foilSilver);
    cyl(g, m.metal, 0.3, 0.33, 0.08, 1.02, 0, 0, 'x'); // berthing ring
    cyl(g, m.foilGold, 0.42, 0.42, 0.4, -0.6, 0, 0, 'x');
    cyl(g, m.dark, 0.42, 0.42, 0.03, -0.81, 0, 0, 'x');
    nozzle(g, m, 0.12, 0.16, [-0.82, 0, 0], [-1, 0, 0]);
    for (const s of [-1, 1]) {
      const z = s * 1.2;
      strut(g, m.dark, [-0.6, 0, s * 0.42], [-0.6, 0, z], 0.02);
      const fan = new THREE.CircleGeometry(0.6, 10, Math.PI / 2); // ten flat gores, like the real fan
      tileUV(fan, 4.5, 4.5);
      mesh(g, fan, m.cellsBlue, -0.6, 0.012, z).rotation.x = -Math.PI / 2;
      cyl(g, m.panelBack, 0.6, 0.6, 0.016, -0.6, 0, z, 'y', false, 10);
      for (let k = 0; k < 10; k++) {
        const a = (k * Math.PI) / 5;
        strut(g, m.metal, [-0.6, -0.012, z], [-0.6 + 0.6 * Math.sin(a), -0.012, z + 0.6 * Math.cos(a)], 0.007);
      }
    }
    dish(g, m, 0.09, [-0.6, 0.48, 0.1], [0.2, 1, 0.1]);
    whip(g, m, [0.6, 0.5, 0], [0.3, 1, 0], 0.3);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      nozzle(g, m, 0.03, 0.05, [-0.75, 0.43 * Math.cos(a), 0.43 * Math.sin(a)], [-0.4, Math.cos(a), Math.sin(a)]);
    }
  },

  /** Spent rocket upper stage: tank, payload adapter, one large engine with pressure bottles round it. */
  rocketbody(g, m) {
    const tank = cyl(g, m.hull, 0.5, 0.5, 2.6, 0.2, 0, 0, 'x', false, 32);
    tileUV(tank.geometry, 6, 3);
    for (const x of [1.3, -0.6]) cyl(g, m.dark, 0.504, 0.504, 0.07, x, 0, 0, 'x', true, 32); // paint bands
    cyl(g, m.metal, 0.3, 0.5, 0.36, 1.68, 0, 0, 'x', true, 32); // payload adapter cone
    cyl(g, m.nozzle, 0.29, 0.49, 0.36, 1.68, 0, 0, 'x', true, 32);
    cyl(g, m.dark, 0.31, 0.31, 0.03, 1.86, 0, 0, 'x', true, 32); // separation ring
    ball(g, m.foilGold, 0.5, -1.1, 0, 0, 0.5, 1, 1); // insulated aft dome
    box(g, m.dark, 2.5, 0.035, 0.07, 0.2, 0.51, 0); // cable raceway
    box(g, m.dark, 1.2, 0.03, 0.05, -0.3, -0.36, 0.36);
    // engine: thrust frame, turbopumps, bell
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      strut(g, m.metal, [-1.25, 0.3 * Math.cos(a), 0.3 * Math.sin(a)], [-1.52, 0.06 * Math.cos(a), 0.06 * Math.sin(a)], 0.018);
      ball(g, m.foilBlack, 0.11, -1.36, 0.36 * Math.cos(a + 0.78), 0.36 * Math.sin(a + 0.78)); // helium bottles
    }
    cyl(g, m.metal, 0.07, 0.07, 0.2, -1.45, 0.14, 0.05, 'x');
    cyl(g, m.metal, 0.06, 0.06, 0.16, -1.45, -0.12, -0.1, 'x');
    strut(g, m.metal, [-1.4, 0.14, 0.05], [-1.62, 0.0, 0.1], 0.02);
    nozzle(g, m, 0.36, 0.8, [-1.5, 0, 0], [-1, 0, 0]);
    for (const s of [-1, 1]) { // attitude-thruster pods near the front
      box(g, m.dark, 0.14, 0.08, 0.1, 1.2, 0, s * 0.53);
      nozzle(g, m, 0.025, 0.04, [1.2, 0.04, s * 0.56], [0, 1, s * 0.3]);
      nozzle(g, m, 0.025, 0.04, [1.2, -0.04, s * 0.56], [0, -1, s * 0.3]);
      nozzle(g, m, 0.025, 0.04, [1.2, 0, s * 0.58], [0, 0, s]);
    }
  },

  /** Debris: a bent, torn piece of structural panel with a strip of foil, a broken cell shard and a snapped rod. */
  debris(g, m) {
    const rand = random(5);
    const sheet = new THREE.PlaneGeometry(1.3, 0.9, 10, 7);
    const p = sheet.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      const onEdge = Math.max(Math.abs(x) / 0.65, Math.abs(y) / 0.45) > 0.95;
      const tear = onEdge ? 1 - rand() * 0.38 : 1; // ragged outline
      p.setXYZ(i, x * tear, y * tear, 0.16 * Math.sin(x * 2.6) + 0.1 * Math.sin(y * 4 + x) + (rand() - 0.5) * 0.05);
    }
    sheet.computeVertexNormals();
    mesh(g, sheet, m.scrap).rotation.set(0.5, 0.2, 0.3);

    const lump = new THREE.IcosahedronGeometry(0.26, 1); // a chunk of honeycomb still attached
    const q = lump.attributes.position;
    for (let i = 0; i < q.count; i++) {
      const n = 0.72 + 0.5 * Math.abs(Math.sin(q.getX(i) * 42.9 + q.getY(i) * 78.2 + q.getZ(i) * 37.7));
      q.setXYZ(i, q.getX(i) * n, q.getY(i) * n * 0.6, q.getZ(i) * n * 0.85);
    }
    lump.computeVertexNormals();
    mesh(g, lump, m.scrap, -0.3, 0.05, 0.1);

    const strip = new THREE.PlaneGeometry(0.9, 0.24, 14, 2); // curled insulation foil
    const s = strip.attributes.position;
    for (let i = 0; i < s.count; i++) {
      const a = (s.getX(i) + 0.45) * 3.4;
      s.setXYZ(i, Math.sin(a) * 0.26, s.getY(i) * (1 - 0.3 * Math.sin(a * 1.7) ** 2), (1 - Math.cos(a)) * 0.26);
    }
    strip.computeVertexNormals();
    mesh(g, strip, m.foilTorn, 0.25, 0.1, 0.05).rotation.set(1.1, 0.4, -0.3);

    const shard = solarPanel(m, 0.42, 0.3, m.cellsBlue, m.panelBack, 0.2);
    shard.position.set(0.4, -0.12, -0.2);
    shard.rotation.set(0.6, 0.3, 0.9);
    g.add(shard);
    strut(g, m.metal, [-0.5, -0.1, -0.2], [0.1, 0.3, -0.35], 0.018);
    strut(g, m.dark, [0.1, 0.3, -0.35], [0.3, 0.45, -0.2], 0.006); // dangling cable
  },
};

/** Weld every part that shares a material into a single mesh (far fewer draw calls). */
function mergeByMaterial(root: THREE.Group): THREE.Group {
  root.updateMatrixWorld(true);
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const source = object.geometry as THREE.BufferGeometry;
    const geometry = source.index ? source.toNonIndexed() : source.clone();
    geometry.applyMatrix4(object.matrixWorld);
    const material = object.material as THREE.Material;
    const list = groups.get(material);
    if (list) list.push(geometry); else groups.set(material, [geometry]);
    source.dispose();
  });
  const merged = new THREE.Group();
  for (const [material, list] of groups) {
    const geometry = mergeGeometries(list);
    for (const part of list) part.dispose();
    if (geometry) merged.add(new THREE.Mesh(geometry, material));
  }
  return merged;
}

/** Build a model, centred and scaled so its largest dimension is 1 unit. */
export function buildModel(kind: ModelKind): THREE.Group {
  const parts = new THREE.Group();
  BUILDERS[kind](parts, materials());
  const inner = mergeByMaterial(parts);
  const bounds = new THREE.Box3().setFromObject(inner);
  const size = bounds.getSize(new THREE.Vector3());
  inner.position.copy(bounds.getCenter(new THREE.Vector3())).multiplyScalar(-1);
  const outer = new THREE.Group();
  outer.add(inner);
  outer.scale.setScalar(1 / Math.max(size.x, size.y, size.z));
  return outer;
}

/** Free a model's geometry (materials and textures are shared, so they stay). */
function disposeModel(holder: THREE.Group): void {
  holder.traverse((object) => {
    if (object instanceof THREE.Mesh) (object.geometry as THREE.BufferGeometry).dispose();
  });
  holder.clear();
}

// Dead objects are not attitude-controlled: they tumble. Value = tumble speed (1 = debris).
const TUMBLE: Partial<Record<ModelKind, number>> = { debris: 1, rocketbody: 0.22 };

function addLights(scene: THREE.Scene): THREE.DirectionalLight {
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
  scene.add(sun, sun.target, new THREE.AmbientLight(0x8fb0e0, 0.45));
  return sun;
}

/** The selected object's model on the globe: follows it, points along its orbit, stays a readable size. */
export class SatelliteModel {
  /** Size of the model (scene units, 1 = 1,000 km) when the camera is close to it. */
  static readonly FOCUS_SIZE = 0.024;
  enabled = true;
  private readonly holder = new THREE.Group();
  private readonly kit: SceneKit;
  private readonly sunLight: THREE.DirectionalLight | null = null;
  private readonly fillLight: THREE.DirectionalLight | null = null;
  private kind: ModelKind | null = null;

  /**
   * @param withLights  the first instance owns the scene's lights; extra instances (the two
   *                    models of a close approach) pass false and are lit by the same ones.
   */
  constructor(kit: SceneKit, withLights = true) {
    this.kit = kit;
    this.holder.visible = false;
    kit.scene.add(this.holder);
    if (withLights) {
      this.sunLight = addLights(kit.scene); // only these models use lit materials
      // A soft "headlight" from the camera so the model stays readable on the night side.
      this.fillLight = new THREE.DirectionalLight(0xbcd6ff, 0.9);
      kit.scene.add(this.fillLight, this.fillLight.target);
    }
  }

  /** Point the sun light and the camera fill light at `position` (scene units). */
  aimLights(position: THREE.Vector3, sunDirection: THREE.Vector3): void {
    if (!this.sunLight || !this.fillLight) return;
    this.sunLight.position.copy(position).addScaledVector(sunDirection, 50);
    this.sunLight.target.position.copy(position);
    this.fillLight.position.copy(this.kit.camera.position);
    this.fillLight.target.position.copy(position);
  }

  setKind(kind: ModelKind | null): void {
    this.kind = kind;
    disposeModel(this.holder);
    if (kind) this.holder.add(buildModel(kind));
    this.holder.visible = false;
  }

  /**
   * @param position  where the object is (scene units), or null if unknown
   * @param velocity  direction of travel (scene axes, any length)
   * @param maxSize   optional cap on the model's size (scene units) — used in a close approach
   *                  so two models a few kilometres apart do not swallow each other
   */
  update(position: THREE.Vector3 | null, velocity: THREE.Vector3, sunDirection: THREE.Vector3, realSeconds: number, maxSize?: number): void {
    this.holder.visible = this.enabled && !!position && this.kind !== null;
    if (!position || !this.holder.visible) return;
    this.aimLights(position, sunDirection);
    this.holder.position.copy(position);

    // Real satellites are metres across — far too small to see — so the model is drawn much
    // larger than life. Far away it shrinks into the dot; at middle distances it keeps a
    // constant on-screen size (~65 px); and once the camera is close (the focus view) it has
    // a fixed size in space, so zooming in really does bring it closer.
    const distance = this.kit.camera.position.distanceTo(position);
    this.holder.scale.setScalar(maxSize !== undefined
      ? Math.min(maxSize, distance * 0.2)
      : THREE.MathUtils.clamp(distance * 0.058, SatelliteModel.FOCUS_SIZE, 0.2));

    const tumble = this.kind ? TUMBLE[this.kind] : undefined;
    if (tumble) {
      this.holder.rotation.set(realSeconds * 0.5 * tumble, realSeconds * 0.8 * tumble, 0);
      return;
    }
    const up = position.clone().normalize(); // away from Earth
    const forward = velocity.clone().addScaledVector(up, -velocity.dot(up)); // travel direction, level with the horizon
    if (forward.lengthSq() < 1e-12) forward.set(1, 0, 0).addScaledVector(up, -up.x);
    forward.normalize();
    const side = new THREE.Vector3().crossVectors(forward, up);
    this.holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(forward, up, side));
  }
}

// ---- still thumbnails (search suggestions) ---------------------------------------------------

const thumbnails = new Map<ModelKind, string>(); // kind → PNG data URL, rendered once each
let thumbRenderer: THREE.WebGLRenderer | null = null;

/** A small picture of a model kind, for lists. Rendered on first use with a shared off-screen renderer, then cached. */
export function modelThumbnail(kind: ModelKind): string {
  const cached = thumbnails.get(kind);
  if (cached) return cached;
  try {
    thumbRenderer ??= new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    thumbRenderer.setSize(96, 96, false);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    camera.position.set(1.5, 1.0, 1.9);
    camera.lookAt(0, 0, 0);
    addLights(scene).position.set(2.5, 3, 1.5);
    const rim = new THREE.DirectionalLight(0x5ad1ff, 1.4);
    rim.position.set(-3, -1, -2);
    scene.add(rim);
    const holder = new THREE.Group();
    holder.add(buildModel(kind));
    holder.rotation.y = 0.6;
    scene.add(holder);
    thumbRenderer.render(scene, camera);
    const url = thumbRenderer.domElement.toDataURL('image/png');
    disposeModel(holder);
    thumbnails.set(kind, url);
    return url;
  } catch {
    return ''; // no WebGL context to spare: the caller falls back to a plain dot
  }
}

/** A small, slowly turning view of a model for the info card (its own tiny renderer). */
export class ModelPreview {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 2, 0.1, 20);
  private readonly holder = new THREE.Group();
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera.position.set(1.5, 0.95, 1.9);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(this.holder);
    const sun = addLights(this.scene);
    sun.position.set(2.5, 3, 1.5);
    const rim = new THREE.DirectionalLight(0x5ad1ff, 1.4);
    rim.position.set(-3, -1, -2);
    this.scene.add(rim);
  }

  show(kind: ModelKind): void {
    disposeModel(this.holder);
    this.holder.add(buildModel(kind));
  }

  render(realSeconds: number): void {
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    if (width === 0 || height === 0) return; // card hidden
    if (this.canvas.width !== Math.round(width * this.renderer.getPixelRatio())) {
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
    this.holder.rotation.y = realSeconds * 0.45;
    this.renderer.render(this.scene, this.camera);
  }
}
