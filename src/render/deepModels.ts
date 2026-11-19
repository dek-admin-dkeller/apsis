/**
 * 3D models of the craft that leave the Earth behind: the probes on their way out of the
 * solar system, the ones that dive towards the Sun, and the travellers to Jupiter, Mercury
 * and the asteroids. One builder per kind, made from the kit in modelParts.ts and handed to
 * satModels.ts, which builds, merges and caches every model the same way.
 *
 * Two habits of this file:
 *   - A probe that is mostly one big dish is built in its own tilted frame (`probeFrame`), the
 *     dish looking up and back the way it came. Level, a dish seen from the usual three-quarter
 *     view is either a thin ellipse or a featureless back; tilted, it shows its bowl on one
 *     side and its body and booms on the other as the model turns.
 *   - Booms are drawn shorter than life. Voyager's magnetometer boom is 13 m on a 3.7 m dish;
 *     at that scale the spacecraft itself would be a dot in its own picture.
 * Each builder states its own scale: the result is normalised to one unit anyway.
 */

import * as THREE from 'three';
import type { ModelKind } from '../data/describe.ts';
import {
  TAU, aimed, ball, box, buildWing, bus, cyl, dish, fan, helix, hoop, lathe, lattice, nozzle, orient, plate, prism, rtg, scope, slab, solarPanel, strut, thrusters,
  tileUV, tracker, whip, wingPair,
  type Builder, type V3,
} from './modelParts.ts';

/** The tilted frame of a dish-first probe: inside it +Y is where the dish looks, and the booms lie in the XZ plane. */
function probeFrame(g: THREE.Group, lean = 0.64): THREE.Group {
  return aimed(g, [0, 0, 0], [-Math.sin(lean), Math.cos(lean), 0]);
}

