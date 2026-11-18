/**
 * Procedural 3D spacecraft models, built from three.js primitives and textures painted
 * onto canvases at start-up (no downloads). There is one representative shape per KIND of
 * object — a Starlink flat-panel, a geostationary comsat, the ISS, a rocket stage, a
 * debris fragment … — not an exact replica of each individual spacecraft.
 *
 * Model axes: +X = direction of travel, +Y = away from Earth, −Y = towards Earth (nadir).
 * Solar wings normally run along ±Z.
 *
 * How a model is made:
 *   1. a builder in BUILDERS adds many small parts (bevelled buses, cylinders, dishes, wings)
 *      to a group
 *   2. mergeByMaterial() welds all parts that share a material into one mesh, so even the
 *      ISS (several hundred parts) costs about a dozen draw calls
 *   3. buildModel() centres the result and scales its largest dimension to 1 unit
 *
 * Why the models do not look like grey boxes:
 *   - every material reflects a small painted "surroundings" picture (Sun, Earth-glow, soft
 *     lights), so foil, bare metal, glass and mirrors glint as the model turns
 *   - insulation foil, quilted blankets and hull plating get their wrinkles and seams from
 *     normal maps computed from painted height fields — detail that costs no triangles
 *   - bodies are bevelled or many-sided solids, never plain cubes: the bevels catch the light
 *
 *   SatelliteModel  the selected object's model, drawn at its position on the globe
 *   ModelPreview    the same model, slowly turning, inside the info card
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ModelKind } from '../data/describe.ts';
import type { SceneKit } from './scene.ts';

type V3 = readonly [number, number, number];
type Axis = 'x' | 'y' | 'z';
type Painter = (ctx: CanvasRenderingContext2D, size: number) => void;
const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;

/** Small repeatable random-number generator, so every model looks the same on every run. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------
// Textures and materials (made once, shared by every model)
// ---------------------------------------------------------------------------------------

/** A colour texture painted on a square canvas. */
function paint(size: number, draw: Painter): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d')!, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8; // keeps the cell grid crisp when a panel is seen edge-on
  return texture;
}

/**
 * A normal map made from a painted height field (white = raised, black = sunk). The slope
 * between neighbouring pixels becomes the direction the surface appears to face, so the
 * lighting shows wrinkles and seams that are not there in the geometry.
 */
function relief(size: number, strength: number, draw: Painter): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  draw(ctx, size);
  const image = ctx.getImageData(0, 0, size, size);
  const height = new Float32Array(size * size);
  for (let i = 0; i < height.length; i++) height[i] = image.data[i * 4] / 255;
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)]; // wraps, so the map tiles
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // clamped so a hard edge in the painting cannot turn the surface completely side-on
    const dx = THREE.MathUtils.clamp((at(x + 1, y) - at(x - 1, y)) * strength, -1.6, 1.6);
    const dy = THREE.MathUtils.clamp((at(x, y + 1) - at(x, y - 1)) * strength, -1.6, 1.6);
    const scale = 1 / Math.hypot(dx, dy, 1);
    const o = (y * size + x) * 4;
    image.data[o] = (-dx * scale * 0.5 + 0.5) * 255;
    image.data[o + 1] = (dy * scale * 0.5 + 0.5) * 255; // canvas rows run downwards, texture v runs upwards
    image.data[o + 2] = (scale * 0.5 + 0.5) * 255;
    image.data[o + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas); // left in linear colour space: these are directions, not colours
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

/**
 * What the shiny materials reflect: black space above, the blue glow of Earth below, the Sun
 * and a few soft lights. It is only 256 × 128 pixels; three.js blurs it per roughness level.
 * Without it metal and foil have nothing to mirror and render as dull grey.
 */
function surroundingsTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const sky = ctx.createLinearGradient(0, 0, 0, 128);
  sky.addColorStop(0, '#080b14');
  sky.addColorStop(0.46, '#111829');
  sky.addColorStop(0.54, '#2c3d58');
  sky.addColorStop(1, '#5d7697');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = 'rgba(190,225,255,0.55)'; // the bright limb of the Earth
  ctx.fillRect(0, 62, 256, 3);
  const glow = (x: number, y: number, r: number, inner: string, outer: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  glow(78, 34, 60, 'rgba(255,236,200,0.5)', 'rgba(255,236,200,0)'); // Sun halo
  glow(78, 34, 20, 'rgba(255,252,240,1)', 'rgba(255,244,214,0)'); // Sun
  glow(196, 40, 46, 'rgba(200,222,255,0.75)', 'rgba(200,222,255,0)'); // cool light on the far side
  glow(140, 12, 30, 'rgba(255,255,255,0.4)', 'rgba(255,255,255,0)');
  glow(20, 96, 40, 'rgba(235,245,255,0.5)', 'rgba(235,245,255,0)'); // cloud decks
  glow(150, 104, 36, 'rgba(235,245,255,0.4)', 'rgba(235,245,255,0)');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}

/** A 4 × 4 block of solar cells: clipped corners, two bus bars each, metallic gaps between. */
function cellTexture(cell: string, shade: string, gap: string, bar: string): THREE.CanvasTexture {
  return paint(256, (ctx, size) => {
    const rand = random(7);
    ctx.fillStyle = gap;
    ctx.fillRect(0, 0, size, size);
    const step = size / 4, w = step - 3, c = 6;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const x = i * step + 1.5, y = j * step + 1.5;
      ctx.fillStyle = rand() < 0.5 ? cell : shade;
      ctx.beginPath();
      ctx.moveTo(x + c, y); ctx.lineTo(x + w - c, y); ctx.lineTo(x + w, y + c); ctx.lineTo(x + w, y + w - c);
      ctx.lineTo(x + w - c, y + w); ctx.lineTo(x + c, y + w); ctx.lineTo(x, y + w - c); ctx.lineTo(x, y + c);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = bar;
      ctx.lineWidth = 1;
      for (const f of [0.33, 0.67]) { ctx.beginPath(); ctx.moveTo(x, y + w * f); ctx.lineTo(x + w, y + w * f); ctx.stroke(); }
    }
  });
}

/**
 * Height field of crinkled insulation foil: overlapping triangular facets, each one a tilted
 * plane, so every facet catches the light from a slightly different direction.
 */
function crinkleHeight(ctx: CanvasRenderingContext2D, size: number): void {
  const rand = random(11);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 520; i++) {
    const x = rand() * size, y = rand() * size, r = 8 + rand() * 26, tilt = rand() * TAU;
    const lo = Math.round(rand() * 255), hi = Math.round(rand() * 255);
    const corners = [rand() * TAU, rand() * TAU, rand() * TAU];
    // drawn again one tile to every side, so facets crossing the edge continue on the opposite edge
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      const cx = x + ox, cy = y + oy;
      if (cx < -r || cx > size + r || cy < -r || cy > size + r) continue;
      const slope = ctx.createLinearGradient(cx - Math.cos(tilt) * r, cy - Math.sin(tilt) * r, cx + Math.cos(tilt) * r, cy + Math.sin(tilt) * r);
      slope.addColorStop(0, `rgb(${lo},${lo},${lo})`);
      slope.addColorStop(1, `rgb(${hi},${hi},${hi})`);
      ctx.fillStyle = slope;
      ctx.beginPath();
      for (const a of corners) ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.closePath();
      ctx.fill();
    }
  }
}

/** Faint light and dark patches, multiplied into a foil's colour so it is never perfectly even. */
function mottleTexture(): THREE.CanvasTexture {
  return paint(128, (ctx, size) => {
    const rand = random(31);
    ctx.fillStyle = '#ececec';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 160; i++) {
      const v = Math.round(190 + rand() * 65);
      ctx.fillStyle = `rgba(${v},${v},${v},0.5)`;
      ctx.beginPath();
      const x = rand() * size, y = rand() * size, r = 5 + rand() * 16;
      for (let k = 0; k < 3; k++) { const a = rand() * TAU; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
      ctx.closePath();
      ctx.fill();
    }
  });
}

/**
 * Painted hull plating: seams every quarter tile, faint patches and access panels. Painted
 * twice with the same random numbers — once as colours, once as heights (seams sunk, access
 * panels slightly raised) — so the normal map lines up with the colour map.
 */
function hullPainter(asHeight: boolean): Painter {
  return (ctx, size) => {
    const rand = random(23);
    ctx.fillStyle = asHeight ? '#909090' : '#c9cdd3';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 60; i++) {
      const v = Math.round(178 + rand() * 40), x = rand() * size, y = rand() * size, w = 20 + rand() * 60, h = 10 + rand() * 40;
      if (asHeight) continue;
      ctx.fillStyle = `rgba(${v},${v},${v + 6},0.35)`;
      ctx.fillRect(x, y, w, h);
    }
    ctx.strokeStyle = asHeight ? '#303030' : '#7f868f';
    ctx.lineWidth = asHeight ? 3 : 1.5;
    for (let p = 0; p <= size; p += size / 4) {
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
    }
    ctx.strokeStyle = asHeight ? '#585858' : '#959ba5';
    ctx.fillStyle = '#a4a4a4';
    ctx.lineWidth = asHeight ? 2 : 1;
    for (let i = 0; i < 10; i++) {
      const x = 8 + rand() * 200, y = 8 + rand() * 200, w = 12 + rand() * 30, h = 10 + rand() * 22;
      if (asHeight) ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }
  };
}

/** Height field of a quilted thermal blanket: a grid of soft pillows with stitched seams between. */
function quiltHeight(ctx: CanvasRenderingContext2D, size: number): void {
  const step = size / 4;
  ctx.fillStyle = '#404040';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const cx = (i + 0.5) * step, cy = (j + 0.5) * step;
    const pillow = ctx.createRadialGradient(cx, cy, 0, cx, cy, step * 0.72);
    pillow.addColorStop(0, '#f0f0f0');
    pillow.addColorStop(1, '#404040');
    ctx.fillStyle = pillow;
    ctx.fillRect(i * step + 1, j * step + 1, step - 2, step - 2);
  }
}

/** Radiator: white with fine parallel coolant-tube lines. */
function radiatorTexture(): THREE.CanvasTexture {
  return paint(64, (ctx, size) => {
    ctx.fillStyle = '#c5c9cf';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#989fa9';
    ctx.lineWidth = 1;
    for (let y = 4; y < size; y += 8) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke(); }
  });
}

/** Optical solar reflector: the mirror tiles that cover a big satellite's radiator walls. */
function mirrorTexture(): THREE.CanvasTexture {
  return paint(128, (ctx, size) => {
    const rand = random(41);
    ctx.fillStyle = '#58626e';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
      const v = Math.round(205 + rand() * 50);
      ctx.fillStyle = `rgb(${v - 8},${v},${Math.min(255, v + 10)})`;
      ctx.fillRect(i * 16 + 1, j * 16 + 1, 14.5, 14.5);
    }
  });
}

/** Phased-array antenna face: a grid of small gold patch elements on a dark board. */
function arrayTexture(): THREE.CanvasTexture {
  return paint(128, (ctx, size) => {
    ctx.fillStyle = '#20252d';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#c49a45';
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) ctx.fillRect(i * 16 + 3, j * 16 + 3, 10, 10);
  });
}

/** Radar antenna face: pale radiating tiles, each with fine slot lines. */
function radarTexture(): THREE.CanvasTexture {
  return paint(128, (ctx, size) => {
    ctx.fillStyle = '#7d8590';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 4; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#c6cad0' : '#bbc0c7';
      ctx.fillRect(i * 64 + 1.5, j * 32 + 1.5, 61, 29);
      ctx.fillStyle = '#8f96a0';
      for (let k = 0; k < 9; k++) ctx.fillRect(i * 64 + 6 + k * 6, j * 32 + 6, 2, 20);
    }
  });
}

/** Back of a rigid solar panel: dark carbon-fibre skin, stiffening ribs, a cable harness. */
function panelBackTexture(): THREE.CanvasTexture {
  return paint(128, (ctx, size) => {
    ctx.fillStyle = '#343942';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#69717d';
    ctx.lineWidth = 3;
    ctx.strokeRect(3, 3, size - 6, size - 6);
    ctx.lineWidth = 2;
    for (const f of [1 / 3, 2 / 3]) {
      ctx.beginPath(); ctx.moveTo(size * f, 3); ctx.lineTo(size * f, size - 3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(3, size * f); ctx.lineTo(size - 3, size * f); ctx.stroke();
    }
    ctx.strokeStyle = '#b47f33';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(size / 2, 3); ctx.lineTo(size / 2, size - 3); ctx.stroke();
  });
}

/** Back of a roll-out solar blanket: amber film with the fold lines it was packed along. */
function blanketBackTexture(): THREE.CanvasTexture {
  return paint(64, (ctx, size) => {
    ctx.fillStyle = '#c98b35';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#a9742a';
    for (let y = 0; y < size; y += 8) ctx.fillRect(0, y, size, 1.5);
    ctx.fillStyle = '#d69a45';
    for (let y = 3; y < size; y += 8) ctx.fillRect(0, y, size, 1);
  });
}

/** Rocket-engine bell: sooty throat (bottom of the picture), heat-tinted bronze, steel-blue lip. */
function nozzleTexture(): THREE.CanvasTexture {
  return paint(64, (ctx, size) => {
    const heat = ctx.createLinearGradient(0, size, 0, 0);
    heat.addColorStop(0, '#2b2523');
    heat.addColorStop(0.35, '#7a5238');
    heat.addColorStop(0.7, '#6d6676');
    heat.addColorStop(1, '#a9afb9');
    ctx.fillStyle = heat;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(20,16,14,0.18)'; // stiffening hoops
    for (let y = 6; y < size; y += 10) ctx.fillRect(0, y, size, 1.5);
  });
}

/** Station truss: a painted girder face — longerons, cross-bracing and a few equipment panels. */
function trussTexture(): THREE.CanvasTexture {
  return paint(128, (ctx, size) => {
    ctx.fillStyle = '#4a505a';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#c9ced6';
    ctx.fillRect(8, 30, 50, 68);
    ctx.fillStyle = '#b58a35';
    ctx.fillRect(74, 44, 40, 40);
    ctx.strokeStyle = '#aab1bb';
    ctx.lineWidth = 5;
    ctx.strokeRect(2, 12, size - 4, size - 24);
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(2, 12); ctx.lineTo(size - 2, size - 12); ctx.moveTo(size - 2, 12); ctx.lineTo(2, size - 12); ctx.stroke();
  });
}

/** Inside face of torn structure: bare metal with its greenish-gold protective coating, machined into a triangular stiffening grid. */
function isogridTexture(): THREE.CanvasTexture {
  return paint(128, (ctx, size) => {
    ctx.fillStyle = '#b9b488';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#646343';
    ctx.lineWidth = 3;
    const step = size / 4;
    ctx.beginPath();
    for (let k = -4; k <= 8; k++) {
      ctx.moveTo(0, k * step); ctx.lineTo(size, k * step);
      ctx.moveTo(k * step, 0); ctx.lineTo(k * step + size / 2, size);
      ctx.moveTo(k * step, 0); ctx.lineTo(k * step - size / 2, size);
    }
    ctx.stroke();
  });
}

/** Torn edge of a sandwich panel: the open cells of its honeycomb core. */
function honeycombTexture(): THREE.CanvasTexture {
  return paint(64, (ctx, size) => {
    ctx.fillStyle = '#c9a856';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#2b251a';
    for (let row = 0; row < 4; row++) for (let col = -1; col < 4; col++) {
      const x = col * 16 + (row % 2) * 8 + 8, y = row * 16 + 8;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) ctx.lineTo(x + 6.2 * Math.cos((k * Math.PI) / 3), y + 6.2 * Math.sin((k * Math.PI) / 3));
      ctx.closePath();
      ctx.fill();
    }
  });
}

