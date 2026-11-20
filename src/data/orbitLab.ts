/**
 * The orbital mechanics behind the designer (ui/designer.ts): plain two-body formulas plus the
 * Earth's oblateness (J2), atmospheric drag, and NASA's standard break-up model. No DOM, no
 * three.js: scripts/check-orbitlab.mjs tests it in Node.
 *
 * Frames: the inertial frame SGP4 uses (TEME, ≈ ECI), kilometres and km/s; angles in degrees
 * at the edges, radians inside.
 *
 * Sources for the constants and formulas:
 *   - WGS-72 μ and equatorial radius (what SGP4 itself uses);
 *   - J2 secular rates of the node and perigee (Vallado, Fundamentals of Astrodynamics, §9.6);
 *   - sun-synchronous condition: the node turns 360° per tropical year (0.9856°/day);
 *   - eclipse fraction of a circular orbit from the beta angle (cylindrical shadow);
 *   - NASA Standard Breakup Model (Johnson et al., 2001): a collision is catastrophic when the
 *     projectile's kinetic energy per gram of target exceeds 40 J/g; the number of fragments
 *     larger than Lc metres is N = 0.1 · M^0.75 · Lc^−1.6.
 */

import type { OmmRecord } from './types.ts';
import { airDensity } from './decay.ts';

export const MU = 398600.8; // km³/s², WGS-72 (SGP4's)
export const RE = 6378.135; // km, WGS-72 equatorial radius
export const J2 = 1.082616e-3;
const DEG = Math.PI / 180;
const SIDEREAL_YEAR_NODE = 0.98564736; // °/day: what a sun-synchronous node must turn

export interface V3 { x: number; y: number; z: number }

/** Classical elements (degrees for angles). */
export interface Elements {
  aKm: number;
  e: number;
  iDeg: number;
  raanDeg: number;
  argpDeg: number;
  /** Mean anomaly at the epoch. */
  meanAnomalyDeg: number;
}

const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const len = (a: V3) => Math.hypot(a.x, a.y, a.z);
const wrap360 = (deg: number) => ((deg % 360) + 360) % 360;

/** Position and velocity → classical elements (two-body; the osculating orbit at that moment). */
export function stateToElements(r: V3, v: V3): Elements {
  const rr = len(r), vv = len(v);
  const h = cross(r, v), hh = len(h);
  const node = { x: -h.y, y: h.x, z: 0 }, nn = len(node);
  const ev = { x: ((vv * vv - MU / rr) * r.x - dot(r, v) * v.x) / MU, y: ((vv * vv - MU / rr) * r.y - dot(r, v) * v.y) / MU, z: ((vv * vv - MU / rr) * r.z - dot(r, v) * v.z) / MU };
  const e = len(ev);
  const energy = (vv * vv) / 2 - MU / rr;
  const aKm = -MU / (2 * energy);
  const iDeg = Math.acos(Math.max(-1, Math.min(1, h.z / hh))) / DEG;
  let raanDeg = nn > 1e-9 ? Math.acos(Math.max(-1, Math.min(1, node.x / nn))) / DEG : 0;
  if (node.y < 0) raanDeg = 360 - raanDeg;
  // Argument of perigee and true anomaly; a circular or equatorial orbit has no defined perigee
  // or node, so the angle is measured from what is defined (the node, or the x axis).
  let argpDeg = 0, nuDeg: number;
  if (e > 1e-7) {
    if (nn > 1e-9) {
      argpDeg = Math.acos(Math.max(-1, Math.min(1, dot(node, ev) / (nn * e)))) / DEG;
      if (ev.z < 0) argpDeg = 360 - argpDeg;
    } else {
      argpDeg = wrap360(Math.atan2(ev.y, ev.x) / DEG);
    }
    nuDeg = Math.acos(Math.max(-1, Math.min(1, dot(ev, r) / (e * rr)))) / DEG;
    if (dot(r, v) < 0) nuDeg = 360 - nuDeg;
  } else if (nn > 1e-9) {
    nuDeg = Math.acos(Math.max(-1, Math.min(1, dot(node, r) / (nn * rr)))) / DEG; // argument of latitude
    if (r.z < 0) nuDeg = 360 - nuDeg;
  } else {
    nuDeg = wrap360(Math.atan2(r.y, r.x) / DEG);
  }
  // True → eccentric → mean anomaly.
  const nu = nuDeg * DEG;
  const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
  const M = E - e * Math.sin(E);
  return { aKm, e, iDeg, raanDeg: wrap360(raanDeg), argpDeg: wrap360(argpDeg), meanAnomalyDeg: wrap360(M / DEG) };
}

