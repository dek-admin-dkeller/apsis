/**
 * Filters: category toggles (with live counts), orbit-class toggles, altitude range.
 *
 * The result is one byte per object in `visible` (1 = shown). The satellite shader reads
 * it as a vertex attribute, so objects appear/disappear instantly with no geometry rebuild.
 *
 * Toggling a category or orbit class uses the catalogue's hash indexes
 * (Map<Category, Set<index>> / Map<OrbitClass, Set<index>>): only the members of the set
 * that was toggled are touched — not all ~20,000 objects.
 */

import type { Catalog } from '../data/catalog.ts';
import { CATEGORIES, CATEGORY_COLORS, ORBIT_CLASSES, ORBIT_COLORS, type Category, type OrbitClass, type Satellite } from '../data/types.ts';
import { $, fmtInt, fmtKm, lengthUnit, lengthValue } from './dom.ts';

const SLIDER_MAX = 1000;
/** Slider position → altitude in km on a log scale (100 km … ~50,000 km); the ends mean "no limit". */
function sliderToKm(v: number): number {
  if (v <= 0) return -Infinity;
  if (v >= SLIDER_MAX) return Infinity;
  const km = 100 * Math.pow(10, (v / SLIDER_MAX) * 2.7);
  const step = km < 1000 ? 10 : km < 10000 ? 100 : 1000;
  return Math.round(km / step) * step;
}

export class Filters {
  private catalog: Catalog | null = null;
  private visible: Uint8Array = new Uint8Array(0);
  private readonly categoryOn = new Map<Category, boolean>(CATEGORIES.map((c) => [c, true]));
  private readonly orbitOn = new Map<OrbitClass, boolean>(ORBIT_CLASSES.map((o) => [o, true]));
  private altMin = -Infinity;
  private altMax = Infinity;
  private readonly counts = new Map<Category, HTMLElement>();
  private readonly onChange: () => void;

  constructor(onChange: () => void) {
    this.onChange = onChange;

    const categoryBox = $('category-chips');
    for (const category of CATEGORIES) {
      const chip = this.chip(category, CATEGORY_COLORS[category]);
      this.counts.set(category, chip.querySelector('.count') as HTMLElement);
      chip.addEventListener('click', () => {
        const on = !this.categoryOn.get(category);
        this.categoryOn.set(category, on);
        chip.classList.toggle('is-off', !on);
        chip.setAttribute('aria-pressed', String(on));
        this.reapply(this.catalog?.byCategory.get(category)); // only this category's Set
      });
      categoryBox.append(chip);
    }

    const orbitBox = $('orbit-chips');
    for (const orbit of ORBIT_CLASSES) {
      const chip = this.chip(orbit, ORBIT_COLORS[orbit], false);
      chip.addEventListener('click', () => {
        const on = !this.orbitOn.get(orbit);
        this.orbitOn.set(orbit, on);
        chip.classList.toggle('is-off', !on);
        chip.setAttribute('aria-pressed', String(on));
        this.reapply(this.catalog?.byOrbit.get(orbit)); // only this orbit class's Set
      });
      orbitBox.append(chip);
    }

    const min = $<HTMLInputElement>('alt-min');
    const max = $<HTMLInputElement>('alt-max');
    const onRange = (moved: HTMLInputElement) => {
      // keep the two thumbs from crossing
      if (Number(min.value) > Number(max.value) - 20) {
        if (moved === min) min.value = String(Number(max.value) - 20);
        else max.value = String(Number(min.value) + 20);
      }
      this.altMin = sliderToKm(Number(min.value));
      this.altMax = sliderToKm(Number(max.value));
      this.refreshUnits();
      this.reapply(); // altitude has no index → check every object
    };
    min.addEventListener('input', () => onRange(min));
    max.addEventListener('input', () => onRange(max));
  }

  /**
   * Write the altitude band's label. The band itself is kept in km (that is what the objects
   * are compared with); the label is only written when a thumb moves, so call this as well
   * when the units setting changes.
   */
  refreshUnits(): void {
    const lo = Number.isFinite(this.altMin), hi = Number.isFinite(this.altMax);
    $('alt-label').textContent = lo && hi ? `${fmtInt(lengthValue(this.altMin))} – ${fmtInt(lengthValue(this.altMax))} ${lengthUnit()}`
      : lo ? `above ${fmtKm(this.altMin)}` : hi ? `below ${fmtKm(this.altMax)}` : 'any';
  }

  private chip(label: string, color: string, withCount = true): HTMLButtonElement {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.setAttribute('aria-pressed', 'true');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.color = color;
    chip.append(dot);
    const text = document.createElement('span');
    text.className = 'label';
    text.textContent = label;
    chip.append(text);
    if (withCount) {
      const count = document.createElement('span');
      count.className = 'count';
      chip.append(count);
    }
    return chip;
  }

  /** Point the filters at a (new) catalogue and its visibility array. */
  setCatalog(catalog: Catalog, visible: Uint8Array): void {
    this.catalog = catalog;
    this.visible = visible;
    this.reapply();
  }

  private passesOrbitAndAltitude(sat: Satellite): boolean {
    return this.orbitOn.get(sat.orbitClass)! && sat.meanAltKm >= this.altMin && sat.meanAltKm <= this.altMax;
  }

  /** Recompute visibility for the given object indices (default: all), then refresh the counts. */
  private reapply(indices?: Iterable<number>): void {
    const catalog = this.catalog;
    if (!catalog) return;
    const update = (index: number) => {
      const sat = catalog.sats[index];
      this.visible[index] = this.categoryOn.get(sat.category)! && this.passesOrbitAndAltitude(sat) ? 1 : 0;
    };
    if (indices) for (const index of indices) update(index);
    else for (let index = 0; index < catalog.sats.length; index++) update(index);

    // Live counts: how many objects of each category match the orbit + altitude filters.
    let shown = 0;
    for (const [category, members] of catalog.byCategory) {
      let count = 0;
      for (const index of members) if (this.passesOrbitAndAltitude(catalog.sats[index])) count++;
      this.counts.get(category)!.textContent = fmtInt(count);
      if (this.categoryOn.get(category)) shown += count;
    }
    $('visible-count').textContent = fmtInt(shown);
    this.onChange();
  }
}
