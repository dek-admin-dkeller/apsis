/**
 * Benchmark: time brute force against the spatial hash on the same positions and verify
 * they return identical pairs. Shared by the in-app benchmark modal (inside the worker)
 * and by `npm run bench` (Node), so both report numbers from exactly the same code.
 */

import { bruteForcePairs, hashedPairs, samePairs } from './conjunction.ts';

export interface BenchRow {
  n: number; // objects screened
  pairs: number; // close pairs found
  bruteMs: number; // brute-force time
  hashMs: number; // spatial-hash time (build + query)
  bruteChecks: number; // distance checks done by brute force = n(n−1)/2
  hashChecks: number; // distance checks done by the spatial hash
  speedup: number; // bruteMs / hashMs
  identical: boolean; // both methods returned the same set of pairs
}

/** Sample sizes from the spec: 1k / 2k / 5k / 10k / all objects. */
export function benchmarkSizes(total: number): number[] {
  const sizes = [1000, 2000, 5000, 10000].filter((n) => n < total);
  sizes.push(total);
  return sizes;
}

/**
 * Run `fn` repeatedly until at least `minMs` has elapsed and return the average time.
 * A single run of the hash on 1,000 objects takes a fraction of a millisecond — less than
 * the timer's resolution — so averaging is the only way to measure it honestly.
 */
function timeIt<T>(fn: () => T, minMs = 40, maxRuns = 200): { result: T; ms: number } {
  let runs = 0;
  let result = fn(); // warm-up run (lets the JIT compile the loop); not timed
  const start = performance.now();
  let elapsed = 0;
  do {
    result = fn();
    runs++;
    elapsed = performance.now() - start;
  } while (elapsed < minMs && runs < maxRuns);
  return { result, ms: elapsed / runs };
}

/** Benchmark the first n objects of `pos` (packed x, y, z in km) at screening distance d. */
export function benchmarkSize(pos: Float64Array, n: number, d: number): BenchRow {
  const brute = timeIt(() => bruteForcePairs(pos, n, d));
  const hash = timeIt(() => hashedPairs(pos, n, d));
  return {
    n,
    pairs: hash.result.pairs.length,
    bruteMs: brute.ms,
    hashMs: hash.ms,
    bruteChecks: brute.result.checks,
    hashChecks: hash.result.checks,
    speedup: brute.ms / hash.ms,
    identical: samePairs(brute.result.pairs, hash.result.pairs),
  };
}

/**
 * Shuffle the objects (deterministically) so that "the first n" is a fair random sample
 * of the whole catalogue instead of, say, only the oldest satellites.
 * Objects whose position is not finite (decayed / failed propagation) are dropped.
 */
export function shuffledPositions(pos: Float64Array, count: number, seed = 2710): Float64Array {
  const order: number[] = [];
  for (let i = 0; i < count; i++) {
    if (Number.isFinite(pos[3 * i]) && (pos[3 * i] !== 0 || pos[3 * i + 1] !== 0 || pos[3 * i + 2] !== 0)) order.push(i);
  }
  let state = seed; // mulberry32: a tiny seeded random-number generator
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const out = new Float64Array(order.length * 3);
  order.forEach((src, dst) => {
    out[3 * dst] = pos[3 * src];
    out[3 * dst + 1] = pos[3 * src + 1];
    out[3 * dst + 2] = pos[3 * src + 2];
  });
  return out;
}
