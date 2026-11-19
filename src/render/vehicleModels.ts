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
  type Builder, type Materials, type V3,
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
   * cherry-red, first-generation Roadster (an open two-seater on a Lotus Elise chassis) with
   * "Starman", a mannequin in a SpaceX pressure suit, at the wheel, its left arm on the door,
   * still on the small black adapter that held it to the rocket. Real size 3.9 m long.
   */
  roadster(g, m) {
    const red = gloss(m, 0x9c121c); // cherry red
    // the body, drawn from its side view (nose at +X) and given its width
    const side = new THREE.Group();
    const profile: [number, number][] = [[-1.97, 0.24], [-1.93, 0.78], [-1.62, 0.86], [-0.95, 0.86], [0.45, 0.82], [1.82, 0.56], [1.98, 0.4], [1.9, 0.16], [-1.85, 0.13]];
    slab(side, red, profile.map(([x, y]) => [x, y - 0.5] as const), 1.5, 0, 0, 0, 0.8);
    side.rotation.x = -Math.PI / 2; // the slab's thickness (Y) now runs across the car (Z); its outline's Z is up
    side.position.y = 0.5;
    g.add(side);
    for (const x of [-1.22, 1.25]) for (const s of [-1, 1]) { // wheel-arch lips over the wheels
      mesh(g, new THREE.TorusGeometry(0.38, 0.06, 6, 14, Math.PI), red, x, 0.33, s * 0.8);
    }
    box(g, red, 1.5, 0.14, 0.14, 0.05, 0.62, -0.78); // door sills
    box(g, red, 1.5, 0.14, 0.14, 0.05, 0.62, 0.78);
    // cockpit: black interior, two seats, a roll hoop behind them
    box(g, m.carbon, 1.35, 0.06, 1.38, -0.35, 0.83, 0);
    for (const z of [-0.36, 0.36]) {
      box(g, m.carbon, 0.42, 0.14, 0.5, -0.42, 0.9, z);
      box(g, m.carbon, 0.12, 0.62, 0.5, -0.72, 1.12, z).rotation.z = 0.18; // seat back
    }
    hoop(g, m.dark, 0.32, 0.03, -0.95, 1.05, 0, 'x', 16);
    // windscreen in a black frame
    const screen = new THREE.Group();
    box(screen, m.lens, 0.012, 0.36, 1.4);
    for (const s of [-1, 1]) box(screen, m.dark, 0.03, 0.4, 0.03, 0, 0, s * 0.7);
    box(screen, m.dark, 0.03, 0.03, 1.42, 0, 0.19, 0);
    screen.position.set(0.55, 1.0, 0);
    screen.rotation.z = 0.75; // raked back over the dashboard
    g.add(screen);
    box(g, m.carbon, 0.3, 0.12, 1.3, 0.33, 0.86, 0); // dashboard
    // Starman: white suit, black visor, right hand on the wheel, left arm resting on the door (left-hand drive: driver on −Z)
    const z0 = -0.36;
    hoop(g, m.dark, 0.13, 0.016, 0.15, 1.02, z0, 'x', 16); // steering wheel
    box(g, m.white, 0.24, 0.45, 0.34, -0.5, 1.15, z0).rotation.z = 0.2; // torso
    ball(g, m.white, 0.15, -0.44, 1.48, z0); // helmet
    box(g, m.lens, 0.04, 0.13, 0.2, -0.31, 1.49, z0); // visor
    strut(g, m.white, [-0.45, 1.3, z0 + 0.15], [-0.15, 1.08, z0 + 0.1], 0.045); // right arm
    strut(g, m.white, [-0.15, 1.08, z0 + 0.1], [0.12, 1.06, z0 + 0.05], 0.04);
    strut(g, m.white, [-0.45, 1.3, z0 - 0.17], [-0.3, 0.95, -0.72], 0.045); // left arm, elbow on the door
    strut(g, m.white, [-0.3, 0.95, -0.72], [0.0, 0.9, -0.74], 0.04);
    for (const z of [z0 - 0.08, z0 + 0.08]) strut(g, m.white, [-0.35, 0.95, z], [0.25, 0.85, z], 0.06); // legs, under the dashboard
    // wheels, lights
    for (const x of [-1.22, 1.25]) for (const s of [-1, 1]) {
      cyl(g, m.dark, 0.33, 0.33, 0.22, x, 0.33, s * 0.8, 'z', false, 20);
      cyl(g, m.metal, 0.2, 0.2, 0.225, x, 0.33, s * 0.8, 'z', false, 10);
    }
    for (const s of [-1, 1]) {
      box(g, m.lens, 0.12, 0.08, 0.28, 1.88, 0.5, s * 0.5).rotation.z = -0.5; // headlights
      ball(g, m.navRed, 0.05, -1.97, 0.68, s * 0.55, 0.6, 1, 1.2); // tail lights
    }
    box(g, m.dark, 0.06, 0.12, 0.55, 1.98, 0.28, 0); // the small grille
    // the adapter it was bolted to, a short black truss on a ring
    cyl(g, m.dark, 0.55, 0.75, 0.32, 0, -0.18, 0, 'y', false, 24);
    hoop(g, m.metal, 0.75, 0.02, 0, -0.34, 0, 'y', 24);
    const feet: V3[] = [[-1.0, 0.13, -0.45], [-1.0, 0.13, 0.45], [1.0, 0.15, -0.45], [1.0, 0.15, 0.45]];
    for (const [x, y, z] of feet) strut(g, m.dark, [x * 0.45, -0.02, z * 0.9], [x, y, z], 0.03);
  },
} satisfies Partial<Record<ModelKind, Builder>>;
