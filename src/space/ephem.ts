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
 *   moons     a precessing ellipse about the planet. The rates are fixed; the shape and the
 *             phase are replaced by fresh osculating elements from deep.json when
 *             setMoonElements() is called, so near the download date they are almost exact.
 *
 * Orientation follows the IAU rotation models: the pole's right ascension and declination and
 * the angle W of the prime meridian, W = W0 + rate × days.
 *
 * Measured accuracy against JPL Horizons, 2024–2030: `npm run check` prints it.
 */

import { BODIES } from './bodies.ts';
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
  const [kx, ky, kz] = r.axis, [x, y, z] = out;
  const c = Math.cos(r.node * dt), s = Math.sin(r.node * dt), along = (kx * x + ky * y + kz * z) * (1 - c);
  out[0] = x * c + (ky * z - kz * y) * s + kx * along;
  out[1] = y * c + (kz * x - kx * z) * s + ky * along;
  out[2] = z * c + (kx * y - ky * x) * s + kz * along;
  return out;
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

/** The Moon relative to the Earth's centre, km, ICRF, at `d` days of uniform time past J2000. */
function moonGeocentric(d: number, out: Vec): Vec {
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
 * A moon's orbit about its planet: an ellipse in a fixed plane (ICRF equator and equinox) whose
 * long axis may turn slowly. `rate` is how fast the mean LONGITUDE advances along the orbit (radians per day;
 * Triton's backward motion is in its inclination, over 90°) and `periRate` how fast the periapsis does.
 * A planet's bulge and the other moons make the true rate differ from what Kepler's third law
 * gives for the instantaneous ellipse, by up to a quarter of a degree a day for Io; the rates
 * here are fitted to twenty years of JPL positions instead, so the phase holds for decades.
 */
interface MoonOrbit {
  epochMs: number;
  aKm: number;
  e: number;
  incl: number;
  node: number;
  peri: number;
  m0: number;
  rate: number;
  periRate: number;
}

/** Built-in mean orbits (fitted by `node scripts/make-deep-fixture.mjs --fit`), so everything works offline. */
const MOON_ORBITS: Partial<Record<BodyId, MoonOrbit>> = {
  phobos: { epochMs: 1767225600000, aKm: 9375.0, e: 0.015118, incl: 0.6479082, node: 0.8323454, peri: 3.461183, m0: 0.2249917, rate: 19.70206093594, periRate: 7.595566e-3 },
  deimos: { epochMs: 1767225600000, aKm: 23457.5, e: 0, incl: 0.6247765, node: 0.778082, peri: 0, m0: 0.3706828, rate: 4.97701268622, periRate: 0 },
  io: { epochMs: 1767225600000, aKm: 421765.1, e: 0.004154, incl: 0.4450996, node: 6.2492507, peri: 3.949952, m0: 1.8620674, rate: 3.55155229935, periRate: -1.290696e-2 },
  europa: { epochMs: 1767225600000, aKm: 671062.6, e: 0.009357, incl: 0.4433183, node: 6.2440824, peri: 0.812402, m0: 4.073222, rate: 1.76932276922, periRate: -1.290698e-2 },
  ganymede: { epochMs: 1767225600000, aKm: 1070430.1, e: 0.002015, incl: 0.4472656, node: 6.24937, peri: 5.927714, m0: 0.0583926, rate: 0.87820791652, periRate: 9.579312e-5 },
  callisto: { epochMs: 1767225600000, aKm: 1882753.2, e: 0.007253, incl: 0.4405868, node: 6.2518198, peri: 0.204961, m0: 1.3754557, rate: 0.37648622066, periRate: 3.081557e-5 },
  enceladus: { epochMs: 1767225600000, aKm: 238035.4, e: 0.004735, incl: 0.1128072, node: 2.278884, peri: 2.462052, m0: 4.7980492, rate: 4.58553713275, periRate: 5.900739e-3 },
  titan: { epochMs: 1767225600000, aKm: 1221862.3, e: 0.028677, incl: 0.1106777, node: 2.2160167, peri: 3.857537, m0: 6.1508427, rate: 0.39404254399, periRate: 2.480549e-5 },
  triton: { epochMs: 1767225600000, aKm: 354759.1, e: 0, incl: 1.9317439, node: 3.7396618, peri: 0, m0: 0.5757983, rate: 1.06914289879, periRate: 0 },
  charon: { epochMs: 1767225600000, aKm: 19595.8, e: 0.000161, incl: 1.6797672, node: 3.8922409, peri: 2.711922, m0: 1.3187254, rate: 0.98371173638, periRate: 4.24212e-8 },
};

/** Orbits in use: the built-in ones until deep.json supplies fresher shapes and phases. */
const moonOrbits: Partial<Record<BodyId, MoonOrbit>> = { ...MOON_ORBITS };

/**
 * Use the osculating elements downloaded with deep.json (each moon about its planet, at the
 * moment of the download) for the shape, the plane and the phase of every moon's orbit, keeping
 * the built-in long-term rates. Near the download date positions are then right to a small
 * fraction of a degree; years away they are as good as the built-in orbits. The Earth's Moon is
 * left to its series, which beats any single ellipse after a few days.
 */
export function setMoonElements(moons: Partial<Record<BodyId, Motion>> | null | undefined): void {
  for (const key of Object.keys(MOON_ORBITS) as BodyId[]) {
    const base = MOON_ORBITS[key]!;
    const el = moons?.[key];
    const usable = el && el.type === 'elements' && el.e < 1 && el.aKm > 0
      && [el.epochMs, el.aKm, el.e, el.incl, el.node, el.peri, el.m0].every(Number.isFinite)
      // A wrong body's elements must not move a moon: the size has to be the one expected.
      && Math.abs(el.aKm / base.aKm - 1) < 0.05;
    moonOrbits[key] = usable
      ? { epochMs: el.epochMs, aKm: el.aKm, e: el.e, incl: el.incl, node: el.node, peri: el.peri, m0: el.m0, rate: base.rate, periRate: base.periRate }
      : base;
  }
}

/** A moon (not the Earth's) relative to its planet, km, ICRF. */
function moonAboutPlanet(id: BodyId, tMs: number, out: Vec): Vec {
  const o = moonOrbits[id]!;
  const days = (tMs - o.epochMs) / DAY_MS;
  const [xp, yp] = solveInPlane(o.aKm, o.e, o.m0 + (o.rate - o.periRate) * days);
  return fromOrbitPlane(xp, yp, o.incl, o.node, o.peri + o.periRate * days, out);
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
 * degrees. W is measured along the body's equator from where that equator rises through the
 * ICRF equator. These are the steady terms; the Moon, Neptune and Jupiter's four large moons
 * also nod by up to a degree or more, and get those terms below.
 */
const ROTATION: Partial<Record<BodyId, readonly [number, number, number, number, number, number]>> = {
  sun: [286.13, 0, 63.87, 0, 84.176, 14.1844],
  mercury: [281.0103, -0.0328, 61.4155, -0.0049, 329.5988, 6.1385108],
  venus: [272.76, 0, 67.16, 0, 160.2, -1.4813688],
  mars: [317.68143, -0.1061, 52.8865, -0.0609, 176.63, 350.89198226],
  jupiter: [268.056595, -0.006499, 64.495303, 0.002413, 284.95, 870.536],
  saturn: [40.589, -0.036, 83.537, -0.004, 38.9, 810.7939024],
  uranus: [257.311, 0, -15.175, 0, 203.81, -501.1600928],
  neptune: [299.36, 0, 43.46, 0, 249.978, 541.1397757],
  pluto: [132.993, 0, -6.163, 0, 302.695, 56.3625225],
  io: [268.05, -0.009, 64.5, 0.003, 200.39, 203.4889538],
  europa: [268.08, -0.009, 64.51, 0.003, 36.022, 101.3747235],
  ganymede: [268.2, -0.009, 64.57, 0.003, 44.064, 50.3176081],
  callisto: [268.72, -0.009, 64.83, 0.003, 259.51, 21.5710715],
  titan: [39.4827, 0, 83.4279, 0, 186.5855, 22.5769768],
};

/**
 * Jupiter's large moons: their orbits (and so their axes) swing about Jupiter's equator, Europa's
 * by half a degree. The angles J3 … J8 [degrees at J2000, degrees per century], then per moon the
 * terms [which J, right ascension × sin, declination × cos, prime meridian × sin], in degrees.
 */
const JOVIAN: Record<number, readonly [number, number]> = { 3: [283.9, 4850.7], 4: [355.8, 1191.3], 5: [119.9, 262.1], 6: [229.8, 64.3], 7: [352.25, 2382.6], 8: [113.35, 6070] };
const JOVIAN_NOD: Partial<Record<BodyId, readonly (readonly [number, number, number, number])[]>> = {
  io: [[3, 0.094, 0.04, -0.085], [4, 0.024, 0.011, -0.022]],
  europa: [[4, 1.086, 0.468, -0.98], [5, 0.06, 0.026, -0.054], [6, 0.015, 0.007, -0.014], [7, 0.009, 0.002, -0.008]],
  ganymede: [[4, -0.037, -0.016, 0.033], [5, 0.431, 0.186, -0.389], [6, 0.091, 0.039, -0.082]],
  callisto: [[5, -0.068, -0.029, 0.061], [6, 0.59, 0.254, -0.533], [8, 0.01, -0.004, -0.008]],
};

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
    let ra = row[0] + row[1] * T, dec = row[2] + row[3] * T, w = row[4] + row[5] * d;
    if (id === 'neptune') {
      const N = (357.85 + 52.316 * T) * DEG; // the turning of Triton's orbit tips Neptune's axis by half a degree
      ra += 0.7 * Math.sin(N);
      dec -= 0.51 * Math.cos(N);
      w -= 0.48 * Math.sin(N);
    }
    for (const [which, cRa, cDec, cW] of JOVIAN_NOD[id] ?? []) {
      const J = (JOVIAN[which][0] + JOVIAN[which][1] * T) * DEG;
      ra += cRa * Math.sin(J);
      dec += cDec * Math.cos(J);
      w += cW * Math.sin(J);
    }
    return axesFrom(ra * DEG, dec * DEG, (w % 360) * DEG);
  }
  return lockedAxes(id, tMs);
}

/**
 * The small moons (Phobos, Deimos, Enceladus, Triton, Charon) all keep one face to their
 * planet, with their axis square to their orbit. So instead of five more rotation models:
 * longitude 0 points at the planet, and the pole is the orbit's normal (reversed for Triton,
 * whose north pole by the IAU's rule is the one it turns clockwise about).
 */
function lockedAxes(id: BodyId, tMs: number): { pole: Vec; prime: Vec } {
  const o = moonOrbits[id]!;
  const si = Math.sin(o.incl);
  const sign = id === 'triton' ? -1 : 1;
  const pole: Vec = [sign * si * Math.sin(o.node), -sign * si * Math.cos(o.node), sign * Math.cos(o.incl)];
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
