/**
 * Contact timeline: for the next 24 hours, when can each ground station see each object
 * on the watchlist?
 *
 * One block per station, one thin lane per starred object, one bar per pass (rise → set).
 * Bright bars are high passes, dim bars graze the horizon; a filled bar means the object
 * is in sunlight at its peak, a hollow one that it is in the Earth's shadow.
 *
 * The passes come from data/ephemeris.ts (`findPasses`: SGP4 every 20 s, then bisection on
 * each rise and set). That is a few thousand SGP4 calls per object-station pair, so the
 * pairs are worked through a few at a time between frames and the chart fills in as it goes.
 *
 * The home station comes from Settings; extra stations are remembered in the browser.
 */

import './contacts.css';
import { findPasses, lookAngles, makeSatrec, type Observer, type Pass } from '../data/ephemeris.ts';
import { CATEGORY_COLORS, type Satellite } from '../data/types.ts';
import { fmt } from './dom.ts';
import { clockShiftMs, clockStamp, duration, utcStamp, zoneLabel } from './inspector.ts';

export interface ContactsHost {
  watchlist(): Satellite[]; // the starred objects (may be empty)
  home(): Observer; // the user's own ground station (always the first row group)
  now(): number; // simulation time, Unix ms — the timeline starts here
  select(sat: Satellite): void; // inspect an object
  jumpTo(timeMs: number): void; // move the simulation clock
}

const STORAGE_KEY = 'apsis.stations';
const WINDOW_MS = 24 * 3600 * 1000;
const SEARCH_HOURS = 30; // look a little past the window so a pass still under way at +24 h is not lost
const MAX_OBJECTS = 12;
const MAX_STATIONS = 8; // home + 7
const HOUR = 3600 * 1000;

const KNOWN_SITES: Observer[] = [
  { name: 'Goldstone', latDeg: 35.43, lonDeg: -116.89 },
  { name: 'Madrid', latDeg: 40.43, lonDeg: -4.25 },
  { name: 'Canberra', latDeg: -35.4, lonDeg: 148.98 },
  { name: 'Svalbard', latDeg: 78.23, lonDeg: 15.41 },
  { name: 'Kourou', latDeg: 5.25, lonDeg: -52.8 },
  { name: 'Wallops', latDeg: 37.94, lonDeg: -75.47 },
  { name: 'Bangalore', latDeg: 13.03, lonDeg: 77.51 },
  { name: 'Hartebeesthoek', latDeg: -25.89, lonDeg: 27.69 },
];

/** What is known about one object as seen from one station. */
interface Lane {
  passes: Pass[];
  always: boolean; // above the horizon for the whole day (geostationary and the like)
  done: boolean;
}

/** A clickable region of the chart, rebuilt on every draw. */
interface Hit {
  x: number;
  y: number;
  w: number;
  h: number;
  sat: Satellite;
  station: Observer | null; // null = the object's name in the left column
  pass: Pass | null; // null with a station = the "all day" bar
}

// chart metrics, CSS pixels
const AXIS_H = 24;
const STATION_H = 22;
const LANE_H = 17;
const BLOCK_GAP = 10;
const BAR_H = 9;
const MUTED = '#8296ae';
const TEXT = '#dce8f6';
const GRID = 'rgba(150, 185, 230, 0.10)';
const GRID_STRONG = 'rgba(150, 185, 230, 0.22)';
const MONO = '10.5px "JetBrains Mono Variable", ui-monospace, monospace';
const UI = '11.5px "Inter Variable", system-ui, sans-serif';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

const coords = (station: Observer): string =>
  `${fmt(Math.abs(station.latDeg), 1)}° ${station.latDeg >= 0 ? 'N' : 'S'}, ${fmt(Math.abs(station.lonDeg), 1)}° ${station.lonDeg >= 0 ? 'E' : 'W'}`;

export class Contacts {
  private readonly host: ContactsHost;
  private root: HTMLDivElement | null = null;
  private canvas!: HTMLCanvasElement;
  private scroll!: HTMLDivElement;
  private stationList!: HTMLDivElement;
  private quick!: HTMLDivElement;
  private form!: HTMLDivElement;
  private nameInput!: HTMLInputElement;
  private latInput!: HTMLInputElement;
  private lonInput!: HTMLInputElement;
  private addButton!: HTMLButtonElement;
  private formNote!: HTMLParagraphElement;
  private progress!: HTMLParagraphElement;
  private summary!: HTMLParagraphElement;
  private subtitle!: HTMLSpanElement;
  private empty!: HTMLDivElement;
  private working!: HTMLDivElement;
  private tip!: HTMLDivElement;

