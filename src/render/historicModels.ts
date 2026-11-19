/**
 * 3D models of what stands at the historic landing sites (space/sites.ts): the Apollo lunar
 * modules' descent stages (with the Lunar Roving Vehicle where the last three missions parked
 * it), Surveyor, the Luna sample-return landers, the Lunokhods, Chang'e and Yutu, Viking,
 * Pathfinder and Sojourner, Spirit and Opportunity, Phoenix, Venera and Huygens. One builder
 * per kind, made from the kit in modelParts.ts and handed to satModels.ts, which merges,
 * centres, scales and caches every model the same way.
 *
 * Every one stands on the ground: +Y is up, +X is forwards, y = 0 is the ground under its
 * feet or wheels (modelBase() tells a caller how far below the model's centre that ends up).
 * 1 unit = 1 m. They are drawn as they were left: an Apollo site has only the descent stage
 * (the ascent stage flew the crew back up), a Luna site only the stage the sample left from.
 */

import * as THREE from 'three';
import type { ModelKind } from '../data/describe.ts';
import {
  TAU, ball, box, bus, cyl, dish, fan, helix, hoop, lathe, mesh, nozzle, paint, plate, prism, scope, solarPanel, strut, tileUV, whip,
  type Builder, type Materials,
} from './modelParts.ts';
import { wheel } from './planetaryModels.ts';

/** A lander leg from the body down to a footpad, braced by two thin struts. */
function leg(g: THREE.Group, m: Materials, x: number, y: number, z: number, out: number, pad = 0.2, skin: THREE.Material = m.metal, foot: THREE.Material = m.goldPlate): void {
  const a = Math.atan2(z, x), c = Math.cos(a), s = Math.sin(a), r = Math.hypot(x, z) + out;
  strut(g, skin, [x, y, z], [r * c, 0.1, r * s], 0.045);
  for (const side of [-0.35, 0.35]) strut(g, m.metal, [Math.hypot(x, z) * Math.cos(a + side), y * 0.5, Math.hypot(x, z) * Math.sin(a + side)], [r * 0.9 * c, 0.3, r * 0.9 * s], 0.02);
  cyl(g, foot, pad, pad * 1.2, 0.06, r * c, 0.03, r * s, 'y', false, 14);
}

let flagCloth: THREE.MeshStandardMaterial | null = null;
/** The United States flag the Apollo crews planted (made the first time an Apollo site is shown). */
function flag(m: Materials): THREE.MeshStandardMaterial {
  return (flagCloth ??= new THREE.MeshStandardMaterial({
    map: paint(128, (ctx, size) => {
      for (let i = 0; i < 13; i++) {
        ctx.fillStyle = i % 2 ? '#c9c9c9' : '#9a2a2e'; // muted: it is lit by unfiltered sunlight, and the bloom would make pure white glow
        ctx.fillRect(0, (i * size) / 13, size, size / 13 + 1);
      }
      ctx.fillStyle = '#2b3566';
      ctx.fillRect(0, 0, size * 0.42, (size * 7) / 13);
      ctx.fillStyle = '#c9c9c9';
      for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) ctx.fillRect(4 + c * 8.5, 4 + r * 13, 2, 2);
    }),
    side: THREE.DoubleSide, roughness: 0.85, envMap: m.metal.envMap, envMapIntensity: 0.3,
  }));
}

