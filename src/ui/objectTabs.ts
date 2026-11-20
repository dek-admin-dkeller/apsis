/**
 * The Objects panel: three tabs, and a grid of tiles for the features.
 *
 *   Browse    a page of controls: watchlist, notable objects, filters, colours and labels
 *   Activity  what is happening up there: launches, orbit changes, newest, trains, lowest orbits …
 *   Tools     things to do with the catalogue: constellations, growth by year, the designer …
 *
 * Activity and Tools used to be lists of collapsed sections, each with a line of description:
 * a lot of text, and the features read as fine print. Now each feature is a TILE (an icon, a
 * short name, and a live figure where the feature has one). Choosing a tile puts that
 * feature's section in place of the grid, with its title as the way back.
 *
 * Nothing else changed underneath: every section is still one <details> in index.html, filled
 * in by the same module, and "open" still means the <details> is open. So:
 *   - a tile opens its section by setting `open`; the section's own title closes it again;
 *   - a section opened by other code (a command, `app.openSection`) shows up here by itself,
 *     because this class listens for every `toggle` in the panel;
 *   - a module that wants a figure on its tile keeps a `.sum-note` in its section's <summary>
 *     (dom.ts: sectionNote), and the tile copies it.
 * Some tiles are not sections at all but shortcuts to things that open elsewhere (the contact
 * timeline, the walkthrough): they press the button that already exists.
 */

import { $ } from './dom.ts';

export type ObjectTab = 'browse' | 'activity' | 'tools';

/** Line icons, 20 × 20, drawn like the ones on the tool rail (one stroke weight, round ends). */
const ICONS: Record<string, string> = {
  tonight: '<path d="M1.8 10s3-5.5 8.2-5.5S18.2 10 18.2 10s-3 5.5-8.2 5.5S1.8 10 1.8 10z"/><circle cx="10" cy="10" r="2.4"/>',
  launches: '<path d="M10 2.5c2.2 1.9 3.2 4.6 3.2 7.6v3.4H6.8v-3.4c0-3 1-5.7 3.2-7.6z"/><path d="M6.8 11.2l-2.3 2.6v2.2l2.3-1.2M13.2 11.2l2.3 2.6v2.2l-2.3-1.2M10 15.2v2.4"/><circle cx="10" cy="8.2" r="1.2"/>',
  changes: '<path d="M6.5 16V4.5M3.5 7.5l3-3 3 3M13.5 4v11.5M10.5 12.5l3 3 3-3"/>',
  newest: '<circle cx="10" cy="10" r="7"/><path d="M10 6.5v7M6.5 10h7"/>',
  trains: '<path d="M2.5 14.5l15-9" stroke-dasharray="0.1 3.2"/><circle cx="5.3" cy="12.8" r="1.7"/><circle cx="10" cy="10" r="1.7"/><circle cx="14.7" cy="7.2" r="1.7"/>',
  lowest: '<path d="M2.5 4.5c5.2 0 8.6 2.6 10.8 8"/><path d="M13.9 8.6l-.5 4-3.7-1.5M2.5 16.5h15"/>',
  flybys: '<circle cx="6.2" cy="13.8" r="3.4"/><path d="M3 3.8c6.4.6 11 4.4 14 11.4"/><circle cx="12.6" cy="7.6" r="1.4"/>',
  fireballs: '<circle cx="6" cy="14" r="2.8"/><path d="M8.2 11.8L16.5 3.5M12.4 3.9l-3.6 3.6M16.1 7.6l-3.6 3.6"/>',
  showers: '<path d="M16.5 2.8l-6 6M10 3.2L3.5 9.7M17 8.8l-7.2 7.2M8.6 11.4l-5.4 5.4"/>',
  dsn: '<path d="M3.4 8.2a7 7 0 0 0 8.9 8.9z"/><path d="M7.8 12.7l4.4-4.4"/><circle cx="13.4" cy="7.1" r="1.4"/><path d="M15 2.9a4.4 4.4 0 0 1 2.6 2.6"/>',
  constellations: '<path d="M4 14.5l4-8 5 3.5 3.5-5.5M13 10l-1 6"/><circle cx="4" cy="14.5" r="1.3"/><circle cx="8" cy="6.5" r="1.3"/><circle cx="13" cy="10" r="1.3"/><circle cx="16.5" cy="4.5" r="1.3"/><circle cx="12" cy="16" r="1.3"/>',
  growth: '<path d="M3 16.5h14M5.5 16.5v-3M9 16.5v-6M12.5 16.5V8M16 16.5V4.5"/>',
  designer: '<path d="M12.8 3.8l3.4 3.4-9 9-4 .6.6-4zM11 5.6l3.4 3.4"/>',
  contacts: '<rect x="3" y="4.4" width="7" height="2.6" rx="1"/><rect x="8" y="8.7" width="9" height="2.6" rx="1"/><rect x="5" y="13" width="6" height="2.6" rx="1"/>',
  howto: '<rect x="3" y="3" width="14" height="14" rx="1.5"/><path d="M3 10h14M10 3v14"/><circle cx="6.5" cy="6.5" r="0.9"/><circle cx="13.6" cy="13.3" r="0.9"/>',
  tour: '<circle cx="10" cy="10" r="7"/><path d="M12.8 7.2l-1.6 4-4 1.6 1.6-4z"/>',
  spacecraft: '<g transform="rotate(-32 10 10)"><rect x="7.6" y="7.4" width="4.8" height="5.2" rx="0.9"/><rect x="1.6" y="8.1" width="4.2" height="3.8" rx="0.5"/><rect x="14.2" y="8.1" width="4.2" height="3.8" rx="0.5"/><path d="M5.8 10h1.8M12.4 10h1.8M10 7.4V5.6M8.2 4.6a1.8 1.8 0 0 0 3.6 0"/></g>',
};