/** Points round a whole orbit (ECI km), for drawing it: `count` steps of true anomaly. */
export function orbitPoints(el: Elements, count = 180): Float32Array {
  const out = new Float32Array(count * 3);
  const p = el.aKm * (1 - el.e * el.e);
  const [cO, sO, ci, si, cw, sw] = [Math.cos(el.raanDeg * DEG), Math.sin(el.raanDeg * DEG), Math.cos(el.iDeg * DEG), Math.sin(el.iDeg * DEG), Math.cos(el.argpDeg * DEG), Math.sin(el.argpDeg * DEG)];
  for (let k = 0; k < count; k++) {
    const nu = (k / count) * 2 * Math.PI;
    const r = p / (1 + el.e * Math.cos(nu));
    const xp = r * Math.cos(nu), yp = r * Math.sin(nu); // in the orbit's own plane, x towards perigee
    out[k * 3] = (cO * cw - sO * sw * ci) * xp + (-cO * sw - sO * cw * ci) * yp;
    out[k * 3 + 1] = (sO * cw + cO * sw * ci) * xp + (-sO * sw + cO * cw * ci) * yp;
    out[k * 3 + 2] = sw * si * xp + cw * si * yp;
  }
  return out;
}

/** An element set as a CelesTrak-style OMM record (no drag), epoch `epochMs`. */
export function recordFrom(el: Elements, epochMs: number, name: string, norad: number, intlDes: string): OmmRecord {
  const nRadS = Math.sqrt(MU / (el.aKm * el.aKm * el.aKm));
  return {
    OBJECT_NAME: name,
    OBJECT_ID: intlDes,
    NORAD_CAT_ID: norad,
    EPOCH: new Date(epochMs).toISOString().slice(0, -1) + '000', // UTC, no "Z", as CelesTrak writes it
    MEAN_MOTION: (nRadS * 86400) / (2 * Math.PI),
    ECCENTRICITY: Math.min(0.95, Math.max(0, el.e)),
    INCLINATION: el.iDeg,
    RA_OF_ASC_NODE: el.raanDeg,
    ARG_OF_PERICENTER: el.argpDeg,
    MEAN_ANOMALY: el.meanAnomalyDeg,
    BSTAR: 0,
    MEAN_MOTION_DOT: 0,
    MEAN_MOTION_DDOT: 0,
    GROUP: 'custom',
  };
}

// ---- what the Earth's bulge does to an orbit ---------------------------------------------------

/** Secular drift of the node and of the perigee caused by J2, degrees per day. */
export function j2Rates(aKm: number, e: number, iDeg: number): { nodeDegPerDay: number; perigeeDegPerDay: number } {
  const n = Math.sqrt(MU / (aKm * aKm * aKm)); // rad/s
  const p = aKm * (1 - e * e);
  const k = 1.5 * n * J2 * (RE / p) ** 2 * 86400 / DEG; // °/day
  const ci = Math.cos(iDeg * DEG);
  return { nodeDegPerDay: -k * ci, perigeeDegPerDay: (k / 2) * (5 * ci * ci - 1) };
}

