/**
 * The card of a launch (#launch-card in the right dock): what a satellite's card is for an object,
 * for a rocket on its way up. The owner's brief: clicking a rocket, or the bell, opens the launch
 * "like opening any other object", with its stats, facts, record and pictures, and links to where
 * the information comes from; the old floating card with a Follow button was loud and in the way.
 *
 * Built from the inspector's own parts (header, picture, switches, tabs, readings), so it looks
 * like every other card. features/ascent.ts owns the climbs and drives this: it opens the card,
 * feeds it the live figures each frame, and hears the switches (camera lock, path) and the close.
 *
 *   Live     the mission's goal in a line; where the rocket is (T±, height, speed, time to orbit);
 *            a track of the climb's milestones with the next one; how long the climb is shown
 *            (until two orbits after reaching orbit, when the real tracking takes over); and how
 *            the drawing was estimated (the owner asked for "the goal, and the time left that it
 *            would be considered live")
 *   Mission  the service's description, type, orbit, customer, rocket, provider, window, weather
 *   Record   the provider's, the pad's and the world's launch counts, and every link there is
 *
 * Everything comes from Launch Library 2 (The Space Devs), read once an hour by data/launches.ts;
 * the photo is theirs too (their image store), else the rocket's own 3D model.
 */

import type { Ascent } from '../data/ascent.ts';
import type { ModelKind } from '../data/describe.ts';
import type { Launch } from '../data/launches.ts';
import { modelThumbnail } from '../render/satModels.ts';
import { $, fmtInt } from '../ui/dom.ts';
import { clockStamp } from '../ui/inspector.ts';

export interface LaunchCardHost {
  /** The × or Escape closed it. */
  onClose(): void;
  /** Camera lock switched on or off. */
  onLock(on: boolean): void;
  /** The path switched on or off. */
  onPath(on: boolean): void;
}

/** What the card says while the rocket flies, refreshed by ascent.ts a few times a second. */
export interface LaunchLive {
  t: number; // seconds since lift-off (negative before)
  clock: string; // "T+1:49:27"
  height: string;
  speed: string;
  stage: string;
  /** Lost in flight: no orbit to count down to. */
  lost: boolean;
}

/** "4:12", "1:02:30": a span of seconds as a clock. */
const span = (seconds: number): string => {
  const s = Math.max(0, Math.round(Math.abs(seconds)));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};

/** The mission's goal in one sentence: the first of the service's description, else what the orbit says. */
function goalOf(launch: Launch): string {
  const text = launch.info?.description ?? '';
  const first = text.match(/^.+?[.!?](\s|$)/)?.[0].trim() ?? text.trim();
  if (first) return first.length > 200 ? `${first.slice(0, 197)}…` : first;
  const orbit = launch.info?.orbitName || launch.orbit;
  return orbit ? `To put its payload into ${orbit.startsWith('Low') || orbit.startsWith('Sun') ? orbit.charAt(0).toLowerCase() + orbit.slice(1) : orbit}.` : '';
}

/** The words ascent.ts works out about the drawing: the estimate, a failure, the booster, the real objects. */
export interface LaunchNotes {
  estimate: string;
  failure: string;
  booster: string;
  real: HTMLElement | null;
}

type Tab = 'live' | 'mission' | 'record';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

/** "Max-Q: the hardest push of the air" → "Max-Q". */
const shortLabel = (label: string): string => label.split(/[:,]/)[0].trim().toLowerCase().replace(/^max-q$/, 'Max-Q');

