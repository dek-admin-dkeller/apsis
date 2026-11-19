/**
 * 3D models of what works at other worlds — an orbiter of the Moon, an orbiter of Mars, a
 * rover, a lander — and of one thing nobody built: an asteroid. One builder per kind, made
 * from the kit in modelParts.ts and handed to satModels.ts, which builds, merges and caches
 * every model the same way.
 *
 * Orbiters keep the usual axes (+X = travel, −Y = down to the surface they are mapping).
 * The rover and the lander stand on the ground: +Y is up, +X is forwards, and y = 0 is the
 * ground under their wheels and footpads (satModels.ts: modelBase tells a caller how far below
 * the model's centre that ends up once the model is normalised).
 */

import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ModelKind } from '../data/describe.ts';
import {
  TAU, arrayPanel, ball, box, buildWing, bus, cyl, dish, helix, hoop, mesh, nozzle, plate, prism, random, rtg, scope, solarPanel, strut, thrusters, tracker, whip, wingPair,
  type Builder, type Materials, type V3,
} from './modelParts.ts';

/** A rover wheel on an axle along Z: a wide thin-walled drum with cleats, spokes to a small hub. */
function wheel(g: THREE.Group, m: Materials, x: number, y: number, z: number, r: number, w: number): void {
  cyl(g, m.dullMetal, r, r, w, x, y, z, 'z', true, 20);
  cyl(g, m.baffle, r * 0.94, r * 0.94, w, x, y, z, 'z', true, 20); // its dark inside
  for (const side of [-1, 1]) hoop(g, m.metal, r, r * 0.04, x, y, z + (side * w) / 2, 'z', 20);
  cyl(g, m.metal, r * 0.3, r * 0.3, w * 0.45, x, y, z, 'z', false, 10);
  for (let k = 0; k < 6; k++) {
    const a = (k * TAU) / 6, ca = Math.cos(a), sa = Math.sin(a);
    strut(g, m.metal, [x + r * 0.28 * ca, y + r * 0.28 * sa, z], [x + r * 0.95 * ca, y + r * 0.95 * sa, z], r * 0.05); // springy spokes
  }
  for (let k = 0; k < 12; k++) { // cleats across the tread
    const a = (k * TAU) / 12;
    box(g, m.dark, r * 0.07, r * 0.05, w * 0.96, x + r * 1.01 * Math.cos(a), y + r * 1.01 * Math.sin(a), z).rotation.z = a + Math.PI / 2;
  }
}

/**
 * The asteroid's surface: how far from the centre it is in direction (x, y, z), and how dark.
 * Big slow bumps make it a lumpy potato rather than a ball, smaller ones roughen it, and each
 * crater is a bowl with a raised rim. The bumps are sums of waves along fixed random
 * directions, which needs no noise table and gives the same rock on every run.
 */
function rockSurface(seed: number): (x: number, y: number, z: number) => { radius: number; shade: number } {
  const rand = random(seed);
  const unit = (): V3 => {
    const u = rand() * 2 - 1, a = rand() * TAU, s = Math.sqrt(1 - u * u);
    return [s * Math.cos(a), u, s * Math.sin(a)];
  };
  const waves = [[1.6, 0.16, 3], [3.3, 0.075, 5], [7, 0.03, 7], [15, 0.011, 9]].flatMap(([frequency, height, count]) =>
    Array.from({ length: count }, () => ({ dir: unit(), frequency: frequency * (0.8 + rand() * 0.4), height, phase: rand() * TAU })));
  // size = angular radius: three big hollows, a handful of ordinary craters, and many small pits
  const craters = Array.from({ length: 46 }, (_, i) => {
    const size = i < 3 ? 0.42 + rand() * 0.16 : i < 12 ? 0.12 + rand() * 0.2 : 0.035 + rand() * 0.05;
    return { at: unit(), size, near: Math.cos(Math.min(Math.PI, size * 1.6)) }; // `near`: closer to its middle than this, a point feels the crater
  });
  return (x, y, z) => {
    let radius = 1, shade = 0.86;
    for (const w of waves) {
      const wave = Math.sin(w.frequency * (x * w.dir[0] + y * w.dir[1] + z * w.dir[2]) + w.phase);
      radius += w.height * wave;
      if (w.frequency > 5) shade += wave * 0.035; // fine bumps also mottle the colour a little
    }
    for (const c of craters) {
      const towards = x * c.at[0] + y * c.at[1] + z * c.at[2];
      if (towards < c.near) continue; // far outside (the usual case for a small pit): nothing to add, and no arccosine to pay for
      const t = Math.acos(Math.min(1, towards)) / c.size; // 0 at the middle, 1 at the rim
      if (t < 1) {
        radius -= c.size * 0.3 * (1 - t * t);
        shade -= 0.2 * (1 - t * t); // floors lie in shadow and dust
      }
      const rim = Math.exp(-(((t - 1) / 0.16) ** 2));
      radius += c.size * 0.07 * rim;
      shade += 0.1 * rim; // freshly broken rock on the rim is paler
    }
    return { radius, shade };
  };
}

