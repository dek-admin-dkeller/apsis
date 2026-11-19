/**
 * 3D models of crew and cargo vehicles that look nothing like the generic shapes in
 * satModels.ts — Shenzhou, Starliner, Orion, Dream Chaser — and of one payload that is not a
 * spacecraft at all: the Tesla Roadster sent round the Sun on the first Falcon Heavy. One
 * builder per kind, made from the kit in modelParts.ts and handed to satModels.ts, which
 * merges, centres, scales and caches every model the same way.
 *
 * Axes as for every craft: +X = direction of travel. Crew vehicles have their docking end at
 * +X (like dragon and soyuz) and their solar wings along ±Z. The Roadster is drawn as it was
 * mounted on the rocket: nose at +X, wheels down (−Y), on its small adapter.
 */

import * as THREE from 'three';
import type { ModelKind } from '../data/describe.ts';
import {
  TAU, ball, box, buildWing, cyl, dish, hoop, lathe, mesh, nozzle, slab, strut, thrusters, tileUV, whip, wingPair,
  type Builder, type Materials,
} from './modelParts.ts';

/** A docking port at +X: a ring with three guide petals round a hatch (the international standard's androgynous kind). */
function dockingPort(g: THREE.Group, m: Materials, x: number, r: number): void {
  cyl(g, m.metal, r, r * 1.1, r * 0.4, x, 0, 0, 'x', false, 20);
  cyl(g, m.dark, r * 0.7, r * 0.7, r * 0.42, x + 0.005, 0, 0, 'x', false, 16);
  for (let k = 0; k < 3; k++) {
    const a = (k * TAU) / 3;
    box(g, m.metal, r * 0.45, r * 0.12, r * 0.4, x + r * 0.35, r * 0.85 * Math.cos(a), r * 0.85 * Math.sin(a)).rotation.x = a;
  }
}

// Two paints no other model uses (the Roadster's red, Starliner's blue band): made the first
// time one is needed rather than at start-up with the shared kit.
const paints = new Map<number, THREE.MeshStandardMaterial>();
function gloss(m: Materials, color: number): THREE.MeshStandardMaterial {
  let paint = paints.get(color);
  if (!paint) paints.set(color, (paint = new THREE.MeshStandardMaterial({ color, metalness: 0.45, roughness: 0.38, envMap: m.metal.envMap, envMapIntensity: 1.2 })));
  return paint;
}

/** slab() with an outline anywhere: faceted() needs the solid round its own origin, so it is centred and moved back. */
function panel(g: THREE.Group, material: THREE.Material, outline: [number, number][], thick: number): void {
  const cx = outline.reduce((a, p) => a + p[0], 0) / outline.length, cz = outline.reduce((a, p) => a + p[1], 0) / outline.length;
  slab(g, material, outline.map(([x, z]) => [x - cx, z - cz] as const), thick, cx, 0, cz, 0.5);
}

// ---------------------------------------------------------------------------------------
// The Roadster
// ---------------------------------------------------------------------------------------

const FRONT_AXLE = 1.19, REAR_AXLE = -1.16; // 2.35 m apart, 0.79 m and 0.82 m of overhang

