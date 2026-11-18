/**
 * The close-approach panel: one pair examined in detail. Shows how far apart the two
 * objects are now, when and how closely they pass, how fast, and a chart of the range
 * through the approach that can be scrubbed or replayed in slow motion.
 */

import { eciToGeodetic, gstime, type SatRec } from 'satellite.js';
import { closestApproach, makeSatrec, rangeKm, wrapLon, type Approach, type Vec3 } from '../data/ephemeris.ts';
import { regionName } from '../data/regions.ts';
import type { Satellite } from '../data/types.ts';
import { drawLineChart } from './charts.ts';
import { $, fmt, fmtInt, fmtKm, fmtKmS, fmtRange, fmtSlow, getClockZone, getUnits } from './dom.ts';
import { alertDistance, clockStamp, duration } from './inspector.ts';

const CHART_SAMPLES = 161;
const DEG = 180 / Math.PI;

export type EncounterFocus = 'both' | 'a' | 'b';

export interface EncounterHandlers {
  onClose(): void;
  onInspect(sat: Satellite): void;
  /** Put the camera on one of the two objects, or back on both. */
  onFocus(which: EncounterFocus): void;
  /** Move the clock to `timeMs` and hold it there. */
  onScrub(timeMs: number): void;
  /** Play from `fromMs` to `toMs` at `speed` simulated seconds per second, then hold. */
  onReplay(fromMs: number, toMs: number, speed: number): void;
}

export interface Encounter {
  a: Satellite;
  b: Satellite;
  recA: SatRec;
  recB: SatRec;
  approach: Approach;
  /** Seconds either side of the closest point covered by the chart, the paths and the replay. */
  windowS: number;
}

/** Metres (or feet) when very close, two decimals up to 100 km, whole numbers beyond. */
const rangeText = (km: number) => (km >= 100 ? fmtKm(km) : fmtRange(km));

export class EncounterPanel {
  private readonly root = $('encounter');
  private readonly scrub = $<HTMLInputElement>('enc-scrub');
  private current: Encounter | null = null;
  private ranges = new Float32Array(CHART_SAMPLES);
  private alertKm = 10;
  private lastDraw = -Infinity;
  private scrubbing = false;
  private factsFor = ''; // units + clock setting the fixed facts were last written with

  constructor(handlers: EncounterHandlers) {
    $('enc-close').addEventListener('click', handlers.onClose);
    $('enc-a').addEventListener('click', () => handlers.onFocus('a'));
    $('enc-b').addEventListener('click', () => handlers.onFocus('b'));
    $('enc-both').addEventListener('click', () => handlers.onFocus('both'));
    $('enc-a-info').addEventListener('click', () => this.current && handlers.onInspect(this.current.a));
    $('enc-b-info').addEventListener('click', () => this.current && handlers.onInspect(this.current.b));
    $('enc-goto').addEventListener('click', () => this.current && handlers.onScrub(this.current.approach.tcaMs));
    $('enc-replay').addEventListener('click', () => {
      const e = this.current;
      if (!e) return;
      const span = e.windowS * 1000;
      handlers.onReplay(e.approach.tcaMs - span, e.approach.tcaMs + span, (2 * e.windowS) / 10); // the whole window in 10 s
    });
    this.scrub.addEventListener('input', () => {
      const e = this.current;
      if (!e) return;
      this.scrubbing = true;
      handlers.onScrub(e.approach.tcaMs + (Number(this.scrub.value) / 500 - 1) * e.windowS * 1000);
    });
    this.scrub.addEventListener('change', () => (this.scrubbing = false));
  }

  /** Show which object (if any) the camera is centred on. */
  setFocus(which: EncounterFocus): void {
    $('enc-a').classList.toggle('is-on', which === 'a');
    $('enc-b').classList.toggle('is-on', which === 'b');
    $('enc-both').classList.toggle('is-hidden', which === 'both');
  }

  get isOpen(): boolean {
    return this.current !== null;
  }

  get encounter(): Encounter | null {
    return this.current;
  }

