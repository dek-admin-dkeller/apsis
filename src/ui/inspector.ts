/**
 * The inspector: everything known about the selected object, in four tabs.
 *
 *   Live     telemetry now, a world map with its ground track, altitude over the next orbit
 *   Orbit    the orbit drawn to scale, the orbital elements, speed and sunlight charts
 *   Passes   when it next crosses the sky of the ground station, with a sky chart
 *   Record   catalogue facts (owner, launch, size), a Wikipedia summary, the raw record
 *
 * All numbers come from SGP4 run for this one object on the main thread (data/ephemeris.ts).
 */

import { eciToGeodetic, gstime, type SatRec } from 'satellite.js';
import { describe, KIND_LABEL } from '../data/describe.ts';
import { operatorLogoAsync } from '../data/operators.ts';
import {
  compass, findPasses, isSunlit, lookAngles, makeSatrec, orbitSeries, stateAt, sunDirection, wrapLon,
  type Look, type Observer, type OrbitSeries, type Pass,
} from '../data/ephemeris.ts';
import { regionName } from '../data/regions.ts';
import { ownerName, siteName, sizeClass, statusLabel, typeLabel, type CatalogFacts } from '../data/satcat.ts';
import { CATEGORY_COLORS, type Satellite } from '../data/types.ts';
import { articleFor, wikiSummary } from '../data/wiki.ts';
import { ModelPreview } from '../render/satModels.ts';
import { drawGroundMap, drawLineChart, drawOrbitShape, drawPolar, drawSunStrip } from './charts.ts';
import { $, fmt, fmtInt } from './dom.ts';

const EARTH_RADIUS_KM = 6371;
const DEG = 180 / Math.PI;
const SAMPLES_PER_ORBIT = 120;
type Tab = 'live' | 'orbit' | 'passes' | 'record';

export interface InspectorHandlers {
  onClose(): void;
  onLock(on: boolean): void;
  /** Move the simulation clock (used by "jump to this pass"). */
  onJump(timeMs: number): void;
  onTrace(): void;
  /** Star / unstar this object (watchlist). */
  onStar(): void;
  /** Put the camera on the object and look out from it. */
  onRide(): void;
}

const latText = (lat: number) => `${fmt(Math.abs(lat), 2)}° ${lat >= 0 ? 'N' : 'S'}`;
const lonText = (lon: number) => `${fmt(Math.abs(lon), 2)}° ${lon >= 0 ? 'E' : 'W'}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function utcStamp(ms: number, seconds = false): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}${seconds ? ':' + two(d.getUTCSeconds()) : ''}`;
}
export function duration(ms: number): string {
  const s = Math.abs(ms) / 1000;
  if (s < 10) return `${fmt(s, 1)} s`;
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
  return `${fmt(s / 86400, 1)} days`;
}

export class Inspector {
  private readonly root = $('inspector');
  private readonly preview = new ModelPreview($<HTMLCanvasElement>('insp-model'));
  private readonly photo = $<HTMLImageElement>('insp-photo');
  private readonly mapImage = new Image();
  private readonly handlers: InspectorHandlers;
  private readonly getObserver: () => Observer;
  private sat: Satellite | null = null;
  private satrec: SatRec | null = null;
  private tab: Tab = 'live';
  private hero: 'photo' | 'model' = 'model';
  private series: OrbitSeries | null = null;
  private seriesNow = 0; // sim time the series was built around
  private passes: Pass[] = [];
  private passesAt = NaN; // sim time the pass list was computed for
  private shownPass = 0;
  private lastFast = -Infinity;
  private lastSlow = -Infinity;
  private token = 0; // guards against a late Wikipedia reply for a previous selection

