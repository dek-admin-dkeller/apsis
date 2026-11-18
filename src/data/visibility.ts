/**
 * Can it be seen from the ground? The geometry and the brightness estimate behind
 * "Visible tonight" (features/tonight.ts; the search itself runs in worker/tonight.worker.ts).
 *
 * A satellite does not shine: it reflects the Sun. It can be seen with the naked eye when
 * three things are true at the same moment:
 *   1. it is in sunlight (outside the Earth's shadow),
 *   2. the observer is in darkness — the Sun at least 6° below their horizon,
 *   3. it is at least 10° above the observer's horizon (lower down, haze and rooftops hide it).
 * All three hold mostly in the hour or two after dusk and before dawn, when the ground is
 * dark but something a few hundred kilometres up is still catching the Sun.
 *
 * Everything here is plain arithmetic on numbers (no DOM), so the worker, the page and the
 * Node check (scripts/check-visibility.mjs) run exactly the same code.
 */

import { geodeticToEcf, gstime, type SatRec } from 'satellite.js';
import { semiMajorAxisKm } from './categorize.ts';
import { isSunlit, stateAt, sunDirection, type Vec3 } from './ephemeris.ts';
import type { CatalogFacts } from './satcat.ts';
import type { Satellite } from './types.ts';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const EARTH_RADIUS_KM = 6378.137; // equatorial, the same value categorize.ts uses for altitudes

/** The observer counts as "in darkness" once the Sun is this far below the horizon (the end of civil twilight). */
export const DARK_SUN_DEG = -6;
/** Lowest height above the horizon that counts as visible. */
export const MIN_ELEVATION_DEG = 10;
/** Fainter than this cannot be seen without binoculars even under a dark sky. */
export const NAKED_EYE_LIMIT = 6;

const julianDate = (timeMs: number): number => timeMs / 86400000 + 2440587.5;

// ---------------------------------------------------------------- the observer's sky

/**
 * A place on the ground, prepared once for many look-ups: where it is and which way its
 * east, north and up point, all in the frame that turns with the Earth.
 */
export interface Site {
  latDeg: number;
  lonDeg: number;
  position: Vec3; // km
  east: Vec3;
  north: Vec3;
  up: Vec3;
}

export function makeSite(latDeg: number, lonDeg: number): Site {
  const lat = latDeg * RAD, lon = lonDeg * RAD;
  return {
    latDeg, lonDeg,
    position: geodeticToEcf({ latitude: lat, longitude: lon, height: 0 }),
    east: { x: -Math.sin(lon), y: Math.cos(lon), z: 0 },
    north: { x: -Math.sin(lat) * Math.cos(lon), y: -Math.sin(lat) * Math.sin(lon), z: Math.cos(lat) },
    up: { x: Math.cos(lat) * Math.cos(lon), y: Math.cos(lat) * Math.sin(lon), z: Math.sin(lat) },
  };
}

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * Inertial frame → the frame fixed to the Earth: a turn about the polar axis by the sidereal
 * angle `gmst` (how far the Earth has rotated). SGP4 and the Sun direction are inertial; the
 * observer is fixed to the ground, so everything is compared in the Earth's frame.
 */
function toEarthFrame(v: Vec3, gmst: number): Vec3 {
  const c = Math.cos(gmst), s = Math.sin(gmst);
  return { x: v.x * c + v.y * s, y: -v.x * s + v.y * c, z: v.z };
}

/** Height of the Sun above the observer's horizon in degrees (negative = below it). */
export function sunElevationDeg(timeMs: number, site: Site): number {
  const sun = toEarthFrame(sunDirection(timeMs), gstime(julianDate(timeMs)));
  return Math.asin(Math.max(-1, Math.min(1, dot(sun, site.up)))) * DEG;
}

/** Where an object is in the observer's sky at one instant, and whether it could be seen. */
export interface Sighting {
  azDeg: number; // compass direction, 0 = north, 90 = east
  elDeg: number; // height above the horizon
  rangeKm: number; // distance from the observer
  sunElDeg: number;
  sunlit: boolean;
  /** Sun–object–observer angle: 0° = its lit face is turned toward the observer, 180° = seen from behind. */
  phaseDeg: number;
  /** Sunlit, high enough, and the sky dark enough — all at once. */
  visible: boolean;
}