/** Outside face of torn structure: white paint, panel seams, soot and scorch marks. */
function scorchTexture(): THREE.CanvasTexture {
  return paint(128, (ctx, size) => {
    const rand = random(53);
    ctx.fillStyle = '#c4c8ce';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#7f868f';
    ctx.lineWidth = 1.5;
    for (let p = 0; p <= size; p += size / 2) { ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke(); }
    for (let i = 0; i < 26; i++) {
      const x = rand() * size, y = rand() * size, r = 5 + rand() * 16;
      const soot = ctx.createRadialGradient(x, y, 0, x, y, r);
      soot.addColorStop(0, `rgba(38,30,24,${0.35 + rand() * 0.5})`);
      soot.addColorStop(1, 'rgba(38,30,24,0)');
      ctx.fillStyle = soot;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.fillStyle = '#b3402d'; // what is left of a painted stripe
    ctx.fillRect(0, 84, size, 7);
  });
}

function makeMaterials() {
  const surroundings = surroundingsTexture();
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ envMap: surroundings, ...p });
  const crinkle = relief(256, 20, crinkleHeight), mottle = mottleTexture();
  const wrinkles = (amount: number) => new THREE.Vector2(amount, amount);
  // Brightness budget: the main view adds a bloom glow to anything brighter than 0.9, and has a
  // headlight at the camera, so a smooth flat surface facing the viewer mirrors that light over
  // its whole area and turns into a white blob. Hence: pale paint stays around 75 % grey with
  // high roughness, and nothing large and flat is smoother than about 0.45.
  //
  // Metallised film: a soft mirror, broken up by the crinkles. The reflections are boosted
  // because the painted surroundings are much dimmer than the real Sun.
  const foil = (color: number, side: THREE.Side = THREE.FrontSide, roughness = 0.5) =>
    std({ color, map: mottle, normalMap: crinkle, normalScale: wrinkles(0.7), metalness: 0.82, roughness, envMapIntensity: 1.7, side });
  // Cell faces sit a hair above their backing panel; the offset stops the two from flickering.
  // Cover glass gives the cells a soft sheen that moves across them as the model turns.
  const cells = (map: THREE.Texture, emissive: number) =>
    std({ map, metalness: 0.3, roughness: 0.46, envMapIntensity: 1.3, emissive, emissiveIntensity: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const light = (color: number) => std({ color, emissive: color, emissiveIntensity: 1.1, roughness: 0.6 });
  const offset = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 };
  return {
    foilGold: foil(0xf2ae3d),
    foilSilver: foil(0xbdc3cb, THREE.FrontSide, 0.56),
    foilBlack: foil(0x2a2c33, THREE.FrontSide, 0.45),
    foilTorn: foil(0xf2ae3d, THREE.DoubleSide),
    blanket: std({ color: 0xaeb1ab, envMapIntensity: 0.5, normalMap: relief(128, 3.2, quiltHeight), normalScale: wrinkles(0.8), metalness: 0.05, roughness: 0.82 }),
    hull: std({ map: paint(256, hullPainter(false)), normalMap: relief(256, 2.2, hullPainter(true)), metalness: 0.08, roughness: 0.72, envMapIntensity: 0.5 }),
    white: std({ color: 0xc2c7ce, metalness: 0.05, roughness: 0.75, envMapIntensity: 0.5 }),
    dish: std({ color: 0xc6cad0, metalness: 0.05, roughness: 0.7, envMapIntensity: 0.5, side: THREE.BackSide }), // the bowl: LatheGeometry faces away from its axis
    dishBack: std({ color: 0x8a9099, metalness: 0.1, roughness: 0.7, envMapIntensity: 0.5 }),
    dark: std({ color: 0x2c3139, metalness: 0.6, roughness: 0.42 }),
    metal: std({ color: 0xa4abb5, metalness: 0.85, roughness: 0.52, envMapIntensity: 1.5 }),
    nozzle: std({ map: nozzleTexture(), metalness: 0.85, roughness: 0.45, envMapIntensity: 1.6, side: THREE.DoubleSide }),
    baffle: std({ color: 0x15171c, metalness: 0.2, roughness: 0.85, side: THREE.DoubleSide }),
    lens: std({ color: 0x0b1626, metalness: 0.95, roughness: 0.25, envMapIntensity: 2.4 }),
    yellow: std({ color: 0xd9a81e, metalness: 0.3, roughness: 0.55 }),
    foam: std({ color: 0xbfb294, metalness: 0, roughness: 0.92, envMapIntensity: 0.4 }),
    radiator: std({ map: radiatorTexture(), metalness: 0.05, roughness: 0.75, envMapIntensity: 0.5 }),
    mirror: std({ map: mirrorTexture(), color: 0xc6cbd2, metalness: 0.6, roughness: 0.46, envMapIntensity: 1.6, ...offset }),
    array: std({ map: arrayTexture(), metalness: 0.4, roughness: 0.5, ...offset }),
    radar: std({ map: radarTexture(), metalness: 0.1, roughness: 0.65, envMapIntensity: 0.6, ...offset }),
    truss: std({ map: trussTexture(), metalness: 0.5, roughness: 0.5 }),
    cellsBlue: cells(cellTexture('#122c78', '#17388f', '#a4b0c8', '#6686d0'), 0x06122e),
    cellsAmber: cells(cellTexture('#1a1826', '#241f2c', '#c79440', '#7a5a28'), 0x120c05),
    panelBack: std({ map: panelBackTexture(), metalness: 0.3, roughness: 0.6 }),
    panelBackGold: std({ map: blanketBackTexture(), metalness: 0.3, roughness: 0.6, envMapIntensity: 1.2 }),
    // Debris only. Three of them multiply in a grey level stored per corner (charring), so every part given one must carry it.
    scrapOuter: std({ map: scorchTexture(), metalness: 0.2, roughness: 0.6, vertexColors: true }),
    scrapInner: std({ map: isogridTexture(), metalness: 0.7, roughness: 0.5, envMapIntensity: 1.4, vertexColors: true }),
    scrapBare: std({ color: 0xa7adb6, metalness: 0.85, roughness: 0.5, envMapIntensity: 1.5, vertexColors: true, side: THREE.DoubleSide }),
    scrapCore: std({ map: honeycombTexture(), metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide }),
    navRed: light(0xff3b30),
    navGreen: light(0x35e07a),
    navWhite: light(0xdfe8ff),
  };
}
type Materials = ReturnType<typeof makeMaterials>;

let sharedMaterials: Materials | null = null;
function materials(): Materials {
  return (sharedMaterials ??= makeMaterials());
}

// ---------------------------------------------------------------------------------------
// Part helpers
// ---------------------------------------------------------------------------------------

// Docked visiting vehicles are drawn at a fraction of the station's size, so they are built
// with fewer facets: round parts divide their segment counts by this while dock() is running.
let coarse = 1;
const facets = (n: number, min = 6) => Math.max(min, Math.round(n / coarse));

function mesh(g: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const part = new THREE.Mesh(geometry, material);
  part.position.set(x, y, z);
  g.add(part);
  return part;
}

/** Plain box — for small fittings. Spacecraft bodies use bus() or prism(), which have bevels. */
function box(g: THREE.Group, material: THREE.Material, w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.Mesh {
  return mesh(g, new THREE.BoxGeometry(w, h, d), material, x, y, z);
}

/**
 * A solid from flat convex faces. Each face gets its own normal (crisp edges that catch the
 * light) and texture coordinates laid flat on it at `tile` model units per repeat, so foil
 * crinkles are the same size on a big face and a small one.
 */
function faceted(faces: THREE.Vector3[][], tile: number): THREE.BufferGeometry {
  const position: number[] = [], normal: number[] = [], uv: number[] = [];
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3(), middle = new THREE.Vector3();
  for (const face of faces) {
    n.crossVectors(ab.subVectors(face[1], face[0]), ac.subVectors(face[2], face[0])).normalize();
    middle.set(0, 0, 0);
    for (const p of face) middle.add(p);
    const inward = n.dot(middle) < 0; // the solid is built round the origin, so "outwards" is away from it
    if (inward) n.negate();
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let k = 1; k < face.length - 1; k++) {
      for (const p of inward ? [face[0], face[k + 1], face[k]] : [face[0], face[k], face[k + 1]]) {
        position.push(p.x, p.y, p.z);
        normal.push(n.x, n.y, n.z);
        if (ax >= ay && ax >= az) uv.push(p.z / tile, p.y / tile);
        else if (ay >= az) uv.push(p.x / tile, p.z / tile);
        else uv.push(p.x / tile, p.y / tile);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geometry;
}

interface BusSpec {
  x?: number;
  y?: number;
  z?: number;
  bevel?: number; // width of the cut along every edge
  top?: number; // 1 = straight sides; less makes the +Y end narrower (a tapered body)
  tile?: number; // model units per texture repeat
}

/**
 * A spacecraft body: a box with every edge and corner cut off. The 12 bevels and 8 corner
 * facets face in between the main directions, so some of them always catch the light — that
 * is most of the difference between "a model" and "a grey cube".
 */
function bus(g: THREE.Group, material: THREE.Material, w: number, h: number, d: number, s: BusSpec = {}): THREE.Mesh {
  const a = w / 2, b = h / 2, c = d / 2, k = s.bevel ?? Math.min(w, h, d) * 0.08, top = s.top ?? 1;
  const at = (x: number, y: number, z: number) => {
    const f = 1 + ((top - 1) * (y + b)) / h;
    return new THREE.Vector3(x * f, y, z * f);
  };
  const faces: THREE.Vector3[][] = [], signs = [-1, 1];
  for (const p of signs) { // the six main faces
    faces.push([at(p * a, -(b - k), -(c - k)), at(p * a, b - k, -(c - k)), at(p * a, b - k, c - k), at(p * a, -(b - k), c - k)]);
    faces.push([at(-(a - k), p * b, -(c - k)), at(a - k, p * b, -(c - k)), at(a - k, p * b, c - k), at(-(a - k), p * b, c - k)]);
    faces.push([at(-(a - k), -(b - k), p * c), at(a - k, -(b - k), p * c), at(a - k, b - k, p * c), at(-(a - k), b - k, p * c)]);
  }
  for (const p of signs) for (const q of signs) { // the twelve bevelled edges
    faces.push([at(p * a, q * (b - k), -(c - k)), at(p * a, q * (b - k), c - k), at(p * (a - k), q * b, c - k), at(p * (a - k), q * b, -(c - k))]);
    faces.push([at(p * a, -(b - k), q * (c - k)), at(p * a, b - k, q * (c - k)), at(p * (a - k), b - k, q * c), at(p * (a - k), -(b - k), q * c)]);
    faces.push([at(-(a - k), p * b, q * (c - k)), at(a - k, p * b, q * (c - k)), at(a - k, p * (b - k), q * c), at(-(a - k), p * (b - k), q * c)]);
    for (const r of signs) faces.push([at(p * a, q * (b - k), r * (c - k)), at(p * (a - k), q * b, r * (c - k)), at(p * (a - k), q * (b - k), r * c)]); // corners
  }
  return mesh(g, faceted(faces, s.tile ?? 0.7), material, s.x, s.y, s.z);
}

/** Flat-sided prism or frustum with `sides` faces, its length along Y (hexagonal buses, triangular bodies, girders). */
function prism(g: THREE.Group, material: THREE.Material, sides: number, rTop: number, rBottom: number, h: number, x = 0, y = 0, z = 0, tile = 0.7, turn = 0): THREE.Mesh {
  const loop = (r: number, yy: number) => Array.from({ length: sides }, (_, i) => new THREE.Vector3(r * Math.cos(turn + (i * TAU) / sides), yy, r * Math.sin(turn + (i * TAU) / sides)));
  const upper = loop(rTop, h / 2), lower = loop(rBottom, -h / 2);
  const faces = [upper, lower];
  for (let i = 0; i < sides; i++) faces.push([lower[i], lower[(i + 1) % sides], upper[(i + 1) % sides], upper[i]]);
  return mesh(g, faceted(faces, tile), material, x, y, z);
}

/** Turn an object whose length runs along +Y so that it runs along the given axis instead. */
function orient<T extends THREE.Object3D>(object: T, axis: Axis): T {
  if (axis === 'x') object.rotation.z = -Math.PI / 2;
  if (axis === 'z') object.rotation.x = Math.PI / 2;
  return object;
}

/** Cylinder or cone; `rTop` is the radius at the end that points along +axis. */
function cyl(g: THREE.Group, material: THREE.Material, rTop: number, rBottom: number, h: number, x = 0, y = 0, z = 0, axis: Axis = 'y', open = false, segments = 24): THREE.Mesh {
  return orient(mesh(g, new THREE.CylinderGeometry(rTop, rBottom, h, facets(segments), 1, open), material, x, y, z), axis);
}

function ball(g: THREE.Group, material: THREE.Material, r: number, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1): THREE.Mesh {
  // small balls (lamps, joints, bottles) get fewer facets: nobody can count them at that size
  const part = mesh(g, new THREE.SphereGeometry(r, facets(r < 0.08 ? 10 : 18, 8), facets(r < 0.08 ? 6 : 12, 5)), material, x, y, z);
  part.scale.set(sx, sy, sz);
  return part;
}

/** A hoop round the given axis: handrails, docking rings, stiffening frames. */
function hoop(g: THREE.Group, material: THREE.Material, radius: number, tube: number, x = 0, y = 0, z = 0, axis: Axis = 'y', segments = 24): THREE.Mesh {
  const part = mesh(g, new THREE.TorusGeometry(radius, tube, 4, facets(segments, 8)), material, x, y, z);
  if (axis === 'y') part.rotation.x = Math.PI / 2;
  if (axis === 'x') part.rotation.y = Math.PI / 2;
  return part;
}

/** A surface of revolution about +Y from a list of [radius, height] points (capsules, domes, tanks). */
function lathe(g: THREE.Group, material: THREE.Material, profile: (readonly [number, number])[], x = 0, y = 0, z = 0, axis: Axis = 'y', segments = 28): THREE.Mesh {
  const points = profile.map(([r, h]) => new THREE.Vector2(r, h));
  return orient(mesh(g, new THREE.LatheGeometry(points, facets(segments, 10)), material, x, y, z), axis);
}

/** A thin rod between two points. */
function strut(g: THREE.Group, material: THREE.Material, a: V3, b: V3, radius = 0.012): THREE.Mesh {
  const from = new THREE.Vector3(a[0], a[1], a[2]);
  const along = new THREE.Vector3(b[0], b[1], b[2]).sub(from);
  const length = along.length();
  const part = mesh(g, new THREE.CylinderGeometry(radius, radius, length, facets(6, 4)), material);
  part.position.copy(from).addScaledVector(along, 0.5);
  part.quaternion.setFromUnitVectors(UP, along.normalize());
  return part;
}

/** A sub-group at `at` whose own +Y axis points along `dir` — parts built inside it aim that way. */
function aimed(g: THREE.Group, at: V3, dir: V3): THREE.Group {
  const sub = new THREE.Group();
  sub.position.set(at[0], at[1], at[2]);
  sub.quaternion.setFromUnitVectors(UP, new THREE.Vector3(dir[0], dir[1], dir[2]).normalize());
  g.add(sub);
  return sub;
}

/** Repeat a texture across a part: multiply its texture coordinates. */
function tileUV(geometry: THREE.BufferGeometry, su: number, sv: number): void {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
}

/**
 * A rigid solar panel lying flat: `w` along X, `l` along Z, cells facing +Y, ribbed backing
 * facing −Y. `tile` is the size (model units) of one 4 × 4 block of cells.
 */
function solarPanel(m: Materials, w: number, l: number, cells: THREE.Material = m.cellsBlue, back: THREE.Material = m.panelBack, tile = 0.35): THREE.Group {
  const panel = new THREE.Group();
  const thickness = Math.min(0.02, w * 0.03);
  box(panel, back, w, thickness, l);
  const face = new THREE.PlaneGeometry(w * 0.97, l * 0.985);
  tileUV(face, w / tile, l / tile);
  mesh(panel, face, cells, 0, thickness / 2 + 0.0008, 0).rotation.x = -Math.PI / 2;
  return panel;
}

interface WingSpec {
  width: number; // across the wing
  length: number; // total length of the panels along the boom
  panels?: number; // number of hinged panels
  yoke?: number; // length of the boom between the body and the first panel
  cells?: THREE.Material;
  back?: THREE.Material;
  tile?: number;
}

/** One fold-out solar wing in its own frame: root at the origin, running along +Z, cells facing +Y. */
function buildWing(m: Materials, s: WingSpec): THREE.Group {
  const wing = new THREE.Group();
  const panels = s.panels ?? 3, yoke = s.yoke ?? s.width * 0.4, hinge = s.width * 0.03;
  const each = (s.length - hinge * (panels - 1)) / panels;
  const rod = Math.max(0.006, s.width * 0.018);
  // Y-shaped yoke: one boom from the drive motor, forking to the first panel's edge
  cyl(wing, m.metal, rod * 3, rod * 3, rod * 4, 0, 0, rod * 2, 'z', false, 10); // array drive motor
  strut(wing, m.dark, [0, 0, 0], [0, 0, yoke * 0.45], rod * 1.6);
  for (const side of [-1, 1]) strut(wing, m.dark, [0, 0, yoke * 0.45], [side * s.width * 0.32, 0, yoke], rod);
  for (let i = 0; i < panels; i++) {
    const z = yoke + i * (each + hinge) + each / 2;
    const panel = solarPanel(m, s.width, each, s.cells, s.back, s.tile);
    panel.position.z = z;
    wing.add(panel);
    if (i > 0) for (const side of [-1, 1]) cyl(wing, m.metal, rod, rod, s.width * 0.12, side * s.width * 0.3, 0, z - each / 2 - hinge / 2, 'x', false, 8);
  }
  return wing;
}

/** Two wings on opposite sides (±Z), both turned by `tilt` about their shared axis like a real array drive. */
function wingPair(g: THREE.Group, m: Materials, s: WingSpec & { root: number; x?: number; y?: number; tilt?: number }): void {
  for (const side of [-1, 1]) {
    const wing = buildWing(m, s);
    wing.position.set(s.x ?? 0, s.y ?? 0, side * s.root);
    wing.rotation.set(0, side === 1 ? 0 : Math.PI, side * (s.tilt ?? 0));
    g.add(wing);
  }
}

/** A roll-out "blanket" wing as used on space stations: two cell blankets either side of a mast. Runs along +Z. */
function blanketWing(m: Materials, length: number, width: number, tile: number): THREE.Group {
  const wing = new THREE.Group();
  const blanket = width * 0.44;
  strut(wing, m.metal, [0, 0, 0], [0, 0, length], width * 0.022);
  box(wing, m.dark, width, width * 0.05, width * 0.07, 0, 0, width * 0.06); // blanket box at the root
  for (const side of [-1, 1]) {
    const sheet = solarPanel(m, blanket, length * 0.92, m.cellsAmber, m.panelBackGold, tile);
    // the fold lines of the backing repeat along the blanket rather than being stretched over it
    tileUV((sheet.children[0] as THREE.Mesh).geometry, 1, length / width);
    sheet.position.set((side * (width - blanket)) / 2, 0, length * 0.53);
    wing.add(sheet);
  }
  box(wing, m.dark, width, width * 0.03, width * 0.03, 0, 0, length); // tip bar
  return wing;
}

/**
 * A parabolic dish antenna at `at`, opening towards `dir`: white bowl, dark ribbed back, gimbal
 * hub. With `feed`, a horn on a tripod at the focus; big reflectors lit from a horn on the
 * spacecraft body pass false.
 */
function dish(g: THREE.Group, m: Materials, radius: number, at: V3, dir: V3, feed = true): THREE.Group {
  const d = aimed(g, at, dir);
  const depth = radius * 0.3, focus = radius * 0.78, big = radius >= 0.25;
  const profile: THREE.Vector2[] = [];
  const steps = big ? 7 : 4;
  for (let i = 0; i <= steps; i++) profile.push(new THREE.Vector2((radius * i) / steps, depth * (i / steps) ** 2));
  const bowl = new THREE.LatheGeometry(profile, facets(big ? 32 : 16, 10));
  mesh(d, bowl, m.dish);
  mesh(d, bowl, m.dishBack); // the same surface seen from behind
  hoop(d, m.dark, radius, radius * 0.025, 0, depth, 0, 'y', big ? 32 : 16);
  if (big) {
    // stiffening ribs on the back: straight lines touching the bowl at its rim stay behind it everywhere
    for (let k = 0; k < 8; k++) {
      const a = (k * TAU) / 8;
      strut(d, m.dark, [radius * 0.1 * Math.cos(a), -depth * 0.95, radius * 0.1 * Math.sin(a)], [radius * 0.97 * Math.cos(a), depth * 0.9, radius * 0.97 * Math.sin(a)], radius * 0.016);
    }
    hoop(d, m.dark, radius * 0.55, radius * 0.014, 0, depth * 0.1 - radius * 0.02, 0, 'y', 20);
  }
  if (feed) {
    for (let k = 0; k < 3; k++) {
      const a = (k * TAU) / 3;
      strut(d, m.dark, [radius * Math.cos(a), depth, radius * Math.sin(a)], [0, focus, 0], radius * 0.018);
    }
    cyl(d, m.metal, radius * 0.07, radius * 0.1, radius * 0.14, 0, focus, 0, 'y', false, 10); // feed horn
  }
  cyl(d, m.dark, radius * 0.14, radius * 0.2, depth * (big ? 1.1 : 0.5), 0, -depth * (big ? 0.55 : 0.25), 0, 'y', false, 12); // gimbal hub
  return d;
}

/** A rocket-engine bell at `at`, exhaust pointing along `dir`. */
function nozzle(g: THREE.Group, m: Materials, radius: number, length: number, at: V3, dir: V3): void {
  const n = aimed(g, at, dir);
  const small = radius < 0.05, steps = small ? 3 : 6; // thruster-sized bells are a few pixels across: keep them cheap
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= steps; i++) profile.push(new THREE.Vector2(radius * (0.3 + 0.7 * Math.sqrt(i / steps)), (length * i) / steps));
  mesh(n, new THREE.LatheGeometry(profile, small ? 8 : facets(radius > 0.2 ? 28 : 16, 8)), m.nozzle);
  if (!small) cyl(n, m.dark, radius * 0.3, radius * 0.38, length * 0.25, 0, -length * 0.12, 0, 'y', false, 10); // combustion chamber
  if (radius > 0.2) hoop(n, m.metal, radius * 1.01, radius * 0.03, 0, length, 0, 'y', 28); // stiffening ring at the lip
}

/** A cluster of small attitude thrusters on a block, firing roughly along `dir`. */
function thrusters(g: THREE.Group, m: Materials, at: V3, dir: V3, size = 1): void {
  const t = aimed(g, at, dir);
  box(t, m.dark, 0.09 * size, 0.04 * size, 0.09 * size);
  for (const [x, z] of [[-1, 0], [1, 0], [0, 1]]) nozzle(t, m, 0.022 * size, 0.04 * size, [x * 0.028 * size, 0.02 * size, z * 0.028 * size], [x * 0.5, 1, z * 0.5]);
}

/** Star tracker: a small baffled camera looking along `dir`. */
function tracker(g: THREE.Group, m: Materials, at: V3, dir: V3, size = 1): void {
  const t = aimed(g, at, dir);
  cyl(t, m.baffle, 0.05 * size, 0.032 * size, 0.12 * size, 0, 0.06 * size, 0, 'y', true, 12);
  cyl(t, m.lens, 0.03 * size, 0.03 * size, 0.01 * size, 0, 0.012 * size, 0, 'y', false, 12);
  box(t, m.dark, 0.08 * size, 0.03 * size, 0.08 * size, 0, -0.01 * size, 0);
}

/** Whip / rod antenna from `at` along `dir`. */
function whip(g: THREE.Group, m: Materials, at: V3, dir: V3, length: number, radius = 0.007): void {
  const d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize().multiplyScalar(length);
  strut(g, m.metal, at, [at[0] + d.x, at[1] + d.y, at[2] + d.z], radius);
}

/** Helix antenna under its white radome cone, pointing along `dir` from a round base plate. */
function helix(g: THREE.Group, m: Materials, at: V3, dir: V3, length: number, radius = 0.05): void {
  const h = aimed(g, at, dir);
  cyl(h, m.metal, radius * 1.25, radius * 1.25, radius * 0.3, 0, radius * 0.15, 0, 'y', false, 8);
  cyl(h, m.white, radius * 0.45, radius, length, 0, radius * 0.3 + length / 2, 0, 'y', false, 8);
}

/** Flat antenna board in the XY plane, its face (phased-array patches by default) towards +Z. */
function arrayPanel(m: Materials, w: number, h: number, elementsPerUnit = 14, face: THREE.Material = m.array): THREE.Group {
  const panel = new THREE.Group();
  box(panel, m.dark, w, h, 0.03);
  const front = new THREE.PlaneGeometry(w * 0.97, h * 0.97);
  tileUV(front, (w * elementsPerUnit) / 8, (h * elementsPerUnit) / 8);
  mesh(panel, front, face, 0, 0, 0.0158);
  return panel;
}

/**
 * A flat panel of `face` material lying against a body: centre at `at`, looking along `dir`.
 * On a side wall `w` is the horizontal size and `h` the vertical one; on a deck (looking up or
 * down) `w` runs along X and `h` along Z. `repeat` = texture repeats per model unit.
 */
function plate(g: THREE.Group, m: Materials, face: THREE.Material, w: number, h: number, at: V3, dir: V3, repeat = 4): void {
  const normal = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
  const across = new THREE.Vector3().crossVectors(Math.abs(normal.y) > 0.9 ? new THREE.Vector3(0, 0, 1) : UP, normal).normalize();
  const p = new THREE.Group();
  p.position.set(at[0], at[1], at[2]);
  p.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, normal, new THREE.Vector3().crossVectors(across, normal)));
  g.add(p);
  box(p, m.dark, w, 0.012, h);
  const front = new THREE.PlaneGeometry(w * 0.95, h * 0.95);
  tileUV(front, w * repeat, h * repeat);
  mesh(p, front, face, 0, 0.0068, 0).rotation.x = -Math.PI / 2;
}