  constructor(handlers: InspectorHandlers, getObserver: () => Observer) {
    this.handlers = handlers;
    this.getObserver = getObserver;
    this.mapImage.src = './textures/earth-blue-marble.jpg';
    $('insp-close').addEventListener('click', handlers.onClose);
    $('insp-trace').addEventListener('click', handlers.onTrace);
    $('insp-star').addEventListener('click', handlers.onStar);
    $('insp-ride').addEventListener('click', handlers.onRide);
    const lock = $('insp-lock');
    lock.addEventListener('click', () => handlers.onLock(lock.getAttribute('aria-pressed') !== 'true'));
    for (const button of $('insp-tabs').querySelectorAll<HTMLElement>('button')) {
      button.addEventListener('click', () => this.showTab(button.dataset.tab as Tab));
    }
    for (const button of $('hero-switch').querySelectorAll<HTMLElement>('button')) {
      button.addEventListener('click', () => this.setHero(button.dataset.hero as 'photo' | 'model'));
    }
    $('rc-copy').addEventListener('click', () => {
      void navigator.clipboard?.writeText($('rc-raw').textContent ?? '').then(() => {
        $('rc-copy').textContent = 'Copied';
        setTimeout(() => ($('rc-copy').textContent = 'Copy record'), 1500);
      });
    });
    this.photo.addEventListener('error', () => this.setPhoto(null, null));
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('is-hidden');
  }

  setStarred(on: boolean): void {
    const star = $('insp-star');
    star.setAttribute('aria-pressed', String(on));
    star.title = on ? 'Remove from the watchlist' : 'Add to the watchlist';
    star.setAttribute('aria-label', star.title);
  }

  setLock(on: boolean): void {
    $('insp-lock').setAttribute('aria-pressed', String(on));
  }

  hide(): void {
    this.sat = this.satrec = null;
    this.root.classList.add('is-hidden');
  }

  /** The ground station moved: passes and look angles must be redone. */
  observerChanged(): void {
    this.passesAt = NaN;
    this.lastSlow = -Infinity;
  }

  show(sat: Satellite, facts: CatalogFacts | undefined, locked: boolean): void {
    this.sat = sat;
    this.satrec = makeSatrec(sat);
    this.series = null;
    this.passesAt = NaN;
    this.lastFast = this.lastSlow = -Infinity;
    const profile = describe(sat);
    const o = sat.omm;

    $('insp-dot').style.color = CATEGORY_COLORS[sat.category];
    $('insp-name').textContent = sat.name;
    $('insp-sub').replaceChildren(...[`NORAD ${sat.noradId}`, sat.intlDes || 'no designator', sat.category].map((text) => {
      const span = document.createElement('span');
      span.textContent = text;
      return span;
    }));
    $('insp-kind').textContent = KIND_LABEL[profile.kind];
    const status = $('insp-status');
    status.textContent = facts ? statusLabel(facts.status) : sat.category === 'Debris' ? 'Debris' : '';
    status.classList.toggle('is-ok', !!facts && facts.status === '+');
    this.preview.show(profile.kind);
    // operator logo (from Wikipedia), if this operator has one
    const logo = $<HTMLImageElement>('insp-oplogo');
    logo.classList.add('is-hidden');
    const logoFor = sat;
    void operatorLogoAsync(profile.operator).then((url) => {
      if (!url || this.sat !== logoFor) return;
      logo.src = url;
      logo.title = profile.operator ?? '';
      logo.classList.remove('is-hidden');
    });
    this.setLock(locked);
    this.setPhoto(null, null);

    // ---- Orbit tab: the elements as published
    const a = EARTH_RADIUS_KM + sat.meanAltKm; // semi-major axis
    $('el-regime').textContent = { LEO: 'Low Earth orbit', MEO: 'Medium Earth orbit', GEO: 'Geostationary', HEO: 'Highly elliptical' }[sat.orbitClass];
    $('el-period').textContent = sat.periodMin < 180 ? `${fmt(sat.periodMin, 2)} min` : `${fmt(sat.periodMin / 60, 2)} h`;
    $('el-perigee').textContent = `${fmtInt(a * (1 - o.ECCENTRICITY) - EARTH_RADIUS_KM)} km`;
    $('el-apogee').textContent = `${fmtInt(a * (1 + o.ECCENTRICITY) - EARTH_RADIUS_KM)} km`;
    $('el-sma').textContent = `${fmtInt(a)} km`;
    $('el-ecc').textContent = o.ECCENTRICITY.toFixed(7);
    $('el-inc').textContent = `${fmt(o.INCLINATION, 4)}°`;
    $('el-raan').textContent = `${fmt(o.RA_OF_ASC_NODE, 4)}°`;
    $('el-argp').textContent = `${fmt(o.ARG_OF_PERICENTER, 4)}°`;
    $('el-ma').textContent = `${fmt(o.MEAN_ANOMALY, 4)}°`;
    $('el-mm').textContent = o.MEAN_MOTION.toFixed(8);
    $('el-bstar').textContent = o.BSTAR.toExponential(4);
    $('shape-note').textContent = o.ECCENTRICITY < 0.005 ? 'nearly circular' : `eccentricity ${o.ECCENTRICITY.toFixed(3)}`;

    // ---- Record tab
    $('rc-purpose').textContent = profile.purpose;
    $('rc-operator').textContent = profile.operator ?? 'Not identified';
    $('rc-owner').textContent = facts ? ownerName(facts.owner) : '–';
    $('rc-type').textContent = facts ? typeLabel(facts.type) : sat.category === 'Debris' ? 'Debris' : '–';
    $('rc-status').textContent = facts ? statusLabel(facts.status) : '–';
    $('rc-launch').textContent = facts?.launchDate
      ? `${facts.launchDate}  (${fmt((Date.now() - Date.parse(facts.launchDate)) / 3.156e10, 1)} years ago)`
      : sat.launchYear ? String(sat.launchYear) : '–';
    $('rc-site').textContent = facts ? siteName(facts.launchSite) : '–';
    $('rc-rcs').textContent = facts ? sizeClass(facts.rcs) : '–';
    $('rc-norad').textContent = String(sat.noradId);
    $('rc-intl').textContent = sat.intlDes || '–';
    $('rc-group').textContent = o.GROUP ?? 'active';
    $('rc-note').textContent = (facts ? 'Owner, launch and size are from the CelesTrak catalogue. ' : 'Catalogue facts are not bundled; run “npm run fetch-data” once to add owner, launch and size. ')
      + 'Operator and purpose are inferred from the object’s name.';
    $('rc-raw').textContent = JSON.stringify(o, null, 2);
    $('rc-about').classList.add('is-hidden');

    // ---- photograph + description from Wikipedia (if there is an article for its programme)
    const token = ++this.token;
    const article = articleFor(sat);
    if (article) {
      void wikiSummary(article).then((page) => {
        if (token !== this.token || !page) return;
        if (page.extract) {
          $('rc-extract').textContent = page.extract;
          $<HTMLAnchorElement>('rc-wiki').href = page.pageUrl;
          $('rc-about').classList.remove('is-hidden');
        }
        this.setPhoto(page.imageUrl, page);
      });
    }

    this.root.classList.remove('is-hidden');
    this.showTab(this.tab);
  }

