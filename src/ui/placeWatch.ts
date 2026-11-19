/**
 * Close approaches at another world: the same screening as round the Earth, on far fewer objects.
 *
 * Round the Earth the monitor sorts 19,000 objects into the cells of a 3D hash grid once a
 * second (hashing/SpatialHash.ts, hashing/conjunction.ts). Round Mars there are five. The
 * method is the same and so is the code: this module puts the craft that are aloft at a place
 * into the SAME `hashedPairs`, with a cell as wide as the alert distance, and lists the pairs
 * it returns. With so few objects it finds something only now and then — which is the true
 * state of things out there — so it also looks ahead:
 *
 *   now       every second: hash the positions, list the pairs inside the alert distance, and
 *             hand the occupied cells to the view to draw (red where a pair is inside).
 *   24 hours  on request: every 30 s of the coming day, hash with cells of the alert distance
 *             plus the furthest two craft can close in one step, then narrow each candidate
 *             pair's closest moment by repeated halving. The same idea as hashing/lookahead.ts,
 *             without the worker: a few thousand positions, not a hundred million.
 *
 * Distances here are true, between the craft's real paths from NASA's data (src/space/deep.ts).
 *
 * The same monitor runs on the SOLAR SYSTEM, for the craft out between the planets (round the
 * Sun): there the cells are ten thousand times wider (1 million to 100 million km, `SCALE`),
 * because nothing out there comes within a thousand kilometres of anything else, and the view
 * bends each cell by the map's own squeeze of distance (SpaceView.setCells).
 *
 * With a craft selected and the cells shown, its own cell is lit amber and the block of 27
 * cells the search looks through (its cell and the 26 around it) is outlined, as round the
 * Earth (render/gridViz.ts), and the panel says what shares that block with it.
 */

import { hashedPairs } from '../hashing/conjunction.ts';
import type { SpaceView } from '../render/space/spaceView.ts';
import { craftPosition } from '../space/deep.ts';
import type { Craft, Vec } from '../space/types.ts';
import { $, fmt, fmtInt, fmtKm, lengthUnit, lengthValue } from './dom.ts';
import { clockStamp, duration } from './inspector.ts';

const STEP_MS = 30000;
const DAY_MS = 86400000;
/** The most two craft can close on each other, km/s (twice the fastest orbital speed worth planning for). */
const CLOSING_KM_S = 12;
/** Cells on the solar system are this many times wider than at a world (the same three buttons). */
const SCALE = { place: 1, map: 10000 } as const;
type Mode = keyof typeof SCALE;

interface Pass {
  a: Craft;
  b: Craft;
  timeMs: number;
  km: number;
}

export class PlaceWatch {
  private view: SpaceView;
  private mode: Mode = 'place';
  private readonly time: () => number;
  private readonly choose: (craft: Craft, timeMs: number | null) => void;
  private readonly panel = $('panel-watch');
  private crafts: Craft[] = [];
  private alertSetting = 1000; // the button chosen (place scale); alertKm is it in the current mode
  private grid = false;
  private lastScreen = -1;
  private scanFor = ''; // what the 24-hour list was worked out for, so it is redone only when that changes

  /** @param choose  go and look at a craft (and, with a time, move the clock to just before it) */
  constructor(view: SpaceView, time: () => number, choose: (craft: Craft, timeMs: number | null) => void) {
    this.view = view;
    this.time = time;
    this.choose = choose;
    const choices = $('watch-km');
    for (const button of choices.querySelectorAll<HTMLButtonElement>('button')) {
      button.addEventListener('click', () => {
        this.alertSetting = Number(button.dataset.value);
        for (const other of choices.querySelectorAll('button')) other.classList.toggle('is-on', other === button);
        this.lastScreen = -1;
        this.scan();
      });
    }
    this.refreshUnits();
  }

  private get alertKm(): number {
    return this.alertSetting * SCALE[this.mode];
  }

  /** The alert distances are written in the chosen unit. */
  refreshUnits(): void {
    for (const button of $('watch-km').querySelectorAll<HTMLButtonElement>('button')) button.textContent = compactKm(Number(button.dataset.value) * SCALE[this.mode]);
    this.lastScreen = -1;
    this.scanFor = '';
    if (this.isOpen) this.scan();
  }

  get isOpen(): boolean {
    return !this.panel.classList.contains('is-hidden');
  }

