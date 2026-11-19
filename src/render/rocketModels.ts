/**
 * 3D models of launch vehicles standing on the pad: Falcon 9 and Falcon Heavy, Starship,
 * Electron, Long March 5, Soyuz, Atlas V, Vulcan, Ariane 6, New Glenn, and a generic
 * two-stage rocket for everything else (describe.ts: rocketKind() picks one from a rocket's
 * name). They are drawn climbing from their pad during a launch. One builder per kind, made
 * from the kit in modelParts.ts and handed to satModels.ts, which merges, centres, scales and
 * caches every model the same way.
 *
 * Axes, unlike the satellites': +Y is UP the rocket's axis (nose up), and y = 0 is the bottom
 * of its lowest engine bell, so modelBase(kind) says how far to lift the normalised model to
 * stand it on the ground. Every rocket is built at 1 unit = 5 m and at its true proportions
 * (a Falcon 9 is nineteen times as tall as it is wide): normalised to 1 unit tall, they are
 * slim on purpose.
 *
 * Rockets are painted, stainless or foam-covered, which none of the shared materials are. The
 * materials made for them here are painted the first time a rocket is built, so that a visitor
 * who never sees a launch never pays for them (makeMaterials() runs at start-up).
 */

import * as THREE from 'three';
import type { ModelKind } from '../data/describe.ts';
import {
  TAU, paint, random, mesh, box, bus, cyl, hoop, slab, strut, tileUV, facets,
  type Builder, type Materials, type V3,
} from './modelParts.ts';

// ---------------------------------------------------------------------------------------
// Materials of their own: paint, steel, heat tiles, foam (made once, on first use)
// ---------------------------------------------------------------------------------------

/** Rocket paint: one colour with a faint ring joint along the top of each tile and a seam down one side. */
function paintedSkin(base: string, line: string): THREE.CanvasTexture {
  return paint(128, (ctx, size) => {
    const rand = random(61);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 4; i++) { // a few access panels and touched-up patches, barely there
      ctx.fillStyle = `rgba(0,0,0,${0.012 + rand() * 0.018})`;
      ctx.fillRect(rand() * size, rand() * size, 10 + rand() * 30, 8 + rand() * 20);
    }
    ctx.fillStyle = line;
    ctx.fillRect(0, 0, size, 1.5); // ring joint between barrel sections
    ctx.globalAlpha = 0.6;
    ctx.fillRect(size * 0.37, 0, 1, size); // weld seam along the barrel
    ctx.globalAlpha = 1;
  });
}

/**
 * A reflown Falcon booster: white paint, sooted from below by the engines that relit to bring
 * it home. The texture is laid once along the whole stage: clean at the top (the top of the
 * picture), grey streaks running up from the bottom.
 */
function sootedSkin(): THREE.CanvasTexture {
  return paint(256, (ctx, size) => {
    const rand = random(67);
    ctx.fillStyle = '#c9cdd2';
    ctx.fillRect(0, 0, size, size);
    const haze = ctx.createLinearGradient(0, size, 0, size * 0.25);
    haze.addColorStop(0, 'rgba(46,40,36,0.72)');
    haze.addColorStop(0.45, 'rgba(60,54,50,0.32)');
    haze.addColorStop(1, 'rgba(60,54,50,0)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 70; i++) { // streaks drawn upwards from the bottom, wrapped round the sides
      const x = rand() * size, w = 1 + rand() * 6, top = size * (0.25 + rand() * 0.7);
      const streak = ctx.createLinearGradient(0, size, 0, top);
      streak.addColorStop(0, `rgba(30,26,24,${0.25 + rand() * 0.35})`);
      streak.addColorStop(1, 'rgba(30,26,24,0)');
      ctx.fillStyle = streak;
      for (const ox of [-size, 0, size]) ctx.fillRect(x + ox, top, w, size - top);
    }
    ctx.fillStyle = 'rgba(70,74,80,0.6)';
    for (let k = 1; k < 8; k++) ctx.fillRect(0, (k * size) / 8, size, 1); // barrel joints
  });
}

/** Stainless steel: brushed streaks, a weld ring along the top of each tile, one vertical seam. */
function steelSkin(): THREE.CanvasTexture {
  return paint(256, (ctx, size) => {
    const rand = random(71);
    ctx.fillStyle = '#a3a9b0';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 160; i++) {
      const v = Math.round(140 + rand() * 70);
      ctx.fillStyle = `rgba(${v},${v + 3},${v + 6},0.18)`;
      ctx.fillRect(rand() * size, 0, 1 + rand() * 4, size);
    }
    for (let i = 0; i < 18; i++) { // faint straw and blue heat tints near the welds
      const y = rand() * size * 0.2, x = rand() * size;
      ctx.fillStyle = rand() < 0.5 ? 'rgba(170,140,90,0.12)' : 'rgba(110,120,160,0.12)';
      ctx.fillRect(x, y, 20 + rand() * 40, 6 + rand() * 10);
    }
    ctx.fillStyle = '#6c7178';
    ctx.fillRect(0, 0, size, 2);
    ctx.fillStyle = '#c4c9cf';
    ctx.fillRect(0, 2, size, 1);
    ctx.fillStyle = 'rgba(90,95,102,0.7)';
    ctx.fillRect(size * 0.62, 0, 1.5, size);
  });
}