/** A lump of rock from a surface function: a finely divided ball pushed in and out, shaded per corner. */
function rockGeometry(surface: (x: number, y: number, z: number) => { radius: number; shade: number }, detail: number, stretch: V3, tint: V3, grain = 1.6): THREE.BufferGeometry {
  // The ball arrives as separate triangles. Welding their shared corners first means each
  // corner is moved once (a sixth of the work) and the lighting runs smoothly over the facets.
  const ball = new THREE.IcosahedronGeometry(1, detail);
  ball.deleteAttribute('uv'); // remade below, once the shape is known
  ball.deleteAttribute('normal');
  const geometry = mergeVertices(ball);
  ball.dispose();
  const position = geometry.getAttribute('position');
  const colour = new Float32Array(position.count * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i).normalize();
    const { radius, shade } = surface(p.x, p.y, p.z);
    position.setXYZ(i, p.x * radius * stretch[0], p.y * radius * stretch[1], p.z * radius * stretch[2]);
    const s = Math.max(0.35, Math.min(1.15, shade));
    colour.set([s * tint[0], s * tint[1], s * tint[2]], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colour, 3));
  geometry.computeVertexNormals();
  // Texture coordinates for the stone-grain map: each triangle is laid flat along whichever axis
  // it faces most (a ball cannot be wrapped without a seam; this way the seams are lost in the grain).
  const flat = geometry.toNonIndexed();
  geometry.dispose();
  const at = flat.getAttribute('position'), facing = flat.getAttribute('normal');
  const uv = new Float32Array(at.count * 2);
  for (let i = 0; i < at.count; i += 3) {
    const nx = Math.abs(facing.getX(i) + facing.getX(i + 1) + facing.getX(i + 2));
    const ny = Math.abs(facing.getY(i) + facing.getY(i + 1) + facing.getY(i + 2));
    const nz = Math.abs(facing.getZ(i) + facing.getZ(i + 1) + facing.getZ(i + 2));
    for (let k = i; k < i + 3; k++) {
      if (nx >= ny && nx >= nz) uv.set([at.getZ(k) * grain, at.getY(k) * grain], k * 2);
      else if (ny >= nz) uv.set([at.getX(k) * grain, at.getZ(k) * grain], k * 2);
      else uv.set([at.getX(k) * grain, at.getY(k) * grain], k * 2);
    }
  }
  flat.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return flat;
}

