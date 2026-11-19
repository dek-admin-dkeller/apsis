/**
 * Where every body in the solar system is, and which way it is turned, at a given moment.
 *
 * Pure arithmetic: no DOM, no three.js, no network. Node can import this file directly, which
 * is how scripts/check-deep.mjs compares it with JPL Horizons and how scripts/fetch-deep.mjs
 * turns Horizons state vectors into orbital elements.
 *
 * Frame and units as in types.ts: ICRF / J2000 equatorial, kilometres, Unix milliseconds.
 *
 * Three methods, by how the thing actually moves:
 *   planets   Keplerian elements that change linearly with time: JPL's "approximate positions
 *             of the planets" (Standish), the table valid 1800–2050. Good to about 0.01° for
 *             the inner planets; Jupiter and Saturn pull on each other with a 900-year rhythm
 *             the table does not carry and are the worst, at about 0.07°.
 *   the Moon  a trigonometric series (the largest terms of Meeus's abridged ELP-2000/82): the
 *             Sun disturbs the Moon's orbit far too much for an ellipse to do.
 *   moons     an ellipse about the planet that turns and swings at rates fitted to sixty years
 *             of JPL positions (moonOrbits.ts). Outside those years the ellipses downloaded
 *             with deep.json take over as the starting point (setMoonElements).
 *
 * Orientation follows the IAU rotation models: the pole's right ascension and declination and
 * the angle W of the prime meridian, W = W0 + rate × days.
 *
 * Measured accuracy against JPL Horizons, 2024–2030: `npm run check` prints it.
 */

import { BODIES } from './bodies.ts';
import { MOON_ORBITS, SWING_EPOCH_MS, type MoonOrbit } from './moonOrbits.ts';
import type { BodyId, Motion, Vec } from './types.ts';

export type ElementsMotion = Extract<Motion, { type: 'elements' }>;

export const AU_KM = 149597870.7;
const DEG = Math.PI / 180;
const TAU = 2 * Math.PI;
const DAY_MS = 86400000;
/** 2000-01-01 12:00:00 UTC. J2000.0 itself is that instant on the TT clock, 64.184 s earlier. */
const J2000_UTC_MS = 946728000000;
/**
 * Orbits run on uniform time (TT, which is what JPL's TDB is to within 2 ms); the app's clock is
 * UTC. The gap has been 69.184 s since 2017 (32.184 s plus 37 leap seconds). Before 2017 it
 * was up to a few seconds less: nothing here is sensitive to that.
 */
export const TT_MINUS_UTC_MS = 69184;
/** Mean obliquity of the ecliptic at J2000: the tilt between the ecliptic and the ICRF equator. */
const OBLIQUITY = 23.4392911 * DEG;
const COS_OBL = Math.cos(OBLIQUITY), SIN_OBL = Math.sin(OBLIQUITY);

/** Days of uniform time since J2000.0. */
function daysTT(tMs: number): number {
  return (tMs + TT_MINUS_UTC_MS - J2000_UTC_MS) / DAY_MS;
}

// ── Kepler's equation (shared with deep.ts) ─────────────────────────────────────────────

/** Mean motion, radians per second, of an orbit of semi-major axis `aKm` (negative for a hyperbola) about a body of the given GM. */
export function meanMotion(aKm: number, gm: number): number {
  return Math.sqrt(gm / Math.abs(aKm * aKm * aKm));
}

/**
 * Solve Kepler's equation and return the position in the orbit's own plane (x towards
 * periapsis), km. Works for ellipses (e < 1, a > 0: M = E − e sin E) and for hyperbolas
 * (e > 1, a < 0: M = e sinh H − H), which is what the Voyagers, the Pioneers and New Horizons
 * are on. Newton's method from a starting guess that converges for every eccentricity.
 */
function solveInPlane(aKm: number, e: number, meanAnomaly: number): [number, number] {
  if (e < 1) {
    // Bring M into −π … π so the starting guess is on the right branch.
    let M = meanAnomaly % TAU;
    if (M > Math.PI) M -= TAU;
    else if (M < -Math.PI) M += TAU;
    let E = e < 0.8 ? M + e * Math.sin(M) : Math.sign(M || 1) * Math.PI * 0.75 + M * 0.25;
    for (let i = 0; i < 40; i++) {
      const step = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      E -= step;
      if (Math.abs(step) < 1e-13) break;
    }
    return [aKm * (Math.cos(E) - e), aKm * Math.sqrt(1 - e * e) * Math.sin(E)];
  }
  const M = meanAnomaly;
  let H = Math.asinh(M / e);
  for (let i = 0; i < 60; i++) {
    const step = (e * Math.sinh(H) - H - M) / (e * Math.cosh(H) - 1);
    H -= step;
    if (Math.abs(step) < 1e-13) break;
  }
  // a is negative here, so both expressions come out with the right sign.
  return [aKm * (Math.cosh(H) - e), -aKm * Math.sqrt(e * e - 1) * Math.sinh(H)];
}

