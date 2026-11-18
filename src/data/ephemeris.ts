/**
 * Orbit maths for ONE or TWO objects on the main thread (the worker handles the whole
 * catalogue). Everything the inspector and the encounter view show is computed here with
 * SGP4 directly, so the numbers are exact rather than interpolated between snapshots:
 *
 *   orbitSeries()      altitude / speed / sub-point / sunlight over a stretch of the orbit
 *   lookAngles()       azimuth, elevation and range from a ground observer
 *   findPasses()       when the object next rises above the observer's horizon
 *   closestApproach()  time and distance of closest approach between two objects
 */

import {
  ecfToLookAngles, eciToEcf, eciToGeodetic, gstime, json2satrec, sgp4, sunPos,
  type OMMJsonObject, type SatRec,
} from 'satellite.js';
import type { Satellite } from './types.ts';

export type Vec3 = { x: number; y: number; z: number };
const EARTH_RADIUS_KM = 6371;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export const makeSatrec = (sat: Satellite): SatRec => json2satrec(sat.omm as unknown as OMMJsonObject);

/** Minutes between the element set's epoch and `timeMs` (what SGP4 wants). */
function sinceEpoch(satrec: SatRec, timeMs: number): number {
  return (timeMs / 86400000 + 2440587.5 - satrec.jdsatepoch) * 1440;
}

/** Exact position (km) and velocity (km/s) in the inertial frame, or null if SGP4 fails. */
export function stateAt(satrec: SatRec, timeMs: number): { position: Vec3; velocity: Vec3 } | null {
  const state = sgp4(satrec, sinceEpoch(satrec, timeMs));
  return state && Number.isFinite(state.position.x) ? state : null;
}

/** Unit vector from the Earth to the Sun, inertial frame. */
export function sunDirection(timeMs: number): Vec3 {
  const s = sunPos(timeMs / 86400000 + 2440587.5).rsun;
  const len = Math.hypot(s.x, s.y, s.z) || 1;
  return { x: s.x / len, y: s.y / len, z: s.z / len };
}

/** Outside the Earth's shadow? (Cylindrical shadow: good to a few seconds at the edges.) */
export function isSunlit(p: Vec3, sun: Vec3): boolean {
  const along = p.x * sun.x + p.y * sun.y + p.z * sun.z;
  if (along >= 0) return true; // on the day side
  const off2 = p.x * p.x + p.y * p.y + p.z * p.z - along * along; // distance² from the shadow axis
  return off2 > EARTH_RADIUS_KM * EARTH_RADIUS_KM;
}

export interface OrbitSeries {
  startMs: number;
  stepMs: number;
  count: number;
  altKm: Float32Array;
  speedKmS: Float32Array;
  latDeg: Float32Array;
  lonDeg: Float32Array;
  sunlit: Uint8Array;
  sunlitFraction: number;
  minAlt: number;
  maxAlt: number;
}

/** Sample the orbit at `count` evenly spaced instants from `startMs`, covering `spanMs`. */
export function orbitSeries(satrec: SatRec, startMs: number, spanMs: number, count: number): OrbitSeries {
  const series: OrbitSeries = {
    startMs, stepMs: spanMs / (count - 1), count,
    altKm: new Float32Array(count), speedKmS: new Float32Array(count),
    latDeg: new Float32Array(count), lonDeg: new Float32Array(count),
    sunlit: new Uint8Array(count), sunlitFraction: 0, minAlt: Infinity, maxAlt: -Infinity,
  };
  const sun = sunDirection(startMs + spanMs / 2); // moves < 0.1° over one orbit
  let lit = 0;
  for (let i = 0; i < count; i++) {
    const t = startMs + i * series.stepMs;
    const state = stateAt(satrec, t);
    if (!state) {
      series.altKm[i] = NaN;
      continue;
    }
    const geo = eciToGeodetic(state.position, gstime(new Date(t)));
    series.altKm[i] = geo.height;
    series.speedKmS[i] = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z);
    series.latDeg[i] = geo.latitude * DEG;
    series.lonDeg[i] = wrapLon(geo.longitude * DEG);
    series.sunlit[i] = isSunlit(state.position, sun) ? 1 : 0;
    lit += series.sunlit[i];
    if (geo.height < series.minAlt) series.minAlt = geo.height;
    if (geo.height > series.maxAlt) series.maxAlt = geo.height;
  }
  series.sunlitFraction = lit / count;
  return series;
}

export const wrapLon = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;

// ---------------------------------------------------------------- ground observer

export interface Observer {
  name: string;
  latDeg: number;
  lonDeg: number;
}

export interface Look {
  azDeg: number; // 0 = north, 90 = east
  elDeg: number; // above the horizon
  rangeKm: number;
}

export function lookAngles(satrec: SatRec, timeMs: number, observer: Observer): Look | null {
  const state = stateAt(satrec, timeMs);
  if (!state) return null;
  const site = { latitude: observer.latDeg * RAD, longitude: observer.lonDeg * RAD, height: 0 };
  const look = ecfToLookAngles(site, eciToEcf(state.position, gstime(new Date(timeMs))));
  return { azDeg: look.azimuth * DEG, elDeg: look.elevation * DEG, rangeKm: look.rangeSat };
}

