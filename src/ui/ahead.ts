/**
 * "Ahead" tab of the close-approach monitor: predicts which objects will pass close to
 * each other in the coming hours. The scan runs in its own worker
 * (worker/lookahead.worker.ts → hashing/lookahead.ts); this file starts it, shows its
 * progress, and lists what it finds.
 */

import type { OmmRecord } from '../data/types.ts';
import { CATEGORY_COLORS, type Satellite } from '../data/types.ts';
import type { FutureApproach } from '../hashing/lookahead.ts';
import type { LookaheadReply, LookaheadRequest } from '../worker/lookahead.worker.ts';
import { $, fmt, fmtCompact, fmtInt, fmtKmS, fmtRange } from './dom.ts';
import { alertDistance, clockStamp, duration } from './inspector.ts';

export interface AheadContext {
  records: OmmRecord[];
  sats: Satellite[];
  mask: Uint8Array; // which objects are shown (the scan covers only those)
  startMs: number; // simulation time to scan forward from
}

export class AheadPanel {
  private worker: Worker | null = null;
  private results: FutureApproach[] = [];
  private sats: Satellite[] = [];
  private startMs = 0;
  private hours = 6;
  private alertKm = 1;
  private sort: 'miss' | 'time' = 'miss';
  // The last completed scan and what it was asked for, kept so that its summary can be
  // written again in other units (the choices above may have been changed since).
  private finished: LookaheadReply | null = null;
  private scanHours = 6;
  private scanKm = 1;
  private readonly list = $('ahead-list');
  private readonly run = $<HTMLButtonElement>('ahead-run');
  private readonly bar = $('ahead-bar');
  private readonly context: () => AheadContext | null;
  private readonly onPick: (approach: FutureApproach) => void;

  constructor(context: () => AheadContext | null, onPick: (approach: FutureApproach) => void) {
    this.context = context;
    this.onPick = onPick;
    const choice = (id: string, apply: (value: string) => void) => {
      const group = $(id);
      for (const button of group.querySelectorAll<HTMLElement>('button')) {
        button.addEventListener('click', () => {
          for (const other of group.querySelectorAll('button')) other.classList.toggle('is-on', other === button);
          apply(button.dataset.value!);
        });
      }
    };
    choice('ahead-hours', (v) => (this.hours = Number(v)));
    choice('ahead-km', (v) => (this.alertKm = Number(v)));
    choice('ahead-sort', (v) => {
      this.sort = v as 'miss' | 'time';
      this.render();
    });
    this.run.addEventListener('click', () => (this.worker ? this.cancel('Scan stopped.') : this.start()));
    this.refreshUnits();
  }

  /**
   * Write everything that names a distance, speed or clock time again. The choices are built
   * once and a finished scan is never redrawn by itself, so call this when the units or
   * clock setting changes (it also runs whenever the list is drawn).
   */
  refreshUnits(): void {
    // index.html labels the choices in km; the values behind them (data-value) stay in km.
    for (const button of $('ahead-km').querySelectorAll<HTMLElement>('button')) button.textContent = alertDistance(Number(button.dataset.value));
    this.render();
  }

  /** Throw away results that belong to a previous catalogue. */
  reset(): void {
    this.cancel('');
    this.results = [];
    this.finished = null;
    this.render();
  }

  private start(): void {
    const ctx = this.context();
    if (!ctx) return;
    this.sats = ctx.sats;
    this.startMs = ctx.startMs;
    this.results = [];
    this.finished = null;
    this.scanHours = this.hours;
    this.scanKm = this.alertKm;
    this.render();
    this.worker = new Worker(new URL('../worker/lookahead.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<LookaheadReply>) => this.onReply(event.data);
    const request: LookaheadRequest = { records: ctx.records, mask: ctx.mask, startMs: ctx.startMs, hours: this.hours, alertKm: this.alertKm };
    this.worker.postMessage(request);
    this.run.textContent = 'Stop';
    this.run.classList.remove('btn-primary');
    this.bar.classList.remove('is-hidden');
    (this.bar.firstElementChild as HTMLElement).style.width = '0%';
    $('ahead-status').textContent = `Scanning the next ${this.hours} h from ${clockStamp(ctx.startMs)}…`;
  }

  private cancel(message: string): void {
    this.worker?.terminate();
    this.worker = null;
    this.run.textContent = 'Scan';
    this.run.classList.add('btn-primary');
    this.bar.classList.add('is-hidden');
    $('ahead-status').textContent = message;
  }

  private onReply(reply: LookaheadReply): void {
    this.results = reply.closest;
    (this.bar.firstElementChild as HTMLElement).style.width = `${(reply.fraction * 100).toFixed(1)}%`;
    this.render();
    if (!reply.done) {
      $('ahead-status').textContent = `Scanning… ${Math.round(reply.fraction * 100)}%, ${fmtInt(reply.total)} found so far.`;
      return;
    }
    this.cancel(this.summary(reply));
    this.finished = reply;
  }

  private summary(reply: LookaheadReply): string {
    const shown = reply.closest.length;
    return `${fmtInt(reply.total)} passes within ${alertDistance(this.scanKm)} in the next ${this.scanHours} h`
      + (reply.total > shown ? `; showing the closest ${shown}` : '')
      + `. Found in ${fmt(reply.elapsedMs / 1000, 1)} s by examining ${fmtCompact(reply.examined)} candidate pairs.`;
  }

  private render(): void {
    if (this.finished) $('ahead-status').textContent = this.summary(this.finished);
    $('ahead-sort').classList.toggle('is-hidden', this.results.length < 2);
    const rows = this.sort === 'time' ? [...this.results].sort((p, q) => p.tcaMs - q.tcaMs) : this.results;
    this.list.replaceChildren(...rows.map((approach) => {
      const a = this.sats[approach.a], b = this.sats[approach.b];
      const li = document.createElement('li');
      li.className = approach.missKm < this.alertKm / 4 ? 'sev-high' : approach.missKm < this.alertKm / 2 ? 'sev-mid' : 'sev-low';
      li.innerHTML = '<i class="sev"></i><div class="names"><span><i class="dot"></i><b></b></span><span><i class="dot"></i><b></b></span></div><span class="dist"><b></b><small></small></span>';
      const names = li.querySelectorAll('.names b');
      const dots = li.querySelectorAll<HTMLElement>('.dot');
      names[0].textContent = a.name;
      names[1].textContent = b.name;
      dots[0].style.color = CATEGORY_COLORS[a.category];
      dots[1].style.color = CATEGORY_COLORS[b.category];
      const dist = li.querySelector('.dist')!;
      dist.firstElementChild!.textContent = fmtRange(approach.missKm);
      dist.lastElementChild!.textContent = `in ${duration(approach.tcaMs - this.startMs)}`;
      li.title = `${clockStamp(approach.tcaMs, true)}, passing at ${fmtKmS(approach.relSpeedKmS, 1)}`;
      li.addEventListener('click', () => this.onPick(approach));
      return li;
    }));
  }
}
