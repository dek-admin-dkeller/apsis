// Checks hashing/groups.ts (union–find): pairs in, connected groups out.
//
//   node scripts/check-groups.mjs        exits 1 if any case fails

import { connectedGroups } from '../src/hashing/groups.ts';

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};

check('no pairs → no groups', connectedGroups([]), []);
check('one pair', connectedGroups([[7, 3]]), [[3, 7]]);
check('a chain is one group', connectedGroups([[1, 2], [2, 3], [3, 4]]), [[1, 2, 3, 4]]);
check('two separate groups, in first-seen order', connectedGroups([[10, 11], [1, 2], [11, 12]]), [[10, 11, 12], [1, 2]]);
check('two groups joined by a later pair', connectedGroups([[1, 2], [3, 4], [2, 3]]), [[1, 2, 3, 4]]);
check('repeated and reversed pairs change nothing', connectedGroups([[1, 2], [2, 1], [1, 2]]), [[1, 2]]);

// A station: every pair among 11 objects (55 pairs) must come back as ONE group of 11.
const station = [];
for (let a = 100; a < 111; a++) for (let b = a + 1; b < 111; b++) station.push([a, b]);
const groups = connectedGroups(station);
check('55 pairs among 11 objects → one group of 11', [groups.length, groups[0].length], [1, 11]);

// Random edges: compare with a plain flood fill.
let seed = 12345;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const edges = Array.from({ length: 400 }, () => [Math.floor(random() * 300), Math.floor(random() * 300)]);
const neighbours = new Map();
for (const [a, b] of edges) {
  if (!neighbours.has(a)) neighbours.set(a, new Set());
  if (!neighbours.has(b)) neighbours.set(b, new Set());
  neighbours.get(a).add(b);
  neighbours.get(b).add(a);
}
const visited = new Set();
const flood = [];
for (const start of neighbours.keys()) {
  if (visited.has(start)) continue;
  const members = [], queue = [start];
  visited.add(start);
  while (queue.length) {
    const x = queue.pop();
    members.push(x);
    for (const y of neighbours.get(x)) if (!visited.has(y)) { visited.add(y); queue.push(y); }
  }
  flood.push(members.sort((p, q) => p - q));
}
const canon = (list) => list.map((g) => g.join(',')).sort();
check('400 random pairs: same groups as a flood fill', canon(connectedGroups(edges)), canon(flood));

console.log(failed ? `${failed} failed` : 'All group checks passed.');
process.exit(failed ? 1 : 0);
