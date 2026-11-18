/**
 * Watchlist: objects the user has starred, remembered in the browser (localStorage) by
 * NORAD number. A Set gives the O(1) "is this one starred?" test the inspector needs.
 */

import type { Catalog } from '../data/catalog.ts';
import { CATEGORY_COLORS, type Satellite } from '../data/types.ts';
import type { SimClient } from '../worker/SimClient.ts';
import { $, fmtKm } from './dom.ts';

const STORAGE_KEY = 'apsis.watchlist';
const EARTH_RADIUS_KM = 6371;

export class Watchlist {
  private readonly ids = new Set<number>();
  private readonly list = $('watch-list');
  private readonly altitude = new Map<number, HTMLElement>(); // object index → its altitude cell
  private catalog: Catalog | null = null;
  private lastTick = -Infinity;
  private readonly sim: SimClient;
  private readonly onSelect: (sat: Satellite) => void;
  private readonly onChange: () => void;

  constructor(sim: SimClient, onSelect: (sat: Satellite) => void, onChange: () => void) {
    this.sim = sim;
    this.onSelect = onSelect;
    this.onChange = onChange;
    try {
      for (const id of JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as number[]) this.ids.add(id);
    } catch { /* nothing saved, or storage unavailable */ }
  }

  has(sat: Satellite): boolean {
    return this.ids.has(sat.noradId);
  }

  toggle(sat: Satellite): boolean {
    const on = !this.ids.has(sat.noradId);
    if (on) this.ids.add(sat.noradId);
    else this.ids.delete(sat.noradId);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.ids]));
    } catch { /* private mode: the list lasts for this visit only */ }
    this.render();
    this.onChange();
    return on;
  }

  /** Indices (in the current catalogue) of the starred objects. */
  indices(): number[] {
    const out: number[] = [];
    for (const id of this.ids) {
      const sat = this.catalog?.byNorad.get(id);
      if (sat) out.push(sat.index);
    }
    return out;
  }

  setCatalog(catalog: Catalog): void {
    this.catalog = catalog;
    this.render();
  }

  private render(): void {
    this.altitude.clear();
    const rows: HTMLElement[] = [];
    for (const id of this.ids) {
      const sat = this.catalog?.byNorad.get(id);
      if (!sat) continue;
      const li = document.createElement('li');
      const pick = document.createElement('button');
      pick.className = 'watch-pick';
      const dot = document.createElement('i');
      dot.className = 'dot';
      dot.style.color = CATEGORY_COLORS[sat.category];
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = sat.name;
      const alt = document.createElement('span');
      alt.className = 'alt';
      pick.append(dot, name, alt);
      pick.addEventListener('click', () => this.onSelect(sat));
      const remove = document.createElement('button');
      remove.className = 'watch-remove';
      remove.textContent = '×';
      remove.title = 'Remove from the watchlist';
      remove.setAttribute('aria-label', `Remove ${sat.name} from the watchlist`);
      remove.addEventListener('click', () => this.toggle(sat));
      li.append(pick, remove);
      rows.push(li);
      this.altitude.set(sat.index, alt);
    }
    this.list.replaceChildren(...rows);
    $('watch-empty').classList.toggle('is-hidden', rows.length > 0);
    $('contacts-open').classList.toggle('is-hidden', rows.length === 0); // the timeline is about starred objects: nothing to show without one
    this.lastTick = -Infinity;
  }

  /** Refresh the live altitudes once a second. */
  frame(realSeconds: number): void {
    if (realSeconds - this.lastTick < 1 || this.altitude.size === 0) return;
    this.lastTick = realSeconds;
    const p = { x: 0, y: 0, z: 0 };
    for (const [index, cell] of this.altitude) {
      cell.textContent = this.sim.getPosition(index, p) ? fmtKm(Math.hypot(p.x, p.y, p.z) - EARTH_RADIUS_KM) : '';
    }
  }
}
