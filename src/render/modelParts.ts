/**
 * The kit of parts the 3D spacecraft models are built from: the painted textures and shared
 * materials, and the helpers that add one part each (a bevelled body, a dish, a solar wing, a
 * thruster block …). The builders themselves are in satModels.ts (everything in Earth orbit)
 * and deepModels.ts (observatories, planetary craft, probes); this file knows no spacecraft.
 *
 * Why the models do not look like grey boxes:
 *   - every material reflects a small painted "surroundings" picture (Sun, Earth-glow, soft
 *     lights), so foil, bare metal, glass and mirrors glint as the model turns
 *   - insulation foil, quilted blankets and hull plating get their wrinkles and seams from
 *     normal maps computed from painted height fields — detail that costs no triangles
 *   - bodies are bevelled or many-sided solids, never plain cubes: the bevels catch the light
 *
 * Model axes: +X = direction of travel, +Y = away from the body it orbits, −Y = towards it.
 * Solar wings normally run along ±Z.
 */

import * as THREE from 'three';

export type V3 = readonly [number, number, number];
export type Axis = 'x' | 'y' | 'z';
export type Painter = (ctx: CanvasRenderingContext2D, size: number) => void;
export const UP = new THREE.Vector3(0, 1, 0);
export const TAU = Math.PI * 2;

/** Small repeatable random-number generator, so every model looks the same on every run. */
export function random(seed: number): () => number {
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

/**
 * A colour texture painted on a square canvas. Exported so that a family of models with
 * materials of its own (rocketModels.ts) can paint them the first time one is built, instead
 * of every visitor paying for them at start-up in makeMaterials().
 */
export function paint(size: number, draw: Painter): THREE.CanvasTexture {
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
    // Beyond Earth orbit (deepModels.ts, observatoryModels.ts). Plain colours on the textures
    // already made above: they add nothing to the cost of making the kit.
    goldMirror: std({ color: 0xe6aa44, metalness: 0.92, roughness: 0.4, envMapIntensity: 1.9 }), // gold-coated telescope mirror segments
    shieldCold: foil(0xc3c0d0, THREE.DoubleSide, 0.52), // a sunshield membrane seen from its cold side: aluminised film
    shieldHot: foil(0xe08fae, THREE.FrontSide, 0.55), // … and from the side that faces the Sun, where its silicon coating looks pink
    carbon: std({ color: 0x25272d, metalness: 0.15, roughness: 0.8, envMapIntensity: 0.4 }), // carbon composite: heat-shield backs, telescope tubes
    goldPlate: std({ color: 0xe0a93c, metalness: 0.9, roughness: 0.5, envMapIntensity: 1.6 }), // gold-plated fittings (a record cover, a plaque)
    dullMetal: std({ color: 0x4b4f57, metalness: 0.75, roughness: 0.55, envMapIntensity: 1.2 }), // aluminium gone dull and dusty: rover wheels, generator fins, a laser-ranging ball
    // Asteroid: matte and shaded per corner (dark hollows, pale rims). The foil's crinkle map, used gently, makes broken stone.
    rock: std({ color: 0x5b524a, metalness: 0, roughness: 0.97, envMapIntensity: 0.1, vertexColors: true, normalMap: crinkle, normalScale: wrinkles(0.55) }),
  };
}
export type Materials = ReturnType<typeof makeMaterials>;
/** One model: adds its parts to the group, using the shared materials. */
export type Builder = (g: THREE.Group, m: Materials) => void;

let sharedMaterials: Materials | null = null;
export function materials(): Materials {
  return (sharedMaterials ??= makeMaterials());
}

// ---------------------------------------------------------------------------------------
// Part helpers
// ---------------------------------------------------------------------------------------

// Docked visiting vehicles are drawn at a fraction of the station's size, so they are built
// with fewer facets: round parts divide their segment counts by this while dock() is running.
let coarse = 1;
export const facets = (n: number, min = 6) => Math.max(min, Math.round(n / coarse));

export function mesh(g: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const part = new THREE.Mesh(geometry, material);
  part.position.set(x, y, z);
  g.add(part);
  return part;
}