/** The ship's heat shield: black hexagonal tiles with pale gaps, eight across and seven down per repeat. */
function tileSkin(): THREE.CanvasTexture {
  return paint(128, (ctx, size) => {
    const rand = random(73);
    ctx.fillStyle = '#5a5e66'; // the gaps
    ctx.fillRect(0, 0, size, size);
    const cols = 8, rows = 7, dx = size / cols, dy = size / rows, r = dx / 1.5;
    for (let c = -1; c <= cols; c++) for (let j = -1; j <= rows; j++) {
      const cx = c * dx, cy = j * dy + ((c & 1) ? dy / 2 : 0);
      const v = Math.round(22 + rand() * 14);
      ctx.fillStyle = `rgb(${v},${v + 1},${v + 4})`;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3;
        ctx.lineTo(cx + (r - 1) * Math.cos(a), cy + ((dy - 2) / Math.sqrt(3)) * Math.sin(a)); // squeezed a little so whole rows fit the tile
      }
      ctx.closePath();
      ctx.fill();
    }
  });
}

/** Carbon fibre: a fine twill of slightly lighter and darker strands. */
function weaveSkin(): THREE.CanvasTexture {
  return paint(64, (ctx, size) => {
    ctx.fillStyle = '#2f3238';
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 4) for (let x = 0; x < size; x += 8) {
      ctx.fillStyle = (x / 8 + y / 4) % 2 ? '#3b3f47' : '#282b31';
      ctx.fillRect(x + ((y / 4) % 2) * 4, y, 8, 4);
    }
  });
}

/** Spray-on foam insulation: an even colour with soft mottling and ring joints. */
function foamSkin(base: string): THREE.CanvasTexture {
  return paint(128, (ctx, size) => {
    const rand = random(79);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 120; i++) {
      const x = rand() * size, y = rand() * size, rr = 3 + rand() * 12;
      ctx.fillStyle = rand() < 0.5 ? 'rgba(255,240,220,0.06)' : 'rgba(60,30,10,0.07)';
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(70,40,20,0.35)';
    ctx.fillRect(0, 0, size, 1.5);
  });
}

function makeRocketMaterials(m: Materials) {
  const env = m.metal.envMap; // the same painted surroundings every other model reflects
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ envMap: env, ...p });
  // Brightness budget as in modelParts.ts: pale paint stays near 75 % grey and rough, or the
  // headlight in the main view turns a long white barrel into one glare.
  return {
    paint: std({ map: paintedSkin('#c6cad0', '#8f959d'), metalness: 0.05, roughness: 0.72, envMapIntensity: 0.5 }),
    sooted: std({ map: sootedSkin(), metalness: 0.05, roughness: 0.78, envMapIntensity: 0.45 }),
    steel: std({ map: steelSkin(), metalness: 0.78, roughness: 0.44, envMapIntensity: 1.25 }),
    tiles: std({ map: tileSkin(), metalness: 0.1, roughness: 0.8, envMapIntensity: 0.5 }),
    carbon: std({ map: weaveSkin(), metalness: 0.35, roughness: 0.5, envMapIntensity: 0.9 }),
    copper: std({ map: paintedSkin('#b97a52', '#7d4f33'), metalness: 0.2, roughness: 0.62, envMapIntensity: 0.7 }), // Atlas V's booster: bare aluminium anodised and Tiodized, which darkens to copper (it has no foam)
    orange: std({ map: foamSkin('#c26a30'), metalness: 0, roughness: 0.85, envMapIntensity: 0.35 }), // Vulcan's booster: spray-on foam, orange like Delta IV's
    greyGreen: std({ map: paintedSkin('#a5ad9f', '#737b6f'), metalness: 0.05, roughness: 0.72, envMapIntensity: 0.5 }), // Soyuz
  };
}
type RocketMaterials = ReturnType<typeof makeRocketMaterials>;
let made: RocketMaterials | null = null;
const kit = (m: Materials): RocketMaterials => (made ??= makeRocketMaterials(m));

// ---------------------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------------------

/** A stretch of round body from y0 to y1 (open tube), its texture repeated about every `tile` units. */
function barrel(g: THREE.Group, material: THREE.Material, r: number, y0: number, y1: number, x = 0, z = 0, segments = 32, tile = 0.7): THREE.Mesh {
  const part = cyl(g, material, r, r, y1 - y0, x, (y0 + y1) / 2, z, 'y', true, segments);
  tileUV(part.geometry, Math.max(1, Math.round((TAU * r) / tile)), Math.max(1, Math.round((y1 - y0) / tile)));
  return part;
}

/** A cone or flare from radius r0 at y0 to r1 at y1 (open). */
function taper(g: THREE.Group, material: THREE.Material, r0: number, r1: number, y0: number, y1: number, x = 0, z = 0, segments = 32): THREE.Mesh {
  return cyl(g, material, r1, r0, y1 - y0, x, (y0 + y1) / 2, z, 'y', true, segments);
}

/**
 * A nose: a tangent ogive (the curve of most fairings and booster tips) from radius r at y0 to
 * a point `length` higher, `blunt` = how much of the tip is rounded off (0 = sharp).
 * phiStart/phiLength cut out part of it (the Starship nose is half steel, half tiles).
 */
function ogive(g: THREE.Group, material: THREE.Material, r: number, length: number, y0: number, x = 0, z = 0, blunt = 0.06, segments = 32, phiStart = 0, phiLength = TAU, tile = 0.7): THREE.Mesh {
  const rho = (r * r + length * length) / (2 * r);
  const points: THREE.Vector2[] = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const h = (length * i) / steps;
    let radius = Math.sqrt(Math.max(0, rho * rho - h * h)) - (rho - r);
    if (i === steps) radius = 0;
    else if (blunt > 0 && h > length * (1 - blunt)) radius = Math.max(radius, r * 0.08 * Math.sqrt(1 - (h - length * (1 - blunt)) / (length * blunt))); // a rounded tip
    points.push(new THREE.Vector2(Math.max(0, radius), h));
  }
  const geometry = new THREE.LatheGeometry(points, facets(segments, 10), phiStart, phiLength);
  tileUV(geometry, Math.max(1, Math.round(((phiLength / TAU) * TAU * r) / tile)), Math.max(1, Math.round(length / tile)));
  return mesh(g, geometry, material, x, y0, z);
}

