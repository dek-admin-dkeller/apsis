// scripts/make-deep-fixture.mjs — builds scripts/fixtures/deep-truth.json and src/space/moonOrbits.ts
// (run by hand, rarely).
//
//   node scripts/make-deep-fixture.mjs          download what the fixture does not have yet
//   node scripts/make-deep-fixture.mjs --all    download the whole fixture again
//   node scripts/make-deep-fixture.mjs --fit    also fit every moon's orbit and write moonOrbits.ts
//        … --fit --cache <folder>               keep the sixty years of samples in a folder and reuse
//                                               them (to work on the fit without asking Horizons again)
//
// `npm run check` must be able to say "the planets and moons are where NASA says they are"
// without the network. So this script asks JPL Horizons for the truth on twelve dates between
// 2024 and 2030 and stores it: where each planet is from the Sun, where each moon is from its
// planet, and which way every body with a rotation model is turned. scripts/check-deep.mjs
// compares src/space/ephem.ts with that file. A body already in the file is not asked for
// again, so adding a moon costs two requests, not ninety.
//
// With --fit it also downloads sixty years of positions of each moon (one request each) and
// fits the orbit that ephem.ts propagates:
//
//   the plane    swings round a fixed axis somewhere between the planet's pole (which rules
//                close in) and the pole of the planet's own orbit (which rules far out); the
//                axis, the tilt to it and the rate of swing are fitted
//   the pace     the mean angle from the node, a straight line in time plus up to fourteen slow
//                sine waves found one at a time (the 70-year swing of Mimas, the 8-year
//                exchange of Janus and Epimetheus, the Sun's tug on Himalia …)
//   the ellipse  the eccentricity vector as one arrow turning at a steady rate (an ellipse
//                whose long axis turns), plus up to three smaller arrows where the Sun or a
//                neighbouring moon keeps reshaping the orbit (Himalia, Hyperion, Phoebe)
//
// Everything is by averaging over the sixty years, never from one instant: an osculating
// ellipse is off by up to twice the eccentricity everywhere else. The script prints how far
// each fitted orbit strays from the samples; the independent test is check-deep.mjs.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BODY_CODE as CODE, horizons, jdText, jdUt, tableHeader, tableRows, vectorRun, vectors } from './horizons.mjs';
import { BODIES, BODY_LIST } from '../src/space/bodies.ts';
import { bodyAxes, bodyPosition } from '../src/space/ephem.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'fixtures/deep-truth.json');
const ORBITS = join(HERE, '../src/space/moonOrbits.ts');

// Awkward times on purpose (never midnight), spread over the years the app will be used in.
const DATES = [
  '2024-02-10T06:00:00Z', '2024-09-23T17:30:00Z', '2025-04-07T03:15:00Z', '2025-12-01T21:00:00Z',
  '2026-07-19T09:45:00Z', '2026-11-18T12:00:00Z', '2027-05-30T00:30:00Z', '2028-01-14T14:00:00Z',
  '2028-10-08T19:20:00Z', '2029-08-25T05:10:00Z', '2030-06-12T11:40:00Z', '2030-12-28T23:00:00Z',
].map((iso) => Date.parse(iso));

const PLANETS = BODY_LIST.filter((body) => body.kind === 'planet' || body.kind === 'dwarf').map((body) => body.id);
const MOONS = BODY_LIST.filter((body) => body.kind === 'moon').map((body) => body.id);
// Every body is asked how it is turned. Horizons answers "n.a." for the few with no rotation
// model (Hyperion tumbles; nobody has fixed the spin of Himalia or Nereid): those are skipped.
const TURNING = BODY_LIST.map((body) => body.id);

const round = (v, digits) => Number(v.toFixed(digits));

/**
 * How a body is turned, as an observer sees it: the direction and distance of the body, the
 * longitude and latitude of the point at the middle of its disc, and where its north pole
 * points. The check rebuilds that point from bodyAxes() and compares. Seen from the Earth's
 * centre, except the Earth itself (from the Sun's). Null if Horizons has no model for it.
 */
