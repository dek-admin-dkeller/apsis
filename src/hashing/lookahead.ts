/**
 * Look-ahead screening: which objects WILL pass close to each other in the coming hours?
 *
 * The live monitor answers "who is close right now" with one pass of the spatial hash.
 * Prediction needs the same question asked at many future instants — but two objects
 * closing at 15 km/s are within 1 km of each other for a fraction of a second, so sampling
 * every minute and looking for pairs inside 1 km would miss almost all of them.
 *
 * The trick is to widen the net and then reason about motion:
 *
 *   1. Every STEP seconds, propagate everything (SGP4) and hash it into cells of size
 *      D = alert distance + (fastest closing speed × STEP / 2).
 *      Any pair that comes within the alert distance during that step is no more than D
 *      apart at the sample time, so the 27-cell query is guaranteed to offer it up.
 *   2. For each candidate pair, treat the relative motion as a straight line for the
 *      ±STEP/2 around the sample (accurate to a few hundred metres over 30 s) and solve
 *      for the instant of closest approach:  t* = −(r · v) / |v|².
 *      Keep it only if t* falls inside this step and the straight-line miss is small.
 *   3. Refine the survivors with exact SGP4 and a golden-section search.
 *
 * So the hash turns "compare all 191 million pairs, 1,440 times a day" into a few hundred
 * thousand cheap line-distance calculations per step.
 */

import { sgp4, type SatRec } from 'satellite.js';
import { SpatialHash } from './SpatialHash.ts';

export interface FutureApproach {
  a: number; // object indices
  b: number;
  tcaMs: number; // time of closest approach
  missKm: number;
  relSpeedKmS: number;
}

const STEP_S = 60;
const MAX_CLOSING_KM_S = 16; // two low orbits head-on is ~15.4 km/s
const CO_MOVING_KM_S = 0.05; // slower than this = flying together, not an "approach"
const PHI = (Math.sqrt(5) - 1) / 2;

const sinceEpoch = (rec: SatRec, timeMs: number) => (timeMs / 86400000 + 2440587.5 - rec.jdsatepoch) * 1440;

export class Lookahead {
  readonly steps: number;
  /** Candidate pairs examined so far (for the "work done" readout). */
  examined = 0;
  private readonly found: FutureApproach[] = [];
  private readonly lastSeen = new Map<number, number>(); // pair key → time of its latest reported approach
  private readonly pos: Float64Array;
  private readonly vel: Float64Array;
  private readonly valid: Uint8Array;
  private readonly cell: number;
  private readonly scratch: number[] = [];
  private readonly satrecs: SatRec[];
  private readonly mask: Uint8Array;
  private readonly startMs: number;
  private readonly alertKm: number;

  constructor(satrecs: SatRec[], mask: Uint8Array, startMs: number, hours: number, alertKm: number) {
    this.satrecs = satrecs;
    this.mask = mask;
    this.startMs = startMs;
    this.alertKm = alertKm;
    this.steps = Math.ceil((hours * 3600) / STEP_S);
    this.pos = new Float64Array(satrecs.length * 3);
    this.vel = new Float64Array(satrecs.length * 3);
    this.valid = new Uint8Array(satrecs.length);
    this.cell = alertKm + (MAX_CLOSING_KM_S * STEP_S) / 2;
  }

  get total(): number {
    return this.found.length;
  }

  /** The closest `limit` approaches found so far. */
  closest(limit: number): FutureApproach[] {
    return [...this.found].sort((p, q) => p.missKm - q.missKm).slice(0, limit);
  }

  /** Process sample number k (0 … steps−1). */
  step(k: number): void {
    const { satrecs, pos, vel, valid } = this;
    const n = satrecs.length;
    const half = STEP_S / 2;
    const t = this.startMs + (k + 0.5) * STEP_S * 1000; // middle of the k-th interval

    // 1. propagate + build the hash table
    const grid = new SpatialHash(this.cell);
    for (let i = 0; i < n; i++) {
      valid[i] = 0;
      if (!this.mask[i]) continue;
      const state = sgp4(satrecs[i], sinceEpoch(satrecs[i], t));
      if (!state || !Number.isFinite(state.position.x)) continue;
      pos[3 * i] = state.position.x;
      pos[3 * i + 1] = state.position.y;
      pos[3 * i + 2] = state.position.z;
      vel[3 * i] = state.velocity.x;
      vel[3 * i + 1] = state.velocity.y;
      vel[3 * i + 2] = state.velocity.z;
      valid[i] = 1;
      grid.insert(i, state.position.x, state.position.y, state.position.z);
    }

    // 2. each object against the objects in its 27 surrounding cells
    const near2 = (this.alertKm + 0.5) ** 2;
    for (let i = 0; i < n; i++) {
      if (!valid[i]) continue;
      const ix = pos[3 * i], iy = pos[3 * i + 1], iz = pos[3 * i + 2];
      const neighbours = grid.queryNeighbors(ix, iy, iz, this.scratch);
      for (let q = 0; q < neighbours.length; q++) {
        const j = neighbours[q];
        if (j <= i) continue; // each pair once
        this.examined++;
        const rx = pos[3 * j] - ix, ry = pos[3 * j + 1] - iy, rz = pos[3 * j + 2] - iz;
        const vx = vel[3 * j] - vel[3 * i], vy = vel[3 * j + 1] - vel[3 * i + 1], vz = vel[3 * j + 2] - vel[3 * i + 2];
        const v2 = vx * vx + vy * vy + vz * vz;
        if (v2 < CO_MOVING_KM_S * CO_MOVING_KM_S) continue; // travelling together
        const tStar = -(rx * vx + ry * vy + rz * vz) / v2; // seconds from the sample to closest approach
        if (tStar < -half - 1 || tStar >= half + 1) continue; // belongs to another step
        const mx = rx + vx * tStar, my = ry + vy * tStar, mz = rz + vz * tStar;
        if (mx * mx + my * my + mz * mz > near2) continue;

        // 3. exact closest approach
        const exact = this.refine(i, j, t + tStar * 1000);
        if (exact.missKm >= this.alertKm) continue;
        const key = i * n + j;
        const previous = this.lastSeen.get(key);
        if (previous !== undefined && Math.abs(exact.tcaMs - previous) < 30000) continue; // same pass seen from the neighbouring step
        this.lastSeen.set(key, exact.tcaMs);
        this.found.push({ a: i, b: j, tcaMs: exact.tcaMs, missKm: exact.missKm, relSpeedKmS: Math.sqrt(v2) });
      }
    }
  }

  private range(i: number, j: number, timeMs: number): number {
    const a = sgp4(this.satrecs[i], sinceEpoch(this.satrecs[i], timeMs));
    const b = sgp4(this.satrecs[j], sinceEpoch(this.satrecs[j], timeMs));
    if (!a || !b) return Infinity;
    return Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y, a.position.z - b.position.z);
  }

  /** Golden-section search for the minimum range within ±3 s of the straight-line estimate. */
  private refine(i: number, j: number, guessMs: number): { tcaMs: number; missKm: number } {
    let lo = guessMs - 3000, hi = guessMs + 3000;
    for (let it = 0; it < 22; it++) {
      const m1 = hi - PHI * (hi - lo), m2 = lo + PHI * (hi - lo);
      if (this.range(i, j, m1) < this.range(i, j, m2)) hi = m2;
      else lo = m1;
    }
    const tcaMs = (lo + hi) / 2;
    return { tcaMs, missKm: this.range(i, j, tcaMs) };
  }
}
