/**
 * "Show hash grid": draws the actual hash cells as wireframe cubes.
 *
 * Every frame the objects near the focus point are inserted into a real SpatialHash
 * (the same class the screening uses) and one cube is drawn per occupied bucket:
 *   teal  = a cell holding one object        red = a cell holding 2+ objects (a shared bucket)
 *   cyan  = the selected object's cell, with the 3 × 3 × 3 block of cells around it —
 *           the 27 buckets a neighbour query looks into.
 *
 * While a close approach is open the drawing is about that pair instead: object A's cell in
 * cyan with the block of 27 its query searches, object B's cell in amber, both lightly
 * filled so they read as boxes. The pair is found because B's cell lies inside A's block
 * (or is the very same cell). While the two are inside the alert distance both cells turn
 * red and pulse: that is the moment the screening flags them.
 */

import * as THREE from 'three';
import { SpatialHash } from '../hashing/SpatialHash.ts';
import type { SimClient } from '../worker/SimClient.ts';
import type { SceneKit } from './scene.ts';

const MAX_CELLS = 500;
const MAX_SEGMENTS = MAX_CELLS * 12 + 6 * 12 + 48; // cubes + highlighted cells (drawn three times for weight) + neighbour lattice
const CYAN: [number, number, number] = [0.5, 1.6, 2.0]; // object A / the selected object
const AMBER: [number, number, number] = [2.0, 1.25, 0.45]; // object B
const HOT: [number, number, number] = [2.0, 0.3, 0.36]; // inside the alert distance

/** The two objects of an open close approach (ECI km) and how far apart they are right now. */
export interface PairCells {
  a: Vec3;
  b: Vec3;
  rangeKm: number;
}

type Vec3 = { x: number; y: number; z: number };

