/**
 * Conjunction screening: find every pair of objects closer than d kilometres.
 *
 * Two implementations of the SAME job, so we can check them against each other:
 *   bruteForcePairs()  — compares all n(n−1)/2 pairs.             O(n²)
 *   hashedPairs()      — spatial hash grid, 27 cells per object.  O(n) expected
 *
 * Both take positions packed as [x0, y0, z0, x1, y1, z1, ...] (km) and return the same
 * list of pairs in the same order, so "identical results" is a simple element-wise check.
 */

import { SpatialHash, type HashStats } from './SpatialHash.ts';

export interface Pair {
  a: number; // index of the first object  (always a < b)
  b: number; // index of the second object
  dist: number; // separation in km
}

export interface ScreenResult {
  pairs: Pair[]; // sorted by distance, closest first
  checks: number; // how many distance computations were performed
}

export interface HashedScreenResult extends ScreenResult {
  stats: HashStats;
  grid: SpatialHash;
}

/**
 * Two objects closer than d are not always "approaching" each other. A capsule docked to a
 * station, satellites flying in formation, or a freshly launched batch still travelling in a
 * line are close ALL the time. What tells them apart is how fast one moves relative to the
 * other: objects sharing an orbit drift at metres per second, while objects whose orbits
 * merely cross pass at kilometres per second. Below this relative speed (km/s) a pair is
 * called "flying together".
 */
export const TOGETHER_KM_S = 0.1;

/** Deterministic order: closest first; ties broken by the indices. */
function sortPairs(pairs: Pair[]): Pair[] {
  return pairs.sort((p, q) => p.dist - q.dist || p.a - q.a || p.b - q.b);
}

/** Baseline: check every pair (i, j) with i < j. */
export function bruteForcePairs(pos: Float64Array, n: number, d: number): ScreenResult {
  const d2 = d * d; // compare squared distances — avoids a sqrt per check
  const pairs: Pair[] = [];
  let checks = 0;
  for (let i = 0; i < n; i++) {
    const xi = pos[3 * i], yi = pos[3 * i + 1], zi = pos[3 * i + 2];
    for (let j = i + 1; j < n; j++) {
      const dx = pos[3 * j] - xi;
      const dy = pos[3 * j + 1] - yi;
      const dz = pos[3 * j + 2] - zi;
      const dist2 = dx * dx + dy * dy + dz * dz;
      checks++;
      if (dist2 < d2) pairs.push({ a: i, b: j, dist: Math.sqrt(dist2) });
    }
  }
  return { pairs: sortPairs(pairs), checks };
}

/** Spatial hash: build the grid with cell size d, then check only the 27 nearby cells. */
export function hashedPairs(pos: Float64Array, n: number, d: number): HashedScreenResult {
  const d2 = d * d;
  const grid = new SpatialHash(d);

  // Phase 1 — build: hash every object into its cell's bucket.  O(n)
  for (let i = 0; i < n; i++) {
    grid.insert(i, pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
  }

  // Phase 2 — query: for each object look only at candidates from the 27 surrounding cells.
  const pairs: Pair[] = [];
  const candidates: number[] = [];
  let checks = 0;
  for (let i = 0; i < n; i++) {
    const xi = pos[3 * i], yi = pos[3 * i + 1], zi = pos[3 * i + 2];
    grid.queryNeighbors(xi, yi, zi, candidates);
    for (let c = 0; c < candidates.length; c++) {
      const j = candidates[c];
      // Every close pair is seen twice — once from i's side and once from j's side.
      // Keeping only i < j reports it exactly once (and skips comparing i with itself).
      if (j <= i) continue;
      const dx = pos[3 * j] - xi;
      const dy = pos[3 * j + 1] - yi;
      const dz = pos[3 * j + 2] - zi;
      const dist2 = dx * dx + dy * dy + dz * dz;
      checks++;
      if (dist2 < d2) pairs.push({ a: i, b: j, dist: Math.sqrt(dist2) });
    }
  }
  return { pairs: sortPairs(pairs), checks, stats: grid.stats(), grid };
}

/** True when both methods found exactly the same pairs at exactly the same distances. */
export function samePairs(p: Pair[], q: Pair[]): boolean {
  if (p.length !== q.length) return false;
  for (let i = 0; i < p.length; i++) {
    if (p[i].a !== q[i].a || p[i].b !== q[i].b || p[i].dist !== q[i].dist) return false;
  }
  return true;
}
