/**
 * Orbit changes between two downloads of the catalogue: which objects moved to a different
 * orbit by more than nature explains (a "possible manoeuvre"), which are new, which are gone.
 * Also the two small helpers behind "how old is this object's data".
 *
 * This file is pure arithmetic on element records: no DOM, no three.js, no npm package. The
 * browser imports it (src/features/changes.ts) and so does Node (scripts/diff-elements.mjs at
 * build time, scripts/check-changes.mjs as its test), so both always apply the same rules.
 *
 * HASHING: the previous download is indexed in a Map keyed by NORAD id (a hash table), so
 * matching each of the ~19,500 new records with its earlier self is one O(1) lookup, and the
 * whole comparison is O(n). Looking each one up by scanning the old list would be O(n²):
 * about 380 million comparisons instead of 19,500 lookups.
 *
 * THE HARD PART IS THE THRESHOLD. Two element sets for the same object never agree exactly:
 *
 *   1. Air drag. Every low orbit shrinks all the time, quickly below 400 km and hardly at all
 *      above 1,000 km. A fixed threshold would either flag every low object or miss every
 *      high one. Instead each record is asked for its OWN forecast: it carries the two drag
 *      terms the tracking network fitted to it (BSTAR and MEAN_MOTION_DOT), and from those
 *      and the time between the two epochs we predict how far it should have sunk by itself.
 *   2. Measurement noise. Each element set is a fit to a few radar passes, so the orbit size
 *      jitters from one fit to the next even when nothing happened.
 *
 * A change is reported only when it clearly exceeds both:
 *
 *      raised   if  Δa  >  noise + MARGIN × (natural rise over the interval)
 *      lowered  if  Δa  < −noise − MARGIN × (natural sinking over the interval)
 *
 * where Δa is the change in semi-major axis (the orbit's size). Drag can only lower an orbit,
 * so in low orbit the "natural rise" is zero and any rise beyond the noise needs an engine.
 * The constants below say how large each allowance is and why. They are judgement, checked
 * against synthetic cases only (see scripts/check-changes.mjs), which is why every result is
 * worded "possible manoeuvre": a bad fit can look exactly like a small burn.
 */

import { semiMajorAxisKm } from './categorize.ts';
import type { OmmRecord, Snapshot } from './types.ts';

const EARTH_RADIUS_KM = 6378.137;
const DAY_MS = 86400000;

// ---- the allowances -----------------------------------------------------------------------

/**
 * Fit noise in the orbit's size, as a fraction of the semi-major axis: 4 parts in 100,000.
 * That is 0.27 km in low orbit and 1.7 km at geostationary height. Well-tracked satellites
 * repeat to a few tens of metres, so this is several times their jitter. A fraction rather
 * than a fixed distance because the same uncertainty in the measured period means a larger
 * distance in a larger orbit. In terms of an engine burn it is about 1/50,000 of orbital speed
 * (0.15 m/s in low orbit): smaller burns than that are not claimed.
 */
export const NOISE_FRACTION = 4e-5;
/**
 * An eccentric orbit is only pulled on by the air, and is best observed, near its low point,
 * so its fitted size jumps around more: noise × (1 + 4e), i.e. nearly 4× for a Molniya orbit.
 */
const ECCENTRIC_NOISE = 4;
/**
 * Where drag is strong the fits are poor (the air density changes faster than it is measured),
 * so the noise also grows by a tenth of a day's predicted sinking. For the ISS that adds 6 m;
 * for an object in its last days, falling 15 km a day, 1.5 km.
 */
const DRAG_NOISE_DAYS = 0.1;
/**
 * "Clearly exceeds": nature is allowed up to three times what the record predicted. The upper
 * air thickens several-fold within hours during a solar storm, and an object sinks faster the
 * lower it gets, so a straight-line forecast from the earlier record is routinely off by 2×.
 */
export const NATURAL_MARGIN = 3;
/**
 * SGP4's own dividing line: with a period of 225 minutes or more it treats an object as "deep
 * space", where drag is negligible and the Sun's and Moon's pull (and, for 12- and 24-hour
 * orbits, resonance with the Earth's shape) make the orbit's size wander slowly in EITHER
 * direction. Only there is a natural rise allowed, as large as the record's own trend.
 */
const DEEP_SPACE_PERIOD_MIN = 225;
/**
 * Tilt (inclination): fits repeat to a few thousandths of a degree, and the Moon and Sun turn
 * an uncontrolled geostationary orbit by about 0.0023° a day. Turning a low orbit by 0.02°
 * costs about 2.7 m/s of fuel, so a change beyond this is deliberate or a bad fit.
 */
