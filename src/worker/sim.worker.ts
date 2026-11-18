/**
 * Simulation worker — everything heavy runs here so the UI thread stays at 60 fps.
 *
 * It answers three kinds of request:
 *   propagate  SGP4 for every object at time t → Float32Array of positions, TRANSFERRED
 *              (zero-copy) to the main thread, which interpolates between snapshots.
 *   screen     conjunction screening at time t with distance d, using the spatial hash.
 *   benchmark  brute force vs spatial hash on growing sample sizes.
 */

import type { SatRec } from 'satellite.js';
import { benchmarkSize, benchmarkSizes, shuffledPositions } from '../hashing/benchmark.ts';
import { hashedPairs, TOGETHER_KM_S } from '../hashing/conjunction.ts';
import { buildSatrecs, propagateAll } from './propagate.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

// The UI never needs more pairs than this of each kind; the true totals are reported too.
const MAX_PASSING_SENT = 1500;
const MAX_TOGETHER_SENT = 500;

let satrecs: SatRec[] = [];
let scratch = new Float64Array(0); // full-precision positions for screening
let velocity = new Float64Array(0); // … and velocities, to tell a passing pair from one flying together

const post = (msg: FromWorker, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init': {
      satrecs = buildSatrecs(msg.records);
      scratch = new Float64Array(satrecs.length * 3);
      velocity = new Float64Array(satrecs.length * 3);
      post({ type: 'ready', count: satrecs.length });
      break;
    }

    case 'propagate': {
      const positions = new Float32Array(satrecs.length * 3);
      propagateAll(satrecs, msg.t, positions);
      post({ type: 'positions', t: msg.t, epoch: msg.epoch, positions }, [positions.buffer]);
      break;
    }

    case 'screen': {
      propagateAll(satrecs, msg.t, scratch, velocity);

      // Screen only the objects that are currently shown (filters) and have a valid position.
      const ids: number[] = [];
      for (let i = 0; i < satrecs.length; i++) {
        const valid = scratch[3 * i] !== 0 || scratch[3 * i + 1] !== 0 || scratch[3 * i + 2] !== 0;
        if (msg.mask[i] && valid) ids.push(i);
      }
      const n = ids.length;
      const pos = new Float64Array(n * 3);
      for (let k = 0; k < n; k++) {
        pos[3 * k] = scratch[3 * ids[k]];
        pos[3 * k + 1] = scratch[3 * ids[k] + 1];
        pos[3 * k + 2] = scratch[3 * ids[k] + 2];
      }

      const start = performance.now();
      const result = hashedPairs(pos, n, msg.d); // ← the spatial hash (src/hashing)
      const hashMs = performance.now() - start;

      // Sort every pair into "passing" or "flying together" by its relative speed, and keep
      // the closest of each kind for the list (the pairs are already ordered by distance).
      const sentA: number[] = [], sentB: number[] = [], sentDist: number[] = [], sentSpeed: number[] = [];
      let passing = 0, together = 0;
      for (const pair of result.pairs) {
        const i = ids[pair.a], j = ids[pair.b]; // local index → catalogue index
        const speed = Math.hypot(velocity[3 * i] - velocity[3 * j], velocity[3 * i + 1] - velocity[3 * j + 1], velocity[3 * i + 2] - velocity[3 * j + 2]);
        const isTogether = speed < TOGETHER_KM_S;
        if (isTogether ? together++ >= MAX_TOGETHER_SENT : passing++ >= MAX_PASSING_SENT) continue;
        sentA.push(i);
        sentB.push(j);
        sentDist.push(pair.dist);
        sentSpeed.push(speed);
      }
      const pairA = Uint32Array.from(sentA);
      const pairB = Uint32Array.from(sentB);
      const pairDist = Float32Array.from(sentDist);
      const pairSpeed = Float32Array.from(sentSpeed);
      post({
        type: 'screen', t: msg.t, d: msg.d, seq: msg.seq, pairA, pairB, pairDist, pairSpeed,
        stats: {
          objects: n,
          occupiedCells: result.stats.occupiedCells,
          avgBucket: result.stats.avgBucket,
          maxBucket: result.stats.maxBucket,
          histogram: result.stats.histogram,
          checks: result.checks,
          bruteChecks: (n * (n - 1)) / 2,
          hashMs,
          totalPairs: result.pairs.length,
          passing,
          together,
        },
      }, [pairA.buffer, pairB.buffer, pairDist.buffer, pairSpeed.buffer]);
      break;
    }

    case 'benchmark': {
      propagateAll(satrecs, msg.t, scratch);
      const pos = shuffledPositions(scratch, satrecs.length);
      const sizes = benchmarkSizes(pos.length / 3);
      sizes.forEach((n, index) => {
        post({ type: 'benchRow', row: benchmarkSize(pos, n, msg.d), index, total: sizes.length });
      });
      post({ type: 'benchDone', d: msg.d });
      break;
    }
  }
};
