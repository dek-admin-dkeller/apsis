/**
 * Eclipses and transits: the moments when one body passes in front of another, predicted
 * from the app's own ephemeris (ephem.ts), for the notification bell's "Happening now" and
 * "Coming up".
 *
 *   eclipses()        solar and lunar eclipses on the Earth
 *   jupiterEvents()   the Galilean moons crossing Jupiter's face, and their shadows crossing it
 *   planetTransits()  Mercury or Venus crossing the Sun, seen from the Earth's centre
 *   skyEvents()       all of them, sorted by start
 *
 * How each is found, cheaply. Nothing steps minute by minute through the window: the bell
 * asks for about sixty days every few minutes, so every search first finds the few moments
 * where an event is POSSIBLE and only then works hard:
 *   - eclipses happen only at new and full moon. Each lunation is found from the mean month
 *     and refined (a few evaluations), and only one that passes close to a node is worked out;
 *   - a transit of Mercury or Venus can only be at an inferior conjunction;
 *   - a Galilean moon (or its shadow) can only cross Jupiter when it passes the planet's
 *     centre line as seen from the Earth (or the Sun): those passings are bracketed with
 *     steps of 1/8 of the moon's orbit, and the limb crossings are then bisected.
 * Results are kept per lunation, per conjunction and per four-day block, so a repeated call
 * costs a few map lookups.
 *
 * Geometry, and what is approximated:
 *   - Solar eclipses use Besselian-style geometry: the shadow axis through the Moon away from
 *     the Sun, the penumbral and umbral cones from the radii of the Sun and the Moon, and the
 *     Earth as the WGS84 ellipsoid (a line hits it when the same line, with the polar axis
 *     stretched by a/b, hits a sphere). Greatest eclipse is, as in NASA's catalogues, the
 *     instant the axis passes closest to the Earth's centre; its place is where the axis meets
 *     the ground (central eclipses) or the point of the Earth's outline nearest the axis
 *     (partial ones). No mountains, no lunar limb profile.
 *   - Lunar eclipses use Danjon's rule for the Earth's shadow, as Espenak's Five Millennium
 *     Canon does: the Earth's radius (its mean radius as seen in the shadow, 0.99834 of the
 *     equatorial one) enlarged by 1 % for the atmosphere, rather than Chauvenet's 2 %.
 *   - Light time and aberration: positions are the apparent ones (the Sun where it was 499 s
 *     earlier as seen from the Earth then; a planet where it was when its light left). For
 *     Jupiter the event is worked out at Jupiter and then dated when its light reaches the
 *     Earth, which is how published tables give it (35–52 minutes later).
 *   - Jupiter is the IAU ellipsoid (71,492 × 66,854 km, its 1-bar level). A transit begins and
 *     ends when the CENTRE of the moon, or of its shadow, is on the edge of the part of the disc
 *     that is both lit and seen from the Earth (IMCCE's convention: "the satellite or its umbra
 *     is bisected"). Away from opposition that edge is the terminator on one side.
 *   - Clock: everything here is Unix ms UTC, like the app; ephem.ts converts to uniform time
 *     itself (TT_MINUS_UTC_MS). The Earth's turn (for places) is UT1 ≈ UTC.
 *   - Where an eclipse is seen is said in coarse words: a path's names come from regionName()
 *     ("North Atlantic", "Europe"), and "partial across …" lists the regions in REGIONS where
 *     at least one sample place sees some of the eclipse with the Sun up.
 *
 * Measured accuracy: scripts/check-sky-events.mjs (part of `npm run check`) compares this with
 * NASA's eclipse and transit catalogues and with IMCCE's tables of the Galilean moons.
 *
 * Pure arithmetic: no DOM, no three.js, importable by Node.
 */

import { regionName } from '../data/regions.ts';
import { BODIES } from './bodies.ts';
import { bodyAxes, bodyPosition, bodyRelative } from './ephem.ts';
import type { BodyId, Vec } from './types.ts';

export type SkyEventKind = 'solar-eclipse' | 'lunar-eclipse' | 'shadow-transit' | 'moon-transit' | 'planet-transit';

export interface SkyEvent {
  /** Stable across calls: 'solar-2026-08-12', 'lunar-2026-08-28', 'io-shadow-2026-11-20T03:14', 'mercury-transit-2032-11-13'. */
  id: string;
  kind: SkyEventKind;
  /** 'Total solar eclipse', 'Io's shadow crosses Jupiter', 'Transit of Mercury'. */
  title: string;
  /** One short line of what was computed: type, duration, where it is seen. */
  detail: string;
  /** Unix ms UTC. Eclipses: first to last contact of the penumbra (P1–P4); transits: centre on the limb in and out. */
  startMs: number;
  /** Greatest eclipse; mid-transit. */
  peakMs: number;
  endMs: number;
  /**
   * Where to look: 'earth' for a solar eclipse (the shadow falls on it), 'moon' for a lunar
   * eclipse (the Moon goes dark), 'jupiter' for the Galilean moons, 'sun' for a transit of a planet.
   */
  body: BodyId;
  /** The body that does the crossing: 'moon' for any eclipse, 'io' …, 'mercury' / 'venus'. */
  subject: BodyId;
  /** 'total' | 'annular' | 'hybrid' | 'partial' | 'penumbral' (eclipses only). */
  subtype?: string;
  /**
   * Eclipse magnitude at greatest eclipse. Solar: the fraction of the Sun's diameter covered
   * (the Moon/Sun size ratio for a central eclipse). Lunar: the UMBRAL magnitude (negative for
   * a penumbral eclipse; see penumbralMagnitude).
   */
  magnitude?: number;
  /** Lunar eclipses: the fraction of the Moon's diameter inside the penumbra at greatest eclipse. */
  penumbralMagnitude?: number;
  /** Distance of the shadow axis from the Earth's centre at greatest eclipse, Earth radii, + when north (as in NASA's tables). */
  gamma?: number;
  /**
   * Solar eclipse: geodetic latitude / longitude (deg, east +) of greatest eclipse, so the
   * app can fly there. Lunar eclipse: the point the Moon is overhead at greatest eclipse (the
   * middle of the half of the Earth that sees it). Transit of a planet: where the Sun is overhead.
   */
  latDeg?: number;
  lonDeg?: number;
  /** Transit of a planet: the least distance of its centre from the Sun's centre, arcseconds (NASA's "minimum separation"). */
  separationArcsec?: number;
  /** Eclipses: the umbral contacts, when there are any (Unix ms UTC). Lunar U1–U4; solar: the central line's ends. */
  partialStartMs?: number;
  partialEndMs?: number;
  totalStartMs?: number;
  totalEndMs?: number;
  /** True = worth an alert (eclipses, transits of Mercury or Venus); false = routine (Jupiter's moons, most days). */
  rare: boolean;
}

