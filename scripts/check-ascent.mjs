// Checks for the estimated launch climb (src/data/ascent.ts) — `npm run check` runs this.
//
// The climb is a model, so the check is of the model's promises, not of any real flight:
//   - the plane it flies in has the inclination it chose (the Station's 51.64° from Florida,
//     sun-synchronous 97.5° from Vandenberg flying south, due east = the pad's latitude);
//   - it starts on the pad (at the pad's longitude after the Earth's turn), reaches the
//     insertion height at engine cut-off and keeps it, and moves smoothly (no jumps);
//   - a launch without a pad position or a time to the minute is not drawn.
// Exits 1 on any failure.

import { ascentSpanS, ascentState, planAscent } from '../src/data/ascent.ts';

let failed = 0;
const ok = (pass, what, detail = '') => {
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${what}${detail ? `  — ${detail}` : ''}`);
  if (!pass) failed++;
};

const launch = (over) => ({
  id: 'x', mission: 'Test', rocket: 'Falcon 9 Block 5', provider: 'SpaceX', pad: '', place: '',
  latDeg: 28.5618, lonDeg: -80.577, netMs: Date.UTC(2026, 10, 20, 4, 32), precision: 'exact',
  state: 'go', status: 'go', orbit: 'LEO', family: 'Falcon', webcast: null, ...over,
});

/** Inclination of the plane through the pad position u and direction d (degrees). */
const inclinationOf = (a) => {
  const [u, d] = [a.u, a.d];
  const nz = u[0] * d[1] - u[1] * d[0];
  return (Math.acos(Math.max(-1, Math.min(1, nz))) * 180) / Math.PI;
};

for (const [name, over, want] of [
  ['ISS trip from Florida', { orbit: 'ISS', mission: 'Crew-13' }, 51.64],
  ['Progress from Baikonur', { orbit: 'LEO', mission: 'Progress MS-36 (97P)', latDeg: 45.996, lonDeg: 63.564, rocket: 'Soyuz 2.1a', family: 'Soyuz' }, 51.64],
  ['SSO from Vandenberg', { orbit: 'SSO', latDeg: 34.632, lonDeg: -120.611 }, 97.5],
  ['GTO from Florida (due east)', { orbit: 'GTO' }, 28.5618],
  ['Starlink from Florida', { orbit: 'LEO', mission: 'Starlink Group 10-5' }, 43],
]) {
  const a = planAscent(launch(over));
  const got = a ? inclinationOf(a) : NaN;
  ok(a !== null && Math.abs(got - want) < 0.05, `${name}: flies at ${want}°`, `got ${got.toFixed(3)}°, azimuth ${a?.azimuthDeg.toFixed(1)}°`);
}

const a = planAscent(launch({ orbit: 'LEO' }));
const sv = planAscent(launch({ orbit: 'SSO', latDeg: 34.632, lonDeg: -120.611 }));
ok(sv !== null && sv.azimuthDeg > 180 && sv.azimuthDeg < 200, 'Vandenberg flies south (azimuth 180–200°)', `${sv?.azimuthDeg.toFixed(1)}°`);

// On the pad before lift-off: the pad turns with the Earth, so ten minutes early it is 2.5° west in the inertial frame.
const r = (p) => Math.hypot(...p);
const pad0 = ascentState(a, a.liftoffMs).pos, padEarly = ascentState(a, a.liftoffMs - 600000).pos;
const turn = (Math.acos((pad0[0] * padEarly[0] + pad0[1] * padEarly[1] + pad0[2] * padEarly[2]) / (r(pad0) * r(padEarly))) * 180) / Math.PI;
const expected = 2.507 * Math.cos((28.5618 * Math.PI) / 180); // 10 min of the Earth's turn, seen at the pad's latitude
ok(Math.abs(r(pad0) - 6371) < 1e-6 && Math.abs(turn - expected) < 0.005, 'on the pad, turning with the Earth until lift-off', `${turn.toFixed(3)}° in 10 min (expected ${expected.toFixed(3)}°)`);

const cut = ascentState(a, a.liftoffMs + a.burnS * 1000);
ok(Math.abs(cut.altKm - a.insertionKm) < 1e-6 && !cut.burning, 'engine off at the insertion height', `${cut.altKm.toFixed(1)} km at T+${a.burnS} s`);
const later = ascentState(a, a.liftoffMs + (a.burnS + 3000) * 1000);
ok(Math.abs(later.altKm - a.insertionKm) < 1e-6, 'then a circular orbit at that height');

// Smooth: no step between consecutive seconds larger than the speed allows (plus a little).
let worst = 0;
for (let t = -5; t < ascentSpanS(a); t += 1) {
  const p = ascentState(a, a.liftoffMs + t * 1000).pos, q = ascentState(a, a.liftoffMs + (t + 1) * 1000).pos;
  const step = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
  worst = Math.max(worst, step);
}
ok(worst < 7.8, 'moves smoothly (no one-second step faster than the orbit itself)', `${worst.toFixed(2)} km`);

ok(planAscent(launch({ latDeg: null, lonDeg: null })) === null, 'no pad position: not drawn');
ok(planAscent(launch({ precision: 'hour' })) === null, 'time only to the hour: not drawn');

console.log(failed ? `\n${failed} ascent check(s) failed.` : '\nAll ascent checks passed.');
process.exit(failed ? 1 : 0);