  private extras: Observer[] = [];
  private stations: Observer[] = [];
  private sats: Satellite[] = [];
  private starred = 0; // how many objects are on the watchlist (may exceed MAX_OBJECTS)
  private lanes: Lane[][] = []; // [station][object]
  private startMs = 0;
  private job = 0; // bumped to abandon a computation in progress
  private finished = false;
  private hits: Hit[] = [];
  private timer = 0;
  private touch = false; // was the last pointer a finger?
  private tipFor: Hit | null = null;
  private readonly onKey = (event: KeyboardEvent) => this.key(event);
  private readonly onResize = () => this.draw();

  constructor(host: ContactsHost) {
    this.host = host;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as Observer[];
      if (Array.isArray(saved)) {
        this.extras = saved
          .filter((s) => s && typeof s.name === 'string' && Number.isFinite(s.latDeg) && Number.isFinite(s.lonDeg))
          .slice(0, MAX_STATIONS - 1);
      }
    } catch { /* nothing saved, or storage unavailable */ }
  }

  get isOpen(): boolean {
    return !!this.root && !this.root.classList.contains('is-hidden');
  }

  open(): void {
    if (!this.root) this.build();
    this.root!.classList.remove('is-hidden');
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('resize', this.onResize);
    this.recompute();
    clearInterval(this.timer);
    this.timer = window.setInterval(() => this.tick(), 1000);
  }

  close(): void {
    if (!this.root) return;
    this.root.classList.add('is-hidden');
    this.job++; // abandon any computation in progress
    clearInterval(this.timer);
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('resize', this.onResize);
    this.hideTip();
  }

  // ---------------------------------------------------------------- DOM

  private build(): void {
    const root = el('div', 'overlay is-hidden');
    root.id = 'contacts';
    const card = el('div', 'panel contacts-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Contact timeline');

    const head = el('header', 'panel-head');
    const title = el('div');
    title.append(el('h2', '', 'Contact timeline'));
    this.subtitle = el('span', 'muted small');
    title.append(this.subtitle);
    const close = el('button', 'icon-btn', '×');
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.close());
    head.append(title, close);

    const body = el('div', 'contacts-body');
    body.append(el('p', 'note', 'When each ground station can see each object on your watchlist. Bright bars are high passes; hollow bars are passes in the Earth’s shadow. Click a bar to go to that pass.'));

    // stations
    this.stationList = el('div', 'contacts-stations');
    this.quick = el('div', 'quick contacts-quick');
    this.form = el('div', 'contacts-add');
    const field = (label: string, input: HTMLInputElement) => {
      const wrap = el('label', 'text-field');
      wrap.append(el('span', '', label), input);
      return wrap;
    };
    this.nameInput = el('input');
    this.nameInput.type = 'text';
    this.nameInput.maxLength = 28;
    this.nameInput.placeholder = 'Station name';
    this.nameInput.spellcheck = false;
    const numberInput = (min: number, max: number) => {
      const input = el('input');
      input.type = 'number';
      input.min = String(min);
      input.max = String(max);
      input.step = '0.01';
      return input;
    };
    this.latInput = numberInput(-90, 90);
    this.lonInput = numberInput(-180, 180);
    this.addButton = el('button', 'btn', 'Add');
    this.addButton.addEventListener('click', () => this.addFromForm());
    this.form.append(field('Add a station', this.nameInput), field('Latitude °', this.latInput), field('Longitude °', this.lonInput), this.addButton);
    this.formNote = el('p', 'note contacts-form-note');

    // chart
    this.working = el('div', 'contacts-working');
    this.progress = el('p', 'note contacts-progress');
    this.scroll = el('div', 'contacts-scroll');
    this.canvas = el('canvas', 'contacts-chart');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Timeline of passes over each ground station for the next 24 hours');
    this.scroll.append(this.canvas);
    this.summary = el('p', 'contacts-summary');
    this.working.append(this.progress, this.scroll, this.summary);

    // empty state
    this.empty = el('div', 'contacts-empty is-hidden');
    this.empty.append(el('p', '', 'Star some objects first (the star in an object’s inspector), then come back.'));
    const emptyClose = el('button', 'btn btn-primary', 'Close');
    emptyClose.addEventListener('click', () => this.close());
    this.empty.append(emptyClose);

    body.append(this.stationList, this.quick, this.form, this.formNote, this.working, this.empty);
    card.append(head, body);
    root.append(card);

    this.tip = el('div', 'contacts-tip is-hidden');
    root.append(this.tip);

    root.addEventListener('pointerdown', (event) => {
      if (event.target === root) this.close();
    });
    this.canvas.addEventListener('pointerdown', (event) => (this.touch = event.pointerType === 'touch'));
    this.canvas.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch') return; // fingers "hover" by tapping, handled in click
      this.hover(this.hitAt(event), event.clientX, event.clientY);
    });
    this.canvas.addEventListener('pointerleave', (event) => {
      if (event.pointerType !== 'touch') this.hideTip();
    });
    this.canvas.addEventListener('click', (event) => this.click(this.hitAt(event), event.clientX, event.clientY));
    this.scroll.addEventListener('scroll', () => this.hideTip());

    document.body.append(root);
    this.root = root;
  }

  private key(event: KeyboardEvent): void {
    if (!this.isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation(); // Escape closes the timeline only (in the tracker it would otherwise also go out to the solar system)
      this.close();
    } else if (event.key === 'Enter' && this.form.contains(event.target as Node)) {
      event.preventDefault();
      this.addFromForm();
    }
    // Nothing typed in this window may reach the app's keyboard shortcuts.
    event.stopImmediatePropagation();
  }

  // ---------------------------------------------------------------- stations

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.extras));
    } catch { /* private mode: the stations last for this visit only */ }
  }

  private addStation(station: Observer): void {
    if (this.extras.length >= MAX_STATIONS - 1) {
      this.formNote.textContent = `That is the limit: ${MAX_STATIONS} stations including your own.`;
      return;
    }
    if (this.extras.some((s) => s.name.toLowerCase() === station.name.toLowerCase())) {
      this.formNote.textContent = `There is already a station called ${station.name}.`;
      return;
    }
    this.formNote.textContent = '';
    this.extras.push(station);
    this.save();
    this.recompute();
  }

  private addFromForm(): void {
    const lat = Number(this.latInput.value), lon = Number(this.lonInput.value);
    if (this.latInput.value.trim() === '' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      this.formNote.textContent = 'Latitude must be a number between −90 and 90.';
      this.latInput.focus();
      return;
    }
    if (this.lonInput.value.trim() === '' || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      this.formNote.textContent = 'Longitude must be a number between −180 and 180 (west is negative).';
      this.lonInput.focus();
      return;
    }
    const name = this.nameInput.value.trim() || `Station ${this.extras.length + 2}`;
    const before = this.extras.length;
    this.addStation({ name, latDeg: Math.round(lat * 100) / 100, lonDeg: Math.round(lon * 100) / 100 });
    if (this.extras.length > before) this.nameInput.value = this.latInput.value = this.lonInput.value = '';
  }

  private renderStations(): void {
    const full = this.extras.length >= MAX_STATIONS - 1;
    this.stationList.replaceChildren(...this.stations.map((station, index) => {
      const chip = el('span', index === 0 ? 'contacts-station is-home' : 'contacts-station');
      chip.append(el('b', '', station.name), el('span', '', coords(station)));
      if (index > 0) {
        const remove = el('button', '', '×');
        remove.title = `Remove ${station.name}`;
        remove.setAttribute('aria-label', `Remove ${station.name}`);
        remove.addEventListener('click', () => {
          this.extras.splice(index - 1, 1);
          this.save();
          this.formNote.textContent = '';
          this.recompute();
        });
        chip.append(remove);
      }
      return chip;
    }));
    this.quick.replaceChildren(...KNOWN_SITES
      .filter((site) => !this.extras.some((s) => s.name === site.name))
      .map((site) => {
        const pill = el('button', '', `+ ${site.name}`);
        pill.title = `Add ${site.name} (${coords(site)})`;
        pill.disabled = full;
        pill.addEventListener('click', () => this.addStation({ ...site }));
        return pill;
      }));
    this.addButton.disabled = full;
  }

  // ---------------------------------------------------------------- computing

  /** Start again from the current simulation time with the current stations and watchlist. */
  private recompute(): void {
    const job = ++this.job;
    const home = this.host.home();
    this.stations = [{ ...home, name: home.name.trim() || 'Home' }, ...this.extras];
    const all = this.host.watchlist();
    this.starred = all.length;
    this.sats = all.slice(0, MAX_OBJECTS);
    this.startMs = this.host.now();
    this.finished = false;
    this.lanes = this.stations.map(() => this.sats.map(() => ({ passes: [], always: false, done: false })));
    this.hideTip();
    this.renderStations();
    this.subtitle.textContent = `24 hours from ${clockStamp(this.startMs)}`;

    const none = this.sats.length === 0;
    this.empty.classList.toggle('is-hidden', !none);
    this.working.classList.toggle('is-hidden', none);
    if (none) return;

    const satrecs = this.sats.map(makeSatrec);
    const pairs: [number, number][] = [];
    for (let s = 0; s < this.stations.length; s++) for (let o = 0; o < this.sats.length; o++) pairs.push([s, o]);
    const end = this.startMs + WINDOW_MS;
    let next = 0;
    this.summary.textContent = '';

    const step = () => {
      if (job !== this.job) return; // superseded or closed
      const until = performance.now() + 14; // at most one frame's worth, then let the page breathe
      do {
        const [s, o] = pairs[next++];
        const lane = this.lanes[s][o];
        const station = this.stations[s];
        lane.passes = findPasses(satrecs[o], station, this.startMs, SEARCH_HOURS, 60)
          .filter((pass) => pass.startMs < end)
          .map((pass) => (pass.endMs > end ? { ...pass, endMs: end } : pass));
        if (lane.passes.length === 0) {
          // No rise or set found: either it never comes up, or (geostationary) it never goes down.
          lane.always = [0, 0.5, 1].every((f) => (lookAngles(satrecs[o], this.startMs + f * WINDOW_MS, station)?.elDeg ?? -90) > 0);
        }
        lane.done = true;
      } while (next < pairs.length && performance.now() < until);

      this.draw();
      if (next < pairs.length) {
        this.progress.textContent = `Working out contacts… ${next} of ${pairs.length}`;
        setTimeout(step, 0);
      } else {
        this.finished = true;
        this.progress.textContent = this.starred > MAX_OBJECTS
          ? `Showing the first ${MAX_OBJECTS} of your ${this.starred} starred objects.`
          : '';
        this.summarise();
      }
    };
    this.progress.textContent = `Working out contacts… 0 of ${pairs.length}`;
    this.draw();
    setTimeout(step, 0);
  }

  /** Once a second: move the cursor, refresh "in 12 min", or start over if the clock has gone elsewhere. */
  private tick(): void {
    if (!this.isOpen) return;
    const now = this.host.now();
    if (now < this.startMs - 1000 || now > this.startMs + 10 * 60 * 1000) {
      this.recompute();
      return;
    }
    this.subtitle.textContent = `24 hours from ${clockStamp(this.startMs)}`; // again, in case the clock setting changed
    if (this.sats.length === 0) return;
    this.draw();
    if (this.finished) this.summarise();
  }

  private summarise(): void {
    const now = this.host.now();
    let total = 0;
    let next: { pass: Pass; sat: Satellite; station: Observer } | null = null;
    let current: { pass: Pass; sat: Satellite; station: Observer } | null = null;
    this.lanes.forEach((block, s) => block.forEach((lane, o) => {
      if (lane.always) total++;
      for (const pass of lane.passes) {
        total++;
        const entry = { pass, sat: this.sats[o], station: this.stations[s] };
        if (pass.startMs <= now && pass.endMs > now) {
          if (!current || pass.endMs < current.pass.endMs) current = entry;
        } else if (pass.startMs > now && (!next || pass.startMs < next.pass.startMs)) {
          next = entry;
        }
      }
    }));
    const where = `${this.stations.length} station${this.stations.length === 1 ? '' : 's'}`;
    let text = total === 0
      ? `No contacts in the next 24 hours from ${where}.`
      : `${total} contact${total === 1 ? '' : 's'} in the next 24 hours from ${where}.`;
    // (TypeScript cannot see the assignments made inside the callbacks above.)
    const live = current as { pass: Pass; sat: Satellite; station: Observer } | null;
    const upcoming = next as { pass: Pass; sat: Satellite; station: Observer } | null;
    if (live) text += ` Now: ${live.sat.name} over ${live.station.name} for another ${duration(live.pass.endMs - now)}.`;
    if (upcoming) text += ` Next: ${upcoming.sat.name} over ${upcoming.station.name} in ${duration(upcoming.pass.startMs - now)}.`;
    this.summary.textContent = text;
  }

  // ---------------------------------------------------------------- drawing

  private draw(): void {
    if (!this.isOpen || this.sats.length === 0) return;
    const phone = window.innerWidth <= 760;
    const labelW = phone ? 108 : 168;
    const width = Math.max(this.scroll.clientWidth, phone ? 660 : 620);
    const height = AXIS_H + this.stations.length * (STATION_H + this.sats.length * LANE_H + BLOCK_GAP) + 4;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = this.canvas;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const left = labelW, right = width - 10;
    const X = (timeMs: number) => left + ((right - left) * (timeMs - this.startMs)) / WINDOW_MS;
    this.hits = [];

    // ---- time axis: a tick every hour, a label every three
    ctx.font = MONO;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    // Ticks fall on whole hours of the chosen clock (UTC or local), which in a zone such as
    // India's (UTC+5:30) are not whole hours of UTC: round in clock time, then shift back.
    const shift = clockShiftMs(this.startMs);
    const firstHour = Math.ceil((this.startMs + shift) / HOUR) * HOUR - shift;
    for (let t = firstHour; t <= this.startMs + WINDOW_MS; t += HOUR) {
      const hour = new Date(t + clockShiftMs(t)).getUTCHours();
      const x = Math.round(X(t)) + 0.5;
      const major = hour % 3 === 0;
      ctx.strokeStyle = hour === 0 ? GRID_STRONG : major ? GRID : 'rgba(150, 185, 230, 0.05)';
      ctx.beginPath();
      ctx.moveTo(x, AXIS_H - (major ? 6 : 3));
      ctx.lineTo(x, height - 4);
      ctx.stroke();
      if (major && x > left + 16 && x < right - 14) {
        ctx.fillStyle = hour === 0 ? TEXT : MUTED;
        ctx.fillText(hour === 0 ? utcStamp(t).slice(0, -6) : `${String(hour).padStart(2, '0')}:00`, x, 10);
      }
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = MUTED;
    ctx.fillText(zoneLabel(this.startMs), 8, 10);

    // ---- one block per station
    let y = AXIS_H;
    this.stations.forEach((station, s) => {
      ctx.fillStyle = 'rgba(150, 185, 230, 0.06)';
      ctx.fillRect(0, y, width, STATION_H - 3);
      ctx.font = `600 ${UI}`;
      ctx.fillStyle = TEXT;
      ctx.textAlign = 'left';
      const stationName = this.fit(ctx, station.name, labelW - 16);
      ctx.fillText(stationName, 8, y + (STATION_H - 3) / 2);
      ctx.font = MONO;
      ctx.fillStyle = MUTED;
      ctx.fillText(coords(station), left + 6, y + (STATION_H - 3) / 2);
      y += STATION_H;

      this.sats.forEach((sat, o) => {
        const lane = this.lanes[s][o];
        const mid = y + LANE_H / 2;
        const colour = CATEGORY_COLORS[sat.category];

        // lane rule + the object's name
        ctx.strokeStyle = 'rgba(150, 185, 230, 0.06)';
        ctx.beginPath();
        ctx.moveTo(left, Math.round(y + LANE_H) + 0.5);
        ctx.lineTo(right, Math.round(y + LANE_H) + 0.5);
        ctx.stroke();
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.arc(12, mid, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = UI;
        ctx.fillStyle = lane.done ? TEXT : MUTED;
        ctx.fillText(this.fit(ctx, sat.name, labelW - 28), 20, mid);
        this.hits.push({ x: 0, y, w: labelW - 4, h: LANE_H, sat, station: null, pass: null });

        if (lane.always) {
          // Never sets: one thin bar right across.
          ctx.globalAlpha = 0.55;
          ctx.fillStyle = colour;
          ctx.fillRect(left, mid - 2, right - left, 4);
          ctx.globalAlpha = 1;
          this.hits.push({ x: left, y, w: right - left, h: LANE_H, sat, station, pass: null });
        }
        for (const pass of lane.passes) {
          const x0 = Math.max(left, X(pass.startMs));
          const w = Math.max(2.5, X(pass.endMs) - x0);
          // Brightness follows the peak elevation: a 60°+ pass is full strength, a grazing one faint.
          const strength = 0.3 + 0.7 * Math.min(1, Math.max(0, pass.peakElDeg) / 60);
          ctx.globalAlpha = strength;
          if (pass.sunlit) {
            ctx.fillStyle = colour;
            ctx.fillRect(x0, mid - BAR_H / 2, w, BAR_H);
          } else {
            ctx.fillStyle = colour;
            ctx.globalAlpha = strength * 0.18;
            ctx.fillRect(x0, mid - BAR_H / 2, w, BAR_H);
            ctx.globalAlpha = strength;
            ctx.strokeStyle = colour;
            ctx.lineWidth = 1;
            ctx.strokeRect(x0 + 0.5, mid - BAR_H / 2 + 0.5, Math.max(1.5, w - 1), BAR_H - 1);
          }
          ctx.globalAlpha = 1;
          // A generous target: short passes are only a few pixels wide.
          this.hits.push({ x: x0 - 3, y, w: w + 6, h: LANE_H, sat, station, pass });
        }
        y += LANE_H;
      });
      y += BLOCK_GAP;
    });

    // ---- where the clock is now
    const nowX = X(this.host.now());
    if (nowX >= left - 0.5 && nowX <= right) {
      ctx.strokeStyle = '#5be3a4';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(nowX) + 0.5, AXIS_H - 6);
      ctx.lineTo(Math.round(nowX) + 0.5, height - 4);
      ctx.stroke();
      ctx.fillStyle = '#5be3a4';
      ctx.beginPath();
      ctx.arc(Math.round(nowX) + 0.5, AXIS_H - 6, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Shorten text with an ellipsis until it fits `maxWidth` in the current font. */
  private fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let cut = text.length;
    while (cut > 1 && ctx.measureText(text.slice(0, cut) + '…').width > maxWidth) cut--;
    return text.slice(0, cut) + '…';
  }

  // ---------------------------------------------------------------- pointer

  private hitAt(event: MouseEvent): Hit | null {
    const box = this.canvas.getBoundingClientRect();
    const x = event.clientX - box.left, y = event.clientY - box.top;
    // Bars were added after their lane's name and the "all day" bar, so search from the end: passes win.
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const hit = this.hits[i];
      if (x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h) return hit;
    }
    return null;
  }

  private hover(hit: Hit | null, clientX: number, clientY: number): void {
    this.canvas.style.cursor = hit && (hit.pass || !hit.station) ? 'pointer' : '';
    if (!hit || !hit.station) return this.hideTip();
    this.showTip(hit, clientX, clientY);
  }

  private click(hit: Hit | null, clientX: number, clientY: number): void {
    if (!hit) return this.hideTip();
    if (!hit.station) {
      // the object's name
      this.host.select(hit.sat);
      this.close();
      return;
    }
    // A finger cannot hover: the first tap on a bar explains it, a second tap on the same bar goes there.
    if (this.touch && !this.sameHit(hit, this.tipFor)) return this.showTip(hit, clientX, clientY);
    if (!hit.pass) return this.showTip(hit, clientX, clientY); // the "all day" bar has no moment to jump to
    this.host.jumpTo(hit.pass.startMs - 20000);
    this.host.select(hit.sat);
    this.close();
  }

  private sameHit(a: Hit, b: Hit | null): boolean {
    return !!b && a.sat === b.sat && a.station === b.station && a.pass?.startMs === b.pass?.startMs;
  }

  private showTip(hit: Hit, clientX: number, clientY: number): void {
    if (!hit.station) return;
    this.tipFor = hit;
    const lines: string[] = hit.pass
      ? [
          `Rises ${clockStamp(hit.pass.startMs)}`,
          `${duration(hit.pass.endMs - hit.pass.startMs)}, peaks ${Math.round(hit.pass.peakElDeg)}° up`,
          hit.pass.sunlit ? 'In sunlight' : 'In the Earth’s shadow',
        ]
      : ['Above the horizon all day'];
    if (hit.pass && this.touch) lines.push('Tap again to go to this pass');
    const title = el('b', '', hit.sat.name);
    const over = el('span', 'contacts-tip-station', `over ${hit.station.name}`);
    this.tip.replaceChildren(title, over, ...lines.map((line) => el('span', '', line)));
    this.tip.classList.remove('is-hidden');
    // Keep it on screen: to the right of the pointer unless that would run off the edge.
    const box = this.tip.getBoundingClientRect();
    const x = clientX + 14 + box.width > window.innerWidth - 8 ? clientX - 14 - box.width : clientX + 14;
    const y = Math.min(window.innerHeight - box.height - 8, Math.max(8, clientY - box.height / 2));
    this.tip.style.left = `${Math.max(8, x)}px`;
    this.tip.style.top = `${y}px`;
  }

  private hideTip(): void {
    this.tipFor = null;
    if (this.tip) this.tip.classList.add('is-hidden');
    if (this.canvas) this.canvas.style.cursor = '';
  }
}
