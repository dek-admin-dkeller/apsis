/**
 * Close-approach monitor: the switch, the alert distance, and the live list of pairs that
 * are inside it. The screening itself runs in the worker (worker/sim.worker.ts →
 * hashing/conjunction.ts); this file only shows the result.
 *
 * The pairs come in two kinds, shown as two lists:
 *   Passing          two objects on different orbits crossing paths — over in seconds;
 *   Flying together  objects that stay close (docked, in formation, one launch's train).
 * The worker tells them apart by relative speed (see TOGETHER_KM_S in hashing/conjunction.ts).
 */

import type { Catalog } from '../data/catalog.ts';
import { CATEGORY_COLORS } from '../data/types.ts';
import { TOGETHER_KM_S } from '../hashing/conjunction.ts';
import type { FromWorker } from '../worker/protocol.ts';
import { $, fmt, fmtInt, fmtKmS, fmtRange, fmtSlow } from './dom.ts';
import { alertDistance } from './inspector.ts';

type ScreenMessage = Extract<FromWorker, { type: 'screen' }>;

const MAX_ROWS = 80;
const DOCKED_KM = 0.1; // closer than 100 m = parts of one spacecraft, or flying joined together

type Kind = 'passing' | 'together';
const KIND_NOTE: Record<Kind, string> = {
  passing: 'Objects on different orbits crossing paths right now. Each pass is over within seconds.',
  together: 'Objects that stay close: docked spacecraft, formations and launch trains. They are not approaching each other.',
};

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
  private kind: Kind = 'passing';

  constructor(handlers: MonitorHandlers) {
    this.handlers = handlers;
    this.toggle.addEventListener('click', () => handlers.onToggle(this.toggle.getAttribute('aria-checked') !== 'true'));
    const slider = $<HTMLInputElement>('d-slider');
    slider.addEventListener('input', () => {
      $('d-label').textContent = alertDistance(Number(slider.value));
      handlers.onDistance(Number(slider.value));
    });
    for (const button of $('conj-kind').querySelectorAll<HTMLElement>('button')) {
      button.addEventListener('click', () => {
        this.kind = button.dataset.value as Kind;
        this.list.scrollTop = 0;
        this.render();
      });
    }
    this.syncKind();
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

  private syncKind(): void {
    for (const button of $('conj-kind').querySelectorAll<HTMLElement>('button')) button.classList.toggle('is-on', button.dataset.value === this.kind);
    $('conj-kind-note').textContent = KIND_NOTE[this.kind];
    $('conj-count-label').textContent = this.kind === 'passing' ? 'Passing now' : 'Flying together';
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
      for (const id of ['conj-n-passing', 'conj-n-together']) $(id).textContent = '';
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
    this.syncKind();
    if (!this.last) return;
    const { msg, catalog } = this.last;
    const { stats } = msg;
    const wantTogether = this.kind === 'together';

    // Pairs arrive sorted by distance; rows are reused so the list does not flicker.
    let shown = 0, closest = Infinity;
    for (let k = 0; k < msg.pairA.length; k++) {
      const dist = msg.pairDist[k], speed = msg.pairSpeed[k];
      if (speed < TOGETHER_KM_S !== wantTogether) continue; // belongs to the other list
      if (dist < closest) closest = dist;
      if (shown >= MAX_ROWS) continue;
      const a = catalog.sats[msg.pairA[k]], b = catalog.sats[msg.pairB[k]];
      let row = this.list.children[shown] as HTMLLIElement | undefined;
      if (!row || row.classList.contains('empty')) {
        row?.remove();
        row = document.createElement('li');
        row.innerHTML = '<i class="sev"></i><div class="names"><span><i class="dot"></i><b></b></span><span><i class="dot"></i><b></b></span></div><span class="dist"><b></b><small></small></span>';
        row.addEventListener('click', () => this.handlers.onPair(Number(row!.dataset.a), Number(row!.dataset.b)));
        this.list.insertBefore(row, this.list.children[shown] ?? null);
      }
      row.dataset.a = String(a.index);
      row.dataset.b = String(b.index);
      row.dataset.pair = `${a.index}:${b.index}`;
      // Colour says how close a PASSING pair is; pairs flying together are no cause for alarm.
      const severity = wantTogether ? 'sev-calm' : dist < 1 ? 'sev-high' : dist < msg.d / 2 ? 'sev-mid' : 'sev-low';
      row.className = `${severity}${row.dataset.pair === this.activePair ? ' is-on' : ''}`;
      const names = row.querySelectorAll<HTMLElement>('.names b');
      const dots = row.querySelectorAll<HTMLElement>('.dot');
      names[0].textContent = a.name;
      names[1].textContent = b.name;
      dots[0].style.color = CATEGORY_COLORS[a.category];
      dots[1].style.color = CATEGORY_COLORS[b.category];
      const cell = row.lastElementChild as HTMLElement;
      (cell.firstElementChild as HTMLElement).textContent = fmtRange(dist);
      (cell.lastElementChild as HTMLElement).textContent = wantTogether
        ? dist < DOCKED_KM ? 'joined' : `drifting ${fmtSlow(speed)}`
        : `passing at ${fmtKmS(speed, 1)}`;
      shown++;
    }
    while (this.list.children.length > shown) this.list.lastElementChild!.remove();
    if (shown === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = wantTogether
        ? `Nothing is flying together within ${alertDistance(msg.d)} right now.`
        : `Nothing is passing within ${alertDistance(msg.d)} right now.`;
      this.list.append(empty);
    }

    const total = wantTogether ? stats.together : stats.passing;
    $('conj-n-passing').textContent = fmtInt(stats.passing);
    $('conj-n-together').textContent = fmtInt(stats.together);
    $('conj-count').textContent = fmtInt(total);
    $('conj-closest').textContent = Number.isFinite(closest) ? fmtRange(closest) : '–';
    $('conj-time').textContent = `${fmt(stats.hashMs, 1)} ms`;
    // The headline numbers (top bar, badge on the rail) count real approaches only.
    $('stat-pairs').textContent = fmtInt(stats.passing);
    const badge = $('rail-badge');
    badge.textContent = stats.passing > 99 ? '99+' : String(stats.passing);
    badge.classList.toggle('is-hidden', stats.passing === 0);
    $('conj-foot').textContent =
      `${fmtInt(stats.objects)} objects screened with ${fmtInt(stats.checks)} range measurements.`
      + (total > shown ? ` Showing the closest ${shown}.` : '');
  }
}
