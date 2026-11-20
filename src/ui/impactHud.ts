/**
 * The readout over the picture while a collision is watched (the designer's collision course).
 *
 * The owner's brief: more detail, without taking away from how far apart the two really are.
 * At true scale the impactor is a dot for nearly the whole minute (it closes 650 km in a minute
 * and its last kilometre in a tenth of a second), so the picture alone cannot tell the story.
 * This says it in numbers and one drawing:
 *
 *   - the countdown to impact;
 *   - the gap on a LOGARITHMIC track, 1,000 km → 100 km → 10 km → 1 km → 100 m → contact, a marker
 *     sliding along it: every step on the track is the gap shrinking ten times, so the last few
 *     seconds visibly cover as much of it as the first fifty;
 *   - the closing speed, and what it means in seconds per kilometre;
 *   - the energy and whether the break-up model calls it catastrophic; after the moment, the
 *     fragments: how many are drawn and how many the model predicts.
 *
 * Main (updateFinale) shows it while the close-approach view is on the designer's pair and for a
 * little while after the impact. No DOM in index.html: it makes its own element.
 */

import type { Breakup } from '../data/orbitLab.ts';
import { fmt, fmtInt, fmtKmS, fmtRange, lengthUnit, lengthValue } from './dom.ts';

/** The ends of the track: 1,000 km down to 10 m (log10 of km: 3 … −2). */
const TOP = 3, BOTTOM = -2;
const TICKS = [3, 2, 1, 0, -1, -2];
/** A tick's label in the visitor's units ("1,000 km" / "621 mi", "100 m" / "328 ft"); the last is contact. */
const tickLabel = (log: number): string => (log === BOTTOM ? 'contact' : log >= 0 ? `${fmtInt(lengthValue(10 ** log))} ${lengthUnit()}` : fmtRange(10 ** log));

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

export interface ImpactState {
  names: [string, string]; // impactor, target
  /** Seconds to the moment (negative after it). */
  toImpactS: number;
  rangeKm: number;
  figures: Breakup;
  /** Clock speed (< 1: slow motion). */
  speed: number;
  /** Fragments drawn in the catalogue after the moment. */
  drawn: number;
}

export class ImpactHud {
  private readonly root = el('div', 'impact-hud is-hidden');
  private readonly title = el('div', 'ih-title');
  private readonly count = el('div', 'ih-count');
  private readonly slow = el('span', 'ih-slow', 'slow motion');
  private readonly marker = el('i', 'ih-marker');
  private readonly fill = el('i', 'ih-fill');
  private readonly gap = el('div', 'ih-gap');
  private readonly facts = el('div', 'ih-facts');
  private shown = false;

  constructor() {
    this.root.setAttribute('aria-live', 'off');
    const track = el('div', 'ih-track');
    track.append(this.fill, this.marker);
    for (const log of TICKS) {
      const tick = el('span', 'ih-tick', tickLabel(log));
      tick.style.left = `${((TOP - log) / (TOP - BOTTOM)) * 100}%`;
      track.append(tick);
    }
    const head = el('div', 'ih-head');
    head.append(this.count, this.slow);
    this.root.append(this.title, head, track, this.gap, this.facts);
    document.body.append(this.root);
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.root.classList.add('is-hidden');
  }

  show(state: ImpactState): void {
    if (!this.shown) {
      this.shown = true;
      this.root.classList.remove('is-hidden');
    }
    const after = state.toImpactS >= 0 ? false : true;
    this.title.textContent = `${state.names[0]} → ${state.names[1]}`;
    this.count.textContent = after ? `Impact ${fmt(-state.toImpactS, 1)} s ago` : `Impact in ${state.toImpactS >= 10 ? fmtInt(state.toImpactS) : fmt(state.toImpactS, state.toImpactS >= 1 ? 1 : 2)} s`;
    this.slow.textContent = state.speed < 0.999 ? `slow motion ${state.speed < 0.1 ? fmt(state.speed, 2) : fmt(state.speed, 1)}×` : '';
    this.slow.classList.toggle('is-on', state.speed < 0.999);
    // The gap on the log track (0 at 1,000 km, 1 at contact).
    const km = after ? 0 : Math.max(state.rangeKm, 1e-6);
    const k = after ? 1 : Math.min(1, Math.max(0, (TOP - Math.log10(km)) / (TOP - BOTTOM)));
    this.marker.style.left = `${(k * 100).toFixed(2)}%`;
    this.fill.style.width = `${(k * 100).toFixed(2)}%`;
    this.root.classList.toggle('is-after', after);
    const f = state.figures;
    const perUnit = 1 / Math.max(lengthValue(f.relSpeedKmS), 1e-6); // seconds to cover one km (or mile)
    this.gap.textContent = after
      ? 'Contact.'
      : `${fmtRange(state.rangeKm)} apart · closing at ${fmtKmS(f.relSpeedKmS)} · 1 ${lengthUnit()} every ${perUnit < 1 ? fmt(perUnit, 2) : fmt(perUnit, 1)} s`;
    const energy = f.tntTonnes >= 1000 ? `${fmt(f.tntTonnes / 1000, 1)} kt` : `${fmt(f.tntTonnes, f.tntTonnes < 10 ? 1 : 0)} t`;
    this.facts.textContent = after
      ? `${fmtInt(state.drawn)} fragments drawn · ${fmtInt(f.fragments10cm)} of 10 cm or more predicted · ${f.catastrophic ? 'catastrophic break-up' : 'damage, not a full break-up'}`
      : `Energy ${energy} of TNT · ${f.catastrophic ? 'catastrophic break-up expected' : 'damage, not a full break-up'}`;
  }
}