/** Tiles that are shortcuts, not sections: the button each one presses already exists on the page. */
const SHORTCUTS: { tab: ObjectTab; icon: string; label: string; hint: string; press: string }[] = [
  { tab: 'tools', icon: 'spacecraft', label: 'Spacecraft', hint: 'Every 3D model, to turn and look at', press: '#gallery-open' },
  { tab: 'tools', icon: 'contacts', label: 'Contact timeline', hint: 'When your ground stations can see your starred objects', press: '#contacts-open' },
  { tab: 'tools', icon: 'howto', label: 'How it works', hint: 'The walkthrough of the hashing', press: '#conj-how' },
  { tab: 'tools', icon: 'tour', label: 'Take the tour', hint: 'A short guided look around', press: '#tour-start' },
];

interface Tile {
  tab: ObjectTab;
  button: HTMLButtonElement;
  value: HTMLElement;
  section: HTMLDetailsElement | null; // null for a shortcut
}

export class ObjectTabs {
  private readonly panel = $('panel-objects');
  private readonly body = $('obj-body');
  private readonly grid = $('obj-grid');
  private readonly buttons = [...$('obj-tabs').querySelectorAll<HTMLButtonElement>('button')];
  private readonly sections = [...this.panel.querySelectorAll<HTMLDetailsElement>('details[data-tab]')];
  private readonly tiles: Tile[] = [];
  private shown: ObjectTab = 'browse';

  constructor() {
    for (const section of this.sections) if (section.dataset.tile) this.tiles.push(this.sectionTile(section));
    for (const shortcut of SHORTCUTS) this.tiles.push(this.shortcutTile(shortcut));
    this.grid.append(...this.tiles.map((tile) => tile.button));

    for (const button of this.buttons) {
      button.addEventListener('click', () => {
        const tab = button.dataset.tab as ObjectTab;
        // Pressing the tab you are already on goes back to its grid, as a tab bar does.
        if (tab === this.shown) this.openSection(tab)?.removeAttribute('open');
        this.show(tab);
      });
    }
    // `toggle` does not bubble, but it can be caught on the way down (the capture phase).
    this.panel.addEventListener('toggle', (event) => {
      const section = event.target as HTMLDetailsElement;
      const tab = section.dataset?.tab as ObjectTab | undefined;
      if (!tab) return;
      if (section.open && tab !== this.shown) this.show(tab, false);
      else this.layout();
    }, true);
    this.show('browse');
  }