async function rotationOf(id) {
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
  if (rows.length !== DATES.length) throw new Error(`${id}: ${rows.length} rows`);
  if (!rows.every((row) => Object.values(row).every(Number.isFinite))) return null; // "n.a.": no rotation model
  return { from, model, westPositive: west, flattening: round(flattening, 6), rows };
}

// ── --fit: the orbits of the moons ──────────────────────────────────────────────────────

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const n = norm(a); return [a[0] / n, a[1] / n, a[2] / n]; };
const mix = (a, x, b, y) => [a[0] * x + b[0] * y, a[1] * x + b[1] * y, a[2] * x + b[2] * y];
const TAU = 2 * Math.PI, DEG = Math.PI / 180, DAY = 86400000;
const wrapPi = (a) => a - TAU * Math.round(a / TAU);
const wrap = (a) => ((a % TAU) + TAU) % TAU;

const FIT_EPOCH = Date.parse('2026-01-01T00:00:00Z');
const FIT_START = Date.parse('1996-01-01T00:00:00Z'), FIT_STOP = Date.parse('2056-01-01T00:00:00Z');
const FIT_STEP_MINUTES = 5329; // 3.7 days: in step with nothing

/** Solve the small system A x = b (Gaussian elimination with pivoting). */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-300) return null;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Least squares of y on the columns given by `basis(x)`; returns the coefficients and the rms of what is left. */
function leastSquares(xs, ys, basis) {
  const k = basis(xs[0]).length;
  const A = Array.from({ length: k }, () => new Array(k).fill(0)), b = new Array(k).fill(0);
  for (let i = 0; i < xs.length; i++) {
    const row = basis(xs[i]);
    for (let p = 0; p < k; p++) {
      b[p] += row[p] * ys[i];
      for (let q = 0; q < k; q++) A[p][q] += row[p] * row[q];
    }
  }
  const coef = solve(A, b);
  if (!coef) return null;
  let sum = 0;
  for (let i = 0; i < xs.length; i++) sum += (ys[i] - basis(xs[i]).reduce((s, v, p) => s + v * coef[p], 0)) ** 2;
  return { coef, rms: Math.sqrt(sum / xs.length) };
}

/** An angle sampled at `days`, made continuous: each step is the expected advance plus whatever is left over. */
function unwrapSeries(raw, days, ratePerDay) {
  const out = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const expected = ratePerDay * (days[i] - days[i - 1]);
    out.push(out[i - 1] + expected + wrapPi(raw[i] - raw[i - 1] - expected));
  }
  return out;
}

/**
 * Pluto and Charon are a double: Charon is an eighth of Pluto's mass, so both circle a point
 * 2,100 km from Pluto's centre, outside Pluto itself. The four small moons go round THAT point,
 * not round Pluto. Measured from Pluto's centre (as Horizons gives them) their paths wobble by
 * 2.5° every 6.4 days and no ellipse fits; measured from the pair's centre of mass they are
 * plain, nearly round orbits. So for these moons the samples are moved to that centre first,
 * and ephem.ts moves the result back (the `partner` field).
 */
const PARTNER = { styx: 'charon', nix: 'charon', kerberos: 'charon', hydra: 'charon' };

/** The samples for one moon: from the cache folder if `--cache <folder>` was given and has them, else from Horizons. */
async function samplesOf(id) {
  const parent = BODIES[id].parent;
  const at = process.argv.indexOf('--cache');
  const file = at > 0 ? join(process.argv[at + 1], `${id}.json`) : null;
  if (file) {
    try { return JSON.parse(await readFile(file, 'utf8')); } catch { /* not there yet */ }
  }
  const rows = await vectorRun(CODE[id], CODE[parent], FIT_START, FIT_STOP, FIT_STEP_MINUTES);
  if (file) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(rows));
  }
  return rows;
}

