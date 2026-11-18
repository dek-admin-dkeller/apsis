/**
 * The home page's live drawing of the search.
 *
 * A hundred or so dots drift about in a box. In one mode a line is drawn for every pair that
 * would have to be measured the obvious way — every dot against every other — and the box
 * turns into a web. In the other mode the grid is drawn, and lines join only the dots that
 * the hash table actually offers up as neighbours. The close pairs (the bright ones) are the
 * same in both; the count of measurements is not.
 *
 * It is the real thing in two dimensions: the dots are filed in the project's own
 * SpatialHash (src/hashing/SpatialHash.ts) every frame, with z = 0, and the neighbour query
 * is the same one the tracker runs on 19,500 objects in three.
 */

import { SpatialHash } from '../hashing/SpatialHash.ts';
import { fmtInt } from './dom.ts';

const COLS = 40, ROWS = 22; // the box, measured in cells (one cell = the alert distance)
const DOTS = 110; // 5,995 pairs the obvious way
const DRIFT = 0.42; // cells per second
const INK = '232, 241, 251', CYAN = '127, 227, 255', AMBER = '255, 180, 84';

export type DemoMode = 'all' | 'grid';

export interface DemoReadouts {
  objects: HTMLElement;
  checks: HTMLElement;
  pairs: HTMLElement;
  /** The two mode buttons (each has data-mode). */
  mode: HTMLElement;
}

export class HashDemo {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly x = new Float32Array(DOTS);
  private readonly y = new Float32Array(DOTS);
  private readonly vx = new Float32Array(DOTS);
  private readonly vy = new Float32Array(DOTS);
  private readonly scratch: number[] = [];
  private mode: DemoMode = 'grid';
  private chosen = false; // the visitor picked a mode: stop switching by ourselves
  private running = false;
  private inView = false;
  private allowed = true; // the page it lives on is showing
  private last = 0;
  private sinceSwitch = 0;
  private sinceText = 1;
  private readonly still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly canvas: HTMLCanvasElement;
  private readonly readouts: DemoReadouts;

