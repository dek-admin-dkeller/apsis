/**
 * Sanity check for the rough re-entry estimates (src/data/decay.ts). Run with
 *     node scripts/decay-check.mjs
 * It prints what the estimator says for a few known situations and exits 1 if any of them
 * lands outside a deliberately wide band. The bands are wide because the method is rough:
 * the point is to catch a broken formula (weeks where there should be years), not to grade
 * the last 30 %.
 *
 *   A  element values typical of real published sets (station, a failing satellite at 200 km,
 *      debris at 800 km)
 *   B  the textbook ladder: an object of ordinary dragginess (0.01 m²/kg) lasts about days at
 *      200 km, a month at 300, a year at 400, decades to centuries above 600
 *   C  inputs that must give no estimate at all
 *   D  the wording, and the effect of an unusual day on the Sun
 *   E  (printed only) the seven lowest objects in the bundled catalogue
 */

import { existsSync, readFileSync } from 'node:fs';
import { airDensity, DECAY_HORIZON_DAYS, decayLabel, decayRange, estimateDecayDays } from '../src/data/decay.ts';

const MU = 398600.4418, EARTH_RADIUS_KM = 6371;
let failures = 0;

/** A minimal element record: mean height (km), eccentricity, MEAN_MOTION_DOT (rev/day², the halved value as published). */
function record(name, meanAltKm, eccentricity, meanMotionDot, bstar = 0.0003, epoch = '2026-11-16T12:00:00') {
  const a = EARTH_RADIUS_KM + meanAltKm;
  const meanMotion = (Math.sqrt(MU / a ** 3) * 86400) / (2 * Math.PI);
  return { OBJECT_NAME: name, EPOCH: epoch, MEAN_MOTION: meanMotion, ECCENTRICITY: eccentricity, MEAN_MOTION_DOT: meanMotionDot, BSTAR: bstar };
}

/** The MEAN_MOTION_DOT a tracking fit would report for a coasting object of this dragginess (m²/kg) in the table's air. */
function dotFor(meanAltKm, areaToMass) {
  const a = EARTH_RADIUS_KM + meanAltKm;
  const sinkKmPerDay = areaToMass * airDensity(meanAltKm) * 1000 * Math.sqrt(MU * a) * 86400;
  const n = (Math.sqrt(MU / a ** 3) * 86400) / (2 * Math.PI);
  return (sinkKmPerDay * 3 * n) / (2 * a) / 2;
}

const span = (days) => (days === null ? 'no estimate' : days >= DECAY_HORIZON_DAYS ? '100+ years' : days < 60 ? `${days.toFixed(1)} days` : days < 730 ? `${(days / 30.44).toFixed(1)} months` : `${(days / 365.25).toFixed(1)} years`);

