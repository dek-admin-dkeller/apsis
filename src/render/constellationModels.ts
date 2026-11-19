/**
 * 3D models of particular satellite families common enough in the catalogue to be worth a
 * shape of their own, instead of the generic ones in satModels.ts: Starlink V2 Mini (most of
 * the Starlinks now flying), Amazon Kuiper, Iridium NEXT, O3b, Galileo, GLONASS-M and the
 * GOES-R weather satellites. One builder per kind, made from the kit in modelParts.ts and
 * handed to satModels.ts, which merges, centres, scales and caches every model the same way.
 * describe.ts (SHAPES) says which catalogue names get which.
 *
 * Model axes as for every satellite: +X = direction of travel, −Y = towards the Earth, solar
 * wings along ±Z. Proportions follow the real craft; long wings and booms are shortened a
 * little, as elsewhere, so the body is not a dot in its own thumbnail.
 */

import * as THREE from 'three';
import type { ModelKind } from '../data/describe.ts';
import {
  TAU, arrayPanel, ball, box, buildWing, bus, cyl, dish, helix, hoop, lattice, nozzle, plate, prism, slab, strut, thrusters, tileUV, tracker, whip, wingPair,
  type Builder, type Materials,
} from './modelParts.ts';

/** An optical inter-satellite link terminal: a small telescope in a gimballed dome on a short stalk. */
function laserTerminal(g: THREE.Group, m: Materials, x: number, y: number, z: number, up = 1, size = 1): void {
  cyl(g, m.dark, 0.04 * size, 0.045 * size, 0.05 * size, x, y + up * 0.025 * size, z, 'y', false, 12);
  ball(g, m.lens, 0.04 * size, x, y + up * 0.065 * size, z);
  hoop(g, m.metal, 0.041 * size, 0.006 * size, x, y + up * 0.055 * size, z, 'y', 12);
}

