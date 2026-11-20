/**
 * "How it works": the walkthrough page that explains the screening and shows the hash
 * table's real numbers for the current session (the live trace is filled in by
 * ui/hashTrace.ts). The timing comparison is `npm run bench` (scripts/bench.mjs).
 */

import type { ScreenStats } from '../worker/protocol.ts';
import { $, fmt, fmtCompact, fmtInt } from './dom.ts';

/** One labelled horizontal bar. */
function barRow(label: string, fraction: number, value: string, red = false): HTMLElement {
  const row = document.createElement('div');
  row.className = 'bar-row';
  const name = document.createElement('span');
  name.textContent = label;
  const track = document.createElement('div');
  track.className = 'track';
  const fill = document.createElement('div');
  fill.className = red ? 'fill red' : 'fill';
  fill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  track.append(fill);
  const number = document.createElement('span');
  number.className = 'value';
  number.textContent = value;
  row.append(name, track, number);
  return row;
}

export class HowTo {
  private readonly overlay = $('howto');
  private readonly main = $('howto-main');
  private readonly links = [...$('howto-nav').querySelectorAll<HTMLAnchorElement>('a')];

  constructor(onGrid: (on: boolean) => void) {
    // (Opened from the home page, the monitor panel and the About sheet; there is no button of its own.)
    $('howto-close').addEventListener('click', () => this.close());
    this.overlay.addEventListener('pointerdown', (event) => {
      if (event.target === this.overlay) this.close();
    });
    for (const link of this.links) {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        this.scrollTo(link.getAttribute('href')!.slice(1));
      });
    }
    // Highlight the section being read. The "reading line" starts near the top of the view and
    // slides to the bottom as the page is scrolled to its end — otherwise the last few
    // sections, which are too short ever to reach the top, would never be highlighted.
    this.main.addEventListener('scroll', () => {
      const { scrollTop, scrollHeight, clientHeight } = this.main;
      const progress = scrollHeight > clientHeight ? scrollTop / (scrollHeight - clientHeight) : 0;
      const readingLine = scrollTop + 120 + progress * (clientHeight - 120);
      let current = this.links[0];
      for (const link of this.links) {
        const section = $(link.getAttribute('href')!.slice(1));
        if (section.offsetTop <= readingLine) current = link;
      }
      for (const link of this.links) link.classList.toggle('is-on', link === current);
    });
    const grid = $<HTMLInputElement>('grid-toggle');
    grid.addEventListener('change', () => {
      onGrid(grid.checked);
      if (grid.checked) this.close(); // get out of the way so the cubes can be seen
    });
  }

  get isOpen(): boolean {
    return !this.overlay.classList.contains('is-hidden');
  }

  open(section?: string): void {
    this.overlay.classList.remove('is-hidden');
    if (section) this.scrollTo(section);
  }

  close(): void {
    this.overlay.classList.add('is-hidden');
  }

  private scrollTo(id: string): void {
    this.main.scrollTo({ top: $(id).offsetTop - 16, behavior: 'smooth' });
  }

  /** Fill in the live numbers from the latest screening pass. */
  setStats(stats: ScreenStats, d: number): void {
    $('hw-n').textContent = fmtInt(stats.objects);
    $('hw-brute').textContent = fmtCompact(stats.bruteChecks);
    $('hw-checks').textContent = fmtInt(stats.checks);
    $('hw-ms').textContent = `${fmt(stats.hashMs, 1)} ms`;

    $('st-objects').textContent = fmtInt(stats.objects);
    $('st-cells').textContent = fmtInt(stats.occupiedCells);
    $('st-avg').textContent = fmt(stats.avgBucket, 3);
    $('st-max').textContent = `${fmtInt(stats.maxBucket)} objects`;
    $('st-time').textContent = `${fmt(stats.hashMs, 1)} ms at d = ${d} km`;
    $('st-speedup').textContent = stats.checks > 0 ? `${fmtCompact(stats.bruteChecks / stats.checks)}× fewer measurements` : 'every measurement';

    const total = Math.max(1, stats.occupiedCells);
    $('histogram').replaceChildren(...stats.histogram.map((count, i) =>
      barRow(i === 4 ? '5 or more' : `${i + 1} object${i ? 's' : ''}`, count / total, fmtInt(count))));
    // A log scale, or the hash bar would be invisible next to brute force.
    const scale = Math.log10(Math.max(10, stats.bruteChecks));
    $('check-bars').replaceChildren(
      barRow('Every pair', 1, fmtCompact(stats.bruteChecks), true),
      barRow('Spatial hash', Math.log10(Math.max(1, stats.checks)) / scale, fmtInt(stats.checks)),
    );
  }
}
