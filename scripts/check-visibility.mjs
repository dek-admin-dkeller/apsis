// scripts/check-visibility.mjs — `node scripts/check-visibility.mjs`
//
// Sanity check for the geometry behind "Visible tonight" (src/data/visibility.ts), in Node,
// against things that are known independently:
//   1. the Sun's height at noon and at midnight for a known place and date;
//   2. for the ISS, every visible pass lies inside an ordinary above-the-horizon pass found by
//      findPasses() in src/data/ephemeris.ts (written earlier, by different code), happens
//      only while the observer is in darkness, and is sunlit and above 10° at every sample;
//   3. the brightness formula gives the well-known figure for the ISS overhead (about −4).
// Exits 1 if any check fails. Node 22.18+ imports the project's TypeScript files directly.

import { readFile } from 'node:fs/promises';
import { buildCatalog } from '../src/data/catalog.ts';
import { findPasses, lookAngles, makeSatrec } from '../src/data/ephemeris.ts';
import {
  DARK_SUN_DEG, MIN_ELEVATION_DEG, apparentMagnitude, dropCompanions, findVisiblePasses, makeSite, nightTable,
  pickCandidates, sightingAt, sunElevationDeg,
} from '../src/data/visibility.ts';

const snapshot = JSON.parse(await readFile(new URL('../public/data/satellites.json', import.meta.url), 'utf8'));
const satcat = JSON.parse(await readFile(new URL('../public/data/satcat.json', import.meta.url), 'utf8'));
const facts = new Map(satcat.rows.map(([id, type, status, owner, launchDate, launchSite, rcs]) => [id, { type, status, owner, launchDate, launchSite, rcs }]));
const catalog = buildCatalog(snapshot);