// The 12 edges of a unit cube, as pairs of corner coordinates.
const CUBE_EDGES: number[] = [];
for (const [a, b] of [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) {
  CUBE_EDGES.push(a & 1, (a >> 1) & 1, (a >> 2) & 1, b & 1, (b >> 1) & 1, (b >> 2) & 1);
}

export class GridViz {
  private readonly lines: THREE.LineSegments;
  private readonly positions = new Float32Array(MAX_SEGMENTS * 6);
  private readonly colors = new Float32Array(MAX_SEGMENTS * 6);
  private readonly sim: SimClient;
  private cursor = 0; // vertices written so far this frame
  private readonly fills: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>[] = [];
  /** Shown in the UI: how many cells are currently drawn. */
  cellsDrawn = 0;
  /** For a pair: do the two share a cell, sit in neighbouring cells, or neither (too far apart to be found)? */
  pairState: 'same' | 'neighbours' | 'apart' = 'apart';

  constructor(kit: SceneKit, sim: SimClient) {
    this.sim = sim;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    this.lines.renderOrder = 1;
    kit.eciGroup.add(this.lines);
    // Two see-through boxes for the cells of a close-approach pair.
    for (let k = 0; k < 2; k++) {
      const fill = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      );
      fill.visible = false;
      fill.renderOrder = 1;
      kit.eciGroup.add(fill);
      this.fills.push(fill);
    }
  }

  setVisible(on: boolean): void {
    this.lines.visible = on;
    if (!on) for (const fill of this.fills) fill.visible = false;
  }

  private segment(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, r: number, g: number, b: number): void {
    if (this.cursor >= MAX_SEGMENTS * 2) return;
    this.positions.set([x1, y1, z1, x2, y2, z2], this.cursor * 3);
    this.colors.set([r, g, b, r, g, b], this.cursor * 3);
    this.cursor += 2;
  }

  /** Wireframe cube for cell (ix, iy, iz) of edge length `size` cells. */
  private cube(ix: number, iy: number, iz: number, d: number, size: number, r: number, g: number, b: number): void {
    for (let e = 0; e < CUBE_EDGES.length; e += 6) {
      this.segment(
        (ix + CUBE_EDGES[e] * size) * d, (iy + CUBE_EDGES[e + 1] * size) * d, (iz + CUBE_EDGES[e + 2] * size) * d,
        (ix + CUBE_EDGES[e + 3] * size) * d, (iy + CUBE_EDGES[e + 4] * size) * d, (iz + CUBE_EDGES[e + 5] * size) * d,
        r, g, b,
      );
    }
  }

  /** A cell drawn with weight: three cubes a hair apart read as one thick outline. */
  private boldCube(ix: number, iy: number, iz: number, d: number, [r, g, b]: [number, number, number]): void {
    for (const grow of [0, 0.012, -0.012]) this.cube(ix - grow / 2, iy - grow / 2, iz - grow / 2, d, 1 + grow, r, g, b);
  }

  /** The lattice of the 3 × 3 × 3 block of cells around cell (cx, cy, cz): what a neighbour query visits. */
  private block(cx: number, cy: number, cz: number, d: number): void {
    for (let u = -1; u <= 2; u++) {
      for (let v = -1; v <= 2; v++) {
        this.segment((cx - 1) * d, (cy + u) * d, (cz + v) * d, (cx + 2) * d, (cy + u) * d, (cz + v) * d, 0.1, 0.3, 0.42);
        this.segment((cx + u) * d, (cy - 1) * d, (cz + v) * d, (cx + u) * d, (cy + 2) * d, (cz + v) * d, 0.1, 0.3, 0.42);
        this.segment((cx + u) * d, (cy + v) * d, (cz - 1) * d, (cx + u) * d, (cy + v) * d, (cz + 2) * d, 0.1, 0.3, 0.42);
      }
    }
  }

  private fill(which: number, ix: number, iy: number, iz: number, d: number, [r, g, b]: [number, number, number], opacity: number): void {
    const fill = this.fills[which];
    fill.visible = true;
    fill.position.set((ix + 0.5) * d, (iy + 0.5) * d, (iz + 0.5) * d);
    fill.scale.setScalar(d);
    fill.material.color.setRGB(r, g, b).multiplyScalar(0.5);
    fill.material.opacity = opacity;
  }

  /**
   * @param d        cell size = screening distance (km)
   * @param focus    centre of the region to visualise (ECI km)
   * @param selected index of the selected object, or −1
   * @param visible  filter mask (hidden objects are not hashed)
   * @param pair     the two objects of an open close approach, if one is open
   * @param seconds  real time, for the pulse
   */
  update(d: number, focus: Vec3, selected: number, visible: Uint8Array, pair: PairCells | null = null, seconds = 0): void {
    if (!this.lines.visible || !this.sim.hasData) return;
    this.cursor = 0;
    for (const fill of this.fills) fill.visible = false;

    // Hash the objects near the focus point — exactly what the screening does for all of them.
    const grid = new SpatialHash(d);
    const radius = THREE.MathUtils.clamp(60 * d, 600, 2500);
    const p = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < this.sim.count; i++) {
      if (!visible[i] || !this.sim.getPosition(i, p)) continue;
      if ((p.x - focus.x) ** 2 + (p.y - focus.y) ** 2 + (p.z - focus.z) ** 2 < radius * radius) grid.insert(i, p.x, p.y, p.z);
    }

    // One cube per occupied bucket, nearest cells first if there are too many.
    const cells: { ix: number; iy: number; iz: number; size: number; dist: number }[] = [];
    grid.forEachCell((ix, iy, iz, bucket) => {
      const dist = ((ix + 0.5) * d - focus.x) ** 2 + ((iy + 0.5) * d - focus.y) ** 2 + ((iz + 0.5) * d - focus.z) ** 2;
      cells.push({ ix, iy, iz, size: bucket.length, dist });
    });
    if (cells.length > MAX_CELLS) cells.sort((a, b) => a.dist - b.dist).length = MAX_CELLS;
    for (const cell of cells) {
      if (cell.size > 1) this.cube(cell.ix, cell.iy, cell.iz, d, 1, 1.5, 0.25, 0.3);
      else this.cube(cell.ix, cell.iy, cell.iz, d, 1, 0.12, 0.62, 0.6);
    }
    this.cellsDrawn = cells.length;

    if (pair) {
      // A close approach: each object's cell, and the block of 27 that A's query searches.
      const cell = (p: Vec3) => [Math.floor(p.x / d), Math.floor(p.y / d), Math.floor(p.z / d)] as const;
      const [ax, ay, az] = cell(pair.a), [bx, by, bz] = cell(pair.b);
      const apart = Math.max(Math.abs(ax - bx), Math.abs(ay - by), Math.abs(az - bz)); // in cells
      this.pairState = apart === 0 ? 'same' : apart === 1 ? 'neighbours' : 'apart';
      const inside = pair.rangeKm < d;
      const pulse = 0.5 + 0.5 * Math.sin(seconds * 5);
      const glow = inside ? 0.05 + 0.05 * pulse : 0.035; // faint: the bloom pass brightens anything additive
      this.block(ax, ay, az, d);
      this.boldCube(ax, ay, az, d, inside ? HOT : CYAN);
      this.fill(0, ax, ay, az, d, inside ? HOT : CYAN, glow);
      if (apart > 0) {
        this.boldCube(bx, by, bz, d, inside ? HOT : AMBER);
        this.fill(1, bx, by, bz, d, inside ? HOT : AMBER, glow);
      }
    } else if (selected >= 0 && this.sim.getPosition(selected, p)) {
      // The selected object's own cell and the 27-cell neighbourhood a query visits.
      const cx = Math.floor(p.x / d), cy = Math.floor(p.y / d), cz = Math.floor(p.z / d);
      this.cube(cx, cy, cz, d, 1, ...CYAN);
      this.block(cx, cy, cz, d);
    }

    const geometry = this.lines.geometry;
    geometry.setDrawRange(0, this.cursor);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  }
}