// ── Constants ───────────────────────────────────────────────────────────────────────────

const DEG = Math.PI / 180;
const MIN_MS = 60000;
const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const C_KM_MS = 299792.458 / 1000;
/** Light from the Sun takes 499 s to reach the Earth (±8 s over the year: < 1 s of eclipse timing). */
const SUN_LIGHT_MS = 499005;

/** WGS84: the Earth's equatorial radius and flattening (the shape NASA's eclipse maps use). */
const EARTH_A = 6378.137;
const EARTH_F = 1 / 298.257223563;
const EARTH_B = EARTH_A * (1 - EARTH_F);
const EARTH_E2 = EARTH_F * (2 - EARTH_F);
/** Jupiter's 1-bar ellipsoid (IAU WGCCRE 2015). Its mean radius in bodies.ts would put ingress up to three minutes wrong. */
const JUPITER_A = 71492;
const JUPITER_B = 66854;
const R_SUN = BODIES.sun.radiusKm;
const R_MOON = BODIES.moon.radiusKm;
/** Danjon: the Earth's radius enlarged by about 1/85 (written 1.01) for the atmosphere; 0.99834 = its mean radius as the shadow sees it. */
const DANJON = 1.01;
const SHADOW_EARTH = 0.99834;

/** A new moon (2000 Jan 6, 18:14 UTC) and the mean synodic month: where to start looking. */
const NEW_MOON_2000 = Date.UTC(2000, 0, 6, 18, 14);
const SYNODIC_MS = 29.530588861 * DAY_MS;

// ── Small vector helpers ────────────────────────────────────────────────────────────────

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec) => Math.hypot(a[0], a[1], a[2]);
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a: Vec): Vec => scale(a, 1 / (norm(a) || 1));
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * Where the line o + λ·d meets an ellipsoid of revolution centred at the origin (equatorial
 * radius a, polar b, axis `pole`): both λ, smaller first, or null if it misses. Stretching
 * the polar axis by a/b turns the ellipsoid into a sphere and keeps lines straight.
 */
function lineEllipsoid(o: Vec, d: Vec, pole: Vec, a: number, b: number): [number, number] | null {
  const k = a / b - 1;
  const os = add(o, scale(pole, k * dot(o, pole)));
  const ds = add(d, scale(pole, k * dot(d, pole)));
  const A = dot(ds, ds), B = dot(os, ds), C = dot(os, os) - a * a;
  const disc = B * B - A * C;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  return [(-B - root) / A, (-B + root) / A];
}

/**
 * Find the moment in [lo, hi] at which `test` changes from what it is at `lo`, by halving.
 * `test` need not be continuous (a boolean is fine); 16 halvings of a few hours is ~1 s.
 */
