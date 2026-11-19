/**
 * 3D models of particular orbiters, landers and rovers at the Moon and Mars that used to
 * borrow a family's shape: Chandrayaan-2 and Danuri at the Moon; Mars Odyssey, Mars Express,
 * the Trace Gas Orbiter and Hope at Mars; the landers InSight, Blue Ghost, Nova-C (Odysseus,
 * Athena), Vikram and SLIM; and China's Zhurong rover. One builder per kind, made from the kit
 * in modelParts.ts and handed to satModels.ts, which merges, centres, scales and caches every
 * model the same way.
 *
 * Orbiters keep the usual axes (+X = travel, −Y = down to the surface). Landers and rovers
 * stand on the ground: +Y is up, +X is forwards, y = 0 is the ground under their feet or
 * wheels (modelBase() tells a caller how far below the model's centre that ends up).
 * 1 unit = 1 m.
 */

import * as THREE from 'three';
import type { ModelKind } from '../data/describe.ts';
import {
  TAU, ball, box, buildWing, bus, cyl, dish, fan, helix, hoop, lattice, nozzle, plate, prism, scope, solarPanel, strut, thrusters, tracker, whip, wingPair,
  type Builder, type Materials,
} from './modelParts.ts';
import { wheel } from './planetaryModels.ts';

/** A lander leg from the body at (x, y, z) down to a footpad on the ground, braced by two thin struts. */
function leg(g: THREE.Group, m: Materials, x: number, y: number, z: number, out: number, pad = 0.2, skin: THREE.Material = m.metal): void {
  const a = Math.atan2(z, x), c = Math.cos(a), s = Math.sin(a), r = Math.hypot(x, z) + out;
  strut(g, skin, [x, y, z], [r * c, 0.1, r * s], 0.04);
  for (const side of [-0.35, 0.35]) strut(g, m.metal, [Math.hypot(x, z) * Math.cos(a + side), y * 0.5, Math.hypot(x, z) * Math.sin(a + side)], [r * 0.9 * c, 0.3, r * 0.9 * s], 0.018);
  cyl(g, m.goldPlate, pad, pad * 1.25, 0.05, r * c, 0.03, r * s, 'y', false, 12);
}