/** Turn a position in the orbit's plane into the reference frame: rotate by ω, then i, then Ω. */
function fromOrbitPlane(xp: number, yp: number, incl: number, node: number, peri: number, out: Vec): Vec {
  const cw = Math.cos(peri), sw = Math.sin(peri), cO = Math.cos(node), sO = Math.sin(node), ci = Math.cos(incl), si = Math.sin(incl);
  out[0] = (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp;
  out[1] = (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp;
  out[2] = sw * si * xp + cw * si * yp;
  return out;
}

/**
 * Position (km, in the frame the elements are given in, relative to the body they are about)
 * of something on a two-body orbit, `gm` being that body's gravitational parameter.
 */
export function elementsPosition(el: ElementsMotion, gm: number, tMs: number, out: Vec = [0, 0, 0]): Vec {
  const dt = (tMs - el.epochMs) / 1000;
  const r = el.rates;
  if (!r) {
    const [xp, yp] = solveInPlane(el.aKm, el.e, el.m0 + meanMotion(el.aKm, gm) * dt);
    return fromOrbitPlane(xp, yp, el.incl, el.node, el.peri, out);
  }
  // Measured rates (low orbiters): the pace and the turning of the ellipse in its plane first,
  // then the whole orbit swung round the planet's pole (Rodrigues' rotation formula). The swing
  // has to be about the PLANET's pole: in the ICRF frame the elements are written in, Mars's
  // pole is 37° from z, and a plane turning about it changes inclination and node together.
  const [xp, yp] = solveInPlane(el.aKm, el.e, el.m0 + r.m * dt);
  fromOrbitPlane(xp, yp, el.incl, el.node, el.peri + r.peri * dt, out);
  return turnAbout(out, r.axis, r.node * dt);
}

/**
 * The reverse: the two-body orbit that passes through a position (km) with a velocity (km/s) at
 * a given moment. fetch-deep.mjs uses it on Horizons state vectors, with the same GM the
 * browser will propagate with, so the round trip is exact.
 */
export function stateToElements(pos: Vec, vel: Vec, gm: number, epochMs: number): ElementsMotion {
  const [x, y, z] = pos, [vx, vy, vz] = vel;
  const r = Math.hypot(x, y, z), v2 = vx * vx + vy * vy + vz * vz;
  // Angular momentum h = r × v: the normal of the orbit's plane.
  const hx = y * vz - z * vy, hy = z * vx - x * vz, hz = x * vy - y * vx;
  const h = Math.hypot(hx, hy, hz);
  // Eccentricity vector (v × h)/GM − r/|r|: points at periapsis, length e.
  let ex = (vy * hz - vz * hy) / gm - x / r, ey = (vz * hx - vx * hz) / gm - y / r, ez = (vx * hy - vy * hx) / gm - z / r;
  const e = Math.hypot(ex, ey, ez);
  const aKm = 1 / (2 / r - v2 / gm); // vis-viva; negative when the speed exceeds escape speed
  const incl = Math.acos(Math.max(-1, Math.min(1, hz / h)));
  // The ascending node: where the orbit crosses the reference plane going north (z × h).
  let nx = -hy, ny = hx;
  const n = Math.hypot(nx, ny);
  if (n < 1e-11 * h) { nx = 1; ny = 0; } else { nx /= n; ny /= n; } // an orbit lying in the reference plane has no node: measure from x
  const node = Math.atan2(ny, nx);
  // In the plane, the axis a quarter turn ahead of the node: (h × n)/|h|.
  const qx = (hy * 0 - hz * ny) / h, qy = (hz * nx - hx * 0) / h, qz = (hx * ny - hy * nx) / h;
  if (e < 1e-11) { ex = nx; ey = ny; ez = 0; } // a circle has no periapsis: measure from the node
  const peri = Math.atan2(ex * qx + ey * qy + ez * qz, ex * nx + ey * ny);
  const lat = Math.atan2(x * qx + y * qy + z * qz, x * nx + y * ny); // angle from the node to the object
  const nu = lat - peri; // true anomaly
  let m0: number;
  if (e < 1) {
    const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
    m0 = E - e * Math.sin(E);
  } else {
    const H = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2));
    m0 = e * Math.sinh(H) - H;
  }
  return { type: 'elements', epochMs, aKm, e, incl, node: wrap(node), peri: wrap(peri), m0: e < 1 ? wrap(m0) : m0 };
}

/** An angle brought into 0 … 2π. */
function wrap(angle: number): number {
  const a = angle % TAU;
  return a < 0 ? a + TAU : a;
}

// ── The planets ─────────────────────────────────────────────────────────────────────────

/**
 * JPL "Keplerian elements for approximate positions of the major planets" (E. M. Standish),
 * table 1, valid 1800–2050, mean ecliptic and equinox of J2000: a (AU), e, inclination, mean
 * longitude, longitude of perihelion, longitude of the ascending node (degrees), then the
 * change of each per Julian century. The third row is the Earth–Moon barycentre.
 */
type Row = readonly [number, number, number, number, number, number, number, number, number, number, number, number];
const PLANET_ELEMENTS: Partial<Record<BodyId, Row>> = {
  mercury: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593, 0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  venus: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255, 0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
  earth: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0, 0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0],
  mars: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891, 0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  jupiter: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909, -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  saturn: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448, -0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  uranus: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503, -0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  neptune: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574, 0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
  pluto: [39.48211675, 0.2488273, 17.14001206, 238.92903833, 224.06891629, 110.30393684, -0.00031596, 0.0000517, 0.00004818, 145.20780515, -0.04062942, -0.01183482],
};

/** Heliocentric position (km, ICRF) from one row of the table at `d` days past J2000. */
function planetFromTable(id: BodyId, d: number, out: Vec): Vec {
  const el = PLANET_ELEMENTS[id]!;
  const T = d / 36525;
  const a = el[0] + el[6] * T;
  const e = el[1] + el[7] * T;
  const inc = (el[2] + el[8] * T) * DEG;
  const meanLon = el[3] + el[9] * T;
  const periLon = el[4] + el[10] * T;
  const nodeLon = el[5] + el[11] * T;
  const [xp, yp] = solveInPlane(a * AU_KM, e, (meanLon - periLon) * DEG);
  fromOrbitPlane(xp, yp, inc, nodeLon * DEG, (periLon - nodeLon) * DEG, out);
  return eclipticToEquator(out);
}