export const PLANETARY_BUILDERS = {
  /**
   * Lunar orbiter (Lunar Reconnaissance Orbiter and its kind): a foil box whose underside is
   * crowded with cameras and a laser altimeter looking straight down, one large solar wing on
   * a gimbal, and a dish held up on a long boom so it can see Earth past the wing. 1 unit = 1 m.
   */
  lunarorbiter(g, m) {
    bus(g, m.foilGold, 2.2, 1.4, 1.5, { bevel: 0.08 });
    bus(g, m.foilBlack, 0.7, 1.46, 1.56, { x: -0.8, bevel: 0.05 }); // propulsion module
    bus(g, m.dark, 1.5, 0.06, 1.54, { x: 0.38, y: -0.72, bevel: 0.02 }); // instrument bench
    for (const z of [-0.2, 0.2]) scope(g, m, m.white, 0.14, 0.75, [0.78, -0.74, z], [0, -1, 0]); // the twin cameras that can see a rover's tracks
    scope(g, m, m.foilGold, 0.2, 0.4, [0.25, -0.74, -0.38], [0, -1, 0]); // laser altimeter
    scope(g, m, m.foilSilver, 0.08, 0.3, [1.02, -0.74, 0], [0.3, -1, 0]); // wide-angle camera
    bus(g, m.white, 0.35, 0.4, 0.3, { x: 0.22, y: -0.97, z: 0.42, bevel: 0.03 }); // radiometer that maps the surface temperature
    cyl(g, m.lens, 0.08, 0.08, 0.01, 0.22, -1.176, 0.42, 'y', false, 12);
    bus(g, m.foilGold, 0.4, 0.46, 0.4, { x: -0.22, y: -0.98, bevel: 0.04, tile: 0.4 }); // neutron detector: looks for buried ice
    const radar = arrayPanel(m, 0.9, 1.1); // side-looking radar antenna
    radar.position.set(0.2, -0.35, 0.95);
    radar.rotation.x = 0.7;
    g.add(radar);
    for (const x of [-0.1, 0.5]) strut(g, m.dark, [x, -0.1, 0.75], [x, -0.3, 0.92], 0.02);
    const wing = buildWing(m, { width: 2.8, length: 3.3, panels: 3, yoke: 0.7, tile: 0.4 });
    wing.position.set(0.1, 0.2, -0.75);
    wing.rotation.set(0, Math.PI, -0.5);
    g.add(wing);
    strut(g, m.metal, [0.5, 0.7, 0.4], [0.75, 2.45, 0.62], 0.03);
    ball(g, m.metal, 0.07, 0.75, 2.45, 0.62);
    dish(g, m, 0.42, [0.77, 2.52, 0.64], [0.35, 1, 0.3]);
    plate(g, m, m.radiator, 1.0, 0.9, [0.2, 0.702, -0.1], [0, 1, 0], 3);
    for (const y of [-0.3, 0.3]) for (const z of [-0.3, 0.3]) nozzle(g, m, 0.1, 0.16, [-1.16, y, z], [-1, 0, 0]);
    for (const [y, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) thrusters(g, m, [-1.0, y * 0.68, z * 0.72], [-0.6, y, z], 1.3);
    tracker(g, m, [0.7, 0.7, -0.45], [0.4, 1, -0.6], 1.3);
    tracker(g, m, [-0.2, 0.7, -0.5], [-0.4, 1, -0.6], 1.3);
    helix(g, m, [-0.3, 0.7, 0.4], [0, 1, 0], 0.16, 0.05);
  },

  /**
   * Mars orbiter (Mars Reconnaissance Orbiter and its kind): the three-metre dish dwarfs the
   * bus it is mounted on, because every picture has to cross up to 400 million km. Two big
   * wings, a telescope camera the size of a barrel looking down, the two thin arms of a
   * ground-penetrating radar, and a small antenna for relaying the rovers' data. 1 unit = 1 m.
   */
  marsorbiter(g, m) {
    bus(g, m.foilGold, 1.8, 2.0, 1.8, { bevel: 0.1 });
    bus(g, m.foilBlack, 1.86, 0.5, 1.86, { y: -0.6, bevel: 0.05 });
    bus(g, m.dark, 1.9, 0.06, 1.9, { y: -1.02, bevel: 0.02 }); // the deck that faces Mars
    strut(g, m.dark, [0, 1.0, 0], [0.2, 1.6, 0.05], 0.07);
    ball(g, m.metal, 0.13, 0.2, 1.6, 0.05); // two-axis gimbal
    dish(g, m, 1.5, [0.26, 1.72, 0.06], [0.5, 1, 0.15]);
    wingPair(g, m, { width: 2.5, length: 5.0, panels: 2, root: 0.9, y: 0.2, yoke: 0.6, tilt: 0.45, tile: 0.5 });
    // The telescope camera: half a metre of mirror, able to see a kitchen table from orbit.
    cyl(g, m.foilSilver, 0.36, 0.38, 1.3, 0.3, -1.68, 0, 'y', true, 24);
    cyl(g, m.baffle, 0.34, 0.34, 1.28, 0.3, -1.68, 0, 'y', true, 24);
    cyl(g, m.lens, 0.34, 0.34, 0.02, 0.3, -1.25, 0, 'y', false, 24);
    for (const y of [-1.1, -1.7, -2.32]) hoop(g, m.dark, 0.375, 0.016, 0.3, y, 0, 'y', 24);
    cyl(g, m.dark, 0.07, 0.07, 0.05, 0.3, -2.2, 0, 'y', false, 10);
    for (let k = 0; k < 3; k++) strut(g, m.dark, [0.3, -2.2, 0], [0.3 + 0.34 * Math.cos((k * TAU) / 3), -2.2, 0.34 * Math.sin((k * TAU) / 3)], 0.01);
    scope(g, m, m.white, 0.1, 0.5, [-0.4, -1.05, 0.45], [0, -1, 0]); // context camera
    bus(g, m.foilGold, 0.4, 0.4, 0.4, { x: -0.5, y: -1.25, z: -0.4, bevel: 0.04, tile: 0.4 }); // mineral-mapping spectrometer
    scope(g, m, m.foilSilver, 0.09, 0.18, [-0.5, -1.45, -0.4], [0, -1, 0]);
    helix(g, m, [-0.65, -1.05, 0.05], [0, -1, 0], 0.4, 0.07); // the relay antenna that listens to the rovers
    for (const s of [-1, 1]) whip(g, m, [s * 0.95, -0.9, -0.7], [s, -0.04, 0], 1.9, 0.016); // radar that looks for ice under the ground
    for (const y of [-0.25, 0.25]) for (const z of [-0.4, 0, 0.4]) nozzle(g, m, 0.09, 0.14, [-0.9, y, z], [-1, 0, 0]); // six engines to brake into orbit
    for (const [y, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) thrusters(g, m, [-0.88, y * 0.9, z * 0.85], [-0.6, y, z], 1.6);
    plate(g, m, m.mirror, 1.2, 1.0, [0.904, 0.3, 0], [1, 0, 0], 5);
    tracker(g, m, [0.6, 1.0, -0.6], [0.5, 1, -0.6], 1.5);
    tracker(g, m, [-0.6, 1.0, -0.6], [-0.5, 1, -0.6], 1.5);
  },

  /**
   * Mars rover (Curiosity, Perseverance): a car-sized body on six wheels. Each side's wheels
   * hang from a rocker and a bogie (the jointed frame that lets it climb a rock as tall as a
   * wheel while all six stay on the ground). A mast with the camera head, an arm with a
   * turret of tools at the front, the nuclear generator tilted up at the back. It stands on
   * the ground: +Y is up, +X is forwards. 1 unit = 1 m.
   */
  rover(g, m) {
    const R = 0.26, track = 1.15; // wheel radius; half the distance between left and right wheels
    for (const s of [-1, 1]) {
      for (const x of [1.1, -0.05, -1.1]) wheel(g, m, x, R, s * track, R, 0.4);
      const z = s * 0.88; // the suspension frame runs just inboard of the wheels
      const pivot: V3 = [0.2, 0.82, z], knee: V3 = [0.95, 0.74, z], front: V3 = [1.1, 0.34, z];
      const bogie: V3 = [-0.55, 0.52, z], middle: V3 = [-0.05, 0.34, z], hip: V3 = [-0.95, 0.62, z], rear: V3 = [-1.1, 0.34, z];
      strut(g, m.dark, pivot, knee, 0.045); // rocker: forwards to the front wheel …
      strut(g, m.dark, knee, front, 0.045);
      strut(g, m.dark, pivot, bogie, 0.045); // … and back to the bogie's pivot
      strut(g, m.dark, bogie, middle, 0.04); // bogie: middle and rear wheels
      strut(g, m.dark, bogie, hip, 0.04);
      strut(g, m.dark, hip, rear, 0.04);
      for (const p of [pivot, bogie, knee, hip]) ball(g, m.metal, 0.065, p[0], p[1], p[2]);
      for (const p of [front, middle, rear]) {
        cyl(g, m.metal, 0.07, 0.07, 0.16, p[0], p[1] + 0.02, p[2], 'y', false, 10); // steering and drive motors
        strut(g, m.metal, [p[0], R, p[2]], [p[0], R, s * (track - 0.05)], 0.04);
      }
      strut(g, m.metal, pivot, [0.2, 0.82, s * 0.7], 0.05);
    }
    bus(g, m.white, 1.7, 0.5, 1.45, { x: 0.05, y: 0.93, bevel: 0.04 }); // the warm box that holds the computers and laboratories
    bus(g, m.dark, 1.6, 0.04, 1.36, { x: 0.05, y: 0.67, bevel: 0.01 });
    plate(g, m, m.hull, 1.56, 1.32, [0.05, 1.181, 0], [0, 1, 0], 1.3); // deck
    strut(g, m.dark, [0.2, 1.24, -0.72], [0.2, 1.24, 0.72], 0.028); // the bar across the deck that makes one side rise as the other falls
    cyl(g, m.metal, 0.06, 0.06, 0.08, 0.2, 1.22, 0, 'y', false, 10);
    for (const s of [-1, 1]) strut(g, m.dark, [0.2, 1.24, s * 0.72], [0.2, 0.86, s * 0.86], 0.024);
    // Mast and camera head.
    strut(g, m.white, [0.72, 1.18, -0.5], [0.72, 2.05, -0.5], 0.05);
    cyl(g, m.metal, 0.08, 0.08, 0.1, 0.72, 2.03, -0.5, 'y', false, 10);
    bus(g, m.white, 0.3, 0.27, 0.52, { x: 0.74, y: 2.2, z: -0.5, bevel: 0.03 });
    cyl(g, m.lens, 0.085, 0.085, 0.02, 0.9, 2.23, -0.4, 'x', false, 14); // the laser that vaporises rock from seven metres, and its telescope
    hoop(g, m.metal, 0.085, 0.012, 0.9, 2.23, -0.4, 'x', 14);
    for (const z of [-0.68, -0.58]) box(g, m.lens, 0.014, 0.06, 0.06, 0.895, 2.24, z); // the two colour cameras
    box(g, m.dark, 0.014, 0.035, 0.36, 0.895, 2.12, -0.5); // navigation cameras
    // Generator: plutonium warmth for the long winter nights, with fins and two cooling plates.
    rtg(g, m, [-0.82, 1.0, 0], [-0.8, 0.5, 0], 0.75, 0.15, m.white, m.white);
    for (const s of [-1, 1]) {
      box(g, m.radiator, 0.72, 0.42, 0.02, -1.14, 1.22, s * 0.42).rotation.z = -0.56;
      strut(g, m.metal, [-0.8, 1.05, s * 0.3], [-0.95, 1.1, s * 0.42], 0.02);
    }
    // Arm, reaching forward, and its turret: drill, hand lens, spectrometer.
    const shoulder: V3 = [0.92, 0.86, 0.38], elbow: V3 = [1.75, 1.22, 0.42], wrist: V3 = [2.15, 0.68, 0.34];
    strut(g, m.metal, shoulder, elbow, 0.045);
    strut(g, m.metal, elbow, wrist, 0.045);
    for (const p of [shoulder, elbow, wrist]) cyl(g, m.dark, 0.085, 0.085, 0.16, p[0], p[1], p[2], 'z', false, 12);
    cyl(g, m.dark, 0.21, 0.21, 0.16, wrist[0] + 0.06, wrist[1] - 0.16, wrist[2], 'y', false, 14);
    cyl(g, m.metal, 0.05, 0.03, 0.3, wrist[0] + 0.14, wrist[1] - 0.36, wrist[2] + 0.06, 'y', false, 8); // drill
    box(g, m.foilGold, 0.14, 0.14, 0.14, wrist[0] - 0.08, wrist[1] - 0.2, wrist[2] - 0.16);
    box(g, m.white, 0.12, 0.16, 0.12, wrist[0] + 0.1, wrist[1] - 0.2, wrist[2] - 0.18);
    // Antennas and deck furniture.
    strut(g, m.metal, [-0.45, 1.18, 0.5], [-0.45, 1.5, 0.5], 0.03);
    const paddle = prism(g, m.array, 6, 0.22, 0.22, 0.03, -0.45, 1.56, 0.5, 0.11); // the dish is a flat hexagon: it talks straight to Earth
    paddle.rotation.set(0.5, 0, 0.45);
    cyl(g, m.metal, 0.055, 0.055, 0.34, -0.62, 1.35, -0.5, 'y', false, 10); // the antenna that talks to the orbiters overhead
    whip(g, m, [-0.3, 1.18, -0.62], [0, 1, 0], 0.26, 0.012);
    for (const [x, z] of [[0.45, 0.3], [0.3, 0.45], [0.55, 0.05]]) cyl(g, m.goldPlate, 0.05, 0.05, 0.03, x, 1.2, z, 'y', false, 10); // lids of the sample inlets
    box(g, m.goldPlate, 0.09, 0.012, 0.09, -0.1, 1.196, -0.45); // sundial: the colour chart the cameras are calibrated on
    bus(g, m.foilGold, 0.3, 0.14, 0.3, { x: -0.2, y: 1.25, z: 0.1, bevel: 0.02, tile: 0.3 });
    for (const z of [-0.2, 0.2]) box(g, m.lens, 0.014, 0.05, 0.08, 0.905, 0.84, z); // hazard cameras, low at the front
    box(g, m.lens, 0.014, 0.05, 0.08, -0.805, 0.84, 0.25);
  },

  /**
   * A lander: an eight-sided body in gold foil on four splayed legs, the descent engine
   * underneath, two solar panels opened like wings, a dish and a camera mast on the deck, and
   * a ramp down to the ground. It stands on the ground: +Y is up. 1 unit = 1 m.
   */
  lander(g, m) {
    const R = 1.0, flat = R * Math.cos(Math.PI / 8);
    prism(g, m.foilGold, 8, R, R, 0.8, 0, 1.0, 0, 0.6, Math.PI / 8);
    prism(g, m.dark, 8, R * 1.05, R * 1.05, 0.05, 0, 1.42, 0, 0.6, Math.PI / 8); // deck
    prism(g, m.foilBlack, 8, R, 0.6, 0.25, 0, 0.48, 0, 0.6, Math.PI / 8);
    nozzle(g, m, 0.3, 0.36, [0, 0.4, 0], [0, -1, 0]);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2, c = Math.cos(a), s = Math.sin(a);
      // one leg: a thick shock-absorbing strut, braced by two thin ones, on a dished footpad
      strut(g, m.foilGold, [0.95 * c, 1.2, 0.95 * s], [1.82 * c, 0.14, 1.82 * s], 0.06);
      for (const side of [-0.5, 0.5]) strut(g, m.metal, [0.92 * Math.cos(a + side), 0.56, 0.92 * Math.sin(a + side)], [1.56 * c, 0.46, 1.56 * s], 0.028);
      cyl(g, m.goldPlate, 0.2, 0.26, 0.08, 1.84 * c, 0.04, 1.84 * s, 'y', false, 14);
      ball(g, m.metal, 0.07, 1.82 * c, 0.14, 1.82 * s);
      thrusters(g, m, [1.0 * c, 1.3, 1.0 * s], [c, 0.4, s], 1.3);
      const b = (k * Math.PI) / 2;
      ball(g, m.foilSilver, 0.3, 0.92 * Math.cos(b), 0.78, 0.92 * Math.sin(b)); // propellant tanks, bulging out between the legs
    }
    for (const s of [-1, 1]) {
      const tilt = 0.4, reach = 0.8;
      const panel = solarPanel(m, 1.5, 1.5, m.cellsBlue, m.panelBack, 0.3);
      panel.position.set(0, 1.44 + reach * Math.sin(tilt), s * (flat + 0.1 + reach * Math.cos(tilt)));
      panel.rotation.x = -s * tilt;
      g.add(panel);
      for (const x of [-0.5, 0.5]) strut(g, m.metal, [x, 1.44, s * flat], [x, 1.47, s * (flat + 0.14)], 0.025);
    }
    strut(g, m.metal, [0.45, 1.44, 0.3], [0.45, 2.0, 0.3], 0.03);
    dish(g, m, 0.42, [0.45, 2.06, 0.3], [0.5, 0.8, 0.3]);
    strut(g, m.white, [-0.5, 1.44, -0.3], [-0.5, 2.3, -0.3], 0.035); // camera mast
    bus(g, m.white, 0.22, 0.16, 0.32, { x: -0.5, y: 2.38, z: -0.3, bevel: 0.02 });
    for (const z of [-0.38, -0.22]) box(g, m.lens, 0.012, 0.06, 0.06, -0.385, 2.39, z);
    bus(g, m.foilGold, 0.4, 0.22, 0.34, { x: -0.3, y: 1.56, z: 0.4, bevel: 0.03, tile: 0.4 });
    bus(g, m.white, 0.3, 0.2, 0.3, { x: 0.1, y: 1.55, z: -0.5, bevel: 0.03 });
    helix(g, m, [-0.7, 1.44, 0.1], [0, 1, 0], 0.22, 0.05);
    whip(g, m, [0.1, 1.44, 0.7], [0.1, 1, 0.2], 0.5, 0.012);
    for (const z of [-0.26, 0.26]) strut(g, m.metal, [flat, 1.4, z], [2.5, 0.04, z], 0.022); // ramp for a small rover
    for (let k = 1; k <= 6; k++) strut(g, m.metal, [flat + k * 0.22, 1.4 - k * 0.19, -0.26], [flat + k * 0.22, 1.4 - k * 0.19, 0.26], 0.014);
    // a short arm with a scoop, off the other side
    strut(g, m.metal, [-0.9, 1.44, -0.3], [-1.5, 1.75, -0.5], 0.03);
    strut(g, m.metal, [-1.5, 1.75, -0.5], [-1.95, 0.75, -0.62], 0.03);
    ball(g, m.dark, 0.06, -1.5, 1.75, -0.5);
    box(g, m.metal, 0.16, 0.12, 0.14, -1.97, 0.68, -0.62);
  },

  /**
   * An asteroid: a lumpy, cratered, dark rock with a few boulders lying on it, as the small
   * near-Earth ones turn out to be when a spacecraft visits. Made to tumble, so it has no
   * "front": every side is finished.
   */
  asteroid(g, m) {
    mesh(g, rockGeometry(rockSurface(71), 26, [1.32, 0.9, 1.04], [1, 1, 1]), m.rock);
    // Boulders: small rocks of their own, half sunk into the surface, a little paler (less dust on them).
    const body = rockSurface(71), rand = random(97);
    for (let i = 0; i < 16; i++) {
      const u = rand() * 2 - 1, a = rand() * TAU, s = Math.sqrt(1 - u * u);
      const dir: V3 = [s * Math.cos(a), u, s * Math.sin(a)];
      const size = 0.035 + rand() * rand() * 0.11;
      const boulder = mesh(g, rockGeometry(rockSurface(200 + i), 2, [1 + rand() * 0.5, 0.7 + rand() * 0.3, 1], [1.12, 1.1, 1.06]), m.rock);
      const at = body(dir[0], dir[1], dir[2]).radius - size * 0.2;
      boulder.position.set(dir[0] * at * 1.32, dir[1] * at * 0.9, dir[2] * at * 1.04);
      boulder.scale.setScalar(size);
      boulder.rotation.set(rand() * TAU, rand() * TAU, rand() * TAU);
    }
  },
} satisfies Partial<Record<ModelKind, Builder>>;
