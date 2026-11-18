// scripts/check-report.mjs — `node scripts/check-report.mjs`
//
// Sanity check for the numbers in the close-approach report and CSV (src/data/approachData.ts):
// takes real pairs from the snapshot (found with the project's own spatial hash), works out
// each closest approach the way the panel does, and checks that
//   - the miss distance and relative speed equal what closestApproach() in ephemeris.ts says;
//   - radial² + along-track² + cross-track² = miss distance²;
//   - for a pair that really passes, the separation is at right angles to the relative
//     velocity at the closest point (the definition of "closest");
//   - the CSV's middle row is the closest approach and its ranges match its own positions.
// Exits 1 if any check fails.

import { readFile } from 'node:fs/promises';
import { closestApproach, rangeKm } from '../src/data/ephemeris.ts';
import { approachCsv, approachRows, epochMs, summarize, tableStepS } from '../src/data/approachData.ts';
import { hashedPairs } from '../src/hashing/conjunction.ts';
import { buildSatrecs, propagateAll } from '../src/worker/propagate.ts';

const snapshot = JSON.parse(await readFile(new URL('../public/data/satellites.json', import.meta.url), 'utf8'));
const satrecs = buildSatrecs(snapshot.objects);
const when = Date.parse(snapshot.fetchedAt); // fixed time → the same output on every run
const pos = new Float64Array(satrecs.length * 3);
propagateAll(satrecs, when, pos);
const { pairs } = hashedPairs(pos, satrecs.length, 25);

let failures = 0;
const check = (ok, text) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${text}`);
  if (!ok) failures++;
};

// Two crossing pairs and one pair flying together, to cover both kinds the panel shows.
const picked = [];
for (const pair of pairs) {
  const approach = closestApproach(satrecs[pair.a], satrecs[pair.b], when);
  const kind = approach.coMoving ? 'together' : 'crossing';
  if (picked.filter((p) => p.kind === kind).length < (kind === 'crossing' ? 2 : 1)) picked.push({ pair, approach, kind });
  if (picked.length === 3) break;
}

for (const { pair, approach, kind } of picked) {
  const A = snapshot.objects[pair.a], B = snapshot.objects[pair.b], recA = satrecs[pair.a], recB = satrecs[pair.b];
  // The window the panel uses (ui/encounterPanel.ts).
  const windowS = approach.coMoving ? 300 : Math.min(120, Math.max(1.5, (6 * Math.max(approach.missKm, 1)) / approach.relSpeedKmS));
  const s = summarize(recA, recB, approach.tcaMs);
  console.log(`\n${A.OBJECT_NAME} (${A.NORAD_CAT_ID}) and ${B.OBJECT_NAME} (${B.NORAD_CAT_ID}) — ${kind}`);
  console.log(`  closest ${new Date(s.tcaMs).toISOString()}  miss ${s.missKm.toFixed(4)} km  relative speed ${s.relSpeedKmS.toFixed(4)} km/s  paths at ${s.crossingAngleDeg.toFixed(1)}°`);
  console.log(`  radial ${s.split.radialKm.toFixed(4)}  along-track ${s.split.alongKm.toFixed(4)}  cross-track ${s.split.crossKm.toFixed(4)} km`
    + `   midpoint ${s.mid.latDeg.toFixed(2)}°, ${s.mid.lonDeg.toFixed(2)}° at ${s.mid.altKm.toFixed(1)} km`
    + `   elements ${s.a.elementAgeDays.toFixed(2)} and ${s.b.elementAgeDays.toFixed(2)} days old`);
  check(Math.abs(s.missKm - approach.missKm) < 1e-9 && Math.abs(s.relSpeedKmS - approach.relSpeedKmS) < 1e-9, 'miss distance and relative speed equal closestApproach()');
  const sumSquares = s.split.radialKm ** 2 + s.split.alongKm ** 2 + s.split.crossKm ** 2;
  check(Math.abs(Math.sqrt(sumSquares) - s.missKm) < 1e-9, `radial² + along² + cross² = miss² (${Math.sqrt(sumSquares).toFixed(9)} vs ${s.missKm.toFixed(9)} km)`);
  check(Math.abs(Date.parse(A.EPOCH + 'Z') - epochMs(recA)) < 2, 'the epoch read from the propagator equals the EPOCH field of the record');
  check(s.a.altKm > 100 && s.a.altKm < 60000 && Math.abs(s.mid.altKm - (s.a.altKm + s.b.altKm) / 2) < 1, 'altitudes are sensible and the midpoint lies between the two');
  if (kind === 'crossing') {
    const d = { x: s.b.position.x - s.a.position.x, y: s.b.position.y - s.a.position.y, z: s.b.position.z - s.a.position.z };
    const v = { x: s.b.velocity.x - s.a.velocity.x, y: s.b.velocity.y - s.a.velocity.y, z: s.b.velocity.z - s.a.velocity.z };
    const cosine = (d.x * v.x + d.y * v.y + d.z * v.z) / (s.missKm * s.relSpeedKmS);
    check(Math.abs(cosine) < 1e-3, `at the closest point the separation is at right angles to the relative velocity (cosine ${cosine.toExponential(1)})`);
    check(rangeKm(recA, recB, s.tcaMs - 500) > s.missKm && rangeKm(recA, recB, s.tcaMs + 500) > s.missKm, 'the range is larger half a second before and after');
  }

  const rows = approachRows(recA, recB, s.tcaMs, windowS);
  const csv = approachCsv(rows, s, { nameA: A.OBJECT_NAME, noradA: A.NORAD_CAT_ID, nameB: B.OBJECT_NAME, noradB: B.NORAD_CAT_ID });
  const lines = csv.trimEnd().split('\r\n');
  const header = lines.findIndex((line) => !line.startsWith('#'));
  const data = lines.slice(header + 1).map((line) => line.split(','));
  console.log(`  CSV: ${data.length} rows every ${tableStepS(windowS)} s over ±${windowS.toFixed(2)} s, ${lines[header].split(',').length} columns, ${header} comment lines, ${csv.length} bytes`);
  console.log(`    ${lines[header].slice(0, 96)}…`);
  console.log(`    ${lines[header + 1 + (data.length >> 1)].slice(0, 96)}…`);
  const middle = data[data.length >> 1];
  check(data.length % 2 === 1 && Math.abs(Number(middle[1])) <= 0.0005 + 1e-9, 'the middle row is the closest approach (within half a millisecond)');
  check(data.every((row) => row.length === 15 && row.every((cell, i) => i === 0 || Number.isFinite(Number(cell)))), 'every row has 15 columns of numbers');
  const smallest = Math.min(...data.map((row) => Number(row[2])));
  check(Math.abs(smallest - s.missKm) < Math.max(0.002, s.missKm * 1e-3), `the smallest range in the table (${smallest.toFixed(6)} km) is the miss distance`);
  const rangeFromColumns = (row) => Math.hypot(row[9] - row[3], row[10] - row[4], row[11] - row[5]);
  check(data.every((row) => Math.abs(rangeFromColumns(row.map(Number)) - Number(row[2])) < 5e-6), 'each range equals the distance between the two positions on its row');
  check(data.every((row) => !Number.isNaN(Date.parse(row[0])) && row[0].endsWith('Z')), 'times are ISO 8601 in UTC');
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