/** Plain box — for small fittings. Spacecraft bodies use bus() or prism(), which have bevels. */
export function box(g: THREE.Group, material: THREE.Material, w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.Mesh {
  return mesh(g, new THREE.BoxGeometry(w, h, d), material, x, y, z);
}

/**
 * A solid from flat convex faces. Each face gets its own normal (crisp edges that catch the
 * light) and texture coordinates laid flat on it at `tile` model units per repeat, so foil
 * crinkles are the same size on a big face and a small one.
 */
export function faceted(faces: THREE.Vector3[][], tile: number): THREE.BufferGeometry {
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

export interface BusSpec {
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
export function bus(g: THREE.Group, material: THREE.Material, w: number, h: number, d: number, s: BusSpec = {}): THREE.Mesh {
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
export function prism(g: THREE.Group, material: THREE.Material, sides: number, rTop: number, rBottom: number, h: number, x = 0, y = 0, z = 0, tile = 0.7, turn = 0): THREE.Mesh {
  const loop = (r: number, yy: number) => Array.from({ length: sides }, (_, i) => new THREE.Vector3(r * Math.cos(turn + (i * TAU) / sides), yy, r * Math.sin(turn + (i * TAU) / sides)));
  const upper = loop(rTop, h / 2), lower = loop(rBottom, -h / 2);
  const faces = [upper, lower];
  for (let i = 0; i < sides; i++) faces.push([lower[i], lower[(i + 1) % sides], upper[(i + 1) % sides], upper[i]]);
  return mesh(g, faceted(faces, tile), material, x, y, z);
}

/**
 * A flat-topped solid with any convex outline: `outline` lists its corners as [x, z] (round
 * the origin), the thickness runs along Y. For decks, heat shields and wedge-shaped bodies;
 * prism() is the regular-polygon case.
 */
export function slab(g: THREE.Group, material: THREE.Material, outline: (readonly [number, number])[], h: number, x = 0, y = 0, z = 0, tile = 0.7): THREE.Mesh {
  const loop = (yy: number) => outline.map(([px, pz]) => new THREE.Vector3(px, yy, pz));
  const upper = loop(h / 2), lower = loop(-h / 2), n = outline.length;
  const faces = [upper, lower];
  for (let i = 0; i < n; i++) faces.push([lower[i], lower[(i + 1) % n], upper[(i + 1) % n], upper[i]]);
  return mesh(g, faceted(faces, tile), material, x, y, z);
}

/** Turn an object whose length runs along +Y so that it runs along the given axis instead. */
export function orient<T extends THREE.Object3D>(object: T, axis: Axis): T {
  if (axis === 'x') object.rotation.z = -Math.PI / 2;
  if (axis === 'z') object.rotation.x = Math.PI / 2;
  return object;
}

/** Cylinder or cone; `rTop` is the radius at the end that points along +axis. */
export function cyl(g: THREE.Group, material: THREE.Material, rTop: number, rBottom: number, h: number, x = 0, y = 0, z = 0, axis: Axis = 'y', open = false, segments = 24): THREE.Mesh {
  return orient(mesh(g, new THREE.CylinderGeometry(rTop, rBottom, h, facets(segments), 1, open), material, x, y, z), axis);
}

export function ball(g: THREE.Group, material: THREE.Material, r: number, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1): THREE.Mesh {
  // small balls (lamps, joints, bottles) get fewer facets: nobody can count them at that size
  const part = mesh(g, new THREE.SphereGeometry(r, facets(r < 0.08 ? 10 : 18, 8), facets(r < 0.08 ? 6 : 12, 5)), material, x, y, z);
  part.scale.set(sx, sy, sz);
  return part;
}

/** A hoop round the given axis: handrails, docking rings, stiffening frames. */
export function hoop(g: THREE.Group, material: THREE.Material, radius: number, tube: number, x = 0, y = 0, z = 0, axis: Axis = 'y', segments = 24): THREE.Mesh {
  const part = mesh(g, new THREE.TorusGeometry(radius, tube, 4, facets(segments, 8)), material, x, y, z);
  if (axis === 'y') part.rotation.x = Math.PI / 2;
  if (axis === 'x') part.rotation.y = Math.PI / 2;
  return part;
}

/** A surface of revolution about +Y from a list of [radius, height] points (capsules, domes, tanks). */
export function lathe(g: THREE.Group, material: THREE.Material, profile: (readonly [number, number])[], x = 0, y = 0, z = 0, axis: Axis = 'y', segments = 28): THREE.Mesh {
  const points = profile.map(([r, h]) => new THREE.Vector2(r, h));
  return orient(mesh(g, new THREE.LatheGeometry(points, facets(segments, 10)), material, x, y, z), axis);
}

/** A thin rod between two points. */
export function strut(g: THREE.Group, material: THREE.Material, a: V3, b: V3, radius = 0.012): THREE.Mesh {
  const from = new THREE.Vector3(a[0], a[1], a[2]);
  const along = new THREE.Vector3(b[0], b[1], b[2]).sub(from);
  const length = along.length();
  const part = mesh(g, new THREE.CylinderGeometry(radius, radius, length, facets(6, 4)), material);
  part.position.copy(from).addScaledVector(along, 0.5);
  part.quaternion.setFromUnitVectors(UP, along.normalize());
  return part;
}

/** A sub-group at `at` whose own +Y axis points along `dir` — parts built inside it aim that way. */
export function aimed(g: THREE.Group, at: V3, dir: V3): THREE.Group {
  const sub = new THREE.Group();
  sub.position.set(at[0], at[1], at[2]);
  sub.quaternion.setFromUnitVectors(UP, new THREE.Vector3(dir[0], dir[1], dir[2]).normalize());
  g.add(sub);
  return sub;
}

/** Repeat a texture across a part: multiply its texture coordinates. */
export function tileUV(geometry: THREE.BufferGeometry, su: number, sv: number): void {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
}

/**
 * A rigid solar panel lying flat: `w` along X, `l` along Z, cells facing +Y, ribbed backing
 * facing −Y. `tile` is the size (model units) of one 4 × 4 block of cells.
 */
export function solarPanel(m: Materials, w: number, l: number, cells: THREE.Material = m.cellsBlue, back: THREE.Material = m.panelBack, tile = 0.35): THREE.Group {
  const panel = new THREE.Group();
  const thickness = Math.min(0.02, w * 0.03);
  box(panel, back, w, thickness, l);
  const face = new THREE.PlaneGeometry(w * 0.97, l * 0.985);
  tileUV(face, w / tile, l / tile);
  mesh(panel, face, cells, 0, thickness / 2 + 0.0008, 0).rotation.x = -Math.PI / 2;
  return panel;
}

export interface WingSpec {
  width: number; // across the wing
  length: number; // total length of the panels along the boom
  panels?: number; // number of hinged panels
  yoke?: number; // length of the boom between the body and the first panel
  cells?: THREE.Material;
  back?: THREE.Material;
  tile?: number;
}

/** One fold-out solar wing in its own frame: root at the origin, running along +Z, cells facing +Y. */
export function buildWing(m: Materials, s: WingSpec): THREE.Group {
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
export function wingPair(g: THREE.Group, m: Materials, s: WingSpec & { root: number; x?: number; y?: number; tilt?: number }): void {
  for (const side of [-1, 1]) {
    const wing = buildWing(m, s);
    wing.position.set(s.x ?? 0, s.y ?? 0, side * s.root);
    wing.rotation.set(0, side === 1 ? 0 : Math.PI, side * (s.tilt ?? 0));
    g.add(wing);
  }
}

/** A roll-out "blanket" wing as used on space stations: two cell blankets either side of a mast. Runs along +Z. */
export function blanketWing(m: Materials, length: number, width: number, tile: number): THREE.Group {
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
export function dish(g: THREE.Group, m: Materials, radius: number, at: V3, dir: V3, feed = true): THREE.Group {
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
export function nozzle(g: THREE.Group, m: Materials, radius: number, length: number, at: V3, dir: V3): void {
  const n = aimed(g, at, dir);
  const small = radius < 0.05, steps = small ? 3 : 6; // thruster-sized bells are a few pixels across: keep them cheap
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= steps; i++) profile.push(new THREE.Vector2(radius * (0.3 + 0.7 * Math.sqrt(i / steps)), (length * i) / steps));
  mesh(n, new THREE.LatheGeometry(profile, small ? 8 : facets(radius > 0.2 ? 28 : 16, 8)), m.nozzle);
  if (!small) cyl(n, m.dark, radius * 0.3, radius * 0.38, length * 0.25, 0, -length * 0.12, 0, 'y', false, 10); // combustion chamber
  if (radius > 0.2) hoop(n, m.metal, radius * 1.01, radius * 0.03, 0, length, 0, 'y', 28); // stiffening ring at the lip
}

/** A cluster of small attitude thrusters on a block, firing roughly along `dir`. */
export function thrusters(g: THREE.Group, m: Materials, at: V3, dir: V3, size = 1): void {
  const t = aimed(g, at, dir);
  box(t, m.dark, 0.09 * size, 0.04 * size, 0.09 * size);
  for (const [x, z] of [[-1, 0], [1, 0], [0, 1]]) nozzle(t, m, 0.022 * size, 0.04 * size, [x * 0.028 * size, 0.02 * size, z * 0.028 * size], [x * 0.5, 1, z * 0.5]);
}

/** Star tracker: a small baffled camera looking along `dir`. */
export function tracker(g: THREE.Group, m: Materials, at: V3, dir: V3, size = 1): void {
  const t = aimed(g, at, dir);
  cyl(t, m.baffle, 0.05 * size, 0.032 * size, 0.12 * size, 0, 0.06 * size, 0, 'y', true, 12);
  cyl(t, m.lens, 0.03 * size, 0.03 * size, 0.01 * size, 0, 0.012 * size, 0, 'y', false, 12);
  box(t, m.dark, 0.08 * size, 0.03 * size, 0.08 * size, 0, -0.01 * size, 0);
}

/** An instrument tube standing on a deck (a camera, a small telescope): barrel, dark rim, glass at the mouth. Looks along `dir`. */
export function scope(g: THREE.Group, m: Materials, skin: THREE.Material, radius: number, length: number, at: V3, dir: V3 = [0, 1, 0]): void {
  const t = aimed(g, at, dir);
  cyl(t, skin, radius, radius, length, 0, length / 2, 0, 'y', false, 14);
  cyl(t, m.lens, radius * 0.8, radius * 0.8, 0.012, 0, length + 0.004, 0, 'y', false, 14);
  hoop(t, m.dark, radius, radius * 0.1, 0, length, 0, 'y', 14);
}

/** Whip / rod antenna from `at` along `dir`. */
export function whip(g: THREE.Group, m: Materials, at: V3, dir: V3, length: number, radius = 0.007): void {
  const d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize().multiplyScalar(length);
  strut(g, m.metal, at, [at[0] + d.x, at[1] + d.y, at[2] + d.z], radius);
}

/** Helix antenna under its white radome cone, pointing along `dir` from a round base plate. */
export function helix(g: THREE.Group, m: Materials, at: V3, dir: V3, length: number, radius = 0.05): void {
  const h = aimed(g, at, dir);
  cyl(h, m.metal, radius * 1.25, radius * 1.25, radius * 0.3, 0, radius * 0.15, 0, 'y', false, 8);
  cyl(h, m.white, radius * 0.45, radius, length, 0, radius * 0.3 + length / 2, 0, 'y', false, 8);
}

/**
 * An open lattice boom from `a` to `b`: three thin rods with cross-pieces and diagonals, as
 * used for long magnetometer booms (it unfolds from a can a few centimetres deep). `width` is
 * the distance from its centre line to each rod.
 */
export function lattice(g: THREE.Group, material: THREE.Material, a: V3, b: V3, width: number, bays: number): void {
  const along: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const length = Math.hypot(along[0], along[1], along[2]);
  if (length < 1e-6) return; // nothing to aim along
  const boom = aimed(g, a, along);
  const corner = (k: number, y: number): V3 => [width * Math.cos((k * TAU) / 3), y, width * Math.sin((k * TAU) / 3)];
  const rod = width * 0.11, bay = length / bays;
  for (let k = 0; k < 3; k++) {
    strut(boom, material, corner(k, 0), corner(k, length), rod);
    for (let i = 0; i <= bays; i++) {
      strut(boom, material, corner(k, i * bay), corner(k + 1, i * bay), rod * 0.7);
      if (i < bays) strut(boom, material, corner(k, i * bay), corner(k + 1, (i + 1) * bay), rod * 0.7);
    }
  }
}

/**
 * A radioisotope generator, the power source of craft that fly too far from the Sun for solar
 * cells: a can of plutonium with cooling fins. Its base is at `at`, its length runs along `dir`.
 */
export function rtg(g: THREE.Group, m: Materials, at: V3, dir: V3, length: number, radius: number, skin: THREE.Material = m.dark, finSkin: THREE.Material = m.dullMetal, fins = 8): void {
  const r = aimed(g, at, dir);
  cyl(r, skin, radius, radius, length, 0, length / 2, 0, 'y', false, 12);
  for (let k = 0; k < fins; k++) { // fins a little paler than the can, or the whole thing reads as one dark cylinder
    const a = (k * TAU) / fins;
    box(r, finSkin, radius * 1.3, length * 0.86, radius * 0.14, radius * 1.5 * Math.cos(a), length / 2, -radius * 1.5 * Math.sin(a)).rotation.y = a;
  }
  for (const y of [0, length]) cyl(r, m.metal, radius * 1.1, radius * 1.1, length * 0.05, 0, y, 0, 'y', false, 12); // end caps
}

/**
 * A round fold-out "fan" solar array: wedge-shaped gores of cells round a hub, opened like a
 * paper fan. It lies flat with its hub at the origin, cells facing +Y. `gores` must be even.
 */
export function fan(m: Materials, radius: number, gores = 10, cells: THREE.Material = m.cellsBlue, tile = 0.28): THREE.Group {
  const f = new THREE.Group();
  const face = new THREE.CircleGeometry(radius, gores, Math.PI / 2); // started a quarter turn round, so its corners meet the backing's
  tileUV(face, (2 * radius) / tile, (2 * radius) / tile);
  mesh(f, face, cells, 0, radius * 0.02, 0).rotation.x = -Math.PI / 2;
  cyl(f, m.panelBackGold, radius, radius, radius * 0.026, 0, 0, 0, 'y', false, gores);
  for (let k = 0; k < gores; k++) {
    const a = (k * TAU) / gores, x = radius * Math.sin(a), z = radius * Math.cos(a);
    strut(f, m.metal, [0, radius * 0.026, 0], [x, radius * 0.026, z], radius * 0.008); // gore seams, front
    strut(f, m.metal, [0, -radius * 0.022, 0], [x, -radius * 0.022, z], radius * 0.012); // spars, back
  }
  cyl(f, m.metal, radius * 0.09, radius * 0.09, radius * 0.1, 0, 0, 0, 'y', false, 12); // hub
  return f;
}

/** Flat antenna board in the XY plane, its face (phased-array patches by default) towards +Z. */
export function arrayPanel(m: Materials, w: number, h: number, elementsPerUnit = 14, face: THREE.Material = m.array): THREE.Group {
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
export function plate(g: THREE.Group, m: Materials, face: THREE.Material, w: number, h: number, at: V3, dir: V3, repeat = 4): void {
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
export function gridSurface(points: THREE.Vector3[][], shade: number[][], repeatU: number, repeatV: number, flip: boolean): THREE.BufferGeometry {
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
export function module(g: THREE.Group, m: Materials, r: number, len: number, x: number, y: number, z: number, axis: Axis, skin: THREE.Material = m.hull): THREE.Group {
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
export function girder(g: THREE.Group, m: Materials, length: number, r: number, x: number, y: number, z: number): void {
  orient(prism(g, m.truss, 6, r, r, length, x, y, z, r * 1.7), 'z');
  for (const end of [-1, 1]) orient(prism(g, m.metal, 6, r * 1.12, r * 1.12, r * 0.16, x, y, z + (end * length) / 2, 1), 'z');
}

/** Mount a ready-made part group in a parent: uniform scale, position, and facing (its +X turned to `facing`). */
export function dock(parent: THREE.Group, build: (g: THREE.Group, m: Materials) => void, m: Materials, scale: number, at: V3, facing: V3): void {
  const sub = new THREE.Group();
  coarse = 2.5;
  build(sub, m);
  coarse = 1;
  sub.scale.setScalar(scale);
  sub.position.set(at[0], at[1], at[2]);
  sub.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(facing[0], facing[1], facing[2]).normalize());
  parent.add(sub);
}