  /**
   * What to watch: the craft in flight at the place being visited (nothing standing on the
   * ground), or on the solar system the craft round the Sun; and the view that draws its cells.
   */
  setCraft(crafts: Craft[], view: SpaceView = this.view, mode: Mode = 'place'): void {
    if (view !== this.view) this.view.setCells(null);
    this.view = view;
    if (mode !== this.mode) {
      this.mode = mode;
      this.refreshUnits();
    }
    this.crafts = crafts.filter((craft) => craft.motion.type !== 'surface');
    this.lastScreen = -1;
    this.scanFor = '';
    $('watch-where').textContent = mode === 'map'
      ? 'Spacecraft between the planets, screened with the same hash grid as the Earth’s 19,000 objects; out here the cells are millions of kilometres wide.'
      : 'Spacecraft in flight here, screened with the same hash grid as the Earth’s 19,000 objects.';
    if (this.isOpen) this.scan();
  }

  toggle(open: boolean): void {
    this.panel.classList.toggle('is-hidden', !open);
    this.lastScreen = -1;
    if (open) this.scan();
  }

  /** Draw the occupied cells of the grid (the Layers switch "Screening cells"). */
  setGrid(on: boolean): void {
    this.grid = on;
    this.lastScreen = -1;
    if (!on) this.view.setCells(null);
    $('watch-focus').textContent = '';
  }

