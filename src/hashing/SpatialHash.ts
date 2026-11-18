/**
 * SpatialHash — a 3D hash grid for finding nearby objects in (expected) linear time.
 * =================================================================================
 *
 * THE PROBLEM
 *   We track n ≈ 20,000–30,000 objects in Earth orbit and want every pair that is closer
 *   than a screening distance d (a possible "conjunction"). The obvious way compares every
 *   pair: n(n−1)/2 distance checks — about 450 MILLION for n = 30,000, every time step.
 *
 * WHY HASHING
 *   Almost all of those checks are wasted: a satellite over Brazil cannot be within 10 km
 *   of one over Japan. So we cut space into a grid of cubes ("cells") and store each object
 *   in a hash table keyed by the cell it is in. To find an object's close neighbours we only
 *   look inside a handful of buckets instead of scanning all n objects.
 *
 * CELL SIZE = d  →  THE 27-NEIGHBOUR ARGUMENT
 *   Make every cell exactly d wide. If two objects are closer than d, then along each axis
 *   their coordinates differ by less than d, so their integer cell coordinates
 *   floor(x / d) differ by at most 1. Therefore any close pair lies in the same cell or in
 *   two touching cells. Around one cell there are 3 × 3 × 3 = 27 such cells (itself + 26).
 *   Checking those 27 buckets is guaranteed to find every pair closer than d — no misses.
 *
 * COMPLEXITY
 *   Build:  n inserts, each O(1) expected (one Map lookup + one push)        → O(n)
 *   Query:  n objects × 27 bucket lookups, each O(1) expected, plus one distance check per
 *           candidate. Space is huge and mostly empty, so buckets hold ~1 object → O(n)
 *   Total:  expected O(n + k) for k reported pairs, versus O(n²) for brute force.
 *
 * WORST CASE
 *   If every object lands in ONE cell (d set enormous, or everything clustered together),
 *   that single bucket holds all n objects and we are back to comparing all pairs: O(n²).
 *   Hashing only wins when the hash function spreads the keys out — exactly like a normal
 *   hash table degrading to a linked list when every key collides.
 *
 * This file is standalone: no three.js, no DOM. It runs in the browser worker and in Node.
 */

/** Cell coordinates are shifted by OFFSET so they are never negative (needed for packing). */
const OFFSET = 65536; // 2^16
/** Each shifted coordinate is in [0, RADIX). Three "digits" in base RADIX form the key. */
const RADIX = 131072; // 2^17  →  largest key < (2^17)^3 = 2^51, safely below 2^53

export interface HashStats {
  objects: number; // how many objects were inserted
  occupiedCells: number; // how many buckets exist (cells with at least one object)
  maxBucket: number; // size of the fullest bucket
  avgBucket: number; // objects / occupiedCells (the "load" of an occupied cell)
  histogram: number[]; // how many buckets hold exactly 1, 2, 3, 4 and 5-or-more objects
}

export class SpatialHash {
  /** Edge length of one cubic cell, in km. Set equal to the screening distance d. */
  readonly cellSize: number;
  /** THE hash table: packed cell key → ids of the objects inside that cell (the bucket). */
  private readonly buckets = new Map<number, number[]>();
  private objectCount = 0;

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  /** Empty the table so it can be rebuilt for the next time step. */
  clear(): void {
    this.buckets.clear();
    this.objectCount = 0;
  }

  /**
   * Step 1 of the hash function: continuous km coordinate → shifted integer cell coordinate.
   * floor() (not truncation) keeps negative coordinates in the correct cell.
   * Coordinates outside the grid are clamped onto its outermost cell; clamping never moves
   * two neighbouring coordinates more than one cell apart, so no close pair is ever missed.
   */
  cellCoord(v: number): number {
    const c = Math.floor(v / this.cellSize) + OFFSET;
    return c < 0 ? 0 : c >= RADIX ? RADIX - 1 : c;
  }