/** The Apollo lunar module's descent stage, with the flag and the experiments package nearby. */
function apolloSite(g: THREE.Group, m: Materials, rover: boolean): void {
  // an octagonal stage under gold and black foil, 4.2 m across its legs' roots
  prism(g, m.foilGold, 8, 1.65, 1.65, 1.6, 0, 1.45, 0, 0.6, Math.PI / 8);
  for (let k = 0; k < 4; k++) { // the black-foil bays between the gold quadrants
    const a = (k * Math.PI) / 2, flat = 1.65 * Math.cos(Math.PI / 8);
    plate(g, m, m.foilBlack, 1.1, 1.4, [flat * Math.cos(a), 1.45, flat * Math.sin(a)], [Math.cos(a), 0, Math.sin(a)], 1.2);
  }
  prism(g, m.dark, 8, 1.7, 1.7, 0.06, 0, 2.26, 0, 0.6, Math.PI / 8); // the deck the ascent stage left from
  cyl(g, m.dullMetal, 0.5, 0.5, 0.05, 0, 2.3, 0, 'y', false, 16);
  nozzle(g, m, 0.5, 0.5, [0, 0.95, 0], [0, -1, 0]); // the descent engine's bell
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2, c = Math.cos(a), s = Math.sin(a);
    strut(g, m.foilGold, [1.35 * c, 2.0, 1.35 * s], [3.4 * c, 0.25, 3.4 * s], 0.08); // primary strut
    for (const side of [-0.3, 0.3]) strut(g, m.metal, [1.5 * Math.cos(a + side), 0.75, 1.5 * Math.sin(a + side)], [3.0 * c, 0.6, 3.0 * s], 0.035);
    cyl(g, m.goldPlate, 0.45, 0.5, 0.12, 3.45 * c, 0.06, 3.45 * s, 'y', false, 16); // dish-shaped footpad
    if (k !== 0) strut(g, m.metal, [3.4 * c, 0.2, 3.4 * s], [3.6 * c, -0.0, 3.6 * s], 0.01); // contact probe, bent
  }
  // the porch and the ladder down the front leg
  const c0 = Math.cos(Math.PI / 4), s0 = Math.sin(Math.PI / 4);
  box(g, m.foilGold, 0.6, 0.06, 0.8, 1.8 * c0, 2.0, 1.8 * s0).rotation.y = -Math.PI / 4;
  for (let i = 0; i < 9; i++) {
    const t = i / 9, x = (1.9 + t * 1.3) * c0, y = 1.85 - t * 1.6, z = (1.9 + t * 1.3) * s0;
    strut(g, m.metal, [x - 0.2 * s0, y, z + 0.2 * c0], [x + 0.2 * s0, y, z - 0.2 * c0], 0.015);
  }
  // the flag, a little way off
  strut(g, m.white, [3.5, 0, -2.0], [3.5, 2.0, -2.0], 0.02);
  strut(g, m.white, [3.5, 1.95, -2.0], [3.5, 1.95, -1.1], 0.012);
  const cloth = new THREE.PlaneGeometry(0.9, 0.6);
  mesh(g, cloth, flag(m), 3.5, 1.63, -1.55).rotation.y = -Math.PI / 2;
  // the experiments package: a central station and a few instruments on the ground
  box(g, m.foilSilver, 0.6, 0.3, 0.45, -3.0, 0.15, 2.2);
  cyl(g, m.white, 0.04, 0.04, 0.5, -3.0, 0.55, 2.2, 'y', false, 8);
  helix(g, m, [-3.0, 0.8, 2.2], [0, 1, 0], 0.3, 0.06);
  ball(g, m.foilSilver, 0.18, -2.4, 0.18, 2.8, 1, 0.9, 1); // the seismometer under its blanket
  plate(g, m, m.array, 0.46, 0.46, [-3.4, 0.08, 1.4], [0.2, 1, 0], 10); // laser reflector (Apollo 11, 14, 15)
  if (rover) {
    // the Lunar Roving Vehicle, parked where the crew left it
    const lrv = new THREE.Group();
    for (const x of [-1.15, 1.15]) for (const z of [-0.92, 0.92]) {
      cyl(lrv, m.dullMetal, 0.41, 0.41, 0.23, x, 0.41, z, 'z', false, 18); // wire-mesh tyres
      cyl(lrv, m.dark, 0.28, 0.28, 0.24, x, 0.41, z, 'z', false, 12);
      const fender = mesh(lrv, new THREE.CylinderGeometry(0.47, 0.47, 0.26, 12, 1, true, -Math.PI / 2, Math.PI), m.yellow, x, 0.41, z);
      fender.rotation.x = Math.PI / 2;
    }
    box(lrv, m.dullMetal, 3.0, 0.08, 1.4, 0, 0.62, 0); // chassis
    for (const z of [-0.33, 0.33]) {
      box(lrv, m.dark, 0.45, 0.06, 0.48, -0.1, 0.72, z); // seat
      box(lrv, m.dark, 0.06, 0.45, 0.48, -0.35, 0.92, z);
    }
    box(lrv, m.foilSilver, 0.3, 0.35, 0.5, 0.5, 0.85, 0); // control console and hand controller
    strut(lrv, m.metal, [1.3, 0.66, 0], [1.35, 1.6, 0], 0.025);
    const umbrella = new THREE.LatheGeometry([0, 0.33, 0.66, 1].map((t) => new THREE.Vector2(0.5 * t, 0.12 * (1 - t * t))), 20);
    mesh(lrv, umbrella, m.dish, 1.35, 1.6, 0); // the umbrella-like high-gain antenna
    mesh(lrv, umbrella, m.dishBack, 1.35, 1.6, 0);
    scope(lrv, m, m.white, 0.08, 0.2, [1.3, 1.1, 0.3], [1, 0, 0]); // the TV camera Houston drove
    box(lrv, m.dark, 0.6, 0.25, 0.6, -1.3, 0.8, 0); // tool pallet
    lrv.position.set(-0.5, 0, -4.4);
    lrv.rotation.y = 0.4;
    g.add(lrv);
  }
}

