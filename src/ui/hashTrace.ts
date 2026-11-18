/**
 * Hash trace: follow ONE object through the spatial hash, step by step, with its real
 * numbers. This is the same work the screening worker does for every object each tick —
 * here it is done on the main thread for just the selected one, using the same
 * SpatialHash class, so the panel shows exactly what the algorithm computes.
 */

import type { Catalog } from '../data/catalog.ts';
import type { Satellite } from '../data/types.ts';
import { SpatialHash } from '../hashing/SpatialHash.ts';
import type { SimClient } from '../worker/SimClient.ts';
import { $, fmt, fmtInt } from './dom.ts';

export interface TraceResult {
  cell: [number, number, number];
  bucketSize: number;
}

export class HashTrace {
  private readonly sim: SimClient;

  constructor(sim: SimClient) {
    this.sim = sim;
  }

  clear(): void {
    $('trace').classList.add('is-hidden');
    $('trace-empty').classList.remove('is-hidden');
  }

  /**
   * Hash every visible object (as the screening does), then walk the selected object
   * through the six steps and write each intermediate value into the Trace tab.
   */
  run(sat: Satellite, catalog: Catalog, visible: Uint8Array, d: number): TraceResult | null {
    const me = { x: 0, y: 0, z: 0 };
    if (!this.sim.getPosition(sat.index, me)) return null;

    // Build: one insert per object.
    const grid = new SpatialHash(d);
    const p = { x: 0, y: 0, z: 0 };
    let hashed = 0;
    for (let i = 0; i < this.sim.count; i++) {
      if ((visible[i] || i === sat.index) && this.sim.getPosition(i, p)) {
        grid.insert(i, p.x, p.y, p.z);
        hashed++;
      }
    }

    // Steps 2–4: cell coordinates, packed key, bucket.
    const cell: [number, number, number] = [Math.floor(me.x / d), Math.floor(me.y / d), Math.floor(me.z / d)];
    const key = grid.key(grid.cellCoord(me.x), grid.cellCoord(me.y), grid.cellCoord(me.z));
    const bucket = grid.bucketAt(me.x, me.y, me.z);

    // Step 5: the 27 surrounding cells.
    let occupied = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      if (grid.bucketAt(me.x + dx * d, me.y + dy * d, me.z + dz * d).length > 0) occupied++;
    }
    const candidates = grid.queryNeighbors(me.x, me.y, me.z, []).filter((id) => id !== sat.index);

    // Step 6: true distance to each candidate.
    const close: { name: string; dist: number }[] = [];
    for (const id of candidates) {
      if (!this.sim.getPosition(id, p)) continue;
      const dist = Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z);
      if (dist < d) close.push({ name: catalog.sats[id].name, dist });
    }
    close.sort((a, b) => a.dist - b.dist);

    const others = bucket.filter((id) => id !== sat.index).map((id) => catalog.sats[id].name);
    $('trace-name').textContent = sat.name;
    $('tr-pos').textContent = `x ${fmt(me.x, 1)}  y ${fmt(me.y, 1)}  z ${fmt(me.z, 1)} km`;
    $('tr-cell').textContent = `⌊pos ÷ ${d}⌋ = (${cell.join(', ')})`;
    $('tr-key').textContent = `key ${fmtInt(key)}`;
    $('tr-bucket').textContent = others.length === 0
      ? 'buckets.get(key) → just this object'
      : `buckets.get(key) → ${bucket.length} objects: with ${others.slice(0, 2).join(', ')}${others.length > 2 ? ` +${others.length - 2}` : ''}`;
    $('tr-neigh').textContent = `${occupied} of 27 occupied → ${fmtInt(candidates.length)} candidate${candidates.length === 1 ? '' : 's'}`;
    $('tr-checks').textContent = `${fmtInt(candidates.length)} check${candidates.length === 1 ? '' : 's'} instead of ${fmtInt(hashed - 1)}`;
    $('tr-result').textContent = close.length === 0
      ? `Result: nothing within ${d} km of it right now.`
      : `Result: ${close.length} within ${d} km — nearest is ${close[0].name} at ${fmt(close[0].dist, 2)} km.`;
    $('trace').classList.remove('is-hidden');
    $('trace-empty').classList.add('is-hidden');
    return { cell, bucketSize: bucket.length };
  }
}
