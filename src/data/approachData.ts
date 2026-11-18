/**
 * A close approach as numbers: everything the printable report and the CSV table
 * (features/report.ts) state about one pair of objects. All of it is recomputed here from the
 * two element sets with SGP4 — nothing is read back from what the panel happens to display.
 *
 *   summarize()     the states at closest approach, the miss distance split into radial /
 *                   along-track / cross-track parts, the ground point underneath
 *   approachRows()  both objects' positions and velocities at even time steps through the pass
 *   approachCsv()   those rows as a CSV file
 *
 * Plain arithmetic, no DOM: scripts/check-report.mjs runs the same code in Node.
 */

import { eciToGeodetic, gstime, type SatRec } from 'satellite.js';
import { stateAt, wrapLon, type Vec3 } from './ephemeris.ts';

const DEG = 180 / Math.PI;

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });

/** When an element set was measured (its epoch), Unix ms. SGP4 counts time from this moment. */
export const epochMs = (satrec: SatRec): number => (satrec.jdsatepoch - 2440587.5) * 86400000;

export interface ObjectState {
  position: Vec3; // km, inertial
  velocity: Vec3; // km/s, inertial
  altKm: number; // height above the reference ellipsoid
  speedKmS: number;
  /** Days from the element set's epoch to the closest approach (negative: the elements are from after it). */
  elementAgeDays: number;
}

/** The separation, second object minus first, along the first object's own directions (km). */
export interface Split {
  radialKm: number; // + = the second object is higher (further from the Earth's centre)
  alongKm: number; // + = the second object is ahead, in the first object's direction of travel
  crossKm: number; // + = to the left of that direction, seen from above
}

export interface ApproachSummary {
  tcaMs: number;
  missKm: number;
  relSpeedKmS: number;
  a: ObjectState;
  b: ObjectState;
  /** The point halfway between the two, and the ground under it. */
  mid: { latDeg: number; lonDeg: number; altKm: number };
  split: Split | null;
  /** Angle between the two velocity vectors: 0° = same direction, 180° = head-on. */
  crossingAngleDeg: number;
}

/**
 * The separation split into radial, along-track and cross-track parts.
 *
 * Three directions at right angles are built from the FIRST object's own state (the frame
 * conjunction analysts call RTN or RIC):
 *   radial       R = r / |r|                  straight up, away from the Earth's centre
 *   cross-track  C = (r × v) / |r × v|        at right angles to the plane of its orbit
 *   along-track  T = C × R                    in that plane, the way it is going (exactly
 *                                             along v for a circular orbit)
 * The separation d = r_B − r_A is then projected on each: d·R, d·T, d·C.
 *
 * Why this is sound: SGP4 gives both states in the same inertial frame at the same instant,
 * so their difference is an ordinary vector and no frame conversion or Earth rotation enters.
 * R, T and C are unit vectors at right angles, so the three parts squared add up to the miss
 * distance squared (verified in scripts/check-report.mjs). Returns null if the first object's
 * position and velocity are parallel, when no orbit plane is defined.
 */
export function splitSeparation(a: { position: Vec3; velocity: Vec3 }, bPosition: Vec3): Split | null {
  const r = length(a.position);
  const normal = cross(a.position, a.velocity);
  const n = length(normal);
  if (r < 1 || n < 1e-6) return null;
  const R = scale(a.position, 1 / r), C = scale(normal, 1 / n), T = cross(C, R);
  const d = sub(bPosition, a.position);
  return { radialKm: dot(d, R), alongKm: dot(d, T), crossKm: dot(d, C) };
}

/** Everything about the moment of closest approach, or null if SGP4 cannot place one of the objects then. */
export function summarize(recA: SatRec, recB: SatRec, tcaMs: number): ApproachSummary | null {
  const sa = stateAt(recA, tcaMs), sb = stateAt(recB, tcaMs);
  if (!sa || !sb) return null;
  const gmst = gstime(new Date(tcaMs));
  const side = (state: { position: Vec3; velocity: Vec3 }, rec: SatRec): ObjectState => ({
    position: state.position, velocity: state.velocity,
    altKm: eciToGeodetic(state.position, gmst).height,
    speedKmS: length(state.velocity),
    elementAgeDays: (tcaMs - epochMs(rec)) / 86400000,
  });
  const middle = eciToGeodetic(scale({ x: sa.position.x + sb.position.x, y: sa.position.y + sb.position.y, z: sa.position.z + sb.position.z }, 0.5), gmst);
  const cosAngle = dot(sa.velocity, sb.velocity) / (length(sa.velocity) * length(sb.velocity) || 1);
  return {
    tcaMs,
    missKm: length(sub(sb.position, sa.position)),
    relSpeedKmS: length(sub(sb.velocity, sa.velocity)),
    a: side(sa, recA),
    b: side(sb, recB),
    mid: { latDeg: middle.latitude * DEG, lonDeg: wrapLon(middle.longitude * DEG), altKm: middle.height },
    split: splitSeparation(sa, sb.position),
    crossingAngleDeg: Math.acos(Math.max(-1, Math.min(1, cosAngle))) * DEG,
  };
}

