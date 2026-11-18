/**
 * "Design a satellite": dial in an orbit, launch it into the live catalogue, and ask what
 * it would pass close to over the next day.
 *
 * The orbit is described the way the real catalogue describes every object — one OMM
 * record of orbital elements — so the made-up satellite is propagated, drawn, inspected and
 * screened by exactly the same code as the 19,000 real ones. The 24-hour check is the
 * look-ahead scan (hashing/lookahead.ts) in its "focus" mode: everything is still hashed
 * every simulated minute, but only the 27 cells around this one object are searched.
 */

import './designer.css';
import { CATEGORY_COLORS, type OmmRecord, type Satellite } from '../data/types.ts';
import type { FutureApproach } from '../hashing/lookahead.ts';
import type { LookaheadReply, LookaheadRequest } from '../worker/lookahead.worker.ts';
import { fmt, fmtInt } from './dom.ts';
import { duration } from './inspector.ts';

export interface DesignerHost {
  /** Put this record into the live catalogue (replacing any previous custom one) and select it. Returns its Satellite, or null if the catalogue is not loaded. */
  launch(record: OmmRecord): Satellite | null;
  /** Remove the custom object from the catalogue. */
  remove(): void;
  /** Everything a look-ahead scan needs, taken at the current simulation time; null if not ready. */
  context(): { records: OmmRecord[]; sats: Satellite[]; mask: Uint8Array; startMs: number } | null;
  /** Jump to a predicted pass and open the close-approach view on it. */
  openApproach(a: number, b: number, tcaMs: number): void;
  /** Current simulation time (Unix ms) — use it as the epoch of the new element set. */
  now(): number;
}

export const CUSTOM_NORAD_ID = 99001;

const EARTH_RADIUS_KM = 6378.137; // equatorial radius, the one orbital elements are defined against
const MU = 398600.4418; // Earth's gravitational parameter, km³/s²
const ALT_MIN = 200, ALT_MAX = 40000; // slider range, km (log scale)
const SCAN_HOURS = 24;
const MAX_ROWS = 50;

interface Preset {
  label: string;
  perigee: number;
  apogee: number;
  inclination: number;
}
const PRESETS: Preset[] = [
  { label: 'ISS-like', perigee: 420, apogee: 420, inclination: 51.6 },
  { label: 'Sun-sync', perigee: 700, apogee: 700, inclination: 98.2 },
  { label: 'Starlink shell', perigee: 550, apogee: 550, inclination: 53 },
  { label: 'GPS-like', perigee: 20200, apogee: 20200, inclination: 55 },
  { label: 'GEO', perigee: 35786, apogee: 35786, inclination: 0 },
  { label: 'Molniya', perigee: 600, apogee: 39700, inclination: 63.4 },
];

// Altitude sliders run 0 … 1000 on a log scale, so low orbits get most of the travel.
const sliderToKm = (v: number) => ALT_MIN * Math.pow(ALT_MAX / ALT_MIN, v / 1000);
const kmToSlider = (km: number) => Math.round((1000 * Math.log(km / ALT_MIN)) / Math.log(ALT_MAX / ALT_MIN));

/** The numbers that follow from a perigee and apogee altitude (two-body orbit). */
export function orbitFrom(perigeeKm: number, apogeeKm: number) {
  const rp = EARTH_RADIUS_KM + perigeeKm, ra = EARTH_RADIUS_KM + apogeeKm;
  const a = (rp + ra) / 2; // semi-major axis
  const n = Math.sqrt(MU / (a * a * a)); // mean motion, rad/s
  return {
    semiMajorKm: a,
    eccentricity: (ra - rp) / (ra + rp),
    meanMotionRevPerDay: (n * 86400) / (2 * Math.PI),
    periodMin: (2 * Math.PI) / n / 60,
    perigeeSpeedKmS: Math.sqrt(MU * (2 / rp - 1 / a)), // vis-viva
  };
}

export class Designer {
  private readonly host: DesignerHost;
  private readonly root: HTMLElement;
  private perigee = 550;
  private apogee = 550;
  private circular = true;
  private inclination = 53;
  private raan = 0;
  private alertKm = 20;
  private launched = false;
  private worker: Worker | null = null;
  private scanStart = 0;
  private scanSats: Satellite[] = [];
  private focusIndex = -1;

