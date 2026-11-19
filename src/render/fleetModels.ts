/**
 * 3D models of smaller fleets in Earth orbit that were drawn with a generic shape: GPS III,
 * BeiDou-3, Spire's Lemur CubeSats, the Space Development Agency's Tranche satellites, the
 * radar fleets StriX, QPS-SAR and Umbra, Planet's SkySats, Satellogic's NewSats, HawkEye 360
 * and ORBCOMM. One builder per kind, made from the kit in modelParts.ts and handed to
 * satModels.ts, which merges, centres, scales and caches every model the same way;
 * describe.ts (SHAPES) says which catalogue names get which.
 *
 * Several of these companies publish few pictures: where a layout is inferred rather than
 * known, the builder's comment says so (and so does the catalogue's sentence about it).
 *
 * Model axes as for every satellite: +X = direction of travel, −Y = towards the Earth, solar
 * wings along ±Z. 1 unit = 1 m unless a comment says otherwise.
 */

import * as THREE from 'three';
import type { ModelKind } from '../data/describe.ts';
import {
  TAU, arrayPanel, ball, box, buildWing, bus, cyl, dish, helix, hoop, mesh, nozzle, plate, scope, solarPanel, strut, thrusters, tracker, whip, wingPair,
  type Builder, type Materials,
} from './modelParts.ts';

/** An optical crosslink terminal: a small telescope in a domed gimbal. */
function laserDome(g: THREE.Group, m: Materials, x: number, y: number, z: number, size = 1): void {
  cyl(g, m.dark, 0.08 * size, 0.09 * size, 0.08 * size, x, y, z, 'y', false, 12);
  ball(g, m.lens, 0.075 * size, x, y + 0.06 * size, z);
}

/**
 * An umbrella reflector opening towards −Y: a shallow bowl on `ribs` ribs, `R` in radius, with
 * its feed on a tripod at the focus. `skin` is the reflecting surface (gold or silver mesh).
 */
function umbrella(g: THREE.Group, m: Materials, R: number, ribs: number, skin: THREE.Material, y: number): void {
  const bowl = new THREE.Group();
  const depth = R * 0.22;
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= 8; i++) profile.push(new THREE.Vector2((R * i) / 8, depth * (i / 8) ** 2));
  mesh(bowl, new THREE.LatheGeometry(profile, ribs * 2), skin);
  for (let k = 0; k < ribs; k++) {
    const a = (k * TAU) / ribs;
    for (let i = 0; i < 4; i++) {
      const r0 = (R * i) / 4, r1 = (R * (i + 1)) / 4;
      strut(bowl, m.dark, [r0 * Math.cos(a), depth * (i / 4) ** 2 + 0.01, r0 * Math.sin(a)], [r1 * Math.cos(a), depth * ((i + 1) / 4) ** 2 + 0.01, r1 * Math.sin(a)], R * 0.008);
    }
  }
  hoop(bowl, m.dark, R, R * 0.008, 0, depth, 0, 'y', ribs * 2);
  cyl(bowl, m.dark, R * 0.07, R * 0.09, R * 0.07, 0, 0, 0, 'y', false, 12);
  for (let k = 0; k < 3; k++) {
    const a = (k * TAU) / 3;
    strut(bowl, m.metal, [R * 0.5 * Math.cos(a), depth * 0.3, R * 0.5 * Math.sin(a)], [0, R * 0.9, 0], R * 0.008);
  }
  cyl(bowl, m.metal, R * 0.05, R * 0.07, R * 0.1, 0, R * 0.9, 0, 'y', false, 10);
  bowl.rotation.x = Math.PI;
  bowl.position.y = y;
  g.add(bowl);
}

/** A leaf-by-leaf radar antenna strip along X: `leaves` × (w × h), radar face down, solar cells on its back. */
function radarStrip(g: THREE.Group, m: Materials, leaves: number, w: number, h: number, y: number, tilt: number, cellsOnBack: boolean): void {
  const strip = new THREE.Group();
  for (let i = 0; i < leaves; i++) {
    const x = (i - (leaves - 1) / 2) * (w + 0.02);
    const leaf = arrayPanel(m, w, h, 20, m.radar);
    leaf.position.x = x;
    strip.add(leaf);
    if (cellsOnBack) {
      const cells = solarPanel(m, w * 0.96, h * 0.94, m.cellsBlue, m.panelBack, 0.15);
      cells.rotation.x = -Math.PI / 2; // cells to −Z, the back of the leaf
      cells.position.set(x, 0, -0.03);
      strip.add(cells);
    } else box(strip, m.foilBlack, w * 0.95, h * 0.9, 0.02, x, 0, -0.025);
    if (i < leaves - 1) for (const yy of [-h * 0.3, h * 0.3]) cyl(strip, m.metal, 0.012, 0.012, 0.06, x + w / 2 + 0.01, yy, -0.02, 'y', false, 6);
  }
  strip.rotation.x = Math.PI / 2 + tilt; // face down (and to one side)
  strip.position.y = y;
  g.add(strip);
}