export interface Pass {
  startMs: number;
  endMs: number;
  peakMs: number;
  peakElDeg: number;
  startAzDeg: number;
  endAzDeg: number;
  sunlit: boolean; // lit by the Sun at the peak (needed to see it by eye)
  track: Look[]; // path across the sky, for the polar plot
}

/**
 * Next passes over the observer: walk forward in 20-second steps watching the elevation
 * change sign, then pin down each rise and set by bisection. ~10,000 SGP4 calls for two
 * days, a few milliseconds.
 */
export function findPasses(satrec: SatRec, observer: Observer, fromMs: number, hours = 48, limit = 5): Pass[] {
  const elevation = (t: number): number => lookAngles(satrec, t, observer)?.elDeg ?? -90;
  const crossing = (lo: number, hi: number): number => {
    // elevation changes sign between lo and hi → bisect to about a second
    const rising = elevation(hi) > 0;
    for (let i = 0; i < 6; i++) {
      const mid = (lo + hi) / 2;
      if ((elevation(mid) > 0) === rising) hi = mid;
      else lo = mid;
    }
    return (lo + hi) / 2;
  };

  const passes: Pass[] = [];
  const STEP = 20000;
  const end = fromMs + hours * 3.6e6;
  let prevT = fromMs;
  let prevEl = elevation(prevT);
  let start = prevEl > 0 ? fromMs : NaN; // already overhead
  for (let t = fromMs + STEP; t <= end && passes.length < limit; t += STEP) {
    const el = elevation(t);
    if (prevEl <= 0 && el > 0) start = crossing(prevT, t);
    if (prevEl > 0 && el <= 0 && Number.isFinite(start)) {
      const stop = crossing(prevT, t);
      const track: Look[] = [];
      let peakMs = start, peakEl = -90;
      for (let k = 0; k <= 30; k++) {
        const tk = start + ((stop - start) * k) / 30;
        const look = lookAngles(satrec, tk, observer);
        if (!look) continue;
        track.push(look);
        if (look.elDeg > peakEl) {
          peakEl = look.elDeg;
          peakMs = tk;
        }
      }
      const peakState = stateAt(satrec, peakMs);
      if (track.length > 1 && peakEl > 1) {
        passes.push({
          startMs: start, endMs: stop, peakMs, peakElDeg: peakEl,
          startAzDeg: track[0].azDeg, endAzDeg: track[track.length - 1].azDeg,
          sunlit: !!peakState && isSunlit(peakState.position, sunDirection(peakMs)),
          track,
        });
      }
      start = NaN;
    }
    prevT = t;
    prevEl = el;
  }
  return passes;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (azDeg: number): string => COMPASS[Math.round((((azDeg % 360) + 360) % 360) / 22.5) % 16];

// ---------------------------------------------------------------- two objects

export function rangeKm(a: SatRec, b: SatRec, timeMs: number): number {
  const sa = stateAt(a, timeMs), sb = stateAt(b, timeMs);
  if (!sa || !sb) return NaN;
  return Math.hypot(sa.position.x - sb.position.x, sa.position.y - sb.position.y, sa.position.z - sb.position.z);
}

export interface Approach {
  tcaMs: number; // time of closest approach
  missKm: number; // distance at that time
  relSpeedKmS: number; // how fast they pass each other
  /** Flying together (docked, formation, same train): the range barely changes. */
  coMoving: boolean;
}

/**
 * Closest approach near `aroundMs`: coarse scan of ±windowS in 1-second steps, then a
 * golden-section search around the best sample to pin the minimum down to a millisecond.
 */
export function closestApproach(a: SatRec, b: SatRec, aroundMs: number, windowS = 600): Approach {
  let bestT = aroundMs, best = Infinity;
  for (let s = -windowS; s <= windowS; s++) {
    const r = rangeKm(a, b, aroundMs + s * 1000);
    if (r < best) {
      best = r;
      bestT = aroundMs + s * 1000;
    }
  }
  let lo = bestT - 1000, hi = bestT + 1000;
  const PHI = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 24; i++) {
    const m1 = hi - PHI * (hi - lo), m2 = lo + PHI * (hi - lo);
    if (rangeKm(a, b, m1) < rangeKm(a, b, m2)) hi = m2;
    else lo = m1;
  }
  const tcaMs = (lo + hi) / 2;
  const sa = stateAt(a, tcaMs), sb = stateAt(b, tcaMs);
  const relSpeedKmS = sa && sb
    ? Math.hypot(sa.velocity.x - sb.velocity.x, sa.velocity.y - sb.velocity.y, sa.velocity.z - sb.velocity.z)
    : 0;
  return { tcaMs, missKm: rangeKm(a, b, tcaMs), relSpeedKmS, coMoving: relSpeedKmS < 0.05 };
}