  constructor(container: HTMLElement, host: DesignerHost) {
    this.host = host;
    this.root = container;
    container.classList.add('designer');
    container.innerHTML = `
      <p class="note">Give it an orbit and launch it among the real objects. It is drawn, tracked and screened like any other.</p>
      <label class="text-field"><span>Name</span><input type="text" class="d-name" maxlength="24" spellcheck="false" autocomplete="off" value="MY SATELLITE" /></label>
      <p class="field-label">Start from</p>
      <div class="quick d-presets"></div>
      <div class="field">
        <div class="field-head"><span>Lowest point (perigee)</span><output class="d-perigee-out"></output></div>
        <input type="range" class="d-perigee" min="0" max="1000" step="1" aria-label="Perigee altitude" />
      </div>
      <label class="row-toggle d-circular-row"><span>Circular orbit</span><input type="checkbox" class="d-circular" checked /></label>
      <div class="field d-apogee-field">
        <div class="field-head"><span>Highest point (apogee)</span><output class="d-apogee-out"></output></div>
        <input type="range" class="d-apogee" min="0" max="1000" step="1" aria-label="Apogee altitude" />
      </div>
      <div class="field">
        <div class="field-head"><span>Tilt to the equator (inclination)</span><output class="d-inc-out"></output></div>
        <input type="range" class="d-inc" min="0" max="180" step="0.1" aria-label="Inclination" />
      </div>
      <div class="field">
        <div class="field-head"><span>Where it crosses the equator (node)</span><output class="d-raan-out"></output></div>
        <input type="range" class="d-raan" min="0" max="360" step="1" aria-label="Right ascension of the ascending node" />
      </div>
      <dl class="designer-readout">
        <div><dt>Period</dt><dd class="d-period"></dd></div>
        <div><dt>Speed at perigee</dt><dd class="d-speed"></dd></div>
        <div><dt>Eccentricity</dt><dd class="d-ecc"></dd></div>
      </dl>
      <div class="designer-actions">
        <button class="btn btn-primary d-launch">Launch</button>
        <button class="btn d-remove is-hidden">Remove</button>
      </div>
      <p class="note d-launch-note"></p>
      <div class="d-check is-hidden">
        <p class="field-label">What comes close in the next ${SCAN_HOURS} hours? Report passes within</p>
        <div class="segmented d-alert">
          <button data-value="5">5 km</button><button data-value="20" class="is-on">20 km</button><button data-value="50">50 km</button>
        </div>
        <button class="btn wide d-scan">Check the next ${SCAN_HOURS} hours</button>
        <div class="designer-bar is-hidden"><i></i></div>
        <p class="note d-status"></p>
        <ol class="designer-list"></ol>
      </div>`;

    const presets = this.el('.d-presets');
    for (const preset of PRESETS) {
      const button = document.createElement('button');
      button.textContent = preset.label;
      button.addEventListener('click', () => {
        this.perigee = preset.perigee;
        this.apogee = preset.apogee;
        this.inclination = preset.inclination;
        this.circular = preset.apogee === preset.perigee;
        this.syncControls();
      });
      presets.append(button);
    }

    const name = this.input('.d-name');
    name.addEventListener('keydown', (event) => event.stopPropagation()); // typing must not trigger app shortcuts
    name.addEventListener('change', () => (name.value = this.cleanName()));

    this.input('.d-perigee').addEventListener('input', () => {
      this.perigee = sliderToKm(Number(this.input('.d-perigee').value));
      if (this.circular || this.apogee < this.perigee) this.apogee = this.perigee;
      this.syncControls();
    });
    this.input('.d-apogee').addEventListener('input', () => {
      this.apogee = Math.max(this.perigee, sliderToKm(Number(this.input('.d-apogee').value)));
      this.syncControls();
    });
    this.input('.d-circular').addEventListener('change', () => {
      this.circular = this.input('.d-circular').checked;
      if (this.circular) this.apogee = this.perigee;
      this.syncControls();
    });
    this.input('.d-inc').addEventListener('input', () => {
      this.inclination = Number(this.input('.d-inc').value);
      this.syncControls();
    });
    this.input('.d-raan').addEventListener('input', () => {
      this.raan = Number(this.input('.d-raan').value);
      this.syncControls();
    });

    this.el('.d-launch').addEventListener('click', () => this.launch());
    this.el('.d-remove').addEventListener('click', () => this.host.remove());
    const alert = this.el('.d-alert');
    for (const button of alert.querySelectorAll<HTMLElement>('button')) {
      button.addEventListener('click', () => {
        for (const other of alert.querySelectorAll('button')) other.classList.toggle('is-on', other === button);
        this.alertKm = Number(button.dataset.value);
      });
    }
    this.el('.d-scan').addEventListener('click', () => (this.worker ? this.stopScan('Check stopped.') : this.startScan()));

    this.syncControls();
    this.syncLaunched();
  }