export const FLEET_BUILDERS = {
  /**
   * GPS III (from 2018): Lockheed Martin's box with two long wings and, on the Earth face, the
   * navigation antenna — a panel of helix elements three times stronger than the older
   * satellites' — with the UHF crosslink and search-and-rescue antennas beside it.
   */
  gpsiii(g, m) {
    bus(g, m.foilGold, 1.3, 1.6, 1.1, { bevel: 0.07 });
    for (const s of [-1, 1]) plate(g, m, m.mirror, 0.9, 1.2, [0, 0.05, s * 0.552], [0, 0, s], 5);
    bus(g, m.dark, 1.5, 0.06, 1.3, { y: -0.83, bevel: 0.015 });
    plate(g, m, m.dark, 0.9, 0.9, [0.15, -0.87, 0], [0, -1, 0], 2);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      if ((i === 0 || i === 3) && (j === 0 || j === 3)) continue;
      helix(g, m, [0.15 - 0.33 + i * 0.22, -0.88, -0.33 + j * 0.22], [0, -1, 0], 0.32, 0.055); // navigation array
    }
    helix(g, m, [-0.5, -0.88, 0.4], [0, -1, 0], 0.55, 0.08); // UHF crosslink
    helix(g, m, [-0.5, -0.88, -0.4], [0, -1, 0], 0.25, 0.05); // search-and-rescue
    plate(g, m, m.array, 0.22, 0.22, [0.55, -0.875, 0.5], [0, -1, 0], 20); // laser retro-reflectors
    wingPair(g, m, { width: 1.0, length: 3.3, panels: 3, root: 0.55, yoke: 0.35, tilt: 0.3, tile: 0.4 });
    nozzle(g, m, 0.12, 0.18, [0, 0.8, 0], [0, 1, 0]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) thrusters(g, m, [sx * 0.6, 0.78, sz * 0.5], [sx, 1, sz], 1.2);
    tracker(g, m, [0.4, 0.8, 0.3], [0.5, 1, 0.3], 1.2);
  },

  /**
   * BeiDou-3: China's navigation satellites. A box with two wings; on the Earth face a big
   * round navigation antenna of helix elements, a laser reflector, and the flat Ka-band array
   * of the links that let the satellites talk to each other.
   */
  beidou(g, m) {
    bus(g, m.foilGold, 1.2, 1.4, 1.0, { bevel: 0.06 });
    bus(g, m.white, 1.24, 0.3, 1.04, { y: 0.45, bevel: 0.03 });
    bus(g, m.dark, 1.3, 0.05, 1.1, { y: -0.73, bevel: 0.015 });
    cyl(g, m.dark, 0.42, 0.42, 0.04, 0.1, -0.77, 0, 'y', false, 24);
    for (let k = 0; k < 10; k++) helix(g, m, [0.1 + 0.3 * Math.cos((k * TAU) / 10), -0.78, 0.3 * Math.sin((k * TAU) / 10)], [0, -1, 0], 0.2, 0.045);
    helix(g, m, [0.1, -0.78, 0], [0, -1, 0], 0.26, 0.05);
    const ka = arrayPanel(m, 0.4, 0.3, 16); // inter-satellite link array, leaning outwards
    ka.position.set(-0.45, -0.85, 0.3);
    ka.rotation.set(Math.PI / 2 - 0.5, 0, 0);
    g.add(ka);
    plate(g, m, m.array, 0.18, 0.18, [-0.45, -0.755, -0.35], [0, -1, 0], 22);
    wingPair(g, m, { width: 0.9, length: 2.6, panels: 2, root: 0.5, yoke: 0.3, tilt: 0.3, tile: 0.4 });
    nozzle(g, m, 0.1, 0.15, [0, 0.62, 0], [0, 1, 0]);
    tracker(g, m, [0.35, 0.62, 0.3], [0.4, 1, 0.3], 1.2);
  },

  /**
   * Spire's Lemur: a 3U CubeSat (10 × 10 × 34 cm; 1 unit = 10 cm here) that listens for
   * ships' and aircraft's position reports and measures the air by how GPS signals bend
   * through it. Its two solar panels open out flat on either side, in three segments each.
   */
  lemur(g, m) {
    box(g, m.dark, 3.4, 1.0, 1.0);
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) box(g, m.metal, 3.46, 0.12, 0.12, 0, sy * 0.47, sz * 0.47);
    plate(g, m, m.cellsBlue, 3.2, 0.84, [0, 0.51, 0], [0, 1, 0], 1 / 0.5);
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) { // three segments hinged one after another
        const panel = solarPanel(m, 3.2, 0.95, m.cellsBlue, m.panelBack, 0.5);
        panel.position.set(0, 0.5, s * (0.5 + 0.5 + k * 1.0));
        g.add(panel);
      }
      for (const x of [-1.2, 1.2]) cyl(g, m.yellow, 0.05, 0.05, 0.2, x, 0.5, s * 0.52, 'x', false, 8);
    }
    plate(g, m, m.array, 0.8, 0.8, [1.71, 0, 0], [1, 0, 0], 3); // radio-occultation antenna, looking along the track
    plate(g, m, m.array, 0.8, 0.8, [-1.71, 0, 0], [-1, 0, 0], 3);
    whip(g, m, [0.8, -0.5, 0], [0.2, -1, 0], 4.0, 0.03); // ship-signal (AIS) antenna
    plate(g, m, m.foilGold, 3.0, 0.8, [0, -0.51, 0], [0, -1, 0], 1);
  },

  /**
   * Space Development Agency Tranche satellites (PRAETORIAN and its successors): a mesh of
   * military relay satellites linked by lasers. A box with two wings, laser terminals at its
   * corners, a Ka-band dish and the Link 16 antennas that talk to aircraft and ships. The
   * agency's builders (York, Lockheed Martin, Northrop Grumman and others) have shown few
   * pictures: the layout is approximate.
   */
  sdatranche(g, m) {
    bus(g, m.foilBlack, 1.3, 1.0, 1.0, { bevel: 0.05 });
    bus(g, m.foilSilver, 1.34, 0.2, 1.04, { y: 0.42, bevel: 0.03 });
    for (const [x, z] of [[0.55, 0.42], [0.55, -0.42], [-0.55, 0.42], [-0.55, -0.42]]) laserDome(g, m, x, 0.55, z, 1.2);
    for (const x of [-0.3, 0.0, 0.3]) helix(g, m, [x, -0.5, 0.25], [0, -1, 0], 0.28, 0.06); // Link 16
    dish(g, m, 0.18, [0.3, -0.6, -0.25], [0.3, -1, -0.2]);
    wingPair(g, m, { width: 0.85, length: 2.4, panels: 2, root: 0.5, yoke: 0.3, tilt: 0.3, tile: 0.35 });
    nozzle(g, m, 0.05, 0.07, [-0.66, 0, 0.2], [-1, 0, 0]);
    tracker(g, m, [-0.3, 0.52, 0], [-0.3, 1, 0.2]);
  },

  /**
   * StriX (Synspective, Japan): a radar satellite whose antenna is a long strip of seven
   * leaves, about 5 m by 0.7 m, unfolded along the track, with solar cells on the back of the
   * leaves and a small bus in the middle.
   */
  strix(g, m) {
    radarStrip(g, m, 7, 0.68, 0.7, -0.05, 0.35, true);
    bus(g, m.foilSilver, 0.6, 0.45, 0.5, { y: 0.3, bevel: 0.03 });
    tracker(g, m, [0.2, 0.53, 0.1], [0.4, 1, 0.3], 0.7);
    helix(g, m, [-0.2, 0.53, -0.1], [0, 1, 0], 0.08, 0.025);
    nozzle(g, m, 0.03, 0.05, [-0.31, 0.3, 0], [-1, 0, 0]);
  },

  /**
   * QPS-SAR (iQPS, Japan): a 170 kg radar satellite with a 3.6 m antenna that unfolds like an
   * umbrella of rigid silver ribs, the bus and its solar panels behind it.
   */
  qpssar(g, m) {
    bus(g, m.foilBlack, 0.7, 0.5, 0.7, { y: 0.5, bevel: 0.04 });
    for (const s of [-1, 1]) {
      const panel = solarPanel(m, 0.7, 0.8, m.cellsBlue, m.panelBack, 0.2);
      panel.position.set(0, 0.76, s * 0.75);
      panel.rotation.x = s * -0.25;
      g.add(panel);
    }
    strut(g, m.metal, [0, 0.25, 0], [0, 0.0, 0], 0.03);
    umbrella(g, m, 1.8, 16, m.foilSilver, 0.0);
  },

  /**
   * Umbra: an American radar satellite, among the sharpest in orbit, whose antenna is a
   * parabolic reflector of fine mesh unfolded from a small bus, fed from a boom at its focus.
   */
  umbra(g, m) {
    bus(g, m.foilSilver, 0.6, 0.5, 0.6, { y: 0.45, bevel: 0.04 });
    wingPair(g, m, { width: 0.5, length: 1.1, panels: 2, root: 0.3, y: 0.45, yoke: 0.12, tilt: 0.3, tile: 0.18 });
    strut(g, m.metal, [0, 0.2, 0], [0, 0.0, 0], 0.03);
    umbrella(g, m, 1.6, 12, m.foilTorn, 0.0);
  },

  /**
   * Planet's SkySat: a 110 kg satellite built round a telescope that can make out things about
   * half a metre across, looking straight down; the solar panels fold out from its body.
   * (Planet has published little about its layout: this is approximate.)
   */
  skysat(g, m) {
    bus(g, m.foilSilver, 0.6, 0.95, 0.6, { bevel: 0.03 });
    for (const s of [-1, 1]) {
      const panel = solarPanel(m, 0.6, 0.95, m.cellsBlue, m.panelBack, 0.2);
      panel.position.set(0, 0.0, s * 0.31);
      panel.rotation.x = s * Math.PI / 2; // body-mounted, on the two long sides
      g.add(panel);
      const wing = solarPanel(m, 0.6, 0.95, m.cellsBlue, m.panelBack, 0.2);
      wing.position.set(0, 0.47, s * 0.78);
      wing.rotation.x = s * -0.3;
      g.add(wing);
    }
    scope(g, m, m.dark, 0.22, 0.2, [0, -0.48, 0], [0, -1, 0]);
    helix(g, m, [0.2, 0.48, 0.15], [0, 1, 0], 0.08, 0.03);
    tracker(g, m, [-0.18, 0.48, -0.15], [-0.3, 1, -0.3], 0.7);
  },

  /**
   * Satellogic's NewSat (catalogued as NUSAT): a 40 kg box round a camera that images in colour
   * and in hundreds of narrow bands, with solar panels opened out like wings.
   * (Layout approximate.)
   */
  nusat(g, m) {
    bus(g, m.foilGold, 0.45, 0.8, 0.45, { bevel: 0.03 });
    wingPair(g, m, { width: 0.42, length: 1.0, panels: 2, root: 0.23, yoke: 0.08, tilt: 0.0, tile: 0.15 });
    scope(g, m, m.dark, 0.16, 0.18, [0, -0.4, 0], [0, -1, 0]);
    whip(g, m, [0.15, 0.4, 0.1], [0.2, 1, 0.1], 0.3, 0.008);
    tracker(g, m, [-0.12, 0.4, -0.1], [-0.3, 1, -0.3], 0.6);
  },

  /**
   * HawkEye 360: small satellites flying in clusters of three, a few kilometres apart, that
   * locate radio transmitters on the ground by comparing when and at what pitch each hears
   * them. A small box, deployed solar panels and several antennas facing Earth. (Approximate.)
   */
  hawkeye(g, m) {
    bus(g, m.foilBlack, 0.4, 0.6, 0.4, { bevel: 0.03 });
    for (const s of [-1, 1]) {
      const panel = solarPanel(m, 0.4, 0.6, m.cellsBlue, m.panelBack, 0.15);
      panel.position.set(0, 0.29, s * 0.52);
      panel.rotation.x = s * -0.2;
      g.add(panel);
    }
    plate(g, m, m.cellsBlue, 0.36, 0.56, [0.21, 0, 0], [1, 0, 0], 1 / 0.15);
    for (const [x, z] of [[0.1, 0.1], [-0.1, -0.1]]) helix(g, m, [x, -0.3, z], [0, -1, 0], 0.12, 0.035);
    plate(g, m, m.array, 0.18, 0.18, [-0.1, -0.305, 0.1], [0, -1, 0], 20);
    whip(g, m, [0.15, -0.3, -0.15], [0.3, -1, -0.2], 0.4, 0.008);
  },

  /**
   * ORBCOMM (OG2): machine-to-machine messaging satellites — tracking containers, trucks and
   * ships. A box with a deployed solar array and a long VHF antenna boom. (Approximate.)
   */
  orbcomm(g, m) {
    bus(g, m.foilSilver, 0.9, 0.7, 0.7, { bevel: 0.04 });
    plate(g, m, m.radiator, 0.6, 0.5, [0, 0.352, 0], [0, 1, 0], 3);
    const wing = buildWing(m, { width: 0.8, length: 1.6, panels: 2, yoke: 0.2, tile: 0.25 });
    wing.position.set(0, 0.1, 0.35);
    wing.rotation.z = 0.3;
    g.add(wing);
    strut(g, m.metal, [-0.45, -0.2, 0], [-2.2, -0.4, 0], 0.025); // VHF antenna boom
    for (let k = 0; k < 4; k++) helix(g, m, [-0.8 - k * 0.4, -0.36, 0], [0, -1, 0], 0.15, 0.03);
    helix(g, m, [0.25, -0.35, 0.2], [0, -1, 0], 0.15, 0.04);
    whip(g, m, [0.3, 0.35, -0.2], [0.2, 1, 0], 0.4, 0.008);
  },
} satisfies Partial<Record<ModelKind, Builder>>;