  constructor(canvas: HTMLCanvasElement, readouts: DemoReadouts) {
    this.canvas = canvas;
    this.readouts = readouts;
    this.ctx = canvas.getContext('2d')!;
    // A fixed seed, so the drawing starts the same way every time (and the first frame is a good one).
    let seed = 20251116;
    const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < DOTS; i++) {
      this.x[i] = random() * COLS;
      this.y[i] = random() * ROWS;
      const heading = random() * Math.PI * 2;
      this.vx[i] = Math.cos(heading) * DRIFT * (0.5 + random());
      this.vy[i] = Math.sin(heading) * DRIFT * (0.5 + random());
    }
    readouts.objects.textContent = fmtInt(DOTS);
    for (const button of readouts.mode.querySelectorAll<HTMLElement>('[data-mode]')) {
      button.addEventListener('click', () => {
        this.chosen = true;
        this.setMode(button.dataset.mode as DemoMode);
      });
    }
    new ResizeObserver(() => this.fit()).observe(canvas);
    // Only animate while it can be seen.
    new IntersectionObserver((entries) => {
      this.inView = entries[0].isIntersecting;
      this.sync();
    }, { threshold: 0.15 }).observe(canvas);
    this.fit();
  }

  /** The page this drawing sits on is showing (true) or put away (false). */
  setAllowed(on: boolean): void {
    this.allowed = on;
    this.sync();
  }

  private setMode(mode: DemoMode): void {
    this.mode = mode;
    this.sinceSwitch = 0;
    this.sinceText = 1;
    for (const button of this.readouts.mode.querySelectorAll<HTMLElement>('[data-mode]')) button.classList.toggle('is-on', button.dataset.mode === mode);
    if (!this.running) this.draw(0);
  }

  private fit(): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(this.canvas.clientWidth * ratio), height = Math.round(this.canvas.clientHeight * ratio);
    if (width === 0 || (this.canvas.width === width && this.canvas.height === height)) return;
    this.canvas.width = width;
    this.canvas.height = height;
    if (!this.running) this.draw(0);
  }

  private sync(): void {
    const should = this.inView && this.allowed;
    if (should === this.running) return;
    this.running = should;
    if (should) {
      this.last = performance.now();
      requestAnimationFrame(this.frame);
    }
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    // Left alone, it shows one method and then the other, so the difference is seen without a click.
    this.sinceSwitch += dt;
    if (!this.chosen && !this.still && this.sinceSwitch > 5) this.setMode(this.mode === 'grid' ? 'all' : 'grid');
    this.draw(this.still ? 0 : dt);
    requestAnimationFrame(this.frame);
  };

  private draw(dt: number): void {
    const { ctx, x, y, vx, vy } = this;
    const width = this.canvas.width, height = this.canvas.height;
    if (width === 0) return;
    const cell = width / COLS; // pixels per cell (the canvas is laid out 40 : 22)
    const px = (v: number) => v * cell;

    // Move the dots; they bounce off the walls.
    for (let i = 0; i < DOTS; i++) {
      x[i] += vx[i] * dt;
      y[i] += vy[i] * dt;
      if (x[i] < 0 || x[i] > COLS) { vx[i] = -vx[i]; x[i] = Math.min(COLS, Math.max(0, x[i])); }
      if (y[i] < 0 || y[i] > ROWS) { vy[i] = -vy[i]; y[i] = Math.min(ROWS, Math.max(0, y[i])); }
    }

    // File every dot in the hash table: cell size 1 = the alert distance, exactly as in the tracker.
    const grid = new SpatialHash(1);
    for (let i = 0; i < DOTS; i++) grid.insert(i, x[i], y[i], 0);

    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = Math.max(1, cell / 22);
    let checks = 0;
    const close: number[] = []; // pairs within the alert distance, as i, j, i, j …

    if (this.mode === 'all') {
      // The obvious way: every dot against every other.
      ctx.beginPath();
      for (let i = 0; i < DOTS; i++) {
        for (let j = i + 1; j < DOTS; j++) {
          checks++;
          ctx.moveTo(px(x[i]), px(y[i]));
          ctx.lineTo(px(x[j]), px(y[j]));
          if ((x[i] - x[j]) ** 2 + (y[i] - y[j]) ** 2 < 1) close.push(i, j);
        }
      }
      ctx.strokeStyle = `rgba(${INK}, 0.085)`;
      ctx.stroke();
    } else {
      // The grid, the squares that hold something, and only the pairs the table offers.
      ctx.beginPath();
      for (let c = 0; c <= COLS; c++) { ctx.moveTo(px(c), 0); ctx.lineTo(px(c), height); }
      for (let r = 0; r <= ROWS; r++) { ctx.moveTo(0, px(r)); ctx.lineTo(width, px(r)); }
      ctx.strokeStyle = `rgba(${INK}, 0.07)`;
      ctx.stroke();
      ctx.fillStyle = `rgba(${CYAN}, 0.07)`;
      for (let i = 0; i < DOTS; i++) ctx.fillRect(px(Math.floor(x[i])), px(Math.floor(y[i])), cell, cell);
      ctx.beginPath();
      for (let i = 0; i < DOTS; i++) {
        const near = grid.queryNeighbors(x[i], y[i], 0, this.scratch);
        for (let k = 0; k < near.length; k++) {
          const j = near[k];
          if (j <= i) continue; // each pair once
          checks++;
          ctx.moveTo(px(x[i]), px(y[i]));
          ctx.lineTo(px(x[j]), px(y[j]));
          if ((x[i] - x[j]) ** 2 + (y[i] - y[j]) ** 2 < 1) close.push(i, j);
        }
      }
      ctx.strokeStyle = `rgba(${CYAN}, 0.3)`;
      ctx.stroke();
    }

    // What both methods find: the pairs inside the alert distance.
    ctx.beginPath();
    for (let k = 0; k < close.length; k += 2) {
      ctx.moveTo(px(x[close[k]]), px(y[close[k]]));
      ctx.lineTo(px(x[close[k + 1]]), px(y[close[k + 1]]));
    }
    ctx.lineWidth = Math.max(1.5, cell / 9);
    ctx.strokeStyle = `rgba(${AMBER}, 0.95)`;
    ctx.stroke();

    const flagged = new Set(close); // a hash set: is this dot part of a close pair?
    for (let i = 0; i < DOTS; i++) {
      ctx.beginPath();
      ctx.arc(px(x[i]), px(y[i]), Math.max(1.5, cell / (flagged.has(i) ? 6.5 : 9)), 0, Math.PI * 2);
      ctx.fillStyle = flagged.has(i) ? `rgb(${AMBER})` : `rgba(${INK}, 0.9)`;
      ctx.fill();
    }

    // The numbers change every frame; shown a few times a second they can be read.
    this.sinceText += dt || 1;
    if (this.sinceText > 0.25) {
      this.sinceText = 0;
      this.readouts.checks.textContent = fmtInt(checks);
      this.readouts.pairs.textContent = fmtInt(close.length / 2);
    }
  }
}
