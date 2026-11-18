/**
 * Main-thread side of the simulation worker.
 *
 * SGP4 for ~20,000 objects is too slow to run every frame, so the worker only produces a
 * position snapshot about 3 times per second. We always hold two snapshots, A (time tA)
 * and B (time tB), and every frame the satellites are drawn at an interpolated position
 * between them — `alpha` says how far from A to B the clock currently is.
 */

import type { OmmRecord } from '../data/types.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

const STEP_SECONDS = 0.3; // real time between two worker snapshots (~3 Hz)

export class SimClient {
  readonly worker: Worker;
  count = 0;
  posA = new Float32Array(0); // snapshot A: packed x, y, z in km (ECI frame)
  posB = new Float32Array(0); // snapshot B
  tA = 0;
  tB = 0;
  alpha = 0; // 0 → at A, 1 → at B
  hasData = false;
  /** Called after A/B changed so the renderer can re-upload its buffers. */
  onSnapshot: () => void = () => {};
  /** Every non-position message (screening results, benchmark rows…). */
  onMessage: (msg: FromWorker) => void = () => {};

  private pending: { t: number; positions: Float32Array } | null = null;
  private inFlight = false;
  private epoch = 0; // bumped on every time jump so late replies from before it are ignored
  private fresh = true; // true until the first snapshot after a reset arrives

  constructor() {
    this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const msg = event.data;
      if (msg.type === 'positions') {
        if (msg.epoch !== this.epoch) return;
        this.inFlight = false;
        this.pending = { t: msg.t, positions: msg.positions };
      } else {
        this.onMessage(msg);
      }
    };
  }

  send(msg: ToWorker): void {
    this.worker.postMessage(msg);
  }

  /** Load a (new) catalogue into the worker. */
  init(records: OmmRecord[]): void {
    this.count = records.length;
    this.posA = new Float32Array(this.count * 3);
    this.posB = new Float32Array(this.count * 3);
    this.hasData = false;
    this.send({ type: 'init', records });
    this.reset();
  }

  /** Call after the clock jumps (e.g. the "Now" button): throw away buffered snapshots. */
  reset(): void {
    this.epoch++;
    this.pending = null;
    this.inFlight = false;
    this.fresh = true;
  }

  /** Call once per frame. `speed` = simulated seconds per real second (0 when paused). */
  update(simTime: number, speed: number): void {
    // Move on to the next snapshot once the clock has reached B.
    const backwards = speed < 0;
    const reachedB = backwards ? simTime <= this.tB : simTime >= this.tB;
    if (this.pending && (this.fresh || reachedB)) {
      if (this.fresh) {
        this.posA.set(this.pending.positions);
        this.tA = this.pending.t;
      } else {
        this.posA.set(this.posB);
        this.tA = this.tB;
      }
      this.posB.set(this.pending.positions);
      this.tB = this.pending.t;
      this.pending = null;
      this.fresh = false;
      this.hasData = true;
      this.onSnapshot();
    }

    // Ask the worker for the snapshot one step ahead of where we are.
    if (!this.inFlight && !this.pending && this.count > 0) {
      const lead = backwards ? Math.min(this.tB, simTime) : Math.max(this.tB, simTime);
      const next = this.fresh ? simTime : lead + speed * 1000 * STEP_SECONDS;
      if (this.fresh || next !== this.tB) {
        this.inFlight = true;
        this.send({ type: 'propagate', t: next, epoch: this.epoch });
      }
    }

    const span = this.tB - this.tA;
    this.alpha = span !== 0 ? Math.min(2, Math.max(-1, (simTime - this.tA) / span)) : 0; // span < 0 when time runs backwards
  }

  /**
   * Interpolated position of object i (km, ECI) — the same maths the vertex shader runs.
   * A straight line between A and B would cut the corner of the curved orbit, so the
   * direction is interpolated linearly and the radius separately.
   * Returns false if the object has no valid position.
   */
  getPosition(i: number, out: { x: number; y: number; z: number }): boolean {
    const a = this.posA, b = this.posB, t = this.alpha;
    const ax = a[3 * i], ay = a[3 * i + 1], az = a[3 * i + 2];
    const bx = b[3 * i], by = b[3 * i + 1], bz = b[3 * i + 2];
    const ra = Math.sqrt(ax * ax + ay * ay + az * az);
    const rb = Math.sqrt(bx * bx + by * by + bz * bz);
    if (ra < 1 || rb < 1) return false;
    const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
    const scale = (ra + (rb - ra) * t) / Math.sqrt(x * x + y * y + z * z);
    out.x = x * scale;
    out.y = y * scale;
    out.z = z * scale;
    return true;
  }
}
