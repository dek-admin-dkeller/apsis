// Checks of the designer's orbital mechanics (src/data/orbitLab.ts) against known values, and of
// the collision course's solver: for real catalogue objects, the impactor's element set must put
// it, under SGP4, at the target's position at the moment of impact (ui/designer.ts, arm()).

import { readFileSync } from 'node:fs';
import { json2satrec, sgp4 } from 'satellite.js';
import {
  betaAngle, breakup, deltaVFromParking, j2Rates, lifetimeDays, recordFrom, rotateAbout, shadowFraction, stateToElements, sunSyncInclination, RE, MU,
} from '../src/data/orbitLab.ts';

let failed = false;
const check = (ok, what, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failed = true;
};
const near = (x, want, tol) => Math.abs(x - want) <= tol;

// ---- two-body round trip: a state → elements → the same orbit's numbers
{
  const r = { x: 6778, y: 0, z: 0 }, v = { x: 0, y: 7.6686 * Math.cos(51.6 * Math.PI / 180), z: 7.6686 * Math.sin(51.6 * Math.PI / 180) };
  const el = stateToElements(r, v);
  check(near(el.aKm, 6778, 5) && el.e < 0.001 && near(el.iDeg, 51.6, 0.01), 'state → elements (circular, 400 km, 51.6°)', `a ${el.aKm.toFixed(1)} km, e ${el.e.toFixed(5)}, i ${el.iDeg.toFixed(3)}°`);
}

// ---- J2 and sun-synchronous orbits (textbook values)
{
  const sso = sunSyncInclination(RE + 700, 0);
  check(sso !== null && near(sso, 98.19, 0.1), 'sun-synchronous tilt at 700 km ≈ 98.19°', sso?.toFixed(2));
  const iss = j2Rates(RE + 420, 0, 51.6);
  check(near(iss.nodeDegPerDay, -5.0, 0.15), 'the Station-like orbit’s plane turns ≈ −5.0° a day', iss.nodeDegPerDay.toFixed(2));
  check(sunSyncInclination(RE + 8000, 0) === null, 'no sun-synchronous tilt exists far above ~6,000 km');
}

// ---- shadow, delta-v, lifetime, break-up
{
  const f = shadowFraction(420, 0);
  check(near(f, 0.385, 0.01), 'a 420 km orbit with the Sun in its plane is in shadow ≈ 38 % of the time', f.toFixed(3));
  check(shadowFraction(420, 75) === 0, 'at a beta angle of 75° it never enters the shadow');
  const sun = { x: 0, y: 0, z: 1 };
  check(near(betaAngle(90, 0, sun), 0, 0.01) && near(betaAngle(0, 0, sun), 90, 0.01), 'beta angle: polar orbit edge-on to a pole Sun, equatorial face-on');
  const geo = deltaVFromParking(35786, 35786);
  check(near(geo, 3.89, 0.05), 'Δv from a 200 km parking orbit to geostationary (no plane change) ≈ 3.9 km/s', geo.toFixed(3));
  const low = lifetimeDays(250, 250), high = lifetimeDays(800, 800);
  check(low < 200 && high > 365 * 20, 'drag: a 250 km orbit lasts months, an 800 km one decades or more', `${low.toFixed(0)} days, ${Number.isFinite(high) ? (high / 365).toFixed(0) + ' years' : 'over a century'}`);
  const hit = breakup(500, 1000, 10);
  check(hit.catastrophic && near(hit.emr, 25000, 1) && hit.fragments10cm > 500, 'break-up: 500 kg into 1 t at 10 km/s is catastrophic', `EMR ${hit.emr.toFixed(0)} J/g, ${hit.fragments10cm} fragments ≥ 10 cm`);
  const tap = breakup(1, 400000, 0.01);
  check(!tap.catastrophic, 'a 1 kg tap at 10 m/s on a 400 t station is not');
}

// ---- the collision-course solver against real catalogue objects
{
  const objects = JSON.parse(readFileSync(new URL('../public/data/satellites.json', import.meta.url), 'utf8')).objects;
  const picks = [objects.find((o) => o.OBJECT_NAME === 'ISS (ZARYA)'), objects.find((o) => /COSMOS 2251 DEB/.test(o.OBJECT_NAME)), objects.find((o) => /^STARLINK/.test(o.OBJECT_NAME)), objects.find((o) => o.MEAN_MOTION < 1.1 && o.ECCENTRICITY < 0.01)].filter(Boolean);
  const stateAt = (record, tMs) => {
    const rec = json2satrec(record);
    const minutes = (tMs / 86400000 + 2440587.5 - rec.jdsatepoch) * 1440;
    const s = sgp4(rec, minutes);
    return s && s.position ? { r: s.position, v: s.velocity } : null;
  };
  const epochOf = (o) => Date.parse(`${o.EPOCH}Z`);
  let worst = 0, solved = 0, tried = 0;
  for (const target of picks) {
    for (const angle of [12, 90, 178]) {
      tried++;
      const impactMs = epochOf(target) + 3 * 3600000 + 20 * 60000;
      const t = stateAt(target, impactMs);
      const up = (() => { const l = Math.hypot(t.r.x, t.r.y, t.r.z); return { x: t.r.x / l, y: t.r.y / l, z: t.r.z / l }; })();
      const want = { r: t.r, v: rotateAbout(t.v, up, angle) };
      let r = { ...want.r }, v = { ...want.v };
      let record = recordFrom(stateToElements(r, v), impactMs, 'TEST', 99001, '2099-001A');
      let miss = Infinity;
      for (let k = 0; k < 8; k++) {
        const got = stateAt(record, impactMs);
        if (!got) break;
        const er = { x: want.r.x - got.r.x, y: want.r.y - got.r.y, z: want.r.z - got.r.z };
        const ev = { x: want.v.x - got.v.x, y: want.v.y - got.v.y, z: want.v.z - got.v.z };
        miss = Math.hypot(er.x, er.y, er.z);
        if (miss < 0.01) break;
        r = { x: r.x + er.x, y: r.y + er.y, z: r.z + er.z };
        v = { x: v.x + ev.x, y: v.y + ev.y, z: v.z + ev.z };
        record = recordFrom(stateToElements(r, v), impactMs, 'TEST', 99001, '2099-001A');
      }
      if (miss < 1) solved++;
      worst = Math.max(worst, miss);
    }
  }
  check(solved === tried, `collision course solved for ${tried} cases (the Station, debris, a Starlink, a geostationary satellite; catch-up, crossing, head-on)`, `worst miss under SGP4 ${(worst * 1000).toFixed(1)} m`);
  void MU;
}

console.log(failed ? '\norbit-lab checks FAILED' : '\nall orbit-lab checks passed');
process.exit(failed ? 1 : 0);
