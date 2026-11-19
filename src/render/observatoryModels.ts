/**
 * 3D models of the observatories that work beyond low Earth orbit: the telescopes parked at
 * the Sun–Earth balance points or on long looping orbits, and the craft that watch the Sun
 * and the solar wind from there. One builder per kind, made from the kit in modelParts.ts
 * and handed to satModels.ts, which builds, merges and caches every model the same way.
 *
 * Axes as everywhere: +Y = away from the body the craft is shown at. For the craft out at
 * the balance points that body is the Earth, so a telescope hiding behind a sunshield has its
 * shield towards −Y and looks out along +Y; a Sun-watcher between Earth and Sun faces +Y.
 * Each builder states its own scale: the result is normalised to one unit anyway.
 */

import * as THREE from 'three';
import type { ModelKind } from '../data/describe.ts';
import {
  TAU, aimed, box, buildWing, bus, cyl, dish, helix, hoop, lattice, mesh, nozzle, plate, prism, scope, solarPanel, strut, thrusters, tileUV, tracker, whip, wingPair,
  type Builder, type V3,
} from './modelParts.ts';

/**
 * One layer of Webb's sunshield: a kite-shaped film, `half` long each way and `wide` to each
 * side, folded up along its short middle line like a very shallow boat, so its two blunt tips
 * (`tip` wide) stand `rise` above the middle. `down` makes the face that looks at the Sun.
 */
function membrane(g: THREE.Group, material: THREE.Material, half: number, wide: number, tip: number, y: number, rise: number, down = false): void {
  // two flat quadrilaterals, fore and aft, each listed anticlockwise as seen from above
  const quads = [
    [[0, y, -wide], [0, y, wide], [half, y + rise, tip], [half, y + rise, -tip]],
    [[0, y, wide], [0, y, -wide], [-half, y + rise, -tip], [-half, y + rise, tip]],
  ];
  const position: number[] = [], uv: number[] = [];
  for (const q of quads) for (const i of down ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]) {
    position.push(q[i][0], q[i][1], q[i][2]);
    uv.push(q[i][0] / 1.8, q[i][2] / 1.8); // big, slow wrinkles: the film is stretched nearly flat
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals(); // corners are not shared, so each half is flat
  mesh(g, geometry, material);
}