/** Rotate a J2000 ecliptic vector into the ICRF equatorial frame (about x, by the obliquity). */
function eclipticToEquator(v: Vec): Vec {
  const y = v[1], z = v[2];
  v[1] = y * COS_OBL - z * SIN_OBL;
  v[2] = y * SIN_OBL + z * COS_OBL;
  return v;
}

// ── Precession (needed by the Moon's series and by the Earth's axes) ────────────────────

/**
 * Take a vector from the mean equator and equinox OF DATE to the fixed J2000 frame. The
 * Earth's axis swings round a cone once in 26,000 years (0.014° a year), so anything worked out
 * "of date" (the Moon's classical series, sidereal time) is rotated back with the IAU 1976
 * precession angles ζ, z and θ.
 */
function ofDateToJ2000(v: Vec, T: number): Vec {
  const ARCSEC = DEG / 3600;
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T) * ARCSEC;
  const zed = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T) * ARCSEC;
  const theta = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T) * ARCSEC;
  const cz = Math.cos(zeta), sz = Math.sin(zeta), cZ = Math.cos(zed), sZ = Math.sin(zed), ct = Math.cos(theta), st = Math.sin(theta);
  // P takes J2000 → date; its transpose (written out here) takes date → J2000.
  const [x, y, z] = v;
  v[0] = (cz * ct * cZ - sz * sZ) * x + (cz * ct * sZ + sz * cZ) * y + cz * st * z;
  v[1] = (-sz * ct * cZ - cz * sZ) * x + (-sz * ct * sZ + cz * cZ) * y - sz * st * z;
  v[2] = -st * cZ * x - st * sZ * y + ct * z;
  return v;
}

// ── The Moon ────────────────────────────────────────────────────────────────────────────

/**
 * The largest periodic terms of the Moon's motion (Meeus, "Astronomical Algorithms", ch. 47,
 * after Chapront's ELP-2000/82). Each row: multiples of D (Moon's elongation from the Sun),
 * M (Sun's mean anomaly), M′ (Moon's mean anomaly) and F (Moon's distance from its node), then
 * the coefficient of the sine in longitude (millionths of a degree) and of the cosine in
 * distance (metres). Terms smaller than about 0.002° are left out.
 */
const MOON_LON: readonly (readonly number[])[] = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111], [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925], [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138], [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586], [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321], [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661], [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208], [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379], [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650], [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003], [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884], [0, 1, 2, 0, -2120, 5751],
  [0, 2, 0, 0, -2069, 0], [2, -2, -1, 0, 2048, -4950], [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0], [4, -1, -1, 0, 1215, -3958], [0, 0, 2, 2, -1110, 0],
];
/** The same for latitude: D, M, M′, F and the coefficient of the sine (millionths of a degree). */
const MOON_LAT: readonly (readonly number[])[] = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693], [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271], [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266], [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463], [2, -1, 0, 1, 2211],
  [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870], [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794],
  [0, 0, 0, 3, -1749], [0, 1, -1, 1, -1565], [1, 0, 0, 1, -1491], [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410], [0, 1, 0, -1, -1344], [1, 0, 0, -1, -1335], [0, 0, 3, 1, 1107],
  [4, 0, 0, -1, 1021], [4, 0, -1, 1, 833],
];

/**
 * The Moon relative to the Earth's centre, km, ICRF, at `d` days of uniform time past J2000.
 * The series is seventy sines and cosines, and one frame asks for it several times at the same
 * instant (the Moon itself, and the Earth's own offset from the Earth–Moon barycentre, which
 * every position measured from the Earth needs): the last answer is kept.
 */
let moonAt = NaN;
const moonKept: Vec = [0, 0, 0];
function moonGeocentric(d: number, out: Vec): Vec {
  if (d !== moonAt) {
    moonSeries(d, moonKept);
    moonAt = d;
  }
  out[0] = moonKept[0];
  out[1] = moonKept[1];
  out[2] = moonKept[2];
  return out;
}

function moonSeries(d: number, out: Vec): Vec {
  const T = d / 36525;
  // Mean longitude of the Moon (from the equinox of date) and the four arguments, degrees.
  const L = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T;
  const D = (297.8501921 + 445267.1114034 * T - 0.0018819 * T * T) * DEG;
  const M = (357.5291092 + 35999.0502909 * T - 0.0001536 * T * T) * DEG;
  const Mp = (134.9633964 + 477198.8675055 * T + 0.0087414 * T * T) * DEG;
  const F = (93.272095 + 483202.0175233 * T - 0.0036539 * T * T) * DEG;
  // Terms that contain the Sun's anomaly shrink as the Earth's orbit becomes rounder.
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  let lon = 0, dist = 0, lat = 0;
  for (const [kd, km, kp, kf, cl, cr] of MOON_LON) {
    const arg = kd * D + km * M + kp * Mp + kf * F;
    const shrink = km === 0 ? 1 : Math.abs(km) === 1 ? E : E * E;
    lon += cl * shrink * Math.sin(arg);
    dist += cr * shrink * Math.cos(arg);
  }
  for (const [kd, km, kp, kf, cb] of MOON_LAT) {
    const shrink = km === 0 ? 1 : Math.abs(km) === 1 ? E : E * E;
    lat += cb * shrink * Math.sin(kd * D + km * M + kp * Mp + kf * F);
  }
  // Small pushes from Venus (A1), Jupiter (A2) and the flattening of the Earth.
  const A1 = (119.75 + 131.849 * T) * DEG, A2 = (53.09 + 479264.29 * T) * DEG, A3 = (313.45 + 481266.484 * T) * DEG;
  const Lr = L * DEG;
  lon += 3958 * Math.sin(A1) + 1962 * Math.sin(Lr - F) + 318 * Math.sin(A2);
  lat += -2235 * Math.sin(Lr) + 382 * Math.sin(A3) + 175 * Math.sin(A1 - F) + 175 * Math.sin(A1 + F) + 127 * Math.sin(Lr - Mp) - 115 * Math.sin(Lr + Mp);
  const lambda = (L + lon * 1e-6) * DEG, beta = lat * 1e-6 * DEG, r = 385000.56 + dist * 0.001;
  // Ecliptic of date → equator of date (the obliquity itself shrinks by 47″ a century) → J2000.
  const eps = (23.4392911 - 0.0130042 * T) * DEG;
  const x = r * Math.cos(beta) * Math.cos(lambda), y = r * Math.cos(beta) * Math.sin(lambda), z = r * Math.sin(beta);
  out[0] = x;
  out[1] = y * Math.cos(eps) - z * Math.sin(eps);
  out[2] = y * Math.sin(eps) + z * Math.cos(eps);
  return ofDateToJ2000(out, T);
}