export const HISTORIC_BUILDERS = {
  /** Apollo 11, 12 and 14: the lunar module's descent stage, the flag, the experiments left behind. */
  apollolm(g, m) {
    apolloSite(g, m, false);
  },

  /** Apollo 15, 16 and 17: the same, and the Lunar Roving Vehicle parked beside it. */
  apollolrv(g, m) {
    apolloSite(g, m, true);
  },

  /**
   * Surveyor (1966–1968): NASA's robot landers that showed the Moon's ground would bear a
   * spacecraft. A spindly triangular frame on three legs, a mast carrying a flat solar panel
   * and antenna, two white electronics boxes, and a TV camera under a swivelling mirror.
   * Apollo 12 landed beside Surveyor 3 and brought its camera home.
   */
  surveyor(g, m) {
    for (let k = 0; k < 3; k++) {
      const a = (k * TAU) / 3, b = ((k + 1) * TAU) / 3;
      strut(g, m.metal, [0.6 * Math.cos(a), 0.7, 0.6 * Math.sin(a)], [0.6 * Math.cos(b), 0.7, 0.6 * Math.sin(b)], 0.03); // triangular frame
      strut(g, m.metal, [0.6 * Math.cos(a), 0.7, 0.6 * Math.sin(a)], [0, 1.9, 0], 0.025);
      leg(g, m, 0.6 * Math.cos(a), 0.7, 0.6 * Math.sin(a), 1.0, 0.18, m.metal, m.white);
      ball(g, m.foilSilver, 0.2, 0.42 * Math.cos(a + 1.05), 0.75, 0.42 * Math.sin(a + 1.05)); // propellant tanks
    }
    nozzle(g, m, 0.18, 0.3, [0, 0.62, 0], [0, -1, 0]); // the solid retro-rocket was thrown off; vernier engines remained
    strut(g, m.metal, [0, 0.7, 0], [0, 3.0, 0], 0.03); // the mast
    const panel = solarPanel(m, 0.9, 0.86, m.cellsBlue, m.panelBack, 0.3);
    panel.position.set(0, 3.0, 0.3);
    panel.rotation.x = -0.9;
    g.add(panel);
    plate(g, m, m.array, 0.9, 0.6, [0, 2.85, -0.4], [0, 0.3, -1], 6); // planar high-gain antenna
    bus(g, m.white, 0.5, 0.35, 0.45, { x: 0.45, y: 0.95, z: 0.1, bevel: 0.03 }); // the two thermal boxes
    bus(g, m.white, 0.4, 0.3, 0.35, { x: -0.35, y: 0.95, z: 0.35, bevel: 0.03 });
    cyl(g, m.white, 0.09, 0.09, 0.5, -0.2, 1.15, -0.45, 'y', false, 12); // TV camera …
    const mirror = box(g, m.lens, 0.18, 0.02, 0.14, -0.2, 1.43, -0.45); // … looking down into its mirror
    mirror.rotation.z = 0.7;
    whip(g, m, [0.2, 2.5, 0.1], [0.5, 0.4, 0.4], 0.6, 0.01);
  },

  /**
   * Luna 16, 20 and 24 (1970–1976): the Soviet robots that drilled into the Moon and sent a
   * capsule of soil back to Earth. What stays is the landing stage: four spherical and four
   * cylindrical propellant tanks in a ring, four legs, and the drill arm.
   */
  luna(g, m) {
    prism(g, m.foilSilver, 8, 0.9, 0.9, 0.12, 0, 1.0, 0, 0.6, Math.PI / 8); // instrument deck
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2, b = a + Math.PI / 4;
      ball(g, m.dullMetal, 0.42, 0.75 * Math.cos(a), 0.62, 0.75 * Math.sin(a)); // spherical tanks
      cyl(g, m.dullMetal, 0.22, 0.22, 0.6, 0.85 * Math.cos(b), 0.62, 0.85 * Math.sin(b), 'y', false, 14); // and cylindrical ones
      leg(g, m, 0.8 * Math.cos(b), 0.55, 0.8 * Math.sin(b), 0.9, 0.24, m.dullMetal, m.dullMetal);
    }
    nozzle(g, m, 0.2, 0.3, [0, 0.4, 0], [0, -1, 0]);
    // the drill arm, swung down to the ground and back up to the capsule
    strut(g, m.metal, [0.9, 1.0, 0.0], [1.6, 1.7, 0.1], 0.03);
    strut(g, m.metal, [1.6, 1.7, 0.1], [1.7, 0.1, 0.1], 0.03);
    cyl(g, m.dark, 0.05, 0.05, 0.5, 1.7, 0.35, 0.1, 'y', false, 10);
    box(g, m.foilSilver, 0.5, 0.3, 0.6, 0, 1.2, 0); // the mount the ascent stage left from
    for (const z of [-0.5, 0.5]) scope(g, m, m.dark, 0.06, 0.25, [0.6, 1.06, z], [1, 0, 0]); // TV cameras
    whip(g, m, [-0.6, 1.06, 0.4], [-0.3, 1, 0.3], 1.0, 0.012);
    whip(g, m, [-0.6, 1.06, -0.4], [-0.3, 1, -0.3], 1.0, 0.012);
  },

  /**
   * Lunokhod (Luna 17 and 21, 1970 and 1973): the first rovers on another world, driven from
   * Earth. A tub on eight wire-spoked wheels, its lid (solar cells inside) opened back by day
   * and closed over the radiator at night, cameras at the front, a cone antenna and a helix.
   */
  lunokhod(g, m) {
    for (const x of [-0.9, -0.3, 0.3, 0.9]) for (const s of [-1, 1]) wheel(g, m, x, 0.255, s * 0.85, 0.255, 0.2);
    for (const s of [-1, 1]) box(g, m.dullMetal, 2.2, 0.12, 0.15, 0, 0.3, s * 0.72); // chassis rails
    const tub = lathe(g, m.foilSilver, [[0.62, 0], [0.82, 0.55], [0.82, 0.58]], 0, 0.36, 0, 'y', 28); // the "tub": wider at the top
    tub.scale.set(1.35, 1, 1);
    cyl(g, m.dark, 0.62, 0.62, 0.02, 0, 0.36, 0, 'y', false, 28).scale.set(1.35, 1, 1);
    const radiator = new THREE.CircleGeometry(0.8, 28);
    tileUV(radiator, 3, 3);
    const top = mesh(g, radiator, m.radiator, 0, 0.94, 0);
    top.rotation.x = -Math.PI / 2;
    top.scale.set(1.35, 1, 1);
    // the lid, hinged at the back and opened up, its solar cells to the sky
    const lid = new THREE.Group();
    const cells = new THREE.CircleGeometry(0.8, 28);
    tileUV(cells, 6, 6);
    mesh(lid, cells, m.cellsBlue, 0, -0.025, 0.8).rotation.x = Math.PI / 2; // on the lid's inside
    cyl(lid, m.foilSilver, 0.8, 0.8, 0.04, 0, 0, 0.8, 'y', false, 28);
    lid.position.set(-1.05, 0.94, 0);
    lid.rotation.set(0, Math.PI / 2, 0); // closed, it lies forwards over the tub …
    lid.rotateX(-2.0); // … opened, it swings up and back past upright, its inside to the Sun
    g.add(lid);
    for (const z of [-0.25, 0.25]) cyl(g, m.lens, 0.06, 0.06, 0.05, 1.05, 0.72, z, 'x', false, 12); // the driving cameras' portholes
    cyl(g, m.foilSilver, 0.02, 0.18, 0.5, 0.8, 1.2, 0.4, 'y', false, 12); // cone antenna
    helix(g, m, [0.7, 0.94, -0.4], [0.3, 1, 0], 0.4, 0.06);
    whip(g, m, [0.7, 0.94, 0.55], [0.3, 1, 0.3], 0.6, 0.01);
    box(g, m.dullMetal, 0.25, 0.25, 0.12, 1.2, 0.4, 0.4); // the French laser reflector, at the front
  },

  /**
   * Chang'e 5 and 6 (2020, 2024): China's sample-return landers (Chang'e 6 brought back the
   * first soil from the Moon's far side). An eight-sided gold lander on four legs, two solar
   * wings raised either side, a camera mast and a dish; the ascent stage has left its top.
   */
  change(g, m) {
    prism(g, m.foilGold, 8, 1.4, 1.4, 1.0, 0, 1.25, 0, 0.6, Math.PI / 8);
    prism(g, m.dark, 8, 1.45, 1.45, 0.05, 0, 1.78, 0, 0.6, Math.PI / 8);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      leg(g, m, 1.2 * Math.cos(a), 1.0, 1.2 * Math.sin(a), 0.9, 0.24);
    }
    nozzle(g, m, 0.3, 0.4, [0, 0.75, 0], [0, -1, 0]);
    for (const s of [-1, 1]) { // the two wings, opened out and tilted up
      const panel = solarPanel(m, 1.7, 1.3, m.cellsBlue, m.panelBack, 0.35);
      panel.position.set(0, 2.15, s * 1.85);
      panel.rotation.x = s * -0.7;
      g.add(panel);
      strut(g, m.metal, [0, 1.78, s * 1.25], [0, 1.9, s * 1.35], 0.03);
    }
    strut(g, m.white, [0.8, 1.78, 0.4], [0.8, 2.8, 0.4], 0.03); // camera mast
    bus(g, m.white, 0.2, 0.15, 0.35, { x: 0.8, y: 2.88, z: 0.4, bevel: 0.02 });
    strut(g, m.metal, [-0.6, 1.78, -0.4], [-0.6, 2.4, -0.4], 0.03);
    dish(g, m, 0.35, [-0.6, 2.45, -0.4], [-0.3, 1, -0.2]);
    strut(g, m.metal, [1.2, 1.5, -0.3], [2.0, 1.2, -0.5], 0.03); // the drill and the scoop arm
    strut(g, m.metal, [2.0, 1.2, -0.5], [2.2, 0.15, -0.5], 0.03);
    box(g, m.foilSilver, 0.7, 0.4, 0.7, 0, 1.98, 0); // the mount the ascent stage left from
  },

  /**
   * Yutu and Yutu-2 (Chang'e 3, 2013; Chang'e 4, 2019, the first rover on the far side): a
   * six-wheeled gold rover with two solar panels that fold over it at night, a mast with
   * cameras and a dish, and an arm at the front.
   */
  yutu(g, m) {
    const R = 0.15, track = 0.62;
    for (const s of [-1, 1]) {
      for (const x of [0.5, 0, -0.5]) wheel(g, m, x, R, s * track, R, 0.15);
      strut(g, m.dark, [0.5, R, s * 0.54], [0, 0.4, s * 0.5], 0.03);
      strut(g, m.dark, [-0.5, R, s * 0.54], [0, 0.4, s * 0.5], 0.03);
    }
    bus(g, m.foilGold, 1.0, 0.4, 0.8, { y: 0.6, bevel: 0.04 });
    for (const s of [-1, 1]) { // the two panels, opened out
      const panel = solarPanel(m, 0.9, 0.7, m.cellsBlue, m.panelBack, 0.25);
      panel.position.set(-0.05, 0.92, s * 0.75);
      panel.rotation.x = s * -0.35;
      g.add(panel);
    }
    strut(g, m.white, [0.38, 0.8, 0.2], [0.38, 1.45, 0.2], 0.03);
    bus(g, m.white, 0.14, 0.12, 0.34, { x: 0.4, y: 1.5, z: 0.2, bevel: 0.02 });
    for (const z of [0.08, 0.32]) cyl(g, m.lens, 0.03, 0.03, 0.02, 0.48, 1.5, z, 'x', false, 10);
    dish(g, m, 0.16, [0.38, 1.62, 0.2], [-0.3, 1, 0]);
    strut(g, m.metal, [0.5, 0.55, -0.2], [0.85, 0.4, -0.25], 0.025); // the arm with its spectrometer
    box(g, m.dark, 0.1, 0.08, 0.08, 0.88, 0.36, -0.25);
  },

  /**
   * Viking 1 and 2 (1976): the first landers to work on Mars, and to look for life in its soil.
   * A six-sided body on three legs, two nuclear generators under their windscreens on top, a
   * dish on a mast, the two cameras' towers, a weather boom, and the sampling arm.
   */
  viking(g, m) {
    prism(g, m.white, 6, 1.05, 1.05, 0.45, 0, 0.75, 0, 0.6);
    prism(g, m.dark, 6, 1.08, 1.08, 0.04, 0, 0.99, 0, 0.6);
    for (let k = 0; k < 3; k++) {
      const a = (k * TAU) / 3 + Math.PI / 6;
      leg(g, m, 0.9 * Math.cos(a), 0.75, 0.9 * Math.sin(a), 0.45, 0.16, m.metal, m.dullMetal);
    }
    for (const z of [-0.45, 0.45]) { // the generators, under white windscreens
      box(g, m.white, 0.5, 0.35, 0.3, -0.3, 1.18, z);
      cyl(g, m.dark, 0.1, 0.1, 0.4, -0.3, 1.2, z, 'x', false, 10);
    }
    strut(g, m.metal, [0.1, 1.0, 0.0], [0.1, 1.9, 0.0], 0.03);
    dish(g, m, 0.38, [0.1, 1.95, 0.0], [0.3, 1, 0.3]); // S-band dish to Earth
    for (const z of [-0.3, 0.3]) { // the two camera towers
      cyl(g, m.white, 0.08, 0.08, 0.45, 0.65, 1.22, z, 'y', false, 12);
      cyl(g, m.dark, 0.09, 0.09, 0.12, 0.65, 1.48, z, 'y', false, 12);
    }
    strut(g, m.metal, [-0.6, 0.95, 0.3], [-0.9, 2.0, 0.5], 0.02); // weather boom
    box(g, m.dark, 0.12, 0.08, 0.08, -0.9, 2.0, 0.5);
    strut(g, m.metal, [0.8, 0.8, -0.4], [2.2, 0.6, -0.6], 0.03); // the sampling arm and its scoop
    box(g, m.metal, 0.15, 0.08, 0.12, 2.25, 0.5, -0.6);
    helix(g, m, [-0.6, 1.0, -0.2], [0, 1, 0], 0.2, 0.05); // relay antenna to the orbiter
  },

  /**
   * Mars Pathfinder (1997): a lander that bounced to a stop in airbags and opened three
   * triangular petals of solar cells, its camera on a mast, and beside it Sojourner, the first
   * rover on Mars, the size of a microwave oven.
   */
  pathfinder(g, m) {
    const R = 1.0; // the petals' corners
    petals(g, m, R);
    strut(g, m.metal, [0, 0.35, 0], [0, 1.15, 0], 0.03); // the camera mast
    bus(g, m.white, 0.2, 0.15, 0.25, { y: 1.2, bevel: 0.02 });
    for (const z of [-0.06, 0.06]) cyl(g, m.lens, 0.025, 0.025, 0.02, 0.1, 1.2, z, 'x', false, 10);
    dish(g, m, 0.14, [-0.2, 0.55, 0.1], [-0.3, 1, 0.3]);
    whip(g, m, [0.2, 0.35, -0.2], [0, 1, 0], 0.5, 0.01);
    // Sojourner, driven down its ramp
    const rover = new THREE.Group();
    for (const x of [-0.2, 0, 0.2]) for (const s of [-1, 1]) cyl(rover, m.dullMetal, 0.065, 0.065, 0.06, x, 0.065, s * 0.2, 'z', false, 12);
    box(rover, m.foilGold, 0.45, 0.14, 0.3, 0, 0.2, 0);
    const top = solarPanel(m, 0.6, 0.45, m.cellsBlue, m.panelBack, 0.15);
    top.position.set(0, 0.29, 0);
    rover.add(top);
    whip(rover, m, [-0.15, 0.3, 0.1], [0, 1, 0], 0.25, 0.006);
    rover.position.set(2.0, 0, 0.5);
    rover.rotation.y = 0.5;
    g.add(rover);
    for (const z of [-0.12, 0.12]) strut(g, m.metal, [0.9, 0.12, z], [1.6, 0.0, z + 0.3], 0.015); // ramp
  },

  /**
   * Spirit and Opportunity (2004): golf-cart-sized twin rovers on six wheels. A deck of solar
   * panels spread like wings, a mast with the stereo panoramic camera, a flat dish, the arm
   * with its rock grinder. Opportunity drove for over fourteen years.
   */
  mer(g, m) {
    const R = 0.125, track = 0.6;
    for (const s of [-1, 1]) {
      for (const x of [0.55, 0, -0.55]) wheel(g, m, x, R, s * track, R, 0.16);
      strut(g, m.dark, [0.55, R, s * 0.52], [0.05, 0.38, s * 0.5], 0.03);
      strut(g, m.dark, [-0.55, R, s * 0.52], [0.05, 0.38, s * 0.5], 0.03);
    }
    bus(g, m.white, 0.9, 0.3, 0.7, { y: 0.5, bevel: 0.03 });
    // the solar "wings": a central deck and five panels round it
    const deck: [number, number, number, number][] = [[0, 0, 1.0, 0.8], [0.0, 0.8, 0.9, 0.7], [0.0, -0.8, 0.9, 0.7], [-0.85, 0.5, 0.7, 0.7], [-0.85, -0.5, 0.7, 0.7], [0.8, 0, 0.6, 0.9]];
    for (const [x, z, w, l] of deck) {
      const panel = solarPanel(m, w, l, m.cellsBlue, m.panelBack, 0.2);
      panel.position.set(x, 0.68, z);
      panel.rotation.x = z > 0.1 ? -0.08 : z < -0.1 ? 0.08 : 0;
      g.add(panel);
    }
    strut(g, m.white, [0.35, 0.68, 0.25], [0.35, 1.5, 0.25], 0.03); // Pancam mast
    bus(g, m.white, 0.12, 0.1, 0.35, { x: 0.38, y: 1.55, z: 0.25, bevel: 0.015 });
    for (const z of [0.1, 0.4]) cyl(g, m.lens, 0.025, 0.025, 0.02, 0.45, 1.55, z, 'x', false, 10);
    cyl(g, m.white, 0.14, 0.14, 0.03, -0.2, 0.9, -0.25, 'y', false, 16); // flat high-gain dish …
    strut(g, m.metal, [-0.2, 0.68, -0.25], [-0.2, 0.88, -0.25], 0.025);
    whip(g, m, [-0.35, 0.68, 0.3], [0, 1, 0], 0.4, 0.008); // … and the low-gain antenna
    strut(g, m.metal, [0.5, 0.45, -0.15], [0.8, 0.5, -0.2], 0.025); // the arm, stowed under the front
    box(g, m.dark, 0.12, 0.1, 0.12, 0.85, 0.48, -0.2);
  },

  /**
   * Phoenix (2008): the lander that dug into the arctic plains of Mars and found ice a few
   * centimetres down. A deck on three legs between two round fan-fold solar arrays, a 2.35 m
   * arm with a scoop, the weather mast and the stereo camera.
   */
  phoenix(g, m) {
    prism(g, m.foilGold, 10, 0.8, 0.8, 0.3, 0, 0.95, 0, 0.5);
    prism(g, m.dark, 10, 0.82, 0.82, 0.04, 0, 1.12, 0, 0.5);
    for (let k = 0; k < 3; k++) {
      const a = (k * TAU) / 3 + Math.PI / 2;
      leg(g, m, 0.62 * Math.cos(a), 0.8, 0.62 * Math.sin(a), 0.35, 0.15);
    }
    for (const s of [-1, 1]) {
      const f = fan(m, 0.95, 10, m.cellsBlue, 0.3);
      f.position.set(0, 1.1, s * 1.7);
      g.add(f);
      strut(g, m.metal, [0, 1.08, s * 0.7], [0, 1.1, s * 0.8], 0.04);
    }
    strut(g, m.white, [0.5, 1.12, 0.3], [1.2, 1.6, 0.3], 0.035); // the arm …
    strut(g, m.white, [1.2, 1.6, 0.3], [2.0, 0.2, 0.3], 0.03);
    box(g, m.metal, 0.15, 0.1, 0.12, 2.05, 0.14, 0.3); // … and its scoop
    strut(g, m.white, [-0.3, 1.12, -0.3], [-0.3, 2.0, -0.3], 0.03); // camera mast
    bus(g, m.white, 0.16, 0.14, 0.26, { x: -0.3, y: 2.06, z: -0.3, bevel: 0.02 });
    strut(g, m.metal, [-0.5, 1.12, 0.3], [-0.5, 2.1, 0.3], 0.02); // weather mast, with its little wind telltale
    box(g, m.dark, 0.04, 0.12, 0.04, -0.5, 2.1, 0.3);
    for (const [x, z] of [[0.3, -0.35], [0.0, 0.4]]) bus(g, m.white, 0.3, 0.2, 0.25, { x, y: 1.24, z, bevel: 0.02 }); // ovens and the wet-chemistry lab
  },

  /**
   * Venera 7 and 13 (1970, 1982): the Soviet landers that survived the surface of Venus,
   * 460 °C and ninety atmospheres, for minutes to two hours. A spherical pressure vessel on a
   * crushable landing ring, a disc round its middle that braked the fall in the thick air, an
   * antenna on top, and the soil drill on the ring.
   */
  venera(g, m) {
    hoop(g, m.dullMetal, 0.85, 0.16, 0, 0.16, 0, 'y', 28); // landing ring
    for (let k = 0; k < 12; k++) { // the ring's teeth, to keep it from rolling
      const a = (k * TAU) / 12;
      box(g, m.dullMetal, 0.1, 0.12, 0.06, 1.0 * Math.cos(a), 0.06, 1.0 * Math.sin(a)).rotation.y = -a;
    }
    cyl(g, m.dullMetal, 0.55, 0.8, 0.4, 0, 0.45, 0, 'y', true, 24);
    ball(g, m.white, 0.55, 0, 0.95, 0); // the pressure vessel, under its insulation
    cyl(g, m.dullMetal, 1.05, 1.05, 0.04, 0, 1.15, 0, 'y', false, 24); // the braking disc
    hoop(g, m.dullMetal, 1.05, 0.03, 0, 1.15, 0, 'y', 24);
    cyl(g, m.white, 0.22, 0.3, 0.35, 0, 1.55, 0, 'y', false, 16); // antenna on top
    ball(g, m.white, 0.22, 0, 1.75, 0, 1, 0.6, 1);
    for (const a of [0.5, 2.2, 4.0]) cyl(g, m.lens, 0.06, 0.06, 0.06, 0.5 * Math.cos(a), 0.8, 0.5 * Math.sin(a), 'y', false, 10); // camera ports
    strut(g, m.metal, [0.75, 0.4, 0.3], [1.2, 0.05, 0.4], 0.03); // the drill, into the ground
    box(g, m.dark, 0.2, 0.25, 0.12, 0.85, 0.35, -0.6); // a lens cap, ejected and lying where it fell
  },

  /**
   * Huygens (2005): the European probe that rode the Cassini spacecraft to Saturn and fell
   * through the haze of Titan, the only landing in the outer Solar System. Its descent module
   * is a squat disc 1.3 m across with a domed front; it came to rest on a plain of rounded
   * pebbles of water ice.
   */
  huygens(g, m) {
    lathe(g, m.foilSilver, [[0, 0.02], [0.35, 0.05], [0.6, 0.14], [0.66, 0.22]], 0, 0, 0, 'y', 32); // the domed front, down
    cyl(g, m.foilGold, 0.66, 0.66, 0.24, 0, 0.34, 0, 'y', false, 32);
    lathe(g, m.foilSilver, [[0.66, 0.46], [0.5, 0.58], [0.25, 0.64], [0, 0.65]], 0, 0, 0, 'y', 32); // the back cover
    for (let k = 0; k < 18; k++) { // spin vanes round the rim
      const a = (k * TAU) / 18;
      box(g, m.dullMetal, 0.12, 0.08, 0.01, 0.7 * Math.cos(a), 0.3, 0.7 * Math.sin(a)).rotation.y = -a + 0.4;
    }
    for (const a of [0.3, 2.4, 4.4]) scope(g, m, m.dark, 0.05, 0.12, [0.6 * Math.cos(a), 0.3, 0.6 * Math.sin(a)], [Math.cos(a), -0.2, Math.sin(a)]);
    cyl(g, m.dark, 0.08, 0.08, 0.1, 0, 0.68, 0, 'y', false, 12);
  },
} satisfies Partial<Record<ModelKind, Builder>>;