/** A cheap engine bell hanging down from yTop (throat) to yTop − length (lip). Nobody counts the facets of a bell under a rocket. */
function bell(g: THREE.Group, m: Materials, r: number, length: number, x: number, yTop: number, z: number, segments = 14): void {
  // listed from the lip upwards, so the faces point outwards
  const points = [1, 0.66, 0.33, 0].map((t) => new THREE.Vector2(r * (0.34 + 0.66 * Math.sqrt(t)), -length * t));
  const geometry = new THREE.LatheGeometry(points, segments);
  const uv = geometry.attributes.uv; // the nozzle texture is dark at the throat (v = 0), pale at the lip
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  mesh(g, geometry, m.nozzle, x, yTop, z);
}

/** Engines in rings: [count, ring radius] pairs (a count of 1 with radius 0 is the centre engine). */
function engineCluster(g: THREE.Group, m: Materials, rings: [number, number][], r: number, length: number, yTop: number, x = 0, z = 0, turn = 0, segments = 14): void {
  for (const [count, radius] of rings) {
    for (let k = 0; k < count; k++) {
      const a = turn + (k * TAU) / count;
      bell(g, m, r, length, x + radius * Math.cos(a), yTop, z + radius * Math.sin(a), segments);
    }
  }
}

/** Unit vectors for a point on the body at angle `a` round the axis: out from the axis, and along the surface. */
const radial = (a: number): V3 => [Math.cos(a), 0, Math.sin(a)];

/**
 * A fin, strake or flap in the plane through the rocket's axis at angle `a`: `outline` gives its
 * corners as [distance from the axis, height] (convex), `thick` its thickness. faceted() needs a
 * solid built round its own origin, so the outline is centred first and the part moved back.
 */
function fin(g: THREE.Group, material: THREE.Material, outline: (readonly [number, number])[], thick: number, a: number, x = 0, z = 0, shift = 0): void {
  const cx = outline.reduce((s, p) => s + p[0], 0) / outline.length, cy = outline.reduce((s, p) => s + p[1], 0) / outline.length;
  const sub = new THREE.Group();
  slab(sub, material, outline.map(([u, v]) => [u - cx, v - cy] as const), thick, 0, 0, 0, 0.5);
  const out = new THREE.Vector3(...radial(a)), across = new THREE.Vector3(Math.sin(a), 0, -Math.cos(a));
  // slab: outline in its X/Z, thickness along Y → X = out from the axis, Y = across, Z = up the rocket
  sub.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(out, across, new THREE.Vector3(0, 1, 0)));
  sub.position.set(x + out.x * cx + across.x * shift, cy, z + out.z * cx + across.z * shift);
  g.add(sub);
}

/**
 * A grid fin: a frame with a lattice of thin plates at 45°, through which the air flows.
 * Built in the XY plane (w along X, h along Y, the cells `depth` deep along Z), then placed
 * with its X and Y along the given directions.
 */
function gridFin(g: THREE.Group, material: THREE.Material, w: number, h: number, depth: number, pitch: number, at: V3, xDir: V3, yDir: V3): void {
  const f = new THREE.Group();
  const t = Math.min(w, h) * 0.05;
  for (const s of [-1, 1]) {
    box(f, material, w, t * 1.6, depth, 0, (s * h) / 2, 0);
    box(f, material, t * 1.6, h, depth, (s * w) / 2, 0, 0);
  }
  const bar = (x0: number, y0: number, x1: number, y1: number) => {
    const length = Math.hypot(x1 - x0, y1 - y0);
    if (length < t) return;
    const part = box(f, material, length, t * 0.55, depth * 0.96, (x0 + x1) / 2, (y0 + y1) / 2, 0);
    part.rotation.z = Math.atan2(y1 - y0, x1 - x0);
  };
  const hw = w / 2, hh = h / 2;
  for (let c = -(hw + hh) + pitch / 2; c < hw + hh; c += pitch) {
    // lines x − y = c and x + y = c, clipped to the frame
    const a0 = Math.max(-hw, -hh + c), a1 = Math.min(hw, hh + c);
    if (a1 > a0) bar(a0, a0 - c, a1, a1 - c);
    const b0 = Math.max(-hw, c - hh), b1 = Math.min(hw, c + hh);
    if (b1 > b0) bar(b0, c - b0, b1, c - b1);
  }
  const x = new THREE.Vector3(...xDir).normalize(), y = new THREE.Vector3(...yDir).normalize();
  f.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, new THREE.Vector3().crossVectors(x, y)));
  f.position.set(at[0], at[1], at[2]);
  g.add(f);
}

/** A fairing: optional flare from the stage below, a cylinder, an ogive nose; split lines down two sides. */
function fairing(g: THREE.Group, m: Materials, skin: THREE.Material, below: number, r: number, y0: number, flare: number, straight: number, nose: number, x = 0, z = 0, splitAt = 0): number {
  if (flare > 0) taper(g, skin, below, r, y0, y0 + flare, x, z);
  const y1 = y0 + flare, y2 = y1 + straight;
  barrel(g, skin, r, y1, y2, x, z);
  ogive(g, skin, r, nose, y2, x, z, 0.06);
  for (const s of [0, Math.PI]) { // the two halves' split line
    const a = splitAt + s;
    box(g, m.dark, 0.012, straight, 0.012, x + (r + 0.002) * Math.cos(a), (y1 + y2) / 2, z + (r + 0.002) * Math.sin(a));
  }
  hoop(g, m.dark, r * 1.003, 0.006, x, y1 + 0.01, z, 'y', 32); // separation joint at its base
  return y2 + nose;
}