const ordinal = (n: number): string => {
  const rest = n % 100;
  const suffix = rest >= 11 && rest <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${fmtInt(n)}${suffix}`;
};

const link = (text: string, href: string): HTMLAnchorElement => {
  const a = el('a', 'lc-link', text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
};

/** One line of a `.kv` list; a value may be text or an element (a link). */
function row(list: HTMLElement, name: string, value: string | HTMLElement | null | undefined): void {
  if (value === null || value === undefined || value === '') return;
  const line = el('div');
  const dd = el('dd', 'plain');
  if (typeof value === 'string') dd.textContent = value;
  else dd.append(value);
  line.append(el('dt', '', name), dd);
  list.append(line);
}

export class LaunchCard {
  private readonly host: LaunchCardHost;
  private readonly root = $('launch-card');
  private readonly body = $('lc-body');
  private readonly photo = $('lc-photo') as HTMLImageElement;
  private readonly lock = $('lc-lock');
  private readonly path = $('lc-path');
  private readonly cast = $('lc-cast') as HTMLAnchorElement;
  private tab: Tab = 'live';
  private id: string | null = null;
  private launch: Launch | null = null;
  private ascent: Ascent | null = null;
  private kind: ModelKind = 'launcher';
  private notes: LaunchNotes = { estimate: '', failure: '', booster: '', real: null };
  private liveCells: { clock: HTMLElement; height: HTMLElement; speed: HTMLElement; stage: HTMLElement; orbit: HTMLElement; fill: HTMLElement; next: HTMLElement; marks: HTMLElement[] } | null = null;
  private endMs = 0;

  constructor(host: LaunchCardHost) {
    this.host = host;
    $('lc-close').addEventListener('click', () => this.host.onClose());
    this.lock.addEventListener('click', () => this.host.onLock(this.lock.getAttribute('aria-pressed') !== 'true'));
    this.path.addEventListener('click', () => {
      const on = this.path.getAttribute('aria-pressed') !== 'true';
      this.setPath(on);
      this.host.onPath(on);
    });
    for (const button of $('lc-tabs').querySelectorAll<HTMLButtonElement>('button[data-tab]')) {
      button.addEventListener('click', () => {
        this.tab = button.dataset.tab as Tab;
        this.render();
      });
    }
    // A photo that will not load: the rocket's own model instead.
    this.photo.addEventListener('error', () => this.useModelPicture());
  }

  /** The launch whose card is open, or null. */
  get openId(): string | null {
    return this.id;
  }

  /** `endMs`: when the drawing of this climb ends (two orbits after reaching orbit, or a minute after a loss). */
  open(launch: Launch, ascent: Ascent, kind: ModelKind, state: { locked: boolean; path: boolean }, endMs: number): void {
    const same = this.id === launch.id;
    this.endMs = endMs;
    this.id = launch.id;
    this.launch = launch;
    this.ascent = ascent;
    this.kind = kind;
    if (!same) this.tab = 'live';
    $('lc-name').textContent = launch.mission;
    $('lc-sub').textContent = [launch.rocket, launch.provider].filter(Boolean).join(' · ');
    const page = $('lc-page') as HTMLAnchorElement;
    page.classList.toggle('is-hidden', !launch.pageUrl);
    if (launch.pageUrl) {
      page.href = launch.pageUrl;
      page.textContent = 'Launch page';
      page.title = 'This launch on Space Launch Now (The Space Devs), the source of this card';
    }
    $('lc-rocket').textContent = launch.info?.rocketFull || launch.rocket;
    const status = $('lc-status');
    status.textContent = launch.status.charAt(0).toUpperCase() + launch.status.slice(1);
    status.classList.toggle('is-ok', launch.state === 'flying' || launch.state === 'done' || launch.state === 'go');
    if (!same) {
      const image = launch.info?.image;
      this.photo.classList.toggle('is-model', !image);
      if (image) this.photo.src = image;
      else this.useModelPicture();
    }
    this.cast.classList.toggle('is-hidden', !launch.webcast);
    if (launch.webcast) {
      this.cast.href = launch.webcast;
      this.cast.textContent = launch.netMs < Date.now() - 2 * 3600000 ? 'Recording ↗' : 'Webcast ↗';
    }
    this.setLocked(state.locked);
    this.setPath(state.path);
    this.root.classList.remove('is-hidden');
    this.render();
  }

  close(): void {
    if (!this.id) return;
    this.id = null;
    this.launch = null;
    this.liveCells = null;
    this.root.classList.add('is-hidden');
  }

  setLocked(on: boolean): void {
    this.lock.setAttribute('aria-pressed', String(on));
  }

  setPath(on: boolean): void {
    this.path.setAttribute('aria-pressed', String(on));
  }

  setNotes(notes: LaunchNotes): void {
    this.notes = notes;
    if (this.tab === 'live') this.render();
  }

  /** The live figures (only the Live tab shows them; nothing is rebuilt). */
  live(values: LaunchLive): void {
    const cells = this.liveCells, ascent = this.ascent;
    if (!cells || !ascent) return;
    const set = (node: HTMLElement, text: string): void => {
      if (node.textContent !== text) node.textContent = text;
    };
    set(cells.clock, values.clock);
    set(cells.height, values.height);
    set(cells.speed, values.speed);
    set(cells.stage, values.stage);
    const t = values.t, orbitAt = ascent.burnS;
    set(cells.orbit, values.lost ? 'not reached' : t < orbitAt ? `in ${span(orbitAt - t)}` : `${span(t - orbitAt)} ago`);
    // The climb's track: how far along, and what comes next.
    const k = Math.max(0, Math.min(1, t / orbitAt));
    cells.fill.style.width = `${(k * 100).toFixed(1)}%`;
    ascent.stages.forEach((stage, i) => cells.marks[i]?.classList.toggle('is-past', t >= stage.t));
    const next = ascent.stages.find((stage) => stage.t > t);
    set(cells.next, values.lost ? 'Lost during the climb.'
      : next ? `Next: ${shortLabel(next.label)} in ${span(next.t - t)}`
      : 'In orbit. The climb is complete.');
  }

  private useModelPicture(): void {
    this.photo.classList.add('is-model');
    try {
      this.photo.src = modelThumbnail(this.kind);
    } catch {
      this.photo.removeAttribute('src');
    }
  }

  private render(): void {
    const launch = this.launch, ascent = this.ascent;
    if (!launch || !ascent) return;
    for (const button of $('lc-tabs').querySelectorAll<HTMLButtonElement>('button[data-tab]')) {
      const on = button.dataset.tab === this.tab;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-selected', String(on));
    }
    this.liveCells = null;
    const page = el('div', 'tab-body');
    if (this.tab === 'live') this.renderLive(page, launch, ascent);
    else if (this.tab === 'mission') this.renderMission(page, launch);
    else this.renderRecord(page, launch);
    this.body.replaceChildren(page);
  }

  private renderLive(page: HTMLElement, launch: Launch, ascent: Ascent): void {
    const goal = goalOf(launch);
    if (goal) {
      const line = el('p', 'lc-goal');
      line.append(el('b', '', 'Goal'), goal);
      page.append(line);
    }
    const grid = el('dl', 'telemetry');
    const cell = (name: string): HTMLElement => {
      const box = el('div');
      const dd = el('dd', '', '–');
      box.append(el('dt', '', name), dd);
      grid.append(box);
      return dd;
    };
    const clock = cell('Mission time'), height = cell('Height'), speed = cell('Speed'), orbit = cell('In orbit');
    page.append(grid);

    // The climb from pad to orbit, its milestones, and the one that comes next.
    const track = el('div', 'lc-track');
    const fill = el('i', 'lc-fill');
    track.append(fill);
    const marks = ascent.stages.map((stage) => {
      const mark = el('span', `lc-mark${/^Booster/.test(stage.label) ? ' is-booster' : ''}`);
      mark.style.left = `${((stage.t / ascent.burnS) * 100).toFixed(1)}%`;
      mark.title = `T+${span(stage.t)} · ${stage.label}`;
      track.append(mark);
      return mark;
    });
    const ends = el('div', 'lc-ends');
    ends.append(el('span', '', 'Pad'), el('span', '', `Orbit · T+${span(ascent.burnS)}`));
    const stage = el('p', 'lc-stage', '–');
    const next = el('p', 'lc-next', '');
    page.append(track, ends, stage, next);
    this.liveCells = { clock, height, speed, stage, orbit, fill, next, marks };

    const facts = el('dl', 'kv lc-facts');
    row(facts, launch.precision === 'exact' ? 'Lift-off' : 'Lift-off (listed)', `${clockStamp(ascent.liftoffMs)}${launch.precision === 'exact' ? '' : ' · to the hour'}`);
    row(facts, 'From', [launch.pad, launch.place].filter(Boolean).join(', '));
    row(facts, 'Target orbit', launch.info?.orbitName || launch.orbit);
    row(facts, 'Tilt of the path', `${ascent.inclinationDeg.toFixed(1)}° (estimated)`);
    if (this.endMs > 0) row(facts, 'Shown live until', `${clockStamp(this.endMs)}`);
    page.append(facts);

    if (this.notes.failure) page.append(el('p', 'lc-alert', this.notes.failure));
    if (this.notes.real) page.append(this.notes.real);
    const about = el('p', 'note lc-note', [this.notes.estimate, this.notes.booster, 'It stays on the globe for two orbits after reaching orbit; by then the real objects are usually in the tracking data.'].filter(Boolean).join(' '));
    page.append(about);
  }

  private renderMission(page: HTMLElement, launch: Launch): void {
    const info = launch.info;
    if (info?.description) page.append(el('p', 'lc-desc', info.description));
    const facts = el('dl', 'kv');
    row(facts, 'Type', info?.missionType);
    row(facts, 'Orbit', info?.orbitName ? `${info.orbitName}${launch.orbit ? ` (${launch.orbit})` : ''}` : launch.orbit);
    if (info?.customer?.name) row(facts, 'For', info.customer.url ? link(info.customer.name, info.customer.url) : info.customer.name);
    row(facts, 'Rocket', info?.rocketFull || launch.rocket);
    row(facts, 'Launched by', [launch.provider, info?.providerType ? info.providerType.toLowerCase() : ''].filter(Boolean).join(', '));
    if (info?.windowStartMs && info.windowEndMs) {
      row(facts, 'Window', info.windowEndMs - info.windowStartMs < 60000 ? `${clockStamp(info.windowStartMs)} (instantaneous)` : `${clockStamp(info.windowStartMs)} – ${clockStamp(info.windowEndMs).replace(/^.* (\d+:\d+)/, '$1')}`);
    }
    if (info?.probability !== null && info?.probability !== undefined) row(facts, 'Weather', `${info.probability}% go${info.weather ? ` · ${info.weather}` : ''}`);
    else row(facts, 'Weather', info?.weather);
    row(facts, 'Hold', info?.hold);
    page.append(facts);
    if (!info) page.append(el('p', 'note', 'More about this launch arrives with the next reading of the launch list (at most an hour).'));
  }

  private renderRecord(page: HTMLElement, launch: Launch): void {
    const counts = launch.info?.counts;
    const facts = el('dl', 'kv');
    if (counts?.provider) row(facts, `${launch.provider || 'Provider'}`, `${ordinal(counts.provider)} launch${counts.providerYear ? ` · ${ordinal(counts.providerYear)} this year` : ''}`);
    if (counts?.pad) row(facts, launch.pad || 'This pad', `${ordinal(counts.pad)} launch from it${counts.padYear ? ` · ${ordinal(counts.padYear)} this year` : ''}`);
    if (counts?.worldYear) row(facts, 'Worldwide', `${ordinal(counts.worldYear)} orbital launch this year`);
    if (facts.childElementCount > 0) page.append(facts);

    const links = el('div', 'lc-links');
    if (launch.pageUrl) links.append(link('Launch page · Space Launch Now', launch.pageUrl));
    if (launch.webcast) links.append(link(launch.netMs < Date.now() - 2 * 3600000 ? 'Recording of the webcast' : 'Webcast', launch.webcast));
    if (launch.info?.padUrl) links.append(link(`${launch.pad || 'The pad'} · Wikipedia`, launch.info.padUrl));
    if (launch.info?.customer?.url) links.append(link(`${launch.info.customer.name} · Wikipedia`, launch.info.customer.url));
    if (links.childElementCount > 0) {
      page.append(el('p', 'lc-label', 'Read more'), links);
    }
    const credit = el('p', 'note lc-credit');
    credit.append('Launch data and photo: ', link('Launch Library 2 by The Space Devs', 'https://thespacedevs.com/llapi'), '.');
    page.append(credit);
  }
}
