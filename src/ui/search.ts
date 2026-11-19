/**
 * The search field: the one place to type anything.
 *
 * There used to be two (this field for names, and a separate command bar for places, times
 * and actions) and neither could answer "telescope". Now this field asks every source for
 * what was typed and shows the answers as one list under quiet headings:
 *
 *   Objects   catalogue objects by name, nickname or number    searchObjects.ts (hash lookups, then typo-tolerant)
 *   Types     "Space telescopes · 19 objects", "SpaceX" …       searchIndex.ts  (the keyword hash table)
 *   …         whatever was registered with `app.addSearch`: places, times and actions
 *             (features/commands.ts), bodies and craft beyond Earth orbit, anything later
 *
 * Every row is a SearchHit (ui/app.ts) with a score from 0 to 1; the headings are ordered by
 * their best row, so Enter always runs the best match overall. Choosing a type shows only
 * those objects on the globe, and a small chip in the field takes the filter off again (so
 * does Home). When nothing fits, one line says so and suggests what to try.
 *
 * Keys: `/` or Ctrl/Cmd+K puts the cursor here; arrows, Enter and Escape work the list.
 */

import type { Catalog } from '../data/catalog.ts';
import { describe, KIND_LABEL, type ModelKind } from '../data/describe.ts';
import { displayName } from '../data/names.ts';
import type { Satellite } from '../data/types.ts';
import type { App, SearchHit, SearchProvider } from './app.ts';
import { $, fmtInt } from './dom.ts';
import { buildKeywordIndex, findDescribed, findTopics, type KeywordIndex } from './searchIndex.ts';
import { normalize, withoutVerb } from './searchMatch.ts';
import { ObjectFinder } from './searchObjects.ts';
import { thumbnail } from './thumb.ts';

const MAX_ROWS = 12;
const WORTH_SHOWING = 0.3; // see the scale in searchMatch.ts
const PROPER = 0.6; // at or above: what was typed is in the name; below: a guess at what was meant
/** How many rows a heading may hold (others: 4). */
const ROOM: Record<string, number> = { Objects: 6, Types: 3 };

/** Shown while the field is empty: one of each kind of thing that can be typed. Choosing one types it. */
const EXAMPLES: [text: string, what: string][] = [
  ['telescope', 'a type'],
  ['hubble', 'an object'],
  ['go to tokyo', 'a place'],
  ['tomorrow 9 pm', 'a time'],
  ['100x', 'a speed'],
  ['colour by altitude', 'an action'],
];

/** A word for the right-hand side of an object's row. Kinds without one use their full label. */
const KIND_NOTE: Partial<Record<ModelKind, string>> = {
  starlink: 'Starlink', oneweb: 'OneWeb', comsat: 'Communications', geocomsat: 'Communications', gnss: 'Navigation',
  smallsat: 'Satellite', cubesat: 'CubeSat', observer: 'Earth imaging', radarsat: 'Radar imaging', weather: 'Weather',
  spinner: 'Weather', telescope: 'Telescope', iss: 'Space station', tiangong: 'Space station', station: 'Space station',
  dragon: 'Spacecraft', soyuz: 'Spacecraft', cygnus: 'Spacecraft', capsule: 'Spacecraft', rocketbody: 'Rocket stage', debris: 'Debris',
};

/** Small line icons for rows that have no picture, by heading (20 × 20, drawn like the tool rail's). */
const ICONS: Record<string, string> = {
  Types: '<path d="M3.5 5h13l-5 6v4.5l-3 1.5v-6z"/>',
  Places: '<path d="M10 17.5s5-4.6 5-8.6a5 5 0 0 0-10 0c0 4 5 8.6 5 8.6z"/><circle cx="10" cy="8.8" r="1.8"/>',
  Time: '<circle cx="10" cy="10" r="7"/><path d="M10 6v4.2l2.8 1.8"/>',
  Actions: '<path d="M7.5 5.5l5 4.5-5 4.5"/>',
  Try: '<path d="M4 6.5L7.5 10 4 13.5M10 13.5h6"/>',
  other: '<circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="1.6"/>',
};

interface Row {
  hit: SearchHit;
  /** An object of the catalogue: its row gets a picture. */
  sat?: Satellite;
  /** An example: choosing it types this into the field instead of doing anything. */
  fill?: string;
}

export class Search {
  private readonly input = $<HTMLInputElement>('search');
  private readonly list = $('suggestions');
  private readonly chip = $('search-filter');
  private readonly app: App;
  private readonly providers: SearchProvider[];
  private finder: ObjectFinder | null = null; // per catalogue
  private index: KeywordIndex | null = null; // per catalogue and its facts; built when first needed
  private rows: Row[] = [];
  private active = -1; // the highlighted row, -1 for none
  private filtered = false; // a type chosen here is hiding everything else

