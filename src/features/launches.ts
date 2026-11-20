/**
 * Upcoming launches (reserved element: #launches-body in the Objects panel): what is going
 * up next, who is launching it and from where, with a countdown, and the pads marked on the
 * globe. Clicking a launch flies to its pad.
 *
 * The list comes from Launch Library 2 (data/launches.ts), a free service that allows only a
 * few requests an hour. So nothing is asked until the section is opened, the answer is kept
 * for an hour, and a failed request falls back to the saved list with its age.
 *
 * Honest about timing: a launch time is "no earlier than", and the service says how exactly
 * it is known. The countdown ticks in seconds only for times known to the minute; a time
 * known to the hour or the day gets "in about …" instead, and a launch on hold gets none.
 * The countdown runs on the real clock, not the simulated one: these are real events.
 *
 * The pads (render/padMarkers.ts, one draw call) are shown only while this section is on
 * screen, and the pad of the launch under the pointer, or the one last clicked, is emphasised.
 */

import './launches.css';
import { loadLaunches, type Launch, type LaunchList, type LaunchProblem } from '../data/launches.ts';
import { PadMarkers } from '../render/padMarkers.ts';
import { canWatch, watchLaunch } from './ascent.ts';
import { rocketKind, type ModelKind } from '../data/describe.ts';
import { modelThumbnail } from '../render/satModels.ts';
import type { App } from '../ui/app.ts';
import { $ } from '../ui/dom.ts';
import { clockStamp, duration } from '../ui/inspector.ts';

const FLY_TO_ALTITUDE_KM = 1500; // high enough to see the coastline round the pad
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HOUR_MS = 3600000, DAY_MS = 86400000;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};
const two = (n: number): string => String(n).padStart(2, '0');

/** The launch time, written no more exactly than it is known. */
function whenText(launch: Launch): string {
  if (launch.precision === 'exact') return clockStamp(launch.netMs);
  if (launch.precision === 'hour') return `≈ ${clockStamp(launch.netMs)}`;
  // Known only to the day (or less): the service's midnight UTC is a placeholder, so show the
  // published date itself rather than a clock time shifted into another zone.
  const date = new Date(launch.netMs);
  if (launch.precision === 'day') return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}, time not set`;
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} at the earliest`;
}