/** The inclination that makes the node keep pace with the Sun (sun-synchronous), or null if no tilt can (above ~6,000 km). */
export function sunSyncInclination(aKm: number, e: number): number | null {
  const n = Math.sqrt(MU / (aKm * aKm * aKm));
  const p = aKm * (1 - e * e);
  const k = 1.5 * n * J2 * (RE / p) ** 2 * 86400 / DEG;
  const ci = -SIDEREAL_YEAR_NODE / k;
  return Math.abs(ci) <= 1 ? Math.acos(ci) / DEG : null;
}

// ---- sunlight ----------------------------------------------------------------------------------

/** The beta angle: how far the Sun is out of the orbit's plane, degrees (`sun`: unit vector). */
export function betaAngle(iDeg: number, raanDeg: number, sun: V3): number {
  const normal = { x: Math.sin(raanDeg * DEG) * Math.sin(iDeg * DEG), y: -Math.cos(raanDeg * DEG) * Math.sin(iDeg * DEG), z: Math.cos(iDeg * DEG) };
  return Math.asin(Math.max(-1, Math.min(1, dot(normal, sun)))) / DEG;
}

/** Share of a circular orbit at `altKm` spent in the Earth's shadow, at beta angle `betaDeg`. */
export function shadowFraction(altKm: number, betaDeg: number): number {
  const r = RE + altKm;
  const beta = Math.abs(betaDeg) * DEG;
  const limit = Math.asin(RE / r); // beyond this beta the orbit never enters the shadow
  if (beta >= limit) return 0;
  const x = Math.sqrt(altKm * altKm + 2 * RE * altKm) / (r * Math.cos(beta));
  return Math.acos(Math.min(1, x)) / Math.PI;
}

// ---- getting there -----------------------------------------------------------------------------

/**
 * Velocity change to reach the orbit from a 200 km circular parking orbit at the same tilt, km/s:
 * one burn to raise the far point to the target apogee, one there to lift the near point (the
 * two-burn Hohmann pattern; no change of plane).
 */
export function deltaVFromParking(perigeeKm: number, apogeeKm: number): number {
  const r0 = RE + 200, rp = RE + perigeeKm, ra = RE + apogeeKm;
  const vis = (r: number, a: number) => Math.sqrt(MU * (2 / r - 1 / a));
  const transfer = (r0 + ra) / 2;
  const first = Math.abs(vis(r0, transfer) - Math.sqrt(MU / r0));
  const second = Math.abs(vis(ra, (rp + ra) / 2) - vis(ra, transfer));
  return first + second;
}

/**
 * How long drag takes to bring the orbit down to 150 km, days (capped at 100 years: Infinity
 * beyond). A rough model: circular decay at an effective height a little above the perigee,
 * the app's own air-density table (data/decay.ts), Cd = 2.2 and `areaPerMass` m²/kg.
 */
export function lifetimeDays(perigeeKm: number, apogeeKm: number, areaPerMass = 0.01): number {
  let h = perigeeKm + 0.15 * (apogeeKm - perigeeKm);
  if (h <= 150) return 0;
  let seconds = 0;
  const limit = 100 * 365.25 * 86400;
  while (h > 150) {
    const step = h > 600 ? 10 : h > 300 ? 2 : 0.5; // km
    const a = (RE + h) * 1000; // m
    const rate = airDensity(h) * 2.2 * areaPerMass * Math.sqrt(MU * 1e9 * a); // m/s of decay
    if (!(rate > 0)) return Infinity;
    seconds += (step * 1000) / rate;
    if (seconds > limit) return Infinity;
    h -= step;
  }
  return seconds / 86400;
}

// ---- collisions --------------------------------------------------------------------------------

export interface Breakup {
  relSpeedKmS: number;
  /** Energy of the collision (in the centre-of-mass frame), joules, and tonnes of TNT. */
  energyJ: number;
  tntTonnes: number;
  /** The projectile's kinetic energy per gram of target, J/g; catastrophic above 40. */
  emr: number;
  catastrophic: boolean;
  /** Fragments 10 cm and larger, by the NASA standard break-up model. */
  fragments10cm: number;
  /** …and 1 cm and larger. */
  fragments1cm: number;
}

