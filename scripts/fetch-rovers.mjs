// scripts/fetch-rovers.mjs — `npm run fetch-rovers`
//
// Saves the paths the Mars rovers have driven to public/data/rovers.json, so that a visit to
// Mars can draw them on the ground.
//
// The source is NASA's own "Where is the rover" maps (the MMGIS tool at mars.nasa.gov): each
// mission publishes two GeoJSON layers that the map draws.
//   <mission>_traverse.json   the path as driven, one line per drive, from the rover team's
//                             localisations: longitude EAST and planetocentric latitude
//                             (CRS84 order, lon first), with an elevation we do not need;
//   <mission>_waypoints.json  one point per stop with its sol and the odometry so far
//                             (`dist_total_m`), which is the "driven so far" figure the
//                             missions themselves quote.
// Produced by NASA/JPL-Caltech; JPL's use policy lets them be used for any purpose without
// prior permission, with the credit "NASA/JPL-Caltech". Only rovers whose operator publishes
// such a traverse are listed (not Zhurong: CNSA publishes no traverse data).
//
// The traverse files hold tens of thousands of points (a localisation every few metres);
// a few km of path on a world 3,390 km in radius needs far fewer. Douglas–Peucker keeps a point
// only where dropping it would move the line by more than a tolerance (2 m, raised if a rover
// would still need more than MAX_POINTS), so the shape is exact to that tolerance.
//
// Politeness: four requests in all, 1.5 s apart, each with a time limit; the rovers move a few
// tens of metres a sol, so the script refuses to download again while the file is younger than
// 23.5 hours (use --force). Any failure keeps what the file had (per rover) and exits 0: this
// can never break a deploy.

import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/data/rovers.json');

const BASE = 'https://mars.nasa.gov/mmgis-maps';
/** `id` is the craft's id in deep.json: that is how the app finds the rover a path belongs to. */
const ROVERS = [
  { id: 'curiosity', name: 'Curiosity', mission: 'MSL' },
  { id: 'perseverance', name: 'Perseverance', mission: 'M20' },
];

// "Once a day", half an hour short so that a daily run is not turned away by a few minutes.
const MIN_AGE_HOURS = 23.5;
const PAUSE_MS = 1500;
const TIMEOUT_MS = 60000;
const MAX_POINTS = 3000;
const MARS_RADIUS_M = 3389500; // only for distances along the ground, where 0.1 % does not matter

const exists = (p) => access(p).then(() => true, () => false);
const pause = () => new Promise((resolve) => setTimeout(resolve, PAUSE_MS));

