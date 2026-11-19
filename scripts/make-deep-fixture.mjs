// scripts/make-deep-fixture.mjs — builds scripts/fixtures/deep-truth.json (run by hand, rarely).
//
//   node scripts/make-deep-fixture.mjs          download the reference positions
//   node scripts/make-deep-fixture.mjs --fit    also print the built-in moon orbits for ephem.ts
//
// `npm run check` must be able to say "the planets are where NASA says they are" without the
// network. So this script asks JPL Horizons ONCE for the truth on twelve dates between 2024 and
// 2030 and stores it: where each planet is from the Sun, where each moon is from its planet,
// and which way every body with a map is turned. scripts/check-deep.mjs compares
// src/space/ephem.ts with that file. About 45 requests, one at a time (see horizons.mjs).
//
// With --fit it also downloads twenty years of positions of each moon (ten more requests) and
// fits the mean orbit that ephem.ts carries as MOON_ORBITS: a fixed plane, the mean longitude
// and its true rate, and (where the long axis turns steadily) an eccentricity and the rate its
// periapsis moves at. The fit is by averaging, not by a snapshot, because one instant's
// osculating ellipse is off by up to twice the eccentricity everywhere else.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { horizons, jdText, jdUt, tableHeader, tableRows, vectors } from './horizons.mjs';
import { BODIES } from '../src/space/bodies.ts';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/deep-truth.json');

// Awkward times on purpose (never midnight), spread over the years the app will be used in.
const DATES = [
  '2024-02-10T06:00:00Z', '2024-09-23T17:30:00Z', '2025-04-07T03:15:00Z', '2025-12-01T21:00:00Z',
  '2026-07-19T09:45:00Z', '2026-11-18T12:00:00Z', '2027-05-30T00:30:00Z', '2028-01-14T14:00:00Z',
  '2028-10-08T19:20:00Z', '2029-08-25T05:10:00Z', '2030-06-12T11:40:00Z', '2030-12-28T23:00:00Z',
].map((iso) => Date.parse(iso));

/** Horizons' numbers for the bodies: planets are x99, moons planet-digit + 01… */
const CODE = {
  sun: 10, mercury: 199, venus: 299, earth: 399, moon: 301, mars: 499, phobos: 401, deimos: 402,
  jupiter: 599, io: 501, europa: 502, ganymede: 503, callisto: 504, saturn: 699, enceladus: 602, titan: 606,
  uranus: 799, neptune: 899, triton: 801, pluto: 999, charon: 901,
};
const PLANETS = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
const MOONS = ['moon', 'phobos', 'deimos', 'io', 'europa', 'ganymede', 'callisto', 'enceladus', 'titan', 'triton', 'charon'];
// Every body with a rotation model of its own. Seen from the Earth's centre, except the Earth
// itself (from the Sun's) and the Sun (from the Earth's).
const TURNING = ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'io', 'europa', 'ganymede', 'callisto', 'saturn', 'titan', 'uranus', 'neptune', 'pluto'];

const round = (v, digits) => Number(v.toFixed(digits));

async function planetsAndMoons() {
  const planets = {}, moons = {};
  for (const id of PLANETS) {
    planets[id] = (await vectors(CODE[id], 10, DATES)).map((row) => row.pos.map((v) => round(v, 1)));
    console.log(`  ${id}: ${planets[id].length} positions from the Sun`);
  }
  for (const id of MOONS) {
    const parent = BODIES[id].parent;
    moons[id] = { centre: parent, xyz: (await vectors(CODE[id], CODE[parent], DATES)).map((row) => row.pos.map((v) => round(v, 3))) };
    console.log(`  ${id}: ${moons[id].xyz.length} positions from ${parent}`);
  }
  return { planets, moons };
}

/**
 * How each body is turned, as an observer sees it: the direction and distance of the body, the
 * longitude and latitude of the point at the middle of its disc, and where its north pole
 * points. The check rebuilds that point from bodyAxes() and compares.
 */
