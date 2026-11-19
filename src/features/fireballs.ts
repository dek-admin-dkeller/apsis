/**
 * Fireballs (reserved element: #fireballs-body in the Objects panel): the brightest meteors
 * of recent months, where each exploded and with what energy, as a list and as marks on the
 * globe. Choosing one flies to the place.
 *
 * A fireball here is a rock, typically a metre or a few across, that burned up in the
 * atmosphere brightly enough for US Government sensors to record it from orbit; JPL publishes
 * the time, the place, the height and the total energy (in kilotons of TNT: the Chelyabinsk
 * meteor of 2013 was about 440). The list is in public/data/deep.json (space/deep.ts), read
 * from JPL when the site is built; nothing is asked of anybody from here. The reports are
 * published weeks after the event, so the newest entry is rarely from this month.
 *
 * The marks reuse the launch-pad marker (render/padMarkers.ts: one draw call, children of the
 * turning Earth). They are shown only while this section is on screen, and since the Activity
 * sections open one at a time they never share the globe with the pads.
 */

import './beyond.css';
import { regionName } from '../data/regions.ts';
import { PadMarkers } from '../render/padMarkers.ts';
import { loadDeep } from '../space/deep.ts';
import type { Fireball } from '../space/types.ts';
import type { App } from '../ui/app.ts';
import { $, fmt, fmtKm, fmtKmS, sectionNote } from '../ui/dom.ts';
import { clockStamp } from '../ui/inspector.ts';

const YEAR_MS = 365 * 86400000;
const FLY_TO_ALTITUDE_KM = 2500;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

/** Energy in kilotons of TNT: two figures for the small ones ("0.18 kt"), whole numbers above ten. */
const energyText = (kt: number): string => `${fmt(kt, kt >= 10 ? 0 : kt >= 1 ? 1 : 2)} kt`;

/** "18 Nov 2026 21:03 UTC": these go back a year or more, so the year is part of the date. */
function whenText(ms: number): string {
  const stamp = clockStamp(ms); // "18 Nov 21:03 UTC"
  const year = new Date(ms).getUTCFullYear();
  return year === new Date().getUTCFullYear() ? stamp : stamp.replace(/^(\d+ \w+)/, `$1 ${year}`);
}

export function installFireballs(app: App): void {
  const body = $('fireballs-body');
  if (!body) return;
  const section = body.closest('details');
  const panel = body.closest('.panel');

  let balls: Fireball[] = [];
  let rows: { ball: Fireball; item: HTMLLIElement; when: HTMLElement; sub: HTMLElement }[] = [];
  let markers: PadMarkers | null = null; // made the first time the section is on screen
  let picked = -1;
  let showing = false;

  const subText = (ball: Fireball): string => [
    regionName(ball.latDeg, ball.lonDeg),
    ball.altitudeKm !== null ? `${fmtKm(ball.altitudeKm)} up` : '',
    ball.speedKmS !== null ? fmtKmS(ball.speedKmS, 1) : '',
  ].filter(Boolean).join(' · ');

  function render(listBox: HTMLOListElement): void {
    rows = balls.map((ball, index) => {
      const item = el('li');
      const pick = el('button', 'watch-pick bx-row');
      const when = el('span', 'bx-name', whenText(ball.timeMs));
      const sub = el('span', 'bx-sub', subText(ball));
      pick.append(when, el('span', 'bx-fig', energyText(ball.energyKt)), sub);
      pick.title = `About ${energyText(ball.energyKt)} of TNT. Click to fly to where it happened.`;
      pick.addEventListener('click', () => {
        picked = index;
        for (const row of rows) row.item.classList.toggle('is-on', row.ball === ball);
        markers?.emphasise(index);
        app.flyToGround(ball.latDeg, ball.lonDeg, FLY_TO_ALTITUDE_KM);
      });
      // Pointing at (or tabbing to) one shows where it was; moving away goes back to the one chosen.
      const point = (): void => markers?.emphasise(index);
      const unpoint = (): void => markers?.emphasise(picked);
      item.addEventListener('pointerenter', point);
      item.addEventListener('pointerleave', unpoint);
      pick.addEventListener('focus', point);
      pick.addEventListener('blur', unpoint);
      item.append(pick);
      return { ball, item, when, sub };
    });
    listBox.replaceChildren(...rows.map((row) => row.item));
  }

  void loadDeep().then((deep) => {
    if (!deep || deep.fireballs.length === 0) {
      body.append(el('p', 'note', 'The fireball list did not come with this copy of the site.'));
      return;
    }
    balls = deep.fireballs;
    const recent = balls.filter((ball) => ball.timeMs > Date.now() - YEAR_MS).length;
    const note = el('p', 'note', `${recent} recorded in the last twelve months; the energy is in kilotons of TNT. Click one to fly there.`);
    const listBox = el('ol', 'watch-list bx-list');
    const credit = el('p', 'note bx-credit');
    const link = el('a', '', 'NASA / JPL fireball data');
    link.href = 'https://cneos.jpl.nasa.gov/fireballs/';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    credit.append('From US Government sensors: ', link, `, read ${clockStamp(Date.parse(deep.fetchedAt))}.`);
    body.append(note, listBox, credit);
    render(listBox);
    sectionNote(body, recent > 0 ? String(recent) : '');
  });

  app.onFrame((frame) => {
    // "On screen" = the section is open, its panel is open, and the interface is not hidden.
    const now = balls.length > 0 && !!section?.open && !panel?.classList.contains('is-hidden') && !frame.uiHidden;
    if (now !== showing) {
      showing = now;
      if (showing && !markers) {
        markers = new PadMarkers(app.earth);
        markers.set(balls);
        markers.emphasise(picked);
      }
      markers?.setVisible(showing);
    }
    if (showing) markers?.update(frame.realSeconds);
  });

  // Heights, speeds and times are written in the chosen units and on the chosen clock.
  app.onSettings((_settings, changed) => {
    if (changed !== null && changed !== 'units' && changed !== 'clockZone') return;
    for (const row of rows) {
      row.when.textContent = whenText(row.ball.timeMs);
      row.sub.textContent = subText(row.ball);
    }
  });
}