  /** Call when the catalogue was rebuilt for any reason, so stale results are cleared. `hasCustom` = the custom object is in it. */
  catalogChanged(hasCustom: boolean): void {
    this.stopScan('');
    this.el('.designer-list').replaceChildren();
    this.launched = hasCustom;
    if (!hasCustom) this.el('.d-launch-note').textContent = '';
    this.syncLaunched();
  }

  // ---------------------------------------------------------------- controls

  private el<T extends HTMLElement = HTMLElement>(selector: string): T {
    return this.root.querySelector(selector) as T;
  }

  private input(selector: string): HTMLInputElement {
    return this.el<HTMLInputElement>(selector);
  }

  private cleanName(): string {
    return this.input('.d-name').value.trim().toUpperCase().slice(0, 24) || 'MY SATELLITE';
  }

  /** Write the state back into the sliders and readouts. */
  private syncControls(): void {
    this.input('.d-perigee').value = String(kmToSlider(this.perigee));
    this.input('.d-apogee').value = String(kmToSlider(this.apogee));
    this.input('.d-circular').checked = this.circular;
    this.input('.d-apogee').disabled = this.circular;
    this.el('.d-apogee-field').classList.toggle('is-off', this.circular);
    this.input('.d-inc').value = String(this.inclination);
    this.input('.d-raan').value = String(this.raan);
    this.el('.d-perigee-out').textContent = `${fmtInt(this.perigee)} km`;
    this.el('.d-apogee-out').textContent = `${fmtInt(this.apogee)} km`;
    this.el('.d-inc-out').textContent = `${fmt(this.inclination, 1)}°`;
    this.el('.d-raan-out').textContent = `${fmtInt(this.raan)}°`;
    const orbit = orbitFrom(this.perigee, this.apogee);
    this.el('.d-period').textContent = orbit.periodMin < 180 ? `${fmt(orbit.periodMin, 1)} min` : `${fmt(orbit.periodMin / 60, 2)} h`;
    this.el('.d-speed').textContent = `${fmt(orbit.perigeeSpeedKmS, 2)} km/s`;
    this.el('.d-ecc').textContent = orbit.eccentricity < 0.0005 ? '0 (circular)' : orbit.eccentricity.toFixed(3);
  }

  private syncLaunched(): void {
    this.el('.d-launch').textContent = this.launched ? 'Update orbit' : 'Launch';
    this.el('.d-remove').classList.toggle('is-hidden', !this.launched);
    this.el('.d-check').classList.toggle('is-hidden', !this.launched);
  }

  // ---------------------------------------------------------------- launch

  /** The orbit as a CelesTrak-style OMM record, with "now" as its epoch. */
  private record(): OmmRecord {
    const orbit = orbitFrom(this.perigee, this.apogee);
    return {
      OBJECT_NAME: this.cleanName(),
      OBJECT_ID: '2099-001A',
      NORAD_CAT_ID: CUSTOM_NORAD_ID,
      EPOCH: new Date(this.host.now()).toISOString().slice(0, -1) + '000', // 2026-11-18T00:42:19.880000 (UTC, no "Z")
      MEAN_MOTION: orbit.meanMotionRevPerDay,
      ECCENTRICITY: orbit.eccentricity,
      INCLINATION: this.inclination,
      RA_OF_ASC_NODE: this.raan % 360,
      ARG_OF_PERICENTER: orbit.eccentricity < 0.0005 ? 0 : 270, // eccentric: apogee over the northern hemisphere
      MEAN_ANOMALY: 0,
      BSTAR: 0, // no drag
      MEAN_MOTION_DOT: 0,
      MEAN_MOTION_DDOT: 0,
      GROUP: 'custom',
    };
  }

  private launch(): void {
    const sat = this.host.launch(this.record()); // the host rebuilds the catalogue and calls catalogChanged()
    const note = this.el('.d-launch-note');
    if (!sat) {
      note.textContent = 'The catalogue is still loading. Try again in a moment.';
      return;
    }
    this.launched = true;
    this.syncLaunched();
    note.textContent = `${sat.name} is in orbit, starting over the equator. Change the sliders and press Update orbit to move it.`;
  }

  // ---------------------------------------------------------------- 24-hour check

