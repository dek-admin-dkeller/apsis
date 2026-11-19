/**
 * Filters: category toggles (with live counts), orbit-class toggles, altitude range.
 *
 * The result is one byte per object in `visible` (1 = shown). The satellite shader reads
 * it as a vertex attribute, so objects appear/disappear instantly with no geometry rebuild.
 *
 * Toggling a category or orbit class uses the catalogue's hash indexes
 * (Map<Category, Set<index>> / Map<OrbitClass, Set<index>>): only the members of the set
 * that was toggled are touched — not all ~20,000 objects.
 *
 * Whenever anything is hidden, a banner at the top of the globe says so: how many are shown,
 * what is hiding the rest, and a "Show all" that undoes every filter at once. (The owner went
 * into space with a type filter on, came back to an empty Earth and reloaded the page before
 * remembering it: the amber chip in the search field and "of 19,572" were too easy to miss.)
 */

import type { Catalog } from '../data/catalog.ts';
import { CATEGORIES, CATEGORY_COLORS, ORBIT_CLASSES, ORBIT_COLORS, type Category, type OrbitClass, type Satellite } from '../data/types.ts';
import type { FilterAbout } from './app.ts';
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
  private readonly extra = new Map<string, (sat: Satellite) => boolean>(); // tests added by feature modules
  private readonly about = new Map<string, FilterAbout>(); // their names in the banner, and how to undo them
  private readonly chips: { category: Map<Category, HTMLElement>; orbit: Map<OrbitClass, HTMLElement> } = { category: new Map(), orbit: new Map() };
  private readonly banner = $('filter-banner');
  private pulseTimer = 0;
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
      this.chips.category.set(category, chip);
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
      this.chips.orbit.set(orbit, chip);
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
    $('fb-clear').addEventListener('click', () => this.showAll());
  }

  /** Undo every filter: types, orbits, height, and whatever feature modules registered (a search type, a year). */
  showAll(): void {
    for (const [category, chip] of this.chips.category) {
      this.categoryOn.set(category, true);
      chip.classList.remove('is-off');
      chip.setAttribute('aria-pressed', 'true');
    }
    for (const [orbit, chip] of this.chips.orbit) {
      this.orbitOn.set(orbit, true);
      chip.classList.remove('is-off');
      chip.setAttribute('aria-pressed', 'true');
    }
    const min = $<HTMLInputElement>('alt-min'), max = $<HTMLInputElement>('alt-max');
    min.value = min.min;
    max.value = max.max;
    this.altMin = -Infinity;
    this.altMax = Infinity;
    this.refreshUnits();
    for (const about of [...this.about.values()]) about.clear(); // each module takes its own test away
    this.extra.clear();
    this.about.clear();
    this.reapply();
  }

  /** Draw attention to the banner (coming back to the Earth with something hidden). */
  nudge(): void {
    if (this.banner.classList.contains('is-hidden')) return;
    this.banner.classList.remove('is-pulse');
    void this.banner.offsetWidth; // restart the animation
    this.banner.classList.add('is-pulse');
    clearTimeout(this.pulseTimer);
    this.pulseTimer = window.setTimeout(() => this.banner.classList.remove('is-pulse'), 2600);
  }

  /** What is hiding objects just now, in a few words each. */
  private reasons(): string[] {
    const reasons = [...this.about.values()].map((about) => about.label);
    const offTypes = CATEGORIES.filter((category) => !this.categoryOn.get(category));
    if (offTypes.length) reasons.push(offTypes.length <= 2 ? `no ${offTypes.join(' or ').toLowerCase()}` : `${offTypes.length} types hidden`);
    const offOrbits = ORBIT_CLASSES.filter((orbit) => !this.orbitOn.get(orbit));
    if (offOrbits.length) reasons.push(offOrbits.length <= 2 ? `no ${offOrbits.join(' or ')}` : `only ${ORBIT_CLASSES.filter((orbit) => this.orbitOn.get(orbit)).join(', ') || 'no orbits'}`);
    if (Number.isFinite(this.altMin) || Number.isFinite(this.altMax)) reasons.push(`height ${$('alt-label').textContent}`);
    return reasons;
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
    if (!(this.orbitOn.get(sat.orbitClass)! && sat.meanAltKm >= this.altMin && sat.meanAltKm <= this.altMax)) return false;
    for (const keep of this.extra.values()) if (!keep(sat)) return false;
    return true;
  }

  /**
   * An extra test from a feature module (the growth-by-year slider, say): objects must pass
   * every registered test as well as the orbit and altitude filters. null removes a test.
   */
  setExtra(key: string, keep: ((sat: Satellite) => boolean) | null, about?: FilterAbout): void {
    if (keep) this.extra.set(key, keep);
    else this.extra.delete(key);
    if (keep && about) this.about.set(key, about);
    else this.about.delete(key);
    this.reapply();
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
    $('readout-objects').classList.toggle('is-all', shown === catalog.sats.length); // "of 19,572" only while something is hidden
    const hiding = shown < catalog.sats.length;
    this.banner.classList.toggle('is-hidden', !hiding);
    document.body.classList.toggle('is-filtered', hiding);
    if (hiding) {
      $('fb-count').textContent = `Showing ${fmtInt(shown)} of ${fmtInt(catalog.sats.length)}`;
      const why = this.reasons();
      $('fb-why').textContent = why.length ? why.join(' · ') : 'filtered';
    }
    this.onChange();
  }
}