  /**
   * Step 2 of the hash function: pack (ix, iy, iz) into ONE number, like the three digits
   * of a base-RADIX number. Different cells always get different keys (no key collisions),
   * and the result is an exact integer because it stays below 2^53.
   * Plain multiplication is used instead of bit shifts because JS bit operators are 32-bit.
   *
   * Why a numeric key and not a string like "3,-2,7"?
   *   - a string key has to be built (allocated) for every single lookup, then hashed
   *     character by character; a number is hashed directly with no allocation
   *   - we do ~28 lookups per object per tick, so that garbage adds up to real time
   *   (`npm run bench` measures both — the numeric key is several times faster.)
   *
   *   String-key version, for comparison (would need a Map<string, number[]>):
   *     key(ix, iy, iz) { return ix + ',' + iy + ',' + iz; }
   */
  key(ix: number, iy: number, iz: number): number {
    return (ix * RADIX + iy) * RADIX + iz;
  }

  /** Inverse of key(): recover the un-shifted integer cell coordinates (used to draw the grid). */
  unpackKey(key: number): [number, number, number] {
    const iz = key % RADIX;
    const rest = (key - iz) / RADIX;
    const iy = rest % RADIX;
    const ix = (rest - iy) / RADIX;
    return [ix - OFFSET, iy - OFFSET, iz - OFFSET];
  }

  /** Put object `id` into the bucket of the cell containing (x, y, z). O(1) expected. */
  insert(id: number, x: number, y: number, z: number): void {
    const k = this.key(this.cellCoord(x), this.cellCoord(y), this.cellCoord(z));
    const bucket = this.buckets.get(k);
    if (bucket) bucket.push(id);
    else this.buckets.set(k, [id]);
    this.objectCount++;
  }

  /** The bucket of the cell containing (x, y, z) — one hash lookup. Empty array if the cell is empty. */
  bucketAt(x: number, y: number, z: number): readonly number[] {
    return this.buckets.get(this.key(this.cellCoord(x), this.cellCoord(y), this.cellCoord(z))) ?? [];
  }

  /**
   * Collect the ids of every object in the 27 cells around (x, y, z) into `out`.
   * These are only CANDIDATES — the caller still measures the true distance.
   * `out` is a reusable scratch array so the hot loop allocates nothing.
   */
  queryNeighbors(x: number, y: number, z: number, out: number[]): number[] {
    out.length = 0;
    const cx = this.cellCoord(x);
    const cy = this.cellCoord(y);
    const cz = this.cellCoord(z);
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iy = cy - 1; iy <= cy + 1; iy++) {
        for (let iz = cz - 1; iz <= cz + 1; iz++) {
          if (ix < 0 || iy < 0 || iz < 0 || ix >= RADIX || iy >= RADIX || iz >= RADIX) continue;
          const bucket = this.buckets.get(this.key(ix, iy, iz));
          if (bucket) for (let b = 0; b < bucket.length; b++) out.push(bucket[b]);
        }
      }
    }
    return out;
  }

  /** How well did the hash spread the objects out? Shown live in the Hash Inspector. */
  stats(): HashStats {
    let maxBucket = 0;
    const histogram = [0, 0, 0, 0, 0];
    for (const bucket of this.buckets.values()) {
      if (bucket.length > maxBucket) maxBucket = bucket.length;
      histogram[Math.min(bucket.length, 5) - 1]++;
    }
    const occupiedCells = this.buckets.size;
    return {
      objects: this.objectCount,
      occupiedCells,
      maxBucket,
      avgBucket: occupiedCells === 0 ? 0 : this.objectCount / occupiedCells,
      histogram,
    };
  }

  /** Visit every occupied cell (integer cell coordinates + its bucket). Used by the grid view. */
  forEachCell(visit: (ix: number, iy: number, iz: number, bucket: readonly number[]) => void): void {
    for (const [key, bucket] of this.buckets) {
      const [ix, iy, iz] = this.unpackKey(key);
      visit(ix, iy, iz, bucket);
    }
  }
}