/** "1 h 49 m", "3 d 4 h", "12 m": a span in at most two short units (the row's right column is narrow). */
function shortSpan(ms: number): string {
  const m = Math.max(0, Math.round(Math.abs(ms) / 60000));
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} m`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/**
 * Time to go (or since), short, and no more exactly than the launch time is known: "T−12:43:40",
 * "T+1 h 49 m", "≈ 14 h". (It once said "lifted off 1 h 49 min ago" and squeezed the row's other
 * lines into a column of single words.)
 */
function countdownText(launch: Launch, nowMs: number): string {
  const left = launch.netMs - nowMs;
  if (launch.state === 'flying') return left < 0 ? `T+${shortSpan(left)}` : '';
  if (launch.state === 'done' || launch.state === 'failed') return left < 0 ? `${shortSpan(left)} ago` : '';
  if (launch.state === 'hold') return 'on hold';
  if (launch.precision === 'vague') return '';
  if (left <= 0) return 'due'; // the list is up to an hour old; the service will say what happened
  if (launch.precision === 'day') return left < 1.5 * DAY_MS ? '≈ 1 day' : `≈ ${Math.round(left / DAY_MS)} days`;
  if (launch.precision === 'hour') {
    if (left < 1.5 * HOUR_MS) return '≈ 1 h';
    return left < 48 * HOUR_MS ? `≈ ${Math.round(left / HOUR_MS)} h` : `≈ ${Math.round(left / DAY_MS)} days`;
  }
  const s = Math.floor(left / 1000);
  const days = Math.floor(s / 86400), hours = Math.floor((s % 86400) / 3600), minutes = Math.floor((s % 3600) / 60);
  return `T−${days > 0 ? `${days} d ` : ''}${two(hours)}:${two(minutes)}:${two(s % 60)}`;
}

interface Row {
  launch: Launch;
  item: HTMLLIElement;
  when: HTMLElement;
  count: HTMLElement;
  pad: number; // index into the pad markers, −1 when the pad has no position
}

export function installLaunches(app: App): void {
  const body = $('launches-body');
  if (!body) return;
  const section = body.closest('details');
  const panel = body.closest('.panel');

  const note = el('p', 'note');
  const listBox = el('ol', 'watch-list launch-list');
  const credit = el('p', 'note launch-credit');
  body.append(note, listBox, credit);

  let list: LaunchList | null = null;
  let problem: LaunchProblem = '';
  let asking = false;
  let rows: Row[] = [];
  let pickedId = ''; // the launch last clicked
  let markers: PadMarkers | null = null; // made when there is first something to mark
  let showing = false;
  let lastSecond = -1;

  const pickedPad = (): number => rows.find((row) => row.launch.id === pickedId)?.pad ?? -1;

  /**
   * Each row's rocket, drawn with the same models as the launch climbs (render/rocketModels.ts):
   * one picture per idle moment, and each kind only once (modelThumbnail keeps them), so opening
   * the list never stalls a frame.
   */
  function drawRockets(): void {
    const waiting = [...listBox.querySelectorAll<HTMLImageElement>('img.launch-rocket:not([src])')];
    const next = (): void => {
      const image = waiting.shift();
      if (!image) return;
      try {
        const url = modelThumbnail(image.dataset.kind as ModelKind);
        if (url) image.src = url;
      } catch { /* a model that cannot be drawn: the row simply has no picture */ }
      if (typeof requestIdleCallback === 'function') requestIdleCallback(next, { timeout: 800 });
      else setTimeout(next, 60);
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(next, { timeout: 800 });
    else setTimeout(next, 60);
  }

  function renderRows(): void {
    const now = Date.now();
    // A saved list can be old: leave out what happened more than a day ago.
    const launches = (list?.launches ?? []).filter((launch) => launch.netMs > now - DAY_MS);

    // One marker per pad: several launches often share one.
    const padIndex = new Map<string, number>(); // "lat,lon" → marker index
    const pads: { latDeg: number; lonDeg: number }[] = [];
    rows = launches.map((launch) => {
      let pad = -1;
      if (launch.latDeg !== null && launch.lonDeg !== null) {
        const key = `${launch.latDeg.toFixed(3)},${launch.lonDeg.toFixed(3)}`;
        pad = padIndex.get(key) ?? -1;
        if (pad < 0) {
          pad = pads.push({ latDeg: launch.latDeg, lonDeg: launch.lonDeg }) - 1;
          padIndex.set(key, pad);
        }
      }

      const item = el('li');
      const pick = el('button', 'watch-pick launch-pick');
      const status = el('span', `launch-status is-${launch.state}`, launch.status);
      // Four short lines: the mission and its status; the rocket and who flies it; where from; when.
      const who = el('span', 'launch-who', [launch.rocket, launch.provider].filter(Boolean).join(' · '));
      const where = el('span', 'launch-where', launch.place || launch.pad);
      where.title = [launch.pad, launch.place].filter(Boolean).join(', ');
      const when = el('span', 'launch-when', whenText(launch));
      const count = el('span', 'launch-count', countdownText(launch, now));
      pick.append(el('span', 'launch-name', launch.mission), status, who, where, when, count);
      // The rocket itself, as a small picture (drawn in an idle moment: see drawRockets).
      const thumb = el('img', 'launch-rocket') as HTMLImageElement;
      thumb.alt = '';
      thumb.dataset.kind = rocketKind(`${launch.rocket} ${launch.family}`);
      pick.prepend(thumb);
      pick.title = [launch.mission, launch.pad && launch.place ? `${launch.pad}, ${launch.place}` : launch.pad || launch.place, pad >= 0 ? 'Click to fly to the pad.' : '']
        .filter(Boolean).join('. ').replace(/\.\./g, '.');
      pick.addEventListener('click', () => {
        pickedId = launch.id;
        for (const row of rows) row.item.classList.toggle('is-on', row.launch.id === pickedId);
        markers?.emphasise(pad);
        if (launch.latDeg !== null && launch.lonDeg !== null) app.flyToGround(launch.latDeg, launch.lonDeg, FLY_TO_ALTITUDE_KM);
        else app.toast('No pad position is listed for this launch.');
      });
      // Pointing at (or tabbing to) a launch shows where it is; moving away goes back to the one clicked.
      const point = (): void => markers?.emphasise(pad);
      const unpoint = (): void => markers?.emphasise(pickedPad());
      item.addEventListener('pointerenter', point);
      item.addEventListener('pointerleave', unpoint);
      pick.addEventListener('focus', point);
      pick.addEventListener('blur', unpoint);
      item.classList.toggle('is-on', launch.id === pickedId);
      item.append(pick);
      // Every launch whose pad and minute are known can be watched climbing (an estimated path;
      // features/ascent.ts): live, or ahead of time / again by moving the clock to lift-off.
      const actions = el('div', 'launch-acts');
      if (canWatch(launch)) {
        const climb = el('button', 'launch-climb', launch.state === 'flying' ? 'Watch it climb' : launch.netMs < now ? 'Replay the climb' : 'Preview the climb');
        if (launch.state === 'flying') climb.classList.add('is-live');
        climb.type = 'button';
        climb.title = 'An estimated path from the pad to orbit, on the globe';
        climb.addEventListener('click', () => watchLaunch(launch));
        actions.append(climb);
      }
      // Where this comes from, and where to read more: the launch's page for readers (Space Launch
      // Now, The Space Devs' own site for the Launch Library data shown here).
      if (launch.pageUrl) {
        const more = el('a', 'launch-more', 'Launch page ↗');
        more.href = launch.pageUrl;
        more.target = '_blank';
        more.rel = 'noopener noreferrer';
        more.title = 'This launch on Space Launch Now (The Space Devs), the source of this list: mission, rocket, pad, status and updates';
        actions.append(more);
      }
      if (actions.childElementCount > 0) item.append(actions);
      return { launch, item, when, count, pad };
    });
    listBox.replaceChildren(...rows.map((row) => row.item));
    drawRockets();

    if (pads.length > 0) markers ??= new PadMarkers(app.earth);
    markers?.set(pads);
    markers?.emphasise(pickedPad());
    markers?.setVisible(showing && pads.length > 0);
  }

  function renderNotes(): void {
    const stamp = list ? `${clockStamp(list.at)} (${duration(Date.now() - list.at)} ago)` : '';
    if (asking && !list) note.textContent = 'Asking for the launch list…';
    else if (problem === 'limited') {
      note.textContent = 'The launch service allows only a few requests an hour and has asked us to wait. '
        + (list ? `This list was read ${stamp}.` : 'Open this section again in a while.');
    } else if (problem === 'unreachable') {
      note.textContent = `The launch service could not be reached. ${list ? `This list was read ${stamp}.` : 'Open this section again in a while.'}`;
    } else if (list && rows.length === 0) note.textContent = 'No launches are listed for the coming days.';
    else note.textContent = list ? 'Times are “no earlier than” and often slip. Click a launch to fly to its pad.' : '';

    credit.replaceChildren();
    if (list) {
      const link = el('a', '', 'Launch Library 2 by The Space Devs');
      link.href = 'https://thespacedevs.com/llapi';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      credit.append('Launch data: ', link, problem ? '.' : `, read ${clockStamp(list.at)}.`, ' Each launch page is on their Space Launch Now site.');
    }
  }

  const render = (): void => {
    renderRows();
    renderNotes();
  };

  /** Ask for the list (data/launches.ts decides whether that means a request or the saved copy). */
  function refresh(): void {
    if (asking) return;
    asking = true;
    renderNotes();
    void loadLaunches().then((result) => {
      asking = false;
      const changed = result.list?.at !== list?.at || result.problem !== problem;
      list = result.list ?? list;
      problem = result.problem;
      if (changed) render();
      else renderNotes();
    });
  }

  // Nothing is requested until somebody opens the section.
  section?.addEventListener('toggle', () => {
    if (section.open) refresh();
  });

  app.onFrame((frame) => {
    // "On screen" = the section is open, its panel is open, and the interface is not hidden.
    const now = !!section?.open && !panel?.classList.contains('is-hidden') && !frame.uiHidden;
    if (now !== showing) {
      showing = now;
      markers?.setVisible(showing && rows.some((row) => row.pad >= 0));
      lastSecond = -1;
      if (showing) refresh(); // coming back to it after an hour gets a newer list
    }
    if (!showing) return;
    markers?.update(frame.realSeconds);
    // The countdown: once a second, and only the text that actually changed.
    const second = Math.floor(Date.now() / 1000);
    if (second === lastSecond) return;
    lastSecond = second;
    for (const row of rows) {
      const text = countdownText(row.launch, second * 1000);
      if (row.count.textContent !== text) row.count.textContent = text;
    }
  });

  // Launch times are written on the chosen clock.
  app.onSettings((_settings, changed) => {
    if (changed !== 'clockZone') return;
    for (const row of rows) row.when.textContent = whenText(row.launch);
    renderNotes();
  });
}
