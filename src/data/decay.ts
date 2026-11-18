/**
 * Rough time left in orbit for a low object, from its own element set. Pure maths: no DOM,
 * no network, so `scripts/decay-check.mjs` can run it in Node.
 *
 * The idea, in three steps:
 *
 *   1. How fast is it sinking now?  The element set carries MEAN_MOTION_DOT: half the rate at
 *      which the number of revolutions per day is growing, as fitted to the last few days of
 *      tracking. Kepler's third law (n² a³ = μ) turns that into kilometres of height lost per
 *      day:  da/dt = −(2a / 3n) · dn/dt.  This is a measurement, with today's air in it.
 *
 *   2. How draggy is the object?  Air drag shrinks an orbit at a rate proportional to
 *      (drag area ÷ mass) × air density × speed³. We do not know the object's area or mass,
 *      so we choose the one value of (area ÷ mass) that makes a standard table of air
 *      density reproduce the sinking rate measured in step 1.
 *
 *   3. Fly it down.  With that value fixed, step the orbit's size and stretch forward through
 *      the same density table. The air roughly doubles in density every 20 to 40 km on the
 *      way down, so the sinking accelerates: most of the remaining time is spent near the
 *      present height, and the last 100 km take a day or two. We stop at a mean height of
 *      150 km, where an object has hours left.
 *
 * Drag is averaged round the orbit (step 2 and 3 both sample the height along one
 * revolution), so an orbit that dips into the air only at its low point is handled the same
 * way as a circular one.
 *
 * Space weather (optional): the Sun's extreme-ultraviolet output heats the upper air, which
 * swells and becomes denser at a given height. The measured rate in step 1 already contains
 * today's Sun, so today's reading is NOT applied a second time. What it changes is the
 * outlook: an unusual day does not last, so the flux assumed in step 3 starts at today's
 * value and relaxes to its 90-day average over about two weeks (roughly how long a bright
 * region takes to rotate out of view). On most days this moves the answer by a few per cent;
 * on a rare extreme day (flux 70 above its average) it can nearly double it.
 *
 * How wrong can it be?  Easily a factor of two either way, and more beyond a year:
 *   - the upper air changes by a factor of ten over the 11-year solar cycle and can double
 *     for a day during a geomagnetic storm, neither of which can be forecast;
 *   - a tumbling object's drag area changes; a satellite with thrusters does what it likes;
 *   - MEAN_MOTION_DOT is a by-product of an orbit fit, not a careful measurement;
 *   - the density table is a smooth average with one "temperature" knob.
 * That is why the result is only ever shown as a rough phrase (`decayLabel`), never a date,
 * and why `estimateDecayDays` returns null rather than guess when the inputs look wrong.
 */

import type { OmmRecord } from './types.ts';

const MU = 398600.4418; // km³/s², Earth's gravitational parameter
const EARTH_RADIUS_KM = 6371; // the same mean radius the rest of the app uses for "altitude"
const SECONDS_PER_DAY = 86400;

/** Mean height at which we call it over: below this an object has hours left, not days. */
export const REENTRY_ALT_KM = 150;
/** Estimates are not followed beyond this; anything longer is shown as "many years" anyway. */
export const DECAY_HORIZON_DAYS = 100 * 365.25;

// ---- the air ------------------------------------------------------------------------------

/**
 * Air density against height: the piecewise-exponential table printed in Vallado,
 * "Fundamentals of Astrodynamics and Applications", table 8-4 (CIRA-72, moderate solar
 * activity). Each row: from this height (km) up, the density at that height (kg/m³) and the
 * scale height (km) — the climb over which the density falls by a factor e.
 */
const AIR: readonly (readonly [number, number, number])[] = [
  [100, 5.297e-7, 5.877],
  [110, 9.661e-8, 7.263],
  [120, 2.438e-8, 9.473],
  [130, 8.484e-9, 12.636],
  [140, 3.845e-9, 16.149],
  [150, 2.07e-9, 22.523],
  [180, 5.464e-10, 29.74],
  [200, 2.789e-10, 37.105],
  [250, 7.248e-11, 45.546],
  [300, 2.418e-11, 53.628],
  [350, 9.518e-12, 53.298],
  [400, 3.725e-12, 58.515],
  [450, 1.585e-12, 60.828],
  [500, 6.967e-13, 63.822],
  [600, 1.454e-13, 71.835],
  [700, 3.614e-14, 88.667],
  [800, 1.17e-14, 124.64],
  [900, 5.245e-15, 181.05],
  [1000, 3.019e-15, 268.0],
];
const SWELL_BASE_KM = 150; // below about here the density hardly changes with the Sun
const SWELL_BASE_DENSITY = 2.07e-9; // the table's value at that height

/** The solar flux the table above corresponds to (solar flux units), and a calm magnetic field. */
export const REFERENCE_FLUX = 150;
const QUIET_KP = 2;