// ---------------------------------------------------------------- the table

export interface ApproachRow {
  timeMs: number;
  offsetS: number; // seconds from the closest approach
  rangeKm: number;
  a: { position: Vec3; velocity: Vec3 };
  b: { position: Vec3; velocity: Vec3 };
}

/** A round time step that covers ±windowS in at most about 400 rows (0.01 s for a 1.5 s window, 1 s for two minutes). */
export function tableStepS(windowS: number): number {
  return [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10].find((step) => step >= windowS / 200) ?? 10;
}

/**
 * Both states at even steps from `windowS` before the closest approach to `windowS` after.
 * The rows sit on whole milliseconds (what an ISO time can say), so the middle row is within
 * half a millisecond of the closest approach rather than exactly on it; `offsetS` is measured
 * from the exact moment. Steps at which SGP4 fails for either object are left out.
 */
export function approachRows(recA: SatRec, recB: SatRec, tcaMs: number, windowS: number, stepS = tableStepS(windowS)): ApproachRow[] {
  const rows: ApproachRow[] = [];
  const centre = Math.round(tcaMs), stepMs = Math.round(stepS * 1000), each = Math.floor((windowS * 1000) / stepMs);
  for (let k = -each; k <= each; k++) {
    const timeMs = centre + k * stepMs;
    const a = stateAt(recA, timeMs), b = stateAt(recB, timeMs);
    if (!a || !b) continue;
    rows.push({ timeMs, offsetS: (timeMs - tcaMs) / 1000, rangeKm: length(sub(b.position, a.position)), a, b });
  }
  return rows;
}

export interface CsvLabels {
  nameA: string;
  noradA: number;
  nameB: string;
  noradB: number;
}

/**
 * The rows as CSV. Lines starting with "#" are comments saying what the columns mean; a
 * spreadsheet shows them as text rows, and tools such as pandas or gnuplot skip them.
 */
export function approachCsv(rows: ApproachRow[], summary: ApproachSummary, labels: CsvLabels): string {
  const clean = (name: string) => name.replace(/[\r\n]+/g, ' '); // a name must not break out of its comment line
  const vector = (v: Vec3, digits: number) => `${v.x.toFixed(digits)},${v.y.toFixed(digits)},${v.z.toFixed(digits)}`;
  const lines = [
    `# Close approach between A = ${clean(labels.nameA)} (NORAD ${labels.noradA}) and B = ${clean(labels.nameB)} (NORAD ${labels.noradB})`,
    `# Closest approach ${new Date(Math.round(summary.tcaMs)).toISOString()} (UTC); miss distance ${summary.missKm.toFixed(6)} km; relative speed ${summary.relSpeedKmS.toFixed(6)} km/s`,
    '# Frame: Earth-centred inertial (TEME of date, as SGP4 produces it); origin at the Earth\'s centre. Units: km and km/s. Times: UTC.',
    '# Computed with SGP4 from public orbital elements: positions are good to roughly a kilometre. Not for operational use.',
    'time_utc,seconds_from_closest_approach,range_km,a_x_km,a_y_km,a_z_km,a_vx_km_s,a_vy_km_s,a_vz_km_s,b_x_km,b_y_km,b_z_km,b_vx_km_s,b_vy_km_s,b_vz_km_s',
  ];
  for (const row of rows) {
    lines.push([
      new Date(row.timeMs).toISOString(), row.offsetS.toFixed(4), row.rangeKm.toFixed(6),
      vector(row.a.position, 6), vector(row.a.velocity, 9), vector(row.b.position, 6), vector(row.b.velocity, 9),
    ].join(','));
  }
  return lines.join('\r\n') + '\r\n'; // CRLF: what the CSV convention (RFC 4180) and spreadsheets expect
}