  private setPhoto(url: string | null, page: { title: string; pageUrl: string } | null): void {
    const has = !!url && !!page;
    $('hero-switch').classList.toggle('is-hidden', !has);
    const credit = $<HTMLAnchorElement>('insp-credit');
    if (has) {
      this.photo.src = url;
      this.photo.alt = `Photograph: ${page.title}`;
      credit.href = page.pageUrl;
      credit.textContent = `${page.title} — Wikipedia`;
    } else {
      this.photo.removeAttribute('src');
    }
    this.setHero(has ? 'photo' : 'model');
  }

  private setHero(which: 'photo' | 'model'): void {
    this.hero = which;
    this.photo.classList.toggle('is-hidden', which !== 'photo');
    $('insp-credit').classList.toggle('is-hidden', which !== 'photo');
    $('insp-kind').classList.toggle('is-hidden', which === 'photo');
    for (const button of $('hero-switch').querySelectorAll<HTMLElement>('button')) {
      button.classList.toggle('is-on', button.dataset.hero === which);
    }
  }

  showTab(tab: Tab): void {
    this.tab = tab;
    for (const button of $('insp-tabs').querySelectorAll<HTMLElement>('button')) button.classList.toggle('is-on', button.dataset.tab === tab);
    for (const body of this.root.querySelectorAll<HTMLElement>('[data-tab-body]')) body.classList.toggle('is-hidden', body.dataset.tabBody !== tab);
    this.lastFast = this.lastSlow = -Infinity; // draw the newly shown tab right away
  }