/**
 * Temperature of the outermost air (kelvin) from the Sun's 10.7 cm radio flux and the
 * planetary K index: Jacchia's 1971 formulas, the classic rule of thumb. The 90-day average
 * flux matters more than today's value (3.24 against 1.3 K per unit) because the air responds
 * to the slowly varying ultraviolet, which the average tracks better than one day's reading.
 */
export function exosphereTempK(fluxNow: number, fluxMean: number, kp: number = QUIET_KP): number {
  return 379 + 3.24 * fluxMean + 1.3 * (fluxNow - fluxMean) + 28 * kp + 0.03 * Math.exp(kp);
}
const REFERENCE_TEMP_K = exosphereTempK(REFERENCE_FLUX, REFERENCE_FLUX);

/**
 * Air density (kg/m³) at a height, for a given outer-air temperature (default: the table's).
 *
 * Scale height is proportional to temperature (H = kT / mg): hotter air is taller. Stretching
 * every scale height above 150 km by the same factor s = T / T_reference divides the
 * logarithm of the density drop above 150 km by s — which is the one line below. It is a
 * crude stand-in for a real model of the upper air, but it gives the right size of effect:
 * about ten times more air at 400 km at solar maximum than at minimum.
 */
export function airDensity(altKm: number, tempK: number = REFERENCE_TEMP_K): number {
  const h = Math.max(altKm, AIR[0][0]); // nothing we follow survives below the first row
  let row = AIR[0];
  for (const next of AIR) {
    if (next[0] > h) break;
    row = next;
  }
  const table = row[1] * Math.exp(-(h - row[0]) / row[2]);
  if (h <= SWELL_BASE_KM) return table;
  const stretch = Math.min(2, Math.max(0.5, tempK / REFERENCE_TEMP_K)); // keep a wild input from running away
  return SWELL_BASE_DENSITY * Math.exp(Math.log(table / SWELL_BASE_DENSITY) / stretch);
}

// ---- drag averaged round one orbit ----------------------------------------------------------

const ORBIT_SAMPLES = 180; // over half a revolution (the other half is its mirror image)

/**
 * How fast drag shrinks an orbit of semi-major axis `a` (km) and eccentricity `e`, per unit
 * of (drag area ÷ mass): the time-average round one revolution of
 *     da/dt = −ρ v³ a² / μ        and        de/dt = −ρ v (e + cos ν)
 * (Gauss's equations for a force along −velocity), with ρ the density at each point's height.
 * Sampling evenly in eccentric anomaly E, time spent near each sample is ∝ (1 − e cos E).
 */
function dragRates(a: number, e: number, tempK: number): { da: number; de: number } {
  let da = 0, de = 0;
  for (let k = 0; k < ORBIT_SAMPLES; k++) {
    const cosE = Math.cos(((k + 0.5) * Math.PI) / ORBIT_SAMPLES);
    const shape = 1 - e * cosE; // r / a, and also the time weight
    const r = a * shape;
    const rho = airDensity(r - EARTH_RADIUS_KM, tempK);
    const v = Math.sqrt(MU * (2 / r - 1 / a));
    const cosNu = (cosE - e) / shape;
    da += shape * rho * v * v * v;
    de += shape * rho * v * (e + cosNu);
  }
  return { da: (da / ORBIT_SAMPLES) * ((a * a) / MU), de: de / ORBIT_SAMPLES };
}

// ---- the estimate ---------------------------------------------------------------------------

export interface DecayWeather {
  fluxNow: number; // today's 10.7 cm solar radio flux, solar flux units
  fluxMean: number; // its 90-day average
}

export interface DecayOptions {
  /** Today's space weather, if it has been downloaded (see the header: it shapes the outlook only). */
  weather?: DecayWeather | null;
  /** Count the time left from this moment (Unix ms) rather than from the element set's epoch. */
  nowMs?: number;
}

const FLUX_MEMORY_DAYS = 14; // an unusual day fades back to the average over about this long
const MAX_ECCENTRICITY = 0.4; // beyond this the Sun's and Moon's pull moves the low point more than drag does
/**
 * Drag area ÷ mass (m²/kg, drag coefficient included) below which the "object" would be
 * denser than anything that flies: a solid aluminium ball 80 cm across is about 0.0015, and
 * the sleekest real satellites are two or three times draggier. A satellite that shows less
 * drag than that at its height is not coasting — it is holding its orbit with thrusters (in
 * the 2026 catalogue: hundreds of Starlinks and a few very low Chinese satellites), and its
 * sinking rate says nothing about when it will come down. Erring on the high side is
 * deliberate: a missing estimate is better than "many years" beside a satellite at 270 km.
 */
const MIN_AREA_TO_MASS = 0.0015;
const MAX_ELEMENT_AGE_DAYS = 30; // older element sets describe an orbit the object has since left

/**
 * Days until the orbit's mean height reaches about 150 km, or null when the element set
 * cannot support an estimate: no measurable decay, signs of thrusting, a very stretched
 * orbit, or elements too old to trust. Capped at DECAY_HORIZON_DAYS; 0 means the time has
 * run out since the elements were measured. See the file header for the method and for how
 * rough the answer is. Costs a few milliseconds: meant for a handful of objects, not all.
 */
