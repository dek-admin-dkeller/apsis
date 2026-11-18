/**
 * Doppler shift of a satellite's radio signal as heard at a ground station.
 *
 * A transmitter coming towards the listener is heard higher than it sends, one going away
 * lower: received = sent × (1 − ṙ/c), where ṙ is the RANGE RATE, the speed at which the
 * distance between the two is changing (negative while it comes closer). For a satellite
 * passing overhead at 7.5 km/s that is ±10 kHz at 437 MHz, far more than the width of a
 * narrow signal, so a receiver has to retune all through the pass.
 *
 * The range rate is found by differencing the range half a second either side of the moment
 * asked for. Frames matter here (see "Coordinate frames" in CLAUDE.md): SGP4 gives the
 * satellite in the inertial frame, but the ground station rides the turning Earth at up to
 * 0.46 km/s. `lookAngles` moves the satellite into the Earth-fixed frame before measuring the
 * range, so both ends of the difference already include the station's own motion and nothing
 * has to be corrected by hand.
 */

import type { SatRec } from 'satellite.js';
import { lookAngles, type Look, type Observer, type Pass } from './ephemeris.ts';

const LIGHT_KM_S = 299792.458;
const HALF_STEP_MS = 500;

export interface RangeRate {
  look: Look; // where it is in the observer's sky at that moment
  rateKmS: number; // negative = coming closer
}

/** Where the object is in the observer's sky and how fast its distance is changing, or null if SGP4 fails. */
export function rangeRate(satrec: SatRec, timeMs: number, observer: Observer): RangeRate | null {
  const look = lookAngles(satrec, timeMs, observer);
  const before = lookAngles(satrec, timeMs - HALF_STEP_MS, observer);
  const after = lookAngles(satrec, timeMs + HALF_STEP_MS, observer);
  if (!look || !before || !after) return null;
  // A central difference: its error is far below a metre per second over one second.
  return { look, rateKmS: (after.rangeKm - before.rangeKm) / ((2 * HALF_STEP_MS) / 1000) };
}

/** How far the received frequency is from the transmitted one, Hz (positive = heard higher). */
export const dopplerShiftHz = (frequencyHz: number, rateKmS: number): number => (-frequencyHz * rateKmS) / LIGHT_KM_S;

/**
 * The fastest approach and the fastest retreat during a pass (km/s, approach negative). The
 * range rate climbs steadily from rise to set, but sampling the whole pass rather than only
 * its two ends keeps this right for odd geometries and elliptical orbits.
 */
export function rateOverPass(satrec: SatRec, observer: Observer, pass: Pass, samples = 24): { minKmS: number; maxKmS: number } | null {
  let minKmS = Infinity, maxKmS = -Infinity;
  for (let i = 0; i <= samples; i++) {
    const at = rangeRate(satrec, pass.startMs + ((pass.endMs - pass.startMs) * i) / samples, observer);
    if (!at) continue;
    if (at.rateKmS < minKmS) minKmS = at.rateKmS;
    if (at.rateKmS > maxKmS) maxKmS = at.rateKmS;
  }
  return Number.isFinite(minKmS) ? { minKmS, maxKmS } : null;
}