export const PLANET_MISSION_BUILDERS = {
  /**
   * Chandrayaan-2 orbiter (India): a gold-foil cube with one solar wing, a dish, the sharpest
   * camera ever flown round the Moon looking down, and the flat antenna of a radar that
   * looks for ice in the shadowed craters of the poles.
   */
  chandrayaan2(g, m) {
    bus(g, m.foilGold, 1.6, 1.5, 1.5, { bevel: 0.07 });
    bus(g, m.foilBlack, 1.64, 0.25, 1.54, { y: 0.66, bevel: 0.03 });
    const wing = buildWing(m, { width: 1.5, length: 3.0, panels: 2, yoke: 0.4, tile: 0.4 });
    wing.position.set(0, 0.2, 0.75);
    wing.rotation.z = 0.3;
    g.add(wing);
    strut(g, m.dark, [-0.5, 0.75, -0.4], [-0.7, 1.3, -0.6], 0.04);
    dish(g, m, 0.35, [-0.72, 1.35, -0.62], [-0.3, 1, -0.3]);
    scope(g, m, m.white, 0.18, 0.6, [0.4, -0.75, 0.2], [0, -1, 0]); // high-resolution camera
    scope(g, m, m.foilSilver, 0.1, 0.3, [0.4, -0.75, -0.35], [0, -1, 0]); // terrain-mapping camera
    const radar = new THREE.Group(); // dual-frequency radar's flat antenna
    const face = solarPanel(m, 1.2, 0.8, m.radar, m.panelBack, 0.3);
    face.rotation.x = Math.PI;
    radar.add(face);
    radar.position.set(-0.2, -0.8, -0.3);
    radar.rotation.x = 0.4;
    g.add(radar);
    nozzle(g, m, 0.14, 0.2, [-0.8, 0, 0], [-1, 0, 0]);
    for (const [y, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) thrusters(g, m, [-0.8, y * 0.6, z * 0.6], [-0.6, y, z], 1.2);
    tracker(g, m, [0.5, 0.78, -0.4], [0.3, 1, -0.3], 1.3);
  },

  /**
   * Danuri (Korea Pathfinder Lunar Orbiter): a foil box with a pair of solar panels on one side,
   * a dish on top, and NASA's ShadowCam, a camera sensitive enough to see into craters never lit
   * by the Sun. (Its layout here follows the published drawings only roughly.)
   */
  danuri(g, m) {
    bus(g, m.foilGold, 1.9, 1.8, 1.7, { bevel: 0.08 });
    bus(g, m.foilSilver, 1.94, 0.3, 1.74, { y: 0.75, bevel: 0.03 });
    for (const x of [-0.55, 0.55]) { // the two panels side by side on one wall
      const wing = buildWing(m, { width: 1.0, length: 2.0, panels: 1, yoke: 0.35, tile: 0.35 });
      wing.position.set(x, 0.1, 0.85);
      wing.rotation.z = 0.35;
      g.add(wing);
    }
    strut(g, m.dark, [0, 0.9, -0.3], [0.1, 1.4, -0.4], 0.05);
    dish(g, m, 0.45, [0.12, 1.45, -0.42], [0.2, 1, -0.2]);
    scope(g, m, m.dark, 0.22, 0.7, [0.5, -0.9, -0.3], [0, -1, 0]); // ShadowCam
    scope(g, m, m.white, 0.1, 0.3, [-0.4, -0.9, 0.3], [0, -1, 0]); // the wide-angle polarimetric camera
    bus(g, m.foilGold, 0.35, 0.3, 0.35, { x: -0.4, y: -1.0, z: -0.4, bevel: 0.03 }); // gamma-ray spectrometer
    nozzle(g, m, 0.14, 0.2, [-0.95, 0, 0], [-1, 0, 0]);
    tracker(g, m, [0.6, 0.9, 0.4], [0.3, 1, 0.3], 1.3);
  },

  /**
   * 2001 Mars Odyssey: the longest-serving craft at Mars. A box with one three-panel solar
   * wing, a dish on a mast, and a 6 m boom holding its gamma-ray spectrometer away from the
   * craft's own radiation; it found ice just under the surface across the high latitudes.
   */
  odyssey(g, m) {
    bus(g, m.foilGold, 1.7, 1.4, 1.3, { bevel: 0.07 });
    bus(g, m.foilBlack, 1.74, 0.6, 1.34, { y: 0.55, bevel: 0.04 });
    const wing = buildWing(m, { width: 1.6, length: 4.2, panels: 3, yoke: 0.4, tile: 0.4 });
    wing.position.set(0, 0.2, -0.65);
    wing.rotation.set(0, Math.PI, -0.3);
    g.add(wing);
    strut(g, m.metal, [0.5, 0.85, 0.3], [0.6, 2.0, 0.4], 0.04);
    dish(g, m, 0.65, [0.62, 2.05, 0.42], [0.3, 1, 0.2]);
    lattice(g, m.metal, [-0.8, 0.85, 0.5], [-4.3, 2.2, 2.6], 0.05, 16); // gamma-ray spectrometer boom (6.2 m)
    cyl(g, m.foilGold, 0.15, 0.15, 0.35, -4.4, 2.25, 2.66, 'x', false, 14);
    scope(g, m, m.white, 0.14, 0.4, [0.4, -0.7, 0], [0, -1, 0]); // thermal camera
    helix(g, m, [-0.5, -0.7, 0.3], [0, -1, 0], 0.35, 0.06); // the relay antenna that hears the rovers
    nozzle(g, m, 0.16, 0.24, [0, -0.7, -0.4], [0, -1, 0]);
    tracker(g, m, [-0.6, 0.85, -0.3], [-0.3, 1, -0.3], 1.3);
  },

  /**
   * Mars Express: Europe's first craft to another planet, built from Rosetta's spare design in
   * record time. A gold box, two wings, a 1.6 m dish on one side, and the long antennas of the
   * MARSIS radar (two 20 m and one 7 m, shortened here), which sounds for water under the ice.
   */
  marsexpress(g, m) {
    bus(g, m.foilGold, 1.5, 1.4, 1.8, { bevel: 0.07 });
    bus(g, m.foilBlack, 1.54, 0.25, 1.84, { y: 0.6, bevel: 0.03 });
    strut(g, m.dark, [0.75, 0.2, 0], [0.95, 0.2, 0], 0.06);
    dish(g, m, 0.8, [1.0, 0.2, 0], [1, 0.1, 0]);
    wingPair(g, m, { width: 1.5, length: 5.0, panels: 2, root: 0.9, yoke: 0.35, tilt: 0.3, tile: 0.4 });
    for (const s of [-1, 1]) strut(g, m.metal, [-0.3, -0.7, s * 0.3], [-0.6, -0.9, s * 6.5], 0.018); // radar dipole
    strut(g, m.metal, [-0.3, -0.7, 0], [-0.6, -3.5, 0], 0.018); // and its monopole
    scope(g, m, m.white, 0.16, 0.45, [0.3, -0.7, 0.4], [0, -1, 0]); // the stereo camera
    bus(g, m.foilSilver, 0.35, 0.3, 0.35, { x: 0.3, y: -0.8, z: -0.4, bevel: 0.03 }); // OMEGA spectrometer
    nozzle(g, m, 0.18, 0.28, [-0.4, 0.75, 0], [0, 1, 0]);
    tracker(g, m, [-0.5, 0.75, 0.6], [-0.3, 1, 0.3], 1.3);
  },

  /**
   * ExoMars Trace Gas Orbiter: a big gold box with two wings 17.5 m from tip to tip, a 2.2 m
   * dish, spectrometers that sniff the thin air for methane, and the colour stereo camera.
   */
  tgo(g, m) {
    bus(g, m.foilGold, 3.2, 2.0, 2.0, { bevel: 0.1 });
    bus(g, m.foilSilver, 3.24, 0.3, 2.04, { y: -0.85, bevel: 0.04 });
    strut(g, m.dark, [0.6, 1.0, 0], [0.7, 1.5, 0.1], 0.06);
    dish(g, m, 1.1, [0.72, 1.55, 0.1], [0.3, 1, 0.2]);
    wingPair(g, m, { width: 2.0, length: 7.0, panels: 4, root: 1.0, yoke: 0.5, tilt: 0.3, tile: 0.45 });
    for (const [x, z] of [[1.0, 0.5], [0.3, -0.5], [-0.4, 0.5]]) bus(g, m.white, 0.5, 0.4, 0.5, { x, y: -1.25, z, bevel: 0.04 }); // spectrometers
    scope(g, m, m.foilSilver, 0.16, 0.45, [-1.1, -1.05, -0.4], [0, -1, 0]); // CaSSIS camera
    nozzle(g, m, 0.3, 0.45, [-1.6, 0, 0], [-1, 0, 0]);
    for (const [y, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) thrusters(g, m, [-1.6, y * 0.8, z * 0.8], [-0.6, y, z], 1.6);
    tracker(g, m, [1.0, 1.0, -0.6], [0.3, 1, -0.3], 1.4);
  },

  /**
   * Hope (Emirates Mars Mission): a six-sided body with a big dish on top and three solar
   * panels opened out round its base, in a wide orbit from which it watches the weather of a
   * whole hemisphere of Mars at once.
   */
  hope(g, m) {
    prism(g, m.foilGold, 6, 1.25, 1.25, 2.4, 0, 0, 0, 0.6);
    prism(g, m.foilBlack, 6, 1.28, 1.28, 0.3, 0, 1.05, 0, 0.6);
    strut(g, m.dark, [0, 1.2, 0], [0, 1.5, 0], 0.08);
    dish(g, m, 0.92, [0, 1.55, 0], [0, 1, 0]);
    for (let k = 0; k < 3; k++) { // three panels, opened out like petals round the bottom
      const a = (k * TAU) / 3 + Math.PI / 6;
      const wing = buildWing(m, { width: 1.5, length: 2.4, panels: 2, yoke: 0.2, tile: 0.4 });
      wing.position.set(1.08 * Math.cos(a), -0.9, 1.08 * Math.sin(a));
      wing.rotation.set(0, Math.PI / 2 - a, 0);
      wing.rotateX(0.35);
      g.add(wing);
    }
    for (const [a, kind] of [[0.5, 0], [2.6, 1], [4.7, 2]] as const) { // the three instruments, looking at Mars past the panels
      const c = Math.cos(a), s = Math.sin(a);
      if (kind === 0) scope(g, m, m.white, 0.16, 0.4, [0.7 * c, -1.2, 0.7 * s], [0, -1, 0]);
      else bus(g, m.foilSilver, 0.35, 0.3, 0.35, { x: 0.7 * c, y: -1.35, z: 0.7 * s, bevel: 0.03 });
    }
    nozzle(g, m, 0.12, 0.18, [0, -1.2, 0], [0, -1, 0]);
    tracker(g, m, [0.8, 1.2, 0.3], [0.4, 1, 0.3], 1.3);
  },

  /**
   * InSight: a lander that listened for marsquakes. A deck on three legs between two round
   * fan-fold solar arrays, a robotic arm, and on the ground in front the seismometer under its
   * domed wind shield and the heat probe (the "mole") that could not dig deep enough.
   */
  insight(g, m) {
    prism(g, m.foilGold, 6, 0.8, 0.8, 0.35, 0, 0.95, 0, 0.5);
    prism(g, m.dark, 6, 0.84, 0.84, 0.04, 0, 1.14, 0, 0.5);
    for (let k = 0; k < 3; k++) {
      const a = (k * TAU) / 3 + Math.PI / 2;
      leg(g, m, 0.65 * Math.cos(a), 0.8, 0.65 * Math.sin(a), 0.35, 0.16);
    }
    for (const s of [-1, 1]) { // the two fans, 2.2 m across
      const f = fan(m, 1.08, 10, m.cellsBlue, 0.3);
      f.position.set(0, 1.12, s * 1.85);
      g.add(f);
      strut(g, m.metal, [0, 1.1, s * 0.7], [0, 1.12, s * 0.85], 0.04);
    }
    // the arm, reaching forwards
    strut(g, m.white, [0.65, 1.15, 0.2], [1.3, 1.6, 0.25], 0.035);
    strut(g, m.white, [1.3, 1.6, 0.25], [1.9, 0.9, 0.2], 0.03);
    ball(g, m.dark, 0.06, 1.3, 1.6, 0.25);
    box(g, m.dark, 0.12, 0.1, 0.12, 1.92, 0.82, 0.2);
    // on the ground: the seismometer's dome, and the heat probe's box
    const dome = ball(g, m.white, 0.36, 1.7, 0.0, -0.45, 1, 0.75, 1);
    dome.position.y = 0.02;
    hoop(g, m.dark, 0.36, 0.03, 1.7, 0.03, -0.45, 'y', 20);
    bus(g, m.foilGold, 0.3, 0.4, 0.28, { x: 1.4, y: 0.2, z: 0.6, bevel: 0.03 });
    scope(g, m, m.dark, 0.05, 0.15, [0.55, 1.15, -0.4], [0.5, 0.6, 0]); // cameras
    dish(g, m, 0.18, [-0.4, 1.3, 0.3], [-0.3, 1, 0]);
    whip(g, m, [-0.5, 1.15, -0.3], [0, 1, 0], 0.4);
  },

  /**
   * Blue Ghost (Firefly, Mission 1, 2025): a squat, wide gold lander, its solar panels on its
   * sides and its payloads on a flat top deck, on four legs. It worked for two weeks, until
   * sunset, and filmed the sunset at its landing site.
   */
  blueghost(g, m) {
    prism(g, m.foilGold, 8, 1.35, 1.35, 1.1, 0, 1.1, 0, 0.6, Math.PI / 8);
    prism(g, m.dark, 8, 1.4, 1.4, 0.06, 0, 1.68, 0, 0.6, Math.PI / 8);
    for (let k = 0; k < 4; k++) { // solar panels on four of the eight sides
      const a = (k * Math.PI) / 2, c = Math.cos(a), s = Math.sin(a);
      plate(g, m, m.cellsBlue, 1.0, 0.95, [1.26 * c, 1.1, 1.26 * s], [c, 0, s], 1 / 0.3);
    }
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      leg(g, m, 1.15 * Math.cos(a), 0.9, 1.15 * Math.sin(a), 0.6, 0.22);
    }
    nozzle(g, m, 0.22, 0.3, [0, 0.55, 0], [0, -1, 0]);
    for (const [x, z] of [[0.5, 0.4], [-0.4, 0.5], [-0.3, -0.5], [0.45, -0.45]]) bus(g, m.white, 0.32, 0.25, 0.3, { x, y: 1.84, z, bevel: 0.03 }); // payloads
    scope(g, m, m.dark, 0.08, 0.3, [0.0, 1.71, 0.0], [0, 1, 0]);
    dish(g, m, 0.3, [-0.8, 1.95, 0], [-0.3, 1, 0]);
    strut(g, m.metal, [-0.8, 1.71, 0], [-0.8, 1.92, 0], 0.03);
    for (let k = 0; k < 4; k++) thrusters(g, m, [1.25 * Math.cos(k * 1.57 + 0.4), 1.6, 1.25 * Math.sin(k * 1.57 + 0.4)], [Math.cos(k * 1.57 + 0.4), 0.3, Math.sin(k * 1.57 + 0.4)], 1.3);
  },

  /**
   * Nova-C (Intuitive Machines: Odysseus in 2024, Athena in 2025): a tall six-sided lander
   * on six legs, its solar cells on its sides, a methane-and-oxygen engine underneath. Both
   * came to rest on their sides; it is drawn standing, as it was meant to land.
   */
  novac(g, m) {
    prism(g, m.foilSilver, 6, 0.9, 0.9, 2.6, 0, 1.9, 0, 0.6);
    prism(g, m.dark, 6, 0.95, 0.95, 0.06, 0, 3.22, 0, 0.6);
    for (let k = 0; k < 6; k += 2) { // cells on three of the six sides
      const a = (k * TAU) / 6 + Math.PI / 6, c = Math.cos(a), s = Math.sin(a), flat = 0.9 * Math.cos(Math.PI / 6);
      plate(g, m, m.cellsBlue, 0.8, 1.9, [flat * c, 2.0, flat * s], [c, 0, s], 1 / 0.3);
    }
    for (let k = 0; k < 6; k++) {
      const a = (k * TAU) / 6;
      leg(g, m, 0.8 * Math.cos(a), 1.0, 0.8 * Math.sin(a), 0.55, 0.15);
    }
    nozzle(g, m, 0.24, 0.35, [0, 0.62, 0], [0, -1, 0]);
    cyl(g, m.foilGold, 0.8, 0.8, 0.12, 0, 0.62, 0, 'y', false, 6);
    dish(g, m, 0.3, [0.3, 3.45, 0.3], [0.3, 1, 0.2]);
    strut(g, m.metal, [0.3, 3.25, 0.3], [0.3, 3.42, 0.3], 0.03);
    for (const [x, z] of [[-0.35, 0.2], [0.1, -0.4]]) bus(g, m.white, 0.3, 0.2, 0.25, { x, y: 3.36, z, bevel: 0.02 });
    for (let k = 0; k < 6; k++) thrusters(g, m, [0.88 * Math.cos(k * 1.05 + 0.5), 3.0, 0.88 * Math.sin(k * 1.05 + 0.5)], [Math.cos(k * 1.05 + 0.5), 0.2, Math.sin(k * 1.05 + 0.5)], 1.1);
  },

  /**
   * Vikram (Chandrayaan-3, 2023): India's first soft landing, the first near the Moon's south
   * pole. A gold box on four legs with a solar panel on one side, and the ramp down which the
   * little six-wheeled Pragyan rover drove off.
   */
  vikram(g, m) {
    bus(g, m.foilGold, 2.0, 1.15, 2.0, { y: 1.25, bevel: 0.08 });
    bus(g, m.dark, 2.04, 0.05, 2.04, { y: 1.85, bevel: 0.02 });
    plate(g, m, m.cellsBlue, 1.8, 1.0, [0, 1.25, -1.02], [0, 0, -1], 1 / 0.35); // the panel on its side
    const top = solarPanel(m, 1.2, 1.0, m.cellsBlue, m.panelBack, 0.35); // and the one on top
    top.position.set(-0.3, 1.9, 0.2);
    g.add(top);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      leg(g, m, 1.15 * Math.cos(a), 1.0, 1.15 * Math.sin(a), 0.55, 0.2);
    }
    for (const [x, z] of [[0.45, 0.45], [-0.45, 0.45], [0.45, -0.45], [-0.45, -0.45]]) nozzle(g, m, 0.1, 0.16, [x, 0.68, z], [0, -1, 0]);
    // the ramp, and Pragyan at its foot
    for (const z of [-0.25, 0.25]) strut(g, m.metal, [1.0, 1.3, z + 0.3], [2.3, 0.05, z + 0.3], 0.025);
    const rover = new THREE.Group();
    bus(rover, m.foilGold, 0.9, 0.35, 0.7, { y: 0.4, bevel: 0.03 });
    const panel = solarPanel(m, 0.9, 0.6, m.cellsBlue, m.panelBack, 0.3);
    panel.position.set(-0.1, 0.75, 0.45);
    panel.rotation.x = -0.9;
    rover.add(panel);
    for (const x of [-0.35, 0, 0.35]) for (const s of [-1, 1]) cyl(rover, m.dullMetal, 0.1, 0.1, 0.08, x, 0.1, s * 0.42, 'z', false, 12);
    scope(rover, m, m.dark, 0.04, 0.1, [0.42, 0.55, 0.15], [1, 0.2, 0]);
    rover.position.set(2.8, 0, 0.3);
    g.add(rover);
    dish(g, m, 0.25, [-0.6, 2.1, -0.4], [-0.3, 1, -0.2]);
    strut(g, m.metal, [-0.6, 1.88, -0.4], [-0.6, 2.06, -0.4], 0.025);
  },

  /**
   * SLIM (Smart Lander for Investigating Moon, Japan, 2024): a small, compact lander that came
   * down within 10 m of its target and then tipped onto its nose (its solar cells, on its top,
   * faced away from the Sun until the light came round). Drawn upright, on its five crushable
   * legs, with its two main engines.
   */
  slim(g, m) {
    bus(g, m.foilGold, 1.6, 1.5, 1.5, { y: 1.2, bevel: 0.08 });
    for (const z of [-0.45, 0.45]) cyl(g, m.foilSilver, 0.55, 0.55, 1.45, 0, 1.2, z, 'x', false, 20); // propellant tanks, bulging out
    const top = solarPanel(m, 1.5, 1.4, m.cellsBlue, m.panelBack, 0.3); // thin-film cells on the top
    top.position.set(0, 1.97, 0);
    g.add(top);
    for (let k = 0; k < 5; k++) {
      const a = (k * TAU) / 5 + 0.3;
      leg(g, m, 0.75 * Math.cos(a), 0.65, 0.75 * Math.sin(a), 0.35, 0.16, m.dullMetal);
    }
    for (const z of [-0.3, 0.3]) nozzle(g, m, 0.15, 0.22, [0, 0.45, z], [0, -1, 0]);
    scope(g, m, m.dark, 0.06, 0.2, [0.8, 1.2, 0.3], [1, -0.4, 0]); // the camera that matched craters to its map
    for (const z of [-0.5, 0.5]) bus(g, m.white, 0.2, 0.2, 0.2, { x: -0.85, y: 1.4, z, bevel: 0.02 }); // the two little rovers it set down
    for (let k = 0; k < 4; k++) thrusters(g, m, [0.8 * (k < 2 ? 1 : -1), 1.85, 0.75 * (k % 2 ? 1 : -1)], [k < 2 ? 1 : -1, 0.3, k % 2 ? 1 : -1], 1.1);
  },

  /**
   * Zhurong (Tianwen-1, 2021): China's first Mars rover. Six wheels, a body of white and
   * blue, four solar panels opened out like a butterfly's wings, a mast with cameras at the
   * front and a dish behind it.
   */
  zhurong(g, m) {
    const R = 0.15, track = 0.75;
    for (const s of [-1, 1]) {
      for (const x of [0.65, 0, -0.65]) wheel(g, m, x, R, s * track, R, 0.2);
      strut(g, m.dark, [0.65, R, s * 0.65], [0, 0.42, s * 0.62], 0.035); // suspension
      strut(g, m.dark, [-0.65, R, s * 0.65], [0, 0.42, s * 0.62], 0.035);
      strut(g, m.dark, [0, R, s * 0.65], [0, 0.42, s * 0.62], 0.03);
    }
    bus(g, m.white, 1.2, 0.4, 0.95, { y: 0.62, bevel: 0.04 });
    plate(g, m, m.radiator, 0.9, 0.7, [-0.05, 0.825, 0], [0, 1, 0], 3);
    for (const s of [-1, 1]) for (const x of [0.3, -0.35]) { // the butterfly wings
      const wing = new THREE.Group();
      const p = solarPanel(m, 0.55, 0.85, m.cellsBlue, m.panelBack, 0.25);
      p.position.z = 0.42;
      wing.add(p);
      wing.position.set(x, 0.84, s * 0.45);
      wing.rotation.set(s * -0.35, s === 1 ? 0 : Math.PI, 0);
      wing.rotateZ(x > 0 ? -0.25 : 0.25);
      g.add(wing);
    }
    strut(g, m.white, [0.5, 0.82, 0], [0.5, 1.75, 0], 0.035); // camera mast
    bus(g, m.white, 0.18, 0.15, 0.4, { x: 0.52, y: 1.82, bevel: 0.02 });
    for (const z of [-0.12, 0.12]) cyl(g, m.lens, 0.035, 0.035, 0.02, 0.62, 1.83, z, 'x', false, 10);
    strut(g, m.metal, [-0.3, 0.82, 0.1], [-0.3, 1.2, 0.1], 0.025);
    dish(g, m, 0.2, [-0.3, 1.25, 0.1], [-0.3, 1, 0.2]);
    whip(g, m, [-0.55, 0.82, -0.35], [0, 1, 0], 0.4);
    tracker(g, m, [0.0, 0.82, 0.35], [0, 1, 0.2], 0.8);
  },
} satisfies Partial<Record<ModelKind, Builder>>;
