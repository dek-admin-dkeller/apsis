/**
 * "Visible tonight" worker: checks a few hundred large, low objects for moments in the next
 * hours when they can be seen with the naked eye from one place (data/visibility.ts holds the
 * maths). It runs on its own thread because a search is hundreds of thousands of SGP4 calls;
 * the main thread only draws. Started on demand, and cancelled, like the look-ahead worker,
 * simply by terminating it.
 */

import { json2satrec, type OMMJsonObject } from 'satellite.js';
import type { OmmRecord } from '../data/types.ts';
import { NAKED_EYE_LIMIT, dropCompanions, findVisiblePasses, makeSite, nightTable, type VisiblePass } from '../data/visibility.ts';

export interface TonightRequest {
  /** The candidates only (chosen on the main thread, where the catalogue facts are). */
  records: OmmRecord[];
  /** Standard magnitude of each candidate, in the same order as `records`. */
  standardMag: number[];
  latDeg: number;
  lonDeg: number;
  startMs: number;
  hours: number;
}

/** A visible pass and whose it is. The NORAD id identifies the object whatever happens to the catalogue meanwhile. */
export interface TonightPass extends VisiblePass {
  noradId: number;
}

export interface TonightReply {
  done: boolean;
  fraction: number; // 0 … 1
  checked: number; // candidates examined so far
  found: number; // visible passes so far, before the faint ones are dropped
  /** Only in the last message: passes within the naked-eye limit, brightest first, docked craft counted once. */
  passes: TonightPass[];
  /** Hours within the searched period during which the place is in darkness (0 = nothing can be seen at all). */
  darkHours: number;
  elapsedMs: number;
}

self.onmessage = (event: MessageEvent<TonightRequest>) => {
  const { records, standardMag, latDeg, lonDeg, startMs, hours } = event.data;
  const began = performance.now();
  const site = makeSite(latDeg, lonDeg);
  const night = nightTable(site, startMs, hours);
  const darkHours = (night.darkSteps * night.stepMs) / 3.6e6;
  const passes: TonightPass[] = [];
  let lastReport = began;
  const report = (done: boolean, checked: number, list: TonightPass[]) => {
    const reply: TonightReply = {
      done, fraction: records.length ? checked / records.length : 1, checked, found: passes.length,
      passes: list, darkHours, elapsedMs: performance.now() - began,
    };
    (self as unknown as Worker).postMessage(reply);
  };

  // Midnight sun: the place never gets dark in this period, so there is nothing to search.
  for (let i = 0; i < records.length && night.darkSteps > 0; i++) {
    const satrec = json2satrec(records[i] as unknown as OMMJsonObject);
    for (const pass of findVisiblePasses(satrec, site, night, standardMag[i])) passes.push({ ...pass, noradId: records[i].NORAD_CAT_ID });
    if (performance.now() - lastReport > 120) {
      lastReport = performance.now();
      report(false, i + 1, []);
    }
  }
  const visible = passes.filter((pass) => pass.magnitude <= NAKED_EYE_LIMIT).sort((a, b) => a.magnitude - b.magnitude);
  report(true, records.length, dropCompanions(visible));
};