async function rotations() {
  const out = {};
  for (const id of TURNING) {
    const from = id === 'earth' ? 'sun' : 'earth';
    const text = await horizons({
      COMMAND: CODE[id], EPHEM_TYPE: 'OBSERVER', CENTER: `500@${CODE[from]}`, QUANTITIES: '1,14,20,32',
      ANG_FORMAT: 'DEG', EXTRA_PREC: 'YES', TLIST: DATES.map((ms) => jdText(jdUt(ms))).join(','),
    });
    const head = tableHeader(text);
    const col = (name) => {
      const i = head.findIndex((cell) => cell.startsWith(name));
      if (i < 0) throw new Error(`${id}: no column ${name}`);
      return i;
    };
    const ra = col('R.A.'), dec = col('DEC'), lon = col('ObsSub-LON'), lat = col('ObsSub-LAT'), delta = col('delta'), pra = col('N.Pole-RA'), pdc = col('N.Pole-DC');
    // The header says which way longitude is counted on this body and how flattened it is
    // (the latitude Horizons prints is measured from the flattened surface's own vertical).
    const west = /Target pole\/equ\s*:.*West-longitude positive/.test(text);
    const radii = /Target radii\s*:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(text);
    const flattening = radii ? 1 - Number(radii[3]) / Number(radii[1]) : 0;
    const model = (/Target pole\/equ\s*:\s*(\S+)/.exec(text) ?? [])[1] ?? '';
    const rows = tableRows(text).map((cells, i) => ({
      tMs: DATES[i],
      raDeg: Number(cells[ra]), decDeg: Number(cells[dec]), rangeKm: round(Number(cells[delta]) * 149597870.7, 0),
      subLonDeg: Number(cells[lon]), subLatDeg: Number(cells[lat]), poleRaDeg: Number(cells[pra]), poleDecDeg: Number(cells[pdc]),
    }));
    if (rows.length !== DATES.length || !rows.every((row) => Object.values(row).every(Number.isFinite))) throw new Error(`${id}: unreadable rotation table`);
    out[id] = { from, model, westPositive: west, flattening: round(flattening, 6), rows };
    console.log(`  ${id}: turned as ${model} says (${west ? 'west' : 'east'} longitude positive)`);
  }
  return out;
}

// ── --fit: the mean orbits of the moons ─────────────────────────────────────────────────

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const n = norm(a); return [a[0] / n, a[1] / n, a[2] / n]; };
const TAU = 2 * Math.PI, DEG = Math.PI / 180;

/** Straight line through (x, y) by least squares: y ≈ c + m x. */
function line(xs, ys) {
  const n = xs.length, mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
  const m = sxy / sxx;
  return { c: my - m * mx, m };
}