let failures = 0;
const check = (ok, text) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${text}`);
  if (!ok) failures++;
};
const stamp = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

// ---- 1. The Sun -------------------------------------------------------------------------
// Greenwich (51.48° N, 0°) on the June solstice: at local noon the Sun stands 90 − 51.48 + 23.44
// = 61.96° up; at local midnight it is 90 − 51.48 − 23.44 = 15.08° BELOW the horizon.
console.log('\n1. Height of the Sun (Greenwich, 21 June 2026)');
const greenwich = makeSite(51.48, 0);
const noon = sunElevationDeg(Date.UTC(2026, 5, 21, 12, 2), greenwich); // the Sun is 2 min late on that date
const midnight = sunElevationDeg(Date.UTC(2026, 5, 21, 0, 2), greenwich);
console.log(`  noon ${noon.toFixed(2)}°   midnight ${midnight.toFixed(2)}°`);
check(Math.abs(noon - 61.96) < 0.3, 'noon is within 0.3° of 61.96°');
check(Math.abs(midnight + 15.08) < 0.3, 'midnight is within 0.3° of −15.08°');
const quito = makeSite(-0.18, -78.47); // on the equator: at an equinox the noon Sun is overhead
const equinox = sunElevationDeg(Date.UTC(2026, 2, 20, 17, 21), quito);
console.log(`  Quito at local noon on the March equinox: ${equinox.toFixed(2)}°`);
check(equinox > 88.5, 'the equinox Sun is overhead on the equator');

// ---- 2. The ISS over a known place --------------------------------------------------------
const place = { name: 'High Point, NC', latDeg: 35.97, lonDeg: -79.99 }; // the app's default ground station
const site = makeSite(place.latDeg, place.lonDeg);
const fromMs = Date.parse(snapshot.fetchedAt); // fixed time → the same output on every run
const iss = catalog.byName.get('ISS (ZARYA)')?.[0];
if (!iss) throw new Error('The snapshot has no ISS (ZARYA)');
const rec = makeSatrec(iss);

// Seven days rather than one: the ISS has spells of a week or more with no evening or morning
// passes at a given place, and a check on an empty list would prove nothing.
const HOURS = 168;
console.log(`\n2. ISS from ${place.name}, ${HOURS} h from ${stamp(fromMs)} UTC`);
const night = nightTable(site, fromMs, HOURS);
const visible = findVisiblePasses(rec, site, night, -1.8);
const ordinary = findPasses(rec, place, fromMs - 3600e3, HOURS + 2, 1000);
console.log(`  ${ordinary.length} passes above the horizon (findPasses), ${visible.length} of them visible to the eye; ${(night.darkSteps * night.stepMs / 3.6e6).toFixed(1)} h of darkness`);
let inside = 0, dark = 0, sampled = 0, good = 0, agree = 0;
for (const pass of visible) {
  const parent = ordinary.find((p) => p.startMs <= pass.startMs && p.endMs >= pass.endMs);
  if (parent) inside++;
  const sunStart = sunElevationDeg(pass.startMs, site), sunEnd = sunElevationDeg(pass.endMs, site);
  if (sunStart <= DARK_SUN_DEG + 0.01 && sunEnd <= DARK_SUN_DEG + 0.01) dark++;
  for (let i = 0; i <= 10; i++) {
    const t = pass.startMs + ((pass.endMs - pass.startMs) * i) / 10;
    const s = sightingAt(rec, t, site);
    const look = lookAngles(rec, t, place); // the same direction from ephemeris.ts (satellite.js's own transform)
    sampled++;
    if (s && s.sunlit && s.elDeg >= MIN_ELEVATION_DEG - 0.05 && s.sunElDeg <= DARK_SUN_DEG + 0.01) good++;
    if (s && look && Math.abs(s.elDeg - look.elDeg) < 0.02 && Math.abs(s.rangeKm - look.rangeKm) < 0.5
      && Math.abs(((s.azDeg - look.azDeg + 540) % 360) - 180) < 0.05) agree++;
  }
  console.log(`  ${stamp(pass.startMs)} → ${stamp(pass.endMs).slice(11)}  ${String(Math.round((pass.endMs - pass.startMs) / 1000)).padStart(3)} s`
    + `  ${pass.startWhy.padEnd(8)} → ${pass.endWhy.padEnd(8)}  peak ${pass.peak.elDeg.toFixed(0).padStart(2)}° at az ${pass.peak.azDeg.toFixed(0).padStart(3)}°`
    + `  Sun ${sunStart.toFixed(1)}° / ${sunEnd.toFixed(1)}°  mag ${pass.magnitude.toFixed(1)}`
    + (parent ? `  (inside the pass peaking ${parent.peakElDeg.toFixed(0)}°)` : '  (NO PARENT PASS)'));
}
check(visible.length > 0, 'at least one visible pass in the week (otherwise the checks below are empty)');
check(inside === visible.length, `every visible pass lies inside a findPasses() pass (${inside}/${visible.length})`);
check(dark === visible.length, `every visible pass starts and ends with the Sun at least 6° down (${dark}/${visible.length})`);
check(good === sampled, `sunlit, ≥ 10° up and dark at every sampled moment (${good}/${sampled})`);
check(agree === sampled, `direction and distance agree with lookAngles() in ephemeris.ts (${agree}/${sampled})`);
// The other way round: an ordinary pass that is NOT listed must fail one of the three tests at its peak.
let explained = 0;
const unlisted = ordinary.filter((p) => !visible.some((v) => p.startMs <= v.startMs && p.endMs >= v.endMs));
for (const p of unlisted) {
  let seenFor = 0; // seconds of the pass that satisfy all three tests (allowed: under the 30 s minimum)
  for (let t = p.startMs; t <= p.endMs; t += 5000) if (sightingAt(rec, t, site)?.visible) seenFor += 5;
  if (seenFor < 40) explained++;
}
check(explained === unlisted.length, `no ordinary pass with a visible stretch was missed (${explained}/${unlisted.length} unlisted passes are rightly unlisted)`);

// ---- 3. Brightness ------------------------------------------------------------------------
console.log('\n3. Brightness estimate');
const overhead = apparentMagnitude(-1.8, 420, 80); // straight overhead soon after dusk
const hubble = apparentMagnitude(2.2, 600, 70);
console.log(`  ISS overhead (420 km away, phase angle 80°): magnitude ${overhead.toFixed(1)}   Hubble at 600 km: ${hubble.toFixed(1)}`);
check(overhead < -3.5 && overhead > -4.5, 'the ISS overhead comes out near −4 (as bright as Venus)');
check(apparentMagnitude(-1.8, 1000, 90) === -1.8, 'at 1,000 km and half lit the formula returns the standard magnitude itself');
check(apparentMagnitude(2, 500, 30) < apparentMagnitude(2, 500, 120), 'the same object is brighter when its lit face is toward the observer');

// ---- 4. The whole search, as the worker runs it -------------------------------------------
console.log(`\n4. Whole search: next 24 h from ${place.name}`);
const candidates = pickCandidates(catalog.sats, facts);
const night24 = nightTable(site, fromMs, 24);
const began = performance.now();
let all = [];
for (const c of candidates) for (const pass of findVisiblePasses(makeSatrec(c.sat), site, night24, c.standardMag)) all.push({ ...pass, name: c.sat.name });
const found = all.length;
all = dropCompanions(all.filter((p) => p.magnitude <= 6).sort((a, b) => a.magnitude - b.magnitude));
console.log(`  ${candidates.length} candidates of ${catalog.sats.length} objects, ${found} visible stretches, ${all.length} after the naked-eye limit and merging docked craft, ${(performance.now() - began).toFixed(0)} ms`);
for (const p of all.slice(0, 12)) {
  console.log(`  ${p.name.padEnd(26)} ${stamp(p.startMs)}  ${String(Math.round((p.endMs - p.startMs) / 1000)).padStart(3)} s  peak ${p.peak.elDeg.toFixed(0).padStart(2)}°  mag ${p.magnitude.toFixed(1)}`);
}
check(candidates.length > 3 && candidates.length <= 300, `the candidate list is capped (${candidates.length})`);
check(candidates.filter((c) => c.sat.name.startsWith('ISS')).length === 1, 'the ISS is searched once: not once per module, and not the small satellites released from it');
check(candidates.some((c) => c.sat.name === 'HST'), 'Hubble is always a candidate');

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
