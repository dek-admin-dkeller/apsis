// scripts/bench.mjs — `npm run bench`  (optional: `npm run bench -- --d=25`)
//
// Runs the SAME benchmark as the in-app modal, in Node, and prints tables for the report.
// Node 22.18+ imports the project's TypeScript files directly (built-in type stripping).

import { readFile } from 'node:fs/promises';
import { bruteForcePairs, hashedPairs, samePairs } from '../src/hashing/conjunction.ts';
import { benchmarkSize, benchmarkSizes, shuffledPositions } from '../src/hashing/benchmark.ts';
import { buildSatrecs, propagateAll } from '../src/worker/propagate.ts';

const dArg = process.argv.find((a) => a.startsWith('--d='));
const d = dArg ? Number(dArg.slice(4)) : 10;

const snapshot = JSON.parse(await readFile(new URL('../public/data/satellites.json', import.meta.url), 'utf8'));
const satrecs = buildSatrecs(snapshot.objects);
const all = new Float64Array(satrecs.length * 3);
const when = Date.parse(snapshot.fetchedAt); // fixed time → the same numbers on every run
let t0 = performance.now();
propagateAll(satrecs, when, all);
const propagateMs = performance.now() - t0;
const pos = shuffledPositions(all, satrecs.length);
const total = pos.length / 3;

console.log(`\nOrbitHash benchmark — ${total} objects from the snapshot of ${snapshot.fetchedAt}`);
console.log(`SGP4 propagation of all objects: ${propagateMs.toFixed(1)} ms.  Screening distance d = ${d} km\n`);

const fmt = (x, digits = 2) => x.toFixed(digits).padStart(10);
const row = (cells) => console.log(cells.join(' | '));

// ---- 1. Real catalogue: brute force vs spatial hash --------------------------------------
row(['       n', '  brute ms', '   hash ms', '  speedup', 'brute checks', 'hash checks', 'pairs', 'identical']);
row(['--------', '----------', '----------', '---------', '------------', '-----------', '-----', '---------']);
let allIdentical = true;
for (const n of benchmarkSizes(total)) {
  const r = benchmarkSize(pos, n, d);
  allIdentical &&= r.identical;
  row([
    String(r.n).padStart(8), fmt(r.bruteMs), fmt(r.hashMs, 3), (r.speedup.toFixed(1) + 'x').padStart(9),
    String(r.bruteChecks).padStart(12), String(r.hashChecks).padStart(11), String(r.pairs).padStart(5),
    r.identical ? 'yes' : 'NO  <-- MISMATCH',
  ]);
}

// ---- 2. Dense stress test: many pairs, so "identical" is a demanding check ----------------
// Real orbits are sparse (few pairs), so we also verify on a crowded random cloud where
// thousands of pairs exist, including negative coordinates on every axis.
{
  const n = 6000, side = 400; // 6,000 points in a 400 km cube centred on the origin
  let s = 12345;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
  const cloud = new Float64Array(n * 3).map(() => (rnd() - 0.5) * side);
  const brute = bruteForcePairs(cloud, n, d);
  const hash = hashedPairs(cloud, n, d);
  const same = samePairs(brute.pairs, hash.pairs);
  allIdentical &&= same;
  console.log(`\nDense stress test: ${n} random points in a ${side} km cube → ${brute.pairs.length} pairs; ` +
    `hash used ${hash.checks} checks vs ${brute.checks}; identical: ${same ? 'yes' : 'NO  <-- MISMATCH'}`);
}

// ---- 3. Worst case: everything in one cell → the hash degrades to O(n²) -------------------
{
  const n = 1000; // kept small: with a giant d EVERY pair is "close", so the output itself is n²/2
  const r = benchmarkSize(pos, n, 1e6); // d = 1,000,000 km: all objects share one neighbourhood
  console.log(`Worst case (d = 1,000,000 km, ${n} objects in one neighbourhood): brute ${r.bruteMs.toFixed(1)} ms, ` +
    `hash ${r.hashMs.toFixed(1)} ms, hash checks ${r.hashChecks} = brute checks ${r.bruteChecks}; identical: ${r.identical ? 'yes' : 'NO'}`);
  allIdentical &&= r.identical;
}