const PLANE_FLOOR_DEG = 0.02;
const PLANE_DRIFT_DEG_PER_DAY = 0.003;

/** How many entries of each sort are kept (the counts in the report are always the true totals). */
export interface ChangeLimits {
  manoeuvres: number;
  arrivals: number; // new objects
  departures: number; // objects no longer listed
}
export const DEFAULT_LIMITS: ChangeLimits = { manoeuvres: 150, arrivals: 75, departures: 75 };

// ---- data age -----------------------------------------------------------------------------

/**
 * Older than this, the position drawn may be far off: an SGP4 prediction drifts by roughly
 * one to three kilometres per day from its epoch in low orbit, and much faster once the
 * object has manoeuvred since. Used by the inspector warning and the "Data age" colours.
 */
export const STALE_DAYS = 5;

/** When a record's elements were measured, Unix ms. CelesTrak writes UTC without the "Z". */
export function epochMs(rec: { EPOCH: string }): number {
  return Date.parse(rec.EPOCH.endsWith('Z') ? rec.EPOCH : rec.EPOCH + 'Z');
}

/** Age of a record's elements at `nowMs`, in days (negative if the epoch is in the future). */
export const elementAgeDays = (rec: { EPOCH: string }, nowMs: number): number => (nowMs - epochMs(rec)) / DAY_MS;

// ---- what nature alone would do -----------------------------------------------------------

/**
 * How fast SGP4's drag model shrinks this orbit, km per day (never negative).
 *
 * SGP4 lets the semi-major axis decay as a(t) = a₀ (1 − C1·t)², so da/dt = −2·a₀·C1 at the
 * epoch, with C1 = BSTAR × C2. BSTAR is the object's own drag coefficient (how much area it
 * shows the air per kilogram); C2 is the model's air density at the orbit's height, a power
 * law that falls with the fourth power of the height above 78 km. Lengths are in Earth radii
 * and time in minutes inside the formula, as in the model. Its small correction for the
 * Earth's flattening is left out (a few per cent, far inside the margin).
 */
function dragSinkKmPerDay(rec: OmmRecord, aKm: number): number {
  const e = rec.ECCENTRICITY;
  const a = aKm / EARTH_RADIUS_KM;
  const perigeeKm = aKm * (1 - e) - EARTH_RADIUS_KM;
  // The density law is anchored 78 km up; for very low perigees SGP4 lowers the anchor.
  const anchorKm = perigeeKm >= 156 ? 78 : Math.max(20, perigeeKm - 78);
  const s = 1 + anchorKm / EARTH_RADIUS_KM;
  const xi = 1 / (a - s);
  const eta = a * e * xi;
  const density = ((120 - anchorKm) / EARTH_RADIUS_KM) ** 4 * xi ** 4 / Math.abs(1 - eta * eta) ** 3.5;
  const n = (rec.MEAN_MOTION * 2 * Math.PI) / 1440; // rad per minute
  const c2 = density * n * a * (1 + 1.5 * eta * eta + e * eta * (4 + eta * eta));
  const rate = 2 * aKm * rec.BSTAR * c2 * 1440;
  // A negative BSTAR is a fit that absorbed an engine pushing the object up, not negative air.
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
}

/**
 * The trend written into the record itself, km per day, signed (+ = growing).
 * MEAN_MOTION_DOT is HALF the rate of change of the mean motion n (an old convention of the
 * two-line format), in revolutions per day². Kepler's third law gives a ∝ n^(−2/3), so
 * da/dt = −(2a / 3n) · dn/dt.
 */
function trendKmPerDay(rec: OmmRecord, aKm: number): number {
  const rate = -((2 * aKm) / (3 * rec.MEAN_MOTION)) * (2 * rec.MEAN_MOTION_DOT);
  return Number.isFinite(rate) ? rate : 0;
}

export interface NaturalRates {
  sinkKmPerDay: number; // how fast it may lose height by itself (≥ 0)
  riseKmPerDay: number; // how fast it may gain height by itself (≥ 0; zero wherever there is air)
}

/**
 * What the record forecasts for itself. The two drag terms agree closely in low orbit (in the
 * published sets MEAN_MOTION_DOT is essentially derived from BSTAR); taking the larger makes
 * the allowance generous when they do not. A record whose trend says "rising" in low orbit is
 * itself evidence of thrust, so it earns no allowance for rising.
 */