/**
 * A flat-shaded surface through a grid of points (rows of columns), for sheet metal that has
 * been bent and dented. `shade` holds a grey level per point that is multiplied into the
 * material's colour — used to blacken torn edges. `flip` turns the surface to face the other way.
 */
function gridSurface(points: THREE.Vector3[][], shade: number[][], repeatU: number, repeatV: number, flip: boolean): THREE.BufferGeometry {
  const rows = points.length - 1, cols = points[0].length - 1;
  const position: number[] = [], uv: number[] = [], color: number[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const corners = flip
      ? [[i, j], [i + 1, j + 1], [i + 1, j], [i, j], [i, j + 1], [i + 1, j + 1]]
      : [[i, j], [i + 1, j], [i + 1, j + 1], [i, j], [i + 1, j + 1], [i, j + 1]];
    for (const [a, b] of corners) {
      const p = points[b][a], s = shade[b][a];
      position.push(p.x, p.y, p.z);
      uv.push((a / cols) * repeatU, (b / rows) * repeatV);
      color.push(s, s, s);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  geometry.computeVertexNormals(); // no shared corners, so every triangle gets its own normal
  return geometry;
}

/**
 * A pressurised module: barrel with tapered ends, a berthing ring at each end and a
 * trunnion ring round the middle. `axis` is the direction of its length.
 */
function module(g: THREE.Group, m: Materials, r: number, len: number, x: number, y: number, z: number, axis: Axis, skin: THREE.Material = m.hull): THREE.Group {
  const s = new THREE.Group();
  const barrel = len * 0.8, cone = len * 0.1;
  const body = cyl(s, skin, r, r, barrel, 0, 0, 0, 'y', true, 20);
  tileUV(body.geometry, 4, Math.max(1, Math.round(barrel / ((Math.PI * r) / 2))));
  cyl(s, skin, r * 0.6, r, cone, 0, barrel / 2 + cone / 2, 0, 'y', true, 20);
  cyl(s, skin, r, r * 0.6, cone, 0, -barrel / 2 - cone / 2, 0, 'y', true, 20);
  for (const end of [-1, 1]) cyl(s, m.dark, r * 0.62, r * 0.62, len * 0.02, 0, (end * len) / 2, 0, 'y', false, 12);
  for (const end of [-1, 1]) cyl(s, m.metal, r * 1.03, r * 1.03, len * 0.025, 0, end * barrel * 0.28, 0, 'y', true, 20);
  s.position.set(x, y, z);
  g.add(orient(s, axis));
  return s;
}

/** A length of station truss along Z: six-sided girder with painted bracing and a frame at each joint. */
function girder(g: THREE.Group, m: Materials, length: number, r: number, x: number, y: number, z: number): void {
  orient(prism(g, m.truss, 6, r, r, length, x, y, z, r * 1.7), 'z');
  for (const end of [-1, 1]) orient(prism(g, m.metal, 6, r * 1.12, r * 1.12, r * 0.16, x, y, z + (end * length) / 2, 1), 'z');
}

/** Mount a ready-made part group in a parent: uniform scale, position, and facing (its +X turned to `facing`). */
function dock(parent: THREE.Group, build: (g: THREE.Group, m: Materials) => void, m: Materials, scale: number, at: V3, facing: V3): void {
  const sub = new THREE.Group();
  coarse = 2.5;
  build(sub, m);
  coarse = 1;
  sub.scale.setScalar(scale);
  sub.position.set(at[0], at[1], at[2]);
  sub.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(facing[0], facing[1], facing[2]).normalize());
  parent.add(sub);
}

// ---------------------------------------------------------------------------------------
// Crew and cargo vehicles (also reused, scaled down, as the craft docked to the stations).
// All have their docking end at +X.
// ---------------------------------------------------------------------------------------

/** SpaceX Dragon 2: gumdrop capsule, hinged nose cone, trunk half-covered in solar cells, four fins. */
function dragonParts(g: THREE.Group, m: Materials): void {
  // capsule: one surface of revolution — straight sidewall, rounded shoulder, flat top
  const shell = lathe(g, m.hull, [[0.5, 0], [0.5, 0.05], [0.31, 0.68], [0.27, 0.75], [0.2, 0.78], [0, 0.78]], 0, 0, 0, 'x', 32);
  tileUV(shell.geometry, 6, 2);
  cyl(g, m.dark, 0.505, 0.49, 0.06, -0.01, 0, 0, 'x', false, 32); // heat shield
  cyl(g, m.metal, 0.19, 0.19, 0.07, 0.81, 0, 0, 'x'); // docking ring
  cyl(g, m.dark, 0.13, 0.13, 0.075, 0.812, 0, 0, 'x'); // hatch
  for (let k = 0; k < 3; k++) box(g, m.metal, 0.05, 0.03, 0.02, 0.85, 0.19 * Math.cos((k * TAU) / 3), 0.19 * Math.sin((k * TAU) / 3)); // docking petals
  // nose cone, swung open on its hinge
  // (closed it would point along +X; it turns about a hinge on the top of the docking ring)
  const open = 0.35, hinge: V3 = [0.8, 0.2, 0];
  const nose = mesh(g, new THREE.SphereGeometry(0.21, facets(20, 10), facets(10, 5), 0, TAU, 0, Math.PI / 2), m.white, hinge[0] + 0.21 * Math.cos(open), hinge[1] + 0.21 * Math.sin(open), 0);
  nose.rotation.z = open;
  nose.scale.set(1, 1.15, 1);
  mesh(g, new THREE.CircleGeometry(0.2, facets(20, 10)), m.baffle, nose.position.x, nose.position.y, 0).rotation.set(Math.PI / 2, 0, 0, 'ZXY').z = open; // its dark inside
  cyl(g, m.metal, 0.025, 0.025, 0.12, hinge[0], hinge[1], 0, 'z', false, 8);
  // windows on the upper flank, laid along the cone's slope
  for (const z of [-0.13, 0.13]) box(g, m.lens, 0.13, 0.012, 0.1, 0.42, 0.392, z).rotation.z = -0.29;
  for (const s of [-1, 1]) box(g, m.lens, 0.1, 0.08, 0.012, 0.42, 0.08, s * 0.382).rotation.y = s * 0.29;
  // launch-escape engine pods, 4 around the base, each with a pair of dark exhaust ports
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2, cy = Math.cos(a), cz = Math.sin(a);
    ball(g, m.white, 0.1, 0.17, 0.44 * cy, 0.44 * cz, 2.0, 1, 1);
    nozzle(g, m, 0.03, 0.04, [0.0, 0.5 * cy, 0.5 * cz], [-1, 0.5 * cy, 0.5 * cz]);
    cyl(g, m.dark, 0.03, 0.03, 0.02, 0.06, 0.535 * cy, 0.535 * cz, 'x', false, 8);
  }
  // trunk: white radiator half below, solar cells wrapped round the upper half
  const trunk = cyl(g, m.radiator, 0.5, 0.5, 0.75, -0.42, 0, 0, 'x', true, 32);
  tileUV(trunk.geometry, 1, 5);
  const wrap = new THREE.CylinderGeometry(0.506, 0.506, 0.7, facets(24), 1, true, Math.PI, Math.PI);
  tileUV(wrap, 4, 2);
  orient(mesh(g, wrap, m.cellsBlue, -0.42, 0, 0), 'x');
  cyl(g, m.baffle, 0.47, 0.47, 0.7, -0.44, 0, 0, 'x', true, 24); // inside of the hollow trunk
  cyl(g, m.dark, 0.47, 0.47, 0.02, -0.06, 0, 0, 'x');
  hoop(g, m.metal, 0.5, 0.012, -0.79, 0, 0, 'x', 32);
  for (let k = 0; k < 4; k++) { // stabilising fins, in line with the gaps between the engine pods
    const a = (k * Math.PI) / 2;
    const fin = box(g, m.white, 0.34, 0.2, 0.02, -0.6, 0.59 * Math.cos(a), 0.59 * Math.sin(a));
    fin.rotation.x = a;
  }
}

