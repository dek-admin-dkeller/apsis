/**
 * Bright passes visible from the ground station tonight (reserved element: #tonight-body in
 * the Objects panel).
 *
 * Nothing is computed until the visitor asks. Then the short list of objects that could be
 * bright enough (data/visibility.ts: pickCandidates) is handed to a worker
 * (worker/tonight.worker.ts), which looks through the next 24 hours for moments when an
 * object is sunlit, the place is dark and the object is well above the horizon. The best
 * dozen come back, brightest first; this file lists them in plain words
 * (features/tonightWords.ts) and lets the visitor jump to one.
 *
 * It is about where the visitor is, so pressing the button asks for their position first
 * (app.useMyLocation) unless the ground station is already theirs.
 *
 * On a phone the list is not in the Objects panel at all. It belongs to the full-screen sky
 * view, where the phone can be held up to the pass: a small faded button beside that view's
 * close button opens it as a sheet over the sky (the same elements, moved there and back).
 */

import type { Observer } from '../data/ephemeris.ts';
import { DEFAULT_SITE } from '../ui/settings.ts';
import { CATEGORY_COLORS } from '../data/types.ts';
import { DARK_SUN_DEG, pickCandidates } from '../data/visibility.ts';
import type { App } from '../ui/app.ts';
import { $, fmt, fmtInt } from '../ui/dom.ts';
import { clockStamp, duration } from '../ui/inspector.ts';
import type { TonightPass, TonightReply, TonightRequest } from '../worker/tonight.worker.ts';
import './tonight.css';
import { brightnessWords, lookHint, magnitudeText, pathRows } from './tonightWords.ts';

const HOURS = 24;
const SHOWN = 12; // "the best dozen"
const LEAD_MS = 30000; // a click puts the clock this long before the pass, so it can be watched arriving

/**
 * The ground station the app starts with. Kept in step by hand with DEFAULTS in
 * ui/settings.ts (which does not export it): while the place still equals this, it is the
 * app's example and not the visitor's own, and the panel says so.
 */
const BUILT_IN_PLACE: Observer = DEFAULT_SITE; // the example ground station from settings.ts

/** One finished search and what it was asked: enough to write its summary again in another clock setting. */
interface Search {
  place: Observer;
  startMs: number;
  candidates: number;
  catalogSize: number;
  hadSizes: boolean; // false = the radar sizes had not loaded, so only the stations and Hubble were checked
  reply: TonightReply;
}
type Stale = '' | 'place' | 'catalog' | 'clock';

const samePlace = (a: Observer, b: Observer): boolean => a.latDeg === b.latDeg && a.lonDeg === b.lonDeg;
const coordinates = (place: Observer): string =>
  `${fmt(Math.abs(place.latDeg), 1)}° ${place.latDeg >= 0 ? 'N' : 'S'}, ${fmt(Math.abs(place.lonDeg), 1)}° ${place.lonDeg >= 0 ? 'E' : 'W'}`;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