export const OBSERVATORY_BUILDERS = {
  /**
   * James Webb Space Telescope: a five-layer sunshield the size of a tennis court, and on its
   * cold side the telescope: 18 gold hexagonal mirror segments, the small secondary mirror held
   * out in front on three legs, the instruments in a box behind. The spacecraft itself (bus,
   * solar array, antenna) hangs below, in the sunlight. 1 unit ≈ 6.6 m; the shield's long axis is X.
   */
  webb(g, m) {
    // Five membranes, each a little smaller than the one below. They touch nowhere: the gaps
    // widen towards the tips, so heat escapes sideways from between them. The lowest is two
    // one-sided faces, pink towards the Sun (its silicon coating) and silver above.
    membrane(g, m.shieldHot, 1.45, 0.98, 0.15, -0.1, 0.1, true);
    membrane(g, m.foilSilver, 1.45, 0.98, 0.15, -0.1, 0.1);
    for (let layer = 1; layer < 5; layer++) {
      const s = 1 - layer * 0.035;
      membrane(g, m.shieldCold, 1.45 * s, 0.98 * s, 0.15 * s, -0.1 + layer * 0.03, 0.1 + layer * 0.04);
    }
    for (const s of [-1, 1]) {
      box(g, m.dark, 0.05, 0.3, 0.28, s * 1.4, 0.07, 0); // spreader bars at the four tips
      box(g, m.dark, 0.2, 0.16, 0.05, 0, -0.05, s * 0.94);
      strut(g, m.dark, [0, -0.17, s * 0.2], [0, -0.12, s * 0.95], 0.016); // the booms that pushed the sides out
      strut(g, m.carbon, [s * 0.25, -0.2, 0], [s * 1.4, -0.02, 0], 0.035); // fore and aft pallets the shield was folded on
    }
    box(g, m.foilSilver, 0.34, 0.012, 0.46, -1.6, -0.06, 0).rotation.z = 0.45; // trim flap: balances the push of sunlight

    // The spacecraft, on the warm side.
    bus(g, m.foilGold, 0.5, 0.3, 0.5, { y: -0.37, bevel: 0.03, tile: 0.4 });
    bus(g, m.foilBlack, 0.54, 0.05, 0.54, { y: -0.21, bevel: 0.012 });
    const array = buildWing(m, { width: 0.32, length: 0.95, panels: 5, yoke: 0.1, tile: 0.1 });
    array.position.set(-0.27, -0.42, 0);
    // runs aft and a little down; cells face the Sun (down)
    array.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0.34, -0.94, 0), new THREE.Vector3(-0.94, -0.34, 0)));
    g.add(array);
    dish(g, m, 0.1, [0.12, -0.54, 0.12], [0.2, -1, 0.1]); // the dish that sends the pictures home
    tracker(g, m, [0.2, -0.3, -0.26], [0.4, -0.3, -1], 0.6);
    tracker(g, m, [0.2, -0.3, 0.26], [0.4, -0.3, 1], 0.6);
    thrusters(g, m, [-0.26, -0.44, 0.2], [-1, -0.4, 0.3], 0.6);
    thrusters(g, m, [0.26, -0.44, -0.2], [1, -0.4, -0.3], 0.6);
    nozzle(g, m, 0.04, 0.06, [0, -0.52, -0.15], [0, -1, 0]);

    // The telescope. Local +Y is where it looks (along the shield, +X); local +X is down.
    cyl(g, m.carbon, 0.06, 0.09, 0.5, -0.2, 0.3, 0, 'y', false, 12); // the tower that lifts it clear of the warm shield
    const f = 1.25, R = 0.128, pitch = R * 1.03; // focal length of the dished mirror; corner radius and spacing of a segment
    const ote = aimed(g, [0.06, 0.97, 0], [1, 0, 0]);
    for (let q = -2; q <= 2; q++) for (let r = -2; r <= 2; r++) {
      const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)); // distance from the middle of the honeycomb
      if (ring === 0 || ring > 2) continue; // the middle one is left out: the light comes back through there
      const x = Math.sqrt(3) * pitch * (r + q / 2), z = 1.5 * pitch * q;
      // each segment sits on the bowl of a paraboloid and leans towards its axis
      const segment = aimed(ote, [x, (x * x + z * z) / (4 * f), z], [-x / (2 * f), 1, -z / (2 * f)]);
      cyl(segment, m.goldMirror, R * 0.97, R * 0.97, 0.012, 0, 0, 0, 'y', false, 6);
      cyl(segment, m.carbon, R * 0.9, R * 0.78, 0.07, 0, -0.041, 0, 'y', false, 6); // its seven motors and their frame
    }
    cyl(ote, m.carbon, 0.03, 0.085, 0.3, 0, 0.16, 0, 'y', false, 6); // baffle tower in the middle: the third mirror is inside
    prism(ote, m.carbon, 6, 0.54, 0.54, 0.05, 0, -0.1, 0); // backplane
    bus(ote, m.foilBlack, 0.6, 0.32, 0.54, { x: 0.14, y: -0.29, bevel: 0.03, tile: 0.4 }); // the four instruments
    plate(ote, m, m.radiator, 0.44, 0.42, [0.14, -0.452, 0], [0, -1, 0], 4);
    cyl(ote, m.goldMirror, 0.062, 0.062, 0.014, 0, 1.14, 0, 'y', false, 16); // secondary mirror
    cyl(ote, m.carbon, 0.07, 0.054, 0.05, 0, 1.175, 0, 'y', false, 16);
    strut(ote, m.carbon, [-0.54, 0.02, 0], [-0.03, 1.16, 0], 0.012); // its three legs: one from the top …
    for (const s of [-1, 1]) strut(ote, m.carbon, [0.41, 0.02, s * 0.36], [0.02, 1.16, s * 0.03], 0.012); // … two from the lower corners
  },

  /**
   * Wide-field survey telescope (Euclid; Roman and Gaia are of the same family): a stubby
   * telescope tube standing on its service module, shaded by a tall flat sunshield that
   * carries the solar cells on its sunny face. The telescope looks along +Y. 1 unit = 1 m.
   */
  euclid(g, m) {
    prism(g, m.foilBlack, 6, 1.55, 1.55, 0.9, 0, -1.75, 0, 0.7, Math.PI / 6); // service module
    prism(g, m.foilGold, 6, 1.6, 1.6, 0.12, 0, -1.25, 0, 0.6, Math.PI / 6); // the plate the telescope stands on
    prism(g, m.dark, 6, 1.5, 1.5, 0.06, 0, -2.22, 0, 0.6, Math.PI / 6);
    const tube = cyl(g, m.foilSilver, 0.9, 0.95, 2.7, 0, 0.15, 0, 'y', true, 32);
    tileUV(tube.geometry, 4, 2);
    cyl(g, m.baffle, 0.87, 0.87, 2.68, 0, 0.16, 0, 'y', true, 32); // dark inside
    cyl(g, m.lens, 0.87, 0.87, 0.02, 0, -0.9, 0, 'y', false, 32); // primary mirror
    for (const y of [-0.3, 0.6, 1.5]) hoop(g, m.dark, 0.93 - (y + 1.2) * 0.0185, 0.02, 0, y, 0, 'y', 32);
    cyl(g, m.dark, 0.16, 0.16, 0.06, 0, 1.15, 0, 'y', false, 12); // secondary mirror on its spider
    for (let k = 0; k < 3; k++) strut(g, m.dark, [0, 1.15, 0], [0.87 * Math.cos((k * TAU) / 3), 1.15, 0.87 * Math.sin((k * TAU) / 3)], 0.014);
    plate(g, m, m.radiator, 1.0, 1.3, [0.965, 0.2, 0], [1, 0, 0], 3); // radiator on the side that never sees the Sun

    // Sunshield on the −X side: three columns of cells facing outwards, gold film towards the telescope.
    const shield = new THREE.Group();
    for (const k of [-1, 0, 1]) {
      const column = solarPanel(m, 0.98, 3.9, m.cellsBlue, m.panelBackGold, 0.33);
      column.position.x = k * 1.0;
      shield.add(column);
    }
    for (const z of [-1.97, 1.97]) box(shield, m.dark, 3.06, 0.05, 0.06, 0, -0.01, z);
    shield.position.set(-1.34, 0.1, 0);
    shield.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)));
    g.add(shield);
    for (let k = 0; k < 3; k++) box(g, m.foilBlack, 0.02, 0.22, 3.0, -1.24 + k * 0.1, 2.16 - k * 0.07, 0); // stepped edge: stops sunlight bending over the top
    for (const s of [-1, 1]) {
      strut(g, m.dark, [-0.85, 1.3, s * 0.3], [-1.32, 1.5, s * 1.2], 0.022);
      strut(g, m.dark, [-0.9, -1.2, s * 0.9], [-1.32, -0.6, s * 1.4], 0.022);
    }
    dish(g, m, 0.4, [0.5, -2.27, 0.4], [0.25, -1, 0.15]); // science downlink, on the Earth side
    strut(g, m.metal, [-0.6, -2.25, -0.5], [-0.7, -2.6, -0.6], 0.016);
    helix(g, m, [-0.7, -2.6, -0.6], [0, -1, 0], 0.14, 0.05);
    for (let k = 0; k < 3; k++) {
      const a = Math.PI / 6 + (k * TAU) / 3;
      thrusters(g, m, [1.5 * Math.cos(a), -2.1, 1.5 * Math.sin(a)], [Math.cos(a), -0.6, Math.sin(a)], 1.6);
    }
    tracker(g, m, [1.0, -1.18, 0.9], [0.6, 1, 0.6], 1.5);
    tracker(g, m, [1.0, -1.18, -0.9], [0.6, 1, -0.6], 1.5);
  },

  /**
   * TESS: a small six-sided bus with four wide-angle cameras on top, each in its own lens hood,
   * all four standing inside one conical sunshade; two single-panel wings and a fixed dish.
   * 1 unit = 1 m.
   */
  tess(g, m) {
    const R = 0.68, flat = R * Math.cos(Math.PI / 6);
    prism(g, m.foilGold, 6, R, R, 1.1, 0, -0.35, 0, 0.5);
    prism(g, m.foilBlack, 6, R * 1.03, R * 1.03, 0.14, 0, -0.84, 0);
    prism(g, m.dark, 6, R * 1.14, R * 1.14, 0.05, 0, 0.225, 0); // camera plate
    cyl(g, m.foilSilver, 0.86, 0.74, 0.4, 0, 0.45, 0, 'y', true, 28); // sunshade: a collar round the feet of the cameras
    cyl(g, m.baffle, 0.845, 0.725, 0.4, 0, 0.45, 0, 'y', true, 28);
    hoop(g, m.metal, 0.86, 0.014, 0, 0.65, 0, 'y', 28);
    for (const [x, z] of [[0.3, 0.3], [0.3, -0.3], [-0.3, 0.3], [-0.3, -0.3]]) {
      const camera = aimed(g, [x, 0.25, z], [x * 0.3, 1, z * 0.3]); // splayed, so the four fields join into one strip of sky
      cyl(camera, m.metal, 0.19, 0.17, 0.3, 0, 0.15, 0, 'y', false, 16); // lens barrel
      cyl(camera, m.carbon, 0.27, 0.2, 0.4, 0, 0.5, 0, 'y', true, 16); // hood
      cyl(camera, m.baffle, 0.26, 0.19, 0.4, 0, 0.5, 0, 'y', true, 16);
      cyl(camera, m.lens, 0.19, 0.19, 0.02, 0, 0.32, 0, 'y', false, 16);
      hoop(camera, m.goldPlate, 0.27, 0.014, 0, 0.7, 0, 'y', 16);
    }
    wingPair(g, m, { width: 1.05, length: 1.25, panels: 1, root: flat, y: -0.35, yoke: 0.3, tilt: 0.45, tile: 0.3 });
    const side = (deg: number, out = 1): V3 => [flat * out * Math.cos((deg * Math.PI) / 180), 0, flat * out * Math.sin((deg * Math.PI) / 180)];
    const far = side(210, 1.03);
    dish(g, m, 0.36, [far[0], -0.3, far[2]], [far[0], 0.1, far[2]]); // body-fixed: the whole craft turns to point it at Earth
    const cool = side(30, 1.005);
    plate(g, m, m.radiator, 0.5, 0.8, [cool[0], -0.3, cool[2]], [cool[0], 0, cool[2]], 4);
    const eye = side(150, 1.0);
    tracker(g, m, [eye[0], 0, eye[2]], [eye[0], 0.6, eye[2]], 1.2);
    tracker(g, m, [eye[0], -0.4, eye[2]], [eye[0], 0.2, eye[2] * 0.4], 1.2);
    nozzle(g, m, 0.09, 0.14, [0, -0.92, 0], [0, -1, 0]);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      thrusters(g, m, [0.5 * Math.cos(a), -0.9, 0.5 * Math.sin(a)], [Math.cos(a) * 0.5, -1, Math.sin(a) * 0.5]);
    }
    whip(g, m, [side(330)[0], -0.6, side(330)[2]], [1, -0.4, -0.6], 0.4);
  },

  /**
   * Chandra X-ray Observatory: X-rays only reflect at a glancing angle, so the mirrors are
   * nested barrels at the wide front end and the detectors sit ten metres behind them, at the
   * narrow end of a long tapering tube. The spacecraft (and its two wings) is wrapped round
   * the mirror end; a sunshade door stands open above it. It looks along +Y. 1 unit = 2 m.
   */
  chandra(g, m) {
    const front = cyl(g, m.foilSilver, 0.98, 0.98, 1.2, 0, 2.7, 0, 'y', true, 32);
    tileUV(front.geometry, 5, 1);
    cyl(g, m.baffle, 0.95, 0.95, 1.18, 0, 2.7, 0, 'y', true, 32);
    cyl(g, m.lens, 0.95, 0.95, 0.02, 0, 2.8, 0, 'y', false, 32);
    for (const r of [0.82, 0.64, 0.47, 0.32]) hoop(g, m.metal, r, 0.022, 0, 2.83, 0, 'y', 32); // the four pairs of mirror barrels, seen end-on
    cyl(g, m.dark, 0.17, 0.17, 0.05, 0, 2.83, 0, 'y', false, 12);
    for (let k = 0; k < 6; k++) strut(g, m.dark, [0, 2.83, 0], [0.95 * Math.cos((k * TAU) / 6), 2.83, 0.95 * Math.sin((k * TAU) / 6)], 0.012);
    hoop(g, m.dark, 0.985, 0.025, 0, 3.3, 0, 'y', 32);
    const door = new THREE.Group(); // sunshade door, open
    cyl(door, m.foilSilver, 0.98, 0.98, 0.04, -0.98, 0, 0, 'y', false, 32);
    cyl(door, m.baffle, 0.92, 0.92, 0.008, -0.98, -0.026, 0, 'y', false, 32);
    door.position.set(0.98, 3.33, 0);
    door.rotation.z = -2.0;
    g.add(door);

    // The spacecraft module: eight-sided, with radiators, thrusters and the two wings.
    const R = 1.3, flat = R * Math.cos(Math.PI / 8);
    prism(g, m.foilGold, 8, R, R, 0.85, 0, 1.75, 0, 0.6, Math.PI / 8);
    for (const y of [1.3, 2.2]) prism(g, m.foilBlack, 8, R * 1.03, R * 1.03, 0.1, 0, y, 0, 0.6, Math.PI / 8);
    for (const deg of [45, 135, 225, 315]) {
      const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
      plate(g, m, m.mirror, 0.7, 0.6, [flat * 1.004 * c, 1.75, flat * 1.004 * s], [c, 0, s], 5);
      thrusters(g, m, [R * 1.03 * c, 1.28, R * 1.03 * s], [c, -0.8, s], 1.5);
    }
    plate(g, m, m.radiator, 0.8, 0.6, [-flat * 1.004, 1.75, 0], [-1, 0, 0], 3);
    wingPair(g, m, { width: 1.15, length: 3.3, panels: 3, root: flat, y: 1.75, yoke: 0.5, tilt: -1.0, back: m.panelBackGold });
    scope(g, m, m.foilGold, 0.11, 0.8, [-1.12, 2.25, 0.3]); // aspect camera: the star tracker that says where it points
    helix(g, m, [0.7, 2.26, -0.9], [0.3, 1, -0.5], 0.2, 0.06);

    // The optical bench: nothing but a stiff, dark, empty tube down to the detectors.
    const bench = cyl(g, m.foilSilver, 0.86, 0.5, 3.7, 0, -0.5, 0, 'y', false, 32);
    tileUV(bench.geometry, 4, 3);
    for (const y of [0.9, -0.3, -1.5]) hoop(g, m.dark, 0.5 + ((y + 2.35) / 3.7) * 0.36 + 0.004, 0.02, 0, y, 0, 'y', 32);
    cyl(g, m.dark, 0.62, 0.62, 0.12, 0, -2.41, 0, 'y', false, 24);
    bus(g, m.foilGold, 1.25, 0.8, 1.25, { y: -2.87, bevel: 0.08 }); // science instrument module
    plate(g, m, m.radiator, 0.9, 0.55, [0.628, -2.87, 0], [1, 0, 0], 3);
    box(g, m.white, 0.04, 1.1, 1.2, -0.76, -2.8, 0); // shade that keeps sunlight off the detector radiator
    for (const z of [-0.4, 0.4]) strut(g, m.dark, [-0.6, -2.6, z], [-0.76, -2.5, z], 0.02);
    cyl(g, m.dark, 0.42, 0.42, 0.06, 0, -3.3, 0, 'y', false, 20);
    helix(g, m, [0.3, -3.33, 0.2], [0, -1, 0], 0.2, 0.06);
  },

  /**
   * XMM-Newton: three X-ray telescopes side by side in one black tube. The mirror modules (58
   * gold barrels nested inside each) are at the service-module end with the wings and a sun
   * shield; the cameras, with their cone-shaped radiators, are on a platform at the far end.
   * It looks along +Y. 1 unit = 2 m.
   */
  xmm(g, m) {
    cyl(g, m.carbon, 0.55, 0.55, 3.5, 0, -0.25, 0, 'y', false, 28); // telescope tube
    for (const y of [-1.6, -0.9, -0.2, 0.5, 1.2]) hoop(g, m.metal, 0.553, 0.016, 0, y, 0, 'y', 28);
    bus(g, m.foilGold, 2.0, 0.55, 2.0, { y: 1.75, bevel: 0.06 }); // service module, round the top of the tube
    bus(g, m.foilBlack, 2.06, 0.08, 2.06, { y: 2.06, bevel: 0.02 }); // mirror platform
    for (let k = 0; k < 3; k++) {
      const a = Math.PI / 2 + (k * TAU) / 3, x = 0.5 * Math.cos(a), z = 0.5 * Math.sin(a);
      cyl(g, m.foilGold, 0.36, 0.36, 0.3, x, 2.25, z, 'y', true, 24); // entrance baffle of one mirror module
      cyl(g, m.baffle, 0.345, 0.345, 0.3, x, 2.25, z, 'y', true, 24);
      cyl(g, m.lens, 0.345, 0.345, 0.02, x, 2.15, z, 'y', false, 24);
      for (const r of [0.28, 0.2, 0.12]) hoop(g, m.goldPlate, r, 0.014, x, 2.17, z, 'y', 20); // the nested gold mirrors, end-on
      hoop(g, m.dark, 0.36, 0.014, x, 2.4, z, 'y', 24);
    }
    scope(g, m, m.white, 0.11, 0.55, [0.62, 2.1, -0.7]); // optical monitor: an ordinary telescope riding along
    box(g, m.foilBlack, 0.04, 0.7, 1.9, -1.05, 2.38, 0); // sun shield
    for (const z of [-0.8, 0.8]) strut(g, m.goldPlate, [-0.7, 2.1, z], [-1.04, 2.6, z], 0.02);
    wingPair(g, m, { width: 0.95, length: 2.9, panels: 3, root: 1.0, y: 1.75, yoke: 0.4, tilt: 1.0 });
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) thrusters(g, m, [x * 0.98, 1.5, z * 0.98], [x, -0.7, z], 1.6);
    tracker(g, m, [0.75, 2.1, 0.75], [0.3, 1, 0.3], 1.6);
    helix(g, m, [0.8, 1.47, 0], [0, -1, 0], 0.2, 0.06);

    // Focal-plane end.
    prism(g, m.foilBlack, 8, 0.8, 0.8, 0.1, 0, -2.05, 0, 0.6, Math.PI / 8);
    bus(g, m.foilGold, 0.5, 0.42, 0.5, { y: -2.3, bevel: 0.04, tile: 0.4 }); // the main camera
    for (const s of [-1, 1]) {
      // the other two cameras cool themselves with a horn that looks at cold space
      const horn = aimed(g, [s * 0.42, -2.12, 0.3], [s * 0.8, -0.6, 0.35]);
      cyl(horn, m.white, 0.3, 0.1, 0.36, 0, 0.18, 0, 'y', true, 16);
      cyl(horn, m.dish, 0.3, 0.1, 0.36, 0, 0.18, 0, 'y', true, 16);
      hoop(horn, m.dark, 0.3, 0.012, 0, 0.36, 0, 'y', 16);
      box(g, m.radiator, 0.5, 0.02, 0.36, s * 0.45, -2.3, -0.5).rotation.z = s * 0.5; // spectrometer radiators
    }
    helix(g, m, [0, -2.52, 0], [0, -1, 0], 0.18, 0.05);
  },

  /**
   * SOHO: a boxy solar observatory. A dozen instruments stare at the Sun (+Y) from the upper,
   * blanket-wrapped module; the gold service module below carries the two wings, and a dish
   * on the back talks to Earth. 1 unit = 1 m.
   */
  soho(g, m) {
    bus(g, m.foilGold, 2.3, 1.2, 2.3, { y: -1.2, bevel: 0.08 });
    bus(g, m.dark, 2.36, 0.06, 2.36, { y: -0.58, bevel: 0.02 });
    bus(g, m.blanket, 2.1, 2.4, 2.1, { y: 0.63, bevel: 0.1, tile: 0.5 });
    bus(g, m.foilBlack, 2.16, 0.06, 2.16, { y: 1.85, bevel: 0.02 }); // the face that looks at the Sun
    // Telescopes and coronagraphs, their mouths proud of the front face.
    const tubes: [number, number, number, number, THREE.Material][] = [
      [0.6, 0.6, 0.17, 0.9, m.white], [0.62, 0.15, 0.12, 0.7, m.white], [0.2, 0.65, 0.12, 0.6, m.foilSilver],
      [-0.55, -0.5, 0.2, 0.45, m.foilGold], [-0.6, 0.45, 0.13, 0.8, m.white], [0.3, -0.6, 0.15, 1.0, m.foilSilver], [-0.1, 0, 0.1, 0.35, m.white],
    ];
    for (const [x, z, r, length, skin] of tubes) scope(g, m, skin, r, length, [x, 1.88, z]);
    scope(g, m, m.foilSilver, 0.17, 2.9, [-1.24, -0.55, 0.2]); // a long ultraviolet coronagraph down one side
    bus(g, m.white, 0.5, 1.7, 0.7, { x: 1.3, y: 0.95, z: -0.4, bevel: 0.04 }); // spectrometer bolted to the other
    plate(g, m, m.lens, 0.3, 0.4, [1.3, 1.806, -0.4], [0, 1, 0]);
    plate(g, m, m.radiator, 1.3, 1.5, [0, 0.6, -1.052], [0, 0, -1], 3);
    plate(g, m, m.mirror, 1.4, 0.8, [1.152, -1.2, 0], [1, 0, 0], 5);
    wingPair(g, m, { width: 2.2, length: 2.9, panels: 2, root: 1.15, y: -1.2, yoke: 0.5, tilt: 0.25, tile: 0.4 });
    dish(g, m, 0.42, [0.5, -1.86, 0.3], [0.2, -1, 0.1]); // Earth is behind it
    cyl(g, m.dark, 0.6, 0.66, 0.1, 0, -1.84, 0, 'y', true, 24); // launcher adapter ring
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) thrusters(g, m, [x * 1.1, -1.7, z * 1.1], [x, -0.6, z], 1.8);
    tracker(g, m, [-1.16, -1.0, -0.7], [-1, 0.3, -0.3], 1.8);
    helix(g, m, [-0.8, -1.82, -0.7], [0, -1, 0], 0.22, 0.07);
    whip(g, m, [0.9, 1.88, -0.9], [0.3, 1, -0.3], 0.5, 0.012);
  },

  /**
   * Solar-wind monitor at the balance point a million and a half kilometres sunward of Earth
   * (ACE, Wind, DSCOVR and their kin): a short eight-sided drum, four solar panels laid out
   * like petals round its Sun-facing deck (+Y), particle instruments on the deck, magnetometers
   * out on long booms where the craft's own magnetism cannot reach them. 1 unit = 1 m.
   */
  l1monitor(g, m) {
    const R = 0.92, flat = R * Math.cos(Math.PI / 8);
    prism(g, m.foilBlack, 8, R, R, 0.95, 0, 0, 0, 0.6, Math.PI / 8);
    prism(g, m.foilGold, 8, R * 1.02, R * 1.02, 0.28, 0, -0.2, 0, 0.5, Math.PI / 8);
    prism(g, m.dark, 8, R * 1.05, R * 1.05, 0.05, 0, 0.5, 0, 0.6, Math.PI / 8); // Sun deck
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2, c = Math.cos(a), s = Math.sin(a);
      const petal = solarPanel(m, 0.76, 1.5, m.cellsBlue, m.panelBack, 0.25);
      petal.position.set(c * (flat + 0.87), 0.5, s * (flat + 0.87));
      petal.rotation.y = Math.PI / 2 - a; // its length runs outwards
      g.add(petal);
      for (const side of [-1, 1]) strut(g, m.metal, [c * flat - s * side * 0.25, 0.5, s * flat + c * side * 0.25], [c * (flat + 0.14) - s * side * 0.25, 0.5, s * (flat + 0.14) + c * side * 0.25], 0.02); // hinges
      // body-mounted cells on the sides between the petals
      const b = a + Math.PI / 4, cb = Math.cos(b), sb = Math.sin(b);
      plate(g, m, m.cellsBlue, 0.56, 0.4, [flat * 1.004 * cb, 0.2, flat * 1.004 * sb], [cb, 0, sb], 1 / 0.2);
      thrusters(g, m, [R * 1.0 * cb, -0.42, R * 1.0 * sb], [cb, -0.5, sb]);
    }
    for (const s of [-1, 1]) {
      lattice(g, m.metal, [0, 0.5, s * (flat + 1.62)], [0, 0.5, s * (flat + 2.75)], 0.05, 6); // magnetometer booms, off two of the petals
      box(g, m.foilGold, 0.14, 0.1, 0.16, 0, 0.5, s * (flat + 2.82));
      whip(g, m, [s * (flat + 1.62), 0.5, 0], [s, 0, 0], 1.1, 0.008); // wire antennas that listen to radio waves in the wind
    }
    whip(g, m, [0, 0.52, 0], [0, 1, 0], 1.0, 0.01);
    // Particle instruments looking into the wind.
    bus(g, m.foilGold, 0.34, 0.26, 0.3, { x: 0.4, y: 0.65, z: 0.3, bevel: 0.03, tile: 0.4 });
    bus(g, m.white, 0.28, 0.2, 0.36, { x: -0.42, y: 0.62, z: 0.25, bevel: 0.03 });
    scope(g, m, m.foilSilver, 0.11, 0.3, [-0.3, 0.52, -0.4]);
    scope(g, m, m.white, 0.08, 0.22, [0.35, 0.52, -0.35], [0.3, 1, -0.2]);
    cyl(g, m.goldPlate, 0.14, 0.16, 0.1, 0.05, 0.57, -0.05, 'y', false, 16);
    cyl(g, m.metal, 0.52, 0.52, 0.08, 0, -0.5, 0, 'y', true, 24); // launcher adapter ring
    dish(g, m, 0.4, [0.1, -0.52, 0], [0.1, -1, 0]); // Earth is straight behind
    helix(g, m, [-0.5, -0.48, 0.3], [0, -1, 0], 0.14, 0.045);
    tracker(g, m, [flat, -0.1, 0], [1, -0.3, 0.3]);
  },

  /**
   * STEREO: one of two twins that watch the Sun from ahead of and behind the Earth. A foil box
   * with two wings, telescopes on the Sun-facing deck (+Y), a dish on a gimbal, and — its
   * signature — three six-metre radio antennas splayed out behind like the legs of a tripod.
   * 1 unit = 1 m.
   */
  stereo(g, m) {
    bus(g, m.foilGold, 1.3, 1.2, 1.9, { bevel: 0.07 });
    bus(g, m.foilBlack, 1.34, 0.2, 1.94, { y: -0.45, bevel: 0.03 });
    bus(g, m.dark, 1.36, 0.05, 1.96, { y: 0.62, bevel: 0.015 }); // Sun deck
    plate(g, m, m.mirror, 0.9, 0.6, [0.652, 0.15, 0], [1, 0, 0], 5);
    wingPair(g, m, { width: 1.2, length: 2.1, panels: 2, root: 0.95, y: 0.2, yoke: 0.3, tilt: 0.35, tile: 0.3 });
    scope(g, m, m.white, 0.13, 0.9, [0.3, 0.64, 0.5]); // coronagraphs and the ultraviolet imager
    scope(g, m, m.white, 0.1, 0.7, [0.32, 0.64, 0.12]);
    scope(g, m, m.foilSilver, 0.14, 0.55, [0.25, 0.64, -0.35]);
    bus(g, m.white, 0.5, 0.3, 0.7, { x: -0.32, y: 0.8, z: -0.2, bevel: 0.03 }); // the camera that follows storms all the way to Earth
    for (let k = 0; k < 4; k++) box(g, m.dark, 0.5, 0.1 + k * 0.03, 0.012, -0.32, 1.0 + k * 0.015, 0.1 - k * 0.14); // its stepped baffles
    for (const d of [[0.816, -0.577, 0], [-0.408, -0.577, 0.707], [-0.408, -0.577, -0.707]] as V3[]) {
      cyl(g, m.dark, 0.05, 0.05, 0.1, d[0] * 0.5, -0.6, d[2] * 0.6, 'y', false, 10);
      whip(g, m, [d[0] * 0.5, -0.62, d[2] * 0.6], d, 2.9, 0.014); // at right angles to each other, so any radio wave is caught
    }
    strut(g, m.metal, [-0.3, -0.6, 0.6], [-0.38, -2.4, 0.72], 0.03); // telescoping boom for the magnetometer and particle counters
    box(g, m.foilGold, 0.16, 0.14, 0.16, -0.38, -2.45, 0.72);
    box(g, m.foilGold, 0.14, 0.12, 0.14, -0.35, -1.7, 0.68);
    strut(g, m.dark, [-0.65, -0.3, -0.2], [-0.95, -0.42, -0.25], 0.03);
    dish(g, m, 0.6, [-1.0, -0.45, -0.25], [-1, -0.3, 0.1]);
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) thrusters(g, m, [x * 0.62, -0.5, z * 0.92], [x, -0.6, z]);
    tracker(g, m, [0.66, -0.2, -0.6], [1, 0.2, -0.4]);
    helix(g, m, [0.4, -0.58, -0.3], [0, -1, 0], 0.12, 0.04);
    helix(g, m, [-0.45, 0.65, 0.6], [0, 1, 0], 0.12, 0.04);
  },
} satisfies Partial<Record<ModelKind, Builder>>;