/** A bump of height 1 at 0, falling off over about `w` either side. */
const bump = (d: number, w: number) => Math.exp(-((d / w) ** 2));
/** 0 below a, 1 above b, smooth in between. */
const ramp = (v: number, a: number, b: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * The body as one smooth skin, lofted through cross-sections from tail to nose. Each section
 * is a rounded rectangle (a superellipse) whose width, floor and top change along the car:
 * swelling over the wheels and pinched between them, the short nose sloping down, the open
 * cockpit sunk into the top, the long flat deck behind it ending in a small ducktail lip. The
 * wheel openings are pushed in to make wheel wells. Paint and black (cockpit tub, wells,
 * side intakes, grille) are colours per corner, so the whole skin is one mesh.
 */
function roadsterBody(): THREE.BufferGeometry {
  const SECTIONS = 96, AROUND = 56, L = 3.95;
  const red = new THREE.Color('#8e1322'), black = new THREE.Color('#17181b');
  const position: number[] = [], color: number[] = [], index: number[] = [];
  for (let i = 0; i <= SECTIONS; i++) {
    const u = i / SECTIONS, x = (u - 0.5) * L; // tail (−X) to nose (+X)
    // rounded ends: the nose more rounded than the chopped tail
    const end = u > 0.5 ? Math.pow(Math.max(0, 1 - ((u - 0.5) * 2) ** 3.2), 0.42) : Math.pow(Math.max(0, 1 - ((0.5 - u) * 2) ** 9), 0.3);
    // half-width: wide over the wheels, pinched between them and at the ends
    const half = (0.8 + 0.125 * bump(x - FRONT_AXLE, 0.62) + 0.13 * bump(x - REAR_AXLE, 0.66) - 0.04 * bump(x + 0.05, 0.5)) * Math.min(1, 0.55 + 0.45 * end) * (u > 0.97 ? end : 1) * (1 - 0.2 * ramp(x, 1.25, 1.98) ** 1.5); // the nose narrows in plan
    const floor = 0.15 + 0.13 * ramp(x, 1.45, 1.98) + 0.12 * ramp(-x, 1.6, 1.98);
    // the top line along the middle: low sloping nose, the scuttle at the windscreen, the deck
    let top = x > 0.62 ? 0.82 - 0.36 * ramp(x, 0.62, 1.98) ** 1.4 : x > -0.75 ? 0.84 : 0.92 + 0.025 * bump(x + 1.86, 0.06) - 0.03 * ramp(-x, 1.88, 1.98);
    top = floor + (top - floor) * Math.min(1, 0.4 + 0.6 * end);
    const cockpit = ramp(x, -0.82, -0.68) * (1 - ramp(x, 0.5, 0.64)); // 1 where the seats are
    for (let j = 0; j < AROUND; j++) {
      const t = (j / AROUND) * TAU, c = Math.cos(t), sn = Math.sin(t);
      const n = 5; // squareness of the section
      const zN = Math.sign(c) * Math.abs(c) ** (2 / n), yN = Math.sign(sn) * Math.abs(sn) ** (2 / n);
      let z = half * zN;
      let y = (floor + top) / 2 + ((top - floor) / 2) * yN;
      let dark = false;
      const side = Math.abs(zN); // 1 on the flanks, 0 along the middle of top and floor
      if (yN > 0) {
        // humps over the front wheels and the haunches over the rear ones
        y += side ** 3 * (0.07 * bump(x - FRONT_AXLE, 0.45) + 0.04 * bump(x - REAR_AXLE, 0.5)) * Math.min(1, end * 2);
        // the open cockpit: the middle of the top sinks into a tub
        const tub = cockpit * Math.max(0, 1 - (side / 0.86) ** 6);
        if (tub > 0.02) { y -= tub * 0.42; dark = tub > 0.35; }
      }
      // wheel wells: everything on the flank inside a wheel's circle is pushed in and blackened
      for (const [ax, r] of [[FRONT_AXLE, 0.29], [REAR_AXLE, 0.315]] as const) {
        const d = Math.hypot(x - ax, y - r);
        if (d < r + 0.07 && side > 0.55 && y < 0.72) { z = Math.sign(z) * Math.min(Math.abs(z), 0.62); dark = true; }
      }
      // the air intakes in the flanks just behind the doors
      if (side > 0.8 && x < -0.66 && x > -0.98 && y > 0.4 && y < 0.66) { z *= 0.955; dark = true; }
      // the grille: a shallow slot low in the nose
      if (u > 0.965 && y > 0.25 && y < 0.36 && side < 0.75) dark = true;
      position.push(x, y, z);
      const col = dark ? black : red;
      color.push(col.r, col.g, col.b);
    }
  }
  for (let i = 0; i < SECTIONS; i++) for (let j = 0; j < AROUND; j++) {
    const a = i * AROUND + j, b = i * AROUND + ((j + 1) % AROUND), c = a + AROUND, d = b + AROUND;
    index.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

let carPaint: THREE.MeshStandardMaterial | null = null;
/** Glossy paint whose colour comes from the body's corners (red, or black where it is trim). */
function roadsterPaint(m: Materials): THREE.MeshStandardMaterial {
  return (carPaint ??= new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.4, roughness: 0.34, envMap: m.metal.envMap, envMapIntensity: 1.3 }));
}

/** Starman in the driver's seat at z0: white suit, dark visor, right hand on the wheel, left elbow on the door. */
function starman(g: THREE.Group, m: Materials, z0: number): void {
  const suit = m.white;
  const torso = lathe(g, suit, [[0.13, 0], [0.17, 0.1], [0.18, 0.3], [0.16, 0.42], [0.08, 0.48]], -0.42, 0.5, z0, 'y', 16);
  torso.rotation.z = 0.25; // leaning back into the seat
  torso.scale.set(0.85, 1, 1);
  cyl(g, m.dark, 0.06, 0.07, 0.06, -0.47, 0.98, z0, 'y', false, 12); // neck ring
  ball(g, suit, 0.15, -0.48, 1.12, z0); // helmet
  const visor = mesh(g, new THREE.SphereGeometry(0.152, 16, 10, -Math.PI / 2.4, Math.PI / 1.2, Math.PI * 0.28, Math.PI * 0.36), m.lens, -0.48, 1.12, z0);
  visor.rotation.y = Math.PI / 2; // facing forwards (+X)
  for (const s of [-1, 1]) ball(g, suit, 0.075, -0.47, 0.88, z0 + s * 0.19); // shoulders
  // right arm (inboard, +Z side) reaching to the wheel
  strut(g, suit, [-0.46, 0.86, z0 + 0.2], [-0.2, 0.74, z0 + 0.2], 0.055);
  strut(g, suit, [-0.2, 0.74, z0 + 0.2], [0.14, 0.86, z0 + 0.1], 0.048);
  ball(g, m.dark, 0.045, 0.15, 0.87, z0 + 0.09);
  // left arm out over the door: elbow on the sill
  strut(g, suit, [-0.46, 0.86, z0 - 0.2], [-0.25, 0.86, -0.82], 0.055);
  strut(g, suit, [-0.25, 0.86, -0.82], [0.05, 0.88, -0.8], 0.048);
  ball(g, m.dark, 0.045, 0.07, 0.88, -0.8);
  // legs, running forwards under the dashboard
  for (const s of [-1, 1]) {
    strut(g, suit, [-0.3, 0.5, z0 + s * 0.09], [0.12, 0.58, z0 + s * 0.1], 0.07);
    strut(g, suit, [0.12, 0.58, z0 + s * 0.1], [0.45, 0.36, z0 + s * 0.1], 0.06);
  }
}

export const VEHICLE_BUILDERS = {
  /**
   * Shenzhou: three modules like a Soyuz, but larger, and its orbital module (front) is a
   * cylinder with solar wings of its own, so it can fly on alone after the crew have gone home.
   */
  shenzhou(g, m) {
    // orbital module
    const om = cyl(g, m.blanket, 0.45, 0.45, 0.9, 0.95, 0, 0, 'x', false, 28);
    tileUV(om.geometry, 5, 2);
    lathe(g, m.blanket, [[0.45, 0], [0.42, 0.1], [0.32, 0.2], [0.2, 0.25]], 1.4, 0, 0, 'x', 28);
    dockingPort(g, m, 1.7, 0.18);
    cyl(g, m.blanket, 0.3, 0.45, 0.12, 0.44, 0, 0, 'x', false, 28);
    wingPair(g, m, { width: 0.32, length: 0.85, panels: 2, root: 0.45, x: 0.95, yoke: 0.08, tile: 0.12 });
    // descent module: the bell
    lathe(g, m.foilSilver, [[0.52, 0], [0.51, 0.1], [0.42, 0.42], [0.32, 0.56], [0.24, 0.6]], -0.22, 0, 0, 'x', 28);
    cyl(g, m.dark, 0.52, 0.52, 0.05, -0.22, 0, 0, 'x', false, 28); // heat shield
    cyl(g, m.lens, 0.055, 0.055, 0.03, 0.08, 0.38, 0.12, 'y', false, 12); // window
    // service module: radiator band, flared skirt, four main engines, the big wings
    const sm = cyl(g, m.hull, 0.56, 0.56, 1.0, -0.78, 0, 0, 'x', false, 28);
    tileUV(sm.geometry, 5, 1);
    tileUV(cyl(g, m.radiator, 0.565, 0.565, 0.5, -0.72, 0, 0, 'x', true, 28).geometry, 1, 4);
    cyl(g, m.foilGold, 0.56, 0.6, 0.18, -1.37, 0, 0, 'x', false, 28);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      nozzle(g, m, 0.08, 0.13, [-1.46, 0.24 * Math.cos(a), 0.24 * Math.sin(a)], [-1, 0, 0]);
      thrusters(g, m, [-1.2, 0.58 * Math.cos(a), 0.58 * Math.sin(a)], [-0.3, Math.cos(a), Math.sin(a)]);
    }
    wingPair(g, m, { width: 0.55, length: 2.2, panels: 4, root: 0.56, x: -0.8, yoke: 0.12, tile: 0.16, tilt: 0.25 });
    dish(g, m, 0.09, [-0.6, 0.66, 0.1], [0.2, 1, 0.2]);
    whip(g, m, [1.2, 0.45, 0], [0.3, 1, 0], 0.4);
  },

  /**
   * Boeing Starliner: a broad Apollo-shaped capsule, white with a blue band, on a short service
   * module that carries its solar cells on its back end, four thruster "doghouses" round its
   * sides and the four big launch-abort engines.
   */
  starliner(g, m) {
    const capsule = lathe(g, m.white, [[0.9, 0], [0.9, 0.06], [0.48, 0.74], [0.36, 0.8], [0, 0.8]], 0, 0, 0, 'x', 40);
    tileUV(capsule.geometry, 8, 2);
    const band = new THREE.LatheGeometry([[0.905, 0.07], [0.86, 0.14]].map(([r, y]) => new THREE.Vector2(r, y)), 40);
    mesh(g, band, gloss(m, 0x1d3f8f), 0, 0, 0).rotation.z = -Math.PI / 2;
    cyl(g, m.dark, 0.91, 0.9, 0.05, -0.02, 0, 0, 'x', false, 40); // heat shield edge
    dockingPort(g, m, 0.86, 0.26);
    for (const a of [0.5, -0.5]) box(g, m.lens, 0.12, 0.012, 0.1, 0.42, 0.62 * Math.cos(a), 0.62 * Math.sin(a)).rotation.set(a, 0, -0.95);
    // service module
    const sm = cyl(g, m.white, 0.9, 0.9, 0.5, -0.3, 0, 0, 'x', false, 40);
    tileUV(sm.geometry, 6, 1);
    tileUV(cyl(g, m.radiator, 0.905, 0.905, 0.3, -0.3, 0, 0, 'x', true, 40).geometry, 1, 3);
    const back = new THREE.CircleGeometry(0.86, 40);
    tileUV(back, 6, 6);
    const cells = mesh(g, back, m.cellsBlue, -0.552, 0, 0); // solar cells on the aft bulkhead
    cells.rotation.y = -Math.PI / 2;
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2, cy = Math.cos(a), cz = Math.sin(a);
      const house = box(g, m.white, 0.36, 0.14, 0.2, -0.3, 0.95 * cy, 0.95 * cz); // thruster doghouse
      house.rotation.x = a;
      nozzle(g, m, 0.035, 0.05, [-0.12, 1.02 * cy, 1.02 * cz], [0.6, cy, cz]);
      nozzle(g, m, 0.035, 0.05, [-0.48, 1.02 * cy, 1.02 * cz], [-0.6, cy, cz]);
      nozzle(g, m, 0.12, 0.18, [-0.56, 0.5 * Math.cos(a + Math.PI / 4), 0.5 * Math.sin(a + Math.PI / 4)], [-1, 0.25 * Math.cos(a + Math.PI / 4), 0.25 * Math.sin(a + Math.PI / 4)]); // launch-abort engines
    }
  },

  /**
   * Orion: the crew capsule (a larger Apollo shape) on its adapter, and the European Service
   * Module with the main engine and four solar wings in an X, each about 7 m long.
   */
  orion(g, m) {
    const capsule = lathe(g, m.hull, [[1.0, 0], [1.0, 0.05], [0.42, 0.95], [0.32, 1.0], [0, 1.0]], 0, 0, 0, 'x', 40);
    tileUV(capsule.geometry, 8, 3);
    cyl(g, m.dark, 1.01, 1.0, 0.06, -0.02, 0, 0, 'x', false, 40); // heat shield
    dockingPort(g, m, 1.06, 0.24);
    for (let k = 0; k < 4; k++) { // windows
      const a = -0.6 + k * 0.4;
      box(g, m.lens, 0.12, 0.012, 0.1, 0.5, 0.74 * Math.cos(a), 0.74 * Math.sin(a)).rotation.set(a, 0, -1.0);
    }
    // crew module adapter and service module
    tileUV(cyl(g, m.white, 1.0, 0.9, 0.3, -0.18, 0, 0, 'x', false, 40).geometry, 6, 1);
    const esm = cyl(g, m.foilSilver, 0.9, 0.9, 1.05, -0.86, 0, 0, 'x', false, 40);
    tileUV(esm.geometry, 6, 2);
    for (let k = 0; k < 4; k++) { // radiator panels between the wings
      const a = (k * Math.PI) / 2;
      const panel = box(g, m.radiator, 0.8, 0.012, 0.5, -0.86, 0.905 * Math.cos(a), 0.905 * Math.sin(a));
      panel.rotation.x = a + Math.PI / 2;
    }
    cyl(g, m.foilGold, 0.9, 0.55, 0.2, -1.48, 0, 0, 'x', false, 40);
    nozzle(g, m, 0.24, 0.42, [-1.58, 0, 0], [-1, 0, 0]); // main engine (a Space Shuttle OMS engine)
    for (let k = 0; k < 8; k++) {
      const a = (k * TAU) / 8;
      nozzle(g, m, 0.045, 0.08, [-1.55, 0.5 * Math.cos(a), 0.5 * Math.sin(a)], [-1, 0, 0]); // auxiliary thrusters
    }
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      thrusters(g, m, [-0.5, 0.9 * Math.cos(a), 0.9 * Math.sin(a)], [0, Math.cos(a), Math.sin(a)]);
      const wing = buildWing(m, { width: 0.6, length: 2.4, panels: 3, yoke: 0.2, tile: 0.2 });
      wing.position.set(-1.05, 0.9 * Math.sin(a), 0.9 * Math.cos(a));
      wing.rotation.x = -a; // its +Z (along the wing) turned to point outwards at angle a
      wing.rotateY(-0.35); // swept back a little, as they fly
      g.add(wing);
    }
  },

  /**
   * Dream Chaser: a small lifting-body spaceplane, white above and black-tiled beneath, its two
   * wings folded up (they fold to fit inside the fairing), and behind it the Shooting Star cargo
   * module with its solar arrays.
   */
  dreamchaser(g, m) {
    // the body: half an elongated ellipsoid, flattened underneath
    const shape = new THREE.SphereGeometry(1, 36, 18);
    const p = shape.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const tail = x < 0 ? 1 - 0.25 * -x : 1; // fuller at the back
      p.setXYZ(i, x * 1.0, Math.max(y, -0.18) * 0.32 * tail, z * 0.42 * tail);
    }
    shape.computeVertexNormals();
    mesh(g, shape, m.white);
    slab(g, m.carbon, [[0.95, 0], [0.7, 0.24], [-0.85, 0.36], [-1.02, 0.3], [-1.02, -0.3], [-0.85, -0.36], [0.7, -0.24]], 0.03, 0, -0.06, 0); // tiles underneath
    ball(g, m.carbon, 0.13, 0.9, -0.02, 0, 1, 0.75, 1.3); // nose cap
    box(g, m.lens, 0.22, 0.02, 0.24, 0.48, 0.2, 0).rotation.z = -0.35; // cockpit windows
    for (const s of [-1, 1]) {
      // folded wing: a swept panel rising from the body's side
      const wing = new THREE.Group();
      panel(wing, m.white, [[-0.4, -0.02 * s], [0.15, 0], [-0.05, 0.42 * s], [-0.45, 0.48 * s]], 0.04);
      panel(wing, m.carbon, [[0.15, 0], [0.19, 0], [-0.02, 0.43 * s], [-0.05, 0.42 * s]], 0.045); // black leading edge
      wing.position.set(-0.45, -0.02, s * 0.36);
      wing.rotation.x = s * -0.95;
      g.add(wing);
    }
    box(g, m.carbon, 0.2, 0.04, 0.6, -1.06, -0.05, 0); // body flap
    for (const z of [-0.12, 0.12]) nozzle(g, m, 0.04, 0.06, [-1.0, 0.06, z], [-1, 0, 0]);
    // Shooting Star cargo module, docked behind it
    const module = cyl(g, m.white, 0.4, 0.4, 0.95, -1.62, 0, 0, 'x', false, 28);
    tileUV(module.geometry, 5, 1);
    const wrap = new THREE.CylinderGeometry(0.405, 0.405, 0.75, 28, 1, true, 0, Math.PI);
    tileUV(wrap, 5, 2);
    mesh(g, wrap, m.cellsBlue, -1.62, 0, 0).rotation.z = Math.PI / 2;
    cyl(g, m.dark, 0.34, 0.4, 0.06, -1.12, 0, 0, 'x', false, 28);
    cyl(g, m.dark, 0.4, 0.36, 0.05, -2.11, 0, 0, 'x', false, 28);
    wingPair(g, m, { width: 0.42, length: 0.9, panels: 2, root: 0.4, x: -1.75, yoke: 0.08, tile: 0.14, tilt: 0.4 });
  },

  /**
   * The Tesla Roadster that went to space on the first Falcon Heavy (February 2018): a
   * first-generation Roadster (2008–2012, built on a Lotus Elise chassis) in midnight cherry
   * red, with "Starman", a mannequin in a SpaceX pressure suit, at the wheel, still on the
   * short black adapter that held it to the rocket. Nose at +X, wheels down. 1 unit = 1 m:
   * 3.95 m long, 1.85 m wide, 1.13 m high, 2.35 m between the axles.
   */
  roadster(g, m) {
    mesh(g, roadsterBody(), roadsterPaint(m));
    const black = m.carbon, chrome = m.metal;
    // wheels: black tyres, five silver spokes
    for (const [x, r] of [[FRONT_AXLE, 0.29], [REAR_AXLE, 0.315]] as const) for (const s of [-1, 1]) {
      const z = s * 0.76;
      cyl(g, m.dark, r, r, 0.2, x, r, z, 'z', false, 24);
      hoop(g, m.dark, r * 0.93, r * 0.12, x, r, z + s * 0.08, 'z', 24); // the tyre's rounded sidewall
      cyl(g, chrome, r * 0.66, r * 0.66, 0.02, x, r, z + s * 0.095, 'z', false, 20); // rim lip …
      cyl(g, m.dark, r * 0.6, r * 0.6, 0.022, x, r, z + s * 0.096, 'z', false, 20); // … and the dark wheel between the spokes
      for (let k = 0; k < 5; k++) {
        const a = (k * TAU) / 5 + 0.3;
        const spoke = box(g, chrome, r * 0.56, r * 0.13, 0.03, x + Math.cos(a) * r * 0.3, r + Math.sin(a) * r * 0.3, z + s * 0.1);
        spoke.rotation.z = a;
      }
      cyl(g, chrome, r * 0.14, r * 0.14, 0.04, x, r, z + s * 0.11, 'z', false, 10); // hub
    }
    // headlights: two lenses set into the tops of the front wings
    for (const s of [-1, 1]) {
      const lamp = ball(g, m.metal, 0.15, 1.6, 0.555, s * 0.56, 1.5, 0.3, 0.6); // the chrome reflector behind clear glass, sunk into the wing
      lamp.rotation.set(s * 0.25, s * 0.35, -0.38);
      ball(g, m.navWhite, 0.04, 1.69, 0.545, s * 0.56);
    }
    // round tail lights, two each side, in the chopped tail
    for (const s of [-1, 1]) for (const z of [0.46, 0.66]) {
      cyl(g, m.navRed, 0.065, 0.065, 0.03, -1.955, 0.72, s * z, 'x', false, 14);
    }
    // windscreen: a raked black frame round dark glass
    const screen = new THREE.Group();
    const glass = box(screen, m.lens, 0.012, 0.5, 1.22);
    glass.position.y = 0.25;
    for (const s of [-1, 1]) box(screen, black, 0.04, 0.54, 0.05, 0, 0.26, s * 0.63);
    box(screen, black, 0.05, 0.05, 1.3, 0, 0.52, 0);
    screen.position.set(0.66, 0.84, 0);
    screen.rotation.z = 0.98; // about 56° back from upright
    g.add(screen);
    for (const s of [-1, 1]) { // door mirrors
      strut(g, black, [0.52, 0.8, s * 0.8], [0.5, 0.88, s * 0.88], 0.015);
      ball(g, black, 0.06, 0.49, 0.89, s * 0.9, 0.7, 0.75, 1.1);
    }
    // cockpit: seats and the roll hoop behind them
    for (const z of [-0.36, 0.36]) {
      box(g, black, 0.46, 0.1, 0.46, -0.32, 0.42, z); // cushion
      box(g, black, 0.12, 0.62, 0.46, -0.6, 0.72, z).rotation.z = 0.22; // back
    }
    for (const z of [-0.36, 0.36]) {
      strut(g, black, [-0.82, 0.86, z - 0.2], [-0.82, 1.07, z - 0.14], 0.025);
      strut(g, black, [-0.82, 1.07, z - 0.14], [-0.82, 1.07, z + 0.14], 0.025);
      strut(g, black, [-0.82, 1.07, z + 0.14], [-0.82, 0.86, z + 0.2], 0.025);
    }
    box(g, black, 0.36, 0.14, 1.36, 0.38, 0.74, 0); // dashboard
    // Starman: left-hand drive, so the driver's seat is on −Z
    const z0 = -0.36;
    hoop(g, black, 0.17, 0.018, 0.2, 0.84, z0, 'x', 18).rotation.z = 0.45; // steering wheel
    starman(g, m, z0);
    // the adapter it was bolted to: a short black cone, and the four arms holding the car
    cyl(g, m.dark, 0.45, 0.62, 0.3, 0, -0.17, 0, 'y', false, 24);
    hoop(g, m.metal, 0.62, 0.02, 0, -0.32, 0, 'y', 24);
    for (const x of [-0.9, 0.9]) for (const z of [-0.5, 0.5]) strut(g, m.dark, [x * 0.4, -0.03, z * 0.7], [x, 0.17, z], 0.03);
  },
} satisfies Partial<Record<ModelKind, Builder>>;