/** What NASA's standard break-up model says of two masses meeting at a relative speed. */
export function breakup(massA: number, massB: number, relSpeedKmS: number): Breakup {
  const projectile = Math.min(massA, massB), target = Math.max(massA, massB);
  const v = relSpeedKmS * 1000; // m/s
  const emr = (0.5 * projectile * v * v) / (target * 1000); // J per gram of target
  const catastrophic = emr > 40;
  // The model's "mass" for the fragment count: everything, when catastrophic; otherwise the
  // projectile's mass scaled by the impact speed squared (in km/s).
  const M = catastrophic ? massA + massB : projectile * relSpeedKmS * relSpeedKmS;
  const count = (lc: number) => Math.max(0, Math.round(0.1 * Math.pow(M, 0.75) * Math.pow(lc, -1.6)));
  const reduced = (massA * massB) / (massA + massB);
  const energyJ = 0.5 * reduced * v * v;
  return { relSpeedKmS, energyJ, tntTonnes: energyJ / 4.184e9, emr, catastrophic, fragments10cm: count(0.1), fragments1cm: count(0.01) };
}

/**
 * Fragment states after a break-up at `r`, moving with the pair's centre of mass `vCm`: each is
 * given a kick in a random direction with a log-normal size around `medianKmS` (the break-up
 * model's spread: most fragments leave at a few hundred m/s). Seeded, so a replay is the same.
 */
export function fragmentStates(r: V3, vCm: V3, count: number, medianKmS: number, seed = 1): { r: V3; v: V3 }[] {
  let s = seed >>> 0 || 1;
  const random = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const out: { r: V3; v: V3 }[] = [];
  for (let k = 0; k < count; k++) {
    // A direction uniform on the sphere, and a log-normal speed (σ ≈ 0.35 decades).
    const z = 2 * random() - 1, phi = 2 * Math.PI * random(), s2 = Math.sqrt(1 - z * z);
    const gauss = Math.sqrt(-2 * Math.log(Math.max(1e-9, random()))) * Math.cos(2 * Math.PI * random());
    const dv = medianKmS * Math.pow(10, 0.35 * gauss);
    out.push({ r: { ...r }, v: { x: vCm.x + dv * s2 * Math.cos(phi), y: vCm.y + dv * s2 * Math.sin(phi), z: vCm.z + dv * z } });
  }
  return out;
}

/** Rotate `v` about the unit vector `axis` by `deg` degrees (Rodrigues). */
export function rotateAbout(v: V3, axis: V3, deg: number): V3 {
  const k = axis, c = Math.cos(deg * DEG), sn = Math.sin(deg * DEG), kv = dot(k, v), kxv = cross(k, v);
  return { x: v.x * c + kxv.x * sn + k.x * kv * (1 - c), y: v.y * c + kxv.y * sn + k.y * kv * (1 - c), z: v.z * c + kxv.z * sn + k.z * kv * (1 - c) };
}

/** Typical masses (kg) of the kinds of object, for the break-up figures when the real mass is not known. */
export const TYPICAL_MASS: Record<string, number> = {
  starlink: 260, starlinkv2: 800, oneweb: 150, kuiper: 600, qianfan: 300, guowang: 500, iridium: 860, globalstar: 700, o3b: 700,
  comsat: 3000, geocomsat: 4000, relay: 3000, gnss: 1600, galileo: 730, glonass: 1415, smallsat: 150, cubesat: 4, dove: 5,
  observer: 1000, radarsat: 1500, iceye: 85, capella: 100, weather: 2000, goes: 5200, spinner: 700, telescope: 11000,
  iss: 420000, tiangong: 100000, station: 20000, dragon: 12000, soyuz: 7000, cygnus: 7500, capsule: 8000, shenzhou: 8000,
  rocketbody: 2000, debris: 2, lasersphere: 400, phasedarray: 1500,
};
