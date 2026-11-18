/**
 * Groups of joined objects (union–find, with a hash table as the parent array).
 *
 * The screening reports PAIRS. But a space station is catalogued as a dozen separate objects
 * (its modules, the capsules docked to it), all at the same place, so it arrives as every
 * pair among them: 11 objects → 55 pairs that all say "0 m". Listing those 55 rows, and
 * opening a "close approach" between two parts of one spacecraft, tells nobody anything.
 *
 * This turns such pairs back into the groups they came from. Objects are nodes, a pair is an
 * edge, and a group is a connected component:
 *
 *   find(x)      follow parent pointers from x to the group's representative
 *   union(a, b)  point one representative at the other
 *
 * `parent` is a Map<object, object>: an object that is not in it yet is its own
 * representative, so nothing has to be set up in advance for the ~20,000 objects that are
 * never in a pair. Path halving (each visited node is pointed at its grandparent) keeps the
 * chains short; n unions then cost about O(n) in practice.
 *
 * Standalone on purpose, like SpatialHash.ts: no imports, plain numbers in, plain arrays out.
 */

/**
 * The connected components of a set of edges. Each group lists its members in ascending
 * order; the groups come in the order their first edge was given. Objects that appear in no
 * edge are in no group.
 */
export function connectedGroups(edges: Iterable<readonly [number, number]>): number[][] {
  const parent = new Map<number, number>();

  const find = (x: number): number => {
    let node = x;
    for (;;) {
      const up = parent.get(node);
      if (up === undefined || up === node) return node;
      const upUp = parent.get(up);
      if (upUp !== undefined && upUp !== up) parent.set(node, upUp); // path halving
      node = up;
    }
  };

  const seen: number[] = []; // every object that is in some edge, in first-seen order
  const note = (x: number): void => {
    if (!parent.has(x)) {
      parent.set(x, x);
      seen.push(x);
    }
  };

  for (const [a, b] of edges) {
    note(a);
    note(b);
    const rootA = find(a), rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA); // union
  }

  // Collect the members under each representative (a Map again: representative → members).
  const groups = new Map<number, number[]>();
  for (const x of seen) {
    const root = find(x);
    const members = groups.get(root);
    if (members) members.push(x);
    else groups.set(root, [x]);
  }
  return [...groups.values()].map((members) => members.sort((p, q) => p - q));
}
