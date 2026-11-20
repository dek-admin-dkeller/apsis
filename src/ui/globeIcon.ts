/**
 * The icon of a world, wherever one is shown (the phone's pill and list of worlds, the hover card
 * on the solar system): its own map projected onto a sphere and lit from the upper left, like a
 * photograph of the planet. The first icons were the flat map stretched over a circle under two
 * gradients, or a plain coloured ball, and read as "coloured spheres" (the owner's words).
 */

import { IMAGERY } from '../space/imagery.ts';
import type { BodyId } from '../space/types.ts';

/**
 * A world's small map (the copy the solar system draws it from), if it has one. A world wrapped
 * in cloud is pictured by its clouds, as it is seen (Venus), except the Earth.
 */
export function smallMap(id: BodyId): string | null {
  const imagery = IMAGERY[id];
  const base = imagery?.clouds && id !== 'earth' ? imagery.clouds : imagery?.base;
  return base ? base.replace(/(_m)?\.(jpg|webp|png)$/, '_s.$2') : null; // (a "_m" copy shares its small copy with the full map)
}

/**
 * The icon of a world: its own map projected onto a sphere and lit from the upper left, like a
 * photograph of the planet (the first icons were the flat map stretched over a circle under two
 * gradients, and read as coloured balls: the owner's words). Drawn once per world, at twice the
 * largest size shown, in an idle moment, and kept.
 */
const GLOBES = new Map<BodyId, Promise<string | null>>();
const GLOBE_PX = 104;
export function globeIcon(id: BodyId): Promise<string | null> {
  const known = GLOBES.get(id);
  if (known) return known;
  const map = smallMap(id);
  const made = !map ? Promise.resolve(null) : new Promise<string | null>((resolve) => {
    const image = new Image();
    image.onerror = () => resolve(null);
    image.onload = () => {
      const work = () => {
        try {
          resolve(renderGlobe(image, id === 'sun'));
        } catch {
          resolve(null);
        }
      };
      if (typeof requestIdleCallback === 'function') requestIdleCallback(work, { timeout: 600 });
      else setTimeout(work, 30);
    };
    image.src = map;
  });
  GLOBES.set(id, made);
  return made;
}

function renderGlobe(image: HTMLImageElement, glowing: boolean): string {
  const sw = image.naturalWidth, sh = image.naturalHeight;
  const source = document.createElement('canvas');
  source.width = sw;
  source.height = sh;
  const sg = source.getContext('2d', { willReadFrequently: true })!;
  sg.drawImage(image, 0, 0);
  const src = sg.getImageData(0, 0, sw, sh).data;
  const out = document.createElement('canvas');
  out.width = out.height = GLOBE_PX;
  const og = out.getContext('2d')!;
  const img = og.createImageData(GLOBE_PX, GLOBE_PX);
  const R = GLOBE_PX / 2 - 1;
  const light = { x: -0.55, y: 0.45, z: 0.7 };
  const ll = Math.hypot(light.x, light.y, light.z);
  for (let py = 0; py < GLOBE_PX; py++) {
    for (let px = 0; px < GLOBE_PX; px++) {
      const x = (px + 0.5 - GLOBE_PX / 2) / R, y = (GLOBE_PX / 2 - py - 0.5) / R;
      const d = Math.hypot(x, y);
      if (d > 1 + 1 / R) continue;
      const z = Math.sqrt(Math.max(0, 1 - Math.min(1, d) ** 2));
      // The point on the sphere → longitude and latitude → the map (longitude 0 in the middle).
      const lon = Math.atan2(x, z), lat = Math.asin(Math.max(-1, Math.min(1, y)));
      const u = Math.min(sw - 1, Math.max(0, Math.floor((lon / (2 * Math.PI) + 0.5) * sw)));
      const v = Math.min(sh - 1, Math.max(0, Math.floor((0.5 - lat / Math.PI) * sh)));
      const s = (v * sw + u) * 4;
      // Sunlight from the upper left, a little light round the night side, a darker limb;
      // the Sun glows by itself.
      const lambert = Math.max(0, (x * light.x + y * light.y + z * light.z) / ll);
      const shade = glowing ? 0.72 + 0.38 * z : (0.1 + 0.95 * Math.pow(lambert, 0.85)) * (0.86 + 0.14 * z);
      const o = (py * GLOBE_PX + px) * 4;
      img.data[o] = Math.min(255, src[s] * shade);
      img.data[o + 1] = Math.min(255, src[s + 1] * shade);
      img.data[o + 2] = Math.min(255, src[s + 2] * shade);
      img.data[o + 3] = Math.round(255 * Math.max(0, Math.min(1, (1 - d) * R + 0.5))); // a smooth edge
    }
  }
  og.putImageData(img, 0, 0);
  return out.toDataURL('image/png');
}