/**
 * Mars Pathfinder's opened tetrahedron: the triangular base, raised on its electronics, and
 * its three sides laid open round it as petals of solar cells sloping down to the ground.
 */
function petals(g: THREE.Group, m: Materials, R: number): void {
  const corner = (k: number) => new THREE.Vector3(R * 0.5 * Math.cos((k * TAU) / 3), 0.3, R * 0.5 * Math.sin((k * TAU) / 3));
  /** One triangle, turned to face upwards whichever order its corners come in. */
  const tri = (points: THREE.Vector3[], material: THREE.Material) => {
    const n = new THREE.Vector3().subVectors(points[1], points[0]).cross(new THREE.Vector3().subVectors(points[2], points[0]));
    if (n.y < 0) points = [points[0], points[2], points[1]];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flatMap((p) => [p.x, p.y, p.z]), 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(points.flatMap((p) => [p.x * 3, p.z * 3]), 2));
    geometry.computeVertexNormals();
    mesh(g, geometry, material);
  };
  tri([corner(0), corner(1), corner(2)], m.foilGold);
  cyl(g, m.foilGold, R * 0.5, R * 0.5, 0.28, 0, 0.16, 0, 'y', false, 3).rotation.y = -Math.PI / 6;
  for (let k = 0; k < 3; k++) {
    const a = corner(k), b = corner((k + 1) % 3), c = corner((k + 2) % 3);
    const tip = new THREE.Vector3().addVectors(a, b).sub(c).setY(0.04); // the opposite corner, folded out across the edge
    tri([a, b, tip], m.cellsBlue);
    const under = [a, b, tip].map((p) => p.clone().setY(p.y - 0.02));
    tri(under, m.panelBack);
  }
}