export function estimateDecayDays(omm: OmmRecord, options: DecayOptions = {}): number | null {
  const n = omm.MEAN_MOTION; // revolutions per day
  const e0 = omm.ECCENTRICITY;
  const nDot = 2 * omm.MEAN_MOTION_DOT; // the element set stores half the rate (a 1960s convention)
  if (!(n > 0) || !(e0 >= 0) || !(e0 <= MAX_ECCENTRICITY)) return null;
  // Rising or steady (a thruster at work, or a rate too small to measure): nothing to project.
  // A negative BSTAR is the orbit fit saying the same thing in another field.
  if (!(nDot > 0) || !Number.isFinite(nDot) || omm.BSTAR < 0) return null;

  const epochMs = Date.parse(omm.EPOCH.endsWith('Z') ? omm.EPOCH : `${omm.EPOCH}Z`); // CelesTrak omits the Z; the epoch is UTC
  const ageDays = options.nowMs !== undefined && Number.isFinite(epochMs) ? Math.max(0, (options.nowMs - epochMs) / 86400000) : 0;
  if (ageDays > MAX_ELEMENT_AGE_DAYS) return null;

  const nRad = (n * 2 * Math.PI) / SECONDS_PER_DAY;
  const a0 = Math.cbrt(MU / (nRad * nRad));
  const aEnd = EARTH_RADIUS_KM + REENTRY_ALT_KM;
  if (a0 * (1 - e0) - EARTH_RADIUS_KM < 100) return null; // low point already inside the dense air: the elements are not believable
  if (a0 <= aEnd) return 0;

  const weather = options.weather && options.weather.fluxNow > 0 && options.weather.fluxMean > 0 ? options.weather : null;
  const fluxMean = weather ? weather.fluxMean : REFERENCE_FLUX;
  const fluxNow = weather ? weather.fluxNow : REFERENCE_FLUX;

  // Step 1: the measured sinking rate, km per day.
  const sinkNow = ((2 * a0) / (3 * n)) * nDot;
  // Step 2: the drag area ÷ mass that reproduces it in today's air.
  const today = dragRates(a0, e0, exosphereTempK(fluxNow, fluxMean));
  if (!(today.da > 0)) return null;
  const dragginess = sinkNow / today.da; // in the table's mixed units, per day
  const areaToMass = dragginess / (SECONDS_PER_DAY * 1000); // m²/kg (km → m for the density's metres)
  if (areaToMass < MIN_AREA_TO_MASS) return null;

  // Step 3: fly it down. Each step lowers the orbit by 1 % of what is left (at least 250 m),
  // and no step is longer than two days while the weather outlook is still changing.
  let a = a0, e = e0, days = 0;
  for (let step = 0; step < 20000 && a > aEnd && a * (1 - e) - EARTH_RADIUS_KM > 100; step++) {
    const flux = fluxMean + (fluxNow - fluxMean) * Math.exp(-days / FLUX_MEMORY_DAYS);
    const rates = dragRates(a, e, exosphereTempK(flux, fluxMean));
    const sink = dragginess * rates.da;
    if (!(sink > 0)) return null;
    let dt = Math.max(0.25, 0.01 * (a - aEnd)) / sink;
    if (weather && days < 5 * FLUX_MEMORY_DAYS) dt = Math.min(dt, 2);
    a -= sink * dt;
    e = Math.max(0, e - dragginess * rates.de * dt);
    days += dt;
    if (days >= DECAY_HORIZON_DAYS) return DECAY_HORIZON_DAYS;
  }
  // The elements are a little old: that much of the time has already been used up.
  return Math.max(0, days - ageDays);
}

// ---- words ----------------------------------------------------------------------------------

/**
 * A length of time as a deliberately vague phrase. The steps widen with the time because the
 * uncertainty does: days are told apart from weeks, but two years from three is not.
 */
export function decayLabel(days: number): string {
  if (!(days > 0)) return 'may be down already'; // the catalogue is a snapshot; the estimate ran out before now
  if (days < 1) return 'any day now';
  if (days < 2.5) return 'a day or two';
  if (days < 5.5) return 'days';
  if (days < 10) return 'about a week';
  if (days < 17.5) return 'about 2 weeks';
  if (days < 25) return 'about 3 weeks';
  if (days < 45) return 'about a month';
  const months = days / 30.44;
  if (months < 2.5) return 'about 2 months';
  if (months < 3.5) return 'about 3 months';
  if (months < 5) return 'about 4 months';
  if (months < 7.5) return 'about 6 months';
  if (months < 10.5) return 'about 9 months';
  const years = days / 365.25;
  if (years < 1.4) return 'about a year';
  if (years < 3) return 'over a year';
  if (years < 8) return 'a few years';
  return 'many years';
}

/**
 * The honest version for a tooltip: the span from half to double the estimate, in the same
 * vague phrases ("somewhere between about a week and about a month").
 */
export function decayRange(days: number): string {
  const low = decayLabel(days / 2), high = decayLabel(days * 2);
  return low === high ? low : `somewhere between ${low} and ${high}`;
}