/** Soyuz / Progress / Shenzhou: round orbital module, bell-shaped descent module, service module with two wings. */
function soyuzParts(g: THREE.Group, m: Materials): void {
  ball(g, m.blanket, 0.4, 0.78, 0, 0, 1.1, 1, 1); // orbital module, under its quilted blanket
  hoop(g, m.dark, 0.4, 0.012, 0.78, 0, 0, 'x');
  cyl(g, m.metal, 0.13, 0.16, 0.14, 1.26, 0, 0, 'x'); // docking collar
  strut(g, m.dark, [1.3, 0, 0], [1.5, 0, 0], 0.025); // docking probe
  // descent module: the "headlight" shape — bell flank, rounded shoulder
  lathe(g, m.foilBlack, [[0.43, 0], [0.42, 0.12], [0.33, 0.42], [0.24, 0.55], [0.14, 0.6]], -0.17, 0, 0, 'x', 24);
  cyl(g, m.dark, 0.43, 0.43, 0.04, -0.17, 0, 0, 'x');
  const service = cyl(g, m.hull, 0.4, 0.4, 0.62, -0.5, 0, 0, 'x');
  tileUV(service.geometry, 4, 1);
  const band = cyl(g, m.radiator, 0.405, 0.405, 0.3, -0.5, 0, 0, 'x', true); // radiator band
  tileUV(band.geometry, 1, 3);
  cyl(g, m.foilBlack, 0.4, 0.5, 0.2, -0.91, 0, 0, 'x'); // flared skirt
  nozzle(g, m, 0.16, 0.16, [-1.0, 0, 0], [-1, 0, 0]);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    nozzle(g, m, 0.035, 0.05, [-0.96, 0.44 * Math.cos(a), 0.44 * Math.sin(a)], [-0.3, Math.cos(a), Math.sin(a)]);
  }
  wingPair(g, m, { width: 0.42, length: 1.15, panels: 3, root: 0.4, x: -0.5, yoke: 0.12, tile: 0.14 });
  dish(g, m, 0.11, [0.95, 0.42, 0.25], [0.6, 1, 0.3]); // rendezvous radar
  strut(g, m.dark, [0.8, 0.3, 0.2], [0.95, 0.42, 0.25], 0.012);
  whip(g, m, [0.2, 0.38, 0], [0.4, 1, 0], 0.45);
  whip(g, m, [0.2, -0.38, 0], [0.4, -1, 0], 0.45);
  cyl(g, m.lens, 0.05, 0.05, 0.03, 0.1, 0, 0.36, 'z'); // window
  cyl(g, m.metal, 0.03, 0.03, 0.12, 0.3, -0.34, 0, 'y', false, 8); // periscope
}

/** Generic cargo ship (Tianzhou / HTV): big pressurised can, narrower service section, two wings. */
function cargoParts(g: THREE.Group, m: Materials): void {
  module(g, m, 0.45, 1.4, 0.25, 0, 0, 'x');
  for (const x of [-0.1, 0.6]) hoop(g, m.yellow, 0.455, 0.008, x, 0, 0, 'x'); // handrails
  cyl(g, m.metal, 0.22, 0.26, 0.1, 1.0, 0, 0, 'x'); // docking collar
  cyl(g, m.dark, 0.16, 0.16, 0.03, 1.05, 0, 0, 'x');
  cyl(g, m.foilGold, 0.42, 0.38, 0.62, -0.75, 0, 0, 'x');
  cyl(g, m.dark, 0.38, 0.38, 0.03, -1.07, 0, 0, 'x');
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    nozzle(g, m, 0.07, 0.1, [-1.08, 0.2 * Math.cos(a), 0.2 * Math.sin(a)], [-1, 0, 0]);
    thrusters(g, m, [-0.5, 0.43 * Math.cos(a), 0.43 * Math.sin(a)], [0, Math.cos(a), Math.sin(a)]);
  }
  wingPair(g, m, { width: 0.42, length: 1.3, panels: 3, root: 0.4, x: -0.75, yoke: 0.14, tile: 0.14 });
  dish(g, m, 0.1, [-0.6, 0.5, 0], [0, 1, 0.2]);
  whip(g, m, [0.7, 0.44, 0], [0.5, 1, 0], 0.35);
  ball(g, m.navWhite, 0.02, 0.98, 0.3, 0);
}

/** Core module of a modular station (Tianhe): node, small and large work sections, two wings, relay dish. */
function coreModuleParts(g: THREE.Group, m: Materials): void {
  ball(g, m.hull, 0.15, 0.85, 0, 0); // docking node
  for (const [dx, dy, dz] of [[1, 0, 0], [0, 1, 0], [0, -1, 0]] as V3[]) {
    orient(mesh(g, new THREE.CylinderGeometry(0.08, 0.09, 0.05, facets(20)), m.dark, 0.85 + dx * 0.155, dy * 0.155, dz * 0.155), dx ? 'x' : 'y');
  }
  const small = cyl(g, m.hull, 0.14, 0.14, 0.6, 0.4, 0, 0, 'x');
  tileUV(small.geometry, 4, 3);
  cyl(g, m.hull, 0.14, 0.21, 0.1, 0.05, 0, 0, 'x');
  const large = cyl(g, m.hull, 0.21, 0.21, 0.6, -0.3, 0, 0, 'x');
  tileUV(large.geometry, 6, 2);
  const band = cyl(g, m.radiator, 0.213, 0.213, 0.25, -0.3, 0, 0, 'x', true);
  tileUV(band.geometry, 1, 3);
  cyl(g, m.metal, 0.12, 0.21, 0.07, -0.635, 0, 0, 'x');
  cyl(g, m.dark, 0.09, 0.09, 0.03, -0.68, 0, 0, 'x'); // aft docking port
  wingPair(g, m, { width: 0.26, length: 1.2, panels: 3, root: 0.14, x: 0.42, yoke: 0.1, tile: 0.1, tilt: 0.3, cells: m.cellsAmber, back: m.panelBackGold });
  dish(g, m, 0.08, [-0.35, 0.36, 0.05], [0.2, 1, 0.3]);
  strut(g, m.dark, [-0.35, 0.2, 0], [-0.35, 0.36, 0.05], 0.008);
  // robotic arm folded along the hull
  strut(g, m.white, [0.6, 0.15, 0.04], [0.25, 0.26, 0.1], 0.014);
  strut(g, m.white, [0.25, 0.26, 0.1], [-0.15, 0.25, 0.06], 0.014);
  ball(g, m.metal, 0.022, 0.25, 0.26, 0.1);
  for (const x of [0.2, 0.55]) hoop(g, m.yellow, 0.146, 0.006, x, 0, 0, 'x'); // handrails
  for (const x of [-0.1, -0.5]) hoop(g, m.yellow, 0.216, 0.006, x, 0, 0, 'x');
}

// ---------------------------------------------------------------------------------------
// One builder per kind
// ---------------------------------------------------------------------------------------

