/** Messages exchanged between the main thread and sim.worker.ts. */

import type { OmmRecord } from '../data/types.ts';
import type { BenchRow } from '../hashing/benchmark.ts';

export type ToWorker =
  | { type: 'init'; records: OmmRecord[] }
  | { type: 'propagate'; t: number; epoch: number }
  | { type: 'screen'; t: number; d: number; mask: Uint8Array; seq: number }
  | { type: 'benchmark'; t: number; d: number };

export interface ScreenStats {
  objects: number; // objects hashed this tick
  occupiedCells: number;
  avgBucket: number;
  maxBucket: number;
  histogram: number[]; // buckets holding 1, 2, 3, 4, 5+ objects
  checks: number; // distance checks the hash actually performed
  bruteChecks: number; // what brute force would need: n(n−1)/2
  hashMs: number; // build + query time
  totalPairs: number; // pairs found (the arrays below may be capped)
}

export type FromWorker =
  | { type: 'ready'; count: number }
  | { type: 'positions'; t: number; epoch: number; positions: Float32Array }
  | { type: 'screen'; t: number; d: number; seq: number; pairA: Uint32Array; pairB: Uint32Array; pairDist: Float32Array; stats: ScreenStats }
  | { type: 'benchRow'; row: BenchRow; index: number; total: number }
  | { type: 'benchDone'; d: number };
