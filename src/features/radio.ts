/**
 * Radio details and "last heard" for the selected object.
 *
 *   #insp-heard  (inspector, Live tab)    a small card: when a volunteer ground station last
 *                                         received this object, and what is known about its radio
 *   #insp-radio  (inspector, Passes tab)  the transmitters it carries, and the Doppler shift of
 *                                         one of them as heard at the ground station right now
 *
 * Nobody can "ping" a satellite. What exists in public is SatNOGS, a volunteer network whose
 * stations record passes and whose members mark each recording good or bad. A copy of its
 * records is baked into public/data/radio.json at build time (scripts/fetch-radio.mjs,
 * unpacked by data/radio.ts); this file only reads that copy and never calls SatNOGS.
 *
 * The wording is careful on purpose. The copy covers only the newest few hours of reports, so
 * an object without one was "not picked up in the N hours before the records were collected",
 * which is a different thing from being silent: stations listen only to what somebody
 * scheduled. The Doppler figures are geometry (data/doppler.ts) and are shown even while the
 * object is below the horizon, with a sentence saying that nothing can be received then.
 *
 * Everything outside this file is reached through the App interface (ui/app.ts).
 */

import './radio.css';
import type { SatRec } from 'satellite.js';
import { dopplerShiftHz, rangeRate, rateOverPass } from '../data/doppler.ts';
import { findPasses, makeSatrec, type Observer, type Pass } from '../data/ephemeris.ts';
import { loadRadio, megahertz, type RadioData, type RadioRecord, type Transmitter } from '../data/radio.ts';
import { regionName } from '../data/regions.ts';
import type { Satellite } from '../data/types.ts';
import type { App, FrameInfo } from '../ui/app.ts';
import { $, fmt, fmtInt, fmtKmS } from '../ui/dom.ts';
import { clockStamp, duration } from '../ui/inspector.ts';

const SHORT_LIST = 4; // transmitters shown before "Show all" (the ISS has fifty)
const DOPPLER_EVERY_S = 0.2; // the readout changes by a few hertz per frame: five times a second is plenty
const AGO_EVERY_S = 20; // "2 h 13 min ago" only needs to tick over now and then
const STALE_AFTER_MS = 12 * 3.6e6; // older records get a sentence saying so
const LEAD_IN_MS = 25 * 60000; // start the pass search this far back, so a pass under way is found whole

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

const coordinates = (lat: number, lon: number): string =>
  `${fmt(Math.abs(lat), 2)}° ${lat >= 0 ? 'N' : 'S'}, ${fmt(Math.abs(lon), 2)}° ${lon >= 0 ? 'E' : 'W'}`;

/** "+9.61 kHz" / "−9.61 kHz" (a real minus sign, so the two line up). */
const kilohertz = (hz: number): string => `${hz < 0 ? '−' : '+'}${fmt(Math.abs(hz) / 1000, 2)} kHz`;

/** One line of facts about a transmitter: "437.800 MHz · FM · 9,600 baud · uplink 145.990 MHz · Amateur". */
function detail(tx: Transmitter): string {
  const parts: string[] = [];
  if (tx.downlinkHz && tx.downlinkHighHz) parts.push(`${megahertz(tx.downlinkHz).replace(' MHz', '')} – ${megahertz(tx.downlinkHighHz)}`);
  else if (tx.downlinkHz) parts.push(megahertz(tx.downlinkHz));
  if (tx.mode) parts.push(tx.mode);
  if (tx.baud) parts.push(`${fmtInt(tx.baud)} baud`);
  if (tx.uplinkHz) parts.push(`uplink ${megahertz(tx.uplinkHz)}`);
  if (tx.service) parts.push(tx.service);
  return parts.length > 0 ? parts.join(' · ') : 'Frequency not listed';
}

/** What SatNOGS says about the satellite and its transmitters, as one plain sentence. */
function statusSentence(record: RadioRecord): string {
  const total = record.transmitters.length;
  const active = record.transmitters.filter((tx) => tx.active).length;
  if (record.status === 're-entered') return 'SatNOGS lists it as re-entered, yet it is still in this catalogue: one of the two records is out of date.';
  if (record.status === 'future') return 'SatNOGS lists it as not launched yet.';
  if (record.status === 'dead') return 'SatNOGS lists it as no longer working.';
  if (total === 0) return 'SatNOGS knows the satellite but lists no transmitters for it.';
  if (active === 0) return total === 1 ? 'Its one listed transmitter is marked inactive.' : `None of its ${total} listed transmitters is marked active.`;
  if (total === 1) return 'Its one listed transmitter is marked active.';
  return `${active === total ? `All ${total}` : `${active} of its ${total}`} listed transmitters are marked active.`;
}

