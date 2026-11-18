/**
 * Close-approach monitor: the switch, the alert distance, and the live list of pairs that
 * are inside it. The screening itself runs in the worker (worker/sim.worker.ts →
 * hashing/conjunction.ts); this file only shows the result.
 *
 * The pairs come in two kinds, shown as two lists:
 *   Passing          two objects on different orbits crossing paths — over in seconds;
 *   Flying together  objects that stay close (docked, in formation, one launch's train).
 * The worker tells them apart by relative speed (see TOGETHER_KM_S in hashing/conjunction.ts).
 *
 * Joined objects are listed ONCE. A space station is catalogued as a dozen objects at the
 * same place, which the screening reports as every pair among them (11 objects → 55 pairs at
 * "0 m"). Those pairs are merged back into one row per spacecraft (hashing/groups.ts), and
 * clicking that row selects the spacecraft: there is no pair to look at, the two are one thing.
 */

import type { Catalog } from '../data/catalog.ts';
import { CATEGORY_COLORS } from '../data/types.ts';
import { TOGETHER_KM_S } from '../hashing/conjunction.ts';
import { connectedGroups } from '../hashing/groups.ts';
import type { FromWorker } from '../worker/protocol.ts';
import { $, fmt, fmtInt, fmtKmS, fmtRange, fmtSlow } from './dom.ts';
import { alertDistance } from './inspector.ts';

type ScreenMessage = Extract<FromWorker, { type: 'screen' }>;

const MAX_ROWS = 80;
/** Closer than 100 m and not moving apart = parts of one spacecraft, or two flying joined together. */
export const DOCKED_KM = 0.1;

/** One row of the list: two objects near each other, or one spacecraft made of several catalogued objects. */
type Row =
  | { group: false; a: number; b: number; dist: number; speed: number }
  | { group: true; members: number[] } // catalogue indexes, the oldest object first
  | { head: string; note: string }; // a heading inside the list

type Kind = 'passing' | 'together';
const KIND_NOTE: Record<Kind, string> = {
  passing: 'Objects on different orbits crossing paths right now. Each pass is over within seconds.',
  together: 'Objects that stay close to each other. They are not approaching.',
};

export interface MonitorHandlers {
  onToggle(on: boolean): void;
  onDistance(d: number): void;
  onPair(a: number, b: number): void;
  /** A row that is one spacecraft catalogued as several objects was chosen (catalogue indexes, the oldest first). */
  onJoined(members: number[]): void;
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

  /**
   * The rows of the "Flying together" list: each joined spacecraft once, then the pairs that
   * really are two things. Also says how many together-pairs arrived (the worker caps them).
   */
  private togetherRows(msg: ScreenMessage, catalog: Catalog): { rows: Row[]; received: number } {
    const docked: [number, number][] = [];
    let received = 0;
    for (let k = 0; k < msg.pairA.length; k++) {
      if (msg.pairSpeed[k] >= TOGETHER_KM_S) continue;
      received++;
      if (msg.pairDist[k] < DOCKED_KM) docked.push([msg.pairA[k], msg.pairB[k]]);
    }
    // Which spacecraft each joined object belongs to: a Map<object, its group>.
    const groupOf = new Map<number, number[]>();
    const rows: Row[] = [];
    for (const members of connectedGroups(docked)) {
      members.sort((p, q) => catalog.sats[p].noradId - catalog.sats[q].noradId); // the oldest part first: a station's core module
      for (const index of members) groupOf.set(index, members);
      rows.push({ group: true, members });
    }
    rows.sort((p, q) => (q as { members: number[] }).members.length - (p as { members: number[] }).members.length); // the largest spacecraft first
    const joined = rows.length;
    if (joined > 0) rows.unshift({ head: 'Joined', note: 'one spacecraft, listed as several objects' });
    for (let k = 0; k < msg.pairA.length; k++) {
      if (msg.pairSpeed[k] >= TOGETHER_KM_S) continue;
      const a = msg.pairA[k], b = msg.pairB[k];
      const group = groupOf.get(a);
      if (group && group === groupOf.get(b)) continue; // two parts of the same spacecraft: already listed
      rows.push({ group: false, a, b, dist: msg.pairDist[k], speed: msg.pairSpeed[k] });
    }
    // The two kinds are told apart by a heading each (only needed when both are present).
    const separate = joined > 0 ? joined + 1 : 0; // where the pairs begin
    if (joined > 0 && rows.length > separate) rows.splice(separate, 0, { head: 'Separate', note: 'formations and launch trains' });
    return { rows, received };
  }