// ── The other moons ─────────────────────────────────────────────────────────────────────

/**
 * The built-in orbits are in moonOrbits.ts (a generated table: see the comment there for what
 * each number means). Summed up: an ellipse about the planet whose plane swings slowly round
 * a fixed axis, whose long axis turns within the plane, and along which the moon runs at a
 * steady pace plus a few slow swings. That is enough to keep every moon within a degree or two
 * for decades, including the awkward ones: Mimas, which a resonance with Tethys pushes 44°
 * back and forth over seventy years, and Janus and Epimetheus, which trade orbits every four.
 */

/**
 * An orbit ready to use. `swing0` is what to take off the slow swings: nothing for a table
 * entry (its m0 is the steady part alone), but for a downloaded ellipse, whose m0 is where the
 * moon really was at that moment, the value the swings had then.
 */
type LiveOrbit = MoonOrbit & { swing0: number };

/** The smaller arrows of a changing eccentricity vector (see `wobble` in moonOrbits.ts), added up at a moment. */
function wobbleAt(o: MoonOrbit, tMs: number): [number, number] {
  const d = (tMs - SWING_EPOCH_MS) / DAY_MS;
  let x = 0, y = 0;
  for (let k = 0; k < o.wobble.length; k += 3) {
    x += o.wobble[k + 1] * Math.cos(o.wobble[k + 2] + o.wobble[k] * d);
    y += o.wobble[k + 1] * Math.sin(o.wobble[k + 2] + o.wobble[k] * d);
  }
  return [x, y];
}

/** The slow swings of a moon's longitude at a moment (radians). */
function swingAt(o: MoonOrbit, tMs: number): number {
  const d = (tMs - SWING_EPOCH_MS) / DAY_MS;
  let sum = 0;
  for (let k = 0; k < o.swing.length; k += 3) sum += o.swing[k + 1] * Math.sin(o.swing[k] * d) + o.swing[k + 2] * Math.cos(o.swing[k] * d);
  return sum;
}

/** Orbits in use: the built-in ones until deep.json supplies fresher shapes and phases. */
const moonOrbits: Partial<Record<BodyId, LiveOrbit>> = {};
for (const key of Object.keys(MOON_ORBITS) as BodyId[]) moonOrbits[key] = { ...MOON_ORBITS[key]!, swing0: 0 };

/**
 * Offer the osculating elements downloaded with deep.json (each moon's ellipse at the moment
 * of the download). They are used ONLY for a download made outside the years a moon's table
 * orbit was fitted to (1996–2056): there the table can only be extrapolated, and a fresh
 * ellipse carried forward with the table's rates is the better start. Inside those years the
 * table wins: it was averaged over decades, whereas one moment's ellipse carries that moment's
 * passing disturbances with it (checked: after ten days a downloaded Mimas is half a degree
 * out and Pluto's small moons two degrees, the table a tenth of that). `always` is for the
 * check, which exercises the download path whatever the date. The Earth's Moon is left to its
 * series.
 */
export function setMoonElements(moons: Partial<Record<BodyId, Motion>> | null | undefined, always = false): void {
  for (const key of Object.keys(MOON_ORBITS) as BodyId[]) {
    const base = MOON_ORBITS[key]!;
    const el = moons?.[key];
    const usable = el && el.type === 'elements' && el.e < 1 && el.aKm > 0
      && [el.epochMs, el.aKm, el.e, el.incl, el.node, el.peri, el.m0].every(Number.isFinite)
      && (always || el.epochMs < base.fitted[0] || el.epochMs > base.fitted[1])
      // A wrong body's elements must not move a moon: the size has to be the one expected.
      && Math.abs(el.aKm / base.aKm - 1) < 0.05;
    const orbit: MoonOrbit = usable ? { ...base, epochMs: el.epochMs, aKm: el.aKm, e: el.e, incl: el.incl, node: el.node, peri: el.peri, m0: el.m0 } : base;
    if (usable && base.wobble.length > 0) rebase(orbit, base, el.peri + el.m0);
    moonOrbits[key] = { ...orbit, swing0: usable ? swingAt(orbit, orbit.epochMs) : 0 };
  }
}

