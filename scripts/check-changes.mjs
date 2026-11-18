// scripts/check-changes.mjs — `npm run check-changes`
//
// The test for src/data/changes.ts (orbit changes between two downloads). It feeds the
// comparison SYNTHETIC element records whose right answer is known and prints pass / fail for
// each; it exits 1 if anything fails. Nothing here is real data and nothing is written to disk.
//
// The cases are the ones the thresholds were designed around: a small raise high up must be
// found, the same-sized natural sinking low down must not, a record that was not measured
// again must be ignored, and so on. Node 22.18+ imports the TypeScript file directly.

import { readFile } from 'node:fs/promises';
import { compareElements, judgePair, naturalRates, NOISE_FRACTION } from '../src/data/changes.ts';

const MU = 398600.4418, EARTH_RADIUS_KM = 6378.137;
const T0 = Date.parse('2026-11-17T00:00:00Z');
const HOUR = 3.6e6;

/** Mean motion (rev/day) of a circular orbit `altKm` up. */
const meanMotion = (altKm) => (Math.sqrt(MU / (EARTH_RADIUS_KM + altKm) ** 3) * 86400) / (2 * Math.PI);
/** MEAN_MOTION_DOT (half of dn/dt, rev/day²) for an orbit sinking `kmPerDay`. */
const dotFor = (altKm, kmPerDay) => (kmPerDay * 3 * meanMotion(altKm)) / (4 * (EARTH_RADIUS_KM + altKm));
/** CelesTrak's epoch format: UTC, microseconds, no "Z". */
const epoch = (ms) => new Date(ms).toISOString().replace('Z', '000');

let nextId = 70001;
/** One synthetic record. `sinkKmPerDay` is the natural decay written into its drag term. */
function record({ id = nextId++, name = `TEST ${id}`, altKm, hours = 0, e = 0.0002, inc = 53, sinkKmPerDay = 0, bstar = 0, group = 'active' }) {
  return {
    GROUP: group, OBJECT_NAME: name, OBJECT_ID: '2026-001A', NORAD_CAT_ID: id, EPOCH: epoch(T0 + hours * HOUR),
    MEAN_MOTION: meanMotion(altKm), ECCENTRICITY: e, INCLINATION: inc, RA_OF_ASC_NODE: 10, ARG_OF_PERICENTER: 20,
    MEAN_ANOMALY: 30, BSTAR: bstar, MEAN_MOTION_DOT: dotFor(altKm, sinkKmPerDay), MEAN_MOTION_DDOT: 0,
  };
}
/** The same object some hours later, moved by `km` (and tilted by `dInc`). */
const later = (rec, hours, km, dInc = 0, extra = {}) => ({
  ...rec, ...extra, EPOCH: epoch(Date.parse(rec.EPOCH + 'Z') + hours * HOUR),
  MEAN_MOTION: meanMotion((MU / ((rec.MEAN_MOTION * 2 * Math.PI) / 86400) ** 2) ** (1 / 3) - EARTH_RADIUS_KM + km),
  INCLINATION: rec.INCLINATION + dInc,
});