  /**
   * @param providers the live list behind `app.addSearch`: sources registered later are asked too.
   */
  constructor(app: App, providers: SearchProvider[]) {
    this.app = app;
    this.providers = providers;
    const { input, list } = this;

    input.addEventListener('input', () => this.update());
    input.addEventListener('focus', () => {
      input.select();
      this.update();
    });
    input.addEventListener('blur', () => this.close());
    input.addEventListener('keydown', (event) => {
      if (event.isComposing) return; // an input method is still putting a character together
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const n = this.rows.length;
        if (n > 0) this.setActive(this.active < 0 ? (event.key === 'ArrowDown' ? 0 : n - 1) : (this.active + (event.key === 'ArrowDown' ? 1 : n - 1)) % n);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (this.rows[this.active]) this.choose(this.rows[this.active]);
      } else if (event.key === 'Escape') {
        this.close();
        input.blur();
      }
    });
    // Some phone keyboards report their "Go" key only as a line break in the text, never as an
    // Enter key press. (On a real keyboard the key handler above runs first and cancels this.)
    input.addEventListener('beforeinput', (event) => {
      if (event.inputType !== 'insertLineBreak') return;
      event.preventDefault();
      if (this.rows[this.active]) this.choose(this.rows[this.active]);
    });

    // Pressing a row must not take the cursor out of the field (that would close the list
    // before the click arrives). The choice itself is the click, not the press: on a touch
    // screen a press is also how the list is scrolled.
    list.addEventListener('pointerdown', (event) => event.preventDefault());
    list.addEventListener('mousedown', (event) => event.preventDefault());
    list.addEventListener('click', (event) => {
      const row = this.rowAt(event.target);
      if (row >= 0) this.choose(this.rows[row]);
    });
    list.addEventListener('pointermove', (event) => {
      const row = this.rowAt(event.target);
      if (event.pointerType === 'mouse' && row >= 0 && row !== this.active) this.setActive(row, false);
    });