/**
 * A downloaded ellipse for a moon whose orbit keeps changing shape. Its eccentricity vector at
 * the download moment is the SUM of the steady arrow and the smaller ones; the smaller ones
 * are known from the table, so the steady one is what is left when they are taken away. Two
 * details: the table's arrows are measured from the table orbit's own node, which the
 * download's plane does not share, so they are first turned to the new reference; and the
 * moon's place along the orbit must come out exactly as downloaded.
 */
function rebase(orbit: MoonOrbit, base: MoonOrbit, meanAngle: number): void {
  // Where the table's reference direction (its node, carried round the axis since) lies in
  // the downloaded plane, as an angle from the downloaded node.
  const ref = turnAbout([Math.cos(base.node), Math.sin(base.node), 0], base.axis, base.nodeRate * ((orbit.epochMs - base.epochMs) / DAY_MS));
  const cn = Math.cos(orbit.node), sn = Math.sin(orbit.node), ci = Math.cos(orbit.incl), si = Math.sin(orbit.incl);
  const along = ref[0] * cn + ref[1] * sn, aside = -ref[0] * sn * ci + ref[1] * cn * ci + ref[2] * si;
  const turn = Math.atan2(aside, along);
  orbit.wobble = base.wobble.map((value, k) => (k % 3 === 2 ? value + turn : value));
  const [wx, wy] = wobbleAt(orbit, orbit.epochMs);
  const x = orbit.e * Math.cos(orbit.peri) - wx, y = orbit.e * Math.sin(orbit.peri) - wy;
  orbit.e = Math.hypot(x, y);
  orbit.peri = Math.atan2(y, x);
  orbit.m0 = meanAngle - orbit.peri; // so that m0 + peri is still the downloaded mean angle from the node
}

/** A moon (not the Earth's) relative to its planet, km, ICRF. */
function moonAboutPlanet(id: BodyId, tMs: number, out: Vec): Vec {
  const o = moonOrbits[id]!;
  const days = (tMs - o.epochMs) / DAY_MS;
  const swing = o.swing.length > 0 ? swingAt(o, tMs) - o.swing0 : 0;
  let e = o.e, peri = o.peri + o.periRate * days;
  if (o.wobble.length > 0) {
    // The ellipse's shape at this moment: the steady arrow plus the smaller ones.
    const [wx, wy] = wobbleAt(o, tMs);
    const x = e * Math.cos(peri) + wx, y = e * Math.sin(peri) + wy;
    e = Math.hypot(x, y);
    peri = Math.atan2(y, x);
  }
  // The mean angle from the node runs steadily (plus its swings); the mean anomaly is that
  // angle less wherever the periapsis is now.
  const [xp, yp] = solveInPlane(o.aKm, e, o.m0 + o.peri + o.rate * days + swing - peri);
  fromOrbitPlane(xp, yp, o.incl, o.node, peri, out);
  if (o.nodeRate !== 0) turnAbout(out, o.axis, o.nodeRate * days);
  if (o.partner) {
    // Pluto's small moons: the orbit above is about the centre of mass of Pluto and Charon.
    // Step from Pluto's centre to that point: Charon's share of the pair's mass along the line to Charon.
    const share = BODIES[o.partner].gm / (BODIES[BODIES[id].parent!].gm + BODIES[o.partner].gm);
    const c = moonAboutPlanet(o.partner, tMs, [0, 0, 0]);
    out[0] += share * c[0];
    out[1] += share * c[1];
    out[2] += share * c[2];
  }
  return out;
}

/** Rotate a vector about a unit axis by an angle (Rodrigues' formula), in place. */
function turnAbout(v: Vec, axis: Vec, angle: number): Vec {
  const [kx, ky, kz] = axis, [x, y, z] = v;
  const c = Math.cos(angle), s = Math.sin(angle), along = (kx * x + ky * y + kz * z) * (1 - c);
  v[0] = x * c + (ky * z - kz * y) * s + kx * along;
  v[1] = y * c + (kz * x - kx * z) * s + ky * along;
  v[2] = z * c + (kx * y - ky * x) * s + kz * along;
  return v;
}

// ── Positions ───────────────────────────────────────────────────────────────────────────

/** The Moon pulls the Earth round their common centre, 4,670 km from the Earth's own: this is the Moon's share of the pair's mass. */
const MOON_SHARE = BODIES.moon.gm / (BODIES.earth.gm + BODIES.moon.gm);
const scratch: Vec = [0, 0, 0];

/** Position relative to the body's parent (the Sun for planets), km, ICRF. */
function aboutParent(id: BodyId, tMs: number, out: Vec): Vec {
  if (id === 'sun') {
    out[0] = out[1] = out[2] = 0;
    return out;
  }
  const d = daysTT(tMs);
  if (id === 'moon') return moonGeocentric(d, out);
  if (id === 'earth') {
    // The table gives the Earth–Moon barycentre; step back from it to the Earth itself.
    planetFromTable('earth', d, out);
    const m: Vec = [0, 0, 0];
    moonGeocentric(d, m);
    out[0] -= m[0] * MOON_SHARE;
    out[1] -= m[1] * MOON_SHARE;
    out[2] -= m[2] * MOON_SHARE;
    return out;
  }
  if (PLANET_ELEMENTS[id]) return planetFromTable(id, d, out);
  return moonAboutPlanet(id, tMs, out);
}

/** Where a body is: kilometres from the Sun's centre, ICRF, at Unix time `tMs`. */
export function bodyPosition(id: BodyId, tMs: number, out: Vec = [0, 0, 0]): Vec {
  aboutParent(id, tMs, out);
  const parent = BODIES[id].parent;
  if (parent && parent !== 'sun') {
    const p: Vec = [0, 0, 0];
    aboutParent(parent, tMs, p);
    out[0] += p[0];
    out[1] += p[1];
    out[2] += p[2];
  }
  return out;
}