const BUILDERS: Record<ModelKind, (g: THREE.Group, m: Materials) => void> = {
  /** Starlink: flat "pizza box" bus, four phased arrays facing Earth, one tall solar array. */
  starlink(g, m) {
    bus(g, m.hull, 1.5, 0.1, 0.85, { bevel: 0.022, tile: 0.6 });
    box(g, m.dark, 1.44, 0.04, 0.87); // edge frame
    for (const [x, z] of [[-0.5, -0.2], [-0.1, -0.2], [-0.5, 0.2], [-0.1, 0.2]]) plate(g, m, m.array, 0.36, 0.36, [x, -0.052, z], [0, -1, 0], 5);
    for (const z of [-0.24, 0.24]) dish(g, m, 0.11, [0.48, -0.11, z], [0.25, -1, z]); // gateway dishes
    for (const [x, z] of [[0.7, 0.38], [0.7, -0.38], [-0.7, 0.38]]) { // laser links to neighbouring satellites
      cyl(g, m.dark, 0.035, 0.04, 0.04, x, 0.065, z, 'y', false, 10);
      ball(g, m.lens, 0.035, x, 0.1, z);
    }
    tracker(g, m, [0.25, 0.05, 0.3], [0.3, 1, 0.5], 0.8);
    tracker(g, m, [0.5, 0.05, 0.3], [0.3, 1, 0.5], 0.8);
    nozzle(g, m, 0.05, 0.07, [-0.76, 0, 0.2], [-1, 0, 0]); // ion thruster
    bus(g, m.foilGold, 0.34, 0.08, 0.3, { x: 0.36, y: 0.085, z: 0.02, bevel: 0.02, tile: 0.4 }); // propellant tank cover
    plate(g, m, m.radiator, 0.5, 0.3, [-0.35, 0.051, 0.22], [0, 1, 0], 3);
    // the single array stands straight up from one long edge: eight hinged panels, cells facing sideways
    const wing = buildWing(m, { width: 1.3, length: 2.9, panels: 8, yoke: 0.2, cells: m.cellsBlue, tile: 0.26 });
    wing.position.set(-0.05, 0.05, -0.3);
    wing.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)));
    g.add(wing);
    for (const x of [-0.5, 0.4]) strut(g, m.metal, [x, 0.05, 0.1], [x * 0.6 - 0.05, 0.62, -0.29], 0.012); // braces holding it upright
  },

  /** OneWeb: tapered gold-foil box, two wings, two flat user antennas and two gimballed gateway dishes below. */
  oneweb(g, m) {
    bus(g, m.foilGold, 0.8, 0.9, 0.7, { top: 0.8 });
    for (const s of [-1, 1]) plate(g, m, m.mirror, 0.44, 0.6, [s * 0.365, 0, 0], [s, 0.09, 0], 5); // radiator walls
    bus(g, m.foilBlack, 0.62, 0.05, 0.54, { y: 0.47, bevel: 0.012 }); // top deck
    wingPair(g, m, { width: 0.7, length: 1.3, panels: 2, root: 0.32, y: 0.15, yoke: 0.24, tilt: 0.5 });
    for (const s of [-1, 1]) {
      const antenna = arrayPanel(m, 0.55, 0.3);
      antenna.position.set(0, -0.5, s * 0.2);
      antenna.rotation.set(Math.PI / 2 - s * 0.35, 0, 0); // facing down and slightly outwards
      g.add(antenna);
      strut(g, m.dark, [s * 0.3, -0.45, 0], [s * 0.46, -0.62, 0], 0.014);
      dish(g, m, 0.15, [s * 0.46, -0.62, 0], [s * 0.3, -1, 0]);
    }
    nozzle(g, m, 0.06, 0.08, [-0.38, 0.2, 0], [-1, 0, 0]);
    thrusters(g, m, [-0.37, -0.25, 0.2], [-1, 0, 0.3]);
    tracker(g, m, [0.15, 0.5, 0.15], [0.3, 1, 0.4]);
    whip(g, m, [0.25, 0.5, -0.2], [0, 1, 0], 0.35);
    whip(g, m, [-0.3, -0.45, 0.25], [0, -1, 0], 0.3);
    helix(g, m, [-0.15, 0.495, -0.1], [0, 1, 0], 0.12, 0.035); // GPS antenna
  },

  /** LEO / MEO constellation comsat (Iridium-like): three-sided silver body, two wings, three splayed mirror-faced antenna panels. */
  comsat(g, m) {
    prism(g, m.foilSilver, 3, 0.4, 0.44, 1.4, 0, 0, 0, 0.6, -Math.PI / 3);
    prism(g, m.foilBlack, 3, 0.46, 0.46, 0.14, 0, -0.62, 0, 0.6, -Math.PI / 3);
    prism(g, m.foilGold, 3, 0.36, 0.42, 0.16, 0, 0.72, 0, 0.5, -Math.PI / 3);
    wingPair(g, m, { width: 0.6, length: 1.5, panels: 3, root: 0.22, y: 0.5, yoke: 0.3, tilt: 0.3 });
    for (let k = 0; k < 3; k++) {
      // main mission antennas: hinged at the Earth-facing end, leaning outwards so they look down and out
      const holder = new THREE.Group();
      holder.rotation.y = Math.PI / 2 + (k * TAU) / 3;
      const antenna = arrayPanel(m, 0.6, 0.95, 10, m.mirror);
      antenna.position.set(0, -0.26, 0.46);
      antenna.rotation.x = 0.45;
      holder.add(antenna);
      for (const s of [-1, 1]) strut(holder, m.dark, [s * 0.2, -0.2, 0.2], [s * 0.2, -0.05, 0.52], 0.012); // deployment struts
      g.add(holder);
    }
    for (const s of [-1, 1]) dish(g, m, 0.12, [-0.05 + s * 0.14, -0.8, 0.12 * s], [s * 0.25, -1, 0]); // feeder links
    for (const [x, z] of [[0.12, 0.2], [0.12, -0.2]]) box(g, m.dark, 0.03, 0.2, 0.14, x, 0.2, z).rotation.y = z > 0 ? -Math.PI / 6 : Math.PI / 6; // crosslink antennas
    nozzle(g, m, 0.08, 0.1, [-0.05, 0.8, 0], [0, 1, 0]);
    tracker(g, m, [0.08, 0.8, 0.1], [0.5, 1, 0.5]);
    whip(g, m, [-0.2, 0.8, -0.05], [-0.2, 1, -0.2], 0.4);
  },

  /** Big geostationary comsat: tall foil box with mirror radiator walls, long wings, two big reflectors with feed horns. */
  geocomsat(g, m) {
    bus(g, m.foilGold, 1.0, 1.5, 1.0, { bevel: 0.07 });
    for (const s of [-1, 1]) plate(g, m, m.mirror, 0.8, 1.26, [0, 0, s * 0.5], [0, 0, s], 5); // north / south radiator walls
    bus(g, m.foilBlack, 1.06, 0.07, 1.06, { y: -0.78, bevel: 0.02 }); // Earth deck
    wingPair(g, m, { width: 1.0, length: 2.4, panels: 3, root: 0.5, y: 0.1, yoke: 0.42, tilt: 0.35 });
    for (const s of [-1, 1]) {
      // east / west reflector on its two-legged arm, and the horn cluster on the deck that lights it
      const apex: V3 = [s * 1.12, -1.02, 0];
      for (const z of [-0.14, 0.14]) strut(g, m.dark, [s * 0.5, -0.45, z], [s * 1.08, -0.98, z * 0.4], 0.022);
      dish(g, m, 0.64, apex, [-s * 0.9, -0.6, 0], false);
      bus(g, m.foilGold, 0.2, 0.2, 0.34, { x: s * 0.3, y: -0.9, bevel: 0.03, tile: 0.4 });
      for (const z of [-0.1, 0, 0.1]) cyl(g, m.metal, 0.03, 0.055, 0.12, s * 0.36, -1.04, z, 'y', false, 10).rotation.z = -s * 0.7;
    }
    dish(g, m, 0.2, [0, -0.86, 0.3], [0, -1, 0.15]); // steerable spot-beam dishes on the deck
    dish(g, m, 0.14, [0, -0.86, -0.32], [0.2, -1, -0.1]);
    strut(g, m.metal, [0, -0.8, 0], [0, -1.3, 0], 0.012); // omni antenna mast
    cyl(g, m.white, 0.01, 0.04, 0.08, 0, -1.33, 0, 'y', false, 10);
    cyl(g, m.dark, 0.3, 0.36, 0.06, 0, 0.77, 0, 'y', false, 20); // launcher adapter ring
    nozzle(g, m, 0.17, 0.26, [0, 0.8, 0], [0, 1, 0]); // apogee engine
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) thrusters(g, m, [sx * 0.42, 0.75, sz * 0.42], [sx, 1, sz]);
    tracker(g, m, [0.3, 0.75, 0.15], [0.6, 1, 0.3]);
    tracker(g, m, [-0.3, 0.75, 0.15], [-0.6, 1, 0.3]);
    for (const s of [-1, 1]) plate(g, m, m.radiator, 0.6, 0.5, [s * 0.5, 0.35, 0], [s, 0, 0], 3);
    helix(g, m, [0.3, 0.75, -0.3], [0.3, 1, -0.3], 0.14, 0.04); // telemetry antenna
  },

  /** Navigation satellite (GPS-like): dark foil box with a gold band, two wings, a farm of helix antennas on the Earth deck. */
  gnss(g, m) {
    bus(g, m.foilBlack, 0.95, 0.95, 0.95, { bevel: 0.06 });
    bus(g, m.foilGold, 0.99, 0.3, 0.99, { y: 0.24, bevel: 0.03 });
    bus(g, m.dark, 1.16, 0.05, 1.16, { y: -0.5, bevel: 0.015 }); // antenna deck, wider than the body
    for (const s of [-1, 1]) plate(g, m, m.mirror, 0.7, 0.36, [0, -0.15, s * 0.476], [0, 0, s], 5);
    wingPair(g, m, { width: 0.85, length: 1.9, panels: 2, root: 0.48, yoke: 0.32, tilt: 0.3 });
    for (let k = 0; k < 8; k++) helix(g, m, [0.33 * Math.cos((k * TAU) / 8), -0.525, 0.33 * Math.sin((k * TAU) / 8)], [0, -1, 0], 0.3, 0.055); // navigation-signal array
    for (let k = 0; k < 4; k++) helix(g, m, [0.13 * Math.cos(Math.PI / 4 + (k * TAU) / 4), -0.525, 0.13 * Math.sin(Math.PI / 4 + (k * TAU) / 4)], [0, -1, 0], 0.36, 0.055);
    for (const s of [-1, 1]) { // UHF crossed dipoles on the deck corners
      whip(g, m, [s * 0.52, -0.52, s * 0.52], [s * 0.4, -1, s * 0.4], 0.55);
      whip(g, m, [s * 0.52, -0.52, -s * 0.52], [s * 0.4, -1, -s * 0.4], 0.55);
    }
    plate(g, m, m.array, 0.22, 0.22, [0.45, -0.527, -0.45], [0, -1, 0], 20); // laser retro-reflector array
    dish(g, m, 0.13, [-0.47, -0.56, 0.45], [-0.3, -1, 0.3]); // crosslink
    nozzle(g, m, 0.11, 0.16, [0, 0.49, 0], [0, 1, 0]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) thrusters(g, m, [sx * 0.42, 0.48, sz * 0.42], [sx, 1, sz]);
    tracker(g, m, [-0.3, 0.48, 0.2], [-0.5, 1, 0.5]);
    helix(g, m, [0.3, 0.475, -0.25], [0, 1, 0], 0.12, 0.04);
  },

  /** A ~100 kg small satellite: six-sided foil bus with body-mounted cells, two wings, camera and antennas on the Earth side. */
  smallsat(g, m) {
    const R = 0.42, flat = R * Math.cos(Math.PI / 6); // corner radius, and distance from the axis to a flat side
    prism(g, m.foilGold, 6, R, R, 0.62, 0, 0, 0, 0.5);
    for (const y of [-0.325, 0.325]) prism(g, m.dark, 6, R * 1.04, R * 1.04, 0.035, 0, y, 0);
    for (const a of [30, 150, 210, 330]) { // cells on the four sides that have no wing
      const c = Math.cos((a * Math.PI) / 180), s = Math.sin((a * Math.PI) / 180);
      plate(g, m, m.cellsBlue, 0.36, 0.5, [flat * c, 0, flat * s], [c, 0, s], 1 / 0.24);
    }
    plate(g, m, m.radiator, 0.4, 0.4, [0, 0.344, 0], [0, 1, 0], 4);
    wingPair(g, m, { width: 0.55, length: 1.1, panels: 2, root: flat, yoke: 0.16, tilt: 0.35, tile: 0.24 });
    cyl(g, m.foilSilver, 0.17, 0.17, 0.3, 0.08, -0.48, 0, 'y', true, 20); // imager barrel
    cyl(g, m.baffle, 0.16, 0.16, 0.29, 0.08, -0.48, 0, 'y', true, 20);
    cyl(g, m.lens, 0.16, 0.16, 0.01, 0.08, -0.42, 0, 'y', false, 20);
    hoop(g, m.dark, 0.17, 0.012, 0.08, -0.63, 0, 'y', 20);
    helix(g, m, [-0.22, -0.34, 0.15], [0, -1, 0], 0.16, 0.04); // downlink
    plate(g, m, m.array, 0.14, 0.14, [-0.22, -0.345, -0.15], [0, -1, 0], 14); // S-band patch
    tracker(g, m, [-0.18, 0.345, 0.14], [-0.4, 1, 0.5]);
    tracker(g, m, [-0.18, 0.345, -0.14], [-0.4, 1, -0.5]);
    nozzle(g, m, 0.06, 0.09, [-R, 0, 0], [-1, 0, 0]);
    whip(g, m, [0.25, 0.34, -0.15], [0.3, 1, -0.2], 0.4);
    box(g, m.dark, 0.1, 0.02, 0.1, 0.2, 0.35, 0.12); // GPS patch
  },

  /** 3U CubeSat: a 10 × 10 × 30 cm frame clad in cells, a double fold-out panel each side, tape antennas, camera. */
  cubesat(g, m) {
    box(g, m.dark, 0.9, 0.28, 0.28);
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) box(g, m.metal, 0.93, 0.04, 0.04, 0, sy * 0.135, sz * 0.135); // anodised launch rails
    for (const x of [-0.455, 0.455]) box(g, m.metal, 0.02, 0.3, 0.3, x, 0, 0); // end plates
    for (const s of [-1, 1]) {
      plate(g, m, m.cellsBlue, 0.84, 0.22, [0, 0, s * 0.142], [0, 0, s], 1 / 0.15); // body-mounted cells on the side faces
      // deployable panels, hinged along the top edge and raised a little, so the body stays in view
      const flap = new THREE.Group();
      for (const k of [0, 1]) {
        const panel = solarPanel(m, 0.86, 0.29, m.cellsBlue, m.panelBack, 0.145);
        panel.position.z = s * (0.155 + k * 0.3);
        flap.add(panel);
        for (const x of [-0.3, 0.3]) cyl(flap, m.yellow, 0.012, 0.012, 0.06, x, 0, s * (0.005 + k * 0.3), 'x', false, 8); // sprung hinges
      }
      flap.position.set(0, 0.15, s * 0.15);
      flap.rotation.x = -s * 0.3;
      g.add(flap);
    }
    plate(g, m, m.cellsBlue, 0.84, 0.22, [0, 0.142, 0], [0, 1, 0], 1 / 0.15);
    plate(g, m, m.array, 0.26, 0.22, [-0.2, -0.142, 0], [0, -1, 0], 34); // patch antenna on the Earth face
    plate(g, m, m.foilGold, 0.3, 0.22, [0.22, -0.142, 0], [0, -1, 0], 2);
    cyl(g, m.foilGold, 0.11, 0.11, 0.1, 0.5, 0, 0, 'x', false, 16); // camera barrel
    cyl(g, m.lens, 0.09, 0.09, 0.01, 0.552, 0, 0, 'x', false, 16);
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) whip(g, m, [-0.46, sy * 0.12, sz * 0.12], [-0.5, sy, sz], 0.5, 0.005); // tape antennas
    helix(g, m, [0.3, 0.148, 0], [0, 1, 0], 0.07, 0.03);
  },

  /**
   * Optical Earth-imaging satellite (Sentinel-2 / Landsat-like): copper-gold foil box, a big
   * telescope barrel looking straight down with its cover swung open, one three-panel wing.
   */
  observer(g, m) {
    bus(g, m.foilGold, 1.0, 0.95, 0.95, { y: 0.22, bevel: 0.07 });
    bus(g, m.foilBlack, 1.04, 0.2, 0.99, { y: 0.52, bevel: 0.03 });
    plate(g, m, m.mirror, 0.7, 0.5, [0, 0.12, -0.476], [0, 0, -1], 5); // radiator on the shaded wall
    plate(g, m, m.radiator, 0.5, 0.5, [0.1, 0.622, 0], [0, 1, 0], 4);
    cyl(g, m.foilSilver, 0.42, 0.44, 1.05, 0, -0.75, 0, 'y', true, 28); // telescope barrel
    cyl(g, m.baffle, 0.4, 0.4, 1.03, 0, -0.75, 0, 'y', true, 28); // its dark inside
    cyl(g, m.lens, 0.4, 0.4, 0.02, 0, -0.5, 0, 'y', false, 28); // primary mirror
    for (const y of [-0.3, -0.78, -1.27]) hoop(g, m.dark, 0.435, 0.014, 0, y, 0, 'y', 28);
    cyl(g, m.dark, 0.07, 0.07, 0.05, 0, -1.18, 0, 'y', false, 10); // secondary mirror on its spider
    for (let k = 0; k < 3; k++) strut(g, m.dark, [0, -1.18, 0], [0.4 * Math.cos((k * TAU) / 3), -1.18, 0.4 * Math.sin((k * TAU) / 3)], 0.008);
    const door = new THREE.Group(); // aperture cover, swung open
    cyl(door, m.foilGold, 0.43, 0.43, 0.02, -0.43, 0, 0, 'y', false, 28);
    cyl(door, m.baffle, 0.4, 0.4, 0.006, -0.43, 0.014, 0, 'y', false, 28);
    door.position.set(0.43, -1.29, 0);
    door.rotation.z = 2.0;
    g.add(door);
    const wing = buildWing(m, { width: 0.9, length: 2.3, panels: 3, yoke: 0.34 });
    wing.position.set(0, 0.3, 0.475);
    wing.rotation.z = 0.4;
    g.add(wing);
    strut(g, m.dark, [-0.5, -0.1, -0.2], [-0.78, -0.42, -0.3], 0.016);
    dish(g, m, 0.17, [-0.78, -0.42, -0.3], [-0.3, -1, -0.1]); // data downlink
    for (const z of [-0.2, 0, 0.2]) tracker(g, m, [0.36, 0.62, z], [0.6, 1, z * 2], 1.2); // star-tracker cluster
    helix(g, m, [-0.3, 0.62, 0.25], [0, 1, 0], 0.12, 0.04);
    for (const s of [-1, 1]) thrusters(g, m, [s * 0.5, 0.5, -0.3], [s, 0.3, 0]);
    nozzle(g, m, 0.06, 0.08, [-0.5, 0.2, 0], [-1, 0, 0]);
    whip(g, m, [-0.35, 0.62, -0.3], [-0.2, 1, -0.2], 0.4);
  },

  /** Radar-imaging (SAR) satellite: a long flat radar antenna slung beneath the bus, looking sideways. */
  radarsat(g, m) {
    bus(g, m.foilGold, 1.3, 0.6, 0.6, { bevel: 0.05 });
    bus(g, m.foilBlack, 0.4, 0.64, 0.64, { x: -0.5, bevel: 0.04 });
    plate(g, m, m.radiator, 0.7, 0.4, [0.2, 0.301, 0], [0, 1, 0], 4);
    const radar = new THREE.Group();
    for (let i = -2; i <= 2; i++) { // five hinged antenna leaves
      const leaf = arrayPanel(m, 0.72, 0.95, 17, m.radar);
      leaf.position.x = i * 0.745;
      radar.add(leaf);
      box(radar, m.foilGold, 0.6, 0.8, 0.02, i * 0.745, 0, -0.025); // insulated back of each leaf
      if (i < 2) for (const y of [-0.3, 0.3]) cyl(radar, m.metal, 0.018, 0.018, 0.1, i * 0.745 + 0.372, y, -0.02);
    }
    for (const y of [-0.36, 0.36]) strut(radar, m.metal, [-1.85, y, -0.05], [1.85, y, -0.05], 0.014); // stiffening rails
    radar.position.set(0, -0.6, 0.12);
    radar.rotation.x = Math.PI / 3; // elements face down and to one side
    g.add(radar);
    for (const x of [-1.3, -0.5, 0.5, 1.3]) strut(g, m.dark, [x * 0.45, -0.3, 0], [x, -0.56, 0.08], 0.016);
    wingPair(g, m, { width: 0.7, length: 1.3, panels: 2, root: 0.3, y: 0.15, yoke: 0.2, tilt: -0.3 });
    strut(g, m.dark, [0.65, -0.1, -0.3], [0.9, -0.3, -0.6], 0.014);
    dish(g, m, 0.14, [0.9, -0.3, -0.6], [0.2, -1, -0.4]); // data downlink
    tracker(g, m, [0.5, 0.3, -0.15], [0.4, 1, -0.5]);
    tracker(g, m, [-0.25, 0.3, -0.15], [-0.4, 1, -0.5]);
    helix(g, m, [0.55, 0.3, 0.15], [0, 1, 0], 0.1, 0.035);
    nozzle(g, m, 0.05, 0.08, [-0.71, 0, 0], [-1, 0, 0]);
    for (const s of [-1, 1]) thrusters(g, m, [0.65, 0.1, s * 0.2], [1, 0, s * 0.5]);
    whip(g, m, [0.6, 0.3, 0.2], [0.2, 1, 0.1], 0.4);
  },

  /**
   * Weather satellite (polar or geostationary, three-axis stabilised — NOAA, MetOp, Fengyun-3/4,
   * GOES): long foil box, one big canted solar wing, the Earth face crowded with an imager, a
   * sounder, a microwave dish and antennas, and a magnetometer on a long boom.
   */
  weather(g, m) {
    bus(g, m.foilGold, 1.7, 0.8, 0.8, { bevel: 0.05 });
    bus(g, m.foilBlack, 0.4, 0.84, 0.84, { x: -0.55, bevel: 0.04 }); // propulsion module
    bus(g, m.dark, 1.74, 0.05, 0.86, { y: -0.42, bevel: 0.012 }); // instrument deck
    plate(g, m, m.mirror, 0.9, 0.56, [0.3, 0.401, 0], [0, 1, 0], 5); // radiators: space side and shaded wall
    plate(g, m, m.mirror, 0.9, 0.5, [0.3, 0.02, 0.401], [0, 0, 1], 5);
    // imager: white box, dark rectangular aperture under a sunshade, scan-motor drum on its side
    bus(g, m.white, 0.46, 0.34, 0.5, { x: 0.5, y: -0.61, bevel: 0.03 });
    plate(g, m, m.lens, 0.26, 0.3, [0.5, -0.782, 0], [0, -1, 0]);
    for (const s of [-1, 1]) box(g, m.dark, 0.3, 0.12, 0.012, 0.5, -0.84, s * 0.17);
    box(g, m.dark, 0.012, 0.12, 0.35, 0.65, -0.84, 0);
    cyl(g, m.foilGold, 0.09, 0.09, 0.14, 0.5, -0.6, 0.31, 'z', false, 12);
    box(g, m.radiator, 0.34, 0.02, 0.3, 0.5, -0.56, -0.4).rotation.x = -0.5; // its passive cooler, facing cold space
    // infrared sounder: foil barrel with a glass eye
    cyl(g, m.foilSilver, 0.14, 0.14, 0.3, 0.02, -0.59, 0.14, 'y', false, 16);
    cyl(g, m.lens, 0.11, 0.11, 0.01, 0.02, -0.745, 0.14, 'y', false, 16);
    hoop(g, m.dark, 0.14, 0.012, 0.02, -0.74, 0.14, 'y', 16);
    // microwave sounder: a small dish that scans across the track
    bus(g, m.foilGold, 0.26, 0.2, 0.26, { x: 0.02, y: -0.54, z: -0.2, bevel: 0.03, tile: 0.4 });
    dish(g, m, 0.13, [0.02, -0.68, -0.2], [0.35, -1, 0]);
    // data downlink: steerable dish on a short arm, and helix antennas
    strut(g, m.dark, [-0.3, -0.44, 0.2], [-0.36, -0.66, 0.26], 0.016);
    dish(g, m, 0.2, [-0.36, -0.7, 0.26], [-0.15, -1, 0.2]);
    helix(g, m, [-0.72, -0.445, -0.2], [0, -1, 0], 0.5, 0.055); // search-and-rescue antenna
    helix(g, m, [0.78, -0.445, 0.3], [0, -1, 0], 0.18, 0.045);
    whip(g, m, [-0.8, -0.44, 0.3], [-0.3, -1, 0.2], 0.6);
    // one wing on a long yoke, canted towards the Sun
    const wing = buildWing(m, { width: 0.95, length: 2.5, panels: 4, yoke: 0.45 });
    wing.position.set(-0.1, 0.1, -0.4);
    wing.rotation.set(0, Math.PI, -0.45);
    g.add(wing);
    strut(g, m.metal, [0.85, 0.3, 0.3], [2.0, 0.8, 0.55], 0.012); // magnetometer boom
    box(g, m.dark, 0.09, 0.07, 0.07, 2.0, 0.8, 0.55);
    box(g, m.dark, 0.07, 0.05, 0.05, 1.45, 0.56, 0.43);
    tracker(g, m, [0.72, 0.4, -0.25], [0.3, 1, -0.6], 1.2);
    tracker(g, m, [0.72, 0.4, 0.25], [0.3, 1, 0.6], 1.2);
    helix(g, m, [-0.55, 0.42, 0.2], [0, 1, 0], 0.12, 0.04);
    nozzle(g, m, 0.07, 0.1, [-0.85, 0, 0], [-1, 0, 0]);
    for (const sz of [-1, 1]) thrusters(g, m, [0.85, 0.15, sz * 0.25], [1, 0, sz * 0.4]);
    for (const sz of [-1, 1]) thrusters(g, m, [-0.76, 0.2, sz * 0.41], [-0.3, 0.3, sz]);
  },

  /**
   * Spin-stabilised weather satellite (Fengyun-2, Meteosat second generation): a drum covered
   * in solar cells that turns about its own axis — so every cell takes its turn in the Sun and
   * no wings are needed — with a stack of antennas on one end that is turned back the other
   * way to stay facing Earth. The spin axis points north–south, across the direction of travel
   * (the model's Z); Earth is towards −Y.
   */
  spinner(g, m) {
    const R = 0.62, H = 0.94; // the real drum: 2.1 m across, 1.6 m tall
    // Cells all the way round. Open tube with its own texture repeat so the cells stay square.
    const drum = new THREE.CylinderGeometry(R, R, H, facets(40, 20), 1, true);
    tileUV(drum, 11, 2.7);
    orient(mesh(g, drum, m.cellsBlue), 'z');
    cyl(g, m.dark, R - 0.004, R - 0.004, H, 0, 0, 0, 'z', false, 40); // the wall the cells are mounted on
    for (const z of [-H / 2, H / 2]) hoop(g, m.metal, R, 0.014, 0, 0, z, 'z', 40); // rims
    hoop(g, m.foilGold, R + 0.002, 0.03, 0, 0, -0.06, 'z', 40); // the bare band the telescope looks out through
    cyl(g, m.foilGold, R - 0.01, R - 0.01, 0.02, 0, 0, H / 2 + 0.005, 'z', false, 40); // top deck
    cyl(g, m.foilBlack, R - 0.01, R - 0.01, 0.02, 0, 0, -H / 2 - 0.005, 'z', false, 40); // aft deck
    // The scanning radiometer looks out sideways through a window in the drum wall; the spin
    // sweeps it across the Earth line by line.
    plate(g, m, m.lens, 0.26, 0.2, [0, -R - 0.004, -0.06], [0, -1, 0]);
    plate(g, m, m.radiator, 0.3, 0.26, [0, R + 0.004, 0.16], [0, 1, 0], 3); // passive cooler, on the cold side
    // The antenna stack on the north end, held still against the spin.
    cyl(g, m.white, 0.3, 0.34, 0.07, 0, 0, H / 2 + 0.05, 'z', false, 28); // bearing housing
    cyl(g, m.array, 0.24, 0.24, 0.34, 0, 0, H / 2 + 0.25, 'z', false, 28); // S-band ring of elements
    hoop(g, m.metal, 0.245, 0.01, 0, 0, H / 2 + 0.42, 'z', 28);
    cyl(g, m.white, 0.11, 0.14, 0.24, 0, 0, H / 2 + 0.54, 'z', false, 20); // L-band cylinder
    cyl(g, m.metal, 0.03, 0.03, 0.34, 0, 0, H / 2 + 0.83, 'z', false, 10); // mast
    dish(g, m, 0.2, [0, -0.07, H / 2 + 0.86], [0, -1, 0.12]); // the dish that talks to the ground
    helix(g, m, [0, 0, H / 2 + 1.0], [0, 0, 1], 0.14, 0.035); // UHF data-collection antenna on the tip
    for (const a of [0.6, 2.7, 4.8]) whip(g, m, [0.3 * Math.cos(a), 0.3 * Math.sin(a), H / 2 + 0.02], [Math.cos(a), Math.sin(a), 1.2], 0.3);
    // South end: the solid motor that lifted it to geostationary height, long since burnt out.
    nozzle(g, m, 0.24, 0.3, [0, 0, -H / 2 - 0.01], [0, 0, -1]);
    hoop(g, m.dark, 0.3, 0.02, 0, 0, -H / 2 - 0.02, 'z', 24);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      thrusters(g, m, [R * Math.cos(a), R * Math.sin(a), -H / 2 + 0.05], [Math.cos(a), Math.sin(a), -0.6]); // spin-up and station-keeping jets
    }
  },

  /** Space telescope (Hubble-like): stepped silver tube aimed away from Earth, open aperture door, two arrays, two dishes. */
  telescope(g, m) {
    const aft = cyl(g, m.foilSilver, 0.5, 0.5, 1.1, 0, -0.75, 0, 'y', false, 32); // aft shroud
    tileUV(aft.geometry, 4, 1.4);
    cyl(g, m.dark, 0.52, 0.52, 0.07, 0, -0.2, 0, 'y', false, 32);
    const ring = cyl(g, m.hull, 0.46, 0.46, 0.3, 0, -0.03, 0, 'y', false, 32); // equipment ring
    tileUV(ring.geometry, 6, 1);
    const tube = cyl(g, m.foilSilver, 0.4, 0.4, 1.25, 0, 0.72, 0, 'y', true, 32); // forward light shield
    tileUV(tube.geometry, 3.4, 1.6);
    cyl(g, m.baffle, 0.385, 0.385, 1.25, 0, 0.72, 0, 'y', true, 32); // dark inside of the tube
    cyl(g, m.lens, 0.385, 0.385, 0.02, 0, 0.3, 0, 'y', false, 32); // primary mirror
    cyl(g, m.dark, 0.08, 0.08, 0.05, 0, 1.0, 0); // secondary mirror and its spider
    for (let k = 0; k < 4; k++) strut(g, m.dark, [0, 1.0, 0], [0.385 * Math.cos((k * Math.PI) / 2), 1.0, 0.385 * Math.sin((k * Math.PI) / 2)], 0.008);
    cyl(g, m.dark, 0.41, 0.41, 0.04, 0, 1.345, 0, 'y', true, 32);
    const door = new THREE.Group(); // aperture door, open
    cyl(door, m.foilSilver, 0.4, 0.4, 0.025, -0.4, 0, 0, 'y', false, 32);
    cyl(door, m.baffle, 0.37, 0.37, 0.006, -0.4, -0.016, 0, 'y', false, 32);
    door.position.set(0.4, 1.36, 0);
    door.rotation.z = -1.85;
    g.add(door);
    for (const s of [-1, 1]) {
      // rigid solar array on a mast, cells facing sideways
      strut(g, m.metal, [0, 0.45, s * 0.4], [0, 0.45, s * 0.72], 0.022);
      const array = solarPanel(m, 1.9, 0.72, m.cellsBlue, m.panelBackGold, 0.24);
      array.position.set(0, 0.45, s * 1.08);
      array.rotation.z = -Math.PI / 2;
      g.add(array);
      for (const y of [-0.45, 0.45, 1.35]) box(g, m.metal, 0.03, 0.025, 0.74, 0.012, y, s * 1.08); // array frame bars
      // high-gain antenna on its own boom
      strut(g, m.metal, [s * 0.5, -0.35, 0], [s * 1.05, -0.35, 0], 0.014);
      dish(g, m, 0.2, [s * 1.05, -0.35, 0], [s * 0.5, -0.6, 0.6]);
    }
    for (const y of [0.3, 0.9]) hoop(g, m.yellow, 0.412, 0.01, 0, y, 0, 'y', 32); // handrails
    for (const y of [-0.5, -1.0]) hoop(g, m.yellow, 0.512, 0.01, 0, y, 0, 'y', 32);
    for (let k = 0; k < 3; k++) { // instrument bay doors
      const a = 0.6 + (k * TAU) / 3;
      plate(g, m, m.hull, 0.36, 0.6, [0.5 * Math.cos(a), -0.8, 0.5 * Math.sin(a)], [Math.cos(a), 0, Math.sin(a)], 2);
    }
    cyl(g, m.dark, 0.3, 0.3, 0.03, 0, -1.31, 0);
    helix(g, m, [0, -1.32, 0], [0, -1, 0], 0.1, 0.035); // low-gain antenna
  },

  /** International Space Station: 109 m truss with eight solar wings and radiators, and the line of modules below it. */
  iss(g, m) {
    const R = 0.15; // radius of a US-segment module (4.2 m); 1 model unit ≈ 14 m
    // --- US segment, front (+X) to back ---
    module(g, m, R, 0.6, 0, 0, 0, 'x'); // Destiny laboratory
    module(g, m, R, 0.5, 0.57, 0, 0, 'x'); // Harmony node
    module(g, m, R, 0.48, 0.57, 0, 0.39, 'z'); // Columbus
    module(g, m, R * 1.05, 0.78, 0.57, 0, -0.54, 'z'); // Kibo
    module(g, m, R * 0.95, 0.28, 0.57, 0.3, -0.72, 'y'); // Kibo logistics module
    box(g, m.metal, 0.4, 0.04, 0.34, 0.57, -0.02, -1.1); // Kibo's exposed platform and its experiments
    for (const [x, z] of [[0.45, -1.02], [0.7, -1.05], [0.5, -1.2], [0.68, -1.2]]) box(g, m.foilGold, 0.1, 0.1, 0.1, x, 0.05, z);
    cyl(g, m.dark, 0.07, 0.115, 0.16, 0.9, 0, 0, 'x'); // docking adapter
    dock(g, dragonParts, m, 0.28, [1.2, 0, 0], [-1, 0, 0]); // Crew Dragon, nose towards the station
    module(g, m, R, 0.38, -0.5, 0, 0, 'x'); // Unity node
    module(g, m, R * 0.95, 0.24, -0.5, 0, 0.28, 'z'); // Quest airlock (equipment lock)
    cyl(g, m.hull, 0.09, 0.09, 0.18, -0.5, 0, 0.49, 'z', false, 12); //   … and its narrower crew lock
    for (const s of [-1, 1]) ball(g, m.white, 0.06, -0.5 + s * 0.13, 0.08, 0.36); // airlock gas tanks
    module(g, m, R, 0.47, -0.5, 0, -0.39, 'z'); // Tranquility node
    cyl(g, m.dark, 0.06, 0.1, 0.08, -0.5, -0.19, -0.5, 'y', false, 8); // Cupola
    cyl(g, m.lens, 0.058, 0.058, 0.01, -0.5, -0.232, -0.5, 'y', false, 8);
    module(g, m, R * 0.75, 0.26, -0.78, 0, -0.5, 'x', m.blanket); // inflatable module
    module(g, m, R, 0.45, -0.12, 0, -0.5, 'x'); // storage module on Tranquility's forward port
    cyl(g, m.dark, 0.115, 0.07, 0.14, -0.76, 0, 0, 'x', false, 12);
    // --- Russian segment, under quilted blankets ---
    module(g, m, 0.14, 0.88, -1.27, 0, 0, 'x', m.blanket); // Zarya
    wingPair(g, m, { width: 0.2, length: 0.3, panels: 1, root: 0.14, x: -1.27, yoke: 0.06, tile: 0.1 }); //   its retracted arrays
    ball(g, m.blanket, 0.1, -1.76, 0, 0); // Zvezda: node, narrow and wide sections
    cyl(g, m.blanket, 0.1, 0.1, 0.3, -1.97, 0, 0, 'x', false, 16);
    cyl(g, m.blanket, 0.1, 0.14, 0.06, -2.15, 0, 0, 'x', false, 16);
    cyl(g, m.blanket, 0.14, 0.14, 0.42, -2.39, 0, 0, 'x', false, 16);
    cyl(g, m.dark, 0.08, 0.08, 0.1, -2.65, 0, 0, 'x', false, 12);
    wingPair(g, m, { width: 0.22, length: 0.95, panels: 3, root: 0.14, x: -2.36, yoke: 0.08, tile: 0.1 });
    module(g, m, 0.14, 0.85, -1.76, -0.52, 0, 'y', m.hull); // Nauka laboratory
    wingPair(g, m, { width: 0.2, length: 0.7, panels: 2, root: 0.14, x: -1.76, y: -0.7, yoke: 0.08, tile: 0.1 });
    strut(g, m.white, [-1.62, -0.3, 0.06], [-1.62, -0.85, 0.12], 0.012); // European robotic arm
    ball(g, m.hull, 0.09, -1.76, -1.03, 0); // Prichal node
    dock(g, soyuzParts, m, 0.2, [-1.76, -1.42, 0], [0, 1, 0]); // Soyuz, docked below
    module(g, m, 0.09, 0.28, -1.76, 0.24, 0, 'y', m.blanket); // Poisk
    module(g, m, 0.09, 0.4, -1.05, -0.34, 0, 'y', m.blanket); // Rassvet
    dock(g, soyuzParts, m, 0.2, [-3.0, 0, 0], [1, 0, 0]); // Progress cargo ship at the aft port
    // --- truss: a six-sided girder in segments, crowded with equipment ---
    const TY = 0.33; // truss height above the module centre line
    girder(g, m, 0.9, 0.15, 0, TY, 0); // centre segment, bolted to Destiny
    for (const z of [-0.2, 0.2]) strut(g, m.metal, [0.1, 0.14, z], [0.12, TY - 0.1, z * 1.4], 0.012);
    box(g, m.foilGold, 0.2, 0.26, 0.2, -0.5, 0.3, 0); // Z1 segment on top of Unity …
    strut(g, m.metal, [-0.5, 0.43, 0], [-0.5, 0.62, 0.05], 0.01);
    dish(g, m, 0.09, [-0.5, 0.62, 0.05], [0.3, 1, 0.4]); //   … carrying the main relay dish
    for (const side of [-1, 1]) {
      girder(g, m, 0.98, 0.14, 0, TY, side * 0.96);
      girder(g, m, 0.62, 0.14, 0, TY, side * 1.78);
      // thermal radiators: three accordion panels pointing aft
      for (let k = -1; k <= 1; k++) {
        const panel = box(g, m.radiator, 1.5, 0.014, 0.26, -0.92, TY, side * (1.0 + k * 0.28));
        tileUV(panel.geometry, 1, 6);
        panel.rotation.x = k * 0.1;
      }
      box(g, m.dark, 0.16, 0.2, 0.9, -0.1, TY, side * 1.0); // radiator beam
      for (const y of [1, -1]) box(g, m.foilGold, 0.3, 0.12, 0.34, 0.02, TY + y * 0.2, side * 1.75); // external stowage platforms
      box(g, m.white, 0.14, 0.1, 0.2, 0.06, TY + 0.18, side * 0.7);
      cyl(g, m.dark, 0.19, 0.19, 0.06, 0, TY, side * 2.12, 'z', false, 20); // rotary joint that turns the arrays
      // everything outboard of the rotary joint turns together to follow the Sun
      const outboard = new THREE.Group();
      outboard.position.set(0, TY, 0);
      outboard.rotation.z = 0.5;
      girder(outboard, m, 1.5, 0.12, 0, 0, side * 2.92);
      for (const z of [2.55, 3.45]) {
        for (const dir of [-1, 1]) {
          const wing = blanketWing(m, 2.4, 0.82, 0.2);
          wing.position.set(dir * 0.16, 0, side * z);
          wing.rotation.set(0, (dir * Math.PI) / 2, dir * 0.25);
          outboard.add(wing);
        }
        box(outboard, m.dark, 0.34, 0.18, 0.2, 0, 0, side * z); // array gimbal assembly
        const cooler = box(outboard, m.radiator, 0.012, 0.75, 0.26, 0, -0.5, side * (z + 0.3)); // array radiator
        tileUV(cooler.geometry, 4, 1);
      }
      g.add(outboard);
      ball(g, side === 1 ? m.navGreen : m.navRed, 0.03, 0, TY, side * 3.72);
    }
    // robotic arm, standing on the truss
    strut(g, m.white, [0.16, TY + 0.1, 0.35], [0.5, TY + 0.5, 0.55], 0.016);
    strut(g, m.white, [0.5, TY + 0.5, 0.55], [0.95, TY + 0.2, 0.3], 0.016);
    for (const p of [[0.16, TY + 0.1, 0.35], [0.5, TY + 0.5, 0.55], [0.95, TY + 0.2, 0.3]] as V3[]) ball(g, m.metal, 0.028, p[0], p[1], p[2]);
    ball(g, m.navWhite, 0.025, -2.72, 0.05, 0);
  },

  /** Tiangong: T-shaped station — core module, two laboratory modules with huge wings, docked crew and cargo ships. */
  tiangong(g, m) {
    coreModuleParts(g, m); // Tianhe; 1 model unit ≈ 10 m
    for (const side of [-1, 1]) {
      // laboratory module (Wentian / Mengtian): wide work section, then a narrow unpressurised section
      module(g, m, 0.21, 1.0, 0.85, 0, side * 0.64, 'z');
      const band = cyl(g, m.radiator, 0.213, 0.213, 0.4, 0.85, 0, side * 0.64, 'z', true);
      tileUV(band.geometry, 1, 4);
      cyl(g, m.blanket, 0.12, 0.12, 0.72, 0.85, 0, side * 1.5, 'z', false, 16);
      bus(g, m.foilGold, 0.2, 0.2, 0.25, { x: 0.85, y: 0.16, z: side * 1.4, bevel: 0.025, tile: 0.3 });
      cyl(g, m.dark, 0.15, 0.15, 0.06, 0.85, 0, side * 1.86, 'z', false, 16); // array drive
      for (const dir of [-1, 1]) {
        const wing = blanketWing(m, 2.6, 0.5, 0.14);
        wing.position.set(0.85 + dir * 0.1, 0, side * 1.86);
        wing.rotation.set(0, (dir * Math.PI) / 2, dir * 0.35);
        g.add(wing);
      }
    }
    dock(g, soyuzParts, m, 0.2, [1.31, 0, 0], [-1, 0, 0]); // Shenzhou at the forward port
    dock(g, soyuzParts, m, 0.2, [0.85, -0.46, 0], [0, 1, 0]); // Shenzhou at the nadir port
    dock(g, cargoParts, m, 0.36, [-1.06, 0, 0], [1, 0, 0]); // Tianzhou cargo ship aft
    ball(g, m.navRed, 0.02, 0.85, 0.05, -1.9);
    ball(g, m.navGreen, 0.02, 0.85, 0.05, 1.9);
  },

  /** A single station core module with a visiting ship (used for station pieces the name table does not know). */
  station(g, m) {
    coreModuleParts(g, m);
    dock(g, soyuzParts, m, 0.2, [1.31, 0, 0], [-1, 0, 0]);
  },

  dragon: dragonParts,
  soyuz: soyuzParts,
  capsule: cargoParts,

  /** Cygnus: shiny pressurised can, small foil service module, two round fan-fold arrays. */
  cygnus(g, m) {
    module(g, m, 0.5, 1.4, 0.3, 0, 0, 'x', m.foilSilver);
    for (const x of [-0.1, 0.3, 0.7]) hoop(g, m.metal, 0.505, 0.012, x, 0, 0, 'x', 28); // stiffening rings
    cyl(g, m.metal, 0.3, 0.33, 0.08, 1.02, 0, 0, 'x'); // berthing ring
    cyl(g, m.dark, 0.22, 0.22, 0.02, 1.062, 0, 0, 'x', false, 16);
    cyl(g, m.foilGold, 0.42, 0.42, 0.4, -0.6, 0, 0, 'x');
    cyl(g, m.dark, 0.42, 0.42, 0.03, -0.81, 0, 0, 'x');
    nozzle(g, m, 0.12, 0.16, [-0.82, 0, 0], [-1, 0, 0]);
    for (const s of [-1, 1]) {
      // one fan: a ring of wedge-shaped gores round a hub, on a short mast, tipped to show its face
      const fan = new THREE.Group();
      const face = new THREE.CircleGeometry(0.62, 20);
      tileUV(face, 4.5, 4.5);
      mesh(fan, face, m.cellsBlue, 0, 0.012, 0).rotation.x = -Math.PI / 2;
      cyl(fan, m.panelBackGold, 0.62, 0.62, 0.016, 0, 0, 0, 'y', false, 20);
      for (let k = 0; k < 10; k++) {
        const a = (k * TAU) / 10;
        strut(fan, m.metal, [0, 0.016, 0], [0.62 * Math.sin(a), 0.016, 0.62 * Math.cos(a)], 0.006); // gore seams, front
        strut(fan, m.metal, [0, -0.014, 0], [0.62 * Math.sin(a), -0.014, 0.62 * Math.cos(a)], 0.008); // spars, back
      }
      cyl(fan, m.metal, 0.06, 0.06, 0.06, 0, 0, 0, 'y', false, 12);
      fan.position.set(-0.6, 0, s * 1.2);
      fan.rotation.x = s * 0.35;
      g.add(fan);
      strut(g, m.dark, [-0.6, 0, s * 0.42], [-0.6, 0, s * 1.2], 0.02);
    }
    dish(g, m, 0.09, [-0.6, 0.48, 0.1], [0.2, 1, 0.1]);
    whip(g, m, [0.6, 0.5, 0], [0.3, 1, 0], 0.3);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      thrusters(g, m, [-0.72, 0.42 * Math.cos(a), 0.42 * Math.sin(a)], [-0.4, Math.cos(a), Math.sin(a)]);
    }
  },

  /** Spent rocket upper stage (Centaur-like): white tank, cream foam-covered tank, ribbed skirts, payload adapter, one large engine. */
  rocketbody(g, m) {
    const front = cyl(g, m.hull, 0.5, 0.5, 1.15, 0.78, 0, 0, 'x', true, 32); // forward tank, painted
    tileUV(front.geometry, 6, 2);
    cyl(g, m.foam, 0.5, 0.5, 1.0, -0.38, 0, 0, 'x', true, 32); // aft tank under spray-on foam
    cyl(g, m.dark, 0.506, 0.506, 0.09, 1.1, 0, 0, 'x', true, 32); // paint band
    const ribbed = (x: number, length: number, r0: number, r1: number) => { // a ring of stringers: skirts and adapters are stiffened, tanks are smooth
      for (let k = 0; k < 20; k++) {
        const a = (k * TAU) / 20, r = (r0 + r1) / 2 + 0.006;
        const rib = box(g, m.metal, length, 0.022, 0.014, x, r * Math.cos(a), r * Math.sin(a));
        rib.rotation.set(a, 0, 0);
        rib.rotateZ(Math.atan2(r1 - r0, length));
      }
    };
    cyl(g, m.dark, 0.5, 0.5, 0.2, 0.22, 0, 0, 'x', true, 32); // intertank ring
    ribbed(0.22, 0.2, 0.5, 0.5);
    cyl(g, m.dark, 0.32, 0.5, 0.34, 1.52, 0, 0, 'x', true, 32); // payload adapter cone
    cyl(g, m.baffle, 0.31, 0.49, 0.34, 1.52, 0, 0, 'x', true, 32);
    ribbed(1.52, 0.34, 0.5, 0.32);
    hoop(g, m.metal, 0.32, 0.014, 1.69, 0, 0, 'x', 28); // separation ring
    cyl(g, m.dark, 0.5, 0.5, 0.22, -0.99, 0, 0, 'x', true, 32); // aft skirt
    cyl(g, m.baffle, 0.49, 0.49, 0.22, -0.99, 0, 0, 'x', true, 32);
    ribbed(-0.99, 0.22, 0.5, 0.5);
    ball(g, m.foilGold, 0.49, -0.9, 0, 0, 0.5, 1, 1); // insulated aft dome
    box(g, m.dark, 2.2, 0.035, 0.07, 0.25, 0.515, 0); // cable raceway
    box(g, m.metal, 1.0, 0.03, 0.05, -0.38, -0.365, 0.365).rotation.x = -Math.PI / 4;
    // engine: thrust frame, turbopumps, bell
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      strut(g, m.metal, [-1.05, 0.3 * Math.cos(a), 0.3 * Math.sin(a)], [-1.32, 0.06 * Math.cos(a), 0.06 * Math.sin(a)], 0.018);
      ball(g, m.dark, 0.11, -1.14, 0.34 * Math.cos(a + 0.78), 0.34 * Math.sin(a + 0.78)); // helium bottles
    }
    cyl(g, m.metal, 0.07, 0.07, 0.2, -1.25, 0.14, 0.05, 'x', false, 12);
    cyl(g, m.metal, 0.06, 0.06, 0.16, -1.25, -0.12, -0.1, 'x', false, 12);
    strut(g, m.metal, [-1.2, 0.14, 0.05], [-1.42, 0.0, 0.1], 0.02);
    nozzle(g, m, 0.4, 0.85, [-1.3, 0, 0], [-1, 0, 0]);
    for (const s of [-1, 1]) thrusters(g, m, [1.0, 0, s * 0.51], [0, 0, s], 1.4); // attitude-thruster pods near the front
  },

  /**
   * Debris: one torn fragment of a spacecraft wall. Nearly 2,000 catalogue objects share this
   * model, and it tumbles, so it is built to look different from every side: scorched white
   * paint outside, a bare stiffened skin inside, honeycomb showing along the torn edge, a
   * crumpled sheet, shredded foil, a broken solar cell and a twisted strut.
   */
  debris(g, m) {
    const rand = random(5);
    // --- the wall: two skins with honeycomb between, torn to an irregular outline, creased, charred at the edge ---
    const COLS = 16, ROWS = 11, W = 1.5, H = 1.05, R = 0.8, T = 0.055;
    const outer: THREE.Vector3[][] = [], char: number[][] = [];
    for (let j = 0; j <= ROWS; j++) {
      outer.push([]);
      char.push([]);
      for (let i = 0; i <= COLS; i++) {
        let x = (i / COLS - 0.5) * W, y = (j / ROWS - 0.5) * H;
        const ring = Math.min(i, COLS - i, j, ROWS - j); // 0 on the torn edge, growing inwards
        const e = Math.max(Math.abs(x) / (W / 2), Math.abs(y) / (H / 2));
        const angle = Math.atan2(y, x);
        // "bites" out of the rectangle: how far the edge is pulled in, as a lumpy function of direction
        const bite = Math.min(0.62, 0.34 * Math.max(0, Math.sin(angle * 2 + 1)) + 0.3 * Math.max(0, Math.sin(angle * 3 - 0.5)) + 0.14 * Math.max(0, Math.sin(angle * 7 + 2)));
        const pull = 1 - bite * e * e - (ring === 0 ? rand() * 0.07 : 0);
        x *= pull;
        y *= pull;
        let z = (rand() - 0.5) * (ring === 0 ? 0.07 : 0.03); // dents
        const past = x * 0.86 + y * 0.5 - 0.3; // distance beyond a diagonal crease: that corner is folded up about 60°
        if (past > 0) { x -= 0.86 * past * 0.5; y -= 0.5 * past * 0.5; z += past * 0.85; }
        const a = y / R; // the wall was part of a cylinder of radius R
        outer[j].push(new THREE.Vector3(x, (R + z) * Math.sin(a), (R + z) * Math.cos(a) - R));
        char[j].push(Math.min(1, 0.2 + ring * 0.3) * (0.8 + rand() * 0.2));
      }
    }
    const inner = outer.map((row, j) => row.map((p, i) => {
      const across = new THREE.Vector3().subVectors(outer[j][Math.min(COLS, i + 1)], outer[j][Math.max(0, i - 1)]);
      const up = new THREE.Vector3().subVectors(outer[Math.min(ROWS, j + 1)][i], outer[Math.max(0, j - 1)][i]);
      return p.clone().addScaledVector(across.cross(up).normalize(), -T);
    }));
    const wall = new THREE.Group();
    mesh(wall, gridSurface(outer, char, 2, 1.5, false), m.scrapOuter);
    mesh(wall, gridSurface(inner, char.map((row) => row.map((v) => Math.sqrt(v))), 4, 3, true), m.scrapInner); // less soot reaches the inside
    // the torn edge: a strip joining the two skins all the way round, showing the honeycomb core
    const rim: [number, number][] = [];
    for (let i = 0; i < COLS; i++) rim.push([i, 0]);
    for (let j = 0; j < ROWS; j++) rim.push([COLS, j]);
    for (let i = COLS; i > 0; i--) rim.push([i, ROWS]);
    for (let j = ROWS; j > 0; j--) rim.push([0, j]);
    const position: number[] = [], uv: number[] = [];
    let run = 0;
    rim.forEach(([i, j], k) => {
      const [i2, j2] = rim[(k + 1) % rim.length];
      const a = outer[j][i], b = outer[j2][i2], c = inner[j2][i2], d = inner[j][i];
      const next = run + a.distanceTo(b) / 0.12;
      for (const [p, u, v] of [[a, run, 1], [b, next, 1], [c, next, 0], [a, run, 1], [c, next, 0], [d, run, 0]] as [THREE.Vector3, number, number][]) {
        position.push(p.x, p.y, p.z);
        uv.push(u, v);
      }
      run = next;
    });
    const core = new THREE.BufferGeometry();
    core.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    core.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    core.computeVertexNormals();
    mesh(wall, core, m.scrapCore);
    // stringers still riveted to the inside skin
    const stringer = (j: number, i0: number, i1: number, lift: number) => {
      const from = inner[j][i0], to = inner[j][i1], away = new THREE.Vector3().subVectors(from, outer[j][i0]).normalize();
      const along = new THREE.Vector3().subVectors(to, from);
      const part = box(wall, m.metal, along.length(), 0.035, 0.05);
      part.position.copy(from).addScaledVector(along, 0.5).addScaledVector(away, 0.03 + lift);
      part.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), along.normalize());
    };
    stringer(3, 3, 10, 0);
    stringer(7, 2, 8, 0);
    const at = (p: THREE.Vector3, dx: number, dy: number, dz: number) => new THREE.Vector3(p.x + dx, p.y + dy, p.z + dz);

    // --- a crumpled sheet of bare metal, folded into a V, still hanging on at one side ---
    const sheet: THREE.Vector3[][] = [], dull: number[][] = [];
    for (let j = 0; j <= 5; j++) {
      sheet.push([]);
      dull.push([]);
      for (let i = 0; i <= 7; i++) {
        const torn = i === 0 || i === 7 || j === 0 || j === 5 ? 1 - rand() * 0.3 : 1;
        const x = (i / 7 - 0.5) * 0.85 * torn, y = (j / 5 - 0.5) * 0.55 * torn;
        sheet[j].push(new THREE.Vector3(x, y, Math.abs(x) * 0.9 + (rand() - 0.5) * 0.1));
        dull[j].push(0.4 + rand() * 0.6);
      }
    }
    const crumpled = mesh(wall, gridSurface(sheet, dull, 1, 1, false), m.scrapBare);
    crumpled.position.copy(at(outer[6][2], -0.22, 0.06, -0.16));
    crumpled.rotation.set(0.9, -0.5, 0.7);

    // --- shredded foil blanket: ribbons of different length, each curled and twisted, rooted on the wall ---
    const ribbon = (root: THREE.Vector3, length: number, width: number, rx: number, ry: number, rz: number) => {
      const strip = new THREE.PlaneGeometry(length, width, 14, 2);
      const s = strip.attributes.position;
      for (let i = 0; i < s.count; i++) {
        const t = s.getX(i) / length + 0.5, a = t * 3.2, across = s.getY(i) * (1 - 0.3 * Math.sin(a * 1.7) ** 2), twist = t * 1.2;
        s.setXYZ(i, Math.sin(a) * length * 0.3, across * Math.cos(twist), (1 - Math.cos(a)) * length * 0.3 + across * Math.sin(twist));
      }
      strip.computeVertexNormals();
      const part = mesh(wall, strip, m.foilTorn);
      part.position.copy(root);
      part.rotation.set(rx, ry, rz);
    };
    ribbon(at(outer[6][10], 0, 0, 0.01), 0.8, 0.28, 0, 0, -0.5); // peeling off the outside
    ribbon(at(outer[9][7], 0, 0, 0.01), 0.45, 0.15, 0, 0, 1.5);
    ribbon(at(inner[3][5], 0, 0, -0.01), 0.7, 0.22, 0, Math.PI, 0.5); // hanging from the inside
    const lump = new THREE.IcosahedronGeometry(0.16, 1); // a wad of crumpled insulation caught behind a stringer
    const q = lump.attributes.position;
    for (let i = 0; i < q.count; i++) {
      const n = 0.7 + 0.55 * Math.abs(Math.sin(q.getX(i) * 42.9 + q.getY(i) * 78.2 + q.getZ(i) * 37.7));
      q.setXYZ(i, q.getX(i) * n, q.getY(i) * n * 0.7, q.getZ(i) * n * 0.9);
    }
    lump.computeVertexNormals();
    mesh(wall, lump, m.foilTorn).position.copy(at(inner[5][4], 0, 0, -0.12));

    // --- a broken piece of solar panel, hanging by its cable ---
    const outline = [[-0.22, -0.14], [0.24, -0.18], [0.29, 0.03], [0.06, 0.21], [-0.26, 0.1]];
    const shard = new THREE.Group(), slab: THREE.Vector3[][] = [];
    for (const y of [-0.009, 0.009]) slab.push(outline.map(([x, z]) => new THREE.Vector3(x, y, z)));
    outline.forEach(([x, z], k) => {
      const [x2, z2] = outline[(k + 1) % outline.length];
      slab.push([new THREE.Vector3(x, -0.009, z), new THREE.Vector3(x2, -0.009, z2), new THREE.Vector3(x2, 0.009, z2), new THREE.Vector3(x, 0.009, z)]);
    });
    mesh(shard, faceted(slab, 0.5), m.panelBack);
    mesh(shard, faceted([outline.map(([x, z]) => new THREE.Vector3(x * 0.96, 0.0105, z * 0.96))], 0.2), m.cellsBlue);
    const anchor = outer[1][9], hung = at(anchor, 0.3, -0.26, 0.16);
    shard.position.copy(hung);
    shard.rotation.set(1.0, 0.3, 0.7);
    wall.add(shard);
    strut(wall, m.yellow, [anchor.x, anchor.y, anchor.z], [hung.x - 0.08, hung.y + 0.06, hung.z], 0.007); // its cable

    // --- a twisted strut with its end fitting, and a second one snapped short, behind the wall ---
    const bent = new THREE.CatmullRomCurve3([[-0.78, -0.34, -0.2], [-0.4, -0.16, -0.3], [-0.05, 0.14, -0.34], [0.22, 0.22, -0.26], [0.36, 0.42, -0.3], [0.5, 0.62, -0.12]].map(([x, y, z]) => new THREE.Vector3(x, y, z)));
    mesh(wall, new THREE.TubeGeometry(bent, 20, 0.024, 6), m.metal);
    cyl(wall, m.dark, 0.04, 0.04, 0.09, -0.78, -0.34, -0.2, 'x', false, 8);
    ball(wall, m.metal, 0.04, -0.4, -0.16, -0.3);
    strut(wall, m.metal, [-0.4, -0.16, -0.3], [-0.52, 0.2, -0.5], 0.02);
    strut(wall, m.dark, [0.5, 0.62, -0.12], [0.62, 0.5, 0.08], 0.006); // dangling wire
    wall.rotation.set(-0.35, 0.2, 0.25);
    g.add(wall);
  },
};