async function getJson(url) {
  const res = await fetch(url, {
    // A generic name: nothing in the request says who or what project is asking.
    headers: { 'User-Agent': 'orbit-viewer rover paths (build-time, 4 requests a day, never polled)', Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const data = JSON.parse(await res.text()); // throws if an error page came back instead
  if (!data || !Array.isArray(data.features)) throw new Error(`${url} is not a GeoJSON feature collection`);
  return data;
}

const valid = (c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[1]) <= 90 && Math.abs(c[0]) <= 360;

/** Every line of the traverse, in the file's order (drives are listed oldest first), as one path of [lat, lon]. */
function joinTraverse(geo) {
  const path = [];
  for (const feature of geo.features) {
    const g = feature?.geometry;
    const lines = g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? g.coordinates : [];
    for (const line of lines) {
      for (const c of line) {
        if (!valid(c)) continue;
        const lat = c[1], lon = ((c[0] % 360) + 360) % 360; // east longitude, 0…360
        const last = path[path.length - 1];
        if (last && last[0] === lat && last[1] === lon) continue; // the files repeat a point while the rover stands
        path.push([lat, lon]);
      }
    }
  }
  return path;
}

/** Metres along the ground between two [lat, lon] (haversine). */
function groundMetres(a, b) {
  const r = Math.PI / 180;
  const h = Math.sin(((b[0] - a[0]) * r) / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(((b[1] - a[1]) * r) / 2) ** 2;
  return 2 * MARS_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Douglas–Peucker on a flat map around the path (a few tens of km: the flat approximation is
 * good to millimetres there). Iterative, so a long path cannot overflow the stack.
 */
function simplify(path, toleranceM) {
  if (path.length < 3) return path.slice();
  const r = Math.PI / 180, lat0 = path[0][0] * r;
  const xy = path.map(([lat, lon]) => [lon * r * Math.cos(lat0) * MARS_RADIUS_M, lat * r * MARS_RADIUS_M]);
  const keep = new Uint8Array(path.length);
  keep[0] = keep[path.length - 1] = 1;
  const stack = [[0, path.length - 1]];
  while (stack.length > 0) {
    const [i, j] = stack.pop();
    const [ax, ay] = xy[i], [bx, by] = xy[j];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let worst = -1, at = -1;
    for (let k = i + 1; k < j; k++) {
      const [px, py] = xy[k];
      // Distance to the SEGMENT, not the infinite line: a path that doubles back must keep its tip.
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > worst) { worst = d; at = k; }
    }
    if (worst > toleranceM) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  return path.filter((_, k) => keep[k]);
}

async function rover(spec) {
  const traverseUrl = `${BASE}/${spec.mission}/Layers/json/${spec.mission}_traverse.json`;
  const waypointsUrl = `${BASE}/${spec.mission}/Layers/json/${spec.mission}_waypoints.json`;
  const traverse = await getJson(traverseUrl);
  await pause();
  const waypoints = await getJson(waypointsUrl);

  const full = joinTraverse(traverse);
  if (full.length < 2) throw new Error('the traverse has no usable points');
  let tolerance = 2, points = simplify(full, tolerance);
  while (points.length > MAX_POINTS && tolerance < 50) points = simplify(full, (tolerance *= 1.5));

  // Odometry: the largest running total (stops that are not the end of a drive carry 0).
  let drivenM = 0, sol = 0;
  for (const f of waypoints.features) {
    const p = f?.properties ?? {};
    if (Number.isFinite(p.dist_total_m)) drivenM = Math.max(drivenM, p.dist_total_m);
    if (Number.isFinite(p.sol)) sol = Math.max(sol, p.sol);
  }
  let lineM = 0;
  for (let k = 1; k < full.length; k++) lineM += groundMetres(full[k - 1], full[k]);
  if (!(drivenM > 0)) drivenM = lineM; // no odometry in the file: the length of the line is the next best thing

  const round = (v) => Math.round(v * 1e6) / 1e6; // a millionth of a degree is 6 cm on Mars
  console.log(`  ${spec.name}: ${full.length} points → ${points.length} (within ${tolerance.toFixed(1)} m), ${(drivenM / 1000).toFixed(2)} km driven by sol ${sol}`);
  return {
    id: spec.id,
    name: spec.name,
    source: traverseUrl,
    fetchedAt: new Date().toISOString(),
    sol,
    drivenKm: Math.round(drivenM) / 1000,
    toleranceM: Math.round(tolerance * 10) / 10,
    points: points.map(([lat, lon]) => [round(lat), round(lon)]),
  };
}

async function main() {
  let previous = null;
  if (await exists(OUT)) {
    try {
      previous = JSON.parse(await readFile(OUT, 'utf8'));
      const ageHours = (Date.now() - Date.parse(previous.fetchedAt)) / 3.6e6;
      if (!process.argv.includes('--force') && ageHours < MIN_AGE_HOURS) {
        console.log(`  rover paths are only ${ageHours.toFixed(1)} h old — not re-downloading (use --force only if you really need to).`);
        return;
      }
    } catch { previous = null; /* unreadable file: replace it */ }
  }

  const rovers = [];
  let fresh = 0;
  for (const [n, spec] of ROVERS.entries()) {
    if (n > 0) await pause();
    try {
      rovers.push(await rover(spec));
      fresh++;
    } catch (error) {
      // One mission's map being down must not cost the other rover, or this rover its old path.
      const old = previous?.rovers?.find((r) => r.id === spec.id);
      console.error(`  ${spec.name}: could not download (${error.message}) — ${old ? 'keeping the path the file had' : 'left out'}`);
      if (old) rovers.push(old);
    }
  }
  if (fresh === 0) {
    console.error('  nothing new downloaded — keeping the existing file untouched');
    return;
  }
  const file = {
    fetchedAt: new Date().toISOString(),
    source: 'NASA/JPL-Caltech "Where is the rover" maps (mars.nasa.gov/mmgis-maps): traverse and waypoint layers',
    credit: 'NASA/JPL-Caltech',
    fields: { points: '[latDeg planetocentric, lonDeg east], oldest first, simplified to within toleranceM metres' },
    rovers,
  };
  await mkdir(dirname(OUT), { recursive: true });
  const text = JSON.stringify(file);
  await writeFile(OUT, text);
  console.log(`  wrote ${rovers.length} rover paths to public/data/rovers.json (${(text.length / 1024).toFixed(0)} KB)`);
}

console.log('Rover paths (NASA/JPL MMGIS):');
try {
  await main();
} catch (error) {
  // Whatever went wrong, the site must still build with the file it already has.
  console.error(`  unexpected problem (${error.message}) — keeping the existing file untouched`);
}
