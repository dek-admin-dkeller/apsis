/**
 * Close-approach monitor: the switch, the alert distance, and the live list of pairs that
 * are inside it. The screening itself runs in the worker (worker/sim.worker.ts →
 * hashing/conjunction.ts); this file only shows the result.
 */

import type { Catalog } from '../data/catalog.ts';
import { CATEGORY_COLORS } from '../data/types.ts';
import type { FromWorker } from '../worker/protocol.ts';
import { $, fmt, fmtInt } from './dom.ts';

type ScreenMessage = Extract<FromWorker, { type: 'screen' }>;

const MAX_ROWS = 80;
const DOCKED_KM = 0.1; // closer than 100 m = parts of one spacecraft, or flying joined together

export interface MonitorHandlers {
  onToggle(on: boolean): void;
  onDistance(d: number): void;
  onPair(a: number, b: number): void;
  onHow(): void;
}

export class Monitor {
  private readonly list = $('pair-list');
  private readonly toggle = $('conj-toggle');
  private readonly handlers: MonitorHandlers;
  private last: { msg: ScreenMessage; catalog: Catalog } | null = null;
  private activePair = '';

  constructor(handlers: MonitorHandlers) {
    this.handlers = handlers;
    this.toggle.addEventListener('click', () => handlers.onToggle(this.toggle.getAttribute('aria-checked') !== 'true'));
    const slider = $<HTMLInputElement>('d-slider');
    slider.addEventListener('input', () => {
      $('d-label').textContent = `${slider.value} km`;
      handlers.onDistance(Number(slider.value));
    });
    $('conj-hide-docked').addEventListener('change', () => this.render());
    $('conj-how').addEventListener('click', handlers.onHow);
    for (const tab of $('conj-tabs').querySelectorAll<HTMLElement>('button')) {
      tab.addEventListener('click', () => this.showTab(tab.dataset.tab as 'now' | 'ahead'));
    }
  }

  /** "Right now" (the live list) or "Coming hours" (the prediction scan, ui/ahead.ts). */
  showTab(which: 'now' | 'ahead'): void {
    for (const tab of $('conj-tabs').querySelectorAll<HTMLElement>('button')) tab.classList.toggle('is-on', tab.dataset.tab === which);
    $('conj-now').classList.toggle('is-hidden', which !== 'now');
    $('ahead').classList.toggle('is-hidden', which !== 'ahead');
  }

  setEnabled(on: boolean): void {
    this.toggle.setAttribute('aria-checked', String(on));
    $('panel-conj').classList.toggle('is-on', on);
    $('conj-off-note').classList.toggle('is-hidden', on);
    this.list.classList.toggle('is-hidden', !on);
    if (!on) {
      this.last = null;
      this.list.replaceChildren();
      for (const id of ['conj-count', 'conj-closest', 'conj-time']) $(id).textContent = '–';
      $('conj-foot').textContent = '';
      $('stat-pairs').textContent = 'off';
      $('rail-badge').classList.add('is-hidden');
    }
  }

  /** Highlight the pair currently open in the encounter view. */
  setActive(a: number, b: number): void {
    this.activePair = a < 0 ? '' : `${a}:${b}`;
    for (const row of this.list.children) row.classList.toggle('is-on', (row as HTMLElement).dataset.pair === this.activePair);
  }

  setResult(msg: ScreenMessage, catalog: Catalog): void {
    this.last = { msg, catalog };
    this.render();
  }

  private render(): void {
    if (!this.last) return;
    const { msg, catalog } = this.last;
    const { stats } = msg;
    const hideDocked = $<HTMLInputElement>('conj-hide-docked').checked;

    // Pairs arrive sorted by distance; rows are reused so the list does not flicker.
    let shown = 0, hidden = 0, closest = Infinity;
    for (let k = 0; k < msg.pairA.length; k++) {
      const dist = msg.pairDist[k];
      if (hideDocked && dist < DOCKED_KM) {
        hidden++;
        continue;
      }
      if (dist < closest) closest = dist;
      if (shown >= MAX_ROWS) continue;
      const a = catalog.sats[msg.pairA[k]], b = catalog.sats[msg.pairB[k]];
      let row = this.list.children[shown] as HTMLLIElement | undefined;
      if (!row) {
        row = document.createElement('li');
        row.innerHTML = '<i class="sev"></i><div class="names"><span><i class="dot"></i><b></b></span><span><i class="dot"></i><b></b></span></div><span class="dist"></span>';
        row.addEventListener('click', () => this.handlers.onPair(Number(row!.dataset.a), Number(row!.dataset.b)));
        this.list.append(row);
      }
      row.dataset.a = String(a.index);
      row.dataset.b = String(b.index);
      row.dataset.pair = `${a.index}:${b.index}`;
      row.classList.toggle('is-on', row.dataset.pair === this.activePair);
      row.className = `${dist < 1 ? 'sev-high' : dist < msg.d / 2 ? 'sev-mid' : 'sev-low'}${row.classList.contains('is-on') ? ' is-on' : ''}`;
      const names = row.querySelectorAll('b');
      const dots = row.querySelectorAll<HTMLElement>('.dot');
      names[0].textContent = a.name;
      names[1].textContent = b.name;
      dots[0].style.color = CATEGORY_COLORS[a.category];
      dots[1].style.color = CATEGORY_COLORS[b.category];
      (row.lastElementChild as HTMLElement).textContent = `${fmt(dist, dist < 1 ? 3 : 2)} km`;
      shown++;
    }
    while (this.list.children.length > shown) this.list.lastElementChild!.remove();
    if (shown === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = `Nothing within ${msg.d} km right now.`;
      this.list.append(empty);
    }

    const total = stats.totalPairs - hidden;
    $('conj-count').textContent = fmtInt(total);
    $('conj-closest').textContent = Number.isFinite(closest) ? `${fmt(closest, 2)} km` : '–';
    $('conj-time').textContent = `${fmt(stats.hashMs, 1)} ms`;
    $('stat-pairs').textContent = fmtInt(total);
    const badge = $('rail-badge');
    badge.textContent = total > 99 ? '99+' : String(total);
    badge.classList.toggle('is-hidden', total === 0);
    $('conj-foot').textContent =
      `${fmtInt(stats.objects)} objects screened with ${fmtInt(stats.checks)} range measurements.`
      + (hidden > 0 ? ` ${fmtInt(hidden)} pairs under 100 m hidden.` : '')
      + (total > shown ? ` Showing the closest ${shown}.` : '');
  }
}
