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
 * Choosing one shows the EVENT, not just a place (the owner: "when I click one I don't really
 * know what I'm looking at"): the camera comes to the spot, a glowing streak comes down through
 * the air along the direction it arrived from (JPL's velocity components, when published; else
 * straight down, and the card says so) to the height where it burst, the burst flashes
 * (render/impactFlash.ts, as the designer's collisions), and a card says in plain words what it
 * was: when, where, how high, how fast, the energy, and the size of rock that energy implies
 * (an estimate: stony density, the published speed).
 *
 * The marks reuse the launch-pad marker (render/padMarkers.ts: one draw call, children of the
 * turning Earth). They are shown only while this section is on screen, and since the Activity
 * sections open one at a time they never share the globe with the pads.
 */

import './beyond.css';
import * as THREE from 'three';
import { ImpactFlash } from '../render/impactFlash.ts';
import { regionName } from '../data/regions.ts';
import { PadMarkers } from '../render/padMarkers.ts';
import { loadDeep, onDeepRefresh } from '../space/deep.ts';
import type { Fireball } from '../space/types.ts';
import type { App } from '../ui/app.ts';
import { $, fmt, fmtKm, fmtKmS, sectionNote } from '../ui/dom.ts';
import { clockStamp } from '../ui/inspector.ts';

const YEAR_MS = 365 * 86400000;
const FLY_TO_ALTITUDE_KM = 300; // the camera: this high, SIDE_DEG of latitude (~330 km) from the fireball
const SIDE_DEG = 3;
const R_KM = 6371;
const ENTRY_KM = 110; // where a meteor starts to glow
const STREAK_S = 1.3; // the streak's fall, real seconds

/** The size of rock the energy and speed imply: E = ½ m v², a stony density of 3,000 kg/m³. */
function sizeM(ball: Fireball): number {
  const v = (ball.speedKmS ?? 18) * 1000; // 18 km/s: a typical entry speed, when none is published
  const mass = (2 * ball.energyKt * 4.184e12) / (v * v);
  return Math.cbrt((6 * mass) / (Math.PI * 3000));
}

/** A point at latitude, longitude and height, in the turning Earth's own frame (scene units). */
function groundPoint(latDeg: number, lonDeg: number, heightKm: number): THREE.Vector3 {
  const lat = (latDeg * Math.PI) / 180, lon = (lonDeg * Math.PI) / 180, r = (R_KM + heightKm) / 1000;
  return new THREE.Vector3(r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), -r * Math.cos(lat) * Math.sin(lon));
}

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

  // ---- the event: streak, burst, card
  const streakGeometry = new THREE.BufferGeometry();
  streakGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2 * 3), 3));
  streakGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array([1, 0.55, 0.2, 1, 0.95, 0.8]), 3));
  const streak = new THREE.Line(streakGeometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
  streak.visible = false;
  streak.frustumCulled = false;
  streak.renderOrder = 25;
  app.earth.add(streak);
  const flash = new ImpactFlash(app.earth, 0.001, 0.3);
  let event: { from: THREE.Vector3; to: THREE.Vector3; startedAt: number; flashed: boolean } | null = null;
  const card = el('div', 'fb-card is-hidden');
  card.setAttribute('role', 'status');
  const cardText = el('div', 'fb-card-text');
  const close = el('button', 'fb-card-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', () => endEvent());
  card.append(cardText, close);
  document.body.append(card);

  function endEvent(): void {
    event = null;
    streak.visible = false;
    card.classList.add('is-hidden');
  }

  function playEvent(ball: Fireball): void {
    const burstKm = ball.altitudeKm ?? 30;
    const to = groundPoint(ball.latDeg, ball.lonDeg, burstKm);
    // Where it came from: back along its velocity to the height where it began to glow, or straight down.
    let from: THREE.Vector3;
    if (ball.velocity) {
      const [vx, vy, vz] = ball.velocity;
      const back = new THREE.Vector3(-vx, -vz, vy).normalize(); // Earth-fixed (x, y, z north) → the Earth's frame (x, z, −y)
      const up = to.clone().normalize();
      const climb = Math.max(0.15, back.dot(up)); // how steeply the path rises, going back along it
      from = to.clone().addScaledVector(back, ((ENTRY_KM - burstKm) / climb) / 1000);
    } else {
      from = groundPoint(ball.latDeg, ball.lonDeg, ENTRY_KM);
    }
    event = { from, to, startedAt: performance.now() / 1000, flashed: false };
    streak.visible = true;
    const size = sizeM(ball);
    const tonnes = ball.energyKt * 1000;
    cardText.replaceChildren(
      el('b', '', `${whenText(ball.timeMs)} · ${regionName(ball.latDeg, ball.lonDeg)}`),
      el('span', '', `A rock about ${size < 1 ? fmt(size, 1) : fmt(size, 0)} m across hit the atmosphere${ball.speedKmS !== null ? ` at ${fmtKmS(ball.speedKmS, 1)}` : ''} and exploded ${ball.altitudeKm !== null ? `${fmtKm(ball.altitudeKm)} up` : 'high in the air'}, with the energy of ${tonnes >= 1000 ? `${fmt(tonnes / 1000, 1)} kilotons` : `${fmt(tonnes, 0)} tonnes`} of TNT.`),
      el('small', '', `Size estimated from the energy${ball.speedKmS !== null ? ' and speed' : ''}. ${ball.velocity ? 'The streak follows the direction it came from.' : 'Its direction was not published: the streak is drawn straight down.'} Data: NASA / JPL from US Government sensors.`),
    );
    card.classList.remove('is-hidden');
  }

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
        // From the side, not straight above (seen end-on, a vertical streak would vanish), and
        // looking AT the burst: looking straight down from beside it put the event off the picture.
        app.flyToGround(ball.latDeg + (ball.latDeg > 60 ? -SIDE_DEG : SIDE_DEG), ball.lonDeg, FLY_TO_ALTITUDE_KM,
          { latDeg: ball.latDeg, lonDeg: ball.lonDeg, altitudeKm: ((ball.altitudeKm ?? 30) + ENTRY_KM) / 2 });
        window.setTimeout(() => playEvent(ball), 1800); // once the camera has arrived
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
    const note = el('p', 'note');
    const listBox = el('ol', 'watch-list bx-list');
    const credit = el('p', 'note bx-credit');
    const link = el('a', '', 'NASA / JPL fireball data');
    link.href = 'https://cneos.jpl.nasa.gov/fireballs/';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const read = document.createTextNode('');
    credit.append('From US Government sensors: ', link, read);
    body.append(note, listBox, credit);
    /** Draw the list for one copy of the data: the first, and any newer one the site publishes while this tab is open. */
    const show = (data: { fireballs: typeof balls; fetchedAt: string }): void => {
      balls = data.fireballs;
      picked = -1;
      const recent = balls.filter((ball) => ball.timeMs > Date.now() - YEAR_MS).length;
      note.textContent = `${recent} recorded in the last twelve months; the energy is in kilotons of TNT. Click one to fly there.`;
      read.data = `, read ${clockStamp(Date.parse(data.fetchedAt))}.`;
      render(listBox);
      markers?.set(balls);
      markers?.emphasise(picked);
      sectionNote(body, recent > 0 ? String(recent) : '');
    };
    show(deep);
    onDeepRefresh((newer) => {
      if (newer.fireballs.length > 0) show(newer);
    });
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
    // The streak grows down to the burst, the burst flashes, then the streak fades.
    if (event) {
      const t = performance.now() / 1000 - event.startedAt;
      const k = Math.min(1, t / STREAK_S);
      const head = event.from.clone().lerp(event.to, k * k); // speeding up as it falls
      const tail = event.from.clone().lerp(event.to, Math.max(0, k * k - 0.35));
      const position = streakGeometry.getAttribute('position') as THREE.BufferAttribute;
      position.setXYZ(0, tail.x, tail.y, tail.z);
      position.setXYZ(1, head.x, head.y, head.z);
      position.needsUpdate = true;
      (streak.material as THREE.LineBasicMaterial).opacity = t < STREAK_S ? 0.95 : Math.max(0, 0.95 - (t - STREAK_S) * 0.6);
      if (k >= 1 && !event.flashed) {
        event.flashed = true;
        flash.start(event.to);
      }
      const world = app.earth.localToWorld(event.to.clone());
      flash.update(app.camera.position.distanceTo(world) * 1000);
      if (t > STREAK_S + 2) streak.visible = false;
    }
    card.classList.toggle('is-away', app.away() || frame.uiHidden);
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