// ---- 4. Numeric key vs string key (why SpatialHash packs the cell into one number) --------
{
  const RADIX = 131072, OFFSET = 65536;
  const cell = (v) => Math.floor(v / d) + OFFSET;
  const time = (makeKey) => {
    const run = () => {
      const map = new Map();
      for (let i = 0; i < total; i++) {
        const k = makeKey(cell(pos[3 * i]), cell(pos[3 * i + 1]), cell(pos[3 * i + 2]));
        const b = map.get(k);
        if (b) b.push(i); else map.set(k, [i]);
      }
      let found = 0; // then 27 lookups per object, like queryNeighbors()
      for (let i = 0; i < total; i++) {
        const cx = cell(pos[3 * i]), cy = cell(pos[3 * i + 1]), cz = cell(pos[3 * i + 2]);
        for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (let z = cz - 1; z <= cz + 1; z++) {
          if (map.get(makeKey(x, y, z))) found++;
        }
      }
      return found;
    };
    run(); // warm-up
    const start = performance.now();
    for (let r = 0; r < 5; r++) run();
    return (performance.now() - start) / 5;
  };
  const numeric = time((x, y, z) => (x * RADIX + y) * RADIX + z);
  const string = time((x, y, z) => x + ',' + y + ',' + z);
  console.log(`Key type (build + 27 lookups × ${total} objects): numeric key ${numeric.toFixed(1)} ms, ` +
    `string key ${string.toFixed(1)} ms  →  numeric is ${(string / numeric).toFixed(1)}x faster`);
}

// ---- Look-ahead (the "Coming hours" scan): speed, then completeness ----
// Completeness is checked against brute-force SAMPLING: propagate a subset every 0.2 s and
// record every crossing pair seen inside the alert distance. The look-ahead scan samples
// 300 times less often (once a minute) and must still report every one of those pairs.
{
  const { Lookahead } = await import('../src/hashing/lookahead.ts');
  const { SpatialHash } = await import('../src/hashing/SpatialHash.ts');
  const { sgp4 } = await import('satellite.js');
  const n = satrecs.length;
  const since = (rec, t) => (t / 86400000 + 2440587.5 - rec.jdsatepoch) * 1440;

  let scan = new Lookahead(satrecs, new Uint8Array(n).fill(1), when, 1, 1);
  let start = performance.now();
  for (let k = 0; k < scan.steps; k++) scan.step(k);
  console.log(`Look-ahead, all ${n} objects, next 1 h, 1 km: ${scan.total} passes in ${((performance.now() - start) / 1000).toFixed(1)} s ` +
    `(${(scan.examined / 1e6).toFixed(0)} M candidate pairs instead of ${((n * (n - 1)) / 2 * scan.steps / 1e9).toFixed(0)} B)`);

  const m = 4000, alertKm = 5, minutes = 6;
  const mask = new Uint8Array(n);
  mask.fill(1, 0, m);
  scan = new Lookahead(satrecs, mask, when, minutes / 60, alertKm);
  for (let k = 0; k < scan.steps; k++) scan.step(k);
  const predicted = new Set(scan.closest(Infinity).map((e) => e.a * n + e.b));
  const seen = new Set();
  const p = new Float64Array(m * 3), v = new Float64Array(m * 3), out = [];
  for (let s = 0; s < minutes * 60 * 5; s++) {
    const t = when + s * 200;
    const grid = new SpatialHash(alertKm);
    for (let i = 0; i < m; i++) {
      const st = sgp4(satrecs[i], since(satrecs[i], t));
      if (!st || !Number.isFinite(st.position.x)) { p[3 * i] = NaN; continue; }
      p[3 * i] = st.position.x; p[3 * i + 1] = st.position.y; p[3 * i + 2] = st.position.z;
      v[3 * i] = st.velocity.x; v[3 * i + 1] = st.velocity.y; v[3 * i + 2] = st.velocity.z;
      grid.insert(i, st.position.x, st.position.y, st.position.z);
    }
    for (let i = 0; i < m; i++) {
      if (Number.isNaN(p[3 * i])) continue;
      for (const j of grid.queryNeighbors(p[3 * i], p[3 * i + 1], p[3 * i + 2], out)) {
        if (j <= i) continue;
        const dist = Math.hypot(p[3 * j] - p[3 * i], p[3 * j + 1] - p[3 * i + 1], p[3 * j + 2] - p[3 * i + 2]);
        const closing = Math.hypot(v[3 * j] - v[3 * i], v[3 * j + 1] - v[3 * i + 1], v[3 * j + 2] - v[3 * i + 2]);
        if (dist < alertKm && closing >= 0.05) seen.add(i * n + j);
      }
    }
  }
  let missed = 0;
  for (const key of seen) if (!predicted.has(key)) missed++;
  console.log(`Look-ahead check (${m} objects, ${minutes} min, ${alertKm} km): sampling every 0.2 s saw ${seen.size} crossing pairs; ` +
    `the scan reported ${predicted.size}; missed: ${missed}`);
  if (missed > 0) allIdentical = false;
}

console.log(allIdentical ? '\nAll checks passed: hashed and brute-force pair sets match at every size.\n'
  : '\nFAILED: at least one size produced different pair sets.\n');
process.exitCode = allIdentical ? 0 : 1;