/** Where a body is as seen from the centre of another: kilometres, ICRF. */
export function bodyRelative(id: BodyId, centre: BodyId, tMs: number, out: Vec = [0, 0, 0]): Vec {
  if (id === centre) {
    out[0] = out[1] = out[2] = 0;
    return out;
  }
  // A moon seen from its own planet (and the reverse) needs no trip through the Sun.
  if (BODIES[id].parent === centre) return aboutParent(id, tMs, out);
  if (BODIES[centre].parent === id) {
    aboutParent(centre, tMs, out);
    out[0] = -out[0];
    out[1] = -out[1];
    out[2] = -out[2];
    return out;
  }
  // Two moons of one planet: the planet's own position cancels.
  const shared = BODIES[id].parent === BODIES[centre].parent && BODIES[id].parent !== 'sun';
  if (shared) aboutParent(id, tMs, out);
  else bodyPosition(id, tMs, out);
  const c = shared ? aboutParent(centre, tMs, scratch) : bodyPosition(centre, tMs, scratch);
  out[0] -= c[0];
  out[1] -= c[1];
  out[2] -= c[2];
  return out;
}

// ── Orientation ─────────────────────────────────────────────────────────────────────────

/**
 * IAU rotation models (Working Group on Cartographic Coordinates and Rotational Elements, 2009
 * and 2015 reports): right ascension and declination of the north pole at J2000 and their
 * change per century, then the prime meridian angle W at J2000 and its change per day, all in
 * degrees. A seventh number, where there is one, is W's change per century squared (tides are
 * slowly speeding Phobos up). W is measured along the body's equator from where that equator
 * rises through the ICRF equator. These are the steady terms; NOD below adds the periodic ones.
 *
 * Moons with no entry here are turned by lockedAxes(): Hyperion, which tumbles; Himalia, Nereid
 * and Pluto's four small moons, whose spin nobody has pinned down well enough for a model; and
 * Janus and Epimetheus, whose IAU models run at a constant rate and so ignore the exchange of
 * orbits every four years that this app follows.
 */
const ROTATION: Partial<Record<BodyId, readonly number[]>> = {
  sun: [286.13, 0, 63.87, 0, 84.176, 14.1844],
  mercury: [281.0103, -0.0328, 61.4155, -0.0049, 329.5988, 6.1385108],
  venus: [272.76, 0, 67.16, 0, 160.2, -1.4813688],
  mars: [317.68143, -0.1061, 52.8865, -0.0609, 176.63, 350.89198226],
  phobos: [317.67071657, -0.10844326, 52.88627266, -0.06134706, 35.1877444, 1128.84475928, 12.72192797],
  deimos: [316.65705808, -0.10518014, 53.50992033, -0.05979094, 79.39932954, 285.16188899],
  jupiter: [268.056595, -0.006499, 64.495303, 0.002413, 284.95, 870.536],
  amalthea: [268.05, -0.009, 64.49, 0.003, 231.67, 722.631456],
  thebe: [268.05, -0.009, 64.49, 0.003, 8.56, 533.70041],
  io: [268.05, -0.009, 64.5, 0.003, 200.39, 203.4889538],
  europa: [268.08, -0.009, 64.51, 0.003, 36.022, 101.3747235],
  ganymede: [268.2, -0.009, 64.57, 0.003, 44.064, 50.3176081],
  callisto: [268.72, -0.009, 64.83, 0.003, 259.51, 21.5710715],
  saturn: [40.589, -0.036, 83.537, -0.004, 38.9, 810.7939024],
  mimas: [40.66, -0.036, 83.52, -0.004, 333.46, 381.994555],
  enceladus: [40.66, -0.036, 83.52, -0.004, 6.32, 262.7318996],
  tethys: [40.66, -0.036, 83.52, -0.004, 8.95, 190.6979085],
  dione: [40.66, -0.036, 83.52, -0.004, 357.6, 131.5349316],
  rhea: [40.38, -0.036, 83.55, -0.004, 235.16, 79.6900478],
  titan: [39.4827, 0, 83.4279, 0, 186.5855, 22.5769768],
  iapetus: [318.16, -3.949, 75.03, -1.143, 355.2, 4.5379572],
  phoebe: [356.9, 0, 77.8, 0, 178.58, 931.639],
  uranus: [257.311, 0, -15.175, 0, 203.81, -501.1600928],
  puck: [257.31, 0, -15.18, 0, 91.24, -472.545069],
  miranda: [257.43, 0, -15.08, 0, 30.7, -254.6906892],
  ariel: [257.43, 0, -15.1, 0, 156.22, -142.8356681],
  umbriel: [257.43, 0, -15.1, 0, 108.05, -86.8688923],
  titania: [257.43, 0, -15.1, 0, 77.74, -41.3514316],
  oberon: [257.43, 0, -15.1, 0, 6.77, -26.7394932],
  neptune: [299.36, 0, 43.46, 0, 249.978, 541.1397757],
  proteus: [299.27, 0, 42.91, 0, 93.38, 320.7654228],
  triton: [299.36, 0, 41.17, 0, 296.53, -61.2572637],
  pluto: [132.993, 0, -6.163, 0, 302.695, 56.3625225],
  charon: [132.993, 0, -6.163, 0, 122.695, 56.3625225],
};

/**
 * The slow angles the periodic terms are built from, each [degrees at J2000, degrees per
 * century]: the turning of a moon's orbit plane (or of a neighbour's) that its axis follows.
 * Names as in the IAU reports (M Mars, J Jupiter, S Saturn, U Uranus, N Neptune).
 */