/** A disc closing a body from below, so the hollow tubes are never seen into. */
function floor(g: THREE.Group, m: Materials, r: number, y: number, x = 0, z = 0): void {
  cyl(g, m.dark, r * 0.995, r * 0.995, 0.03, x, y, z, 'y', false, 24);
}

/** A cable raceway: the long narrow conduit along the outside of a stage, at angle `a`. */
function raceway(g: THREE.Group, material: THREE.Material, r: number, y0: number, y1: number, a: number, w = 0.05, x = 0, z = 0): void {
  const part = box(g, material, w, y1 - y0, w * 0.7, x + (r + w * 0.3) * Math.cos(a), (y0 + y1) / 2, z + (r + w * 0.3) * Math.sin(a));
  part.rotation.y = Math.PI / 2 - a; // wide across the surface, thin outwards
}

// ---------------------------------------------------------------------------------------
// Falcon (the core is shared by Falcon 9 and Falcon Heavy)
// ---------------------------------------------------------------------------------------

/**
 * A Falcon first stage: nine Merlins under an octaweb, a sooted white tank 41 m long, four
 * black landing legs folded against it (hinged at the bottom, feet uppermost), a black
 * carbon interstage with four grid fins folded flat and the cold-gas thruster pods. With
 * `nose`, it is a Falcon Heavy side booster and ends in a white nose cone instead of carrying
 * the second stage. Returns the height of its top.
 */
function falconCore(g: THREE.Group, m: Materials, r: RocketMaterials, x: number, nose: boolean): number {
  const R = 0.37; // 3.7 m across
  engineCluster(g, m, [[1, 0], [8, 0.24]], 0.085, 0.24, 0.25, x, 0, Math.PI / 8);
  floor(g, m, R, 0.255, x, 0);
  barrel(g, m.carbon, R * 0.98, 0.25, 0.42, x, 0, 32); // octaweb skirt
  const tank = cyl(g, r.sooted, R, R, 8.3 - 0.42, x, (8.3 + 0.42) / 2, 0, 'y', true, 40);
  tileUV(tank.geometry, 3, 1); // the soot is laid ONCE along the whole stage
  for (let k = 0; k < 4; k++) { // landing legs, folded
    const a = Math.PI / 4 + (k * Math.PI) / 2, [cx, , cz] = radial(a);
    const leg = bus(g, r.carbon, 0.2, 2.05, 0.05, { top: 0.5, bevel: 0.012, tile: 0.4 });
    leg.position.set(x + cx * (R + 0.03), 0.42 + 1.025, cz * (R + 0.03));
    leg.rotation.y = Math.PI / 2 - a;
    const foot = box(g, m.dark, 0.13, 0.09, 0.05, x + cx * (R + 0.05), 2.47, cz * (R + 0.05));
    foot.rotation.y = Math.PI / 2 - a;
    strut(g, m.metal, [x + cx * (R + 0.05), 0.5, cz * (R + 0.05)], [x + cx * (R + 0.05), 1.7, cz * (R + 0.05)], 0.012); // the pusher inside, showing at the edge
  }
  raceway(g, m.white, R, 0.6, 8.3, Math.PI, 0.06, x, 0);
  const top = 8.3;
  if (!nose) {
    barrel(g, r.carbon, R + 0.003, top, 9.6, x, 0, 32); // interstage (black carbon)
    hoop(g, m.dark, R + 0.004, 0.008, x, top + 0.02, 0, 'y', 32);
  } else {
    barrel(g, r.carbon, R + 0.003, top, 9.05, x, 0, 32); // a side booster's short interstage …
    ogive(g, r.paint, R + 0.003, 1.5, 9.05, x, 0, 0.08); // … and its white nose cone
  }
  const finY = nose ? 8.75 : 9.25;
  for (let k = 0; k < 4; k++) { // grid fins, folded up flat against the interstage
    const a = (k * Math.PI) / 2, [cx, , cz] = radial(a);
    gridFin(g, m.dullMetal, 0.24, 0.3, 0.05, 0.075, [x + cx * (R + 0.04), finY, cz * (R + 0.04)], [-cz, 0, cx], [0, 1, 0]);
    box(g, m.dark, 0.08, 0.06, 0.06, x + cx * (R + 0.02), finY - 0.18, cz * (R + 0.02)).rotation.y = -a; // actuator housing
  }
  for (const a of [Math.PI / 4, (5 * Math.PI) / 4]) { // nitrogen thruster pods
    const [cx, , cz] = radial(a);
    box(g, m.dark, 0.09, 0.12, 0.06, x + cx * (R + 0.02), finY + 0.05, cz * (R + 0.02)).rotation.y = Math.PI / 2 - a;
  }
  return nose ? 9.05 + 1.5 : 9.6;
}

/** The Falcon second stage and its 5.2 m fairing, from `y` upwards. */
function falconUpper(g: THREE.Group, m: Materials, r: RocketMaterials, y: number): void {
  const R = 0.37;
  barrel(g, r.paint, R, y, y + 1.75, 0, 0, 40);
  raceway(g, m.white, R, y + 0.05, y + 1.7, Math.PI, 0.05);
  hoop(g, m.dark, R + 0.002, 0.008, 0, y + 1.75, 0, 'y', 32);
  fairing(g, m, r.paint, R, 0.52, y + 1.75, 0.25, 1.35, 1.1, 0, 0, Math.PI / 2);
}

