/**
 * 3D models of particular missions beyond Earth orbit that used to borrow a family's shape:
 * the telescopes Roman, Gaia, Kepler and Spitzer; JUICE; Hayabusa2, Hera and MMX; the
 * solar-wind watchers DSCOVR, Wind and IMAP; Ulysses and Dawn. One builder per kind, made
 * from the kit in modelParts.ts and handed to satModels.ts, which merges, centres, scales
 * and caches every model the same way. Each is shown one at a time with its own card, so each
 * is drawn to be recognised: the part that makes the real craft unmistakable comes first.
 *
 * (Craft whose family model was drawn from them keep it: LRO the lunar orbiter, MRO the Mars
 * orbiter, OSIRIS-REx the sample-return craft, ACE the solar-wind monitor, Europa Clipper,
 * Euclid, Curiosity and Perseverance the rover.)
 *
 * Axes as for every craft: +X = direction of travel or the craft's front, +Y = up (away
 * from the body it orbits, or towards the Sun for the ones that face it). 1 unit = 1 m.
 */

import * as THREE from 'three';
import type { ModelKind } from '../data/describe.ts';
import {
  TAU, box, buildWing, bus, cyl, dish, helix, hoop, lattice, mesh, nozzle, plate, prism, scope, solarPanel, strut, thrusters, tileUV, tracker, whip, wingPair, rtg,
  type Builder, type Materials,
} from './modelParts.ts';

/** A flat wall of solar panels in the XY plane, cells facing −Z: `cols` × `rows` panels of w × h. */
function cellWall(g: THREE.Group, m: Materials, cols: number, rows: number, w: number, h: number, x: number, y: number, z: number, turn = 0): THREE.Group {
  const wall = new THREE.Group();
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const panel = solarPanel(m, w * 0.98, h * 0.98, m.cellsBlue, m.panelBack, 0.4);
    panel.rotation.x = -Math.PI / 2; // cells from +Y to −Z
    panel.position.set((i - (cols - 1) / 2) * w, (j - (rows - 1) / 2) * h, 0);
    wall.add(panel);
  }
  wall.position.set(x, y, z);
  wall.rotation.y = turn;
  g.add(wall);
  return wall;
}

/** A cylinder whose top is cut off at a slant (a telescope's sunshade): `slope` = rise per unit of x. */
function slantTube(g: THREE.Group, material: THREE.Material, r: number, h: number, slope: number, x: number, y: number, z: number, segments = 28): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(r, r, h, segments, 1, true);
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setY(i, p.getY(i) + p.getX(i) * slope);
  geometry.computeVertexNormals();
  tileUV(geometry, 4, 2);
  return mesh(g, geometry, material, x, y, z);
}