  private startScan(): void {
    const ctx = this.host.context();
    const custom = ctx?.sats.find((sat) => sat.noradId === CUSTOM_NORAD_ID);
    if (!ctx || !custom) {
      this.el('.d-status').textContent = 'Launch the satellite first.';
      return;
    }
    this.scanSats = ctx.sats;
    this.scanStart = ctx.startMs;
    this.focusIndex = custom.index;
    this.el('.designer-list').replaceChildren();
    this.worker = new Worker(new URL('../worker/lookahead.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<LookaheadReply>) => this.onReply(event.data);
    const request: LookaheadRequest = {
      records: ctx.records, mask: ctx.mask, startMs: ctx.startMs, hours: SCAN_HOURS, alertKm: this.alertKm, focus: custom.index,
    };
    this.worker.postMessage(request);
    this.el('.d-scan').textContent = 'Stop';
    const bar = this.el('.designer-bar');
    bar.classList.remove('is-hidden');
    (bar.firstElementChild as HTMLElement).style.width = '0%';
    this.el('.d-status').textContent = `Flying it forward ${SCAN_HOURS} hours against everything shown…`;
  }

  private stopScan(message: string): void {
    this.worker?.terminate();
    this.worker = null;
    this.el('.d-scan').textContent = `Check the next ${SCAN_HOURS} hours`;
    this.el('.designer-bar').classList.add('is-hidden');
    this.el('.d-status').textContent = message;
  }

  private other(approach: FutureApproach): Satellite {
    return this.scanSats[approach.a === this.focusIndex ? approach.b : approach.a];
  }

  private onReply(reply: LookaheadReply): void {
    (this.el('.designer-bar').firstElementChild as HTMLElement).style.width = `${(reply.fraction * 100).toFixed(1)}%`;
    this.render(reply.closest.slice(0, MAX_ROWS));
    if (!reply.done) {
      this.el('.d-status').textContent = `Checking… ${Math.round(reply.fraction * 100)}%, ${fmtInt(reply.total)} found so far.`;
      return;
    }
    if (reply.total === 0) {
      this.stopScan(`Nothing comes within ${this.alertKm} km in the next ${SCAN_HOURS} h.`);
      return;
    }
    const nearest = reply.closest[0];
    const objects = new Set(reply.closest.map((approach) => this.other(approach).index)).size;
    const complete = reply.total <= reply.closest.length; // the worker sends at most its closest 250
    const count = complete
      ? `${fmtInt(objects)} object${objects === 1 ? '' : 's'} pass${objects === 1 ? 'es' : ''} within ${this.alertKm} km in the next ${SCAN_HOURS} h`
        + (reply.total > objects ? ` (${fmtInt(reply.total)} passes in all)` : '')
      : `${fmtInt(reply.total)} passes within ${this.alertKm} km in the next ${SCAN_HOURS} h`;
    this.stopScan(
      `${count}; the closest is ${this.other(nearest).name} at ${this.distance(nearest.missKm)}.`
      + (reply.total > MAX_ROWS ? ` Showing the closest ${MAX_ROWS}.` : ''),
    );
  }

  private distance(km: number): string {
    return km < 1 ? `${fmtInt(km * 1000)} m` : `${fmt(km, km < 10 ? 2 : 1)} km`;
  }

  private render(approaches: FutureApproach[]): void {
    this.el('.designer-list').replaceChildren(...approaches.map((approach) => {
      const sat = this.other(approach);
      const li = document.createElement('li');
      li.className = approach.missKm < this.alertKm / 4 ? 'sev-high' : approach.missKm < this.alertKm / 2 ? 'sev-mid' : 'sev-low';
      li.innerHTML = '<i class="sev"></i><div class="names"><span><i class="dot"></i><b></b></span><small></small></div><span class="dist"><b></b><small></small></span>';
      li.querySelector('.names b')!.textContent = sat.name;
      li.querySelector<HTMLElement>('.dot')!.style.color = CATEGORY_COLORS[sat.category];
      li.querySelector('.names small')!.textContent = `passing at ${fmt(approach.relSpeedKmS, 1)} km/s`;
      const dist = li.querySelector('.dist')!;
      dist.firstElementChild!.textContent = this.distance(approach.missKm);
      dist.lastElementChild!.textContent = `in ${duration(approach.tcaMs - this.scanStart)}`;
      li.addEventListener('click', () => this.host.openApproach(approach.a, approach.b, approach.tcaMs));
      return li;
    }));
  }
}