let failed = 0;
function check(title, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${title}${detail ? `  (${detail})` : ''}`);
}
const kindOf = (prev, next) => judgePair(prev, next)?.kind ?? 'nothing';
const show = (prev, next) => {
  const c = judgePair(prev, next);
  return c ? `${c.kind} ${c.deltaKm.toFixed(2)} km, allowance ${c.allowanceKm.toFixed(2)} km, forecast ${c.expectedKm.toFixed(2)} km` : 'nothing reported';
};

console.log('\nOrbit changes: synthetic cases (none of this is real data)\n');

// ---- 1. the cases the brief names ---------------------------------------------------------
{
  const sat = record({ altKm: 550, sinkKmPerDay: 0.03 });
  const after = later(sat, 8, +2);
  check('2 km raise at 550 km over 8 hours is a raise', kindOf(sat, after) === 'raised', show(sat, after));
}
{
  // 0.9 km/day is what the real catalogue shows around 300 km. Over 8 hours that is 0.3 km:
  // MORE than the 0.27 km noise floor, so only the drag forecast keeps this from being flagged.
  const sat = record({ altKm: 300, sinkKmPerDay: 0.9 });
  const sunk = 0.9 * (8 / 24);
  check('pure drag at 300 km (sinks exactly as forecast) is not reported', kindOf(sat, later(sat, 8, -sunk)) === 'nothing', `sank ${sunk.toFixed(2)} km, noise floor alone ${(NOISE_FRACTION * (EARTH_RADIUS_KM + 300)).toFixed(2)} km`);
  check('twice the forecast drag at 300 km (a solar storm) is still not reported', kindOf(sat, later(sat, 8, -2 * sunk)) === 'nothing');
  const dropped = later(sat, 8, -4);
  check('a 4 km drop at 300 km in 8 hours is a lowering', kindOf(sat, dropped) === 'lowered', show(sat, dropped));
}
{
  const sat = record({ altKm: 550 });
  const same = { ...later(sat, 0, +5) }; // a different orbit but the SAME epoch: not a new measurement
  check('identical epochs are ignored even if the numbers differ', judgePair(sat, same) === null);
  check('an epoch that went backwards is ignored', judgePair(later(sat, 8, 0), sat) === null);
}

// ---- 2. the same rules elsewhere ------------------------------------------------------------
{
  const iss = record({ name: 'ISS (ZARYA)', altKm: 418, inc: 51.64, sinkKmPerDay: 0.056 });
  check('ISS reboost of 1.5 km is a raise', kindOf(iss, later(iss, 12, +1.5)) === 'raised', show(iss, later(iss, 12, +1.5)));
  check('ISS sinking 30 m in 12 hours is not reported', kindOf(iss, later(iss, 12, -0.03)) === 'nothing');
}
{
  const sat = record({ altKm: 550, sinkKmPerDay: 0.03 });
  check('0.1 km of jitter at 550 km is not reported', kindOf(sat, later(sat, 8, +0.1)) === 'nothing' && kindOf(sat, later(sat, 8, -0.1)) === 'nothing');
  check('a 3 km lowering at 550 km is a lowering', kindOf(sat, later(sat, 8, -3)) === 'lowered');
  check('a 0.1° change of tilt alone is a plane change', kindOf(sat, later(sat, 8, 0, 0.1)) === 'plane');
  check('a 0.005° wobble of tilt is not reported', kindOf(sat, later(sat, 8, 0, 0.005)) === 'nothing');
}
{
  // A Starlink climbing on its ion engine: the fit absorbs the thrust as NEGATIVE drag.
  const climbing = record({ name: 'STARLINK-TEST', altKm: 360, sinkKmPerDay: -1.7, bstar: -0.0008 });
  const rates = naturalRates(climbing);
  check('a record that says "rising" in low orbit earns no allowance for rising', rates.riseKmPerDay === 0 && rates.sinkKmPerDay === 0);
  check('a Starlink still climbing 0.6 km in 8 hours is a raise', kindOf(climbing, later(climbing, 8, +0.6)) === 'raised');
}
{
  const dying = record({ altKm: 195, sinkKmPerDay: 18 });
  check('an object in its last days, falling 6 km in 8 hours as forecast, is not reported', kindOf(dying, later(dying, 8, -6)) === 'nothing');
  check('...nor is a 0.5 km upward wobble in its poor fits', kindOf(dying, later(dying, 1, +0.5)) === 'nothing');
}
{
  const geo = record({ name: 'GEO TEST', altKm: 35786, inc: 0.05, e: 0.0003 });
  check('0.5 km of drift at geostationary height is not reported', kindOf(geo, later(geo, 8, +0.5)) === 'nothing' && kindOf(geo, later(geo, 8, -0.5)) === 'nothing');
  check('a 10 km change at geostationary height is a raise', kindOf(geo, later(geo, 8, +10)) === 'raised', show(geo, later(geo, 8, +10)));
  const molniya = record({ name: 'MOLNIYA TEST', altKm: 20180, e: 0.72, inc: 63.4 });
  check('3 km of jitter on a very eccentric orbit is not reported', kindOf(molniya, later(molniya, 24, +3)) === 'nothing');
}
{
  const debris = record({ name: 'FENGYUN 1C DEB', altKm: 800, group: 'fengyun-1c-debris' });
  check('debris that seems to jump 3 km is not called a manoeuvre', judgePair(debris, later(debris, 8, +3)) === null);
  const stage = record({ name: 'FALCON 9 R/B', altKm: 500 });
  check('nor is a rocket body', judgePair(stage, later(stage, 8, +3)) === null);
}
{
  // The drag forecast from BSTAR alone (MEAN_MOTION_DOT missing) must land near the real thing:
  // the ISS's published BSTAR of about 1.8e-4 goes with a decay of about 0.06 km/day.
  const iss = record({ altKm: 418, bstar: 0.00017759895 });
  const rate = naturalRates(iss).sinkKmPerDay;
  check('BSTAR alone forecasts the ISS sinking about 0.06 km/day', rate > 0.04 && rate < 0.08, `${rate.toFixed(3)} km/day`);
}

// ---- 3. whole downloads: new, gone, counts and the cap --------------------------------------
{
  const stay = record({ altKm: 550 }), raise = record({ altKm: 540 }), leave = record({ altKm: 210 });
  const arrive = record({ altKm: 300, hours: 6 });
  const debris = record({ name: 'COSMOS 2251 DEB', altKm: 780, group: 'cosmos-2251-debris' });
  const previous = { fetchedAt: epoch(T0) + 'Z', objects: [stay, raise, leave, debris] };
  // The later download failed to fetch the debris group, so the debris record is simply absent.
  const next = { fetchedAt: epoch(T0 + 8 * HOUR) + 'Z', objects: [stay, later(raise, 8, +2), arrive] };
  const report = compareElements(previous, next);
  const kinds = Object.fromEntries(report.changes.map((c) => [c.noradId, c.kind]));
  check('a new object is reported as new', kinds[arrive.NORAD_CAT_ID] === 'new' && report.counts.new === 1);
  check('a missing object is reported as gone', kinds[leave.NORAD_CAT_ID] === 'gone' && report.counts.gone === 1);
  check('an object whose whole group was not downloaded is NOT reported as gone', kinds[debris.NORAD_CAT_ID] === undefined);
  check('the raise is found among the others', kinds[raise.NORAD_CAT_ID] === 'raised' && report.counts.raised === 1);
  check('unchanged epochs are counted, not compared', report.unchanged === 1 && report.compared === 1);
  check('both download times are carried in the report', report.from === previous.fetchedAt && report.to === next.fetchedAt);
}
{
  const objects = Array.from({ length: 400 }, () => record({ altKm: 550 }));
  const previous = { fetchedAt: epoch(T0) + 'Z', objects };
  const next = { fetchedAt: epoch(T0 + 8 * HOUR) + 'Z', objects: objects.map((rec, i) => later(rec, 8, 1 + i * 0.01)) }; // raises of 1.00 … 4.99 km
  const report = compareElements(previous, next, { manoeuvres: 50, arrivals: 10, departures: 10 });
  const smallestKept = Math.min(...report.changes.map((c) => c.deltaKm));
  check('the list is capped, the count is not', report.changes.length === 50 && report.counts.raised === 400);
  check('the cap keeps the largest', smallestKept > 4.49, `smallest kept ${smallestKept.toFixed(2)} km`);
}

// ---- 4. the bundled snapshot against itself, then against a doctored copy --------------------
try {
  const snapshot = JSON.parse(await readFile(new URL('../public/data/satellites.json', import.meta.url), 'utf8'));
  const self = compareElements(snapshot, snapshot);
  check(`the bundled snapshot (${snapshot.objects.length} objects) against itself reports nothing`, self.changes.length === 0 && self.compared === 0);
  // Move 25 payloads up 5 km with a later epoch, in a copy that lives only in memory.
  const payloads = snapshot.objects.filter((rec) => rec.GROUP === 'active' && rec.MEAN_MOTION > 11 && !/DEB|R\/B/.test(rec.OBJECT_NAME)).slice(100, 125);
  const moved = new Map(payloads.map((rec) => [rec.NORAD_CAT_ID, later(rec, 8, +5)]));
  const doctored = { fetchedAt: new Date(Date.parse(snapshot.fetchedAt) + 8 * HOUR).toISOString(), objects: snapshot.objects.map((rec) => moved.get(rec.NORAD_CAT_ID) ?? rec) };
  const t0 = performance.now();
  const report = compareElements(snapshot, doctored);
  const ms = performance.now() - t0;
  check('exactly the 25 doctored objects are found in the full catalogue', report.counts.raised === 25 && report.changes.length === 25 && report.changes.every((c) => moved.has(c.noradId)), `${ms.toFixed(1)} ms for ${snapshot.objects.length} objects`);
} catch (error) {
  console.log(`skip  bundled snapshot checks (${error.message})`);
}

console.log(failed ? `\n${failed} check(s) FAILED\n` : '\nAll checks passed\n');
process.exitCode = failed ? 1 : 0;