const ANGLES: Record<string, readonly [number, number]> = {
  M1: [190.72646643, 15917.10818695], M2: [21.4689247, 31834.27934054], M3: [332.86082793, 19139.89694742], M4: [394.93256437, 38280.79631835], M5: [189.6327156, 41215158.1842005],
  M6: [121.46893664, 660.22803474], M7: [231.05028581, 660.9912354], M8: [251.37314025, 1320.50145245], M9: [217.98635955, 38279.9612555], M10: [196.19729402, 19139.83628608],
  J1: [73.32, 91472.9], J2: [24.62, 45137.2], J3: [283.9, 4850.7], J4: [355.8, 1191.3], J5: [119.9, 262.1], J6: [229.8, 64.3], J7: [352.25, 2382.6], J8: [113.35, 6070],
  S3: [177.4, -36505.5], S4: [300, -7225.9], S5: [316.45, 506.2], S6: [345.2, -1016.3],
  U10: [138.64, 8061.81], U11: [102.23, -2024.22], U12: [316.41, 2863.96], U13: [304.01, -51.94], U14: [308.71, -93.17], U15: [340.82, -75.32], U16: [259.14, -504.81],
  N: [357.85, 52.316], N6: [142.61, 2824.6], N7: [177.85, 52.316],
};

/**
 * The periodic terms: for each body a list of [angle, multiple, a, b, c], adding
 * a × sin(multiple × angle) to the pole's right ascension, b × cos(…) to its declination and
 * c × sin(…) to W, in degrees. Most are a fraction of a degree. The big ones: Mimas, whose face
 * swings 45° with its seventy-year dance with Tethys (S5); Triton, whose pole circles 22° from
 * Neptune's every 688 years (N7); Miranda, tilted 4° to Uranus's equator (U11).
 */
const NOD: Partial<Record<BodyId, readonly (readonly [string, number, number, number, number])[]>> = {
  phobos: [['M1', 1, -1.78428399, -1.07516537, 1.42421769], ['M2', 1, 0.02212824, 0.00668626, -0.02273783], ['M3', 1, -0.01028251, -0.0064874, 0.00410711], ['M4', 1, -0.00475595, 0.00281576, 0.00631964], ['M5', 1, 0, 0, -1.143]],
  deimos: [['M6', 1, 3.09217726, 1.83936004, -2.73954829], ['M7', 1, 0.22980637, 0.1432532, -0.39968606], ['M8', 1, 0.06418655, 0.01911409, -0.06563259], ['M9', 1, 0.02533537, -0.0148259, -0.0291294], ['M10', 1, 0.00778695, 0.0019243, 0.0169916]],
  amalthea: [['J1', 1, -0.84, -0.36, 0.76], ['J1', 2, 0.01, 0, -0.01]],
  thebe: [['J2', 1, -2.11, -0.91, 1.91], ['J2', 2, 0.04, 0.01, -0.04]],
  io: [['J3', 1, 0.094, 0.04, -0.085], ['J4', 1, 0.024, 0.011, -0.022]],
  europa: [['J4', 1, 1.086, 0.468, -0.98], ['J5', 1, 0.06, 0.026, -0.054], ['J6', 1, 0.015, 0.007, -0.014], ['J7', 1, 0.009, 0.002, -0.008]],
  ganymede: [['J4', 1, -0.037, -0.016, 0.033], ['J5', 1, 0.431, 0.186, -0.389], ['J6', 1, 0.091, 0.039, -0.082]],
  callisto: [['J5', 1, -0.068, -0.029, 0.061], ['J6', 1, 0.59, 0.254, -0.533], ['J8', 1, 0.01, -0.004, -0.008]],
  mimas: [['S3', 1, 13.56, -1.53, -13.48], ['S5', 1, 0, 0, -44.85]],
  tethys: [['S4', 1, 9.66, -1.09, -9.6], ['S5', 1, 0, 0, 2.23]],
  rhea: [['S6', 1, 3.1, -0.35, -3.08]],
  puck: [['U10', 1, -0.33, 0.33, -0.09]],
  miranda: [['U11', 1, 4.41, 4.25, 1.15], ['U11', 2, -0.04, -0.02, -0.09], ['U12', 1, 0, 0, -1.27], ['U12', 2, 0, 0, 0.15]],
  ariel: [['U13', 1, 0.29, 0.28, 0.08], ['U12', 1, 0, 0, 0.05]],
  umbriel: [['U14', 1, 0.21, 0.2, 0.06], ['U12', 1, 0, 0, -0.09]],
  titania: [['U15', 1, 0.29, 0.28, 0.08]],
  oberon: [['U16', 1, 0.16, 0.16, 0.04]],
  neptune: [['N', 1, 0.7, -0.51, -0.48]],
  proteus: [['N', 1, 0.7, -0.51, -0.48], ['N6', 1, -0.05, -0.04, 0.04]],
  triton: [
    ['N7', 1, -32.35, 22.55, 22.25], ['N7', 2, -6.28, 2.1, 6.73], ['N7', 3, -2.08, 0.55, 2.05], ['N7', 4, -0.74, 0.16, 0.74], ['N7', 5, -0.28, 0.05, 0.28],
    ['N7', 6, -0.11, 0.02, 0.11], ['N7', 7, -0.07, 0.01, 0.05], ['N7', 8, -0.02, 0, 0.02], ['N7', 9, -0.01, 0, 0.01],
  ],
};

