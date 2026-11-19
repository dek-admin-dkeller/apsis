/**
 * Browsing a type found by the search ("spacex", "weather", "telescope"): one object at a time.
 *
 * Choosing a type in the search list (ui/search.ts) keeps only those objects on the globe, and
 * then this bar opens: the first object is selected (the camera flies to it, its card shows its
 * 3D model), and the visitor steps through the rest — the ‹ › buttons, the arrow keys on a
 * computer, a swipe along the bar on a phone. "Done" (or Escape) ends the browsing where it is:
 * the filter goes, the object stays selected, and the tracker is used as usual from there.
 * The owner's idea: "search spacex and just be able to easily swipe through".
 *
 * Order: working spacecraft before rocket stages and debris, then oldest first (so a type of
 * telescopes starts with Hubble, not with whichever was catalogued last).
 */

import { displayName } from '../data/names.ts';
import type { Satellite } from '../data/types.ts';
import type { App } from './app.ts';
import { fmtInt } from './dom.ts';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

const junk = (sat: Satellite): boolean => sat.category === 'Debris' || /\bR\/B\b|\bDEB\b/.test(sat.name);

export class SearchBrowse {
  private readonly app: App;
  private readonly root = el('div', 'browse is-hidden');
  private readonly name = el('b', 'br-name');
  private readonly count = el('span', 'br-count');
  private list: Satellite[] = [];
  private label = '';
  private index = 0;
  /** Called when browsing ends with "Done": the search takes its filter off (and its chip). */
  onDone: (() => void) | null = null;

  constructor(app: App) {
    this.app = app;
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Browse the results');
    const prev = el('button', 'br-step is-prev');
    const next = el('button', 'br-step is-next');
    prev.type = next.type = 'button';
    prev.setAttribute('aria-label', 'Previous (←)');
    next.setAttribute('aria-label', 'Next (→)');
    prev.title = 'Previous (←)';
    next.title = 'Next (→)';
    prev.addEventListener('click', () => this.step(-1));
    next.addEventListener('click', () => this.step(1));
    const text = el('div', 'br-text');
    text.append(this.name, this.count);
    const done = el('button', 'br-done', 'Done');
    done.type = 'button';
    done.title = 'Stop browsing: show everything again and stay on this one (Esc)';
    done.addEventListener('click', () => this.finish());
    this.root.append(prev, text, next, done);
    document.body.append(this.root);
    this.wireSwipe(text);
    window.addEventListener('keydown', (event) => {
      if (!this.open || event.metaKey || event.ctrlKey || event.altKey) return;
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (typing) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.step(event.key === 'ArrowRight' ? 1 : -1);
      } else if (event.key === 'Escape') {
        event.stopImmediatePropagation();
        this.finish();
      }
    }, true);
    app.onHome(() => this.close());
  }

  get open(): boolean {
    return !this.root.classList.contains('is-hidden');
  }

  /** Start browsing these objects (indices of the current catalogue). */
  start(label: string, members: number[]): void {
    const catalog = this.app.catalog();
    if (!catalog || members.length === 0) return;
    this.label = label;
    this.list = members.map((i) => catalog.sats[i]).sort((a, b) => Number(junk(a)) - Number(junk(b)) || a.noradId - b.noradId);
    this.index = 0;
    this.root.classList.remove('is-hidden');
    document.body.classList.add('browsing');
    this.show();
  }

  /** Stop without touching the selection or the filter (they were changed elsewhere). */
  close(): void {
    if (!this.open) return;
    this.root.classList.add('is-hidden');
    document.body.classList.remove('browsing');
    this.list = [];
  }

  /** "Done": everything shown again, the object in view stays selected. */
  private finish(): void {
    const keep = this.list[this.index] ?? null;
    this.close();
    this.onDone?.();
    if (keep && this.app.selected() !== keep) this.app.select(keep);
  }

  private step(direction: 1 | -1): void {
    if (this.list.length === 0) return;
    this.index = (this.index + direction + this.list.length) % this.list.length;
    navigator.vibrate?.(6);
    this.root.querySelector('.br-text')?.animate?.([{ transform: `translateX(${direction * 12}px)`, opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    this.show();
  }

  private show(): void {
    const sat = this.list[this.index];
    if (!sat) return;
    this.name.textContent = displayName(sat);
    this.count.textContent = `${this.label} · ${fmtInt(this.index + 1)} of ${fmtInt(this.list.length)}`;
    this.app.select(sat);
  }

  /** A swipe along the bar steps (the picture behind keeps its own drags). */
  private wireSwipe(on: HTMLElement): void {
    let x0: number | null = null, y0 = 0, id = -1;
    on.addEventListener('pointerdown', (event) => {
      x0 = event.clientX;
      y0 = event.clientY;
      id = event.pointerId;
      on.setPointerCapture?.(event.pointerId);
    });
    on.addEventListener('pointermove', (event) => {
      if (x0 === null || event.pointerId !== id) return;
      const dx = event.clientX - x0;
      if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(event.clientY - y0) * 1.3) {
        x0 = null;
        this.step(dx < 0 ? 1 : -1);
      }
    });
    const end = () => (x0 = null);
    on.addEventListener('pointerup', end);
    on.addEventListener('pointercancel', end);
  }
}
