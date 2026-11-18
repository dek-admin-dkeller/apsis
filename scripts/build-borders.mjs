/**
 * Builds public/data/borders.bin — coastlines and country borders for the "Borders" map
 * layer — from the Natural Earth data in the `world-atlas` package (dev dependency).
 * Run once with `npm run build-borders`; the output is committed, so the app needs
 * neither the package nor a network connection at run time.
 *
 * world-atlas ships TopoJSON: every boundary is an "arc" stored ONCE (a border shared
 * by two countries is one arc referenced by both), as integer deltas that a
 * scale/translate transform turns into degrees. We decode that by hand:
 *
 *   x += dx; y += dy;  lon = x * scale[0] + translate[0];  lat = y * scale[1] + translate[1]
 *
 * File layout (little-endian):
 *   bytes 0-3   "OHB1"
 *   uint32      arcCount
 *   uint16[n]   points in each arc; top bit set = land border (shared by two countries),
 *               clear = coastline
 *   int16[]     lon, lat pairs for all arcs back to back; lon = v / 32767 * 180, lat = v / 32767 * 90
 */

import { readFileSync, writeFileSync } from 'node:fs';

const source = process.argv[2] ?? 'countries-50m.json';
const topo = JSON.parse(readFileSync(new URL(`../node_modules/world-atlas/${source}`, import.meta.url), 'utf8'));
const [sx, sy] = topo.transform.scale;
const [tx, ty] = topo.transform.translate;

// An arc used by two countries is a land border; used by one, a coastline.
const uses = new Uint16Array(topo.arcs.length);
const walk = (arcs) => {
  for (const a of arcs) {
    if (Array.isArray(a)) walk(a);
    else uses[a < 0 ? ~a : a]++; // a negative index means "this arc, reversed"
  }
};
for (const geometry of topo.objects.countries.geometries) if (geometry.arcs) walk(geometry.arcs);

const MAX_POINTS = 0x7fff;
const counts = [];
const coords = [];
let borders = 0;
for (let i = 0; i < topo.arcs.length; i++) {
  const arc = topo.arcs[i];
  if (arc.length < 2) continue;
  if (arc.length > MAX_POINTS) throw new Error(`arc ${i} has ${arc.length} points — too long for the format`);
  const isBorder = uses[i] >= 2;
  if (isBorder) borders++;
  counts.push(arc.length | (isBorder ? 0x8000 : 0));
  let x = 0;
  let y = 0;
  for (const [dx, dy] of arc) {
    x += dx;
    y += dy;
    const lon = Math.max(-180, Math.min(180, x * sx + tx));
    const lat = Math.max(-90, Math.min(90, y * sy + ty));
    coords.push(Math.round((lon / 180) * 32767), Math.round((lat / 90) * 32767));
  }
}

const bytes = new Uint8Array(8 + counts.length * 2 + coords.length * 2);
const view = new DataView(bytes.buffer);
bytes.set([0x4f, 0x48, 0x42, 0x31]); // "OHB1"
view.setUint32(4, counts.length, true);
let offset = 8;
for (const c of counts) { view.setUint16(offset, c, true); offset += 2; }
for (const c of coords) { view.setInt16(offset, c, true); offset += 2; }

const out = new URL('../public/data/borders.bin', import.meta.url);
writeFileSync(out, bytes);
console.log(`${source}: ${counts.length} arcs (${borders} land borders, ${counts.length - borders} coastlines), ` +
  `${coords.length / 2} points → public/data/borders.bin, ${(bytes.length / 1024).toFixed(0)} KB`);
