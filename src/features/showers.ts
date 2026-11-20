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
 *
 * Choosing one shows the SHOWER (it used to only move the clock, leaving whatever satellite was
 * selected on screen, and the owner could not tell what it was showing): the selection is
 * cleared, the clock goes to the peak, the camera looks at the Earth from the side, and a stream
 * of meteors pours in from the radiant's real direction in the sky, burning up on the side of
 * the Earth that faces it, with a card in plain words. The direction is real; the number,
 * spacing and speed of the streaks are not to scale, and the card says so.
 */

import './beyond.css';
import * as THREE from 'three';
import { gstime } from 'satellite.js';
import { activeShowers, nextShowers, type ShowerTime } from '../space/showers.ts';
import type { App } from '../ui/app.ts';
import { $, fmtKmS, sectionNote } from '../ui/dom.ts';
import { clockStamp, duration } from '../ui/inspector.ts';

const DAY_MS = 86400000;
const R_KM = 6371;
const STREAKS = 150;
const UPSTREAM_KM = R_KM * 3.2; // where a streak starts, along the stream
const STREAK_KM = R_KM * 0.32; // its length
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
    pick.addEventListener('click', () => showStream(time));
    item.append(pick);
    rows.push({ time, when, sub, fig });
    return item;
  }

  // ---- the stream: streaks pouring onto the Earth from the radiant (in the inertial group, km)
  const positions = new Float32Array(STREAKS * 2 * 3);
  const colours = new Float32Array(STREAKS * 2 * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  lines.frustumCulled = false;
  lines.visible = false;
  lines.renderOrder = 22;
  app.eciGroup.add(lines);
  const axis = { w: new THREE.Vector3(), u: new THREE.Vector3(), v: new THREE.Vector3() };
  const streaks = Array.from({ length: STREAKS }, () => ({ a: 0, b: 0, s: Math.random(), rate: 0.25 + Math.random() * 0.25 }));
  const place = (k: number): void => {
    // Spread over the disc the Earth presents to the stream (a few just miss, as real ones do).
    const angle = Math.random() * 2 * Math.PI, radius = (R_KM + 60) * Math.sqrt(Math.random()) * 1.05;
    streaks[k].a = radius * Math.cos(angle);
    streaks[k].b = radius * Math.sin(angle);
  };
  streaks.forEach((_, k) => place(k));
  let shown: ShowerTime | null = null;
  const card = el('div', 'fb-card is-shower is-hidden');
  card.setAttribute('role', 'status');
  const cardText = el('div', 'fb-card-text');
  const close = el('button', 'fb-card-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', () => hideStream());
  card.append(cardText, close);
  document.body.append(card);

  function hideStream(): void {
    shown = null;
    lines.visible = false;
    card.classList.add('is-hidden');
  }

  function showStream(time: ShowerTime): void {
    const { shower } = time;
    app.select(null);
    app.jumpTo(time.peakMs);
    // The radiant's direction (equatorial, as the inertial group): the meteors travel the other way.
    const ra = (shower.raDeg * Math.PI) / 180, dec = (shower.decDeg * Math.PI) / 180;
    axis.w.set(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec));
    axis.u.set(-axis.w.y, axis.w.x, 0);
    if (axis.u.lengthSq() < 1e-6) axis.u.set(1, 0, 0);
    axis.u.normalize();
    axis.v.crossVectors(axis.w, axis.u);
    // Look at the Earth from the side of the stream, so the streaks cross the view: from the
    // ground point 70° from the one with the radiant overhead.
    const lon = ((shower.raDeg - (gstime(new Date(time.peakMs)) * 180) / Math.PI) % 360 + 540) % 360 - 180;
    app.flyToGround(Math.max(-80, Math.min(80, shower.decDeg > 0 ? shower.decDeg - 70 : shower.decDeg + 70)), lon, 28000);
    shown = time;
    lines.visible = true;
    cardText.replaceChildren(
      el('b', '', `${shower.name} · peak ${clockStamp(time.peakMs)}`),
      el('span', '', `The Earth is crossing the dust left by ${shower.parent}. The meteors arrive from the direction of ${shower.radiant} at ${fmtKmS(shower.speedKmS, 0)} and burn up high in the air: up to ${shower.rate} an hour at the peak, under a dark sky.`),
      el('small', '', 'The direction of the stream is real; the number, spacing and speed of the streaks are not to scale. The clock has moved to the peak.'),
    );
    card.classList.remove('is-hidden');
  }

  app.onFrame((frame) => {
    card.classList.toggle('is-away', app.away() || frame.uiHidden);
    if (!shown || !lines.visible) return;
    const dt = Math.min(0.1, frame.dt);
    const p = new THREE.Vector3();
    for (let k = 0; k < STREAKS; k++) {
      const streak = streaks[k];
      streak.s += dt * streak.rate;
      const rho2 = streak.a * streak.a + streak.b * streak.b;
      const hitZ = rho2 < (R_KM + 80) ** 2 ? Math.sqrt((R_KM + 80) ** 2 - rho2) : -UPSTREAM_KM; // where it meets the air, or passes by
      if (streak.s >= 1) {
        streak.s = 0;
        place(k);
      }
      const head = UPSTREAM_KM - (UPSTREAM_KM - hitZ) * streak.s * streak.s; // speeding up as it falls in
      const tail = Math.min(UPSTREAM_KM, head + STREAK_KM);
      const fade = Math.min(1, streak.s * 6) * (streak.s > 0.92 ? (1 - streak.s) / 0.08 : 1);
      p.copy(axis.u).multiplyScalar(streak.a).addScaledVector(axis.v, streak.b).addScaledVector(axis.w, tail);
      positions.set([p.x, p.y, p.z], k * 6);
      p.copy(axis.u).multiplyScalar(streak.a).addScaledVector(axis.v, streak.b).addScaledVector(axis.w, head);
      positions.set([p.x, p.y, p.z], k * 6 + 3);
      colours.set([0.1 * fade, 0.05 * fade, 0.12 * fade, 0.85 * fade, 0.9 * fade, 1 * fade], k * 6); // a faint tail, a bright head
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  });
  app.onHome(() => hideStream());

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