  /** Call every frame at a place: screens once a second while there is someone to show it to. */
  frame(realSeconds: number): void {
    if ((!this.isOpen && !this.grid) || realSeconds - this.lastScreen < 1) return;
    this.lastScreen = realSeconds;
    const t = this.time();
    const crafts = this.aloft(t);
    const n = crafts.length;
    const positions = new Float64Array(n * 3);
    const p: Vec = [0, 0, 0];
    crafts.forEach((craft, i) => positions.set(craftPosition(craft, t, p).pos, i * 3));
    const result = hashedPairs(positions, n, this.alertKm);

    if (this.grid) {
      // Every cell that holds something; red where one of its craft is in a pair inside the alert distance.
      const inPair = new Set<number>();
      for (const pair of result.pairs) inPair.add(pair.a).add(pair.b);
      const cells: number[] = [];
      // (forEachCell hands back cell coordinates with SpatialHash's 2^16 offset already taken
      // off. It used to be taken off again here, which put every cell 65 million km away.)
      const centre = (i: number) => (i + 0.5) * this.alertKm;
      result.grid.forEachCell((ix, iy, iz, bucket) => {
        cells.push(centre(ix), centre(iy), centre(iz), bucket.some((id) => inPair.has(id)) ? CELL.hot : CELL.plain);
      });
      // The craft being looked at: its own cell, and the 27-cell block the search looks through.
      const focus = this.view.focus?.kind === 'craft' ? crafts.indexOf(this.view.focus.craft) : -1;
      const note = $('watch-focus');
      if (focus >= 0) {
        const cell = [0, 1, 2].map((k) => Math.floor(positions[focus * 3 + k] / this.alertKm));
        cells.push(...cell.map(centre), CELL.own);
        cells.push(...cell.map(centre), CELL.block);
        const near = crafts.filter((_, j) => j !== focus && [0, 1, 2].every((k) => Math.abs(Math.floor(positions[j * 3 + k] / this.alertKm) - cell[k]) <= 1));
        const name = crafts[focus].short;
        note.textContent = near.length === 0
          ? `${name}: nothing else in its block of 27 cells, so the search does not even measure a distance from it.`
          : `${name} shares its block of 27 cells with ${near.map((craft) => craft.short).join(', ')}: only ${near.length === 1 ? 'that distance is' : 'those distances are'} measured.`;
      } else {
        note.textContent = 'Select a craft to see its cell and the 27 cells searched round it.';
      }
      this.view.setCells(new Float64Array(cells), this.alertKm);
    }
    if (!this.isOpen) return;

    // The closest pair of all, inside the alert distance or not (five craft: every pair can be looked at).
    let closest: { a: Craft; b: Craft; km: number } | null = null;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const km = Math.hypot(positions[i * 3] - positions[j * 3], positions[i * 3 + 1] - positions[j * 3 + 1], positions[i * 3 + 2] - positions[j * 3 + 2]);
        if (!closest || km < closest.km) closest = { a: crafts[i], b: crafts[j], km };
      }
    }
    $('watch-count').textContent = fmtInt(n);
    $('watch-cells').textContent = fmtInt(result.stats.occupiedCells);
    $('watch-closest').textContent = closest ? fmtKm(closest.km) : '–';
    $('watch-closest').title = closest ? `${closest.a.short} and ${closest.b.short}` : '';
    const list = $('watch-now');
    list.replaceChildren();
    for (const pair of result.pairs) list.append(this.row(crafts[pair.a], crafts[pair.b], fmtKm(pair.dist), null));
    $('watch-now-note').textContent = n < 2 ? 'Fewer than two craft are in flight here.'
      : result.pairs.length === 0 ? `Nothing here is within ${fmtKm(this.alertKm)} of anything else right now${closest ? `. The nearest two are ${closest.a.short} and ${closest.b.short}.` : '.'}` : '';
  }

  /** The craft that have a position at `t` (an asteroid only during the days its path is known). */
  private aloft(t: number): Craft[] {
    const p: Vec = [0, 0, 0];
    return this.crafts.filter((craft) => !(craft.passing && craftPosition(craft, t, p).held));
  }

  private row(a: Craft, b: Craft, figure: string, timeMs: number | null): HTMLElement {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    const names = document.createElement('b');
    names.textContent = `${a.short} · ${b.short}`;
    const value = document.createElement('span');
    value.textContent = figure;
    button.append(names, value);
    button.title = timeMs === null ? `Look at ${a.short}` : `Go to ${clockStamp(timeMs)}, just before ${a.short} and ${b.short} are closest`;
    button.addEventListener('click', () => this.choose(a, timeMs));
    item.append(button);
    return item;
  }

  /** The coming 24 hours (see the header). Worked out in one go: a few thousand positions. */
  private scan(): void {
    const start = this.time();
    const crafts = this.aloft(start);
    const key = `${crafts.map((craft) => craft.id).join(',')}|${this.alertKm}|${Math.round(start / 600000)}`;
    if (key === this.scanFor) return;
    this.scanFor = key;
    const n = crafts.length;
    const list = $('watch-ahead'), note = $('watch-ahead-note');
    list.replaceChildren();
    if (n < 2) {
      note.textContent = '';
      return;
    }
    const p: Vec = [0, 0, 0], q: Vec = [0, 0, 0];
    const gap = (i: number, j: number, t: number): number => {
      craftPosition(crafts[i], t, p);
      craftPosition(crafts[j], t, q);
      return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    };
    // Coarse pass: candidates are pairs that share or neighbour a cell wide enough that no
    // pair can slip from outside it to inside the alert distance between two steps.
    const reach = this.alertKm + CLOSING_KM_S * (STEP_MS / 1000);
    const best = new Map<number, Pass>(); // pair (i * n + j) → its closest moment so far
    const positions = new Float64Array(n * 3);
    for (let t = start; t <= start + DAY_MS; t += STEP_MS) {
      crafts.forEach((craft, i) => positions.set(craftPosition(craft, t, p).pos, i * 3));
      for (const pair of hashedPairs(positions, n, reach).pairs) {
        // Narrow the closest moment within a step either side of this one, by thirds.
        let lo = t - STEP_MS, hi = t + STEP_MS;
        for (let k = 0; k < 26; k++) {
          const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
          if (gap(pair.a, pair.b, m1) < gap(pair.a, pair.b, m2)) hi = m2;
          else lo = m1;
        }
        const when = Math.max(start, (lo + hi) / 2);
        const km = gap(pair.a, pair.b, when);
        const id = pair.a * n + pair.b;
        const known = best.get(id);
        if (km < this.alertKm && (!known || km < known.km)) best.set(id, { a: crafts[pair.a], b: crafts[pair.b], timeMs: when, km });
      }
    }
    const passes = [...best.values()].sort((x, y) => x.timeMs - y.timeMs);
    for (const pass of passes) list.append(this.row(pass.a, pass.b, `${fmtKm(pass.km)} · in ${duration(pass.timeMs - start)}`, pass.timeMs));
    note.textContent = passes.length === 0 ? `No two craft here come within ${fmtKm(this.alertKm)} of each other in the next 24 hours.` : '';
  }
}

/** What each cell handed to SpaceView.setCells is (the fourth number of each). */
export const CELL = { plain: 0, hot: 1, own: 2, block: 3 } as const;

/** A distance in few characters, in the chosen unit: "100 km", "1 million km", "6.2 million mi". */
function compactKm(km: number): string {
  const value = lengthValue(km);
  return value >= 1e6 ? `${fmt(value / 1e6, value < 1e7 && value % 1e6 !== 0 ? 1 : 0)} million ${lengthUnit()}` : fmtKm(km);
}
