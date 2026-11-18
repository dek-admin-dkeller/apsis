/**
 * "What is underneath?" — a rough place name for a latitude / longitude.
 *
 * Land or sea is read from the same water-mask texture the globe uses, so the coastline
 * is right; the NAME then comes from a short list of latitude/longitude boxes, so it is
 * only as precise as "North Atlantic" or "South America".
 */

const W = 720, H = 360;
let water: Uint8Array | null = null; // 1 = sea, per half-degree cell

/** Read the water mask once (call at start-up; lookups work without it, just less precisely). */
export function loadRegions(): void {
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(image, 0, 0, W, H);
    const pixels = ctx.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) mask[i] = pixels[4 * i] > 127 ? 1 : 0;
    // The middle of the Pacific is certainly sea: use it to learn which colour means water.
    const pacific = mask[Math.floor(H / 2) * W + Math.floor(((-140 + 180) / 360) * W)];
    if (pacific === 0) for (let i = 0; i < mask.length; i++) mask[i] = 1 - mask[i];
    water = mask;
  };
  image.src = './textures/earth-water.png';
}

function isSea(lat: number, lon: number): boolean | null {
  if (!water) return null;
  const x = Math.min(W - 1, Math.max(0, Math.floor(((lon + 180) / 360) * W)));
  const y = Math.min(H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * H)));
  return water[y * W + x] === 1;
}

type Box = [name: string, latMin: number, latMax: number, lonMin: number, lonMax: number];

const SEAS: Box[] = [
  ['Arctic Ocean', 66, 90, -180, 180],
  ['Southern Ocean', -90, -60, -180, 180],
  ['Mediterranean Sea', 30, 46, -6, 36],
  ['Caribbean Sea', 9, 22, -89, -60],
  ['Gulf of Mexico', 18, 31, -98, -81],
  ['Indian Ocean', -60, 30, 20, 120],
  ['North Atlantic', 0, 66, -80, 20],
  ['South Atlantic', -60, 0, -70, 20],
  ['North Pacific', 0, 66, 120, 180],
  ['North Pacific', 0, 66, -180, -80],
  ['South Pacific', -60, 0, 120, 180],
  ['South Pacific', -60, 0, -180, -70],
];

const LANDS: Box[] = [
  ['Antarctica', -90, -60, -180, 180],
  ['Greenland', 59, 84, -74, -11],
  ['Australia', -45, -10, 110, 155],
  ['New Zealand', -48, -34, 165, 180],
  ['Southeast Asia', -11, 23, 92, 141],
  ['Japan', 30, 46, 129, 146],
  ['India', 6, 30, 68, 90],
  ['Middle East', 12, 40, 34, 63],
  ['Europe', 36, 72, -11, 40],
  ['Russia', 41, 82, 40, 180],
  ['China', 18, 54, 73, 135],
  ['Central Asia', 30, 56, 46, 90],
  ['Africa', -36, 38, -19, 52],
  ['Central America', 7, 33, -118, -77],
  ['North America', 24, 84, -170, -52],
  ['South America', -57, 13, -82, -34],
];

export function regionName(latDeg: number, lonDeg: number): string {
  const sea = isSea(latDeg, lonDeg);
  const inside = (b: Box) => latDeg >= b[1] && latDeg <= b[2] && lonDeg >= b[3] && lonDeg <= b[4];
  if (sea !== false) {
    const hit = SEAS.find(inside);
    if (sea === true || !LANDS.some(inside)) return hit ? hit[0] : 'Open ocean';
  }
  return LANDS.find(inside)?.[0] ?? (sea === false ? 'Land' : 'Open ocean');
}