/** Weld every part that shares a material into a single mesh (far fewer draw calls). */
function mergeByMaterial(root: THREE.Group): THREE.Group {
  root.updateMatrixWorld(true);
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const source = object.geometry as THREE.BufferGeometry;
    const geometry = source.index ? source.toNonIndexed() : source.clone();
    geometry.applyMatrix4(object.matrixWorld);
    const material = object.material as THREE.Material;
    const list = groups.get(material);
    if (list) list.push(geometry); else groups.set(material, [geometry]);
    source.dispose();
  });
  const merged = new THREE.Group();
  for (const [material, list] of groups) {
    const geometry = mergeGeometries(list);
    for (const part of list) part.dispose();
    if (geometry) merged.add(new THREE.Mesh(geometry, material));
  }
  return merged;
}

/** Build a model, centred and scaled so its largest dimension is 1 unit. */
const built = new Map<ModelKind, THREE.Group>(); // each kind is built once; every use is a cheap clone sharing its geometry

export function buildModel(kind: ModelKind): THREE.Group {
  let model = built.get(kind);
  if (!model) {
    const parts = new THREE.Group();
    BUILDERS[kind](parts, materials());
    const inner = mergeByMaterial(parts);
    const bounds = new THREE.Box3().setFromObject(inner);
    const size = bounds.getSize(new THREE.Vector3());
    inner.position.copy(bounds.getCenter(new THREE.Vector3())).multiplyScalar(-1);
    model = new THREE.Group();
    model.add(inner);
    model.scale.setScalar(1 / Math.max(size.x, size.y, size.z));
    built.set(kind, model);
  }
  return model.clone(true);
}