  /** Call every frame. */
  frame(simTime: number, realSeconds: number): void {
    if (!this.sat || !this.satrec) return;
    if (this.hero === 'model') this.preview.render(realSeconds);
    if (realSeconds - this.lastFast < 0.2) return;
    this.lastFast = realSeconds;
    const sat = this.sat, satrec = this.satrec;
    const observer = this.getObserver();
    const periodMs = sat.periodMin * 60000;

    // The sampled orbit: one revolution behind, two ahead. Rebuilt as the clock moves on.
    if (!this.series || simTime < this.seriesNow || simTime > this.seriesNow + periodMs * 0.15) {
      this.seriesNow = simTime;
      this.series = orbitSeries(satrec, simTime - periodMs, periodMs * 3, SAMPLES_PER_ORBIT * 3 + 1);
    }
    const series = this.series;
    const nowIndex = (simTime - series.startMs) / series.stepMs;
    const state = stateAt(satrec, simTime);
    const sun = sunDirection(simTime);
    const look = lookAngles(satrec, simTime, observer);

    if (this.tab === 'live') {
      if (state) {
        const gmst = gstime(new Date(simTime));
        const geo = eciToGeodetic(state.position, gmst);
        const lat = geo.latitude * DEG, lon = wrapLon(geo.longitude * DEG);
        $('tm-alt').textContent = `${fmt(geo.height, 1)} km`;
        $('tm-speed').textContent = `${fmt(Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z), 3)} km/s`;
        $('tm-lat').textContent = latText(lat);
        $('tm-lon').textContent = lonText(lon);
        const lit = isSunlit(state.position, sun);
        $('tm-sun').textContent = lit ? 'In sunlight' : 'In Earth’s shadow';
        $('tm-sun').classList.toggle('is-dim', !lit);
        $('tm-over').textContent = regionName(lat, lon);
      }
      $('tm-range-label').textContent = `Range from ${observer.name || 'ground station'}`;
      $('tm-range').textContent = look ? `${fmtInt(look.rangeKm)} km` : '–';
      $('tm-look').textContent = look ? `${fmt(look.azDeg, 1)}° / ${fmt(look.elDeg, 1)}°` : '–';
      $('tm-look').classList.toggle('is-dim', !look || look.elDeg < 0);
      const sunLon = wrapLon((Math.atan2(sun.y, sun.x) - gstime(new Date(simTime))) * DEG);
      drawGroundMap($<HTMLCanvasElement>('map-canvas'), this.mapImage, series, nowIndex, Math.asin(sun.z) * DEG, sunLon, observer);
      this.nextOrbitChart('alt-canvas', series.altKm, simTime, (v) => `${fmtInt(v)} km`);
      $('alt-range').textContent = `${fmtInt(series.minAlt)} – ${fmtInt(series.maxAlt)} km`;
    } else if (this.tab === 'orbit') {
      // Where it is along the ellipse: mean anomaly → eccentric anomaly (Newton) → true anomaly.
      const e = sat.omm.ECCENTRICITY;
      const revs = ((simTime - Date.parse(sat.omm.EPOCH.endsWith('Z') ? sat.omm.EPOCH : sat.omm.EPOCH + 'Z')) / 86400000) * sat.omm.MEAN_MOTION;
      const M = ((sat.omm.MEAN_ANOMALY / 360 + revs) % 1) * 2 * Math.PI;
      let E = M;
      for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
      drawOrbitShape($<HTMLCanvasElement>('shape-canvas'), EARTH_RADIUS_KM + sat.meanAltKm, e, nu);
      this.nextOrbitChart('speed-canvas', series.speedKmS, simTime, (v) => `${fmt(v, 3)} km/s`, '#ffb454');
      const from = SAMPLES_PER_ORBIT, to = SAMPLES_PER_ORBIT * 2;
      let lo = Infinity, hi = -Infinity, lit = 0;
      for (let i = from; i <= to; i++) {
        lo = Math.min(lo, series.speedKmS[i]);
        hi = Math.max(hi, series.speedKmS[i]);
        lit += series.sunlit[i];
      }
      $('speed-range').textContent = `${fmt(lo, 2)} – ${fmt(hi, 2)} km/s`;
      const fraction = lit / (to - from + 1);
      $('sun-note').textContent = fraction > 0.995 ? 'sunlit all the way round' : `${Math.round(fraction * 100)}% in sunlight`;
      drawSunStrip($<HTMLCanvasElement>('sun-canvas'), series.sunlit.subarray(from, to + 1), (simTime - this.seriesNow) / periodMs);
    } else if (this.tab === 'passes') {
      this.updatePasses(simTime, realSeconds, observer, look);
    }
  }

