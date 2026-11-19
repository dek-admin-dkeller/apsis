/**
 * Meteor showers (reserved element: #showers-body in the Objects panel): which annual showers
 * are active now and which come next, with each one's peak, its usual best rate, the comet
 * that left the dust and the part of the sky it comes from. Choosing one moves the clock to
 * its peak.
 *
 * Everything is worked out here from a table of twelve showers (space/showers.ts): no data is
 * downloaded. "Now" is the SIMULATED clock, so moving the clock to August shows the Perseids
 * as active; the list is rebuilt only when the simulated day changes.
 *
 * The rate is the textbook one (dark sky, radiant overhead), so it is worded "up to".
 */

import './beyond.css';
import { activeShowers, nextShowers, type ShowerTime } from '../space/showers.ts';
import type { App } from '../ui/app.ts';
import { $, fmtKmS, sectionNote } from '../ui/dom.ts';
import { clockStamp, duration } from '../ui/inspector.ts';

const DAY_MS = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

/** "4–20 Dec" or "28 Dec – 12 Jan": the calendar dates the table gives, as they are. */
function datesText({ shower }: ShowerTime): string {
  const [m1, d1] = shower.start, [m2, d2] = shower.end;
  return m1 === m2 ? `${d1}–${d2} ${MONTHS[m1 - 1]}` : `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]}`;
}

/** Where the peak is from `now`: "peak in 3.2 days", "peak 5 h 10 min ago". */
function peakText(time: ShowerTime, now: number): string {
  const away = time.peakMs - now;
  if (Math.abs(away) < 12 * 3600000) return 'at its peak';
  return away > 0 ? `peak in ${duration(away)}` : `peaked ${duration(away)} ago`;
}

export function installShowers(app: App): void {
  const body = $('showers-body');
  if (!body) return;
  const box = el('div');
  body.append(box, el('p', 'note bx-credit', 'Rates are the best a watcher could count under a dark sky; expect a third to a half. Dates and radiants from the International Meteor Organization\'s list.'));

  let shownDay = NaN;
  let rows: { time: ShowerTime; when: HTMLElement; sub: HTMLElement; fig: HTMLElement }[] = [];

  const subText = (time: ShowerTime): string => `up to ${time.shower.rate} an hour · ${fmtKmS(time.shower.speedKmS, 0)} · from ${time.shower.parent}`;

  function row(time: ShowerTime, now: number, active: boolean): HTMLLIElement {
    const item = el('li');
    const pick = el('button', 'watch-pick bx-row');
    const fig = el('span', `bx-fig${active ? '' : ' is-quiet'}`, active ? peakText(time, now) : datesText(time));
    const sub = el('span', 'bx-sub', subText(time));
    const when = el('span', 'bx-when is-wide', `Peak ${clockStamp(time.peakMs)} · in ${time.shower.radiant}`);
    pick.append(el('span', 'bx-name', time.shower.name), fig, sub, when);
    pick.title = `Active ${datesText(time)}; the meteors seem to come from ${time.shower.radiant}. Click to move the clock to the peak.`;
    pick.addEventListener('click', () => {
      app.jumpTo(time.peakMs);
      app.toast(`Clock moved to the peak of the ${time.shower.name}`);
    });
    item.append(pick);
    rows.push({ time, when, sub, fig });
    return item;
  }

  function render(now: number): void {
    const active = activeShowers(now), next = nextShowers(now, 4);
    rows = [];
    const parts: HTMLElement[] = [];
    if (active.length > 0) {
      const list = el('ol', 'watch-list bx-list');
      list.append(...active.map((time) => row(time, now, true)));
      parts.push(el('div', 'bx-head', 'Active now'), list);
    } else {
      parts.push(el('p', 'note', 'No major shower is active at the moment.'));
    }
    const list = el('ol', 'watch-list bx-list');
    list.append(...next.map((time) => row(time, now, false)));
    parts.push(el('div', 'bx-head', 'Coming next'), list);
    box.replaceChildren(...parts);
    // The tile: how many are active, or how long until the next one starts.
    sectionNote(body, active.length > 0 ? `${active.length} now` : next[0] ? `in ${Math.max(1, Math.round((next[0].startMs - now) / DAY_MS))} d` : '');
  }

  app.onFrame((frame) => {
    // Only when the simulated day changes: the list does not move faster than that.
    const day = Math.floor(frame.timeMs / DAY_MS);
    if (day === shownDay) return;
    shownDay = day;
    render(frame.timeMs);
  });

  // Speeds and times are written in the chosen units and on the chosen clock.
  app.onSettings((_settings, changed) => {
    if (changed !== null && changed !== 'units' && changed !== 'clockZone') return;
    for (const entry of rows) {
      entry.when.textContent = `Peak ${clockStamp(entry.time.peakMs)} · in ${entry.time.shower.radiant}`;
      entry.sub.textContent = subText(entry.time);
    }
  });
}