/** Remove a model from its holder. Geometry, materials and textures belong to the cache and stay. */
function disposeModel(holder: THREE.Group): void {
  holder.clear();
}

/**
 * Do the expensive first-time work up front: build the commonest models and compile the
 * lit-material shaders with the scene's real lights. Without this, the first satellite that
 * is selected costs a visible stutter (geometry merging + shader compilation). The remaining
 * kinds are built one per idle moment afterwards.
 */
export function prewarmModels(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
  const first: ModelKind[] = ['iss', 'telescope', 'starlink', 'geocomsat', 'dragon', 'debris'];
  const holder = new THREE.Group();
  holder.position.set(0, 0, -5000); // far outside the view; compile() does not cull
  holder.scale.setScalar(0.001);
  for (const kind of first) holder.add(buildModel(kind));
  scene.add(holder);
  renderer.compile(scene, camera);
  scene.remove(holder);

  const rest = (Object.keys(BUILDERS) as ModelKind[]).filter((kind) => !first.includes(kind));
  const idle = (work: () => void) => ('requestIdleCallback' in window ? window.requestIdleCallback(work, { timeout: 4000 }) : setTimeout(work, 300));
  const next = () => {
    const kind = rest.shift();
    if (!kind) return;
    buildModel(kind);
    idle(next);
  };
  idle(next);
}