    // Ctrl+K (Cmd+K on a Mac), from anywhere: the capture phase runs before the app's own
    // shortcuts and before a focused field can swallow the key. Pressed again, it lets go.
    window.addEventListener('keydown', (event) => {
      // (String(): a browser filling in a saved form field sends a key event with no key at all.)
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || String(event.key).toLowerCase() !== 'k') return;
      if (!app.ready()) return; // the home page or the loading screen is in front
      event.preventDefault(); // the browser's own Ctrl+K (the address bar's search)
      event.stopImmediatePropagation();
      if (document.activeElement === input) input.blur();
      else this.focus();
    }, true);

    this.chip.addEventListener('click', () => this.showEverything());
    // On a phone the keyboard covers the lower half of the screen: keep the list above it.
    window.visualViewport?.addEventListener('resize', () => this.fit());

    app.onCatalog((catalog) => {
      // (A type filter stays as it is: it is kept by catalogue number, so it carries over to
      // a newer copy of the catalogue, such as the one a tab left open picks up by itself.)
      this.finder = new ObjectFinder(catalog);
      this.index = null;
    });
    app.onFacts(() => (this.index = null)); // owners have arrived: the next search files objects under them too
    app.onHome(() => this.showEverything());
    const catalog = app.catalog();
    if (catalog) this.finder = new ObjectFinder(catalog);
    // Build the keyword table in a quiet moment once the tracker is in front, so the first
    // search does not have to wait for it. (Typing sooner simply builds it then.)
    // (Checked every few seconds for the life of the page: the table is rebuilt after every new
    // catalogue. Not in the first seconds after the tracker comes to the front: that is the
    // opening camera flight, where a pause of a few frames would show.)
    let inFrontSince = 0;
    setInterval(() => {
      if (!app.ready()) return void (inFrontSince = 0);
      inFrontSince ||= performance.now();
      if (this.index || !app.catalog() || document.activeElement === input || performance.now() - inFrontSince < 10000) return;
      const build = () => void this.keywords();
      if ('requestIdleCallback' in window) window.requestIdleCallback(build, { timeout: 3000 });
      else build();
    }, 4000);
  }

  /** Put the cursor in the field, optionally with something already typed, and show what it finds. */
  focus(text?: string): void {
    if (text !== undefined) this.input.value = text;
    if (document.activeElement === this.input) this.update();
    else this.input.focus(); // the focus listener selects the text and draws the list
  }

  // ---------------------------------------------------------------- finding

  private keywords(): KeywordIndex | null {
    const catalog = this.app.catalog();
    if (!catalog) return null;
    return (this.index ??= buildKeywordIndex(catalog.sats, this.app.facts()));
  }

  private objectRow(sat: Satellite, score: number): Row {
    const kind = describe(sat).kind;
    return {
      sat,
      hit: { title: displayName(sat), note: `${KIND_NOTE[kind] ?? KIND_LABEL[kind]} · ${sat.noradId}`, group: 'Objects', score, run: () => this.app.select(sat) },
    };
  }

  /** Everything every source has for `query`, already cut down and in the order it is shown. */
  private collect(query: string, catalog: Catalog | null): Row[] {
    const typed = normalize(query);
    const { bare } = withoutVerb(typed); // "show telescopes" → "telescopes"
    let found: Row[] = [];

    if (catalog && this.finder) {
      let objects = this.finder.find(query, ROOM.Objects);
      if (objects.length === 0 && bare !== typed) objects = this.finder.find(bare, ROOM.Objects);
      found.push(...objects.map(({ sat, score }) => this.objectRow(sat, score)));

      const index = this.keywords();
      if (index) {
        const topics = findTopics(index, bare, ROOM.Types);
        for (const { topic, score } of topics) {
          found.push({ hit: { title: topic.label, note: `${fmtInt(topic.members.length)} objects`, group: 'Types', score, run: () => this.showOnly(topic.label, topic.members) } });
        }
        // A type was named ("telescope"): list the telescopes themselves under it, the well-known ones first.
        const best = topics[0];
        if (best && best.score >= 0.85) {
          const listed = new Set(objects.map((hit) => hit.sat.index));
          const members = best.topic.members.filter((i) => !listed.has(i)).map((i) => catalog.sats[i]);
          const known = (sat: Satellite) => Number(displayName(sat) !== sat.name);
          members.sort((a, b) => known(b) - known(a) || a.index - b.index);
          members.slice(0, Math.max(0, ROOM.Objects - listed.size)).forEach((sat, k) => found.push(this.objectRow(sat, PROPER - 0.001 * k)));
        }
        // Several describing words at once, unless they are simply the name of a type already offered.
        const described = !best || best.score < 0.9 ? findDescribed(index, bare) : null;
        if (described) {
          const label = bare.charAt(0).toUpperCase() + bare.slice(1);
          found.push({ hit: { title: label, note: `${fmtInt(described.members.length)} objects`, group: 'Types', score: 0.8, run: () => this.showOnly(label, described.members) } });
        }
      }
    }

    for (const provider of this.providers) {
      try {
        found.push(...provider(query.trim()).map((hit) => ({ hit })));
      } catch (error) {
        console.error('A search source failed', error); // one broken source must not empty the list
      }
    }

    found = found.filter((row) => row.hit.score >= WORTH_SHOWING);
    const best = Math.max(0, ...found.map((row) => row.hit.score));
    // Something fits properly: guesses at what was meant are a fallback, not padding for the list.
    if (best >= 0.9) found = found.filter((row) => row.hit.score >= PROPER - 0.01);
    // What was typed is a time ("-1d", "now"): do not also offer every name with "1D" in it.
    if (found.some((row) => row.hit.group === 'Time' && row.hit.score >= 0.95)) {
      found = found.filter((row) => row.hit.group !== 'Objects' || row.hit.score >= 0.9);
    }

    // One list: headings in order of their best row (so the first row is the best overall), rows best first.
    const groups = new Map<string, Row[]>();
    for (const row of found) {
      const rows = groups.get(row.hit.group);
      if (rows) rows.push(row);
      else groups.set(row.hit.group, [row]);
    }
    const ordered = [...groups.values()];
    for (const rows of ordered) rows.sort((a, b) => b.hit.score - a.hit.score); // stable: equals keep the order found
    ordered.sort((a, b) => b[0].hit.score - a[0].hit.score);
    const shown: Row[] = [];
    for (const rows of ordered) shown.push(...rows.slice(0, Math.min(ROOM[rows[0].hit.group] ?? 4, MAX_ROWS - shown.length)));
    return shown;
  }

  // ---------------------------------------------------------------- the list

  private rowAt(target: EventTarget | null): number {
    const item = target instanceof Element ? target.closest<HTMLElement>('li[data-row]') : null;
    return item ? Number(item.dataset.row) : -1;
  }

  private setActive(index: number, scroll = true): void {
    this.active = index;
    for (const item of this.list.querySelectorAll<HTMLElement>('li[data-row]')) {
      const on = Number(item.dataset.row) === index;
      item.classList.toggle('is-active', on);
      item.setAttribute('aria-selected', String(on));
      if (on && scroll) item.scrollIntoView({ block: 'nearest' });
    }
    if (index >= 0) this.input.setAttribute('aria-activedescendant', `sug-${index}`);
    else this.input.removeAttribute('aria-activedescendant');
  }

  /** Work out the rows for what is in the field now and draw them. */
  private update(): void {
    const query = this.input.value.trim();
    const examples = query === '';
    this.rows = examples
      ? EXAMPLES.map(([text, what]) => ({ fill: text, hit: { title: text, note: what, group: 'Try', score: 1, run: () => undefined } }))
      : this.collect(query, this.app.catalog());

    const items: HTMLElement[] = [];
    let heading = '';
    this.rows.forEach((row, index) => {
      if (row.hit.group !== heading) {
        heading = row.hit.group;
        const head = document.createElement('li');
        head.className = 'sug-head';
        head.setAttribute('role', 'presentation');
        head.textContent = heading;
        items.push(head);
      }
      const item = document.createElement('li');
      item.id = `sug-${index}`;
      item.dataset.row = String(index);
      item.setAttribute('role', 'option');
      if (row.sat) item.append(thumbnail(row.sat));
      else {
        const icon = document.createElement('span');
        icon.className = 'sug-icon';
        icon.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true">${ICONS[row.hit.group] ?? ICONS.other}</svg>`;
        item.append(icon);
      }
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = row.hit.title;
      item.append(name);
      if (row.hit.note) {
        const note = document.createElement('span');
        note.className = 'note';
        note.textContent = row.hit.note;
        item.append(note);
      }
      items.push(item);
    });
    if (this.rows.length === 0) {
      const none = document.createElement('li');
      none.className = 'empty';
      none.setAttribute('role', 'presentation');
      none.textContent = 'No match. Try a type such as “telescope” or “weather”, or a catalogue number.';
      items.push(none);
    }
    this.list.replaceChildren(...items);
    this.list.classList.toggle('is-examples', examples);
    this.list.classList.add('is-open');
    this.list.scrollTop = 0;
    this.input.setAttribute('aria-expanded', 'true');
    this.fit();
    // Something typed: Enter runs the top row. Only examples: nothing is chosen until the visitor chooses.
    this.setActive(examples || this.rows.length === 0 ? -1 : 0, false);
  }

  private close(): void {
    this.list.classList.remove('is-open');
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
    this.active = -1;
  }

  /** Keep the list inside what can be seen: the window, or on a phone the part above the keyboard. */
  private fit(): void {
    if (!this.list.classList.contains('is-open')) return;
    const view = window.visualViewport;
    const visible = (view?.height ?? window.innerHeight) + (view?.offsetTop ?? 0);
    const top = this.list.getBoundingClientRect().top;
    this.list.style.maxHeight = `${Math.round(Math.max(140, Math.min(560, visible - top - 10)))}px`;
  }

  private choose(row: Row): void {
    if (row.fill !== undefined) return this.focus(row.fill); // an example: type it, and show what it finds
    this.input.value = '';
    this.close();
    this.input.blur();
    try {
      row.hit.run();
    } catch (error) {
      console.error('A search row failed', error);
    }
  }

  // ---------------------------------------------------------------- showing only one type

  /** Hide everything except `members` (object indices of the current catalogue) and say so in the field. */
  private showOnly(label: string, members: number[]): void {
    const catalog = this.app.catalog();
    if (!catalog) return;
    // By catalogue number, in a Set, not by position in this catalogue: the filter then still
    // means the same objects after the catalogue has been replaced by a newer download.
    const keep = new Set(members.map((index) => catalog.sats[index].noradId));
    this.app.view('earth'); // deselects, and steps back to where the whole set can be seen
    this.app.setFilter('search', (sat) => keep.has(sat.noradId), { label, clear: () => this.showEverything() });
    this.filtered = true;
    this.chip.querySelector('span')!.textContent = label;
    this.chip.title = `Showing only ${label} (${fmtInt(members.length)} objects). Click to show everything again.`;
    this.chip.setAttribute('aria-label', this.chip.title);
    this.chip.classList.remove('is-hidden');
    this.input.style.paddingRight = `${this.chip.offsetWidth + 10}px`; // the text must not run under the chip
    this.input.parentElement!.classList.add('has-filter');
  }

  private showEverything(): void {
    if (!this.filtered) return;
    this.filtered = false;
    this.app.setFilter('search', null);
    this.chip.classList.add('is-hidden');
    this.input.style.paddingRight = '';
    this.input.parentElement!.classList.remove('has-filter');
  }
}