export function installTonight(app: App): void {
  const body = $('tonight-body');
  const section = body.closest('details');
  const placeNote = element('p', 'note');
  const run = element('button', 'btn btn-primary wide', 'Find bright passes');
  const bar = element('div', 'ahead-bar is-hidden'); // the monitor's thin progress bar (style.css)
  const fill = bar.appendChild(document.createElement('i'));
  const status = element('p', 'note tonight-status');
  const staleNote = element('p', 'note tonight-stale is-hidden');
  const list = element('ol', 'watch-list tonight-list');
  const foot = element('p', 'note is-hidden', 'Brightness is an estimate, good to about a magnitude. Times hold to a few seconds while the orbital data is fresh.');
  body.append(placeNote, run, bar, status, staleNote, list, foot);

  // Hash table keyed by NORAD id: an object's index changes whenever the catalogue is replaced, its
  // catalogue number never does, so a result row finds its name, colour and object in O(1) either way.
  const searched = new Map<number, { name: string; color: string }>();
  let worker: Worker | null = null;
  let pending: Omit<Search, 'reply'> | null = null; // the search in progress
  let result: Search | null = null;
  let stale: Stale = '';

  let declined = false; // the visitor was asked for their position and did not give it

  /** Say which place the passes are for — and, if it is not the visitor's, how to change that. */
  const describePlace = (): void => {
    const place = app.observer();
    const builtIn = samePlace(place, BUILT_IN_PLACE) && place.name === BUILT_IN_PLACE.name;
    placeNote.replaceChildren(
      'Seen from ',
      element('b', '', place.name || 'the ground station'),
      ` (${coordinates(place)}).`,
      ...(builtIn && declined ? [' ', element('span', 'tonight-default', 'Your location was not shared, so this is the example place. Set your own in Settings.')] : []),
    );
    placeNote.classList.toggle('is-hidden', builtIn && !declined); // nothing to say until a place is known
  };

  const stop = (message: string): void => {
    worker?.terminate();
    worker = null;
    pending = null;
    run.textContent = result ? 'Search again' : 'Find bright passes';
    run.classList.add('btn-primary');
    bar.classList.add('is-hidden');
    status.textContent = message;
  };

  let asking = false; // waiting for the browser's answer about the visitor's position

  const start = async (): Promise<void> => {
    if (asking) return;
    // The passes are for where the visitor is: ask for that first (the click on the button is the yes).
    asking = true;
    status.textContent = 'Finding where you are…';
    declined = !(await app.useMyLocation());
    asking = false;
    const catalog = app.catalog();
    if (!catalog) {
      status.textContent = 'The catalogue is still loading. Try again in a moment.';
      return;
    }
    const facts = app.facts();
    const candidates = pickCandidates(catalog.sats, facts);
    searched.clear();
    for (const { sat } of candidates) searched.set(sat.noradId, { name: sat.name, color: CATEGORY_COLORS[sat.category] });
    const place = { ...app.observer() };
    pending = { place, startMs: app.time(), candidates: candidates.length, catalogSize: catalog.sats.length, hadSizes: facts.size > 0 };
    result = null;
    stale = '';
    render();

    worker = new Worker(new URL('../worker/tonight.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<TonightReply>) => onReply(event.data);
    worker.onerror = () => stop('The search could not run in this browser.');
    const request: TonightRequest = {
      records: candidates.map((c) => c.sat.omm), standardMag: candidates.map((c) => c.standardMag),
      latDeg: place.latDeg, lonDeg: place.lonDeg, startMs: pending.startMs, hours: HOURS,
    };
    worker.postMessage(request);
    run.textContent = 'Stop';
    run.classList.remove('btn-primary');
    bar.classList.remove('is-hidden');
    fill.style.width = '0%';
    status.textContent = `Checking ${fmtInt(candidates.length)} large, low-flying objects…`;
  };

  const onReply = (reply: TonightReply): void => {
    fill.style.width = `${(reply.fraction * 100).toFixed(1)}%`;
    if (!reply.done) {
      status.textContent = `Checked ${fmtInt(reply.checked)} of ${fmtInt(pending?.candidates ?? reply.checked)} objects, ${fmtInt(reply.found)} passes so far…`;
      return;
    }
    const asked = pending;
    if (!asked) return;
    result = { ...asked, reply };
    stop('');
    render();
  };

  /** The note under the button: how many objects were checked, over which hours, and what came of it. */
  const summary = (search: Search): string => {
    const { reply } = search;
    const from = `the 24 hours from ${clockStamp(search.startMs)}`;
    if (reply.darkHours === 0) {
      return `It does not get dark at this place in ${from}: the Sun stays less than ${-DARK_SUN_DEG}° below the horizon, so no satellite can be seen.`;
    }
    const outcome = reply.passes.length === 0
      ? `No visible passes in ${from}. They come in spells of a few days: move the clock on a day and search again.`
      : reply.passes.length > SHOWN
        ? `The ${SHOWN} brightest of ${fmtInt(reply.passes.length)} passes in ${from}.`
        : `${reply.passes.length === 1 ? 'One pass' : `${reply.passes.length} passes`} in ${from}.`;
    return outcome + (search.hadSizes ? '' : ' The size data had not loaded, so only the space stations and Hubble were checked: search again in a moment.');
  };

  /** Select the object and put the clock just before the pass; with `fromGround`, stand at the place and look up. */
  const go = (pass: TonightPass, fromGround: boolean): void => {
    const sat = app.catalog()?.byNorad.get(pass.noradId); // the catalogue's own Map<noradId, Satellite>
    if (!sat) {
      app.toast('That object is not in the current data');
      return;
    }
    app.jumpTo(pass.startMs - LEAD_MS);
    app.select(sat);
    if (!fromGround) return;
    app.toggle('sky', true);
    if (app.speed() <= 0) app.setSpeed(1); // "watch" on a stopped or reversed clock would show nothing happening
    app.toast(`${sat.name} comes into view in ${duration(LEAD_MS)}: ${lookHint(pass)}`);
  };

  const row = (pass: TonightPass): HTMLLIElement => {
    const who = searched.get(pass.noradId);
    const li = document.createElement('li');
    const pick = element('button', 'watch-pick tonight-pick');
    pick.title = 'Select it and move the clock to just before it appears';
    const dot = element('i', 'dot');
    dot.style.color = who?.color ?? '';
    const text = element('span', 'tonight-text');
    const head = element('span', 'tonight-head');
    head.append(element('span', 'name', who?.name ?? `Object ${pass.noradId}`), element('span', 'alt', clockStamp(pass.startMs)));
    // Words first; the number is for those who know what a magnitude is. How long it stays in view sits on the right.
    const bright = element('span', 'tonight-bright');
    const words = element('span', '', `${brightnessWords(pass.magnitude)} `);
    words.append(element('small', '', `estimated magnitude ${magnitudeText(pass.magnitude)}`));
    const lasts = element('span', 'alt', duration(pass.endMs - pass.startMs));
    lasts.title = 'How long it stays in view';
    bright.append(words, lasts);
    const path = element('span', 'tonight-path');
    for (const step of pathRows(pass)) path.append(element('b', '', step.label), element('span', '', step.text));
    text.append(head, bright, path);
    pick.append(dot, text);
    // In the phone's sky view the visitor is already standing there looking up: go straight to watching.
    pick.addEventListener('click', () => {
      const inSky = !sheet.classList.contains('is-hidden');
      if (inSky) closeSheet();
      go(pass, inSky);
    });
    const watch = element('button', 'link tonight-watch', 'Watch from the ground');
    watch.title = 'Stand at the ground station just before it appears and look up';
    watch.addEventListener('click', () => go(pass, true));
    // A list made for another place would send the visitor to look at an empty sky.
    pick.disabled = watch.disabled = stale === 'place';
    li.append(pick, watch);
    return li;
  };

  /**
   * Draw the list, its summary and the out-of-date warning from the last search. Called again
   * whenever something they depend on changes (the clock setting, the place, the catalogue).
   */
  function render(): void {
    describePlace();
    const shown = result ? result.reply.passes.slice(0, SHOWN) : [];
    list.replaceChildren(...shown.map(row));
    list.classList.toggle('is-stale', stale !== '');
    foot.classList.toggle('is-hidden', shown.length === 0);
    if (result && !worker) status.textContent = summary(result);
    staleNote.classList.toggle('is-hidden', stale === '' || !result);
    if (result && stale) {
      staleNote.textContent = stale === 'place'
        ? `Out of date: this list was made for ${result.place.name || 'another place'} (${coordinates(result.place)}), and the ground station has changed since. Search again.`
        : stale === 'catalog'
          ? 'Out of date: the orbital data has been replaced since this list was made, so times may have shifted. Search again to be sure.'
          : `Out of date: the clock is now outside the 24 hours that were searched (from ${clockStamp(result.startMs)}). Search again from the new time.`;
    }
  }

  run.addEventListener('click', () => (worker ? stop('Search stopped.') : void start()));

  // ---- phones: the list lives in the full-screen sky view ---------------------------------
  const skyButton = element('button', 'tonight-sky-open is-hidden');
  skyButton.setAttribute('aria-label', 'Bright passes you can see tonight');
  skyButton.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M1.8 10s3-5.5 8.2-5.5S18.2 10 18.2 10s-3 5.5-8.2 5.5S1.8 10 1.8 10z"/><circle cx="10" cy="10" r="2.4"/></svg>';
  const sheet = element('div', 'tonight-sheet is-hidden');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Visible tonight');
  const sheetHead = element('div', 'tonight-sheet-head');
  const sheetClose = element('button', 'icon-btn', '×');
  sheetClose.setAttribute('aria-label', 'Close');
  sheetHead.append(element('h2', '', 'Visible tonight'), sheetClose);
  const sheetBody = element('div', 'tonight-sheet-body');
  sheet.append(sheetHead, sheetBody);
  document.body.append(skyButton, sheet);

  function openSheet(): void {
    sheetBody.append(body); // the same elements, moved over the sky
    sheet.classList.remove('is-hidden');
    if (!result && !worker) void start(); // nothing to show yet: look straight away
  }
  function closeSheet(): void {
    if (sheet.classList.contains('is-hidden')) return;
    sheet.classList.add('is-hidden');
    section?.append(body); // back where it lives on a larger screen
  }
  skyButton.addEventListener('click', () => (sheet.classList.contains('is-hidden') ? openSheet() : closeSheet()));
  sheetClose.addEventListener('click', closeSheet);
  app.onSkyView((open) => {
    skyButton.classList.toggle('is-hidden', !open);
    if (!open) closeSheet();
  });

  app.onSettings((_settings, changed) => {
    const place = changed === 'siteLat' || changed === 'siteLon' || changed === 'siteName';
    // Nothing here depends on the other settings (a slider being dragged calls this many times a second).
    if (!place && changed !== 'clockZone' && changed !== null) return;
    if (place) {
      const now = app.observer();
      if (worker && pending && !samePlace(pending.place, now)) stop('Stopped: the ground station changed.');
      if (result && !samePlace(result.place, now)) stale = 'place';
      else if (stale === 'place') stale = ''; // back at the place the list was made for
    }
    render(); // the place note, and every time shown, follow the settings (clock: UTC or local)
  });
  app.onCatalog((_next, previous) => {
    if (!previous) return; // the first catalogue of the session replaces nothing
    if (worker) stop('Stopped: the orbital data changed.');
    if (result && stale !== 'place') stale = 'catalog'; // "wrong place" is the more serious reason: keep it
    render();
  });
  app.onFacts(() => render());

  // Once a second, and only while the section is open: has the clock left the searched day (or come back)?
  // (Wall-clock seconds: frame.realSeconds counts at most 0.1 s per frame, so it crawls in a throttled tab.)
  let lastCheck = 0;
  app.onFrame((frame) => {
    const now = performance.now();
    if (frame.uiHidden || !result || !section?.open || now - lastCheck < 1000) return;
    lastCheck = now;
    if (stale === 'place' || stale === 'catalog') return;
    const outside = frame.timeMs < result.startMs - 2 * LEAD_MS || frame.timeMs > result.startMs + HOURS * 3.6e6;
    if (outside !== (stale === 'clock')) {
      stale = outside ? 'clock' : '';
      render();
    }
  });

  render();
  status.textContent = 'Satellites bright enough to see without a telescope in the next 24 hours, from where you are.';
}