async function fitMoon(id) {
  const parent = BODIES[id].parent;
  const partner = PARTNER[id];
  let gm = BODIES[parent].gm + BODIES[id].gm; // two bodies circling each other: both masses count
  let rows = await samplesOf(id);
  if (partner) {
    const share = BODIES[partner].gm / (BODIES[parent].gm + BODIES[partner].gm);
    const other = await samplesOf(partner);
    if (other.length !== rows.length || other[0].tMs !== rows[0].tMs) throw new Error(`${id}: its samples and ${partner}'s are not at the same moments`);
    rows = rows.map((row, i) => ({ tMs: row.tMs, pos: row.pos.map((x, k) => x - share * other[i].pos[k]), vel: row.vel.map((x, k) => x - share * other[i].vel[k]) }));
    gm += BODIES[partner].gm;
  }
  const days = rows.map((row) => (row.tMs - FIT_EPOCH) / DAY);
  const mid = days.reduce((best, d, i) => (Math.abs(d) < Math.abs(days[best]) ? i : best), 0);

  // 1. The axis the orbit's plane swings round: on the great circle through the planet's pole
  // and the pole of the planet's orbit, wherever the samples' normals keep the steadiest tilt.
  const normals = rows.map((row) => unit(cross(row.pos, row.vel)));
  const pole = bodyAxes(parent, FIT_EPOCH).pole;
  const p0 = bodyPosition(parent, FIT_EPOCH), p1 = bodyPosition(parent, FIT_EPOCH + DAY);
  const orbitPole = unit(cross(p0, [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]));
  const across = unit(mix(orbitPole, 1, pole, -dot(orbitPole, pole)));
  const meanNormal = unit(normals.reduce((sum, h) => [sum[0] + h[0], sum[1] + h[1], sum[2] + h[2]], [0, 0, 0]));
  const spread = (axis) => {
    const tilts = normals.map((h) => dot(h, axis));
    const mean = tilts.reduce((s, v) => s + v, 0) / tilts.length;
    return tilts.reduce((s, v) => s + (v - mean) ** 2, 0) / tilts.length;
  };
  let axis = meanNormal, least = Infinity;
  for (let k = 0; k < 720; k++) {
    const candidate = mix(pole, Math.cos((k * Math.PI) / 720), across, Math.sin((k * Math.PI) / 720));
    const s = spread(candidate);
    if (s < least) { least = s; axis = candidate; }
  }
  if (dot(axis, meanNormal) < 0) axis = axis.map((v) => -v);
  let tilt = normals.reduce((s, h) => s + Math.acos(Math.min(1, dot(h, axis))), 0) / normals.length;
  // A plane that hardly leans from the axis has no node to follow: treat it as fixed.
  const fixed = tilt < 0.05 * DEG;
  if (fixed) { axis = meanNormal; tilt = 0; }
  const u = unit(cross(axis, Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), v = cross(axis, u);

  // 2. How fast the plane swings: the node's angle round the axis, a straight line in time.
  let node0 = 0, nodeRate = 0;
  if (!fixed) {
    const raw = normals.map((h) => { const n = cross(axis, h); return Math.atan2(dot(n, v), dot(n, u)); });
    const line = leastSquares(days, unwrapSeries(raw, days, 0), (d) => [1, d]);
    [node0, nodeRate] = line.coef;
  }
  const frame = (d) => {
    const psi = node0 + nodeRate * d;
    const N = mix(u, Math.cos(psi), v, Math.sin(psi));
    const h = mix(axis, Math.cos(tilt), mix(u, Math.sin(psi), v, -Math.cos(psi)), Math.sin(tilt));
    return { N, h, Q: cross(h, N) };
  };

  // 3. In that turning plane: each sample's eccentricity vector, and its MEAN angle from the
  // node (the true angle with that sample's own equation of the centre taken out).
  const ecc = [], meanAngle = [];
  rows.forEach((row, i) => {
    const { N, Q } = frame(days[i]);
    const hv = cross(row.pos, row.vel), r = norm(row.pos), vxh = cross(row.vel, hv);
    const ev = [vxh[0] / gm - row.pos[0] / r, vxh[1] / gm - row.pos[1] / r, vxh[2] / gm - row.pos[2] / r];
    const ex = dot(ev, N), ey = dot(ev, Q), e = Math.min(0.999, Math.hypot(ex, ey)), peri = Math.atan2(ey, ex);
    const nu = Math.atan2(dot(row.pos, Q), dot(row.pos, N)) - peri;
    const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
    ecc.push([ex, ey]);
    meanAngle.push(peri + E - e * Math.sin(E));
  });
  const L = unwrapSeries(meanAngle, days, TAU / BODIES[id].periodDays);
  const shift = TAU * Math.round(L[mid] / TAU); // keep the numbers small round the epoch
  for (let i = 0; i < L.length; i++) L[i] -= shift;

  // 4. The pace: a straight line, then sine waves added while they help.
  const span = days.at(-1) - days[0];
  const periods = Array.from({ length: 900 }, (_, k) => 120 * (3 * span / 120) ** (k / 899)); // 120 days … three times the span
  const swings = []; // rates, radians per day
  const basis = (d) => [1, d, ...swings.flatMap((w) => [Math.sin(w * d), Math.cos(w * d)])];
  let fit = leastSquares(days, L, basis);
  for (let term = 0; term < 14; term++) {
    // Look for the wave in what the fit so far leaves behind (cheap: four unknowns per trial) …
    const left = L.map((y, i) => y - basis(days[i]).reduce((s, value, p) => s + value * fit.coef[p], 0));
    let found = null;
    for (const period of periods) {
      const w = TAU / period;
      if (swings.some((have) => Math.abs(have / w - 1) < 0.03)) continue;
      const trial = leastSquares(days, left, (d) => [1, d, Math.sin(w * d), Math.cos(w * d)]);
      if (trial && (!found || trial.rms < found.rms)) found = { rms: trial.rms, w };
    }
    if (!found) break;
    // … then fit everything together with it, and sharpen its rate.
    let best = { ...leastSquares(days, L, (d) => [...basis(d), Math.sin(found.w * d), Math.cos(found.w * d)]), w: found.w };
    if (!best.coef) break; // too like the terms already there to tell apart
    for (let width = 0.015, pass = 0; pass < 3; pass++, width /= 5) {
      for (let k = -5; k <= 5; k++) {
        const w = best.w * (1 + (width * k) / 5);
        const trial = leastSquares(days, L, (d) => [...basis(d), Math.sin(w * d), Math.cos(w * d)]);
        if (trial && trial.rms < best.rms) best = { ...trial, w };
      }
    }
    const size = Math.hypot(best.coef.at(-2), best.coef.at(-1));
    // Worth keeping only if it is a real swing (over 0.03°) and leaves clearly less behind.
    if (size < 0.03 * DEG || best.rms > fit.rms * 0.93) break;
    swings.push(best.w);
    fit = best;
  }
  const [c0, rate] = fit.coef;

  // 5. The ellipse. Each sample's eccentricity vector is an arrow in the plane; a steady
  // ellipse whose long axis turns evenly is ONE arrow going round at one rate. Find the rate at
  // which the samples' arrows add up best; then, in what is left, up to three more (the Sun
  // and the neighbouring moons each add an arrow of their own, turning at their own rate).
  const arrows = ecc.map((pair) => [...pair]);
  const coherent = (w) => {
    let re = 0, im = 0;
    for (let i = 0; i < arrows.length; i++) {
      const c = Math.cos(w * days[i]), s = Math.sin(w * days[i]);
      re += arrows[i][0] * c + arrows[i][1] * s;
      im += arrows[i][1] * c - arrows[i][0] * s;
    }
    return { e: Math.hypot(re, im) / arrows.length, peri: Math.atan2(im, re) };
  };
  const strongest = () => {
    // Up to 8° a day either way: measured from a node that itself runs backwards at 2° a day,
    // the periapsis of a moon as close in as Janus or Amalthea turns at 4 to 5° a day.
    let top = { e: -1, peri: 0, rate: 0 };
    for (let width = 8 * DEG, steps = 2400, centre = 0, pass = 0; pass < 4; pass++, width /= 200, steps = 60) {
      for (let k = -steps; k <= steps; k++) {
        const w = centre + (width * k) / steps, got = coherent(w);
        if (got.e > top.e) top = { ...got, rate: w };
      }
      centre = top.rate;
    }
    return top;
  };
  const parts = []; // { e, peri (at the epoch), rate }
  for (let k = 0; k < 4; k++) {
    const top = strongest();
    // The first arrow is the ellipse itself; a further one is kept if it moves the moon by a tenth of a degree or more.
    if (k === 0 ? top.e < 2e-4 : top.e < 9e-4) break;
    parts.push(top);
    for (let i = 0; i < arrows.length; i++) {
      arrows[i][0] -= top.e * Math.cos(top.peri + top.rate * days[i]);
      arrows[i][1] -= top.e * Math.sin(top.peri + top.rate * days[i]);
    }
  }
  const shapeAt = (d) => {
    let x = 0, y = 0;
    for (const part of parts) { x += part.e * Math.cos(part.peri + part.rate * d); y += part.e * Math.sin(part.peri + part.rate * d); }
    return { e: Math.hypot(x, y), peri: Math.atan2(y, x) };
  };
  const meanE = parts.length ? Math.sqrt(ecc.reduce((s, [x, y]) => s + x * x + y * y, 0) / ecc.length) : 0;
  const meanDistance = rows.reduce((sum, row) => sum + norm(row.pos), 0) / rows.length;
  const aKm = meanDistance / (1 + (meanE * meanE) / 2);

  // 6. How far the fitted orbit strays from the samples it was fitted to.
  const swingAt = (d) => swings.reduce((s, w, k) => s + fit.coef[2 + 2 * k] * Math.sin(w * d) + fit.coef[3 + 2 * k] * Math.cos(w * d), 0);
  let worst = 0, sumSq = 0;
  rows.forEach((row, i) => {
    const d = days[i], { N, Q } = frame(d), shape = shapeAt(d);
    const M = c0 + rate * d + swingAt(d) - shape.peri;
    let E = M;
    for (let k = 0; k < 40; k++) E -= (E - shape.e * Math.sin(E) - M) / (1 - shape.e * Math.cos(E));
    const xp = aKm * (Math.cos(E) - shape.e), yp = aKm * Math.sqrt(1 - shape.e ** 2) * Math.sin(E);
    const p = mix(N, xp * Math.cos(shape.peri) - yp * Math.sin(shape.peri), Q, xp * Math.sin(shape.peri) + yp * Math.cos(shape.peri));
    const off = Math.atan2(norm(cross(p, row.pos)), dot(p, row.pos)) / DEG;
    worst = Math.max(worst, off);
    sumSq += off * off;
  });

  // 7. The same orbit written the way ephem.ts wants it: the ellipse at the epoch in ICRF
  // terms, and the rates. The node ephem.ts measures from is the ICRF one; `lead` is the
  // angle from it to the node on the swinging plane's own reference, along the orbit.
  const { N, h } = frame(0);
  const incl = Math.acos(h[2]), node = Math.atan2(h[0], -h[1]);
  const icrfNode = [Math.cos(node), Math.sin(node), 0], quarter = cross(h, icrfNode);
  const lead = Math.atan2(dot(N, quarter), dot(N, icrfNode));
  const first = parts[0] ?? { e: 0, peri: 0, rate: 0 };
  const swingText = swings.flatMap((w, k) => [w.toPrecision(9), fit.coef[2 + 2 * k].toPrecision(6), fit.coef[3 + 2 * k].toPrecision(6)]).join(', ');
  const wobbleText = parts.slice(1).flatMap((part) => [part.rate.toPrecision(7), part.e.toPrecision(5), wrap(part.peri + lead).toFixed(5)]).join(', ');
  const years = (w) => (TAU / Math.abs(w) / 365.25 < 0.1 ? `${(TAU / Math.abs(w)).toFixed(1)} d` : `${(TAU / Math.abs(w) / 365.25).toFixed(1)} yr`);
  console.log(`  ${id}: ${rows.length} samples ${new Date(rows[0].tMs).getUTCFullYear()}–${new Date(rows.at(-1).tMs).getUTCFullYear()}; rms ${Math.sqrt(sumSq / rows.length).toFixed(3)}° worst ${worst.toFixed(3)}°; e ${parts.map((part) => part.e.toFixed(5)).join(' + ') || '0'}; tilt ${(tilt / DEG).toFixed(2)}° to its axis, node ${(nodeRate / DEG * 365.25).toFixed(3)}°/yr${swings.length ? `; swings ${swings.map((w, k) => `${(Math.hypot(fit.coef[2 + 2 * k], fit.coef[3 + 2 * k]) / DEG).toFixed(2)}° every ${years(w)}`).join(', ')}` : ''}`);
  return `  ${id}: { epochMs: ${FIT_EPOCH}, aKm: ${aKm.toFixed(1)}, e: ${first.e.toFixed(6)}, incl: ${incl.toFixed(7)}, node: ${wrap(node).toFixed(7)}, peri: ${wrap(first.peri + lead).toFixed(6)}, m0: ${wrap(c0 - first.peri).toFixed(7)}, rate: ${rate.toFixed(11)}, periRate: ${Number(first.rate.toPrecision(7))}, axis: [${axis.map((x) => x.toFixed(7)).join(', ')}], nodeRate: ${Number(nodeRate.toPrecision(7))}, swing: [${swingText}], wobble: [${wobbleText}], fitted: [${rows[0].tMs}, ${rows.at(-1).tMs}]${partner ? `, partner: '${partner}'` : ''} },`;
}

const ORBITS_HEAD = `/**
 * The built-in orbit of every moon but the Earth's, about its planet.
 *
 * GENERATED by \`node scripts/make-deep-fixture.mjs --fit\` from sixty years (1996–2056) of JPL
 * Horizons positions; do not edit the numbers by hand. ephem.ts turns them into positions.
 *
 * Each orbit is an ellipse that moves in three slow ways:
 *   - its plane swings round \`axis\` at \`nodeRate\`. Close to a planet the axis is the planet's
 *     pole (its bulge rules); far out it is the pole of the planet's own orbit (the Sun rules);
 *     for Iapetus it is in between;
 *   - its long axis turns within the plane at \`periRate\`;
 *   - the moon goes round at \`rate\` (the mean angle from the node, so the mean anomaly
 *     advances at rate − periRate), plus the slow swings in \`swing\`.
 *
 * epochMs, aKm, e, incl, node, peri, m0 describe the ellipse at the epoch in the usual way,
 * against the ICRF equator, angles in radians; rates are radians per day. \`swing\` holds
 * triples [rate, sine part, cosine part]: the longitude gains
 * sine × sin(rate × d) + cosine × cos(rate × d), d = days since SWING_EPOCH_MS.
 *
 * \`wobble\` is for the few orbits whose SHAPE keeps changing (the Sun reshapes Himalia's and
 * Phoebe's, Titan reshapes Hyperion's). The eccentricity and the direction of the periapsis
 * are the length and direction of one arrow in the orbit's plane; (e, peri, periRate) is
 * that arrow turning steadily, and each triple [rate, length, direction at SWING_EPOCH_MS]
 * in \`wobble\` is a smaller arrow added to it, turning at its own rate.
 *
 * \`fitted\` is the span of the positions the orbit was fitted to (Unix ms). Inside it the
 * orbit is better than any one-moment ellipse; ephem.ts falls back on the ellipses downloaded
 * with deep.json only outside it.
 *
 * \`partner\` marks Pluto's four small moons: Pluto and Charon are a double, and those moons
 * go round the pair's centre of mass, 2,100 km from Pluto's centre. Their orbits here are about
 * that point; ephem.ts adds the step from Pluto's centre to it.
 */

import type { BodyId, Vec } from './types.ts';

export interface MoonOrbit {
  epochMs: number;
  aKm: number;
  e: number;
  incl: number;
  node: number;
  peri: number;
  m0: number;
  rate: number;
  periRate: number;
  axis: Vec;
  nodeRate: number;
  swing: number[];
  wobble: number[];
  fitted: [number, number];
  partner?: BodyId;
}

/** The moment the swings are counted from (the epoch of the fit). */
export const SWING_EPOCH_MS = ${FIT_EPOCH};

export const MOON_ORBITS: Partial<Record<BodyId, MoonOrbit>> = {
`;

// ── main ────────────────────────────────────────────────────────────────────────────────

const all = process.argv.includes('--all');
let fixture = { planets: {}, moons: {}, rotation: {}, unturned: [] };
if (!all) {
  try { fixture = { unturned: [], ...JSON.parse(await readFile(OUT, 'utf8')) }; } catch { /* no fixture yet: download everything */ }
}
if (JSON.stringify(fixture.dates ?? DATES) !== JSON.stringify(DATES)) throw new Error('the dates have changed: run with --all');

console.log('Reference positions and orientations from JPL Horizons:');
let asked = 0;
for (const id of PLANETS) {
  if (fixture.planets[id]) continue;
  fixture.planets[id] = (await vectors(CODE[id], 10, DATES)).map((row) => row.pos.map((v) => round(v, 1)));
  console.log(`  ${id}: ${fixture.planets[id].length} positions from the Sun`);
  asked++;
}
for (const id of MOONS) {
  if (fixture.moons[id]) continue;
  const parent = BODIES[id].parent;
  fixture.moons[id] = { centre: parent, xyz: (await vectors(CODE[id], CODE[parent], DATES)).map((row) => row.pos.map((v) => round(v, 3))) };
  console.log(`  ${id}: ${fixture.moons[id].xyz.length} positions from ${parent}`);
  asked++;
}
for (const id of TURNING) {
  if (fixture.rotation[id] || fixture.unturned.includes(id)) continue;
  // Horizons either prints "n.a." or refuses outright for a body it has no rotation model for.
  const rotation = await rotationOf(id).catch((error) => (console.log(`    (${id}: ${error.message.slice(0, 90)})`), null));
  asked++;
  if (rotation) {
    fixture.rotation[id] = rotation;
    console.log(`  ${id}: turned as ${rotation.model} says (${rotation.westPositive ? 'west' : 'east'} longitude positive)`);
  } else {
    fixture.unturned.push(id);
    console.log(`  ${id}: Horizons has no rotation model for it`);
  }
}
if (asked > 0) {
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({
    source: 'JPL Horizons (ssd.jpl.nasa.gov), DE441 and the satellite ephemerides it names; ICRF, km. Made by scripts/make-deep-fixture.mjs.',
    madeAt: new Date().toISOString(),
    dates: DATES,
    planets: fixture.planets, // id → one [x, y, z] from the Sun's centre per date
    moons: fixture.moons, // id → { centre, xyz: one [x, y, z] from the planet's centre per date }
    rotation: fixture.rotation, // id → what an observer at the centre of `from` sees (see rotationOf() above)
    unturned: fixture.unturned, // bodies Horizons has no rotation model for
  }));
  console.log(`  wrote scripts/fixtures/deep-truth.json (${asked} new answers)`);
} else console.log('  nothing new to ask for');

if (process.argv.includes('--fit')) {
  console.log('\nThe orbits of the moons, fitted to sixty years of positions:');
  const lines = [];
  for (const id of MOONS) if (id !== 'moon') lines.push(await fitMoon(id));
  await writeFile(ORBITS, `${ORBITS_HEAD}${lines.join('\n')}\n};\n`);
  console.log('  wrote src/space/moonOrbits.ts');
}