async function fitMoon(id, epochMs) {
  const parent = BODIES[id].parent;
  const gm = BODIES[parent].gm + BODIES[id].gm; // two bodies circling each other: both masses count
  const rows = await vectors(CODE[id], CODE[parent], { startMs: Date.parse('2016-01-01T00:00:00Z'), stopMs: Date.parse('2036-12-31T00:00:00Z'), stepMinutes: 5329 });
  const days = rows.map((row) => (row.tMs - epochMs) / 86400000);

  // 1. The plane: the average of the orbit normals.
  const mean = [0, 0, 0];
  for (const row of rows) { const h = unit(cross(row.pos, row.vel)); mean[0] += h[0]; mean[1] += h[1]; mean[2] += h[2]; }
  const normal = unit(mean);
  const incl = Math.acos(normal[2]), node = Math.atan2(normal[0], -normal[1]);
  const X = [Math.cos(node), Math.sin(node), 0], Y = cross(normal, X);

  // 2. The mean longitude and its rate: a straight line through the angle in the plane,
  // unwrapped with the textbook period as the first guess.
  const guess = TAU / BODIES[id].periodDays;
  const angle = (row) => Math.atan2(dot(row.pos, Y), dot(row.pos, X));
  const start = angle(rows[0]) - guess * days[0]; // so "expected" passes through the first sample
  const theta = rows.map((row, i) => {
    const raw = angle(row);
    return raw + TAU * Math.round((start + guess * days[i] - raw) / TAU);
  });
  // The first guess may be off by a few degrees over twenty years, never by half a turn; a
  // second pass with the fitted line makes the unwrapping safe either way.
  let fit = line(days, theta);
  const theta2 = theta.map((value, i) => value + TAU * Math.round((fit.c + fit.m * days[i] - value) / TAU));
  fit = line(days, theta2);

  // 3. The eccentricity and how fast the periapsis turns: each sample's eccentricity vector is
  // a small arrow in the plane; find the turning rate at which the arrows add up best.
  const arrows = rows.map((row) => {
    const h = cross(row.pos, row.vel), r = norm(row.pos), vxh = cross(row.vel, h);
    const e = [vxh[0] / gm - row.pos[0] / r, vxh[1] / gm - row.pos[1] / r, vxh[2] / gm - row.pos[2] / r];
    return [dot(e, X), dot(e, Y)];
  });
  const coherent = (rate) => {
    let re = 0, im = 0;
    for (let i = 0; i < arrows.length; i++) {
      const c = Math.cos(rate * days[i]), s = Math.sin(rate * days[i]);
      re += arrows[i][0] * c + arrows[i][1] * s;
      im += arrows[i][1] * c - arrows[i][0] * s;
    }
    return { e: Math.hypot(re, im) / arrows.length, peri: Math.atan2(im, re) };
  };
  let best = { e: -1, peri: 0, rate: 0 };
  for (let span = 3 * DEG, centre = 0, pass = 0; pass < 4; pass++, span /= 60) {
    for (let k = -600; k <= 600; k++) {
      const rate = centre + (span * k) / 600, got = coherent(rate);
      if (got.e > best.e) best = { ...got, rate };
    }
    centre = best.rate;
  }
  const meanDistance = rows.reduce((sum, row) => sum + norm(row.pos), 0) / rows.length;

  // 4. Which is closer to the truth over the twenty years: the turning ellipse or a plain circle?
  const model = (e, peri, periRate) => {
    const aKm = meanDistance / (1 + (e * e) / 2);
    let worst = 0, sumSq = 0;
    rows.forEach((row, i) => {
      const w = peri + periRate * days[i];
      let M = fit.c + fit.m * days[i] - w, E = M;
      for (let k = 0; k < 20; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      const xp = aKm * (Math.cos(E) - e), yp = aKm * Math.sqrt(1 - e * e) * Math.sin(E);
      const inPlaneX = xp * Math.cos(w) - yp * Math.sin(w), inPlaneY = xp * Math.sin(w) + yp * Math.cos(w);
      const p = [X[0] * inPlaneX + Y[0] * inPlaneY, X[1] * inPlaneX + Y[1] * inPlaneY, X[2] * inPlaneX + Y[2] * inPlaneY];
      const angle = Math.acos(Math.min(1, dot(p, row.pos) / (norm(p) * norm(row.pos)))) / DEG;
      worst = Math.max(worst, angle);
      sumSq += angle * angle;
    });
    return { aKm, worst, rms: Math.sqrt(sumSq / rows.length) };
  };
  const ellipse = model(best.e, best.peri, best.rate), circle = model(0, 0, 0);
  const useEllipse = ellipse.rms < circle.rms * 0.8;
  const chosen = useEllipse ? ellipse : circle;
  const wrap = (a) => ((a % TAU) + TAU) % TAU;
  const e = useEllipse ? best.e : 0, peri = useEllipse ? wrap(best.peri) : 0, periRate = useEllipse ? best.rate : 0;
  console.log(`  // ${id}: ${rows.length} samples; ellipse rms ${ellipse.rms.toFixed(3)}° worst ${ellipse.worst.toFixed(3)}° (e ${best.e.toFixed(5)}, periapsis ${(best.rate / DEG).toFixed(4)}°/day); circle rms ${circle.rms.toFixed(3)}° worst ${circle.worst.toFixed(3)}°`);
  return `  ${id}: { epochMs: ${epochMs}, aKm: ${chosen.aKm.toFixed(1)}, e: ${e.toFixed(6)}, incl: ${incl.toFixed(7)}, node: ${wrap(node).toFixed(7)}, peri: ${peri.toFixed(6)}, m0: ${wrap(fit.c - peri).toFixed(7)}, rate: ${fit.m.toFixed(11)}, periRate: ${periRate.toExponential(6)} },`;
}

// ── main ────────────────────────────────────────────────────────────────────────────────

console.log('Reference positions and orientations from JPL Horizons:');
const { planets, moons } = await planetsAndMoons();
const rotation = await rotations();
const fixture = {
  source: 'JPL Horizons (ssd.jpl.nasa.gov), DE441 and the satellite ephemerides it names; ICRF, km. Made by scripts/make-deep-fixture.mjs.',
  madeAt: new Date().toISOString(),
  dates: DATES,
  planets, // id → one [x, y, z] from the Sun's centre per date
  moons, // id → { centre, xyz: one [x, y, z] from the planet's centre per date }
  rotation, // id → what an observer at the centre of `from` sees (see rotations() above)
};
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(fixture));
console.log(`  wrote scripts/fixtures/deep-truth.json`);

if (process.argv.includes('--fit')) {
  console.log('\nMean orbits of the moons, 2016–2036 (paste into MOON_ORBITS in src/space/ephem.ts):');
  const epochMs = Date.parse('2026-01-01T00:00:00Z');
  const lines = [];
  for (const id of MOONS) if (id !== 'moon') lines.push(await fitMoon(id, epochMs));
  console.log(lines.join('\n'));
}
