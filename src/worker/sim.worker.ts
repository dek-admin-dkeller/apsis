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
import { hashedPairs } from '../hashing/conjunction.ts';
import { buildSatrecs, propagateAll } from './propagate.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

const MAX_PAIRS_SENT = 2000; // the UI never needs more than this; the true total is reported too

let satrecs: SatRec[] = [];
let scratch = new Float64Array(0); // full-precision positions for screening

const post = (msg: FromWorker, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init': {
      satrecs = buildSatrecs(msg.records);
      scratch = new Float64Array(satrecs.length * 3);
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
      propagateAll(satrecs, msg.t, scratch);

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

      const sent = Math.min(result.pairs.length, MAX_PAIRS_SENT);
      const pairA = new Uint32Array(sent);
      const pairB = new Uint32Array(sent);
      const pairDist = new Float32Array(sent);
      for (let k = 0; k < sent; k++) {
        pairA[k] = ids[result.pairs[k].a]; // local index → catalogue index
        pairB[k] = ids[result.pairs[k].b];
        pairDist[k] = result.pairs[k].dist;
      }
      post({
        type: 'screen', t: msg.t, d: msg.d, seq: msg.seq, pairA, pairB, pairDist,
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
        },
      }, [pairA.buffer, pairB.buffer, pairDist.buffer]);
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