  /** A chart of the stretch from "now when the series was built" to one orbit later, with a cursor at the present. */
  private nextOrbitChart(id: string, values: Float32Array, simTime: number, format: (v: number) => string, color?: string): void {
    if (!this.sat || !this.series) return;
    const periodMs = this.sat.periodMin * 60000;
    drawLineChart($<HTMLCanvasElement>(id), {
      values: values.subarray(SAMPLES_PER_ORBIT, SAMPLES_PER_ORBIT * 2 + 1),
      lit: this.series.sunlit.subarray(SAMPLES_PER_ORBIT, SAMPLES_PER_ORBIT * 2 + 1),
      cursor: (simTime - this.seriesNow) / periodMs,
      color,
      format,
      xLabels: ['now', `+${duration(periodMs / 2)}`, `+${duration(periodMs)}`],
    });
  }

  private updatePasses(simTime: number, realSeconds: number, observer: Observer, look: Look | null): void {
    if (!this.sat || !this.satrec) return;
    const stale = Number.isNaN(this.passesAt) || simTime < this.passesAt - 1000
      || simTime - this.passesAt > 6 * 3.6e6 || (this.passes[0] && simTime > this.passes[0].endMs);
    if (stale) {
      this.passesAt = simTime;
      this.passes = findPasses(this.satrec, observer, simTime);
      this.shownPass = 0;
      this.renderPassList(simTime);
      $('pass-site').textContent = `Seen from ${observer.name || 'the ground station'} (${latText(observer.latDeg)}, ${lonText(observer.lonDeg)}). Change it in Settings.`;
      let note = '';
      if (this.passes.length === 0) {
        note = look && look.elDeg > 0
          ? `Stays above the horizon for the next two days, currently ${fmt(look.elDeg, 1)}° up towards the ${compass(look.azDeg)}.`
          : 'Does not rise above this horizon in the next two days.';
      }
      $('pass-note').textContent = note;
    }
    if (realSeconds - this.lastSlow > 1) {
      this.lastSlow = realSeconds;
      this.renderPassList(simTime); // refresh the "in 12 min" countdowns
    }
    const pass = this.passes[this.shownPass] ?? null;
    $('polar-title').textContent = pass ? `Path across the sky, ${utcStamp(pass.startMs)} UTC` : 'Position in the sky now';
    drawPolar($<HTMLCanvasElement>('polar-canvas'), pass ? pass.track : null, look);
  }

  private renderPassList(simTime: number): void {
    const list = $('pass-list');
    list.replaceChildren(...this.passes.map((pass, i) => {
      const li = document.createElement('li');
      li.className = i === this.shownPass ? 'is-on' : '';
      const when = document.createElement('b');
      when.textContent = `${utcStamp(pass.startMs)} UTC`;
      const until = document.createElement('span');
      until.className = 'until';
      until.textContent = simTime >= pass.startMs ? 'in progress' : `in ${duration(pass.startMs - simTime)}`;
      const detail = document.createElement('span');
      detail.className = 'detail';
      detail.textContent = `${duration(pass.endMs - pass.startMs)}, peaks ${Math.round(pass.peakElDeg)}° up, ${compass(pass.startAzDeg)} to ${compass(pass.endAzDeg)}, ${pass.sunlit ? 'sunlit' : 'in shadow'}`;
      const jump = document.createElement('button');
      jump.className = 'link';
      jump.textContent = 'Go to';
      jump.title = 'Move the clock to the start of this pass';
      jump.addEventListener('click', (event) => {
        event.stopPropagation();
        this.handlers.onJump(pass.startMs - 20000);
      });
      li.append(when, until, detail, jump);
      li.addEventListener('click', () => {
        this.shownPass = i;
        this.lastFast = -Infinity;
        this.renderPassList(simTime);
      });
      return li;
    }));
  }
}