function sight(position: Vec3, sun: Vec3, gmst: number, site: Site): Sighting {
  const p = toEarthFrame(position, gmst), s = toEarthFrame(sun, gmst);
  const line = { x: p.x - site.position.x, y: p.y - site.position.y, z: p.z - site.position.z }; // observer → object
  const rangeKm = Math.hypot(line.x, line.y, line.z) || 1;
  const elDeg = Math.asin(dot(line, site.up) / rangeKm) * DEG;
  const azDeg = (Math.atan2(dot(line, site.east), dot(line, site.north)) * DEG + 360) % 360;
  const sunElDeg = Math.asin(Math.max(-1, Math.min(1, dot(s, site.up)))) * DEG;
  // Seen from the object, the Sun lies along `s` (it is so far away that the direction is the
  // same as from the Earth's centre) and the observer lies along −line.
  const phaseDeg = Math.acos(Math.max(-1, Math.min(1, -dot(line, s) / rangeKm))) * DEG;
  const sunlit = isSunlit(position, sun);
  return { azDeg, elDeg, rangeKm, sunElDeg, sunlit, phaseDeg, visible: sunlit && elDeg >= MIN_ELEVATION_DEG && sunElDeg <= DARK_SUN_DEG };
}

/** The exact picture at one instant (SGP4 + the Sun's position for that moment), or null if SGP4 fails. */
export function sightingAt(satrec: SatRec, timeMs: number, site: Site): Sighting | null {
  const state = stateAt(satrec, timeMs);
  return state ? sight(state.position, sunDirection(timeMs), gstime(julianDate(timeMs)), site) : null;
}

// ---------------------------------------------------------------- brightness (an estimate)

/**
 * How bright will it look? Astronomers' magnitudes run backwards: smaller is brighter, and
 * 5 magnitudes are a factor of 100 in light. Sirius, the brightest star, is −1.5; the
 * faintest stars seen without help under a dark sky are about +6.
 *
 *   m  =  m_std  +  5·log10(range / 1000 km)  −  2.5·log10( sin φ + (π − φ)·cos φ )
 *
 *   m_std   the "standard magnitude": how bright the object is from 1,000 km away with half
 *           of its lit side turned toward the observer (φ = 90°). See standardMagnitude().
 *   range   distance from the observer. Light spreads with the square of distance, hence
 *           5·log10: half the distance is 1.5 magnitudes brighter.
 *   φ       the Sun–object–observer angle in radians. The last term is how much of the
 *           sunlit side is seen, for a matt ball that scatters light evenly (a "diffuse
 *           sphere"); it is scaled to 1 at φ = 90°, rises to π when the lit face is turned
 *           fully toward the observer and falls to 0 when the object is seen from behind.
 *
 * Assumptions, and why the result is only an estimate (trust it to a magnitude or two):
 *   - real satellites are not matt balls: flat panels and foil can glint far brighter, or
 *     turn edge-on and all but vanish; a tumbling rocket body flashes;
 *   - the size comes from radar, which sees metal and corners rather than sunlit area;
 *   - nothing is taken off for haze near the horizon, city lights or the Moon.
 */
export function apparentMagnitude(standardMag: number, rangeKm: number, phaseDeg: number): number {
  const phi = phaseDeg * RAD;
  const litShare = Math.sin(phi) + (Math.PI - phi) * Math.cos(phi);
  // Seen almost from behind, the formula heads for "infinitely faint"; stop at 4 magnitudes down.
  return standardMag + 5 * Math.log10(Math.max(rangeKm, 1) / 1000) - 2.5 * Math.log10(Math.max(litShare, 0.025));
}

/**
 * Standard magnitudes that satellite observers quote for the three best-known objects
 * (approximate; the Chinese station's is the least certain of the three).
 */
