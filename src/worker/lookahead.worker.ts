/**
 * Look-ahead worker: runs the prediction scan (hashing/lookahead.ts) on its own thread so
 * the live simulation worker keeps feeding the globe. Started on demand; the main thread
 * cancels a scan simply by terminating the worker.
 */

import type { OmmRecord } from '../data/types.ts';
import { Lookahead, type FutureApproach } from '../hashing/lookahead.ts';
import { buildSatrecs } from './propagate.ts';

export interface LookaheadRequest {
  records: OmmRecord[];
  mask: Uint8Array;
  startMs: number;
  hours: number;
  alertKm: number;
  /** Optional object index: report only passes that involve this object. */
  focus?: number;
}

export interface LookaheadReply {
  done: boolean;
  fraction: number; // 0 … 1
  total: number; // approaches found so far
  examined: number; // candidate pairs the hash offered up
  closest: FutureApproach[]; // the closest ones so far, nearest first
  elapsedMs: number;
}

const SHOWN = 250;

self.onmessage = (event: MessageEvent<LookaheadRequest>) => {
  const { records, mask, startMs, hours, alertKm, focus = -1 } = event.data;
  const scan = new Lookahead(buildSatrecs(records), mask, startMs, hours, alertKm, focus);
  const began = performance.now();
  let lastReport = began;
  const report = (done: boolean, fraction: number) => {
    const reply: LookaheadReply = {
      done, fraction, total: scan.total, examined: scan.examined,
      closest: scan.closest(SHOWN), elapsedMs: performance.now() - began,
    };
    (self as unknown as Worker).postMessage(reply);
  };
  for (let k = 0; k < scan.steps; k++) {
    scan.step(k);
    if (performance.now() - lastReport > 700) {
      lastReport = performance.now();
      report(false, (k + 1) / scan.steps);
    }
  }
  report(true, 1);
};