// Dead objects are not attitude-controlled: they tumble. Value = tumble speed (1 = debris).
const TUMBLE: Partial<Record<ModelKind, number>> = { debris: 1, rocketbody: 0.22 };

function addLights(scene: THREE.Scene): THREE.DirectionalLight {
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
  scene.add(sun, sun.target, new THREE.AmbientLight(0x8fb0e0, 0.45));
  return sun;
}

/** The selected object's model on the globe: follows it, points along its orbit, stays a readable size. */
export class SatelliteModel {
  /** Size of the model (scene units, 1 = 1,000 km) when the camera is close to it. */
  static readonly FOCUS_SIZE = 0.024;
  enabled = true;
  private readonly holder = new THREE.Group();
  private readonly kit: SceneKit;
  private readonly sunLight: THREE.DirectionalLight | null = null;
  private readonly fillLight: THREE.DirectionalLight | null = null;
  private kind: ModelKind | null = null;

  /**
   * @param withLights  the first instance owns the scene's lights; extra instances (the two
   *                    models of a close approach) pass false and are lit by the same ones.
   */
  constructor(kit: SceneKit, withLights = true) {
    this.kit = kit;
    this.holder.visible = false;
    kit.scene.add(this.holder);
    if (withLights) {
      this.sunLight = addLights(kit.scene); // only these models use lit materials
      // A soft "headlight" from the camera so the model stays readable on the night side.
      this.fillLight = new THREE.DirectionalLight(0xbcd6ff, 0.9);
      kit.scene.add(this.fillLight, this.fillLight.target);
    }
  }

  /** Point the sun light and the camera fill light at `position` (scene units). */
  aimLights(position: THREE.Vector3, sunDirection: THREE.Vector3): void {
    if (!this.sunLight || !this.fillLight) return;
    this.sunLight.position.copy(position).addScaledVector(sunDirection, 50);
    this.sunLight.target.position.copy(position);
    this.fillLight.position.copy(this.kit.camera.position);
    this.fillLight.target.position.copy(position);
  }

  setKind(kind: ModelKind | null): void {
    this.kind = kind;
    disposeModel(this.holder);
    if (kind) this.holder.add(buildModel(kind));
    this.holder.visible = false;
  }

  /**
   * @param position  where the object is (scene units), or null if unknown
   * @param velocity  direction of travel (scene axes, any length)
   * @param maxSize   optional cap on the model's size (scene units) — used in a close approach
   *                  so two models a few kilometres apart do not swallow each other
   */
  update(position: THREE.Vector3 | null, velocity: THREE.Vector3, sunDirection: THREE.Vector3, realSeconds: number, maxSize?: number): void {
    this.holder.visible = this.enabled && !!position && this.kind !== null;
    if (!position || !this.holder.visible) return;
    this.aimLights(position, sunDirection);
    this.holder.position.copy(position);

    // Real satellites are metres across — far too small to see — so the model is drawn much
    // larger than life. Far away it shrinks into the dot; at middle distances it keeps a
    // constant on-screen size (~65 px); and once the camera is close (the focus view) it has
    // a fixed size in space, so zooming in really does bring it closer.
    const distance = this.kit.camera.position.distanceTo(position);
    this.holder.scale.setScalar(maxSize !== undefined
      ? Math.min(maxSize, distance * 0.2)
      : THREE.MathUtils.clamp(distance * 0.058, SatelliteModel.FOCUS_SIZE, 0.2));

    const tumble = this.kind ? TUMBLE[this.kind] : undefined;
    if (tumble) {
      this.holder.rotation.set(realSeconds * 0.5 * tumble, realSeconds * 0.8 * tumble, 0);
      return;
    }
    const up = position.clone().normalize(); // away from Earth
    const forward = velocity.clone().addScaledVector(up, -velocity.dot(up)); // travel direction, level with the horizon
    if (forward.lengthSq() < 1e-12) forward.set(1, 0, 0).addScaledVector(up, -up.x);
    forward.normalize();
    const side = new THREE.Vector3().crossVectors(forward, up);
    this.holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(forward, up, side));
  }
}

// ---- still thumbnails (search suggestions) ---------------------------------------------------

const thumbnails = new Map<ModelKind, string>(); // kind → PNG data URL, rendered once each
let thumbRenderer: THREE.WebGLRenderer | null = null;

/**
 * The rectangle a model covers as seen by `camera` (camera-space x/y), measured from its real
 * vertices so the thumbnail can be cropped right up to it.
 */
function silhouette(holder: THREE.Object3D, camera: THREE.Camera): { minX: number; maxX: number; minY: number; maxY: number } {
  holder.updateMatrixWorld(true);
  const edge = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const point = new THREE.Vector3();
  holder.traverse((part) => {
    const positions = (part as THREE.Mesh).geometry?.getAttribute('position');
    if (!positions) return;
    const toCamera = new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse, part.matrixWorld);
    const stride = Math.max(1, Math.floor(positions.count / 4000)); // plenty for an outline
    for (let i = 0; i < positions.count; i += stride) {
      point.fromBufferAttribute(positions, i).applyMatrix4(toCamera);
      if (!Number.isFinite(point.x + point.y)) continue;
      edge.minX = Math.min(edge.minX, point.x);
      edge.maxX = Math.max(edge.maxX, point.x);
      edge.minY = Math.min(edge.minY, point.y);
      edge.maxY = Math.max(edge.maxY, point.y);
    }
  });
  return edge;
}

/**
 * A small picture of a model kind, for lists and the hover card. Rendered on first use with a
 * shared off-screen renderer, then cached.
 *
 * The little frame should be full, not mostly empty, and the model should show its best side
 * (a flat satellite seen edge-on, or from its unlit back, is a dark line). So a handful of
 * poses are tried — eight headings, then the best one laid across either diagonal — each
 * cropped right up to the model, and the pose that covers the most of the square with the
 * most light and colour is kept.
 */
export function modelThumbnail(kind: ModelKind): string {
  const cached = thumbnails.get(kind);
  if (cached) return cached;
  try {
    const SIZE = 160;
    thumbRenderer ??= new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    thumbRenderer.setSize(SIZE, SIZE, false);
    const renderer = thumbRenderer;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 60);
    camera.position.set(1.5, 1.0, 1.9).setLength(20);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const towardsCamera = camera.position.clone().normalize();
    addLights(scene).position.set(2.5, 3, 1.5);
    const rim = new THREE.DirectionalLight(0x5ad1ff, 1.4);
    rim.position.set(-3, -1, -2);
    scene.add(rim, new THREE.AmbientLight(0xbfd2f0, 0.55)); // a little extra fill: it is shown on a dark tile
    const holder = new THREE.Group();
    holder.add(buildModel(kind));
    scene.add(holder);

    const pixels = new Uint8Array(SIZE * SIZE * 4);
    /** Draw one pose, cropped to the model, and say how good a picture it makes. */
    const draw = (heading: number, lean: number): number => {
      holder.rotation.set(0, heading, 0);
      if (lean !== 0) holder.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(towardsCamera, lean));
      const e = silhouette(holder, camera);
      if (!Number.isFinite(e.minX + e.maxX + e.minY + e.maxY)) return 0;
      const half = Math.max(e.maxX - e.minX, e.maxY - e.minY, 1e-6) * 0.53; // 6% breathing room
      const cx = (e.minX + e.maxX) / 2, cy = (e.minY + e.maxY) / 2;
      camera.left = cx - half;
      camera.right = cx + half;
      camera.bottom = cy - half;
      camera.top = cy + half;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      const gl = renderer.getContext();
      gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let covered = 0, light = 0, colour = 0;
      for (let i = 0; i < pixels.length; i += 16) { // every fourth pixel is plenty
        if (pixels[i + 3] < 40) continue;
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        covered++;
        light += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        colour += (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
      }
      if (covered === 0) return 0;
      return (covered / (pixels.length / 16)) * (0.35 + light / covered + colour / covered);
    };

    let best = { heading: 0.6, lean: 0, score: -1 };
    for (let step = 0; step < 8; step++) {
      const heading = 0.6 + (step * Math.PI) / 4;
      const score = draw(heading, 0);
      if (score > best.score * 1.03) best = { heading, lean: 0, score };
    }
    for (const lean of [-0.72, 0.72]) {
      const score = draw(best.heading, lean);
      if (score > best.score * 1.1) best = { heading: best.heading, lean, score };
    }
    draw(best.heading, best.lean);
    const url = renderer.domElement.toDataURL('image/png');
    disposeModel(holder);
    thumbnails.set(kind, url);
    return url;
  } catch {
    return ''; // no WebGL context to spare: the caller falls back to a plain dot
  }
}

/** A small, slowly turning view of a model for the info card (its own tiny renderer). */
export class ModelPreview {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 2, 0.1, 20);
  private readonly holder = new THREE.Group();
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera.position.set(1.5, 0.95, 1.9);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(this.holder);
    const sun = addLights(this.scene);
    sun.position.set(2.5, 3, 1.5);
    const rim = new THREE.DirectionalLight(0x5ad1ff, 1.4);
    rim.position.set(-3, -1, -2);
    this.scene.add(rim);
  }

  show(kind: ModelKind): void {
    disposeModel(this.holder);
    this.holder.add(buildModel(kind));
  }

  render(realSeconds: number): void {
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    if (width === 0 || height === 0) return; // card hidden
    if (this.canvas.width !== Math.round(width * this.renderer.getPixelRatio())) {
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
    this.holder.rotation.y = realSeconds * 0.45;
    this.renderer.render(this.scene, this.camera);
  }
}
