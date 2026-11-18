/**
 * The Objects panel's three tabs.
 *
 * The panel had grown to fourteen sections in one long scroll, and the later ones (visible
 * passes, launches, growth by year …) were easy to miss. They are now sorted by what the
 * visitor is doing:
 *
 *   Browse    choose what is on the globe and pick things out of it
 *             (watchlist, notable objects, type and orbit filters, colours and labels)
 *   Activity  what is happening up there
 *             (passes tonight, launches, orbit changes, newest objects, trains, lowest orbits)
 *   Tools     things to do with the catalogue
 *             (constellations, growth by year, design a satellite)
 *
 * Nothing else changed: every section is still the same <details> element in index.html,
 * filled in by the same module. Each one says which tab it belongs to (`data-tab`) and what
 * it is called by other code (`data-section`); this class only decides which are on show.
 *
 * A section that is opened by code — a command, a link from another panel — brings its own
 * tab forward, so nothing has to know which tab a section lives in.
 */

import { $ } from './dom.ts';

export type ObjectTab = 'browse' | 'activity' | 'tools';

export class ObjectTabs {
  private readonly panel = $('panel-objects');
  private readonly body = $('obj-body');
  private readonly buttons = [...$('obj-tabs').querySelectorAll<HTMLButtonElement>('button')];
  private readonly sections = [...this.panel.querySelectorAll<HTMLDetailsElement>('details[data-tab]')];
  private shown: ObjectTab = 'browse';

  constructor() {
    for (const button of this.buttons) button.addEventListener('click', () => this.show(button.dataset.tab as ObjectTab));
    // `toggle` does not bubble, but it can be caught on the way down (the capture phase).
    this.panel.addEventListener('toggle', (event) => {
      const section = event.target as HTMLDetailsElement;
      const tab = section.dataset?.tab as ObjectTab | undefined;
      if (section.open && tab && tab !== this.shown) this.show(tab, false);
    }, true);
    this.show('browse');
  }

  /** Bring one tab forward. `toTop` = start at the top of it (not wanted when a section in it was just opened). */
  show(tab: ObjectTab, toTop = true): void {
    this.shown = tab;
    for (const button of this.buttons) {
      const on = button.dataset.tab === tab;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-selected', String(on));
    }
    let first = true;
    for (const section of this.sections) {
      const on = section.dataset.tab === tab;
      section.classList.toggle('is-hidden', !on);
      section.classList.toggle('is-first', on && first); // style.css: no line above the first one on show
      if (on) first = false;
    }
    if (toTop) this.body.scrollTop = 0;
  }

  /**
   * Open a section by name and bring it into view. Returns false if there is no such section.
   * (The caller opens the Objects panel itself; this only looks after what is inside it.)
   */
  open(name: string): boolean {
    const section = this.sections.find((candidate) => candidate.dataset.section === name);
    if (!section) return false;
    this.show(section.dataset.tab as ObjectTab, false);
    section.open = true;
    // After the panel has been laid out (it may have been hidden until this moment).
    requestAnimationFrame(() => section.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    return true;
  }
}