const KNOWN_STANDARD: [RegExp, number][] = [
  [/^ISS \(/, -1.8], // International Space Station, "ISS (ZARYA)": reaches about −4 overhead, like Venus
  [/^(CSS\b|TIANHE|WENTIAN|MENGTIAN|TIANGONG)/, 0], // Tiangong: about −2 on its best passes
  [/^HST$/, 2.2], // Hubble Space Telescope
];
const HUBBLE_NORAD_ID = 20580;
/**
 * Everything else: a radar cross-section of 1 m² is taken to be magnitude 5.8 at 1,000 km,
 * half lit. The number is a calibration, not physics: it is what makes Hubble (28 m² on
 * radar, standard magnitude 2.2) come out right. For comparison, a matt ball of 1 m²
 * cross-section reflecting 20% of the light would be magnitude 7.9 — spacecraft are both
 * shinier than that and, with their solar panels, larger than their radar size suggests.
 */
const ONE_SQUARE_METRE_MAG = 5.8;
/** Size assumed for a crewed or cargo craft whose radar size is not published (a Soyuz or Dragon is of this order). */
const UNPUBLISHED_CRAFT_M2 = 15;

export function standardMagnitude(sat: Satellite, rcsM2: number | null): number {
  for (const [name, magnitude] of KNOWN_STANDARD) if (name.test(sat.name)) return magnitude;
  return ONE_SQUARE_METRE_MAG - 2.5 * Math.log10(Math.max(rcsM2 ?? UNPUBLISHED_CRAFT_M2, 0.01));
}

// ---------------------------------------------------------------- which objects are worth checking

/** Only orbits that come this low are searched: higher up, even large objects are too far away to be bright. */
export const MAX_PERIGEE_KM = 1200;
/** "Large" in the space-surveillance catalogue's own size classes: a radar cross-section of 1 m² or more. */
export const LARGE_RCS_M2 = 1;
/** Most objects checked in one search (the biggest are kept). */
export const CANDIDATE_CAP = 300;

export interface Candidate {
  sat: Satellite;
  standardMag: number;
}

/** Lowest point of the orbit above the ground, from the published elements (km). */
export const perigeeKm = (sat: Satellite): number =>
  semiMajorAxisKm(sat.omm.MEAN_MOTION) * (1 - sat.omm.ECCENTRICITY) - EARTH_RADIUS_KM;

/** Small satellites released from the station are catalogued as "ISS OBJECT XX" until identified: not the station. */
const RELEASED_FROM_STATION = /^ISS OBJECT/;

/**
 * The short list to search, out of ~19,500 objects: the space stations, the craft visiting
 * them and Hubble always; otherwise payloads and rocket bodies (never debris) that are
 * "large" on radar and come below 1,200 km. Biggest first, at most `cap`.
 */
export function pickCandidates(sats: Satellite[], facts: Map<number, CatalogFacts>, cap = CANDIDATE_CAP): Candidate[] {
  const always: Satellite[] = [];
  const large: { sat: Satellite; rcs: number }[] = [];
  for (const sat of sats) {
    if (sat.category === 'Debris' || perigeeKm(sat) > MAX_PERIGEE_KM) continue;
    if ((sat.category === 'Space Stations' && !RELEASED_FROM_STATION.test(sat.name)) || sat.noradId === HUBBLE_NORAD_ID) {
      always.push(sat);
      continue;
    }
    const fact = facts.get(sat.noradId); // Map keyed by NORAD id: one O(1) look-up per object
    if (fact && fact.rcs !== null && fact.rcs >= LARGE_RCS_M2 && (fact.type === 'PAY' || fact.type === 'R/B')) large.push({ sat, rcs: fact.rcs });
  }
  always.sort((a, b) => a.noradId - b.noradId); // the first module launched (lowest number) stands for its station
  large.sort((a, b) => b.rcs - a.rcs);

  // A station's modules are catalogued one by one but published with one and the same element
  // set. Searching each would list the same pass several times, so keep one object per orbit:
  // a Set of element "fingerprints" answers "seen this orbit already?" in O(1).
  const orbitsSeen = new Set<string>();
  const chosen: Candidate[] = [];
  for (const sat of [...always, ...large.map((entry) => entry.sat)]) {
    const orbit = `${sat.omm.EPOCH}|${sat.omm.MEAN_MOTION}|${sat.omm.RA_OF_ASC_NODE}|${sat.omm.MEAN_ANOMALY}`;
    if (orbitsSeen.has(orbit)) continue;
    orbitsSeen.add(orbit);
    chosen.push({ sat, standardMag: standardMagnitude(sat, facts.get(sat.noradId)?.rcs ?? null) });
    if (chosen.length >= cap) break;
  }
  return chosen;
}

// ---------------------------------------------------------------- the search

/**
 * What every object's search shares: the Earth's rotation angle, the Sun's direction and the
 * Sun's height for the observer at each coarse time step. Computed once per search instead
 * of once per object.
 */
export interface NightTable {
  startMs: number;
  stepMs: number;
  count: number;
  gmst: Float64Array;
  sun: Float64Array; // unit vector to the Sun, inertial frame, packed x y z
  sunElDeg: Float32Array;
  darkSteps: number; // steps at which the observer is in darkness
}

export function nightTable(site: Site, startMs: number, hours: number, stepMs = 30000): NightTable {
  const count = Math.floor((hours * 3.6e6) / stepMs) + 1;
  const table: NightTable = {
    startMs, stepMs, count,
    gmst: new Float64Array(count), sun: new Float64Array(count * 3), sunElDeg: new Float32Array(count), darkSteps: 0,
  };
  for (let k = 0; k < count; k++) {
    const t = startMs + k * stepMs;
    const sun = sunDirection(t);
    table.gmst[k] = gstime(julianDate(t));
    table.sun.set([sun.x, sun.y, sun.z], 3 * k);
    table.sunElDeg[k] = Math.asin(Math.max(-1, Math.min(1, dot(toEarthFrame(sun, table.gmst[k]), site.up)))) * DEG;
    if (table.sunElDeg[k] <= DARK_SUN_DEG) table.darkSteps++;
  }
  return table;
}

/** Why a visible stretch begins or ends. */
export type PassEdge =
  | 'horizon' // it climbs above / sinks below 10°
  | 'shadow' // it leaves / enters the Earth's shadow
  | 'twilight' // the sky becomes dark enough / too bright
  | 'window'; // the searched period starts / ends while it is in view

export interface SkyPoint {
  azDeg: number;
  elDeg: number;
}

/** One stretch of time during which the object can be seen. */
export interface VisiblePass {
  startMs: number;
  endMs: number;
  peakMs: number; // when it is highest while visible
  start: SkyPoint;
  peak: SkyPoint;
  end: SkyPoint;
  startWhy: PassEdge;
  endWhy: PassEdge;
  /** Estimated magnitude at its brightest moment (smaller = brighter). */
  magnitude: number;
}

const FAR_BELOW_DEG = -25;
const SHORTEST_PASS_MS = 30000;
const PASS_SAMPLES = 24;

/**
 * Every visible stretch of one object during the night table's period.
 *
 * Coarse scan: at each 30-second step in darkness, one SGP4 call and the three tests. A run
 * of consecutive "visible" steps is a pass; its two ends are then pinned down to half a
 * second by bisection on the exact test, and the stretch is sampled for the highest point
 * and the brightest moment.
 */
export function findVisiblePasses(satrec: SatRec, site: Site, night: NightTable, standardMag: number): VisiblePass[] {
  const passes: VisiblePass[] = [];
  const timeOf = (k: number): number => night.startMs + k * night.stepMs;
  const visibleAt = (t: number): boolean => sightingAt(satrec, t, site)?.visible ?? false;

  /** The moment visibility switches between `hidden` and `seen`; returns a time at which it is visible. */
  const edge = (hidden: number, seen: number): number => {
    for (let i = 0; i < 6; i++) {
      const mid = (hidden + seen) / 2;
      if (visibleAt(mid)) seen = mid;
      else hidden = mid;
    }
    return seen;
  };
  /** Which of the three tests fails at `t`, a second outside a pass. */
  const why = (t: number): PassEdge => {
    const s = sightingAt(satrec, t, site);
    if (!s || s.elDeg < MIN_ELEVATION_DEG) return 'horizon';
    return !s.sunlit ? 'shadow' : 'twilight';
  };

  const close = (first: number, last: number): void => {
    const startMs = first === 0 ? timeOf(0) : edge(timeOf(first - 1), timeOf(first));
    const endMs = last === night.count - 1 ? timeOf(last) : edge(timeOf(last + 1), timeOf(last));
    if (endMs - startMs < SHORTEST_PASS_MS) return; // a glimpse, not a pass
    let start: Sighting | null = null, peak: Sighting | null = null, end: Sighting | null = null;
    let peakMs = startMs, magnitude = Infinity;
    for (let i = 0; i <= PASS_SAMPLES; i++) {
      const t = startMs + ((endMs - startMs) * i) / PASS_SAMPLES;
      const s = sightingAt(satrec, t, site);
      if (!s) continue;
      start ??= s;
      end = s;
      if (!peak || s.elDeg > peak.elDeg) {
        peak = s;
        peakMs = t;
      }
      magnitude = Math.min(magnitude, apparentMagnitude(standardMag, s.rangeKm, s.phaseDeg));
    }
    if (!start || !peak || !end) return;
    passes.push({
      startMs, endMs, peakMs,
      start: { azDeg: start.azDeg, elDeg: start.elDeg },
      peak: { azDeg: peak.azDeg, elDeg: peak.elDeg },
      end: { azDeg: end.azDeg, elDeg: end.elDeg },
      startWhy: first === 0 ? 'window' : why(startMs - 1000),
      endWhy: last === night.count - 1 ? 'window' : why(endMs + 1000),
      magnitude,
    });
  };

  let runStart = -1;
  for (let k = 0; k < night.count; k++) {
    let seen = false, skip = 0;
    if (night.sunElDeg[k] <= DARK_SUN_DEG) {
      const state = stateAt(satrec, timeOf(k));
      if (state) {
        const p = toEarthFrame(state.position, night.gmst[k]);
        const line = { x: p.x - site.position.x, y: p.y - site.position.y, z: p.z - site.position.z };
        const elDeg = Math.asin(dot(line, site.up) / (Math.hypot(line.x, line.y, line.z) || 1)) * DEG;
        if (elDeg >= MIN_ELEVATION_DEG) {
          seen = isSunlit(state.position, { x: night.sun[3 * k], y: night.sun[3 * k + 1], z: night.sun[3 * k + 2] });
        } else if (elDeg < FAR_BELOW_DEG) {
          // Far round the other side of the Earth. From 25° below the horizon to 10° above it
          // an object has to travel 40° or more around the planet, which takes even the
          // fastest low orbit (about 5° a minute) several minutes: the next two steps cannot
          // be visible, so they are not computed. This roughly halves the work.
          skip = 2;
        }
      }
    }
    if (seen && runStart < 0) runStart = k;
    if (!seen && runStart >= 0) {
      close(runStart, k - 1);
      runStart = -1;
    }
    k += skip;
  }
  if (runStart >= 0) close(runStart, night.count - 1);
  return passes;
}

/** Angle between two directions in the sky, degrees. */
function skyAngleDeg(a: SkyPoint, b: SkyPoint): number {
  const cos = Math.sin(a.elDeg * RAD) * Math.sin(b.elDeg * RAD)
    + Math.cos(a.elDeg * RAD) * Math.cos(b.elDeg * RAD) * Math.cos((a.azDeg - b.azDeg) * RAD);
  return Math.acos(Math.max(-1, Math.min(1, cos))) * DEG;
}

/**
 * A craft docked to a station has its own catalogue entry and its own elements, yet crosses
 * the sky as the same dot at the same time. Given passes sorted brightest first, keep only
 * the first of any that share start, end and place in the sky.
 */
export function dropCompanions<T extends VisiblePass>(sorted: T[]): T[] {
  const kept: T[] = [];
  for (const pass of sorted) {
    const twin = kept.some((other) =>
      Math.abs(other.startMs - pass.startMs) < 15000 && Math.abs(other.endMs - pass.endMs) < 15000
      && skyAngleDeg(other.start, pass.start) < 2 && skyAngleDeg(other.end, pass.end) < 2);
    if (!twin) kept.push(pass);
  }
  return kept;
}