function expect(what, omm, minDays, maxDays, options) {
  const days = estimateDecayDays(omm, options);
  const ok = minDays === null ? days === null : days !== null && days >= minDays && days <= maxDays;
  if (!ok) failures++;
  const shown = days === null ? '(nothing shown)' : `"${decayLabel(days)}"`;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what.padEnd(58)} ${span(days).padStart(13)}  ${shown}`);
  return days;
}

console.log('A  typical published element values');
expect('ISS-like: 420 km, half-rate 0.00010 rev/day²', record('STATION', 420, 0.0005, 0.0001), 200, 1100);
expect('ISS-like on a quiet Sun: half-rate 0.00006', record('STATION', 420, 0.0005, 0.00006), 365, 1900);
expect('failing satellite: 200 km, half-rate 0.022', record('LOW', 200, 0.0006, 0.022), 0.5, 6);
expect('spent rocket stage: 185 × 390 km, half-rate 0.0068', record('STAGE', 287.5, 0.0154, 0.0068), 5, 45);
expect('debris at 800 km, half-rate 0.0000008', record('DEBRIS', 800, 0.002, 8e-7), 20 * 365.25, Infinity);

console.log('\nB  ordinary dragginess (0.01 m²/kg) against the textbook ladder');
expect('200 km: days', record('L200', 200, 0.0005, dotFor(200, 0.01)), 1, 8);
expect('300 km: about a month', record('L300', 300, 0.0005, dotFor(300, 0.01)), 15, 90);
expect('400 km: about a year', record('L400', 400, 0.0005, dotFor(400, 0.01)), 120, 730);
expect('500 km: several years', record('L500', 500, 0.0005, dotFor(500, 0.01)), 2 * 365.25, 20 * 365.25);
expect('600 km: decades', record('L600', 600, 0.0005, dotFor(600, 0.01)), 10 * 365.25, Infinity);
expect('800 km: centuries (shown as "many years")', record('L800', 800, 0.0005, dotFor(800, 0.01)), 50 * 365.25, Infinity);

console.log('\nC  inputs that must give nothing');
expect('orbit being raised (rate negative)', record('RAISING', 350, 0.0005, -0.0002), null);
expect('rate exactly zero', record('STEADY', 500, 0.0005, 0), null);
expect('negative BSTAR', record('ODD', 350, 0.0005, 0.0002, -0.0001), null);
expect('holding 275 km with thrusters (half-rate 0.00005)', record('HOLDING', 275, 0.0009, 0.00005), null);
expect('very stretched orbit (e = 0.7)', record('STRETCHED', 17000, 0.7, 0.0001), null);
expect('elements 45 days old', record('STALE', 300, 0.0005, dotFor(300, 0.01)), null, null, { nowMs: Date.parse('2026-12-31T12:00:00Z') });

console.log('\nD  wording and weather');
const words = [0, 0.5, 1.5, 4, 7, 14, 21, 30, 60, 90, 120, 180, 270, 365, 700, 1500, 5000, DECAY_HORIZON_DAYS];
console.log('   ' + words.map((d) => `${d} d → ${decayLabel(d)}`).join('; '));
console.log(`   tooltip for 21 days: ${decayRange(21)}; for 40 years: ${decayRange(40 * 365.25)}`);
const labels = words.map(decayLabel);
if (new Set(labels).size < 15) {
  failures++;
  console.log('FAIL the wording has collapsed: too few different phrases');
}
const station = record('STATION', 420, 0.0005, 0.0001);
const plain = estimateDecayDays(station);
const average = estimateDecayDays(station, { weather: { fluxNow: 150, fluxMean: 150 } });
const brightDay = estimateDecayDays(station, { weather: { fluxNow: 220, fluxMean: 150 } });
const dimDay = estimateDecayDays(station, { weather: { fluxNow: 100, fluxMean: 150 } });
console.log(`   station, no weather ${span(plain)}; average day ${span(average)}; unusually bright day ${span(brightDay)}; unusually dim day ${span(dimDay)}`);
// An average day should change nothing (to within the step size). A bright day inflates the
// measured rate, so the outlook should lengthen (and the reverse), by less than about 2.5 times.
if (!(Math.abs(average - plain) < 0.02 * plain && brightDay > average && brightDay < 2.5 * average && dimDay < average && dimDay > average / 2.5)) {
  failures++;
  console.log('FAIL the weather adjustment is the wrong way round or too strong');
}
const aged = estimateDecayDays(record('LOW', 200, 0.0006, 0.022), { nowMs: Date.parse('2026-11-26T12:00:00Z') });
console.log(`   failing satellite, elements 10 days old: ${span(aged)} "${decayLabel(aged ?? NaN)}"`);
if (aged !== 0) failures++;

const catalogueFile = new URL('../public/data/satellites.json', import.meta.url);
if (existsSync(catalogueFile)) {
  console.log('\nE  the seven lowest orbits in the bundled catalogue (not checked, for a look)');
  const snapshot = JSON.parse(readFileSync(catalogueFile, 'utf8'));
  const nowMs = Date.parse(snapshot.fetchedAt);
  const lowest = snapshot.objects
    .map((omm) => {
      const n = (omm.MEAN_MOTION * 2 * Math.PI) / 86400;
      const a = Math.cbrt(MU / (n * n));
      return { omm, perigee: a * (1 - omm.ECCENTRICITY) - EARTH_RADIUS_KM, apogee: a * (1 + omm.ECCENTRICITY) - EARTH_RADIUS_KM };
    })
    .filter((entry) => entry.perigee > 120 && entry.perigee < 2000)
    .sort((x, y) => x.perigee - y.perigee)
    .slice(0, 7);
  for (const { omm, perigee, apogee } of lowest) {
    const days = estimateDecayDays(omm, { nowMs });
    console.log(`   ${omm.OBJECT_NAME.padEnd(22)} ${perigee.toFixed(0).padStart(4)} × ${apogee.toFixed(0).padStart(5)} km  half-rate ${String(omm.MEAN_MOTION_DOT).padEnd(11)} ${span(days).padStart(12)}  ${days === null ? '' : `"${decayLabel(days)}"`}`);
  }
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