  private makeTile(icon: string, label: string, hint: string): { button: HTMLButtonElement; value: HTMLElement } {
    const button = document.createElement('button');
    button.className = 'obj-tile';
    button.type = 'button';
    button.title = hint;
    button.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true">${ICONS[icon] ?? ''}</svg><span class="obj-tile-name"></span><span class="obj-tile-value"></span>`;
    button.querySelector('.obj-tile-name')!.textContent = label;
    return { button, value: button.querySelector<HTMLElement>('.obj-tile-value')! };
  }

  private sectionTile(section: HTMLDetailsElement): Tile {
    const name = section.dataset.section!;
    const { button, value } = this.makeTile(name, section.dataset.tile!, section.dataset.hint ?? '');
    button.dataset.section = name;
    button.addEventListener('click', () => (section.open = true));
    // The tile shows whatever figure the section's module keeps in its title (a `.sum-note`).
    const summary = section.querySelector('summary')!;
    const copy = () => (value.textContent = summary.querySelector('.sum-note')?.textContent ?? '');
    new MutationObserver(copy).observe(summary, { childList: true, subtree: true, characterData: true });
    copy();
    return { tab: section.dataset.tab as ObjectTab, button, value, section };
  }

  private shortcutTile(shortcut: (typeof SHORTCUTS)[number]): Tile {
    const { button, value } = this.makeTile(shortcut.icon, shortcut.label, shortcut.hint);
    button.addEventListener('click', () => document.querySelector<HTMLElement>(shortcut.press)?.click());
    return { tab: shortcut.tab, button, value, section: null };
  }

  /** The section of a tab that is open in place of its grid, if any. */
  private openSection(tab: ObjectTab): HTMLDetailsElement | undefined {
    return tab === 'browse' ? undefined : this.sections.find((section) => section.dataset.tab === tab && section.open);
  }

  /** Decide what is on show: Browse's controls, a tab's grid of tiles, or the one section opened from it. */
  private layout(): void {
    const tab = this.shown;
    const opened = this.openSection(tab);
    const tiled = tab !== 'browse';
    this.body.classList.toggle('is-tiled', tiled);
    this.grid.classList.toggle('is-hidden', !tiled || !!opened);
    for (const tile of this.tiles) tile.button.classList.toggle('is-hidden', tile.tab !== tab);
    let first = true;
    for (const section of this.sections) {
      const on = section.dataset.tab === tab && (!tiled || section === opened);
      section.classList.toggle('is-hidden', !on);
      section.classList.toggle('is-first', on && first); // style.css: no line above the first one on show
      if (on) first = false;
    }
  }

  /** Bring one tab forward. `toTop` = start at the top of it (not wanted when a section in it was just opened). */
  show(tab: ObjectTab, toTop = true): void {
    this.shown = tab;
    for (const button of this.buttons) {
      const on = button.dataset.tab === tab;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-selected', String(on));
    }
    this.layout();
    if (toTop) this.body.scrollTop = 0;
  }

  /**
   * Open a section by name and bring it into view. Returns false if there is no such section.
   * (The caller opens the Objects panel itself; this only looks after what is inside it.)
   */
  open(name: string): boolean {
    const section = this.sections.find((candidate) => candidate.dataset.section === name);
    if (!section) return false;
    section.open = true;
    this.show(section.dataset.tab as ObjectTab, false);
    // After the panel has been laid out (it may have been hidden until this moment).
    requestAnimationFrame(() => section.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    return true;
  }
}