export function naturalRates(rec: OmmRecord): NaturalRates {
  const aKm = semiMajorAxisKm(rec.MEAN_MOTION);
  const trend = trendKmPerDay(rec, aKm);
  const deepSpace = 1440 / rec.MEAN_MOTION >= DEEP_SPACE_PERIOD_MIN;
  return {
    sinkKmPerDay: Math.max(dragSinkKmPerDay(rec, aKm), -trend, 0),
    riseKmPerDay: deepSpace ? Math.max(trend, 0) : 0,
  };
}

/**
 * Debris and spent rocket stages have no engine. If one of them appears to jump, the fit was
 * poor (or two fragments were mixed up), and calling that a manoeuvre would be wrong, so they
 * are left out of the manoeuvre test. They still count as new or gone.
 */
function cannotManoeuvre(rec: OmmRecord): boolean {
  return (rec.GROUP ?? '').endsWith('-debris') || /\bDEB\b|\bR\/B\b/.test(rec.OBJECT_NAME.toUpperCase());
}

// ---- the comparison -----------------------------------------------------------------------

export type ChangeKind = 'raised' | 'lowered' | 'plane' | 'new' | 'gone';
export const CHANGE_KINDS: ChangeKind[] = ['raised', 'lowered', 'plane', 'new', 'gone'];

export interface OrbitChange {
  noradId: number;
  name: string;
  kind: ChangeKind;
  /** Mean altitude in the later record (for 'gone': in the last record that had it), km. */
  altKm: number;
  /** Change in semi-major axis, km, + = higher. Zero for new and gone. */
  deltaKm: number;
  /** What the earlier record forecast for the same interval, km (never positive in low orbit). */
  expectedKm: number;
  /** How large the change had to be, in its own direction, before it was reported, km. */
  allowanceKm: number;
  /** Change in inclination, degrees. */
  deltaIncDeg: number;
  /** The inclination change is itself beyond its allowance (may accompany a raise or lowering). */
  planeChanged: boolean;
  /** Epochs of the two records, Unix ms (0 where there is no such record). */
  prevEpochMs: number;
  nextEpochMs: number;
  /** How many times its allowance the change is. The list keeps the highest. */
  score: number;
}

export interface ChangeReport {
  from: string; // when the earlier set was downloaded (ISO)
  to: string; // when the later set was downloaded (ISO)
  compared: number; // objects in both sets with a newer measurement in the later one
  unchanged: number; // objects in both sets whose epoch did not move: nothing new to compare
  counts: Record<ChangeKind, number>; // true totals; `changes` may hold fewer (see ChangeLimits)
  changes: OrbitChange[];
}

/**
 * Judge one object from its earlier and later record. Returns null when there is nothing to
 * report: the epoch did not advance (the "new" record is the same measurement, so any
 * difference would be an artefact), the object cannot manoeuvre, or the change is within
 * what drag and noise explain.
 */
export function judgePair(prev: OmmRecord, next: OmmRecord): OrbitChange | null {
  const prevEpochMs = epochMs(prev), nextEpochMs = epochMs(next);
  const days = (nextEpochMs - prevEpochMs) / DAY_MS;
  if (!(days > 0) || !(prev.MEAN_MOTION > 0) || !(next.MEAN_MOTION > 0)) return null;
  if (cannotManoeuvre(next)) return null;

  const aPrev = semiMajorAxisKm(prev.MEAN_MOTION), aNext = semiMajorAxisKm(next.MEAN_MOTION);
  const deltaKm = aNext - aPrev;
  const deltaIncDeg = next.INCLINATION - prev.INCLINATION;
  if (!Number.isFinite(deltaKm) || !Number.isFinite(deltaIncDeg)) return null;

  // The forecast comes from the EARLIER record: what was expected before anything happened.
  const natural = naturalRates(prev);
  const eccentric = 1 + ECCENTRIC_NOISE * Math.max(prev.ECCENTRICITY, next.ECCENTRICITY);
  const noiseKm = aPrev * NOISE_FRACTION * eccentric + natural.sinkKmPerDay * DRAG_NOISE_DAYS;
  const allowUpKm = noiseKm + NATURAL_MARGIN * natural.riseKmPerDay * days;
  const allowDownKm = noiseKm + NATURAL_MARGIN * natural.sinkKmPerDay * days;
  const allowIncDeg = (PLANE_FLOOR_DEG + PLANE_DRIFT_DEG_PER_DAY * days) * eccentric;

  const raised = deltaKm > allowUpKm;
  const lowered = deltaKm < -allowDownKm;
  const planeChanged = Math.abs(deltaIncDeg) > allowIncDeg;
  if (!raised && !lowered && !planeChanged) return null;

  const allowanceKm = deltaKm >= 0 ? allowUpKm : allowDownKm;
  return {
    noradId: next.NORAD_CAT_ID,
    name: next.OBJECT_NAME,
    kind: raised ? 'raised' : lowered ? 'lowered' : 'plane',
    altKm: aNext - EARTH_RADIUS_KM,
    deltaKm,
    expectedKm: (natural.riseKmPerDay - natural.sinkKmPerDay) * days,
    allowanceKm,
    deltaIncDeg,
    planeChanged,
    prevEpochMs,
    nextEpochMs,
    score: Math.max(Math.abs(deltaKm) / allowanceKm, Math.abs(deltaIncDeg) / allowIncDeg),
  };
}

