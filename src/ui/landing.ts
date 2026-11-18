/**
 * The home page: what a visitor sees first, and where the tracker is explained.
 *
 * It carries the opening screen (headline, the orbit drawing, "Open the tracker"), the list
 * of everything the tracker can do (drawn from featureList.ts, so there is one place to keep
 * it current), a summary of how the search works with a way into the full walkthrough, and a
 * small corner for games.
 *
 * The tracker starts loading behind it straight away: the page is an opaque layer on top,
 * static markup in index.html so it is painted before any script has run. "Open the
 * tracker" puts the page away and shows whatever is underneath — the tracker if it has
 * finished loading, otherwise the launch screen with its progress. "About" in the tracker's
 * top bar brings the page back.
 *
 * On arrival it is skipped for share links (the visitor asked for something specific) and
 * when the "Welcome page" setting is off — index.html decides that before the first paint by
 * putting the class `no-landing` on <html>.
 */

import './landing.css';
import { $, fmtInt } from './dom.ts';
import { FEATURES } from './featureList.ts';

export interface LandingHost {
  /** Open the full walkthrough (it is drawn over this page). */
  howItWorks(): void;
}

export class Landing {
  /** Resolves when the visitor first chooses to go in (immediately if the page was skipped on arrival). */
  readonly entered: Promise<void>;
  private readonly root = $('landing');
  private visible: boolean;
  private firstEntry: (() => void) | null = null;
  private host: LandingHost | null = null;

  constructor() {
    this.visible = !document.documentElement.classList.contains('no-landing');
    this.entered = this.visible ? new Promise((resolve) => (this.firstEntry = resolve)) : Promise.resolve();
    if (!this.visible) this.root.classList.add('is-away');
    this.drawFeatures();

    for (const button of this.root.querySelectorAll<HTMLElement>('[data-ld-enter]')) button.addEventListener('click', () => this.enter());
    for (const link of this.root.querySelectorAll<HTMLElement>('[data-ld-jump]')) {
      link.addEventListener('click', () => $(link.dataset.ldJump!).scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
    $('landing-how').addEventListener('click', () => this.host?.howItWorks());
    // Enter goes in — unless the key belongs to a button that has the focus (that button handles it).
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && this.visible && !(event.target as HTMLElement).closest('button, a, input')) this.enter();
    });
    if (this.visible) $('landing-enter').focus({ preventScroll: true });
  }

  setHost(host: LandingHost): void {
    this.host = host;
  }

  /** "What it does": one titled list per group, set in columns. */
  private drawFeatures(): void {
    const list = $('ld-feature-list');
    for (const group of FEATURES) {
      const block = document.createElement('div');
      block.className = 'ld-group';
      const title = document.createElement('h3');
      title.textContent = group.title;
      const items = document.createElement('dl');
      for (const feature of group.items) {
        const name = document.createElement('dt');
        name.textContent = feature.name;
        if (feature.fresh) name.append(Object.assign(document.createElement('span'), { className: 'ld-fresh', textContent: 'new' }));
        const text = document.createElement('dd');
        text.textContent = feature.text;
        items.append(name, text);
      }
      block.append(title, items);
      list.append(block);
    }
  }

  /** Is the page in front of the tracker? (Keyboard shortcuts and drawing wait while it is.) */
  get showing(): boolean {
    return this.visible;
  }

  /** Put the page away and show the tracker. */
  enter(): void {
    if (!this.visible) return;
    this.visible = false;
    this.root.classList.add('is-leaving');
    setTimeout(() => {
      if (this.visible) return; // brought straight back
      this.root.classList.add('is-away');
      this.root.classList.remove('is-leaving');
    }, 460); // after the fade in landing.css
    this.firstEntry?.();
    this.firstEntry = null;
  }

  /** Bring the page back from inside the tracker (the "About" button). */
  open(): void {
    if (this.visible) return;
    this.visible = true;
    document.documentElement.classList.remove('no-landing');
    this.root.classList.remove('is-away', 'is-leaving');
    this.root.scrollTop = 0;
    for (const button of this.root.querySelectorAll<HTMLElement>('[data-ld-enter]')) button.textContent = 'Back to the tracker';
  }

  /** The line beside the button: what the tracker behind the page is doing. */
  status(text: string): void {
    $('landing-status').textContent = text;
  }

  /** Put the real size of the catalogue into the "how it works" figures. */
  setCount(objects: number): void {
    const pairs = (objects * (objects - 1)) / 2;
    for (const el of this.root.querySelectorAll('[data-ld-count]')) el.textContent = fmtInt(objects);
    for (const el of this.root.querySelectorAll('[data-ld-pairs-exact]')) el.textContent = fmtInt(pairs);
    for (const el of this.root.querySelectorAll('[data-ld-pairs]')) el.textContent = `${fmtInt(pairs / 1e6)} million`;
  }
}