// ---------------------------------------------------------------------------------------
// One builder per rocket
// ---------------------------------------------------------------------------------------

export const ROCKET_BUILDERS = {
  /** Falcon 9 Block 5: 70 m tall, 3.7 m wide; sooted reusable first stage, black interstage, 5.2 m fairing. */
  falcon9(g, m) {
    const r = kit(m);
    falconUpper(g, m, r, falconCore(g, m, r, 0, false));
  },

  /** Falcon Heavy: three Falcon 9 first stages side by side; the side boosters wear nose cones. */
  falconheavy(g, m) {
    const r = kit(m);
    falconUpper(g, m, r, falconCore(g, m, r, 0, false));
    for (const s of [-1, 1]) {
      falconCore(g, m, r, s * 0.79, true);
      for (const y of [1.2, 7.6]) strut(g, m.metal, [s * 0.37, y, 0], [s * 0.42, y, 0], 0.035); // attach fittings
    }
  },

  /**
   * Starship: Super Heavy (71 m, 33 Raptors, four grid fins sticking straight out, a vented
   * hot-staging ring on top) and the Ship (52 m): steel on its leeward side, black hexagonal
   * heat tiles on its windward side (−X here), two small flaps on its nose, two large at its base.
   */
  starship(g, m) {
    const r = kit(m);
    const R = 0.9; // 9 m across
    // --- Super Heavy ---
    engineCluster(g, m, [[3, 0.13], [10, 0.45], [20, 0.77]], 0.115, 0.3, 0.32, 0, 0, 0, 12);
    floor(g, m, R, 0.33);
    barrel(g, r.steel, R, 0.32, 0.9, 0, 0, 48); // aft skirt …
    for (let k = 0; k < 8; k++) { // … with its engine-bay shields
      const a = (k * TAU) / 8, [cx, , cz] = radial(a);
      box(g, m.dullMetal, 0.32, 0.3, 0.03, cx * (R + 0.012), 0.55, cz * (R + 0.012)).rotation.y = Math.PI / 2 - a;
    }
    barrel(g, r.steel, R, 0.9, 14.2, 0, 0, 48);
    raceway(g, r.steel, R, 1.0, 13.8, Math.PI / 2, 0.12);
    // hot-staging ring: an open band of vents the ship's engines light through
    barrel(g, m.baffle, R * 0.97, 14.2, 14.58, 0, 0, 48);
    for (let k = 0; k < 24; k++) {
      const a = (k * TAU) / 24, [cx, , cz] = radial(a);
      box(g, r.steel, 0.07, 0.38, 0.05, cx * R, 14.39, cz * R).rotation.y = Math.PI / 2 - a;
    }
    for (const y of [14.2, 14.58]) hoop(g, r.steel, R, 0.02, 0, y, 0, 'y', 48);
    // four grid fins in two pairs, standing straight out; the tower catches the booster under the pair's pins
    for (const centre of [Math.PI / 2, -Math.PI / 2]) {
      for (const d of [-0.5, 0.5]) {
        const a = centre + d, [cx, , cz] = radial(a);
        gridFin(g, m.dullMetal, 0.62, 0.78, 0.09, 0.13, [cx * (R + 0.42), 13.75, cz * (R + 0.42)], [-cz, 0, cx], [cx, 0, cz]);
        box(g, m.dark, 0.2, 0.22, 0.18, cx * (R + 0.06), 13.75, cz * (R + 0.06)).rotation.y = -a; // hinge housing
      }
      const [cx, , cz] = radial(centre);
      box(g, r.steel, 0.16, 0.12, 0.3, cx * (R + 0.12), 13.25, cz * (R + 0.12)).rotation.y = -centre; // catch pin
    }
    // --- Ship ---
    const y0 = 14.58, yNose = 22.2, nose = 2.75;
    const steelHalf = new THREE.CylinderGeometry(R, R, yNose - y0, facets(24), 1, true, 0, Math.PI);
    tileUV(steelHalf, 4, 11);
    mesh(g, steelHalf, r.steel, 0, (y0 + yNose) / 2, 0);
    const tileHalf = new THREE.CylinderGeometry(R, R, yNose - y0, facets(24), 1, true, Math.PI, Math.PI);
    tileUV(tileHalf, 5, 9);
    mesh(g, tileHalf, r.tiles, 0, (y0 + yNose) / 2, 0);
    ogive(g, r.steel, R, nose, yNose, 0, 0, 0.12, 24, 0, Math.PI, 0.7);
    ogive(g, r.tiles, R, nose, yNose, 0, 0, 0.12, 24, Math.PI, Math.PI, 0.6);
    // flaps: tiled on the windward face (−X), steel behind
    const ogiveR = (h: number) => { const rho = (R * R + nose * nose) / (2 * R); return Math.sqrt(Math.max(0, rho * rho - h * h)) - (rho - R); };
    for (const a of [Math.PI / 2, -Math.PI / 2]) {
      const aft: [number, number][] = [[R - 0.04, y0 + 0.2], [R + 0.95, y0 + 0.45], [R + 0.95, y0 + 1.75], [R - 0.04, y0 + 2.35]];
      // `across` is +X for the flap at +Z and −X for the one at −Z: the tiles go to the −X side of each
      fin(g, r.tiles, aft, 0.06, a, 0, 0, a > 0 ? -0.03 : 0.03);
      fin(g, r.steel, aft, 0.04, a, 0, 0, a > 0 ? 0.02 : -0.02);
      const h0 = 0.25, h1 = 1.75;
      const fwd: [number, number][] = [[ogiveR(h0) - 0.04, yNose + h0], [ogiveR(h0) + 0.55, yNose + h0 + 0.2], [ogiveR(h1) + 0.38, yNose + h1 - 0.15], [ogiveR(h1) - 0.04, yNose + h1]];
      fin(g, r.tiles, fwd, 0.05, a, 0, 0, a > 0 ? -0.025 : 0.025);
      fin(g, r.steel, fwd, 0.03, a, 0, 0, a > 0 ? 0.015 : -0.015);
    }
    raceway(g, r.steel, R, y0 + 2.5, yNose - 0.1, 0, 0.1); // the ship's leeward raceway
  },

  /** Electron: 18 m of black carbon fibre, 1.2 m across; nine small engines, a single-engine second stage, a 1.2 m fairing. */
  electron(g, m) {
    const r = kit(m);
    const R = 0.12;
    engineCluster(g, m, [[1, 0], [8, 0.075]], 0.026, 0.07, 0.07, 0, 0, Math.PI / 8, 10);
    floor(g, m, R, 0.075);
    barrel(g, r.carbon, R, 0.07, 2.4, 0, 0, 24, 0.25);
    raceway(g, r.carbon, R, 0.15, 2.35, Math.PI, 0.02);
    for (const y of [0.08, 1.2, 2.4]) hoop(g, m.metal, R + 0.001, 0.004, 0, y, 0, 'y', 24); // metal joint rings
    barrel(g, r.carbon, R + 0.002, 2.4, 2.62, 0, 0, 24, 0.25); // interstage
    barrel(g, r.carbon, R, 2.62, 3.05, 0, 0, 24, 0.25); // second stage
    fairing(g, m, r.carbon, R, R + 0.005, 3.05, 0, 0.18, 0.33, 0, 0, 0);
    for (let k = 0; k < 4; k++) { // white markings stand out on the black: the stage numbers and badge panels
      const a = Math.PI / 2 + (k * Math.PI) / 2, [cx, , cz] = radial(a);
      if (k % 2 === 0) box(g, m.white, 0.04, 0.5, 0.004, cx * (R + 0.001), 1.6, cz * (R + 0.001)).rotation.y = Math.PI / 2 - a;
    }
  },

  /**
   * Long March 5: a 5 m hydrogen core stage, four 3.35 m kerosene boosters with conical noses,
   * a second stage and a 5.2 m fairing; 57 m tall, all white.
   */
  longmarch(g, m) {
    const r = kit(m);
    const R = 0.5, B = 0.335, D = R + B + 0.015;
    engineCluster(g, m, [[2, 0.2]], 0.14, 0.32, 0.36, 0, 0, Math.PI / 4);
    floor(g, m, R, 0.37);
    barrel(g, r.paint, R, 0.36, 6.6, 0, 0, 40);
    for (const y of [2.6, 4.9]) hoop(g, m.dark, R + 0.002, 0.01, 0, y, 0, 'y', 40); // tank joints
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2, [cx, , cz] = radial(a), bx = cx * D, bz = cz * D;
      engineCluster(g, m, [[2, 0.13]], 0.1, 0.25, 0.27, bx, bz, a + Math.PI / 2, 12);
      floor(g, m, B, 0.28, bx, bz);
      barrel(g, r.paint, B, 0.27, 4.45, bx, bz, 28);
      hoop(g, m.dark, B + 0.002, 0.008, bx, 2.4, bz, 'y', 28);
      taper(g, r.paint, B, 0.04, 4.45, 5.55, bx, bz, 28); // the conical nose
      fin(g, r.paint, [[B - 0.02, 0.3], [B + 0.18, 0.3], [B + 0.1, 0.95], [B - 0.02, 1.05]], 0.03, a, bx, bz); // tail fin
      for (const y of [0.9, 4.2]) strut(g, m.metal, [cx * (R - 0.02), y, cz * (R - 0.02)], [cx * (D - B + 0.02), y, cz * (D - B + 0.02)], 0.03);
    }
    raceway(g, m.white, R, 0.5, 6.5, 0, 0.07);
    barrel(g, m.carbon, R + 0.003, 6.6, 6.85, 0, 0, 40); // interstage
    barrel(g, r.paint, R, 6.85, 8.4, 0, 0, 40);
    fairing(g, m, r.paint, R, 0.52, 8.4, 0.05, 1.45, 1.1, 0, 0, 0);
  },

  /**
   * Soyuz-2: the R-7's shape — a waisted core stage, four tapering boosters leaning on it, each
   * with a little air rudder, an open lattice truss under the third stage, a bulbous fairing.
   * Painted pale grey-green.
   */
  soyuzrocket(g, m) {
    const r = kit(m);
    const coreProfile: [number, number][] = [[0.205, 0.33], [0.21, 1.2], [0.24, 2.6], [0.28, 4.0], [0.295, 4.7], [0.295, 5.35], [0.27, 5.65], [0.25, 5.9]];
    const core = mesh(g, new THREE.LatheGeometry(coreProfile.map(([rr, y]) => new THREE.Vector2(rr, y)), facets(32)), r.greyGreen);
    tileUV(core.geometry, 3, 8);
    engineCluster(g, m, [[4, 0.09]], 0.07, 0.22, 0.33, 0, 0, Math.PI / 4, 12);
    floor(g, m, 0.205, 0.34);
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2, [cx, , cz] = radial(a);
      const booster = new THREE.Group();
      const profile: [number, number][] = [[0.268, 0], [0.266, 0.9], [0.24, 2.0], [0.18, 3.0], [0.1, 3.7], [0.03, 4.1], [0, 4.2]];
      const shell = mesh(booster, new THREE.LatheGeometry(profile.map(([rr, y]) => new THREE.Vector2(rr, y)), facets(24)), r.greyGreen);
      tileUV(shell.geometry, 3, 6);
      engineCluster(booster, m, [[4, 0.1]], 0.065, 0.22, 0.0, 0, 0, Math.PI / 4, 10);
      cyl(booster, m.dark, 0.265, 0.265, 0.02, 0, 0.005, 0, 'y', false, 24);
      fin(booster, r.greyGreen, [[0.25, 0.05], [0.42, 0.05], [0.36, 0.32], [0.25, 0.42]], 0.025, 0); // air rudder, on the outer side
      booster.position.set(cx * 0.475, 0.33 - 0.0, cz * 0.475);
      booster.rotation.y = -a;
      booster.rotateZ(0.045); // tipped in, so its point rests against the core
      g.add(booster);
    }
    // the third stage stands on an open truss: its engine lights before the core stage lets go
    hoop(g, m.dark, 0.25, 0.012, 0, 5.9, 0, 'y', 24);
    hoop(g, m.dark, 0.266, 0.012, 0, 6.25, 0, 'y', 24);
    for (let k = 0; k < 12; k++) {
      const a = (k * TAU) / 12, b = ((k + 1) * TAU) / 12;
      strut(g, m.dark, [0.25 * Math.cos(a), 5.9, 0.25 * Math.sin(a)], [0.266 * Math.cos(b), 6.25, 0.266 * Math.sin(b)], 0.01);
      strut(g, m.dark, [0.25 * Math.cos(b), 5.9, 0.25 * Math.sin(b)], [0.266 * Math.cos(a), 6.25, 0.266 * Math.sin(a)], 0.01);
    }
    cyl(g, m.dark, 0.2, 0.25, 0.05, 0, 5.92, 0, 'y', false, 20);
    bell(g, m, 0.12, 0.2, 0, 6.24, 0, 14);
    barrel(g, r.greyGreen, 0.266, 6.25, 7.55, 0, 0, 32);
    hoop(g, m.dark, 0.268, 0.008, 0, 6.9, 0, 'y', 32);
    fairing(g, m, r.paint, 0.266, 0.41, 7.55, 0.3, 0.95, 1.0, 0, 0, Math.PI / 2);
  },

  /** Atlas V 551: a copper-coloured common core booster, five white solid boosters, a 5 m fairing over the Centaur stage. */
  atlasv(g, m) {
    const r = kit(m);
    const R = 0.381, S = 0.079;
    engineCluster(g, m, [[2, 0.14]], 0.13, 0.3, 0.33, 0, 0, 0, 16); // RD-180: one engine, two chambers
    floor(g, m, R, 0.34);
    barrel(g, m.carbon, R * 0.98, 0.32, 0.5, 0, 0, 32); // aft skirt
    barrel(g, r.copper, R, 0.5, 6.9, 0, 0, 40);
    raceway(g, m.white, R, 0.6, 6.8, Math.PI, 0.05);
    for (const a of [-1.9, -0.95, 0, 0.95, 1.9]) { // five solid boosters, none on the umbilical side
      const [cx, , cz] = radial(a), bx = cx * (R + S + 0.01), bz = cz * (R + S + 0.01);
      bell(g, m, 0.065, 0.18, bx, 0.33, bz, 10);
      barrel(g, m.white, S, 0.33, 4.35, bx, bz, 16, 0.5);
      ogive(g, m.white, S, 0.45, 4.35, bx, bz, 0.05, 16);
      for (const y of [0.6, 4.0]) strut(g, m.metal, [cx * R, y, cz * R], [bx, y, bz], 0.012);
    }
    taper(g, r.paint, R, 0.54, 6.9, 7.35); // the fairing's boat-tail
    fairing(g, m, r.paint, R, 0.54, 7.35, 0, 3.0, 1.75, 0, 0, Math.PI / 2);
    for (const y of [8.3, 9.3]) hoop(g, m.dark, 0.542, 0.004, 0, y, 0, 'y', 40);
  },

  /** Vulcan Centaur: a 5.4 m orange booster with two methane engines, four solid boosters, a white Centaur V and fairing. */
  vulcan(g, m) {
    const r = kit(m);
    const R = 0.54, S = 0.16;
    engineCluster(g, m, [[2, 0.2]], 0.16, 0.36, 0.4, 0, 0, 0, 16);
    floor(g, m, R, 0.41);
    barrel(g, m.carbon, R * 0.98, 0.38, 0.6, 0, 0, 40);
    barrel(g, r.orange, R, 0.6, 7.0, 0, 0, 40);
    raceway(g, r.orange, R, 0.7, 6.9, Math.PI, 0.07);
    for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
      const [cx, , cz] = radial(a), bx = cx * (R + S + 0.01), bz = cz * (R + S + 0.01);
      bell(g, m, 0.11, 0.25, bx, 0.36, bz, 12);
      barrel(g, m.white, S, 0.36, 4.4, bx, bz, 20, 0.5);
      ogive(g, m.white, S, 0.7, 4.4, bx, bz, 0.05, 20);
      for (const y of [0.7, 4.1]) strut(g, m.metal, [cx * R, y, cz * R], [bx, y, bz], 0.018);
    }
    barrel(g, r.paint, R + 0.002, 7.0, 7.5, 0, 0, 40); // interstage
    barrel(g, r.paint, R, 7.5, 8.8, 0, 0, 40); // Centaur V
    for (const y of [7.5, 8.8]) hoop(g, m.dark, R + 0.002, 0.01, 0, y, 0, 'y', 40);
    fairing(g, m, r.paint, R, R, 8.8, 0, 1.6, 1.95, 0, 0, Math.PI / 2);
  },

  /** Ariane 64: a white 5.4 m hydrogen core with one Vulcain engine, four P120C solid boosters, the upper stage and fairing. */
  ariane6(g, m) {
    const r = kit(m);
    const R = 0.54, S = 0.17;
    bell(g, m, 0.21, 0.42, 0, 0.44, 0, 20); // Vulcain 2.1
    floor(g, m, R, 0.45);
    barrel(g, m.carbon, R * 0.97, 0.42, 0.62, 0, 0, 40);
    barrel(g, r.paint, R, 0.62, 6.1, 0, 0, 40);
    hoop(g, m.dark, R + 0.002, 0.01, 0, 3.6, 0, 'y', 40);
    for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
      const [cx, , cz] = radial(a), bx = cx * (R + S + 0.012), bz = cz * (R + S + 0.012);
      bell(g, m, 0.13, 0.32, bx, 0.32, bz, 14);
      barrel(g, r.paint, S, 0.32, 3.0, bx, bz, 20, 0.5);
      taper(g, r.paint, S, 0.02, 3.0, 3.65, bx, bz, 20);
      hoop(g, m.dark, S + 0.002, 0.006, bx, 1.7, bz, 'y', 20);
      for (const y of [0.7, 2.8]) strut(g, m.metal, [cx * R, y, cz * R], [bx, y, bz], 0.02);
    }
    barrel(g, m.carbon, R + 0.003, 6.1, 6.5, 0, 0, 40); // interstage
    barrel(g, r.paint, R, 6.5, 7.6, 0, 0, 40); // upper stage
    fairing(g, m, r.paint, R, R, 7.6, 0, 1.9, 1.7, 0, 0, Math.PI / 2);
  },

  /**
   * New Glenn: 98 m tall and 7 m across. Seven BE-4s, six landing legs in fairings, two strakes
   * at the base and four fins at the top of the first stage; a 7 m fairing.
   */
  newglenn(g, m) {
    const r = kit(m);
    const R = 0.7;
    engineCluster(g, m, [[1, 0], [6, 0.42]], 0.14, 0.4, 0.42, 0, 0, 0, 14);
    floor(g, m, R, 0.43);
    barrel(g, m.carbon, R, 0.4, 1.4, 0, 0, 48); // dark aft section
    barrel(g, r.paint, R, 1.4, 11.5, 0, 0, 48);
    for (let k = 0; k < 6; k++) { // legs in their fairings
      const a = (k * TAU) / 6 + Math.PI / 6, [cx, , cz] = radial(a);
      const leg = bus(g, m.carbon, 0.22, 1.5, 0.08, { top: 0.55, bevel: 0.02, tile: 0.4 });
      leg.position.set(cx * (R + 0.035), 0.45 + 0.75, cz * (R + 0.035));
      leg.rotation.y = Math.PI / 2 - a;
    }
    for (const a of [0, Math.PI]) fin(g, m.carbon, [[R - 0.02, 0.45], [R + 0.45, 0.5], [R + 0.18, 2.8], [R - 0.02, 3.2]], 0.05, a); // strakes
    for (let k = 0; k < 4; k++) fin(g, m.carbon, [[R - 0.02, 10.4], [R + 0.5, 10.6], [R + 0.5, 11.1], [R - 0.02, 11.3]], 0.06, Math.PI / 4 + (k * Math.PI) / 2); // forward fins
    raceway(g, m.white, R, 1.5, 11.4, Math.PI / 2, 0.08);
    barrel(g, m.carbon, R + 0.003, 11.5, 12.3, 0, 0, 48); // interstage
    barrel(g, r.paint, R, 12.3, 14.6, 0, 0, 48);
    hoop(g, m.dark, R, 0.012, 0, 14.6, 0, 'y', 48);
    fairing(g, m, r.paint, R, R, 14.6, 0, 2.9, 2.1, 0, 0, Math.PI / 2);
  },

  /** A generic two-stage rocket: white stages, four small tail fins, a dark interstage and a slightly wider fairing. */
  launcher(g, m) {
    const r = kit(m);
    const R = 0.3;
    engineCluster(g, m, [[4, 0.13]], 0.09, 0.22, 0.24, 0, 0, Math.PI / 4, 12);
    floor(g, m, R, 0.25);
    barrel(g, m.carbon, R * 0.98, 0.22, 0.4, 0, 0, 32);
    barrel(g, r.paint, R, 0.4, 5.5, 0, 0, 32);
    for (const y of [2.2, 4.0]) hoop(g, m.dark, R + 0.002, 0.008, 0, y, 0, 'y', 32);
    for (let k = 0; k < 4; k++) fin(g, r.paint, [[R - 0.02, 0.25], [R + 0.3, 0.25], [R + 0.16, 0.8], [R - 0.02, 1.0]], 0.035, (k * Math.PI) / 2);
    raceway(g, m.white, R, 0.5, 5.4, Math.PI / 4, 0.05);
    barrel(g, m.carbon, R + 0.003, 5.5, 5.85, 0, 0, 32); // interstage
    barrel(g, r.paint, R, 5.85, 7.1, 0, 0, 32);
    fairing(g, m, r.paint, R, 0.36, 7.1, 0.12, 0.9, 0.85, 0, 0, Math.PI / 2);
  },
} satisfies Partial<Record<ModelKind, Builder>>;