export const MISSION_BUILDERS = {
  /**
   * Nancy Grace Roman Space Telescope: a Hubble-sized 2.4 m mirror in a short barrel with its
   * aperture cover swung up like a lid, standing on a six-sided spacecraft bus, the whole of one
   * side shaded by a wall of solar panels that is also its sunshield.
   */
  roman(g, m) {
    prism(g, m.foilBlack, 6, 1.6, 1.6, 1.0, 0, 0.5, 0, 0.6); // spacecraft bus
    bus(g, m.foilSilver, 1.8, 0.9, 1.8, { y: 1.45, bevel: 0.08 }); // instrument carrier (the wide-field camera)
    const barrel = cyl(g, m.foilSilver, 1.4, 1.4, 2.6, 0, 3.2, 0, 'y', true, 32);
    tileUV(barrel.geometry, 6, 2);
    cyl(g, m.baffle, 1.36, 1.36, 2.6, 0, 3.2, 0, 'y', true, 32);
    cyl(g, m.lens, 1.2, 1.2, 0.03, 0, 2.0, 0, 'y', false, 32); // primary mirror
    for (const y of [2.0, 3.0, 4.45]) hoop(g, m.dark, 1.42, 0.03, 0, y, 0, 'y', 32);
    cyl(g, m.dark, 0.2, 0.2, 0.1, 0, 3.8, 0, 'y', false, 12); // secondary mirror on its spider
    for (let k = 0; k < 3; k++) strut(g, m.dark, [0, 3.8, 0], [1.36 * Math.cos((k * TAU) / 3 + 0.5), 3.8, 1.36 * Math.sin((k * TAU) / 3 + 0.5)], 0.02);
    const lid = new THREE.Group(); // aperture cover, hinged on the Sun side and raised as a shade
    cyl(lid, m.foilSilver, 1.45, 1.45, 0.06, 0, 0, 1.45, 'y', false, 32);
    lid.position.set(0, 4.5, -1.45);
    lid.rotation.x = -1.0;
    g.add(lid);
    // the solar-array sunshield: six panels on the Sun side (−Z), wider than the barrel
    cellWall(g, m, 3, 2, 1.55, 1.9, 0, 2.6, -1.85);
    for (const x of [-1.2, 1.2]) for (const y of [1.2, 3.6]) strut(g, m.metal, [x * 0.8, y, -1.2], [x, y, -1.82], 0.03);
    strut(g, m.metal, [1.4, 0.6, 0.6], [2.4, 0.2, 1.4], 0.04);
    dish(g, m, 0.85, [2.5, 0.15, 1.5], [0.6, -0.4, 0.6]); // high-gain antenna on its boom
    for (const a of [0.5, 2.6, 4.7]) thrusters(g, m, [1.55 * Math.cos(a), 0.2, 1.55 * Math.sin(a)], [Math.cos(a), -0.5, Math.sin(a)], 2);
    tracker(g, m, [-1.1, 1.95, 0.6], [-0.3, 1, 0.4], 2);
  },

  /**
   * Gaia: a disc of sunshield ten metres across that keeps its two telescopes in shade (its
   * sunny face carries the solar cells round the middle), and on top the service module with
   * the instruments under a dark thermal tent. It spins slowly, scanning the whole sky.
   */
  gaia(g, m) {
    cyl(g, m.foilSilver, 5.0, 5.0, 0.06, 0, 0, 0, 'y', false, 12); // the shield's twelve panels, top face
    const under = new THREE.CircleGeometry(5.0, 12);
    mesh(g, under, m.blanket, 0, -0.035, 0).rotation.x = Math.PI / 2;
    const cells = new THREE.RingGeometry(1.0, 3.2, 12, 1);
    tileUV(cells, 8, 8);
    mesh(g, cells, m.cellsBlue, 0, -0.04, 0).rotation.x = Math.PI / 2; // solar cells on the sunny side (−Y)
    for (let k = 0; k < 12; k++) { // the frames the shield unfolded on
      const a = (k * TAU) / 12 + Math.PI / 12;
      strut(g, m.dark, [0, 0.05, 0], [4.95 * Math.cos(a), 0.05, 4.95 * Math.sin(a)], 0.03);
    }
    hoop(g, m.dark, 5.0, 0.04, 0, 0, 0, 'y', 24);
    prism(g, m.foilGold, 12, 1.7, 1.75, 0.8, 0, 0.45, 0, 0.6); // service module
    prism(g, m.foilBlack, 12, 1.45, 1.7, 1.9, 0, 1.8, 0, 0.6); // the thermal tent over the instruments
    cyl(g, m.foilBlack, 1.45, 0.8, 0.45, 0, 2.95, 0, 'y', false, 12);
    for (const a of [0.4, 0.4 + Math.PI]) plate(g, m, m.baffle, 0.8, 0.5, [1.55 * Math.cos(a), 1.9, 1.55 * Math.sin(a)], [Math.cos(a), 0.05, Math.sin(a)], 1); // the two telescopes' openings
    plate(g, m, m.array, 0.9, 0.5, [0, -0.05, 2.2], [0, -1, 0], 6); // phased-array antenna, on the shady side of nothing: it sees Earth past the shield's edge
    for (let k = 0; k < 4; k++) thrusters(g, m, [1.7 * Math.cos(k * 1.57 + 0.8), 0.6, 1.7 * Math.sin(k * 1.57 + 0.8)], [Math.cos(k * 1.57 + 0.8), 0.3, Math.sin(k * 1.57 + 0.8)], 2);
  },

  /**
   * Kepler: one camera with a 1.4 m mirror and a field of view as big as two hands held at
   * arm's length, in a long barrel cut off at a slant as a sunshade, a curved array of solar
   * panels wrapped round its sunny side, a six-sided bus and dish at its foot.
   */
  kepler(g, m) {
    prism(g, m.foilGold, 6, 1.25, 1.25, 1.0, 0, 0.5, 0, 0.6);
    slantTube(g, m.foilBlack, 0.95, 3.0, 0.55, 0, 2.6, 0);
    slantTube(g, m.baffle, 0.92, 3.0, 0.55, 0, 2.6, 0);
    cyl(g, m.lens, 0.92, 0.92, 0.02, 0, 1.4, 0, 'y', false, 28);
    for (const y of [1.3, 2.4]) hoop(g, m.dark, 0.97, 0.025, 0, y, 0, 'y', 28);
    // four fixed panels bent round the barrel on the Sun side (−X)
    for (let k = 0; k < 4; k++) {
      const a = Math.PI * 0.62 + (k * Math.PI * 0.76) / 3;
      const panel = solarPanel(m, 1.4, 3.0, m.cellsBlue, m.panelBack, 0.45);
      const out = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
      // the panel's width runs round the barrel, its length up it, its cells face outwards
      panel.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(Math.sin(a), 0, Math.cos(a)), out, new THREE.Vector3(0, 1, 0)));
      panel.position.set(1.65 * Math.cos(a), 2.3, -1.65 * Math.sin(a));
      g.add(panel);
      strut(g, m.metal, [1.0 * Math.cos(a), 1.0, -1.0 * Math.sin(a)], [1.6 * Math.cos(a), 1.2, -1.6 * Math.sin(a)], 0.03);
    }
    dish(g, m, 0.42, [0.7, -0.1, 0.9], [0.4, -1, 0.6]);
    for (let k = 0; k < 3; k++) thrusters(g, m, [1.2 * Math.cos(k * 2.1), 0.1, 1.2 * Math.sin(k * 2.1)], [Math.cos(k * 2.1), -0.6, Math.sin(k * 2.1)], 1.6);
    tracker(g, m, [0.4, 1.0, -0.9], [0.4, 1, -0.4], 1.6);
  },

  /**
   * Spitzer: an infrared telescope inside a silver cryostat that kept it near absolute zero
   * with liquid helium, shaded by one flat wall of solar cells along its whole length, on an
   * eight-sided bus.
   */
  spitzer(g, m) {
    prism(g, m.foilGold, 8, 1.0, 1.0, 0.8, 0, 0.4, 0, 0.6, Math.PI / 8);
    cyl(g, m.dark, 0.5, 0.6, 0.3, 0, 0.95, 0, 'y', false, 20); // the struts' shroud (the telescope was launched warm)
    const shell = cyl(g, m.foilSilver, 0.82, 0.82, 2.9, 0, 2.55, 0, 'y', true, 32);
    tileUV(shell.geometry, 6, 3);
    cyl(g, m.foilSilver, 0.82, 0.82, 0.05, 0, 1.12, 0, 'y', false, 32);
    slantTube(g, m.foilBlack, 0.7, 0.5, 0.35, 0, 4.2, 0, 28); // the telescope's outer baffle
    cyl(g, m.baffle, 0.68, 0.68, 0.02, 0, 4.0, 0, 'y', false, 28);
    for (const y of [1.6, 2.6, 3.6]) hoop(g, m.dark, 0.83, 0.02, 0, y, 0, 'y', 32);
    // the solar panel: a flat shade along the whole Sun side
    const shade = new THREE.Group();
    const panel = solarPanel(m, 1.9, 4.0, m.cellsBlue, m.panelBack, 0.4);
    panel.rotation.x = -Math.PI / 2;
    shade.add(panel);
    shade.position.set(0, 2.3, -1.1);
    g.add(shade);
    for (const y of [1.0, 3.6]) strut(g, m.metal, [0, y, -0.8], [0, y, -1.08], 0.03);
    plate(g, m, m.mirror, 1.0, 2.6, [0, 2.55, 0.83], [0, 0, 1], 4); // the cold side radiates into the dark
    helix(g, m, [0.6, 0.0, 0.5], [0, -1, 0], 0.2, 0.06);
    dish(g, m, 0.35, [-0.6, -0.15, 0.4], [-0.3, -1, 0.3]);
    for (let k = 0; k < 4; k++) thrusters(g, m, [0.95 * Math.cos(k * 1.57 + 0.4), 0.1, 0.95 * Math.sin(k * 1.57 + 0.4)], [Math.cos(k * 1.57 + 0.4), -0.5, Math.sin(k * 1.57 + 0.4)], 1.5);
  },

  /**
   * JUICE (Jupiter Icy Moons Explorer): a big foil box with a 2.5 m dish on top, two cross-
   * shaped solar wings of five panels each (85 m² in all, for sunlight 25 times weaker than at
   * Earth), a 10.6 m magnetometer boom and the long rod of the ice-penetrating radar.
   */
  juice(g, m) {
    bus(g, m.foilGold, 2.4, 2.4, 2.4, { bevel: 0.1 });
    bus(g, m.foilBlack, 2.46, 0.5, 2.46, { y: -0.95, bevel: 0.05 });
    strut(g, m.dark, [0, 1.2, 0], [0, 1.6, 0], 0.08);
    dish(g, m, 1.25, [0, 1.65, 0], [0, 1, 0]);
    for (const s of [-1, 1]) { // a wing: one panel from the yoke, then a cross of four round a centre panel
      const wing = new THREE.Group();
      strut(wing, m.dark, [0, 0, 0], [0, 0, 0.7], 0.05);
      const P = 2.2, add = (x: number, z: number) => { const p = solarPanel(m, P * 0.97, P * 0.97, m.cellsBlue, m.panelBack, 0.45); p.position.set(x, 0, z); wing.add(p); };
      add(0, 0.7 + P / 2);
      add(0, 0.7 + P * 1.5);
      add(-P, 0.7 + P * 1.5);
      add(P, 0.7 + P * 1.5);
      add(0, 0.7 + P * 2.5);
      wing.position.set(0, 0.2, s * 1.2);
      wing.rotation.set(0, s === 1 ? 0 : Math.PI, s * 0.3);
      g.add(wing);
    }
    lattice(g, m.metal, [-1.2, 0.6, 0.6], [-5.5, 3.0, 2.5], 0.05, 18); // magnetometer boom (shortened)
    box(g, m.dark, 0.14, 0.1, 0.1, -5.5, 3.0, 2.5);
    strut(g, m.metal, [1.1, -1.2, -1.0], [1.4, -1.6, -6.5], 0.025); // the radar's 16 m antenna (shortened)
    for (const [x, z] of [[1.2, 1.2], [-1.2, -1.2]]) for (const d of [[1, 0.3, 1], [-1, 0.3, -1]] as const) whip(g, m, [x, 1.0, z], [d[0], d[1], d[2]], 2.5, 0.015); // radio and plasma probes
    scope(g, m, m.white, 0.18, 0.6, [0.8, -1.2, 0.5], [0, -1, 0]); // camera, looking at the moons
    bus(g, m.foilSilver, 0.5, 0.4, 0.5, { x: -0.5, y: -1.4, z: 0.6, bevel: 0.04 });
    nozzle(g, m, 0.3, 0.45, [0, -1.25, -0.4], [0, -1, -0.3]);
    for (const [y, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) thrusters(g, m, [1.2, y * 1.0, z * 1.0], [0.6, y, z], 2);
  },

  /**
   * Hayabusa2: a gold box with two three-panel solar paddles, two FLAT high-gain antennas on
   * its top deck, four ion engines on one side, and the long sampler horn underneath that
   * touched the asteroid Ryugu (it fired a pellet into the ground and caught what flew up).
   */
  hayabusa2(g, m) {
    bus(g, m.foilGold, 1.6, 1.25, 1.0, { bevel: 0.06 });
    plate(g, m, m.radiator, 1.2, 0.8, [0, 0.0, -0.502], [0, 0, -1], 3);
    for (const [x, r] of [[0.35, 0.42], [-0.45, 0.3]] as const) { // flat antennas: Ka band and X band
      cyl(g, m.dark, r, r, 0.04, x, 0.66, 0.05, 'y', false, 24);
      cyl(g, m.white, r * 0.94, r * 0.94, 0.02, x, 0.69, 0.05, 'y', false, 24);
    }
    for (const s of [-1, 1]) { // the two paddles, three panels each, from the narrow ends
      const wing = buildWing(m, { width: 0.95, length: 2.4, panels: 3, yoke: 0.15, tile: 0.3 });
      wing.position.set(0, 0.1, s * 0.5);
      wing.rotation.set(0, s === 1 ? 0 : Math.PI, 0);
      g.add(wing);
    }
    // the sampler horn, folded down from the bottom
    cyl(g, m.metal, 0.06, 0.1, 1.0, 0.3, -1.1, 0, 'y', false, 12);
    cyl(g, m.foilGold, 0.12, 0.12, 0.08, 0.3, -1.62, 0, 'y', false, 12);
    cyl(g, m.white, 0.25, 0.28, 0.2, -0.45, -0.7, 0, 'y', false, 20); // the re-entry capsule's place
    for (let k = 0; k < 4; k++) { // ion engines
      const y = k < 2 ? -0.2 : 0.2, z = k % 2 ? -0.2 : 0.2;
      cyl(g, m.dark, 0.09, 0.09, 0.08, -0.84, y, z, 'x', false, 14);
      cyl(g, m.metal, 0.07, 0.07, 0.09, -0.85, y, z, 'x', false, 14);
    }
    scope(g, m, m.foilSilver, 0.06, 0.18, [0.6, -0.62, 0.3], [0, -1, 0]); // navigation camera
    tracker(g, m, [-0.6, 0.62, -0.3], [-0.3, 1, -0.3], 1.4);
  },

  /**
   * Hera: ESA's survey of the Didymos pair after NASA's DART struck the smaller one. A foil box,
   * two three-panel wings, a 1.1 m dish, a camera turret, and the two CubeSats it carried there.
   */
  hera(g, m) {
    bus(g, m.foilGold, 1.6, 1.7, 1.6, { bevel: 0.07 });
    bus(g, m.foilBlack, 1.64, 0.3, 1.64, { y: 0.7, bevel: 0.03 });
    strut(g, m.dark, [0, 0.85, 0], [0.1, 1.15, 0], 0.05);
    dish(g, m, 0.56, [0.1, 1.2, 0], [0.3, 1, 0]);
    wingPair(g, m, { width: 1.05, length: 3.6, panels: 3, root: 0.8, yoke: 0.3, tilt: 0.2, tile: 0.35 });
    bus(g, m.white, 0.5, 0.35, 0.4, { x: 0.82, y: -0.3, bevel: 0.04 }); // the camera and laser altimeter
    for (const z of [-0.1, 0.1]) cyl(g, m.lens, 0.06, 0.06, 0.02, 1.08, -0.3, z, 'x', false, 12);
    for (const z of [-0.45, 0.45]) bus(g, m.dark, 0.34, 0.24, 0.24, { x: -0.3, y: -0.9, z, bevel: 0.02 }); // the CubeSats' dispensers
    nozzle(g, m, 0.14, 0.2, [0, -0.85, 0], [0, -1, 0]);
    for (const [y, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) thrusters(g, m, [-0.8, y * 0.7, z * 0.7], [-0.6, y, z], 1.3);
    tracker(g, m, [-0.5, 0.85, 0.5], [-0.3, 1, 0.4], 1.4);
  },

  /**
   * MMX (Martian Moons eXploration): JAXA's craft to bring home soil from Phobos. Three
   * modules stacked (propulsion, exploration, return), two big wings, a dish, landing legs
   * and the coring sampler on the exploration module, and a small rover for the surface.
   */
  mmx(g, m) {
    cyl(g, m.foilGold, 1.0, 1.0, 1.4, 0, -0.9, 0, 'y', false, 20); // propulsion module
    bus(g, m.foilSilver, 1.9, 1.0, 1.9, { y: 0.35, bevel: 0.06 }); // exploration module
    cyl(g, m.white, 0.85, 1.0, 0.7, 0, 1.2, 0, 'y', false, 20); // return module
    cyl(g, m.dark, 0.55, 0.85, 0.25, 0, 1.68, 0, 'y', false, 20);
    dish(g, m, 0.5, [0.75, 1.6, 0], [0.5, 1, 0]);
    wingPair(g, m, { width: 1.2, length: 3.8, panels: 3, root: 0.95, y: 0.35, yoke: 0.3, tilt: 0.25, tile: 0.4 });
    for (let k = 0; k < 4; k++) { // landing legs
      const a = Math.PI / 4 + (k * Math.PI) / 2, c = Math.cos(a), s = Math.sin(a);
      strut(g, m.metal, [0.9 * c, -0.1, 0.9 * s], [1.6 * c, -1.8, 1.6 * s], 0.04);
      cyl(g, m.goldPlate, 0.14, 0.18, 0.05, 1.6 * c, -1.82, 1.6 * s, 'y', false, 12);
    }
    strut(g, m.metal, [0.9, -0.1, 0.4], [1.3, -1.5, 0.5], 0.035); // coring sampler
    bus(g, m.white, 0.3, 0.25, 0.4, { x: -0.95, y: -0.2, z: -0.6, bevel: 0.03 }); // the rover, waiting
    nozzle(g, m, 0.2, 0.3, [0, -1.6, 0], [0, -1, 0]);
  },

  /**
   * DSCOVR: a camera a million and a half kilometres away that photographs the whole sunlit
   * face of the Earth, while its other side samples the solar wind on its way to us. Earth is
   * −Y here, the Sun +Y: a short drum with two two-panel wings, the camera (EPIC) on the
   * Earth end, the solar-wind sensors on the Sun end, a magnetometer boom.
   */
  dscovr(g, m) {
    prism(g, m.foilSilver, 8, 0.7, 0.7, 1.3, 0, 0, 0, 0.6, Math.PI / 8);
    prism(g, m.foilGold, 8, 0.72, 0.72, 0.3, 0, 0.5, 0, 0.6, Math.PI / 8);
    scope(g, m, m.white, 0.22, 0.7, [0.1, -0.65, 0], [0, -1, 0]); // EPIC
    const door = cyl(g, m.foilGold, 0.23, 0.23, 0.03, 0.33, -1.4, 0, 'y', false, 16);
    door.rotation.z = 1.2;
    scope(g, m, m.foilGold, 0.1, 0.3, [-0.35, -0.65, 0.2], [0, -1, 0]); // NISTAR, measuring the light the Earth gives off
    for (const x of [-0.25, 0.25]) scope(g, m, m.dark, 0.08, 0.15, [x, 0.65, 0.2], [0, 1, 0]); // Faraday cups facing the solar wind
    wingPair(g, m, { width: 0.9, length: 2.3, panels: 2, root: 0.68, yoke: 0.2, tilt: 0.3 });
    lattice(g, m.metal, [0.6, 0.4, 0.4], [3.0, 1.0, 1.4], 0.04, 10);
    box(g, m.dark, 0.1, 0.08, 0.08, 3.0, 1.0, 1.4);
    helix(g, m, [-0.4, -0.65, -0.35], [0, -1, 0], 0.25, 0.06);
    for (let k = 0; k < 4; k++) thrusters(g, m, [0.7 * Math.cos(k * 1.57 + 0.4), -0.5, 0.7 * Math.sin(k * 1.57 + 0.4)], [Math.cos(k * 1.57 + 0.4), -0.4, Math.sin(k * 1.57 + 0.4)], 1.1);
  },

  /**
   * Wind: a spinning drum covered in solar cells (no wings: as it turns, every side takes its
   * turn in the Sun), with rods along its spin axis and two pairs of wire antennas (the longer
   * pair 100 m tip to tip in life) spun out sideways to listen to radio waves in the solar wind.
   */
  wind(g, m) {
    const drum = new THREE.CylinderGeometry(1.2, 1.2, 1.4, 32, 1, true);
    tileUV(drum, 14, 3);
    mesh(g, drum, m.cellsBlue);
    cyl(g, m.dark, 1.19, 1.19, 1.4, 0, 0, 0, 'y', false, 32);
    for (const y of [-0.7, 0.7]) hoop(g, m.metal, 1.2, 0.03, 0, y, 0, 'y', 32);
    hoop(g, m.foilGold, 1.21, 0.08, 0, 0.1, 0, 'y', 32); // the band the instruments look out through
    cyl(g, m.foilGold, 1.18, 1.18, 0.04, 0, 0.72, 0, 'y', false, 32);
    cyl(g, m.foilBlack, 1.18, 1.18, 0.04, 0, -0.72, 0, 'y', false, 32);
    cyl(g, m.white, 0.3, 0.35, 0.3, 0, 0.9, 0, 'y', false, 16); // despun antenna
    for (const s of [-1, 1]) strut(g, m.metal, [0, s * 0.75, 0], [0, s * 4.5, 0], 0.025); // axial antennas (12 m in life)
    for (let k = 0; k < 4; k++) whip(g, m, [1.2 * Math.cos(k * 1.57), 0, 1.2 * Math.sin(k * 1.57)], [Math.cos(k * 1.57), 0, Math.sin(k * 1.57)], 5, 0.012); // wire antennas (shortened)
    for (const s of [-1, 1]) { // magnetometer booms
      lattice(g, m.metal, [s * 1.0, 0.3, 0.7], [s * 3.6, 0.3, 2.6], 0.04, 10);
      box(g, m.dark, 0.1, 0.08, 0.08, s * 3.6, 0.3, 2.6);
    }
    for (let k = 0; k < 4; k++) bus(g, m.foilGold, 0.3, 0.25, 0.25, { x: 0.95 * Math.cos(k * 1.57 + 0.78), y: 0.85, z: 0.95 * Math.sin(k * 1.57 + 0.78), bevel: 0.03 });
  },

  /**
   * IMAP (Interstellar Mapping and Acceleration Probe): a wide, low spinning disc, 2.4 m across,
   * its top deck of solar panels turned to the incoming solar wind, ten instruments looking
   * out from bays round its rim, a magnetometer on a 2.5 m boom, the dish on the rear deck.
   */
  imap(g, m) {
    prism(g, m.foilBlack, 12, 1.2, 1.2, 0.9, 0, 0, 0, 0.6);
    const top = new THREE.CircleGeometry(1.15, 12);
    tileUV(top, 6, 6);
    mesh(g, top, m.cellsBlue, 0, 0.46, 0).rotation.x = -Math.PI / 2;
    for (let k = 0; k < 6; k++) { // instrument sensors in the side bays
      const a = (k * TAU) / 6 + 0.26, c = Math.cos(a), s = Math.sin(a);
      if (k % 2) scope(g, m, m.foilGold, 0.16, 0.3, [1.15 * c, 0.05, 1.15 * s], [c, 0.2, s]);
      else bus(g, m.foilSilver, 0.4, 0.4, 0.3, { x: 1.25 * c, y: 0, z: 1.25 * s, bevel: 0.03 }).rotation.y = -a;
    }
    scope(g, m, m.dark, 0.14, 0.3, [0, 0.47, 0.6], [0, 1, 0]); // the one sensor on top, among the panels
    strut(g, m.metal, [0.8, 0.4, -0.8], [2.4, 0.5, -2.1], 0.03); // magnetometer boom
    for (const f of [0.6, 1]) box(g, m.dark, 0.1, 0.08, 0.08, 0.8 + 1.6 * f, 0.4 + 0.1 * f, -0.8 - 1.3 * f);
    dish(g, m, 0.3, [0, -0.5, 0], [0, -1, 0]);
    for (let k = 0; k < 4; k++) thrusters(g, m, [1.1 * Math.cos(k * 1.57 + 0.78), -0.4, 1.1 * Math.sin(k * 1.57 + 0.78)], [Math.cos(k * 1.57 + 0.78), -0.5, Math.sin(k * 1.57 + 0.78)], 1.3);
  },

  /**
   * Ulysses: the first craft to fly over the Sun's poles (Jupiter flung it out of the plane
   * of the planets). A box with a 1.65 m dish on top, its nuclear generator jutting out to one
   * side, a magnetometer boom and long wire and axial antennas. Spun about the dish's axis.
   */
  ulysses(g, m) {
    bus(g, m.foilGold, 3.2, 1.8, 2.0, { bevel: 0.08 });
    plate(g, m, m.radiator, 1.8, 1.4, [0, 0.902, 0], [0, 1, 0], 3);
    strut(g, m.dark, [0, 0.9, 0], [0, 1.4, 0], 0.08);
    dish(g, m, 0.83, [0, 1.45, 0], [0, 1, 0]);
    strut(g, m.metal, [1.6, 0.2, 0], [2.3, 0.2, 0], 0.08);
    rtg(g, m, [2.3, 0.2, 0], [1, 0, 0], 1.1, 0.22);
    lattice(g, m.metal, [-1.6, 0.4, 0.4], [-5.2, 0.6, 1.2], 0.05, 12); // magnetometer boom
    box(g, m.dark, 0.14, 0.1, 0.1, -5.2, 0.6, 1.2);
    strut(g, m.metal, [0, -0.9, 0], [0, -4.0, 0], 0.025); // axial antenna
    for (const s of [-1, 1]) whip(g, m, [0, 0, s * 1.0], [0.2, 0, s], 4.5, 0.012); // wire antennas (35 m each in life)
    for (const [x, z] of [[1.1, 0.7], [-1.1, -0.7]]) bus(g, m.foilSilver, 0.4, 0.3, 0.3, { x, y: -0.9, z, bevel: 0.03 });
    for (let k = 0; k < 4; k++) thrusters(g, m, [1.6 * (k < 2 ? 1 : -1), -0.6, 1.0 * (k % 2 ? 1 : -1)], [k < 2 ? 1 : -1, -0.5, k % 2 ? 1 : -1], 1.4);
  },

  /**
   * Dawn: the first craft to orbit two worlds beyond the Earth and Moon (Vesta, then Ceres),
   * pushed there by three ion engines. A box with a 1.5 m dish on one side and two very long
   * five-panel wings, almost 20 m from tip to tip.
   */
  dawn(g, m) {
    bus(g, m.foilGold, 1.6, 1.3, 1.8, { bevel: 0.07 });
    bus(g, m.foilBlack, 1.64, 0.3, 1.84, { y: 0.55, bevel: 0.03 });
    strut(g, m.dark, [0.8, 0, 0], [1.0, 0, 0], 0.06);
    dish(g, m, 0.76, [1.05, 0, 0], [1, 0, 0]);
    wingPair(g, m, { width: 2.27, length: 8.3, panels: 5, root: 0.9, yoke: 0.4, tile: 0.4 });
    for (const x of [-0.5, 0, 0.5]) { // the three ion engines on the bottom
      cyl(g, m.dark, 0.18, 0.2, 0.12, x, -0.7, 0, 'y', false, 16);
      cyl(g, m.metal, 0.15, 0.15, 0.13, x, -0.72, 0, 'y', false, 16);
    }
    for (const z of [-0.4, 0.4]) scope(g, m, m.white, 0.1, 0.3, [-0.5, -0.65, z], [0, -1, 0]); // framing cameras
    bus(g, m.foilSilver, 0.35, 0.3, 0.35, { x: 0.3, y: -0.8, z: 0.55, bevel: 0.03 }); // spectrometer
    for (const [y, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) thrusters(g, m, [-0.8, y * 0.55, z * 0.8], [-0.6, y, z], 1.3);
    tracker(g, m, [-0.5, 0.72, -0.5], [-0.3, 1, -0.3], 1.4);
  },
} satisfies Partial<Record<ModelKind, Builder>>;
