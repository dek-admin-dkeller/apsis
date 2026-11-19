/**
 * The Deep Space Network, live (reserved element: #dsn-body in the Objects panel): which of
 * NASA's big dishes is talking to which spacecraft at this moment, site by site, with the
 * distance to the craft and how long a signal takes to get there and back.
 *
 * The data is NASA's own "DSN Now" feed (space/dsn.ts), read straight from the browser. To
 * be polite it is read once shortly after the page starts, so the tile can say how many
 * spacecraft are in contact, and then once a minute ONLY while this section is on screen.
 *
 * Rows are not buttons: a dish is not something to fly to. The arrows say which way a signal
 * is going at the moment (up = commands to the craft, down = data from it); neither lit means
 * the dish is pointed at the craft and waiting.
 */

import './beyond.css';
import { dsnStatus, watchDsn } from '../space/dsn.ts';
import type { DsnLink } from '../space/types.ts';
import type { App } from '../ui/app.ts';
import { $, fmtCompact, fmtKm, lengthUnit, lengthValue, sectionNote } from '../ui/dom.ts';
import { clockStamp, duration } from '../ui/inspector.ts';

const SITES: DsnLink['site'][] = ['Goldstone', 'Madrid', 'Canberra'];
const WHERE: Record<DsnLink['site'], string> = { Goldstone: 'California', Madrid: 'Spain', Canberra: 'Australia' };
/** A figure on the tile is only true for a while: after this long without a read it is taken away. */
const STALE_MS = 10 * 60000;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

/** A distance that may be anything from the Moon's to Voyager's: "386,000 km", "191.0 M km", "25.37 B km". */
const rangeText = (km: number): string => (lengthValue(km) < 1e6 ? fmtKm(km) : `${fmtCompact(lengthValue(km))} ${lengthUnit()}`);

export function installDsn(app: App): void {
  const body = $('dsn-body');
  if (!body) return;
  const section = body.closest('details');
  const panel = body.closest('.panel');

  const note = el('p', 'note', 'Asking the network…');
  const box = el('div');
  const credit = el('p', 'note bx-credit');
  const link = el('a', '', 'NASA Deep Space Network Now');
  link.href = 'https://eyes.nasa.gov/dsn/dsn.html';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  credit.append('Live from ', link, '.');
  body.append(note, box, credit);

  let links: DsnLink[] = [];

  function render(): void {
    const { readAt, failed } = dsnStatus();
    const inContact = new Set(links.filter((l) => l.up || l.down).map((l) => l.craft)).size;
    sectionNote(body, readAt > 0 && Date.now() - readAt < STALE_MS ? String(inContact) : '');
    if (readAt === 0) {
      note.textContent = failed ? 'The network\'s live feed could not be reached. It is tried again each minute while this is open.' : 'Asking the network…';
      box.replaceChildren();
      return;
    }
    note.textContent = `${inContact} spacecraft in contact at ${clockStamp(readAt)}${failed ? ' (the feed has not answered since)' : ''}. ↑ commands going up, ↓ data coming down.`;
    const parts: HTMLElement[] = [];
    for (const site of SITES) {
      const here = links.filter((l) => l.site === site);
      if (here.length === 0) continue;
      const list = el('ol', 'watch-list bx-list');
      list.append(...here.map((l) => {
        const item = el('li');
        const row = el('div', 'bx-row');
        const arrows = el('span', 'bx-arrows');
        arrows.append(el('span', l.up ? 'is-live' : '', '↑'), el('span', l.down ? 'is-live' : '', '↓'));
        arrows.title = l.up && l.down ? 'Signals in both directions' : l.up ? 'Sending to the spacecraft' : l.down ? 'Receiving from the spacecraft' : 'Pointed at the spacecraft; no signal at the moment';
        const far = [
          l.rangeKm !== null ? rangeText(l.rangeKm) : '',
          l.roundTripS !== null ? `${duration(l.roundTripS * 1000)} there and back` : '',
        ].filter(Boolean).join(' · ');
        row.append(el('span', 'bx-name', l.name), arrows, el('span', 'bx-sub', [l.dish, far].filter(Boolean).join(' · ')));
        item.append(row);
        return item;
      }));
      parts.push(el('div', 'bx-head', `${site}, ${WHERE[site]}`), list);
    }
    if (parts.length === 0) parts.push(el('p', 'note', 'No dish is pointed at a spacecraft at the moment.'));
    box.replaceChildren(...parts);
  }

  const heard = (next: DsnLink[]): void => {
    links = next;
    render();
  };

  // One read soon after the start, for the tile; then nothing until the section is opened.
  let stop: (() => void) | null = null;
  window.setTimeout(() => {
    if (stop) return; // already open and being watched
    const once = watchDsn((next) => {
      once(); // one answer is all this asked for
      heard(next);
    });
  }, 4000);

  let watching = false;
  let lastCheck = 0;
  app.onFrame((frame) => {
    // "On screen" = the section is open, its panel is open, and the interface is not hidden.
    const now = !!section?.open && !panel?.classList.contains('is-hidden') && !frame.uiHidden;
    if (now !== watching) {
      watching = now;
      if (watching) stop = watchDsn(heard);
      else {
        stop?.();
        stop = null;
      }
    }
    // Once a minute while nobody is looking: drop a figure that has gone stale.
    if (!watching && frame.realSeconds - lastCheck > 60) {
      lastCheck = frame.realSeconds;
      if (dsnStatus().readAt > 0 && Date.now() - dsnStatus().readAt >= STALE_MS) sectionNote(body, '');
    }
  });

  // Distances and the time of the reading follow the chosen units and clock.
  app.onSettings((_settings, changed) => {
    if (changed === 'units' || changed === 'clockZone') render();
  });
}
