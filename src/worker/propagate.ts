/**
 * SGP4 propagation helpers (satellite.js). Shared by the browser worker and `npm run bench`.
 *
 * SGP4 turns a set of published orbital elements + a time into a position, in kilometres,
 * in the Earth-centred inertial (ECI / TEME) frame: origin at Earth's centre, axes fixed
 * relative to the stars (the Earth rotates underneath).
 */

import { json2satrec, sgp4, type OMMJsonObject, type SatRec } from 'satellite.js';
import type { OmmRecord } from '../data/types.ts';

export function buildSatrecs(records: OmmRecord[]): SatRec[] {
  return records.map((rec) => json2satrec(rec as unknown as OMMJsonObject));
}

/** Minutes between the element set's epoch and the wall-clock time `timeMs` (Unix ms). */
export function minutesSinceEpoch(satrec: SatRec, timeMs: number): number {
  const julianDate = timeMs / 86400000 + 2440587.5;
  return (julianDate - satrec.jdsatepoch) * 1440;
}

/**
 * Propagate every object to `timeMs`, writing packed [x, y, z] km into `out`.
 * Objects SGP4 cannot propagate (e.g. already re-entered) get (0, 0, 0) = "invalid".
 */
export function propagateAll(satrecs: SatRec[], timeMs: number, out: Float32Array | Float64Array): void {
  for (let i = 0; i < satrecs.length; i++) {
    const result = sgp4(satrecs[i], minutesSinceEpoch(satrecs[i], timeMs));
    const p = result?.position;
    const ok = p !== undefined && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
    out[3 * i] = ok ? p.x : 0;
    out[3 * i + 1] = ok ? p.y : 0;
    out[3 * i + 2] = ok ? p.z : 0;
  }
}