/** Does this body have a rotation model of its own (the alternative being lockedAxes below)? */
export const hasRotationModel = (id: BodyId): boolean => id === 'earth' || id === 'moon' || ROTATION[id] !== undefined;

/** Unit vectors from a pole (α0, δ0) and a prime meridian angle W, all in radians. */
function axesFrom(ra: number, dec: number, w: number): { pole: Vec; prime: Vec } {
  const ca = Math.cos(ra), sa = Math.sin(ra), cd = Math.cos(dec), sd = Math.sin(dec), cw = Math.cos(w), sw = Math.sin(w);
  // The node Q = (−sin α, cos α, 0) is where the body's equator crosses the ICRF equator going
  // north; pole × Q is a quarter turn further along the body's equator.
  return {
    pole: [cd * ca, cd * sa, sd],
    prime: [-sa * cw - sd * ca * sw, ca * cw - sd * sa * sw, cd * sw],
  };
}

/**
 * Which way a body is turned: unit ICRF vectors along its north pole and through the point at
 * latitude 0, longitude 0 on its surface. East longitude then runs towards pole × prime.
 */
export function bodyAxes(id: BodyId, tMs: number): { pole: Vec; prime: Vec } {
  const d = daysTT(tMs), T = d / 36525;
  if (id === 'earth') {
    // Greenwich mean sidereal time turns the prime meridian about the pole OF DATE; both are
    // then carried back to J2000 (the pole has moved 0.15° since 2000, the equinox 0.37°).
    const ut = (tMs - J2000_UTC_MS) / DAY_MS;
    const gmst = (280.46061837 + 360.98564736629 * ut + 0.000387933 * T * T) * DEG;
    return { pole: ofDateToJ2000([0, 0, 1], T), prime: ofDateToJ2000([Math.cos(gmst), Math.sin(gmst), 0], T) };
  }
  if (id === 'moon') {
    // The Moon's axis nods by 1.5° and its face rocks by 3.6° with the 18.6-year turn of its
    // orbit (E1), plus smaller monthly terms.
    const E1 = (125.045 - 0.0529921 * d) * DEG, E2 = (250.089 - 0.1059842 * d) * DEG, E3 = (260.008 + 13.0120009 * d) * DEG;
    const E4 = (176.625 + 13.3407154 * d) * DEG, E5 = (357.529 + 0.9856003 * d) * DEG;
    const ra = 269.9949 + 0.0031 * T - 3.8787 * Math.sin(E1) - 0.1204 * Math.sin(E2) + 0.07 * Math.sin(E3) - 0.0172 * Math.sin(E4);
    const dec = 66.5392 + 0.013 * T + 1.5419 * Math.cos(E1) + 0.0239 * Math.cos(E2) - 0.0278 * Math.cos(E3) + 0.0068 * Math.cos(E4);
    const w = 38.3213 + 13.17635815 * d - 1.4e-12 * d * d + 3.561 * Math.sin(E1) + 0.1208 * Math.sin(E2) - 0.0642 * Math.sin(E3) + 0.0158 * Math.sin(E4) + 0.0252 * Math.sin(E5);
    return axesFrom(ra * DEG, dec * DEG, (w % 360) * DEG);
  }
  const row = ROTATION[id];
  if (row) {
    let ra = row[0] + row[1] * T, dec = row[2] + row[3] * T, w = row[4] + row[5] * d + (row[6] ?? 0) * T * T;
    const terms = NOD[id];
    if (terms) {
      for (const [name, multiple, cRa, cDec, cW] of terms) {
        const angle = multiple * (ANGLES[name][0] + ANGLES[name][1] * T) * DEG;
        const sine = Math.sin(angle);
        ra += cRa * sine;
        dec += cDec * Math.cos(angle);
        w += cW * sine;
      }
    }
    return axesFrom(ra * DEG, dec * DEG, (w % 360) * DEG);
  }
  return lockedAxes(id, tMs);
}

/**
 * For the moons with no rotation model (see ROTATION): one face kept to the planet, the axis
 * square to the orbit. That is true of Janus and Epimetheus. For the others it is a stand-in
 * and the truth is different: Hyperion tumbles chaotically, Himalia and Nereid spin in hours,
 * and Pluto's small moons spin fast on steeply tilted axes. None of them has a map, so the
 * stand-in only decides how a plain ball is turned.
 */
function lockedAxes(id: BodyId, tMs: number): { pole: Vec; prime: Vec } {
  const o = moonOrbits[id]!;
  const si = Math.sin(o.incl);
  // The orbit's normal now: the normal at the epoch, carried round the axis the plane swings about.
  const pole: Vec = [si * Math.sin(o.node), -si * Math.cos(o.node), Math.cos(o.incl)];
  if (o.nodeRate !== 0) {
    turnAbout(pole, o.axis, o.nodeRate * ((tMs - o.epochMs) / DAY_MS));
    // The table's axis is rounded to seven places; keep the pole's length exactly one.
    const size = Math.hypot(pole[0], pole[1], pole[2]);
    pole[0] /= size;
    pole[1] /= size;
    pole[2] /= size;
  }
  const p = moonAboutPlanet(id, tMs, [0, 0, 0]);
  // Towards the planet, with any part along the pole removed, so the two are exactly square.
  const along = p[0] * pole[0] + p[1] * pole[1] + p[2] * pole[2];
  const prime: Vec = [-(p[0] - along * pole[0]), -(p[1] - along * pole[1]), -(p[2] - along * pole[2])];
  const length = Math.hypot(prime[0], prime[1], prime[2]) || 1;
  prime[0] /= length;
  prime[1] /= length;
  prime[2] /= length;
  return { pole, prime };
}
