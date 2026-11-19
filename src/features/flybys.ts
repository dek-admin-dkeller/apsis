/**
 * Asteroid fly-bys (reserved element: #flybys-body in the Objects panel): the rocks passing
 * the Earth in the coming weeks, nearest in time first: when, how far away, how big and how
 * fast. Choosing one moves the clock to its closest approach.
 *
 * The list is in public/data/deep.json (space/deep.ts), downloaded from JPL's Center for Near
 * Earth Object Studies when the site is built: every asteroid coming within 0.05 AU (7.5
 * million km) from a week ago to two months ahead. Nothing is asked of anybody from here.
 *
 * Two things to keep honest:
 *   - Nobody has measured most of these rocks. Their size is estimated from how bright they
 *     are, and a dark rock and a shiny one of the same brightness differ about twofold in
 *     width: hence a range, never one number.
 *   - These are real events, so "coming" is judged by the real clock, not the simulated one
 *     (otherwise choosing a fly-by, which moves the clock, would reshuffle the list).
 */

import './beyond.css';
import { loadDeep } from '../space/deep.ts';
import type { Flyby } from '../space/types.ts';
import type { App } from '../ui/app.ts';
import { $, fmt, fmtCompact, fmtInt, fmtKmS, fmtRange, lengthUnit, lengthValue, sectionNote } from '../ui/dom.ts';
import { clockStamp } from '../ui/inspector.ts';

const DAY_MS = 86400000;
/** A pass stays on the list (dimmed, marked "passed") for this long afterwards, then drops off. */
const LINGER_MS = 6 * 3600000;
/** The Moon's mean distance: the yardstick everyone uses for a near miss. */
const MOON_KM = 384400;
const ROWS = 30;
/** What the download asked for: everything passing within 0.05 AU. */
const LISTED_WITHIN_KM = 7.5e6;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

/** "12–27 m" (or feet, or km): the two ends share their unit when they can. */
function sizeText(flyby: Flyby): string {
  const [low, high] = flyby.sizeM;
  if (!(high > 0)) return 'size not known';
  const a = fmtRange(low / 1000), b = fmtRange(high / 1000);
  const unitA = a.slice(a.lastIndexOf(' ')), unitB = b.slice(b.lastIndexOf(' '));
  return unitA === unitB ? `${a.slice(0, a.lastIndexOf(' '))}–${b}` : `${a} – ${b}`;
}

/** How many times the Moon's distance: one decimal, two below a tenth. */
const moons = (km: number): string => fmt(km / MOON_KM, km / MOON_KM < 0.1 ? 2 : 1);

export function installFlybys(app: App): void {
  const body = $('flybys-body');
  if (!body) return;
  let flybys: Flyby[] = [];
  let listBox: HTMLOListElement | null = null;
  let note: HTMLElement | null = null;

  // Three significant figures in whichever unit is shown: the nominal distance is not known
  // better than that weeks ahead.
  const far = (km: number): string => `${fmtInt(Number(lengthValue(km).toPrecision(3)))} ${lengthUnit()}`;
  const missText = (f: Flyby): string => `${far(f.distanceKm)} · ${moons(f.distanceKm)}× Moon`;
  const subText = (f: Flyby): string => `${sizeText(f)} across · ${fmtKmS(f.speedKmS, 1)}`;

  function render(): void {
    if (!listBox || !note) return;
    const now = Date.now();
    const shown = flybys.filter((f) => f.timeMs > now - LINGER_MS).slice(0, ROWS);
    listBox.replaceChildren(...shown.map((flyby) => {
      const item = el('li');
      item.classList.toggle('is-past', flyby.timeMs < now);
      const pick = el('button', 'watch-pick bx-row');
      const when = el('span', 'bx-when', clockStamp(flyby.timeMs));
      const miss = el('span', 'bx-fig', missText(flyby));
      const sub = el('span', 'bx-sub', subText(flyby));
      pick.append(el('span', 'bx-name', flyby.name), el('span', 'bx-fig is-quiet', flyby.timeMs < now ? 'passed' : ''), sub, when, miss);
      pick.title = `${flyby.name} passes ${far(flyby.distanceKm)} from the Earth's centre, ${moons(flyby.distanceKm)} times the Moon's distance. Click to move the clock to that moment.`;
      pick.addEventListener('click', () => {
        // The closest few have a real path: go and watch the pass. For the rest, the moment of it.
        if (app.showFlyby(flyby.name)) return;
        app.jumpTo(flyby.timeMs);
        app.toast(`Clock moved to the closest approach of ${flyby.name}`);
      });
      item.append(pick);
      return item;
    }));
    const month = flybys.filter((f) => f.timeMs > now && f.timeMs < now + 30 * DAY_MS).length;
    sectionNote(body, month > 0 ? String(month) : '');
    note.textContent = shown.length > 0
      ? `${month} in the next 30 days come within ${fmtCompact(lengthValue(LISTED_WITHIN_KM))} ${lengthUnit()}. Sizes are estimates from brightness.`
      : 'No close fly-bys are listed for the coming weeks.';
  }

  void loadDeep().then((deep) => {
    if (!deep || deep.flybys.length === 0) {
      body.append(el('p', 'note', 'The fly-by list did not come with this copy of the site.'));
      return;
    }
    flybys = [...deep.flybys].sort((a, b) => a.timeMs - b.timeMs);
    note = el('p', 'note');
    listBox = el('ol', 'watch-list bx-list');
    const credit = el('p', 'note bx-credit');
    const link = el('a', '', 'NASA / JPL Center for Near Earth Object Studies');
    link.href = 'https://cneos.jpl.nasa.gov/ca/';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    credit.append('Close-approach data: ', link, `, read ${clockStamp(Date.parse(deep.fetchedAt))}.`);
    body.append(note, listBox, credit);
    render();
    // The list is about the real present: bring it up to date whenever the section is opened.
    body.closest('details')?.addEventListener('toggle', render);
  });

  // Distances, speeds and times are written in the chosen units and on the chosen clock.
  app.onSettings((_settings, changed) => {
    if (changed === 'units' || changed === 'clockZone') render();
  });
}