  private render(): void {
    this.syncKind();
    if (!this.last) return;
    const { msg, catalog } = this.last;
    const { stats } = msg;
    const wantTogether = this.kind === 'together';

    // What to list. Pairs arrive sorted by distance.
    const together = this.togetherRows(msg, catalog);
    let rows: Row[];
    if (wantTogether) rows = together.rows;
    else {
      rows = [];
      for (let k = 0; k < msg.pairA.length; k++) {
        if (msg.pairSpeed[k] >= TOGETHER_KM_S) rows.push({ group: false, a: msg.pairA[k], b: msg.pairB[k], dist: msg.pairDist[k], speed: msg.pairSpeed[k] });
      }
    }
    let closest = Infinity;
    for (const row of rows) if ('dist' in row && row.dist < closest) closest = row.dist;
    // How many things fly together: spacecraft and pairs as listed, unless the worker had to
    // cut its list short (then only its own count of pairs is known).
    const togetherTotal = stats.together <= together.received ? together.rows.filter((row) => !('head' in row)).length : stats.together;

    // Rows are reused so the list does not flicker.
    const shown = Math.min(rows.length, MAX_ROWS);
    for (let n = 0; n < shown; n++) {
      const item = rows[n];
      let row = this.list.children[n] as HTMLLIElement | undefined;
      const isHead = 'head' in item;
      if (!row || row.classList.contains('empty') || row.classList.contains('head') !== isHead) {
        const made = document.createElement('li');
        if (isHead) made.innerHTML = '<b></b><span></span>';
        else {
          made.innerHTML = '<i class="sev"></i><div class="names"><span><i class="dot"></i><b></b></span><span><i class="dot"></i><b></b></span></div><span class="dist"><b></b><small></small></span>';
          made.addEventListener('click', () => {
            if (made.dataset.members) this.handlers.onJoined(made.dataset.members.split(',').map(Number));
            else this.handlers.onPair(Number(made.dataset.a), Number(made.dataset.b));
          });
        }
        if (row) row.replaceWith(made);
        else this.list.append(made);
        row = made;
      }
      if ('head' in item) {
        row.className = 'head';
        (row.firstElementChild as HTMLElement).textContent = item.head;
        (row.lastElementChild as HTMLElement).textContent = item.note;
        continue;
      }
      const names = row.querySelectorAll<HTMLElement>('.names b');
      const dots = row.querySelectorAll<HTMLElement>('.dot');
      const cell = row.lastElementChild as HTMLElement;
      if (item.group) {
        // One spacecraft: its oldest part by name, then the rest in short ("ISS (UNITY)" → "UNITY").
        const [first, ...rest] = item.members.map((index) => catalog.sats[index]);
        row.dataset.members = item.members.join(',');
        row.dataset.pair = 'joined'; // never equal to an open pair's "a:b"
        row.className = 'sev-calm is-joined';
        row.title = `${item.members.length} catalogued objects that are one spacecraft: ${[first, ...rest].map((sat) => sat.name).join(', ')}`;
        names[0].textContent = first.name;
        names[1].textContent = `+ ${rest.map((sat) => sat.name.replace(/^[A-Z]+ \((.+)\)$/, '$1')).join(', ')}`;
        dots[0].style.color = CATEGORY_COLORS[first.category];
        (cell.firstElementChild as HTMLElement).textContent = 'joined';
        (cell.lastElementChild as HTMLElement).textContent = `${item.members.length} objects`;
        continue;
      }
      const a = catalog.sats[item.a], b = catalog.sats[item.b];
      delete row.dataset.members;
      row.title = '';
      row.dataset.a = String(a.index);
      row.dataset.b = String(b.index);
      row.dataset.pair = `${a.index}:${b.index}`;
      // Colour says how close a PASSING pair is; pairs flying together are no cause for alarm.
      const severity = wantTogether ? 'sev-calm' : item.dist < 1 ? 'sev-high' : item.dist < msg.d / 2 ? 'sev-mid' : 'sev-low';
      row.className = `${severity}${row.dataset.pair === this.activePair ? ' is-on' : ''}`;
      names[0].textContent = a.name;
      names[1].textContent = b.name;
      dots[0].style.color = CATEGORY_COLORS[a.category];
      dots[1].style.color = CATEGORY_COLORS[b.category];
      (cell.firstElementChild as HTMLElement).textContent = fmtRange(item.dist);
      (cell.lastElementChild as HTMLElement).textContent = wantTogether
        ? item.dist < DOCKED_KM ? 'joined' : `drifting ${fmtSlow(item.speed)}`
        : `passing at ${fmtKmS(item.speed, 1)}`;
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

    const total = wantTogether ? togetherTotal : stats.passing;
    $('conj-n-passing').textContent = fmtInt(stats.passing);
    $('conj-n-together').textContent = fmtInt(togetherTotal);
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