class RadioCards {
  private readonly app: App;
  private readonly heardBox = $('insp-heard');
  private readonly radioBox = $('insp-radio');
  private data: RadioData | null = null;
  private loaded = false; // the file has been tried (it may still be missing)
  private sat: Satellite | null = null;
  private record: RadioRecord | null = null;
  private satrec: SatRec | null = null;

  // Live tab
  private agoText: HTMLElement | null = null; // the "2 h 13 min ago" inside the card, refreshed in place
  private lastAgo = -Infinity;
  private heardVisible = false;

  // Passes tab
  private chosen = -1; // which transmitter the Doppler readout follows (index into record.transmitters)
  private showAll = false;
  private radioVisible = false;
  private lastDoppler = -Infinity;
  private shiftText: HTMLElement | null = null;
  private receivedText: HTMLElement | null = null;
  private dopplerNote: HTMLElement | null = null;
  private pass: Pass | null = null; // the pass under way or the next one, for "over the next pass"
  private passRate: { minKmS: number; maxKmS: number } | null = null;
  private passAt = NaN; // simulated time the pass was looked up for
  private passSite = ''; // … and for which ground station

  constructor(app: App) {
    this.app = app;
    // Per-frame work is skipped unless its card is really on screen: the right tab is open AND
    // the card is scrolled into view. The browser reports both through one observer.
    if ('IntersectionObserver' in window) {
      const watch = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === this.heardBox) this.heardVisible = entry.isIntersecting;
          else this.radioVisible = entry.isIntersecting;
        }
        // Just came into view: bring it up to date now, not a frame (or, in a background tab, a second) later.
        this.lastAgo = this.lastDoppler = -Infinity;
        if (this.radioVisible) this.updateDoppler(this.app.time());
      });
      watch.observe(this.heardBox);
      watch.observe(this.radioBox);
    } else {
      this.heardVisible = this.radioVisible = true; // very old browser: always update (still throttled)
    }
  }

  setData(data: RadioData | null): void {
    this.data = data;
    this.loaded = true;
    this.select(this.sat);
  }

  select(sat: Satellite | null): void {
    this.sat = sat;
    this.record = sat ? this.data?.byId.get(sat.noradId) ?? null : null;
    this.satrec = sat && this.record ? makeSatrec(sat) : null;
    // Follow the transmitter that was actually received last; failing that the first active
    // downlink; failing that any downlink at all.
    const list = this.record?.transmitters ?? [];
    const heardOn = this.record?.heard?.transmitter ?? -1;
    this.chosen = list[heardOn]?.downlinkHz ? heardOn : list.findIndex((tx) => tx.active && tx.downlinkHz);
    if (this.chosen < 0) this.chosen = list.findIndex((tx) => tx.downlinkHz);
    this.showAll = false;
    this.passAt = NaN;
    this.redraw();
  }

  /** Units, clock or ground station changed: the same facts, written again. */
  redraw(): void {
    this.renderHeard();
    this.renderRadio();
  }

  frame(info: FrameInfo): void {
    if (info.uiHidden || !this.sat) return;
    if (this.heardVisible && this.agoText && info.realSeconds - this.lastAgo > AGO_EVERY_S) {
      this.lastAgo = info.realSeconds;
      const heard = this.record?.heard;
      // Measured against the real clock, not the simulated one: a reception happened in the world.
      if (heard) this.agoText.textContent = `${duration(Date.now() - heard.timeMs)} ago`;
    }
    if (this.radioVisible && this.shiftText && info.realSeconds - this.lastDoppler > DOPPLER_EVERY_S) {
      this.lastDoppler = info.realSeconds;
      this.updateDoppler(info.timeMs);
    }
  }

  // ---------------------------------------------------------------- Live tab: last heard

  private renderHeard(): void {
    this.agoText = null;
    const sat = this.sat;
    if (!sat || !this.loaded) return void this.heardBox.replaceChildren();
    if (!this.data) {
      return void this.heardBox.replaceChildren(el('p', 'note radio-quiet', 'Radio records are not bundled; run “npm run fetch-radio” once to add them.'));
    }
    const record = this.record;
    if (!record) {
      const type = this.app.facts().get(sat.noradId)?.type;
      const inert = sat.category === 'Debris' || type === 'DEB' || type === 'R/B';
      return void this.heardBox.replaceChildren(el('p', 'note radio-quiet', inert
        ? 'No radio on record. Most debris and rocket bodies carry none.'
        : 'No radio on record: SatNOGS, the volunteer network these records come from, does not list this object. That says nothing about whether it works.'));
    }

    const data = this.data;
    const card = el('section', 'radio-card');
    const head = el('div', 'radio-head');
    head.append(el('span', '', 'Radio'), el('span', record.heard ? 'radio-state is-ok' : 'radio-state', record.heard ? 'heard' : 'not heard lately'));
    card.append(head);

    const collected = clockStamp(data.madeMs);
    if (record.heard) {
      const heard = record.heard;
      const main = el('p', 'radio-main');
      this.agoText = el('b', '', `${duration(Date.now() - heard.timeMs)} ago`);
      main.append('Last heard ', this.agoText, ' by ', el('b', '', heard.station || 'a station without a name'));
      const where = el('p', 'note');
      where.append(heard.latDeg !== null && heard.lonDeg !== null
        ? `A volunteer station at ${coordinates(heard.latDeg, heard.lonDeg)}${place(heard.latDeg, heard.lonDeg)}, on ${clockStamp(heard.timeMs)}. `
        : `A volunteer station, on ${clockStamp(heard.timeMs)}. `);
      const tuned = record.transmitters[heard.transmitter];
      if (tuned?.downlinkHz) where.append(`It was tuned to ${megahertz(tuned.downlinkHz)}${tuned.description ? ` (${tuned.description})` : ''}. `);
      card.append(main, where);
    } else {
      // Whole hours, rounded DOWN: claiming a shorter stretch than was really checked is always true.
      const hours = (data.madeMs - data.heardFromMs) / 3.6e6;
      const stretch = hours >= 2 ? `${Math.floor(hours)} hours` : duration(hours * 3.6e6);
      card.append(
        el('p', 'radio-main', `Not picked up by the volunteer network in the ${stretch} before ${collected}`),
        el('p', 'note', 'That is as far back as these records look. Stations listen only to what somebody has scheduled, so this is not a sign that it has stopped working.'),
      );
    }

    card.append(el('p', 'note', statusSentence(record)));
    if (record.filedAs) {
      card.append(el('p', 'note', `SatNOGS has not confirmed which tracked object is which: it files these records under “${record.filedAs}” and listens along this object’s orbit.`));
    }
    const age = Date.now() - data.madeMs;
    card.append(el('p', 'note radio-credit', `From SatNOGS, a volunteer ground-station network (CC BY-SA). Collected ${collected}`
      + (age > STALE_AFTER_MS && record.heard ? `, ${duration(age)} ago, so it may well have been heard since.` : '.')));
    // The evidence, one tap away: the recording itself and the satellite's page.
    const links = el('p', 'radio-links');
    if (record.heard && record.heard.observationId > 0) links.append(link(`https://network.satnogs.org/observations/${record.heard.observationId}/`, 'Reception report'));
    links.append(link(`https://db.satnogs.org/satellite/${record.satnogsId}/`, 'Its page on SatNOGS'));
    card.append(links);
    this.heardBox.replaceChildren(card);
  }

  // ---------------------------------------------------------------- Passes tab: transmitters and Doppler

  private renderRadio(): void {
    this.shiftText = this.receivedText = this.dopplerNote = null;
    this.lastDoppler = -Infinity;
    const record = this.record;
    if (!this.sat || !record || record.transmitters.length === 0) return void this.radioBox.replaceChildren();
    const list = record.transmitters;

    const title = el('p', 'field-label', 'Transmitters listed by SatNOGS');
    const rows = el('ul', 'radio-list');
    list.forEach((tx, i) => {
      // Collapsed: the first few, plus the one being followed if it sits further down.
      if (!this.showAll && i >= SHORT_LIST && i !== this.chosen) return;
      const li = el('li', i === this.chosen ? 'is-on' : '');
      // Only a downlink can be heard on the ground, so only those can be picked for the readout.
      const row = tx.downlinkHz ? el('button', 'radio-tx') : el('div', 'radio-tx');
      if (row instanceof HTMLButtonElement) {
        row.type = 'button';
        row.setAttribute('aria-pressed', String(i === this.chosen));
        row.title = 'Show the Doppler shift of this transmitter';
        row.addEventListener('click', () => {
          this.chosen = i;
          this.renderRadio();
        });
      }
      const state = tx.active ? 'active' : 'inactive';
      row.append(
        el('span', 'name', tx.description || 'Unnamed transmitter'),
        el('span', tx.active ? 'state is-ok' : 'state', tx.unconfirmed ? `${state}, unconfirmed` : state),
        el('span', 'detail', detail(tx)),
      );
      li.append(row);
      rows.append(li);
    });
    const parts: HTMLElement[] = [title, rows];

    if (list.length > SHORT_LIST + (this.chosen >= SHORT_LIST ? 1 : 0)) {
      const more = el('button', 'link radio-more', this.showAll ? 'Show fewer' : `Show all ${list.length}`);
      more.type = 'button';
      more.addEventListener('click', () => {
        this.showAll = !this.showAll;
        this.renderRadio();
      });
      parts.push(more);
    }

    const tx = list[this.chosen];
    if (tx?.downlinkHz) {
      const observer = this.app.observer();
      const edge = tx.downlinkHighHz ? ' (the lower edge of its band)' : '';
      parts.push(el('p', 'field-label', `Doppler shift on ${megahertz(tx.downlinkHz)}${edge}, heard at ${observer.name || 'the ground station'}`));
      const readout = el('dl', 'telemetry radio-doppler');
      const cell = (label: string): HTMLElement => {
        const box = el('div');
        const value = el('dd', '', '–');
        box.append(el('dt', '', label), value);
        readout.append(box);
        return value;
      };
      this.shiftText = cell('Shift now');
      this.receivedText = cell('Received frequency');
      this.dopplerNote = el('p', 'note radio-doppler-note');
      parts.push(readout, this.dopplerNote);
    }
    this.radioBox.replaceChildren(...parts);
    if (this.radioVisible) this.updateDoppler(this.app.time()); // no flash of dashes after picking another transmitter
  }

  /** The pass under way or the next one, looked up again only when the old answer has gone stale. */
  private nextPass(simTime: number, observer: Observer): Pass | null {
    if (!this.satrec) return null;
    const site = `${observer.latDeg},${observer.lonDeg}`;
    const stale = Number.isNaN(this.passAt) || site !== this.passSite || simTime < this.passAt - 1000
      || simTime - this.passAt > 6 * 3.6e6 || (this.pass !== null && simTime > this.pass.endMs);
    if (stale) {
      this.passAt = simTime;
      this.passSite = site;
      this.pass = findPasses(this.satrec, observer, simTime - LEAD_IN_MS, 48, 2).find((pass) => pass.endMs > simTime) ?? null;
      this.passRate = this.pass ? rateOverPass(this.satrec, observer, this.pass) : null;
    }
    return this.pass;
  }

  private updateDoppler(simTime: number): void {
    const tx = this.record?.transmitters[this.chosen];
    if (!this.satrec || !tx?.downlinkHz || !this.shiftText || !this.receivedText || !this.dopplerNote) return;
    const observer = this.app.observer();
    const now = rangeRate(this.satrec, simTime, observer);
    if (!now) {
      this.shiftText.textContent = this.receivedText.textContent = '–';
      this.dopplerNote.textContent = 'The orbit model gives no position for this moment.';
      return;
    }
    const shift = dopplerShiftHz(tx.downlinkHz, now.rateKmS);
    const up = now.look.elDeg > 0;
    this.shiftText.textContent = kilohertz(shift);
    this.receivedText.textContent = megahertz(tx.downlinkHz + shift, 4);
    this.shiftText.classList.toggle('is-dim', !up);
    this.receivedText.classList.toggle('is-dim', !up);

    const name = observer.name || 'the ground station';
    const speed = fmtKmS(Math.abs(now.rateKmS));
    const motion = Math.abs(now.rateKmS) < 0.005 ? 'Keeping its distance' : now.rateKmS < 0 ? `Coming closer at ${speed}` : `Moving away at ${speed}`;
    let text = up
      ? `${motion}, ${fmt(now.look.elDeg, 0)}° above the horizon of ${name}.`
      : `Below the horizon of ${name} right now, so nothing can be received there; the figures show what the geometry alone would give.`;

    const pass = this.nextPass(simTime, observer);
    if (pass && this.passRate) {
      const high = kilohertz(dopplerShiftHz(tx.downlinkHz, this.passRate.minKmS)); // fastest approach = highest pitch
      const low = kilohertz(dopplerShiftHz(tx.downlinkHz, this.passRate.maxKmS));
      text += pass.startMs <= simTime
        ? ` Over this pass the shift slides from ${high} to ${low}.`
        : ` Over the next pass, in ${duration(pass.startMs - simTime)}, it slides from ${high} to ${low}.`;
    }
    this.dopplerNote.textContent = text;
  }
}

/** " (Europe)" for a station's position, or nothing where the rough place names have no answer. */
function place(lat: number, lon: number): string {
  const name = regionName(lat, lon);
  return name === 'Land' || name === 'Open ocean' ? '' : ` (${name})`;
}

function link(href: string, text: string): HTMLAnchorElement {
  const a = el('a', '', text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

export function installRadio(app: App): void {
  const cards = new RadioCards(app);
  app.onSelect((sat) => cards.select(sat));
  app.onFrame((frame) => cards.frame(frame));
  // The quiet line for an object without a record depends on what kind of object it is.
  app.onFacts(() => cards.redraw());
  app.onSettings((_settings, changed) => {
    if (changed === null || changed === 'units' || changed === 'clockZone' || changed.startsWith('site')) cards.redraw();
  });
  void loadRadio().then((data) => cards.setData(data));
  cards.select(app.selected());
}