/** An entry for an object that is in only one of the two sets. */
function presence(rec: OmmRecord, kind: 'new' | 'gone'): OrbitChange {
  const epoch = epochMs(rec);
  return {
    noradId: rec.NORAD_CAT_ID,
    name: rec.OBJECT_NAME,
    kind,
    altKm: semiMajorAxisKm(rec.MEAN_MOTION) - EARTH_RADIUS_KM,
    deltaKm: 0,
    expectedKm: 0,
    allowanceKm: 0,
    deltaIncDeg: 0,
    planeChanged: false,
    prevEpochMs: kind === 'gone' ? epoch : 0,
    nextEpochMs: kind === 'new' ? epoch : 0,
    score: 0,
  };
}

/**
 * Compare two downloads. `previous` must be the older one; the caller checks the timestamps.
 */
export function compareElements(previous: Snapshot, next: Snapshot, limits: ChangeLimits = DEFAULT_LIMITS): ChangeReport {
  // The hash table: NORAD id → the object's earlier record.
  const before = new Map<number, OmmRecord>();
  for (const rec of previous.objects) before.set(rec.NORAD_CAT_ID, rec);

  // A download is made group by group and one group can fail. An object is only "new" or
  // "gone" if its group was fetched both times; otherwise a failed debris group would report
  // two thousand objects as vanished. (Sets: one hash lookup per object.)
  const groupsBefore = new Set(previous.objects.map((rec) => rec.GROUP ?? ''));
  const groupsAfter = new Set(next.objects.map((rec) => rec.GROUP ?? ''));

  const manoeuvres: OrbitChange[] = [];
  const arrivals: OrbitChange[] = [];
  const departures: OrbitChange[] = [];
  const seen = new Set<number>(); // ids present in the later set
  let compared = 0, unchanged = 0;

  for (const rec of next.objects) {
    seen.add(rec.NORAD_CAT_ID);
    const earlier = before.get(rec.NORAD_CAT_ID); // O(1): this lookup is the point of the Map
    if (!earlier) {
      if (groupsBefore.has(rec.GROUP ?? '')) arrivals.push(presence(rec, 'new'));
      continue;
    }
    if (!(epochMs(rec) > epochMs(earlier))) {
      unchanged++; // not measured again since the earlier download
      continue;
    }
    compared++;
    const change = judgePair(earlier, rec);
    if (change) manoeuvres.push(change);
  }
  for (const rec of previous.objects) {
    if (!seen.has(rec.NORAD_CAT_ID) && groupsAfter.has(rec.GROUP ?? '')) departures.push(presence(rec, 'gone'));
  }

  const counts: Record<ChangeKind, number> = { raised: 0, lowered: 0, plane: 0, new: arrivals.length, gone: departures.length };
  for (const change of manoeuvres) counts[change.kind]++;

  // Keep the largest: manoeuvres by how far beyond their allowance they are, arrivals by
  // catalogue number (the highest numbers are the most recently catalogued), departures
  // lowest first (the likeliest to have really come down rather than been delisted).
  manoeuvres.sort((a, b) => b.score - a.score);
  arrivals.sort((a, b) => b.noradId - a.noradId);
  departures.sort((a, b) => a.altKm - b.altKm);

  return {
    from: previous.fetchedAt,
    to: next.fetchedAt,
    compared,
    unchanged,
    counts,
    changes: [...manoeuvres.slice(0, limits.manoeuvres), ...arrivals.slice(0, limits.arrivals), ...departures.slice(0, limits.departures)],
  };
}
