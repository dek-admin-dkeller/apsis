// Where to write each country's name on the globe: public/data/countries.json, made from the
// Natural Earth data in the `world-atlas` package (dev dependency), like build-borders.mjs.
// Run by hand: `node scripts/build-country-labels.mjs` (the file is committed).
//
// For each country: its name, and a point to put it at — the centre of its LARGEST polygon
// (the mainland: Norway's name sits on Norway, not between it and Svalbard), worked out on the
// sphere (unit vectors weighted by triangle area, then back to latitude and longitude), so a
// country across the 180° meridian (Russia, Fiji) comes out right where a flat average would
// put it on the wrong side of the world. Also the area, so the globe can name the largest
// countries from far away and the smaller ones as the camera comes down.
//
//   [{ "n": "Brazil", "lat": -10.8, "lon": -53.1, "a": 8486000 }, …]   largest first

import { readFileSync, writeFileSync } from 'node:fs';

const topo = JSON.parse(readFileSync(new URL('../node_modules/world-atlas/countries-50m.json', import.meta.url), 'utf8'));
const [sx, sy] = topo.transform.scale;
const [tx, ty] = topo.transform.translate;

// TopoJSON arcs: integer deltas → longitude/latitude.
const arcs = topo.arcs.map((arc) => {
  let x = 0, y = 0;
  return arc.map(([dx, dy]) => {
    x += dx;
    y += dy;
    return [x * sx + tx, y * sy + ty];
  });
});
const ring = (indices) => {
  const points = [];
  for (const index of indices) {
    const arc = index >= 0 ? arcs[index] : arcs[~index].slice().reverse();
    points.push(...(points.length ? arc.slice(1) : arc));
  }
  return points;
};
const toVec = ([lon, lat]) => {
  const φ = (lat * Math.PI) / 180, λ = (lon * Math.PI) / 180;
  return [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A ring's area (steradians, by spherical triangles fanned from its first point) and its centre (unit vector, area-weighted). */
function measure(points) {
  const v = points.map(toVec);
  let area = 0;
  const centre = [0, 0, 0];
  for (let i = 1; i < v.length - 1; i++) {
    const a = v[0], b = v[i], c = v[i + 1];
    // Signed area of the triangle (Van Oosterom & Strackee).
    const numerator = dot(a, cross(b, c));
    const denominator = 1 + dot(a, b) + dot(b, c) + dot(c, a);
    const t = 2 * Math.atan2(numerator, denominator);
    area += t;
    for (let k = 0; k < 3; k++) centre[k] += t * (a[k] + b[k] + c[k]);
  }
  return { area: Math.abs(area), centre: area < 0 ? centre.map((x) => -x) : centre };
}

const R_KM = 6371;
/** Natural Earth's names are map-ready ("Dem. Rep. Congo"); only the longest is shortened. */
const SHORTER = { 'United States of America': 'United States' };
const out = [];
for (const geometry of topo.objects.countries.geometries) {
  const name = geometry.properties?.name;
  if (!name || !geometry.arcs) continue;
  const polygons = geometry.type === 'Polygon' ? [geometry.arcs] : geometry.type === 'MultiPolygon' ? geometry.arcs : [];
  let best = null, total = 0;
  for (const polygon of polygons) {
    const m = measure(ring(polygon[0])); // the outer ring (holes are small enough to ignore for a label)
    total += m.area;
    if (!best || m.area > best.area) best = m;
  }
  if (!best || best.area <= 0) continue;
  const length = Math.hypot(...best.centre);
  if (length === 0) continue;
  const [x, y, z] = best.centre.map((c) => c / length);
  out.push({
    n: SHORTER[name] ?? name,
    lat: Math.round(((Math.asin(z) * 180) / Math.PI) * 10) / 10,
    lon: Math.round(((Math.atan2(y, x) * 180) / Math.PI) * 10) / 10,
    a: Math.round((total * R_KM * R_KM) / 1000) * 1000,
  });
}
out.sort((p, q) => q.a - p.a);
writeFileSync(new URL('../public/data/countries.json', import.meta.url), JSON.stringify(out));
console.log(`wrote ${out.length} countries to public/data/countries.json (largest: ${out.slice(0, 3).map((c) => `${c.n} ${c.lat}, ${c.lon}`).join('; ')})`);