  /** Work out the approach for a pair and show it. */
  open(a: Satellite, b: Satellite, simTime: number, alertKm: number): Encounter {
    const recA = makeSatrec(a), recB = makeSatrec(b);
    const approach = closestApproach(recA, recB, simTime);
    // How much time to show and replay: the two objects start a few miss-distances apart, so
    // they are in view (and their 3D models readable) for most of the slow-motion pass.
    const windowS = approach.coMoving ? 300 : Math.min(120, Math.max(1.5, (6 * Math.max(approach.missKm, 1)) / approach.relSpeedKmS));
    this.current = { a, b, recA, recB, approach, windowS };
    this.alertKm = alertKm;
    for (let i = 0; i < CHART_SAMPLES; i++) {
      this.ranges[i] = rangeKm(recA, recB, approach.tcaMs + ((i / (CHART_SAMPLES - 1)) * 2 - 1) * windowS * 1000);
    }

    ($('enc-a').lastElementChild as HTMLElement).textContent = a.name;
    ($('enc-b').lastElementChild as HTMLElement).textContent = b.name;
    $('enc-kind').textContent = approach.coMoving ? 'Flying together' : 'Crossing paths';
    this.writeFacts();
    $('enc-span').textContent = `${duration(windowS * 1000)} either side`;
    $<HTMLButtonElement>('enc-replay').disabled = approach.coMoving;
    $('enc-note').textContent = approach.coMoving
      ? 'These two travel together — docked, in formation, or neighbours in the same slot — so the range hardly changes and there is no single passing moment.'
      : 'Positions are predictions from published orbital elements, good to roughly a kilometre. A real alert would be followed by tracking both objects more precisely.';
    this.root.classList.remove('is-hidden');
    this.lastDraw = -Infinity;
    return this.current;
  }

  /**
   * The facts that do not change while the panel is open but do depend on the units and
   * clock settings. frame() writes them again if either setting is switched meanwhile.
   */
  private writeFacts(): void {
    if (!this.current) return;
    const { approach } = this.current;
    $('enc-miss').textContent = rangeText(approach.missKm);
    // Metric gives the speed twice (km/s is the field's unit, km/h the one people can picture);
    // mph is already the everyday unit, so it stands alone.
    $('enc-speed').textContent = approach.relSpeedKmS < 0.01
      ? fmtSlow(approach.relSpeedKmS)
      : getUnits() === 'metric'
        ? `${fmtKmS(approach.relSpeedKmS)}  (${fmtInt(approach.relSpeedKmS * 3600)} km/h)`
        : fmtKmS(approach.relSpeedKmS);
    $('enc-tca').textContent = clockStamp(approach.tcaMs, true);
    this.factsFor = `${getUnits()} ${getClockZone()}`;
  }

  close(): void {
    this.current = null;
    this.root.classList.add('is-hidden');
  }

  /** Call every frame with the exact range and mid-point from the encounter drawing. */
  frame(simTime: number, realSeconds: number, nowRangeKm: number, mid: Vec3): void {
    const e = this.current;
    if (!e || realSeconds - this.lastDraw < 0.066) return;
    this.lastDraw = realSeconds;
    if (this.factsFor !== `${getUnits()} ${getClockZone()}`) this.writeFacts();
    const dt = simTime - e.approach.tcaMs;
    $('enc-range').textContent = rangeText(nowRangeKm);
    $('enc-range').classList.toggle('is-alert', nowRangeKm < this.alertKm);
    $('enc-count-label').textContent = dt < 0 ? 'To closest point' : 'Since closest point';
    $('enc-countdown').textContent = Math.abs(dt) < 60000 ? `${fmt(Math.abs(dt) / 1000, 1)} s` : duration(dt);
    const geo = eciToGeodetic(mid, gstime(new Date(simTime)));
    $('enc-alt').textContent = fmtKm(geo.height);
    $('enc-over').textContent = regionName(geo.latitude * DEG, wrapLon(geo.longitude * DEG));

    const cursor = dt / (e.windowS * 2000) + 0.5;
    if (!this.scrubbing) this.scrub.value = String(Math.round(Math.min(1, Math.max(0, cursor)) * 1000));
    drawLineChart($<HTMLCanvasElement>('enc-canvas'), {
      values: this.ranges,
      color: '#ff4d5e',
      min: 0,
      cursor,
      format: rangeText,
      threshold: { value: this.alertKm, label: `alert ${alertDistance(this.alertKm)}` }, // the line itself stays in km, like the curve
      xLabels: [`−${duration(e.windowS * 1000)}`, 'closest', `+${duration(e.windowS * 1000)}`],
    });
  }
}