function bisect(lo: number, hi: number, test: (t: number) => boolean, steps = 16): number {
  const atLo = test(lo);
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2;
    if (test(mid) === atLo) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The moment a vector `offset(t)` that moves almost uniformly is shortest: fit its motion
 * through three points ten minutes apart and step to where the fitted line passes closest
 * to zero; twice or three times is exact to a second. Used for greatest eclipse and mid-transit.
 */
function closestApproach(t: number, offset: (t: number) => Vec): number {
  const h = 10 * MIN_MS;
  for (let i = 0; i < 5; i++) {
    const w = scale(sub(offset(t + h), offset(t - h)), 1 / (2 * h));
    const dt = -dot(offset(t), w) / dot(w, w);
    t += Math.max(-6 * HOUR_MS, Math.min(6 * HOUR_MS, dt));
    if (Math.abs(dt) < 500) break;
  }
  return t;
}

// ── The Sun and the Moon as seen from the Earth ─────────────────────────────────────────

/** The apparent Sun from the Earth's centre, km, ICRF: where it was when its light left (that carries the aberration too). */
function sunFromEarth(t: number): Vec {
  return scale(bodyPosition('earth', t - SUN_LIGHT_MS), -1);
}

/** The Moon from the Earth's centre, km, ICRF (its 1.3 s of light time and its aberration cancel). */
function moonFromEarth(t: number): Vec {
  return bodyRelative('moon', 'earth', t);
}

/** Ecliptic longitude (J2000) of a vector, degrees. */
const OBL = 23.4392911 * DEG;
function eclipticLon(v: Vec): number {
  return Math.atan2(v[1] * Math.cos(OBL) + v[2] * Math.sin(OBL), v[0]) / DEG;
}
const wrap180 = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

/**
 * The moment the Moon's longitude is `target` degrees ahead of the Sun's (0 new, 180 full),
 * starting from a guess within a few days: Newton's method with the measured rate.
 */
function syzygy(guess: number, target: number): number {
  let t = guess;
  const gap = (time: number) => wrap180(eclipticLon(moonFromEarth(time)) - eclipticLon(sunFromEarth(time)) - target);
  for (let i = 0; i < 6; i++) {
    const g = gap(t);
    const rate = (gap(t + HOUR_MS) - g) / HOUR_MS;
    const dt = -g / (Math.abs(rate) > 1e-9 ? rate : 12.19 / DAY_MS);
    t += dt;
    if (Math.abs(dt) < MIN_MS) break;
  }
  return t;
}

// ── Places on the Earth ─────────────────────────────────────────────────────────────────

/**
 * A few sample places per region, used only to say in words where an eclipse or transit is
 * seen. A region is named when ANY of its places sees a solar eclipse (Sun up, inside the
 * penumbra), or when at least half of them have the Moon (or the Sun) up at mid-event.
 */
const REGIONS: [name: string, places: [lat: number, lon: number][]][] = [
  ['North America', [[45, -75], [40, -90], [37, -120], [50, -115], [61, -150], [30, -97], [55, -100]]],
  ['Mexico and Central America', [[19, -99], [14, -87], [9, -80]]],
  ['South America', [[-23, -46], [-34, -58], [-12, -77], [5, -74], [-3, -60], [-45, -70]]],
  ['Greenland and Iceland', [[64, -51], [72, -40], [64, -21]]],
  ['Europe', [[51, 0], [40, -4], [48, 2], [52, 13], [42, 12], [60, 25], [55, 37], [38, 24], [64, 18]]],
  ['Africa', [[30, 31], [6, 3], [-1, 37], [-26, 28], [-34, 18], [15, -17], [12, 15], [-12, 30], [34, -6]]],
  ['the Middle East', [[24, 46], [32, 35], [35, 51]]],
  ['Russia', [[62, 90], [55, 83], [64, 130], [60, 60]]],
  ['Central Asia', [[43, 77], [41, 69]]],
  ['South Asia', [[28, 77], [19, 73], [13, 80], [23, 90]]],
  ['East Asia', [[39, 116], [31, 121], [23, 113], [35, 139], [37, 127], [43, 141]]],
  ['Southeast Asia', [[14, 100], [-6, 107], [14, 121], [3, 102]]],
  ['Australia', [[-34, 151], [-38, 145], [-32, 116], [-12, 131], [-27, 153], [-25, 134]]],
  ['New Zealand', [[-41, 175], [-45, 169]]],
  ['the Pacific islands', [[21, -157], [-18, 178], [-17, -150], [13, 145]]],
  ['Antarctica', [[-78, 166], [-70, 0], [-75, -100], [-68, 78]]],
];

/** The sample places as points fixed to the Earth (x towards longitude 0, z north), km on the ellipsoid. */
const PLACES: { region: number; fixed: Vec }[] = [];
REGIONS.forEach(([, places], region) => {
  for (const [lat, lon] of places) PLACES.push({ region, fixed: geodeticToFixed(lat, lon) });
});

function geodeticToFixed(latDeg: number, lonDeg: number): Vec {
  const phi = latDeg * DEG, lam = lonDeg * DEG;
  const n = EARTH_A / Math.sqrt(1 - EARTH_E2 * Math.sin(phi) ** 2);
  return [n * Math.cos(phi) * Math.cos(lam), n * Math.cos(phi) * Math.sin(lam), n * (1 - EARTH_E2) * Math.sin(phi)];
}

interface EarthAxes { pole: Vec; prime: Vec; east: Vec }
function earthAxes(t: number): EarthAxes {
  const { pole, prime } = bodyAxes('earth', t);
  return { pole, prime, east: cross(pole, prime) };
}
const toSpace = (v: Vec, ax: EarthAxes): Vec => add(add(scale(ax.prime, v[0]), scale(ax.east, v[1])), scale(ax.pole, v[2]));

/** Geodetic latitude and longitude (degrees, east +) of a point given in ICRF km from the Earth's centre. */
function latLon(p: Vec, ax: EarthAxes, geodetic = true): [number, number] {
  const x = dot(p, ax.prime), y = dot(p, ax.east), z = dot(p, ax.pole);
  const lat = Math.atan2(z, (geodetic ? 1 - EARTH_E2 : 1) * Math.hypot(x, y)) / DEG;
  return [lat, Math.atan2(y, x) / DEG];
}

/** Regions where at least half the sample places have `dir` (a unit vector from the Earth's centre) above the horizon. */
function regionsFacing(dir: Vec, ax: EarthAxes): string[] {
  const up = REGIONS.map(() => [0, 0]);
  for (const place of PLACES) {
    up[place.region][1]++;
    if (dot(toSpace(place.fixed, ax), dir) > 0) up[place.region][0]++;
  }
  return REGIONS.filter((_, i) => up[i][0] * 2 >= up[i][1]).map(([name]) => name);
}

// ── Words ───────────────────────────────────────────────────────────────────────────────

function list(names: string[], most = 4): string {
  const shown = names.slice(0, most);
  if (names.length > most) shown.push(`${names.length - most} more`);
  return shown.length <= 1 ? (shown[0] ?? '') : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
}

function lasting(ms: number): string {
  const minutes = Math.round(ms / MIN_MS);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const capital = (s: string) => s[0].toUpperCase() + s.slice(1);
const dateId = (t: number) => new Date(t).toISOString().slice(0, 10);
const minuteId = (t: number) => new Date(t).toISOString().slice(0, 16);

// ── Solar eclipses ──────────────────────────────────────────────────────────────────────

/**
 * The Moon's shadow at a moment, in the spirit of Besselian elements: G is the axis (from
 * the Moon towards the Sun), c the axis's offset from the Earth's centre (km, square to G),
 * l1 / l2 the radii of the penumbra / umbra in the plane through the Earth's centre square to
 * the axis (l2 < 0: the umbra still has width there, so the eclipse is total), tan1 / tan2 how
 * fast they change with height above that plane.
 */
interface Shadow { G: Vec; c: Vec; l1: number; l2: number; tan1: number; tan2: number }

function moonShadow(t: number): Shadow {
  const s = sunFromEarth(t), m = moonFromEarth(t);
  const sm = sub(s, m), d = norm(sm), G = scale(sm, 1 / d);
  const zm = dot(m, G);
  const sin1 = (R_SUN + R_MOON) / d, sin2 = (R_SUN - R_MOON) / d;
  const cos1 = Math.sqrt(1 - sin1 * sin1), cos2 = Math.sqrt(1 - sin2 * sin2);
  const tan1 = sin1 / cos1, tan2 = sin2 / cos2;
  return { G, c: sub(m, scale(G, zm)), l1: zm * tan1 + R_MOON / cos1, l2: zm * tan2 - R_MOON / cos2, tan1, tan2 };
}

/** How far the Earth's outline reaches from its centre in the direction u (square to the axis): the ellipsoid's support distance. */
function outline(u: Vec, pole: Vec): number {
  const up = dot(u, pole);
  return Math.sqrt(EARTH_A * EARTH_A * (1 - up * up) + EARTH_B * EARTH_B * up * up);
}

/** How far outside the Earth's outline the axis passes, km (negative: it crosses the outline). */
function axisMiss(sh: Shadow, pole: Vec): number {
  const r = norm(sh.c);
  return r - outline(scale(sh.c, 1 / r), pole);
}

/** Where the axis meets the ground on the Sun's side, and the umbra's L2 there; null if it misses. */
function axisGround(sh: Shadow, pole: Vec): { point: Vec; L1: number; L2: number } | null {
  const hit = lineEllipsoid(sh.c, sh.G, pole, EARTH_A, EARTH_B);
  if (!hit) return null;
  const zeta = hit[1]; // c is square to G, so λ is the height above the fundamental plane
  return { point: add(sh.c, scale(sh.G, zeta)), L1: sh.l1 - zeta * sh.tan1, L2: sh.l2 - zeta * sh.tan2 };
}

function solarEclipse(newMoon: number): SkyEvent | null {
  // At conjunction in longitude the axis is within a few percent of its closest pass.
  if (norm(moonShadow(newMoon).c) > 1.75 * EARTH_A) return null;
  const peak = closestApproach(newMoon, (t) => moonShadow(t).c);
  const sh = moonShadow(peak);
  const ax = earthAxes(peak);
  const miss = axisMiss(sh, ax.pole);
  if (miss > sh.l1) return null;

  const r = norm(sh.c);
  const gamma = (Math.sign(dot(sh.c, ax.pole)) * r) / EARTH_A;
  const ground = axisGround(sh, ax.pole);

  // P1 and P4: the penumbra first and last touches the Earth's outline.
  const outside = (t: number) => {
    const s = moonShadow(t);
    return axisMiss(s, bodyAxes('earth', t).pole) > s.l1;
  };
  const startMs = bisect(peak - 5 * HOUR_MS, peak, outside);
  const endMs = bisect(peak, peak + 5 * HOUR_MS, outside);

  let subtype: string, magnitude: number, point: Vec;
  let pathNames: string[] = [];
  let centralStart: number | undefined, centralEnd: number | undefined;
  if (ground) {
    subtype = ground.L2 < 0 ? 'total' : 'annular';
    magnitude = (ground.L1 - ground.L2) / (ground.L1 + ground.L2);
    point = ground.point;
    // The central line: from where the axis first touches the Earth to where it leaves.
    const hits = (t: number) => lineEllipsoid(moonShadow(t).c, moonShadow(t).G, bodyAxes('earth', t).pole, EARTH_A, EARTH_B) !== null;
    centralStart = bisect(peak - 4 * HOUR_MS, peak, hits);
    centralEnd = bisect(peak, peak + 4 * HOUR_MS, hits);
    // Walk it: name the places it crosses, and see whether the eclipse changes type on the way (a hybrid).
    const steps = 30;
    for (let i = 0; i <= steps; i++) {
      // Stay a whisker inside the ends, where the axis grazes the limb.
      const t = centralStart + ((centralEnd - centralStart) * (0.005 + (0.99 * i) / steps));
      const s = moonShadow(t), a = earthAxes(t), g = axisGround(s, a.pole);
      if (!g) continue;
      if ((g.L2 < 0) !== (ground.L2 < 0)) subtype = 'hybrid';
      const [lat, lon] = latLon(g.point, a);
      const name = regionName(lat, lon);
      if (name !== 'Open ocean' && name !== 'Land' && !pathNames.includes(name)) pathNames.push(name);
    }
  } else {
    // Not central: the nearest point of the Earth's outline to the axis is where most is seen.
    const u = scale(sh.c, 1 / r);
    const up = dot(u, ax.pole);
    const h = outline(u, ax.pole);
    point = scale(add(scale(sub(u, scale(ax.pole, up)), EARTH_A * EARTH_A), scale(ax.pole, EARTH_B * EARTH_B * up)), 1 / h);
    magnitude = (sh.l1 - miss) / (sh.l1 + sh.l2);
    // A non-central total or annular eclipse: the umbra's edge grazes the polar regions.
    subtype = miss < Math.abs(sh.l2) ? (sh.l2 < 0 ? 'total' : 'annular') : 'partial';
  }
  const [latDeg, lonDeg] = latLon(point, ax);

  // Where it is seen at all: sample places inside the penumbra with the Sun up, every 6 min.
  const best = REGIONS.map(() => 0);
  for (let t = startMs; t <= endMs; t += 6 * MIN_MS) {
    const s = moonShadow(t), a = earthAxes(t);
    for (const place of PLACES) {
      const q = toSpace(place.fixed, a);
      const zeta = dot(q, s.G);
      if (zeta <= 0) continue; // the Sun is below this place's horizon
      const off = norm(sub(s.c, sub(q, scale(s.G, zeta))));
      const L1 = s.l1 - zeta * s.tan1, L2 = s.l2 - zeta * s.tan2;
      if (off < L1) best[place.region] = Math.max(best[place.region], (L1 - off) / (L1 + L2));
    }
  }
  const seen = REGIONS.map(([name], i) => [name, best[i]] as const).filter(([, m]) => m > 0).sort((a, b) => b[1] - a[1]).map(([name]) => name);

  const names: Record<string, string> = { total: 'Total', annular: 'Annular', hybrid: 'Hybrid', partial: 'Partial' };
  let detail: string;
  if (ground) {
    const path = pathNames.length ? `${names[subtype]} on a path over ${list(pathNames, 5)}` : `${names[subtype]} on a path over open ocean`;
    detail = seen.length ? `${path} · partial across ${list(seen)}` : path;
  } else {
    const how = subtype === 'partial' ? `Partial, up to ${Math.round(magnitude * 100)} % of the Sun's width covered` : `${names[subtype]} only near the pole, partial elsewhere`;
    detail = seen.length ? `${how} · seen from ${list(seen)}` : how;
  }
  return {
    id: `solar-${dateId(peak)}`,
    kind: 'solar-eclipse',
    title: `${names[subtype]} solar eclipse`,
    detail,
    startMs: Math.round(startMs), peakMs: Math.round(peak), endMs: Math.round(endMs),
    body: 'earth', subject: 'moon', subtype, magnitude, gamma, latDeg, lonDeg,
    totalStartMs: centralStart === undefined ? undefined : Math.round(centralStart),
    totalEndMs: centralEnd === undefined ? undefined : Math.round(centralEnd),
    rare: true,
  };
}

// ── Lunar eclipses ──────────────────────────────────────────────────────────────────────

/** The Moon and the Earth's shadow at a moment, as angles seen from the Earth's centre (radians). */
interface Umbra { q: Vec; sep: number; umbra: number; penumbra: number; moon: number; m: Vec }

function earthShadow(t: number): Umbra {
  const s = sunFromEarth(t), m = moonFromEarth(t);
  const anti = scale(unit(s), -1);
  const along = dot(m, anti), q = sub(m, scale(anti, along));
  const dm = norm(m), ds = norm(s);
  const moonParallax = SHADOW_EARTH * Math.asin(EARTH_A / dm);
  const sunParallax = Math.asin(EARTH_A / ds), sunRadius = Math.asin(R_SUN / ds);
  return {
    q, m,
    sep: Math.atan2(norm(q), along),
    umbra: DANJON * moonParallax - sunRadius + sunParallax,
    penumbra: DANJON * moonParallax + sunRadius + sunParallax,
    moon: Math.asin(R_MOON / dm),
  };
}

function lunarEclipse(fullMoon: number): SkyEvent | null {
  if (earthShadow(fullMoon).sep > 2.2 * DEG) return null;
  const peak = closestApproach(fullMoon, (t) => earthShadow(t).q);
  const at = earthShadow(peak);
  const penumbralMagnitude = (at.penumbra + at.moon - at.sep) / (2 * at.moon);
  if (penumbralMagnitude <= 0) return null;
  const magnitude = (at.umbra + at.moon - at.sep) / (2 * at.moon);
  const subtype = magnitude >= 1 ? 'total' : magnitude > 0 ? 'partial' : 'penumbral';

  // Contacts: the Moon's edge meets the edge of the penumbra (P1, P4) or the umbra (U1, U4),
  // or is wholly inside the umbra (U2, U3).
  const contact = (edge: (u: Umbra) => number) => {
    const out = (t: number) => {
      const u = earthShadow(t);
      return u.sep > edge(u);
    };
    return [Math.round(bisect(peak - 5 * HOUR_MS, peak, out)), Math.round(bisect(peak, peak + 5 * HOUR_MS, out))];
  };
  const [startMs, endMs] = contact((u) => u.penumbra + u.moon);
  const [partialStartMs, partialEndMs] = magnitude > 0 ? contact((u) => u.umbra + u.moon) : [undefined, undefined];
  const [totalStartMs, totalEndMs] = magnitude >= 1 ? contact((u) => u.umbra - u.moon) : [undefined, undefined];

  const ax = earthAxes(peak);
  const [latDeg, lonDeg] = latLon(at.m, ax, false);
  const pole = bodyAxes('earth', peak).pole;
  const gamma = (Math.sign(dot(at.q, pole)) * norm(at.q)) / EARTH_A;
  const up = regionsFacing(unit(at.m), ax);
  const where = up.length ? ` · Moon up at mid-eclipse over ${list(up)}` : '';
  const how =
    subtype === 'total' ? `Total for ${lasting(totalEndMs! - totalStartMs!)}`
    : subtype === 'partial' ? `Partial, ${Math.round(magnitude * 100)} % of the Moon's width in the dark umbra`
    : 'Penumbral: only a faint shading, easy to miss';
  return {
    id: `lunar-${dateId(peak)}`,
    kind: 'lunar-eclipse',
    title: `${capital(subtype)} lunar eclipse`,
    detail: how + where,
    startMs, peakMs: Math.round(peak), endMs,
    body: 'moon', subject: 'moon', subtype, magnitude, penumbralMagnitude, gamma, latDeg, lonDeg,
    partialStartMs, partialEndMs, totalStartMs, totalEndMs,
    rare: true,
  };
}

const lunations = new Map<number, SkyEvent | null>();

/** The eclipse (or none) at lunation k: 2k is a new moon (solar), 2k + 1 the full moon after it (lunar). */
function eclipseAt(half: number): SkyEvent | null {
  let found = lunations.get(half);
  if (found === undefined) {
    const full = half % 2 !== 0;
    const guess = NEW_MOON_2000 + (half / 2) * SYNODIC_MS;
    const t = syzygy(guess, full ? 180 : 0);
    found = full ? lunarEclipse(t) : solarEclipse(t);
    lunations.set(half, found);
  }
  return found;
}

/** Solar and lunar eclipses on the Earth that are under way at any moment of [fromMs, toMs], soonest first. */
export function eclipses(fromMs: number, toMs: number): SkyEvent[] {
  const first = Math.floor(((fromMs - NEW_MOON_2000) / SYNODIC_MS) * 2) - 1;
  const last = Math.ceil(((toMs - NEW_MOON_2000) / SYNODIC_MS) * 2) + 1;
  const out: SkyEvent[] = [];
  for (let half = first; half <= last; half++) {
    const e = eclipseAt(half);
    if (e && e.endMs >= fromMs && e.startMs <= toMs) out.push(e);
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

// ── Transits of Mercury and Venus ───────────────────────────────────────────────────────

/** An inferior conjunction of each (2019 Nov 11 and 2020 Jun 3) and the mean synodic period. */
const INFERIOR: Record<'mercury' | 'venus', [epoch: number, period: number]> = {
  mercury: [Date.UTC(2019, 10, 11, 15, 20), 115.8775 * DAY_MS],
  venus: [Date.UTC(2020, 5, 3, 17, 43), 583.924 * DAY_MS],
};

/** The planet and the Sun, apparent, from the Earth's centre (the planet where its light left it). */
function planetAndSun(planet: 'mercury' | 'venus', t: number): { p: Vec; s: Vec } {
  const e = bodyPosition('earth', t);
  const tau = norm(sub(bodyPosition(planet, t), e)) / C_KM_MS;
  return { p: sub(bodyPosition(planet, t - tau), bodyPosition('earth', t - tau)), s: sunFromEarth(t) };
}

/** The planet's offset from the Sun's centre on the sky, as a vector of radians square to the Sun's direction. */
function offsetFromSun(planet: 'mercury' | 'venus', t: number): Vec {
  const { p, s } = planetAndSun(planet, t);
  const sh = unit(s), ph = unit(p);
  return sub(ph, scale(sh, dot(ph, sh)));
}

const conjunctions = new Map<string, SkyEvent | null>();

function planetTransitAt(planet: 'mercury' | 'venus', k: number): SkyEvent | null {
  const key = `${planet}${k}`;
  const kept = conjunctions.get(key);
  if (kept !== undefined) return kept;
  const [epoch, period] = INFERIOR[planet];
  const guess = epoch + k * period;
  // Find where the planet's longitude passes the Sun's on the near side: scan ±30 days
  // (Mercury's eccentric orbit moves its conjunctions a week or more from the mean) with plain
  // geometric positions, which are enough to find the day, then halve with the apparent ones.
  const rough = (t: number) => {
    const e = bodyPosition('earth', t);
    const p = sub(bodyPosition(planet, t), e);
    return { gap: wrap180(eclipticLon(p) + 180 - eclipticLon(e)), near: norm(p) < norm(e) };
  };
  const gap = (t: number) => {
    const { p, s } = planetAndSun(planet, t);
    return wrap180(eclipticLon(p) - eclipticLon(s));
  };
  let conj: number | null = null;
  const step = 3 * DAY_MS;
  let a = rough(guess - 30 * DAY_MS);
  for (let t = guess - 30 * DAY_MS; t < guess + 30 * DAY_MS && conj === null; t += step) {
    const b = rough(t + step);
    // Near inferior conjunction the planet moves backwards against the Sun: + to −.
    if (a.near && a.gap > 0 && b.gap <= 0 && a.gap - b.gap < 90) conj = bisect(t - DAY_MS, t + step + DAY_MS, (x) => gap(x) > 0, 20);
    a = b;
  }
  let found: SkyEvent | null = null;
  if (conj !== null && norm(offsetFromSun(planet, conj)) < 0.6 * DEG) {
    const peak = closestApproach(conj, (t) => offsetFromSun(planet, t));
    const radii = (t: number) => {
      const { p, s } = planetAndSun(planet, t);
      return Math.asin(R_SUN / norm(s)) + Math.asin(BODIES[planet].radiusKm / norm(p));
    };
    const sep = Math.asin(norm(offsetFromSun(planet, peak)));
    if (sep < radii(peak)) {
      const off = (t: number) => Math.asin(norm(offsetFromSun(planet, t))) > radii(t);
      const startMs = Math.round(bisect(peak - 10 * HOUR_MS, peak, off, 18));
      const endMs = Math.round(bisect(peak, peak + 10 * HOUR_MS, off, 18));
      const ax = earthAxes(peak);
      const sun = unit(sunFromEarth(peak));
      const [latDeg, lonDeg] = latLon(sun, ax, false);
      const up = regionsFacing(sun, ax);
      const name = BODIES[planet].name;
      found = {
        id: `${planet}-transit-${dateId(peak)}`,
        kind: 'planet-transit',
        title: `Transit of ${name}`,
        detail: `${name} crosses the Sun's face for ${lasting(endMs - startMs)} (look only through a solar filter)${up.length ? ` · Sun up at mid-transit over ${list(up)}` : ''}`,
        startMs, peakMs: Math.round(peak), endMs,
        body: 'sun', subject: planet, latDeg, lonDeg, separationArcsec: (sep / DEG) * 3600,
        rare: true,
      };
    }
  }
  conjunctions.set(key, found);
  return found;
}

/** Mercury or Venus crossing the Sun, seen from the Earth's centre, under way at any moment of [fromMs, toMs]. */
export function planetTransits(fromMs: number, toMs: number): SkyEvent[] {
  const out: SkyEvent[] = [];
  for (const planet of ['mercury', 'venus'] as const) {
    const [epoch, period] = INFERIOR[planet];
    // A conjunction is within 30 days of its mean date and a transit lasts under a day.
    const first = Math.ceil((fromMs - 31 * DAY_MS - epoch) / period), last = Math.floor((toMs + 31 * DAY_MS - epoch) / period);
    for (let k = first; k <= last; k++) {
      const e = planetTransitAt(planet, k);
      if (e && e.endMs >= fromMs && e.startMs <= toMs) out.push(e);
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

// ── Jupiter's moons ─────────────────────────────────────────────────────────────────────

const GALILEAN: { id: BodyId; name: string }[] = [
  { id: 'io', name: 'Io' }, { id: 'europa', name: 'Europa' }, { id: 'ganymede', name: 'Ganymede' }, { id: 'callisto', name: 'Callisto' },
];

/**
 * What changes slowly round Jupiter, for an OBSERVER's moment t: the light time τ, Jupiter's
 * place from the Sun at t − τ, the Earth seen from Jupiter (Earth at t), Jupiter's pole and its
 * angle from the Sun in our sky. Worked out every twelve hours and interpolated in between:
 * the Earth's curving path makes that at most 1,500 km out at 600 million km, which moves a
 * Galilean event by a fraction of a second, and it saves a full Moon series per evaluation.
 */
interface Slow { tau: number; jupiter: Vec; toEarth: Vec; pole: Vec; elongation: number }
const SLOW_STEP = 12 * HOUR_MS;
const slowNodes = new Map<number, Slow>();

function slowNode(k: number): Slow {
  let node = slowNodes.get(k);
  if (!node) {
    const t = k * SLOW_STEP;
    const earth = bodyPosition('earth', t);
    let tau = norm(sub(bodyPosition('jupiter', t), earth)) / C_KM_MS;
    let jupiter = bodyPosition('jupiter', t - tau);
    tau = norm(sub(jupiter, earth)) / C_KM_MS;
    jupiter = bodyPosition('jupiter', t - tau);
    const toEarth = sub(earth, jupiter);
    const elongation = Math.acos(Math.max(-1, Math.min(1, dot(unit(scale(toEarth, -1)), unit(scale(earth, -1)))))) / DEG;
    node = { tau, jupiter, toEarth, pole: bodyAxes('jupiter', t - tau).pole, elongation };
    if (slowNodes.size > 2000) slowNodes.clear();
    slowNodes.set(k, node);
  }
  return node;
}

function slowAt(t: number): Slow {
  const k = Math.floor(t / SLOW_STEP), f = t / SLOW_STEP - k;
  const a = slowNode(k), b = slowNode(k + 1);
  const mix = (x: Vec, y: Vec): Vec => [x[0] + (y[0] - x[0]) * f, x[1] + (y[1] - x[1]) * f, x[2] + (y[2] - x[2]) * f];
  return { tau: a.tau + (b.tau - a.tau) * f, jupiter: mix(a.jupiter, b.jupiter), toEarth: mix(a.toEarth, b.toEarth), pole: a.pole, elongation: a.elongation };
}

type JovianKind = 'shadow' | 'transit';

/**
 * The geometry at observer time t: the moon's place about Jupiter (km, ICRF, at the moment
 * its light left) and the direction the relevant line runs past it: away from the Sun for its
 * shadow, away from the Earth for the moon itself.
 */
function jovian(moon: BodyId, kind: JovianKind, t: number): { r: Vec; d: Vec; slow: Slow } {
  const slow = slowAt(t);
  const r = bodyRelative(moon, 'jupiter', t - slow.tau);
  const d = kind === 'shadow' ? unit(add(slow.jupiter, r)) : unit(sub(r, slow.toEarth));
  return { r, d, slow };
}

/** Is the centre of the moon (transit) or of its shadow (shadow) on Jupiter's disc as seen from the Earth at t? */
function onDisc(moon: BodyId, kind: JovianKind, t: number): boolean {
  const { r, d, slow } = jovian(moon, kind, t);
  const hit = lineEllipsoid(r, d, slow.pole, JUPITER_A, JUPITER_B);
  if (!hit || hit[0] <= 0) return false; // misses the planet, or the moon is behind it
  // Either way it must be where the disc is both lit and turned towards the Earth. For a
  // shadow (cast on the lit side) that rules out the strip of lit cloud we cannot see; for the
  // moon itself, the strip of the near side the Sun does not reach: away from opposition the
  // dark limb is up to 1,300 km wide, and a moon crossing it is not seen against the bright
  // disc (IMCCE's times say the same: without this, ingress came a minute early after
  // opposition and egress a minute late before it).
  const p = add(r, scale(d, hit[0]));
  const along = dot(p, slow.pole);
  const normal = add(scale(sub(p, scale(slow.pole, along)), 1 / (JUPITER_A * JUPITER_A)), scale(slow.pole, along / (JUPITER_B * JUPITER_B)));
  return dot(normal, sub(slow.toEarth, p)) > 0 && dot(normal, add(slow.jupiter, p)) < 0;
}

/** Sideways offset of the moon from the line through Jupiter's centre (+ / − either side), and whether it is on the near side. */
function across(moon: BodyId, kind: JovianKind, t: number): { x: number; near: boolean } {
  const { r, d, slow } = jovian(moon, kind, t);
  return { x: dot(r, unit(cross(slow.pole, d))), near: dot(r, d) < 0 };
}

const BLOCK_MS = 4 * DAY_MS;
const blocks = new Map<number, SkyEvent[]>();

/** Every Galilean shadow and moon transit whose middle falls in block k ([k·4 d, (k+1)·4 d) of Unix time). */
function jupiterBlock(k: number): SkyEvent[] {
  const kept = blocks.get(k);
  if (kept) return kept;
  const from = k * BLOCK_MS, to = from + BLOCK_MS;
  const found: SkyEvent[] = [];
  for (const { id, name } of GALILEAN) {
    const period = BODIES[id].periodDays * DAY_MS;
    // Eight steps an orbit: a passing on the near side is always bracketed by two near points.
    const step = period / 8;
    // The longest a centre can take to cross the disc's radius, with room to spare.
    const orbitKm = norm(bodyRelative(id, 'jupiter', from));
    const reach = (1.6 * JUPITER_A) / ((2 * Math.PI * orbitKm) / period);
    for (const kind of ['shadow', 'transit'] as const) {
      let prev = across(id, kind, from);
      for (let t = from; t < to; t += step) {
        const next = across(id, kind, t + step);
        if (prev.near && next.near && Math.sign(prev.x) !== Math.sign(next.x)) {
          const sign0 = Math.sign(prev.x);
          // To within a minute or so: it only has to be inside the crossing.
          const mid = bisect(t, t + step, (x) => Math.sign(across(id, kind, x).x) === sign0, 10);
          if (mid < to && onDisc(id, kind, mid)) {
            let back = reach;
            while (onDisc(id, kind, mid - back) && back < 4 * reach) back *= 1.5;
            let ahead = reach;
            while (onDisc(id, kind, mid + ahead) && ahead < 4 * reach) ahead *= 1.5;
            // 13 halvings of the bracket: about a second for Io, three for Callisto.
            const startMs = Math.round(bisect(mid - back, mid, (x) => onDisc(id, kind, x), 13));
            const endMs = Math.round(bisect(mid, mid + ahead, (x) => onDisc(id, kind, x), 13));
            const peakMs = Math.round((startMs + endMs) / 2);
            const slow = slowAt(peakMs);
            const hidden = slow.elongation < 15 ? ' · Jupiter is too close to the Sun to see' : '';
            found.push({
              id: `${id}-${kind}-${minuteId(peakMs)}`,
              kind: kind === 'shadow' ? 'shadow-transit' : 'moon-transit',
              title: kind === 'shadow' ? `${name}'s shadow crosses Jupiter` : `${name} crosses Jupiter`,
              detail: `${kind === 'shadow' ? 'A black dot on the cloud tops' : 'In front of the disc'} for ${lasting(endMs - startMs)}${hidden}`,
              startMs, peakMs, endMs,
              body: 'jupiter', subject: id,
              rare: false,
            });
          }
        }
        prev = next;
      }
    }
  }
  if (blocks.size > 400) blocks.clear();
  blocks.set(k, found);
  return found;
}

/**
 * The Galilean moons' shadow transits (a moon's shadow on Jupiter's face) and transits (the
 * moon itself in front of it, as seen from the Earth) under way at any moment of
 * [fromMs, toMs], dated as seen from the Earth. When two shadows are on the face at once,
 * each says so.
 */
export function jupiterEvents(fromMs: number, toMs: number): SkyEvent[] {
  // An event is filed under the block of its middle; none lasts more than six hours.
  const first = Math.floor((fromMs - 6 * HOUR_MS) / BLOCK_MS), last = Math.floor((toMs + 6 * HOUR_MS) / BLOCK_MS);
  const all: SkyEvent[] = [];
  for (let k = first; k <= last; k++) all.push(...jupiterBlock(k));
  const out = all.filter((e) => e.endMs >= fromMs && e.startMs <= toMs).sort((a, b) => a.startMs - b.startMs);
  return out.map((e) => {
    if (e.kind !== 'shadow-transit') return e;
    const other = all.filter((o) => o !== e && o.kind === 'shadow-transit' && o.startMs < e.endMs && o.endMs > e.startMs);
    if (!other.length) return e;
    const names = other.map((o) => GALILEAN.find((g) => g.id === o.subject)!.name);
    return { ...e, detail: `${e.detail} · ${list(names)}'s shadow ${other.length > 1 ? 'are' : 'is'} there too` };
  });
}

/** Everything above, under way at any moment of [fromMs, toMs], sorted by start. */
export function skyEvents(fromMs: number, toMs: number): SkyEvent[] {
  return [...eclipses(fromMs, toMs), ...planetTransits(fromMs, toMs), ...jupiterEvents(fromMs, toMs)].sort((a, b) => a.startMs - b.startMs);
}