export const CONSTELLATION_BUILDERS = {
  /**
   * Starlink V2 Mini: a bigger, thicker flat bus than the first Starlinks (4.1 × 2.7 m, about
   * 800 kg), two long solar wings instead of one, larger phased arrays and an E-band backhaul
   * panel on the Earth face, three laser terminals, an argon Hall thruster.
   */
  starlinkv2(g, m) {
    bus(g, m.hull, 1.6, 0.16, 1.06, { bevel: 0.028, tile: 0.6 });
    box(g, m.dark, 1.54, 0.05, 1.08); // edge frame
    for (const [x, z] of [[-0.48, -0.24], [-0.02, -0.24], [-0.48, 0.24], [-0.02, 0.24]]) plate(g, m, m.array, 0.42, 0.42, [x, -0.082, z], [0, -1, 0], 5); // user beams
    plate(g, m, m.array, 0.36, 0.26, [0.5, -0.082, -0.24], [0, -1, 0], 9); // E-band backhaul to the ground
    dish(g, m, 0.1, [0.52, -0.13, 0.26], [0.25, -1, 0.2]); // gateway dish
    for (const [x, z] of [[0.72, 0.44], [0.72, -0.44], [-0.72, 0.44]]) laserTerminal(g, m, x, 0.08, z);
    bus(g, m.foilGold, 0.38, 0.09, 0.34, { x: 0.3, y: 0.12, z: 0.18, bevel: 0.02, tile: 0.4 }); // argon tank cover
    plate(g, m, m.radiator, 0.55, 0.36, [-0.35, 0.081, -0.22], [0, 1, 0], 3);
    tracker(g, m, [0.28, 0.08, -0.3], [0.3, 1, -0.5], 0.8);
    tracker(g, m, [0.48, 0.08, -0.3], [0.3, 1, -0.5], 0.8);
    nozzle(g, m, 0.055, 0.08, [-0.8, 0, 0.2], [-1, 0, 0]); // Hall thruster
    // the two wings, each about 13 m long in life (shortened here), on masts from the bus's long edges
    wingPair(g, m, { width: 1.1, length: 3.3, panels: 6, root: 0.53, yoke: 0.3, tilt: 0.25, tile: 0.26 });
  },

  /**
   * Amazon Kuiper: a compact box, its Earth face given over to two large phased-array antennas
   * for the user beams and a gateway antenna, one long solar wing, laser links to its neighbours.
   * (Amazon has published few pictures of the production satellites: the layout is approximate.)
   */
  kuiper(g, m) {
    bus(g, m.foilBlack, 1.15, 0.55, 0.85, { bevel: 0.04 });
    bus(g, m.foilSilver, 1.19, 0.12, 0.89, { y: 0.22, bevel: 0.02 });
    for (const s of [-1, 1]) plate(g, m, m.mirror, 0.8, 0.36, [0, -0.04, s * 0.426], [0, 0, s], 5);
    for (const x of [-0.28, 0.28]) { // user-beam arrays
      const antenna = arrayPanel(m, 0.5, 0.62, 12);
      antenna.position.set(x, -0.3, 0);
      antenna.rotation.x = Math.PI / 2;
      g.add(antenna);
    }
    dish(g, m, 0.12, [0, -0.36, 0.34], [0, -1, 0.3]); // gateway
    for (const [x, z] of [[0.55, 0.3], [-0.55, -0.3]]) laserTerminal(g, m, x, 0.28, z);
    tracker(g, m, [0.3, 0.28, -0.25], [0.4, 1, -0.5]);
    nozzle(g, m, 0.05, 0.07, [-0.58, 0.05, 0.2], [-1, 0, 0]);
    whip(g, m, [-0.4, 0.28, 0.3], [0, 1, 0], 0.3);
    const wing = buildWing(m, { width: 0.95, length: 3.0, panels: 5, yoke: 0.3, tile: 0.24 });
    wing.position.set(0, 0.05, 0.43);
    wing.rotation.z = 0.35;
    g.add(wing);
  },

  /**
   * Iridium NEXT: a tapered body, a big flat L-band antenna on the Earth face that makes the
   * phone beams, Ka-band crosslink antennas at both ends talking to the satellites ahead and
   * behind, two gimballed feeder dishes for the ground, two wings.
   */
  iridium(g, m) {
    const outline: [number, number][] = [[-0.85, -0.42], [0.85, -0.42], [0.98, -0.3], [0.98, 0.3], [0.85, 0.42], [-0.85, 0.42], [-0.98, 0.3], [-0.98, -0.3]];
    slab(g, m.foilSilver, outline, 0.62, 0, 0, 0, 0.6);
    slab(g, m.foilGold, outline.map(([x, z]) => [x * 0.95, z * 0.92] as const), 0.08, 0, 0.35, 0, 0.5);
    plate(g, m, m.radiator, 1.2, 0.5, [0, 0.392, 0], [0, 1, 0], 3);
    // main mission antenna: a 1.9 m square of radiating elements, slightly proud of the body
    const mma = arrayPanel(m, 1.5, 0.78, 14, m.mirror);
    mma.position.set(0, -0.35, 0);
    mma.rotation.x = Math.PI / 2;
    g.add(mma);
    for (const s of [-1, 1]) {
      box(g, m.white, 0.06, 0.26, 0.42, s * 1.02, 0.02, 0); // crosslink horn panels, fore and aft
      for (const z of [-0.12, 0.12]) cyl(g, m.metal, 0.05, 0.08, 0.08, s * 1.08, 0.02, z, 'x', false, 10).rotation.z = -s * Math.PI / 2;
      strut(g, m.dark, [s * 0.7, -0.32, s * 0.3], [s * 0.78, -0.5, s * 0.34], 0.014);
      dish(g, m, 0.12, [s * 0.78, -0.52, s * 0.34], [s * 0.2, -1, 0]); // feeder links
    }
    wingPair(g, m, { width: 0.75, length: 1.7, panels: 2, root: 0.43, y: 0.1, yoke: 0.28, tilt: 0.4 });
    box(g, m.foilGold, 0.36, 0.14, 0.3, -0.5, 0.42, 0.1); // hosted payload (aircraft tracking)
    tracker(g, m, [0.5, 0.4, -0.2], [0.4, 1, -0.4]);
    nozzle(g, m, 0.05, 0.07, [-0.95, 0.15, 0.2], [-1, 0, 0]);
    whip(g, m, [0.6, 0.39, 0.25], [0.2, 1, 0], 0.3);
  },

  /**
   * O3b (medium Earth orbit, 8,000 km): a gold box whose Earth face is crowded with small
   * steerable dishes, each following one customer's ground station across the sky, two wings.
   */
  o3b(g, m) {
    bus(g, m.foilGold, 1.0, 0.9, 0.9, { bevel: 0.06 });
    for (const s of [-1, 1]) plate(g, m, m.mirror, 0.75, 0.6, [0, 0.05, s * 0.452], [0, 0, s], 5);
    bus(g, m.foilBlack, 1.08, 0.06, 0.98, { y: -0.47, bevel: 0.015 }); // antenna deck
    for (let i = 0; i < 5; i++) for (const row of [-1, 1]) {
      const x = -0.4 + i * 0.2, z = row * 0.26, lean = (i - 2) * 0.12;
      cyl(g, m.metal, 0.02, 0.03, 0.08, x, -0.53, z, 'y', false, 8); // gimbal post
      dish(g, m, 0.085, [x, -0.6, z], [lean, -1, row * 0.25]);
    }
    for (const s of [-1, 1]) { // the two gateway antennas, on arms
      strut(g, m.dark, [s * 0.5, -0.4, 0], [s * 0.7, -0.62, 0], 0.016);
      dish(g, m, 0.14, [s * 0.72, -0.66, 0], [s * 0.3, -1, 0]);
    }
    wingPair(g, m, { width: 0.8, length: 2.0, panels: 2, root: 0.45, y: 0.1, yoke: 0.3, tilt: 0.3 });
    nozzle(g, m, 0.08, 0.12, [0, 0.46, 0], [0, 1, 0]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) thrusters(g, m, [sx * 0.44, 0.44, sz * 0.38], [sx, 1, sz]);
    tracker(g, m, [0.3, 0.45, 0.2], [0.5, 1, 0.4]);
  },

  /**
   * Galileo: a foil box with two wings; on its Earth face the big flat navigation antenna (a
   * honeycomb of white radiating cups), the search-and-rescue antenna, a C-band horn and a
   * panel of laser retro-reflectors.
   */
  galileo(g, m) {
    bus(g, m.foilGold, 1.1, 1.0, 0.9, { bevel: 0.05 });
    for (const s of [-1, 1]) plate(g, m, m.mirror, 0.7, 0.75, [s * 0.552, 0.05, 0], [s, 0, 0], 5); // clock radiators
    bus(g, m.foilBlack, 1.14, 0.05, 0.94, { y: -0.52, bevel: 0.012 });
    // navigation antenna: 19 cups in a hexagon, on a dark plate
    prism(g, m.dark, 6, 0.36, 0.36, 0.03, 0.12, -0.56, 0, 0.5);
    for (let ring = 0; ring <= 2; ring++) {
      const count = ring === 0 ? 1 : ring * 6;
      for (let k = 0; k < count; k++) {
        const a = (k * TAU) / Math.max(1, count) + (ring === 2 ? Math.PI / 12 : 0);
        cyl(g, m.white, 0.045, 0.05, 0.05, 0.12 + ring * 0.12 * Math.cos(a), -0.6, ring * 0.12 * Math.sin(a), 'y', false, 10);
      }
    }
    helix(g, m, [-0.38, -0.55, 0.25], [0, -1, 0], 0.32, 0.06); // search-and-rescue antenna
    cyl(g, m.metal, 0.08, 0.05, 0.12, -0.38, -0.6, -0.25, 'y', false, 4); // C-band horn
    plate(g, m, m.array, 0.2, 0.16, [0.45, -0.552, -0.32], [0, -1, 0], 22); // laser retro-reflectors
    wingPair(g, m, { width: 0.75, length: 2.1, panels: 2, root: 0.45, yoke: 0.3, tilt: 0.3 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) thrusters(g, m, [sx * 0.5, 0.5, sz * 0.4], [sx, 1, sz]);
    tracker(g, m, [-0.3, 0.5, 0.2], [-0.4, 1, 0.4]);
    helix(g, m, [0.3, 0.5, -0.2], [0, 1, 0], 0.12, 0.04);
  },

  /**
   * GLONASS-M: the electronics live in a pressurised cylinder (the long axis points at the
   * Earth), wrapped by a band of radiator louvres; a ring of helix antennas on the Earth end,
   * two big wings on booms.
   */
  glonass(g, m) {
    cyl(g, m.foilSilver, 0.36, 0.36, 1.25, 0, 0, 0, 'y', false, 28);
    tileUV(cyl(g, m.radiator, 0.37, 0.37, 0.45, 0, 0.2, 0, 'y', true, 28).geometry, 6, 1); // louvre band
    hoop(g, m.dark, 0.37, 0.012, 0, -0.62, 0, 'y', 28);
    cyl(g, m.foilGold, 0.36, 0.3, 0.2, 0, 0.72, 0, 'y', false, 28); // instrument end
    cyl(g, m.foilBlack, 0.42, 0.42, 0.06, 0, -0.66, 0, 'y', false, 28); // antenna deck
    for (let k = 0; k < 12; k++) {
      const a = (k * TAU) / 12;
      helix(g, m, [0.3 * Math.cos(a), -0.69, 0.3 * Math.sin(a)], [0, -1, 0], 0.22, 0.045);
    }
    helix(g, m, [0, -0.69, 0], [0, -1, 0], 0.28, 0.05);
    for (let k = 0; k < 8; k++) { // retro-reflector blocks round the deck
      const a = (k * TAU) / 8 + 0.2;
      box(g, m.lens, 0.06, 0.03, 0.06, 0.4 * Math.cos(a), -0.7, 0.4 * Math.sin(a));
    }
    for (const s of [-1, 1]) {
      strut(g, m.metal, [0, 0.1, s * 0.36], [0, 0.1, s * 0.7], 0.025);
      const wing = buildWing(m, { width: 0.95, length: 2.0, panels: 3, yoke: 0.05 });
      wing.position.set(0, 0.1, s * 0.7);
      wing.rotation.set(0, s === 1 ? 0 : Math.PI, s * 0.3);
      g.add(wing);
    }
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      thrusters(g, m, [0.34 * Math.cos(a), 0.68, 0.34 * Math.sin(a)], [Math.cos(a), 0.5, Math.sin(a)]);
    }
    tracker(g, m, [0.15, 0.82, 0], [0.3, 1, 0]);
  },

  /**
   * GOES-R (GOES 16 onwards): one long five-panel solar wing on a yoke, with the solar pointing
   * platform at its root carrying the Sun-watching instruments; the Advanced Baseline Imager
   * and the lightning mapper on the Earth face; a magnetometer on a long boom.
   */
  goes(g, m) {
    bus(g, m.foilBlack, 1.1, 1.2, 1.0, { bevel: 0.06 });
    bus(g, m.foilGold, 1.14, 0.25, 1.04, { y: 0.45, bevel: 0.03 });
    for (const s of [-1, 1]) plate(g, m, m.mirror, 0.8, 0.7, [s * 0.552, -0.05, 0], [s, 0, 0], 5);
    // Advanced Baseline Imager: a white box with its scan-mirror port and cooler
    bus(g, m.white, 0.55, 0.4, 0.55, { x: 0.15, y: -0.8, z: 0.05, bevel: 0.04 });
    plate(g, m, m.lens, 0.26, 0.2, [0.15, -0.8, 0.327], [0, 0, 1]);
    box(g, m.radiator, 0.4, 0.02, 0.36, 0.15, -0.55, -0.35).rotation.x = 0.4;
    // Geostationary Lightning Mapper: a camera looking straight down
    cyl(g, m.foilSilver, 0.12, 0.12, 0.3, -0.3, -0.75, -0.2, 'y', false, 16);
    cyl(g, m.lens, 0.1, 0.1, 0.01, -0.3, -0.905, -0.2, 'y', false, 16);
    dish(g, m, 0.2, [-0.35, -0.68, 0.32], [-0.1, -1, 0.2]); // data relay to the ground
    helix(g, m, [0.45, -0.62, -0.35], [0, -1, 0], 0.25, 0.05);
    // the solar wing on its long yoke, and the pointing platform that turns with it
    const yoke = 0.9;
    strut(g, m.metal, [0, 0.1, -0.5], [0, 0.1, -0.5 - yoke], 0.025);
    const platform = new THREE.Group();
    bus(platform, m.white, 0.36, 0.22, 0.3, { bevel: 0.03 });
    for (const x of [-0.08, 0.1]) cyl(platform, m.foilSilver, 0.06, 0.06, 0.24, x, 0.2, 0, 'y', false, 12);
    cyl(platform, m.lens, 0.05, 0.05, 0.01, -0.08, 0.325, 0, 'y', false, 12);
    platform.position.set(0, 0.1, -0.5 - yoke * 0.45);
    platform.rotation.z = 0.5;
    g.add(platform);
    const wing = buildWing(m, { width: 1.0, length: 3.4, panels: 5, yoke: 0.15 });
    wing.position.set(0, 0.1, -0.5 - yoke);
    wing.rotation.set(0, Math.PI, -0.5);
    g.add(wing);
    lattice(g, m.metal, [0.3, 0.55, 0.45], [0.9, 1.6, 1.9], 0.025, 12); // magnetometer boom
    box(g, m.dark, 0.08, 0.06, 0.06, 0.9, 1.6, 1.9);
    box(g, m.dark, 0.06, 0.05, 0.05, 0.62, 1.12, 1.25);
    nozzle(g, m, 0.12, 0.18, [0, 0.58, 0], [0, 1, 0]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) thrusters(g, m, [sx * 0.5, 0.55, sz * 0.45], [sx, 1, sz]);
    tracker(g, m, [0.3, 0.58, 0.3], [0.4, 1, 0.5]);
  },
} satisfies Partial<Record<ModelKind, Builder>>;