export const DEEP_BUILDERS = {
  /**
   * Voyager 1 and 2: a 3.7 m dish with everything else hung behind it: the ten-sided bus with
   * the golden record bolted to its side, three nuclear generators in a row on one arm, the
   * cameras on the opposite arm, a long lattice boom for the magnetometers and two whip
   * antennas in a V. 1 unit = 2 m.
   */
  voyager(g, m) {
    const c = probeFrame(g);
    dish(c, m, 0.92, [0, 0.12, 0], [0, 1, 0]);
    prism(c, m.foilBlack, 10, 0.46, 0.46, 0.24, 0, -0.14, 0, 0.5); // the bus: ten bays of electronics round a fuel tank
    for (const y of [-0.015, -0.265]) prism(c, m.dark, 10, 0.475, 0.475, 0.02, 0, y, 0);
    const bay = (k: number, out = 0.44): V3 => [out * Math.cos(((k + 0.5) * TAU) / 10), -0.14, out * Math.sin(((k + 0.5) * TAU) / 10)];
    for (const k of [0, 2, 5, 7]) plate(c, m, m.radiator, 0.2, 0.17, bay(k), [bay(k)[0], 0, bay(k)[2]], 6); // louvres that let heat out
    const record = aimed(c, bay(3, 0.446), [bay(3)[0], 0, bay(3)[2]]); // the golden record, under its engraved cover
    cyl(record, m.goldPlate, 0.085, 0.085, 0.014, 0, 0, 0, 'y', false, 20);
    hoop(record, m.dark, 0.03, 0.006, 0, 0.008, 0, 'y', 12);
    for (let k = 0; k < 5; k++) { // the truss that holds the dish
      const a = (k * TAU) / 5;
      strut(c, m.metal, [0.42 * Math.cos(a), -0.02, 0.42 * Math.sin(a)], [0.6 * Math.cos(a + 0.3), 0.22, 0.6 * Math.sin(a + 0.3)], 0.012);
      strut(c, m.metal, [0.42 * Math.cos(a), -0.02, 0.42 * Math.sin(a)], [0.6 * Math.cos(a - 0.3), 0.22, 0.6 * Math.sin(a - 0.3)], 0.012);
    }
    cyl(c, m.foilGold, 0.2, 0.27, 0.16, 0, -0.35, 0, 'y', false, 16); // where the kick motor was
    for (let k = 0; k < 4; k++) thrusters(c, m, [0.4 * Math.cos(k * 1.57 + 0.4), -0.3, 0.4 * Math.sin(k * 1.57 + 0.4)], [Math.cos(k * 1.57 + 0.4), -1, Math.sin(k * 1.57 + 0.4)], 0.8);
    tracker(c, m, [0.3, -0.28, 0.25], [0.5, -1, 0.4], 0.9); // the star tracker that holds on to Canopus

    // Science boom (+Z): particle detectors along it, and at its tip the platform that swivels the cameras.
    lattice(c, m.metal, [0, -0.14, 0.44], [0.08, -0.2, 1.7], 0.045, 7);
    bus(c, m.foilBlack, 0.16, 0.14, 0.16, { x: 0.14, y: -0.1, z: 0.95, bevel: 0.02, tile: 0.3 });
    box(c, m.foilGold, 0.12, 0.1, 0.14, -0.06, -0.27, 1.25);
    cyl(c, m.goldPlate, 0.05, 0.07, 0.1, 0.1, -0.02, 1.4, 'y', false, 10);
    const scan = aimed(c, [0.1, -0.24, 1.86], [0.35, -0.7, 0.6]);
    bus(scan, m.foilBlack, 0.3, 0.18, 0.3, { bevel: 0.03, tile: 0.3 });
    scope(scan, m, m.white, 0.07, 0.42, [0.07, 0.09, 0.07]); // narrow-angle camera
    scope(scan, m, m.white, 0.05, 0.22, [-0.09, 0.09, 0.09]); // wide-angle camera
    cyl(scan, m.foilGold, 0.13, 0.13, 0.16, -0.02, 0.17, -0.12, 'y', false, 16); // infrared telescope
    cyl(scan, m.lens, 0.11, 0.11, 0.01, -0.02, 0.255, -0.12, 'y', false, 16);
    box(scan, m.foilGold, 0.1, 0.2, 0.08, 0.12, 0.18, -0.1);

    // Generator boom (−Z): kept as far from the instruments as the craft allows.
    for (const x of [-0.07, 0.07]) strut(c, m.metal, [x, -0.14, -0.44], [0, -0.2, -0.92], 0.014);
    strut(c, m.metal, [0, -0.02, -0.44], [0, -0.2, -0.92], 0.012);
    for (let i = 0; i < 3; i++) rtg(c, m, [0, -0.2, -0.92 - i * 0.3], [0, 0, -1], 0.27, 0.1, m.dark, m.dullMetal, 6);

    // Magnetometer boom and the two radio-astronomy whips.
    lattice(c, m.metal, [-0.3, -0.2, -0.3], [-2.0, -0.6, -1.15], 0.04, 12);
    box(c, m.foilGold, 0.1, 0.08, 0.1, -2.04, -0.61, -1.17);
    box(c, m.foilGold, 0.09, 0.07, 0.09, -1.25, -0.42, -0.78);
    whip(c, m, [0.3, -0.26, -0.2], [0.7, -0.1, -0.7], 1.7, 0.009);
    whip(c, m, [0.3, -0.26, -0.2], [0.7, -0.1, 0.7], 1.7, 0.009);
  },

  /**
   * Pioneer 10 and 11: the first craft sent out of the solar system. A 2.7 m dish over a small
   * six-sided bus; two arms 120° apart with a pair of nuclear generators at the end of each,
   * and a third, longer boom for the magnetometer. The whole craft spins about the dish's axis
   * to stay pointed at Earth. 1 unit = 1.4 m.
   */
  pioneer(g, m) {
    const c = probeFrame(g);
    dish(c, m, 0.98, [0, 0.12, 0], [0, 1, 0]);
    prism(c, m.foilGold, 6, 0.5, 0.5, 0.26, 0, -0.14, 0, 0.5);
    for (const y of [-0.005, -0.275]) prism(c, m.dark, 6, 0.52, 0.52, 0.02, 0, y, 0);
    prism(c, m.foilBlack, 6, 0.27, 0.27, 0.24, -0.63, -0.14, 0, 0.4); // the smaller bay that holds most of the instruments
    plate(c, m, m.radiator, 0.3, 0.18, [0.25, -0.14, 0.434], [0.5, 0, 0.866], 6);
    plate(c, m, m.goldPlate, 0.16, 0.1, [0.25, -0.14, -0.434], [0.5, 0, -0.866], 0.5); // the plaque: a message to whoever finds it
    for (let k = 0; k < 3; k++) {
      const a = Math.PI / 3 + (k * TAU) / 3, ca = Math.cos(a), sa = Math.sin(a);
      strut(c, m.metal, [0.45 * ca, 0, 0.45 * sa], [0.7 * ca, 0.28, 0.7 * sa], 0.014); // dish supports
      thrusters(c, m, [0.98 * ca, 0.4, 0.98 * sa], [ca, 0.4, sa], 0.9); // the jets that keep it spinning true, out at the rim
    }
    for (const s of [-1, 1]) {
      const dir: V3 = [0.5, 0, s * 0.866];
      lattice(c, m.metal, [0.42 * dir[0], -0.14, 0.42 * dir[2]], [1.95 * dir[0], -0.14, 1.95 * dir[2]], 0.05, 6);
      rtg(c, m, [1.97 * dir[0], -0.14, 1.97 * dir[2]], dir, 0.3, 0.09, m.dark, m.dullMetal, 6);
      rtg(c, m, [2.3 * dir[0], -0.14, 2.3 * dir[2]], dir, 0.3, 0.09, m.dark, m.dullMetal, 6);
    }
    strut(c, m.metal, [-0.85, -0.14, 0], [-2.5, -0.14, 0], 0.014); // magnetometer boom, folded in three for launch
    for (const x of [-1.4, -1.95]) ball(c, m.metal, 0.03, x, -0.14, 0);
    cyl(c, m.foilGold, 0.06, 0.06, 0.2, -2.58, -0.14, 0, 'x', false, 10);
    helix(c, m, [0, -0.28, 0], [0, -1, 0], 0.32, 0.06); // the antenna that works when the dish is not pointing home
    tracker(c, m, [0.3, -0.28, -0.2], [0.4, -1, -0.3], 0.9);
    scope(c, m, m.foilGold, 0.06, 0.25, [-0.63, -0.02, 0.1], [-0.6, 0.5, 0.6]); // the spin-scan camera that took the first close pictures of Jupiter
  },

  /**
   * New Horizons: a gold-foil body the shape and size of a grand piano, the dish (with a
   * smaller one stacked on its feed) on top, and one nuclear generator sticking out of the
   * narrow end. The telescopes look out of the wide end. 1 unit = 1 m.
   */
  newhorizons(g, m) {
    const c = probeFrame(g);
    const outline: [number, number][] = [[0.3, 1.05], [1.3, -0.55], [1.1, -0.85], [-1.1, -0.85], [-1.3, -0.55], [-0.3, 1.05]];
    slab(c, m.foilGold, outline, 0.7, 0, 0, 0, 0.6);
    slab(c, m.foilBlack, outline.map(([x, z]) => [x * 1.02, z * 1.02] as [number, number]), 0.05, 0, 0.37, 0, 0.6);
    cyl(c, m.metal, 0.22, 0.3, 0.24, 0, 0.5, 0, 'y', false, 16);
    for (let k = 0; k < 3; k++) strut(c, m.metal, [0.7 * Math.cos(k * 2.09 + 0.5), 0.39, 0.6 * Math.sin(k * 2.09 + 0.5)], [0.75 * Math.cos(k * 2.09 + 0.5), 0.78, 0.75 * Math.sin(k * 2.09 + 0.5)], 0.016);
    dish(c, m, 1.05, [0, 0.62, 0], [0, 1, 0]);
    dish(c, m, 0.17, [0, 1.52, 0], [0, 1, 0], false); // medium-gain dish riding on the feed
    helix(c, m, [0, 1.58, 0], [0, 1, 0], 0.1, 0.03);
    // The generator, on a cone that keeps its heat and radiation off the electronics.
    cyl(c, m.dark, 0.2, 0.36, 0.14, 0, 0, 1.12, 'z', false, 16);
    cyl(c, m.metal, 0.37, 0.37, 0.03, 0, 0, 1.06, 'z', false, 20);
    rtg(c, m, [0, 0, 1.2], [0, 0, 1], 1.1, 0.16);
    // Instruments.
    scope(c, m, m.foilSilver, 0.12, 0.5, [-1.02, -0.05, -0.55], [-0.85, 0, -0.5]); // the long-range camera
    bus(c, m.foilGold, 0.36, 0.3, 0.3, { x: 0.45, y: -0.1, z: -0.96, bevel: 0.03, tile: 0.4 }); // colour camera and its cooler
    cyl(c, m.lens, 0.08, 0.08, 0.02, 0.45, -0.1, -1.115, 'z', false, 14);
    box(c, m.radiator, 0.4, 0.02, 0.3, 0.45, -0.3, -1.0).rotation.x = 0.5;
    bus(c, m.foilBlack, 0.3, 0.16, 0.2, { x: -0.3, y: -0.1, z: -0.92, bevel: 0.02 });
    cyl(c, m.goldPlate, 0.1, 0.12, 0.12, 0.9, 0.44, -0.3, 'y', false, 14); // solar-wind detector
    bus(c, m.white, 0.16, 0.16, 0.16, { x: -0.85, y: 0.46, z: -0.3, bevel: 0.02 });
    plate(c, m, m.array, 0.45, 0.3, [0.3, -0.352, 0.2], [0, -1, 0], 9); // dust counter built by students
    for (const s of [-1, 1]) {
      tracker(c, m, [s * 0.5, -0.36, -0.5], [s * 0.4, -1, -0.5], 1.3);
      thrusters(c, m, [s * 1.3, 0.2, -0.6], [s, 0.4, -0.4], 1.2);
      thrusters(c, m, [s * 0.36, -0.2, 1.02], [s, -0.5, 0.4], 1.2);
    }
  },

  /**
   * A generic deep-space craft, for anything that has no model of its own: an eight-sided bus
   * with a big dish, two modest wings, a camera, an engine and a boom.
   */
  probe(g, m) {
    const c = probeFrame(g, 0.5);
    const R = 0.62, flat = R * Math.cos(Math.PI / 8);
    prism(c, m.foilGold, 8, R, R, 1.0, 0, -0.5, 0, 0.6, Math.PI / 8);
    prism(c, m.foilBlack, 8, R * 1.03, R * 0.9, 0.3, 0, -1.14, 0, 0.6, Math.PI / 8); // propulsion module
    prism(c, m.dark, 8, R * 1.06, R * 1.06, 0.05, 0, 0.02, 0, 0.6, Math.PI / 8);
    nozzle(c, m, 0.2, 0.3, [0, -1.29, 0], [0, -1, 0]);
    cyl(c, m.metal, 0.16, 0.22, 0.14, 0, 0.1, 0, 'y', false, 14);
    dish(c, m, 1.05, [0, 0.16, 0], [0, 1, 0]);
    wingPair(c, m, { width: 0.95, length: 1.9, panels: 2, root: flat, y: -0.5, yoke: 0.3, tilt: 0.25, tile: 0.3 });
    lattice(c, m.metal, [flat, -0.4, 0], [2.9, -0.62, 0], 0.045, 11);
    box(c, m.foilGold, 0.12, 0.1, 0.12, 2.95, -0.62, 0);
    box(c, m.foilGold, 0.1, 0.08, 0.1, 1.9, -0.54, 0);
    scope(c, m, m.white, 0.12, 0.45, [-flat, -0.4, 0.1], [-1, -0.25, 0]);
    scope(c, m, m.foilSilver, 0.07, 0.3, [-flat, -0.7, -0.18], [-1, -0.25, 0]);
    for (const deg of [45, 135, 225, 315]) {
      const ca = Math.cos((deg * Math.PI) / 180), sa = Math.sin((deg * Math.PI) / 180);
      thrusters(c, m, [R * ca, -1.2, R * sa], [ca, -0.7, sa]);
    }
    plate(c, m, m.mirror, 0.4, 0.6, [flat * 0.7075, -0.5, flat * 0.7075], [1, 0, 1], 5);
    plate(c, m, m.radiator, 0.4, 0.6, [-flat * 0.7075, -0.5, -flat * 0.7075], [-1, 0, -1], 4);
    tracker(c, m, [flat * 0.7, -0.2, -flat * 0.7], [1, 0.4, -1]);
    whip(c, m, [0.3, -1.25, 0.3], [0.4, -1, 0.5], 0.6);
    helix(c, m, [-0.3, -1.28, -0.2], [0, -1, 0], 0.14, 0.04);
  },

  /**
   * Juno: a six-sided body with three solar wings nine metres long: the first craft to run
   * on sunlight as far out as Jupiter, hence their size. One wing is a panel short and ends
   * in the magnetometer boom instead. The dish sits on the titanium vault that shields the
   * electronics from Jupiter's radiation. The craft spins about the dish's axis. 1 unit = 2.5 m.
   */
  juno(g, m) {
    const c = aimed(g, [0, 0, 0], [0.32, 1, 0]); // leaning a little, so the three wings show their faces
    const R = 0.72, flat = R * Math.cos(Math.PI / 6);
    prism(c, m.foilBlack, 6, R, R, 0.6, 0, 0, 0, 0.5);
    prism(c, m.foilGold, 6, R * 1.02, R * 1.02, 0.1, 0, 0.3, 0, 0.5);
    prism(c, m.dark, 6, R * 1.02, R * 1.02, 0.05, 0, -0.31, 0);
    bus(c, m.metal, 0.5, 0.36, 0.5, { y: 0.53, bevel: 0.03 }); // the vault
    dish(c, m, 0.52, [0, 0.74, 0], [0, 1, 0]);
    for (let k = 0; k < 3; k++) {
      const a = Math.PI / 2 + (k * TAU) / 3;
      const short = k === 0;
      const wing = buildWing(m, { width: 1.06, length: short ? 2.66 : 3.56, panels: short ? 3 : 4, yoke: 0.22, tile: 0.3 });
      if (short) {
        lattice(wing, m.metal, [0, 0, 2.9], [0, 0, 3.72], 0.09, 4);
        box(wing, m.foilGold, 0.12, 0.1, 0.14, 0, 0.02, 3.3);
        box(wing, m.foilGold, 0.12, 0.1, 0.14, 0, 0.02, 3.76);
      }
      wing.position.set(flat * Math.cos(a), 0, flat * Math.sin(a));
      wing.rotation.y = Math.PI / 2 - a; // its length runs outwards
      c.add(wing);
    }
    const side = (deg: number, out = 1.006): V3 => [flat * out * Math.cos((deg * Math.PI) / 180), 0, flat * out * Math.sin((deg * Math.PI) / 180)];
    for (const deg of [30, 150]) plate(c, m, m.array, 0.62, 0.5, side(deg), side(deg), 9); // flat antennas that sound the atmosphere with microwaves
    for (const s of [-1, 1]) whip(c, m, [s * 0.12, -0.2, -flat], [s * 0.6, -0.15, -1], 1.3, 0.01); // the V that listens to radio and plasma waves
    scope(c, m, m.white, 0.07, 0.18, side(270, 1), [0.3, 0.3, -1]); // the camera the public aims
    nozzle(c, m, 0.2, 0.28, [0, -0.33, 0], [0, -1, 0]);
    for (const s of [-1, 1]) {
      strut(c, m.metal, [s * 0.3, 0.35, 0.28], [s * 0.42, 0.98, 0.34], 0.022); // thruster towers, clear of the wings
      thrusters(c, m, [s * 0.42, 1.0, 0.34], [s, 0.6, 0.3], 1.2);
      strut(c, m.metal, [s * 0.3, -0.33, -0.28], [s * 0.42, -0.7, -0.34], 0.022);
      thrusters(c, m, [s * 0.42, -0.72, -0.34], [s, -0.6, -0.3], 1.2);
    }
    tracker(c, m, [0.35, 0.36, -0.4], [0.5, 1, -0.6], 1.1);
  },

  /**
   * Jupiter-system orbiter (Europa Clipper; JUICE is of the same family): a tall cylinder of
   * propellant with the electronics vault and instruments at one end, a three-metre dish on
   * its side, and solar wings thirty metres across, the rods of an ice-penetrating radar
   * standing off them. 1 unit = 1 m.
   */
  clipper(g, m) {
    const body = cyl(g, m.foilSilver, 0.78, 0.78, 3.0, 0, -0.3, 0, 'y', false, 28);
    tileUV(body.geometry, 4, 2.5);
    for (const y of [-1.7, -0.9, 1.1]) hoop(g, m.dark, 0.785, 0.022, 0, y, 0, 'y', 28);
    bus(g, m.foilBlack, 1.5, 1.0, 1.5, { y: 1.7, bevel: 0.08 }); // the vault
    bus(g, m.foilGold, 1.1, 0.34, 0.9, { x: -0.1, y: 2.37, bevel: 0.04, tile: 0.5 });
    scope(g, m, m.white, 0.13, 0.5, [0.3, 2.54, 0.2]); // cameras and spectrometers, all looking the same way
    scope(g, m, m.foilSilver, 0.1, 0.36, [-0.3, 2.54, -0.2]);
    scope(g, m, m.white, 0.16, 0.3, [-0.35, 2.54, 0.2]);
    box(g, m.radiator, 0.04, 2.0, 1.5, -0.95, -0.2, 0); // radiator: the electronics' heat, carried round by a pumped loop
    for (const y of [-1.0, 0.6]) for (const z of [-0.5, 0.5]) strut(g, m.dark, [-0.7, y, z], [-0.95, y, z], 0.02);
    cyl(g, m.metal, 0.3, 0.4, 0.24, 0.86, 0.1, 0, 'x', false, 16);
    dish(g, m, 1.5, [0.95, 0.1, 0], [1, 0.22, 0]);
    for (const side of [-1, 1]) {
      const wing = buildWing(m, { width: 3.0, length: 8.0, panels: 5, yoke: 0.9, tile: 0.5 });
      for (const z of [2.6, 5.8]) { // radar antennas, mounted across the wing
        strut(wing, m.metal, [-2.5, -0.12, z], [2.5, -0.12, z], 0.022);
        for (const x of [-1.1, 1.1]) strut(wing, m.dark, [x, -0.12, z], [x, -0.01, z], 0.035);
      }
      wing.position.set(0, -0.6, side * 0.78);
      wing.rotation.set(0, side === 1 ? 0 : Math.PI, side * -1.0); // cells look the way the dish does: from Jupiter, Sun and Earth are side by side
      g.add(wing);
    }
    strut(g, m.metal, [-0.4, -1.8, 0.3], [-1.4, -4.0, 0.9], 0.03); // magnetometer boom
    for (const t of [0.5, 0.75, 1]) box(g, m.foilGold, 0.14, 0.12, 0.14, -0.4 - 1.0 * t, -1.8 - 2.2 * t, 0.3 + 0.6 * t);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2, ca = Math.cos(a), sa = Math.sin(a);
      nozzle(g, m, 0.14, 0.2, [0.4 * ca, -1.82, 0.4 * sa], [0, -1, 0]);
      thrusters(g, m, [0.8 * ca, -1.6, 0.8 * sa], [ca, -0.6, sa], 1.8);
    }
    tracker(g, m, [0.5, 2.22, -0.6], [0.4, 1, -0.6], 1.6);
    whip(g, m, [-0.6, 2.2, 0.6], [-0.3, 1, 0.3], 0.6, 0.012);
  },

  /**
   * Lucy: a small body between two round solar arrays more than seven metres across, each
   * opened like a paper fan. The dish faces the same way as the cells; the cameras are on a
   * platform that swivels, at one end. 1 unit = 1 m.
   */
  lucy(g, m) {
    const c = aimed(g, [0, 0, 0], [0.42, 0.9, 0]); // leaning, so the two great discs are not seen edge-on
    bus(c, m.foilGold, 1.6, 1.3, 1.5, { bevel: 0.08 });
    bus(c, m.foilBlack, 1.64, 0.3, 1.54, { y: -0.42, bevel: 0.04 });
    cyl(c, m.metal, 0.2, 0.28, 0.16, 0, 0.72, 0, 'y', false, 14);
    dish(c, m, 1.0, [0, 0.78, 0], [0, 1, 0]);
    for (const s of [-1, 1]) {
      const array = fan(m, 2.9, 10, m.cellsBlue, 0.5);
      array.position.set(0, 0.15, s * 3.9);
      c.add(array);
      strut(c, m.dark, [0, -0.1, s * 0.75], [0, 0.06, s * 3.9], 0.05); // the arm reaches the hub from behind
      cyl(c, m.metal, 0.12, 0.12, 0.2, 0, -0.1, s * 0.82, 'z', false, 12);
    }
    // Instrument platform on its two-axis neck.
    strut(c, m.metal, [0.8, -0.1, 0], [1.1, -0.2, 0], 0.07);
    bus(c, m.foilBlack, 0.5, 0.5, 0.8, { x: 1.3, y: -0.25, bevel: 0.04, tile: 0.4 });
    scope(c, m, m.white, 0.14, 0.55, [1.3, -0.5, 0.2], [0.25, -1, 0]);
    scope(c, m, m.foilGold, 0.1, 0.35, [1.3, -0.5, -0.2], [0.25, -1, 0]);
    box(c, m.radiator, 0.4, 0.02, 0.6, 1.4, 0.02, 0);
    nozzle(c, m, 0.18, 0.28, [-0.8, -0.1, 0], [-1, 0, 0]);
    for (const [y, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) thrusters(c, m, [-0.78, y * 0.55, z * 0.65], [-1, y * 0.6, z * 0.6], 1.3);
    tracker(c, m, [-0.5, 0.66, 0.5], [-0.5, 1, 0.5], 1.3);
    whip(c, m, [0.6, 0.66, -0.6], [0.3, 1, -0.3], 0.5, 0.012);
  },

  /**
   * Psyche: a box the size of a van between two cross-shaped solar wings, five panels each,
   * that feed its electric thrusters. Dish on one side, two short booms (magnetometer,
   * gamma-ray detector) on top. 1 unit = 1 m.
   */
  psyche(g, m) {
    bus(g, m.foilBlack, 2.2, 2.6, 2.2, { bevel: 0.1 });
    bus(g, m.foilGold, 2.26, 0.5, 2.26, { y: 0.75, bevel: 0.05 });
    bus(g, m.dark, 2.24, 0.06, 2.24, { y: -1.32, bevel: 0.02 });
    for (const side of [-1, 1]) {
      const length = 7.2, width = 2.3, yoke = 1.3, each = (length - 2 * width * 0.03) / 3;
      const wing = buildWing(m, { width, length, panels: 3, yoke, tile: 0.5 });
      const middle = yoke + each * 1.5 + width * 0.03;
      for (const x of [-1, 1]) { // the two side panels that make the cross
        const extra = solarPanel(m, width, each, m.cellsBlue, m.panelBack, 0.5);
        extra.position.set(x * width * 1.03, 0, middle);
        wing.add(extra);
        for (const z of [-0.7, 0.7]) cyl(wing, m.metal, 0.04, 0.04, 0.28, x * width * 0.515, 0, middle + z, 'x', false, 8);
      }
      wing.position.set(0, 0.2, side * 1.1);
      wing.rotation.set(0, side === 1 ? 0 : Math.PI, side * 0.45);
      g.add(wing);
    }
    cyl(g, m.metal, 0.3, 0.4, 0.2, 1.18, 0.3, 0, 'x', false, 16);
    dish(g, m, 1.0, [1.26, 0.3, 0], [1, 0.3, 0]);
    plate(g, m, m.mirror, 1.5, 1.3, [-1.104, -0.3, 0], [-1, 0, 0], 5);
    for (const z of [-0.6, 0.6]) { // electric thrusters: xenon, thrown out fast enough to glow blue
      cyl(g, m.dark, 0.24, 0.24, 0.12, -0.5, -1.4, z, 'y', false, 20);
      hoop(g, m.metal, 0.2, 0.03, -0.5, -1.47, z, 'y', 20);
      cyl(g, m.lens, 0.1, 0.1, 0.02, -0.5, -1.465, z, 'y', false, 14);
    }
    strut(g, m.metal, [-0.7, 1.0, 0.7], [-1.3, 2.9, 1.2], 0.03); // magnetometer boom
    for (const t of [0.6, 1]) box(g, m.foilGold, 0.14, 0.12, 0.14, -0.7 - 0.6 * t, 1.0 + 1.9 * t, 0.7 + 0.5 * t);
    strut(g, m.metal, [0.7, 1.0, -0.7], [1.1, 2.6, -1.2], 0.03); // gamma-ray and neutron detector
    cyl(g, m.foilGold, 0.16, 0.16, 0.36, 1.12, 2.75, -1.24, 'y', false, 14);
    scope(g, m, m.foilSilver, 0.2, 0.6, [0.2, 1.0, 0.5], [0.1, 1, 0.1]); // laser link to Earth, tried out on the way
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) thrusters(g, m, [x * 1.08, -1.2, z * 1.08], [x, -0.6, z], 1.8);
    tracker(g, m, [-0.6, 1.0, -0.6], [-0.5, 1, -0.5], 1.8);
    whip(g, m, [0.8, 1.0, 0.8], [0.3, 1, 0.3], 0.7, 0.014);
  },

  /**
   * Asteroid sample-return craft (OSIRIS-REx, Hayabusa2): a foil box with two wings and a
   * dish, a long jointed arm that touches the asteroid for a few seconds, and the capsule
   * that carries the sample back through the Earth's atmosphere. 1 unit = 1 m.
   */
  samplereturn(g, m) {
    bus(g, m.foilGold, 2.0, 2.2, 2.0, { bevel: 0.1 });
    bus(g, m.foilBlack, 2.06, 0.3, 2.06, { y: -0.85, bevel: 0.04 });
    bus(g, m.dark, 2.1, 0.06, 2.1, { y: -1.12, bevel: 0.02 }); // the deck that faces the asteroid
    cyl(g, m.metal, 0.22, 0.3, 0.14, 0, 1.15, 0, 'y', false, 14);
    dish(g, m, 1.0, [0, 1.2, 0], [0.12, 1, 0]);
    wingPair(g, m, { width: 2.0, length: 2.6, panels: 2, root: 1.0, y: 0.3, yoke: 0.5, tilt: 0.45, tile: 0.4 });
    // Return capsule, blunt heat shield outwards.
    const capsule = aimed(g, [1.0, -0.15, 0], [1, 0, 0]);
    lathe(capsule, m.white, [[0.26, 0], [0.43, 0.16]], 0, 0, 0, 'y', 24);
    lathe(capsule, m.foam, [[0.43, 0.16], [0.36, 0.3], [0.2, 0.4], [0, 0.44]], 0, 0, 0, 'y', 24);
    hoop(capsule, m.dark, 0.43, 0.014, 0, 0.16, 0, 'y', 24);
    cyl(capsule, m.dark, 0.26, 0.26, 0.04, 0, 0, 0, 'y', false, 16);
    // Sampling arm: shoulder, elbow, wrist, and a head like a car's air filter.
    const shoulder: V3 = [0.5, -1.15, 0.3], elbow: V3 = [1.3, -2.25, 0.35], wrist: V3 = [0.9, -3.3, 0.3];
    strut(g, m.white, shoulder, elbow, 0.05);
    strut(g, m.white, elbow, wrist, 0.05);
    for (const p of [shoulder, elbow, wrist]) ball(g, m.metal, 0.09, p[0], p[1], p[2]);
    cyl(g, m.metal, 0.24, 0.24, 0.1, wrist[0], wrist[1] - 0.13, wrist[2], 'y', false, 20);
    cyl(g, m.dark, 0.18, 0.18, 0.02, wrist[0], wrist[1] - 0.185, wrist[2], 'y', false, 20);
    for (const s of [-1, 1]) ball(g, m.white, 0.07, wrist[0] + s * 0.12, wrist[1] + 0.02, wrist[2] + 0.1, 1, 1.6, 1); // nitrogen bottles: the puff that stirs up the gravel
    scope(g, m, m.white, 0.15, 0.5, [-0.5, -1.15, -0.4], [0, -1, 0]); // cameras that mapped the asteroid first
    scope(g, m, m.foilSilver, 0.09, 0.3, [-0.55, -1.15, 0.3], [0, -1, 0]);
    bus(g, m.foilGold, 0.4, 0.3, 0.4, { x: 0.1, y: -1.3, z: -0.5, bevel: 0.03, tile: 0.4 }); // laser altimeter
    for (const [y, z] of [[0.35, 0.35], [0.35, -0.35], [-0.35, 0.35], [-0.35, -0.35]]) nozzle(g, m, 0.1, 0.15, [-1.0, y, z], [-1, 0, 0]);
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) thrusters(g, m, [x * 0.98, 1.0, z * 0.98], [x, 0.6, z], 1.7);
    tracker(g, m, [-0.6, 1.1, 0.6], [-0.5, 1, 0.5], 1.6);
    helix(g, m, [0.7, 1.1, -0.7], [0, 1, 0], 0.2, 0.06);
  },

  /**
   * BepiColombo on its way to Mercury: three craft stacked in a row. At the back the transfer
   * module, an ion-engine tug with two fifteen-metre wings; in the middle the European orbiter
   * with its radiator and single array; in front the Japanese orbiter riding inside a conical
   * sunshade. All wrapped in white high-temperature blankets. 1 unit = 1 m.
   */
  bepi(g, m) {
    bus(g, m.blanket, 2.0, 2.6, 2.8, { x: -1.6, bevel: 0.12, tile: 0.6 }); // transfer module
    box(g, m.dark, 0.08, 2.3, 2.5, -2.63, 0, 0);
    for (const [y, z] of [[0.6, 0.6], [0.6, -0.6], [-0.6, 0.6], [-0.6, -0.6]]) { // four ion engines
      cyl(g, m.dark, 0.27, 0.27, 0.14, -2.72, y, z, 'x', false, 20);
      hoop(g, m.metal, 0.25, 0.03, -2.8, y, z, 'x', 20);
      cyl(g, m.lens, 0.16, 0.16, 0.02, -2.795, y, z, 'x', false, 16);
    }
    wingPair(g, m, { width: 2.0, length: 8.0, panels: 5, root: 1.4, x: -1.6, yoke: 1.1, tilt: 0.5, tile: 0.5 });
    cyl(g, m.dark, 0.7, 0.8, 0.2, -0.55, 0, 0, 'x', false, 20); // the ring that will let the tug go
    bus(g, m.blanket, 1.7, 2.2, 2.2, { x: 0.38, bevel: 0.1, tile: 0.6 }); // planetary orbiter
    const cooler = box(g, m.radiator, 1.9, 2.3, 0.05, 0.38, 0, -1.2); // its radiator, shaded from the hot planet by louvres
    tileUV(cooler.geometry, 1, 5);
    for (let k = -3; k <= 3; k++) box(g, m.white, 1.9, 0.02, 0.14, 0.38, k * 0.33, -1.3).rotation.x = -0.6;
    const array = buildWing(m, { width: 1.3, length: 4.6, panels: 3, yoke: 0.7, tile: 0.4 });
    array.position.set(0.38, 1.1, 0.4);
    array.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)));
    g.add(array);
    strut(g, m.dark, [0.9, 1.1, -0.5], [1.15, 1.75, -1.0], 0.04);
    dish(g, m, 0.5, [1.2, 1.8, -1.05], [0.4, 0.6, -0.7]);
    strut(g, m.metal, [0.9, -1.1, 0.8], [1.5, -2.5, 1.3], 0.025); // magnetometer boom
    box(g, m.foilGold, 0.12, 0.1, 0.12, 1.52, -2.55, 1.32);
    // Sunshade and, inside it, the eight-sided spinning orbiter.
    cyl(g, m.white, 0.8, 1.08, 1.5, 2.0, 0, 0, 'x', true, 28);
    cyl(g, m.dish, 0.8, 1.08, 1.5, 2.0, 0, 0, 'x', true, 28);
    hoop(g, m.metal, 0.8, 0.02, 2.75, 0, 0, 'x', 28);
    orient(prism(g, m.cellsBlue, 8, 0.6, 0.6, 0.75, 2.15, 0, 0, 0.3), 'x');
    cyl(g, m.dark, 0.6, 0.6, 0.03, 2.54, 0, 0, 'x', false, 8);
    cyl(g, m.metal, 0.04, 0.04, 0.5, 2.8, 0, 0, 'x', false, 8);
    cyl(g, m.white, 0.16, 0.16, 0.05, 3.05, 0, 0, 'x', false, 14);
    for (const [y, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) thrusters(g, m, [-2.5, y * 1.25, z * 1.35], [-0.5, y, z], 1.8);
    tracker(g, m, [0.6, 1.12, -0.8], [0.3, 1, -0.5], 1.6);
  },

  /**
   * Parker Solar Probe: everything hides in the shadow of a carbon heat shield 2.3 m across,
   * white on the face that looks at the Sun (below, −Y). Behind it a truss wrapped in black
   * cooling radiators, the tapered six-sided body, and two small solar paddles folded back
   * until only their tips catch the light. Four antennas reach out past the shield. 1 unit = 1 m.
   */
  parker(g, m) {
    cyl(g, m.white, 1.15, 1.15, 0.17, 0, -1.4, 0, 'y', false, 40);
    cyl(g, m.carbon, 1.12, 1.12, 0.02, 0, -1.31, 0, 'y', false, 40); // its back: bare carbon foam
    for (let k = 0; k < 6; k++) {
      const a = (k * TAU) / 6;
      strut(g, m.metal, [0.95 * Math.cos(a), -1.3, 0.95 * Math.sin(a)], [0.45 * Math.cos(a + 0.52), -0.5, 0.45 * Math.sin(a + 0.52)], 0.02);
      strut(g, m.metal, [0.95 * Math.cos(a), -1.3, 0.95 * Math.sin(a)], [0.45 * Math.cos(a - 0.52), -0.5, 0.45 * Math.sin(a - 0.52)], 0.02);
    }
    prism(g, m.carbon, 4, 0.46, 0.74, 0.62, 0, -0.9, 0, 0.6, Math.PI / 4); // radiators that cool the water that cools the solar cells
    for (const y of [-1.2, -0.6]) prism(g, m.metal, 4, y < -1 ? 0.76 : 0.48, y < -1 ? 0.76 : 0.48, 0.025, 0, y, 0, 0.6, Math.PI / 4);
    prism(g, m.foilGold, 6, 0.4, 0.5, 1.3, 0, 0.2, 0, 0.5);
    prism(g, m.dark, 6, 0.53, 0.53, 0.06, 0, -0.47, 0);
    prism(g, m.foilBlack, 6, 0.42, 0.42, 0.08, 0, 0.88, 0);
    plate(g, m, m.mirror, 0.3, 0.7, [0.39, 0.25, 0.225], [0.866, 0.07, 0.5], 5);
    for (const s of [-1, 1]) {
      // one paddle: hinged low on the body, swept back, cells facing outwards and a little down
      const phi = 1.05, c = Math.cos(phi), sn = Math.sin(phi);
      const along = new THREE.Vector3(0, sn, s * c), normal = new THREE.Vector3(0, -c, s * sn), across = new THREE.Vector3(-s, 0, 0);
      const hinge = new THREE.Vector3(0, -0.35, s * 0.5);
      const paddle = solarPanel(m, 0.69, 1.12, m.cellsBlue, m.panelBack, 0.23);
      paddle.position.copy(hinge).addScaledVector(along, 0.78);
      paddle.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, normal, along));
      g.add(paddle);
      const root = hinge.clone().addScaledVector(along, 0.22);
      strut(g, m.metal, [hinge.x, hinge.y, hinge.z], [root.x, root.y, root.z], 0.03);
    }
    dish(g, m, 0.3, [0.46, 0.45, 0.1], [1, 0.3, 0.2]);
    strut(g, m.metal, [-0.1, 0.9, 0], [-0.4, 2.5, 0.15], 0.02); // magnetometer boom, in the shadow
    for (const t of [0.45, 0.75, 1]) box(g, m.foilGold, 0.1, 0.08, 0.1, -0.1 - 0.3 * t, 0.9 + 1.6 * t, 0.15 * t);
    strut(g, m.metal, [0.5, -0.5, 0.3], [1.2, -1.27, 0.35], 0.02);
    cyl(g, m.goldPlate, 0.09, 0.07, 0.2, 1.22, -1.38, 0.35, 'y', false, 12); // the one instrument that looks round the shield, straight at the Sun
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      whip(g, m, [0.8 * Math.cos(a), -1.24, 0.8 * Math.sin(a)], [Math.cos(a), -0.1, Math.sin(a)], 1.5, 0.014); // electric-field antennas, glowing hot in full sunlight
      thrusters(g, m, [0.46 * Math.cos(a), 0.7, 0.46 * Math.sin(a)], [Math.cos(a), 0.5, Math.sin(a)], 0.9);
    }
    tracker(g, m, [-0.25, 0.92, 0.2], [-0.5, 1, 0.5], 0.9);
    helix(g, m, [0.15, 0.92, -0.15], [0, 1, 0], 0.12, 0.04);
  },

  /**
   * Solar Orbiter: a black heat shield with small windows, held a little way off the body it
   * shades (the Sun is below, −Y). Two wings that it turns nearly edge-on when it is close
   * in, a dish on an arm, a long instrument boom in the shadow and three antennas round the
   * shield's edge. 1 unit = 1 m.
   */
  solarorbiter(g, m) {
    bus(g, m.carbon, 3.5, 0.18, 3.3, { y: -1.46, bevel: 0.03 });
    for (const s of [-1, 1]) { // titanium edging
      box(g, m.metal, 3.5, 0.05, 0.05, 0, -1.36, s * 1.63);
      box(g, m.metal, 0.05, 0.05, 3.3, s * 1.73, -1.36, 0);
    }
    bus(g, m.foilBlack, 2.5, 0.08, 2.4, { y: -1.3, bevel: 0.02 });
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [0, 0]]) cyl(g, m.metal, 0.05, 0.05, 0.14, x * 1.0, -1.24, z * 1.0, 'y', false, 8); // stand-offs: only these touch the hot shield
    for (const [x, z, r] of [[0.8, 0.6, 0.17], [0.3, -0.7, 0.13], [-0.6, 0.5, 0.2], [-0.9, -0.5, 0.11], [0.9, -0.3, 0.09]]) {
      cyl(g, m.lens, r, r, 0.012, x, -1.554, z, 'y', false, 16); // a window for one telescope
      hoop(g, m.metal, r, 0.02, x, -1.556, z, 'y', 16);
      box(g, m.metal, r * 2.1, 0.012, r * 2.1, x - r * 2.3, -1.56, z); // its sliding door
    }
    bus(g, m.foilBlack, 2.2, 2.3, 2.2, { y: -0.05, bevel: 0.1 });
    bus(g, m.foilGold, 2.26, 0.6, 2.26, { y: 0.55, bevel: 0.05 });
    bus(g, m.dark, 2.24, 0.05, 2.24, { y: 1.12, bevel: 0.02 });
    for (const s of [-1, 1]) plate(g, m, m.radiator, 1.5, 1.0, [s * 1.104, -0.5, 0], [s, 0, 0], 3);
    plate(g, m, m.mirror, 1.0, 0.9, [0.3, 1.148, 0.3], [0, 1, 0], 5);
    wingPair(g, m, { width: 1.3, length: 3.9, panels: 3, root: 1.1, y: 0.1, yoke: 0.8, tilt: -1.15, tile: 0.35 });
    strut(g, m.metal, [-0.7, 1.14, 0.3], [-1.1, 3.4, 0.55], 0.03); // instrument boom
    for (const t of [0.5, 0.8, 1]) box(g, m.foilGold, 0.14, 0.12, 0.14, -0.7 - 0.4 * t, 1.14 + 2.26 * t, 0.3 + 0.25 * t);
    for (const d of [[1, 0, 0], [-0.57, 0, 0.82], [-0.57, 0, -0.82]] as V3[]) {
      strut(g, m.dark, [d[0] * 1.0, -0.9, d[2] * 1.0], [d[0] * 1.6, -1.25, d[2] * 1.55], 0.03);
      whip(g, m, [d[0] * 1.6, -1.25, d[2] * 1.55], d, 2.4, 0.016); // radio and plasma-wave antennas
    }
    strut(g, m.dark, [-1.1, 0.6, -0.5], [-1.85, 0.9, -0.9], 0.035);
    dish(g, m, 0.55, [-1.9, 0.95, -0.92], [-0.6, 0.6, -0.4]);
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) thrusters(g, m, [x * 1.08, 1.05, z * 1.08], [x, 0.6, z], 1.8);
    tracker(g, m, [0.7, 1.15, -0.7], [0.4, 1, -0.5], 1.7);
    helix(g, m, [-0.6, 1.15, -0.7], [0, 1, 0], 0.2, 0.06);
  },
} satisfies Partial<Record<ModelKind, Builder>>;
