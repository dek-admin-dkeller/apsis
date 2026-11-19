/**
 * Places: leaving the tracker for the rest of the solar system, and coming back.
 *
 * The tracker is one place among many. This module owns the others: it switches the picture
 * to the scene in render/space/spaceView.ts, and draws the three pieces of interface that
 * exist only while the visitor is away from the tracker:
 *
 *   the place rail  where the tool rail was (a strip along the bottom on a phone): the map of
 *                   the solar system, then every body that can be visited, as small lit discs.
 *                   Choosing the Earth is the way back to the tracker.
 *   the card        facts about the body or spacecraft being looked at: how far it is from the
 *                   Earth right now, how long its signal takes, who is in orbit there.
 *   name tags       over the picture, one per body and craft (made by the view itself).
 *
 * While away, <body> carries `away`; space.css hides the tracker's own controls with it.
 * main.ts asks `away` before doing any Earth-only work, and never needs to know more.
 */

import '../space.css';
import type * as THREE from 'three';
import type { SceneKit } from '../render/scene.ts';
import { SpaceView, targetKey, type Target, type Where } from '../render/space/spaceView.ts';
import { BODIES, BODY_LIST } from '../space/bodies.ts';
import { craftPosition, loadDeep } from '../space/deep.ts';
import { watchDsn } from '../space/dsn.ts';
import { bodyRelative } from '../space/ephem.ts';
import { IMAGERY } from '../space/imagery.ts';
import type { Body, BodyId, Craft, DsnLink, Flyby, Motion, Vec } from '../space/types.ts';
import type { SearchHit } from './app.ts';
import { $, fmt, fmtInt, fmtKm, fmtKmS, lengthUnit, lengthValue } from './dom.ts';
import { clockStamp, duration } from './inspector.ts';

export interface PlacesHost {
  kit: SceneKit;
  /** The stars and Milky Way for the second scene (Sky.backdrop()). */
  backdrop: THREE.Group;
  time(): number;
  isPhone(): boolean;
  drift(): boolean;
  /** How well `query` matches any of `texts`, 0…1 (the search field's own scorer). */
  match(query: string, ...texts: string[]): number;
  /** Move the clock. */
  jumpTo(timeMs: number): void;
  /** The tracker's camera pulls straight back from the Earth, gathering speed, for `seconds`. */
  pullBack(seconds: number): void;
  /** How big the Earth looks in the tracker right now: its radius over the camera's distance. */
  apparent(): number;
  /**
   * About to leave the tracker (true) or just back in it (false): close panels, restart the
   * simulation … On the way back, `apparent` is how big the Earth looked where the visitor
   * came from, so the tracker can open with it the same size.
   */
  onAway(away: boolean, apparent?: number): void;
  toast(text: string): void;
}

const LIGHT_KM_S = 299792.458;
const AU = 149597870.7;
const MOON_KM = 384400;
const DAY = 86400000;

/**
 * An asteroid passing the Earth, dressed as a craft (see Craft.passing) so that the views can
 * draw, name, find and follow it with the code they already have. Only fly-bys whose path was
 * fetched (a few of the closest) can be shown.
 */
function rockCraft(flyby: Flyby): Craft | null {
  const motion = (flyby as Flyby & { motion?: Motion }).motion;
  if (!motion) return null;
  return {
    id: `asteroid-${flyby.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: `Asteroid ${flyby.name}`,
    short: flyby.name,
    aliases: [flyby.name.toLowerCase(), 'asteroid'],
    centre: 'earth',
    model: 'asteroid',
    status: 'active',
    agency: '',
    launched: '',
    role: 'Asteroid passing the Earth',
    blurb: 'A near-Earth asteroid on a path that brings it past the Earth. Its track here is the one NASA’s Jet Propulsion Laboratory predicts.',
    wiki: '',
    dsn: [],
    motion,
    passing: flyby,
  };
}

/** A long distance in words: "384,400 km", "1.67 million km", "24.9 billion km" (or miles). */
function farText(km: number): string {
  const value = lengthValue(km);
  if (value < 1e6) return fmtKm(km);
  if (value < 1e9) return `${fmt(value / 1e6, value < 1e7 ? 2 : value < 1e8 ? 1 : 0)} million ${lengthUnit()}`;
  return `${fmt(value / 1e9, value < 1e10 ? 2 : 1)} billion ${lengthUnit()}`;
}

function spanText(days: number): string {
  const d = Math.abs(days);
  if (d < 2) return `${fmt(d * 24, 1)} hours`;
  if (d < 800) return `${fmt(d, d < 20 ? 2 : 0)} days`;
  return `${fmt(d / 365.25, d < 3652 ? 2 : 0)} years`;
}

const kindText = (body: Body): string =>
  body.kind === 'star' ? 'Star' : body.kind === 'planet' ? 'Planet' : body.kind === 'dwarf' ? 'Dwarf planet' : `Moon of ${BODIES[body.parent!].name}`;

const wikiLink = (title: string): string => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

const reduced = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export class Places {
  private readonly host: PlacesHost;
  private readonly view: SpaceView;
  private readonly rail = $('place-rail');
  private readonly card = $('place-card');
  private readonly fade = $('space-fade');
  private crafts: Craft[] = [];
  private shown: Target | null = null; // what the card is about
  private links: DsnLink[] = [];
  private stopDsn: (() => void) | null = null;
  private liveAt = 0;
  private live: (() => void) | null = null; // refreshes the card's moving numbers
  private switching = false;

  constructor(host: PlacesHost) {
    this.host = host;
    this.view = new SpaceView(host.kit, host.backdrop, {
      tags: $('space-tags'),
      onPick: (target) => this.pick(target),
      onOpen: (target) => this.open(target),
      isPhone: host.isPhone,
      drift: host.drift,
    });
    this.buildRail();
    $('pc-close').addEventListener('click', () => {
      // Closing the card of a craft also stops following it; closing a body's card just puts the card away.
      if (this.shown?.kind === 'craft' && this.view.where) this.view.setFocus(null, host.time());
      this.show(null);
    });
    for (const button of document.querySelectorAll<HTMLElement>('[data-places-open]')) button.addEventListener('click', () => this.go({ kind: 'system' }));
    void loadDeep().then((deep) => {
      if (!deep) return;
      this.crafts = [...deep.craft, ...deep.flybys.map(rockCraft).filter((rock): rock is Craft => rock !== null)];
      this.view.setCraft(this.crafts, host.time());
    });
  }

  // ---- state the rest of the program may ask about ---------------------------------------------

  /** Is something other than the tracker on screen? */
  get away(): boolean {
    return this.view.active;
  }
  get drifting(): boolean {
    return this.view.drifting;
  }
  /** Is the card open (the idle fade waits while something is being read)? */
  get reading(): boolean {
    return !this.card.classList.contains('is-hidden');
  }

  // ---- going places ----------------------------------------------------------------------------

  /** Show the map or a place (fading through black), optionally looking at one thing there. */
  go(where: Where, focus: Target | null = null): void {
    if (this.switching) return;
    if (where.kind === 'place' && where.body === 'earth' && !focus) return this.home();
    const current = this.view.where;
    const same = current !== null && current.kind === where.kind && (where.kind === 'system' || (current as { body: BodyId }).body === where.body);
    if (same) {
      this.view.setFocus(focus, this.host.time());
      this.show(focus ?? this.defaultTarget(where));
      return;
    }
    // The move starts in the scene the visitor is in and finishes in the next one. Towards a
    // body from the map it is a dive at that body's dot; any other way it is a pull back.
    const diving = current?.kind === 'system' && where.kind === 'place' && !focus;
    const from: BodyId = current?.kind === 'place' ? current.body : 'earth';
    this.through(diving ? where.body : null, (apparent) => {
      if (!this.view.active) {
        this.host.onAway(true);
        document.body.classList.add('away');
        this.rail.classList.remove('is-hidden');
        this.stopDsn = watchDsn((links) => {
          this.links = links;
          this.markLinked();
        });
      }
      this.view.enter(where, this.host.time(), focus, true, apparent);
      // Out to the map: it opens right beside the world just left and draws back from it.
      if (where.kind === 'system' && !focus && !reduced()) this.view.emergeFrom(from, apparent);
      this.markLinked();
      this.markRail();
      this.show(focus ?? this.defaultTarget(where));
    });
  }

  /** Back to the tracker. */
  home(): void {
    if (!this.view.active || this.switching) return;
    const fromMap = this.view.where?.kind === 'system';
    this.through(fromMap ? 'earth' : null, (apparent) => this.leaveNow(fromMap ? apparent : 0));
  }

  /** Escape: stop looking at one thing; from a place, out to the map; from the map, back to the tracker. */
  back(): void {
    const where = this.view.where;
    if (!where) return;
    if (this.view.focus && !(where.kind === 'place' && this.view.focus.kind === 'body' && this.view.focus.body.id === where.body)) this.pick(null);
    else if (where.kind === 'place') this.go({ kind: 'system' });
    else this.home();
  }

  /** The same, at once and without the fade (the logo's "put everything back"). */
  leaveNow(apparent = 0): void {
    if (!this.view.active) return;
    this.view.leave();
    this.stopDsn?.();
    this.stopDsn = null;
    document.body.classList.remove('away');
    this.rail.classList.add('is-hidden');
    this.show(null);
    this.host.onAway(false, apparent);
  }

  /** Look at one craft, wherever it is: in its body's place, or on the map if it is out between the planets. */
  showCraft(craft: Craft): void {
    const target: Target = { kind: 'craft', craft };
    // An asteroid can only be shown around its pass: go to a little before its closest moment.
    if (craft.passing && Math.abs(this.host.time() - craft.passing.timeMs) > 2 * DAY) this.host.jumpTo(craft.passing.timeMs - 40 * 60000);
    if (craft.centre === 'sun' && !this.nearSun(craft)) this.go({ kind: 'system' }, target);
    else this.go({ kind: 'place', body: craft.centre }, target);
  }

  private nearSun(craft: Craft): boolean {
    const p = craftPosition(craft, this.host.time()).pos;
    return Math.hypot(p[0], p[1], p[2]) < 1.1 * AU;
  }

  /** What the card shows when nothing in particular is selected: the place itself; on the map, nothing. */
  private defaultTarget(where: Where): Target | null {
    return where.kind === 'place' ? { kind: 'body', body: BODIES[where.body] } : null;
  }

  /**
   * Change the scene as one camera move. The camera sets off in the scene on screen (a dive at
   * `towards` on the map, otherwise a pull straight back), gathering speed; at its fastest the
   * picture dips to black for a moment, the scene is changed behind that, and the new scene
   * opens with its camera already moving and settling into place. With "reduce motion" set in
   * the system, only the dip.
   */
  private through(towards: BodyId | null, change: (apparent: number) => void): void {
    this.switching = true;
    const still = reduced();
    const lead = still ? 0 : 430; // how long the camera travels before the dip begins
    if (!still) {
      if (!this.view.active) this.host.pullBack(0.7);
      else if (towards) this.view.diveTo(towards, 0.7);
      else this.view.pullBack(0.7);
    }
    setTimeout(() => this.fade.classList.add('is-on'), lead);
    setTimeout(() => {
      try {
        // How big the thing in the middle looks at this moment (0 = unknown: use the usual distance).
        const apparent = still ? 0 : this.view.active ? (towards || this.view.where?.kind === 'place' ? this.view.apparentOf(towards ?? undefined) : 0) : this.host.apparent();
        change(apparent);
      } finally {
        // Two frames, so the new scene has been drawn once before the curtain lifts.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          this.fade.classList.remove('is-on');
          this.switching = false;
        }));
      }
    }, lead + 240);
  }

  /** A click on something in the picture (or on nothing). */
  private pick(target: Target | null): void {
    const where = this.view.where;
    if (!where) return;
    this.view.setFocus(target, this.host.time());
    this.show(target ?? this.defaultTarget(where));
  }

  /** A double-click: go to that body; a craft is simply looked at. */
  private open(target: Target): void {
    if (target.kind === 'craft') return this.pick(target);
    if (target.body.id === 'earth') return this.home();
    if (target.body.visitable) this.go({ kind: 'place', body: target.body.id });
    else this.pick(target);
  }

  // ---- every frame -----------------------------------------------------------------------------

  update(dt: number, tMs: number, realSeconds: number): void {
    this.view.update(dt, tMs, realSeconds);
    if (this.live && realSeconds - this.liveAt > 0.5) {
      this.liveAt = realSeconds;
      this.live();
    }
  }

  /** Units or clock changed in Settings: redraw the card. */
  refreshUnits(): void {
    if (this.shown) this.show(this.shown);
  }

  // ---- the place rail --------------------------------------------------------------------------

  private buildRail(): void {
    const map = el('button', 'pr-item pr-map');
    map.type = 'button';
    map.dataset.place = 'system';
    map.title = 'The solar system';
    map.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="1.8"/><ellipse cx="10" cy="10" rx="8.2" ry="3.4"/><ellipse cx="10" cy="10" rx="5" ry="2"/><circle cx="16.6" cy="8" r="1"/></svg><span>System</span>';
    map.addEventListener('click', () => this.go({ kind: 'system' }));
    this.rail.append(map);
    for (const body of BODY_LIST) {
      if (!body.visitable) continue;
      const item = el('button', body.kind === 'moon' ? 'pr-item is-moon' : 'pr-item');
      item.type = 'button';
      item.dataset.place = body.id;
      item.title = body.id === 'earth' ? 'Earth: back to the live tracker' : body.name;
      const disc = el('i', `pr-disc pr-${body.id}`);
      const [r, g, b] = body.color.map((c) => Math.round(c * 255));
      disc.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
      const picture = IMAGERY[body.id]?.base.replace(/\.(jpg|webp|png)$/, '_s.$1');
      if (picture) disc.style.backgroundImage = `url("${picture}")`;
      item.append(disc, el('span', '', body.name));
      item.addEventListener('click', () => this.go({ kind: 'place', body: body.id }));
      this.rail.append(item);
    }
  }

  private markRail(): void {
    const where = this.view.where;
    const on = where ? (where.kind === 'system' ? 'system' : where.body) : '';
    for (const item of this.rail.querySelectorAll<HTMLElement>('.pr-item')) {
      const active = item.dataset.place === on;
      item.classList.toggle('is-on', active);
      if (active) item.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }

  /** Craft that a Deep Space Network dish is talking to right now get a small live mark on their tag. */
  private markLinked(): void {
    const names = new Set(this.links.filter((link) => link.up || link.down).map((link) => link.craft.toUpperCase()));
    const linked = new Set(this.crafts.filter((craft) => craft.dsn.some((name) => names.has(name.toUpperCase()))).map((craft) => `craft:${craft.id}`));
    this.view.setLinked(linked);
    if (this.shown?.kind === 'craft') this.refreshLive();
  }

  // ---- the card --------------------------------------------------------------------------------

  private show(target: Target | null): void {
    this.shown = target;
    this.live = null;
    this.card.classList.toggle('is-hidden', !target);
    // Keep what is being looked at clear of the card: above it on a phone, beside it on a computer.
    if (!target) this.view.setShift(0, 0);
    else if (this.host.isPhone()) this.view.setShift(0, 0.17);
    else this.view.setShift(0.07, 0);
    if (!target) return;
    const body = $('pc-body');
    body.replaceChildren();
    if (target.kind === 'body') this.bodyCard(target.body, body);
    else this.craftCard(target.craft, body);
    body.scrollTop = 0;
    this.refreshLive();
  }

  /** Fill in the card's moving numbers now (the card's builder leaves a function for that in `live`). */
  private refreshLive(): void {
    this.live?.();
  }

  private facts(rows: [string, HTMLElement | string][]): HTMLElement {
    const list = el('dl', 'kv');
    for (const [name, value] of rows) {
      const row = el('div');
      const dd = el('dd', 'plain');
      dd.append(value);
      row.append(el('dt', '', name), dd);
      list.append(row);
    }
    return list;
  }

  private bodyCard(body: Body, into: HTMLElement): void {
    const where = this.view.where;
    const here = where?.kind === 'place' && where.body === body.id;
    $('pc-name').textContent = body.name;
    $('pc-kind').textContent = kindText(body);

    const distance = el('span'), light = el('span');
    const rows: [string, HTMLElement | string][] = [];
    if (body.id !== 'earth') rows.push(['From Earth now', distance], ['Light takes', light]);
    rows.push(['Diameter', fmtKm(body.radiusKm * 2)]);
    if (body.dayHours) rows.push(['Turns once in', `${spanText(body.dayHours / 24)}${body.dayHours < 0 ? ', backwards' : ''}`]);
    if (body.parent) rows.push([`Round ${body.parent === 'sun' ? 'the Sun' : BODIES[body.parent].name} in`, spanText(body.periodDays)]);
    into.append(this.facts(rows));
    const vec: Vec = [0, 0, 0];
    this.live = () => {
      if (body.id === 'earth') return;
      const p = bodyRelative(body.id, 'earth', this.host.time(), vec);
      const km = Math.hypot(p[0], p[1], p[2]);
      distance.textContent = farText(km);
      light.textContent = duration((km / LIGHT_KM_S) * 1000);
    };

    if (!here) {
      const go = el('button', 'btn pc-go', body.id === 'earth' ? 'Open the live tracker' : `Go to ${body.id === 'sun' || body.id === 'moon' ? 'the ' : ''}${body.name}`);
      go.type = 'button';
      if (body.id === 'earth') go.addEventListener('click', () => this.home());
      else if (body.visitable) go.addEventListener('click', () => this.go({ kind: 'place', body: body.id }));
      else go.remove();
      if (body.id === 'earth' || body.visitable) into.append(go);
    } else if (body.id === 'earth') {
      const go = el('button', 'btn pc-go', 'Open the live tracker');
      go.type = 'button';
      go.addEventListener('click', () => this.home());
      into.append(go);
    }

    const crafts = this.crafts.filter((craft) => craft.centre === body.id && !craft.passing && (body.id !== 'sun' || this.nearSun(craft)));
    if (crafts.length > 0) {
      into.append(el('h3', 'pc-label', body.id === 'earth' ? 'Beyond Earth orbit' : `Spacecraft here`));
      into.append(this.craftList(crafts));
    }
    const rocks = this.crafts.filter((craft) => craft.centre === body.id && craft.passing && Math.abs(craft.passing.timeMs - this.host.time()) < 3 * DAY);
    if (rocks.length > 0) {
      into.append(el('h3', 'pc-label', 'Asteroids passing'));
      into.append(this.craftList(rocks));
    }
    const moons = BODY_LIST.filter((other) => other.parent === body.id && other.kind === 'moon');
    if (moons.length > 0) {
      into.append(el('h3', 'pc-label', moons.length === 1 ? 'Moon' : 'Moons'));
      const row = el('div', 'pc-chips');
      for (const moon of moons) {
        const chip = el('button', 'pc-chip', moon.name);
        chip.type = 'button';
        chip.addEventListener('click', () => (moon.visitable ? this.go({ kind: 'place', body: moon.id }) : this.pick({ kind: 'body', body: moon })));
        row.append(chip);
      }
      into.append(row);
    }
    into.append(el('p', 'pc-blurb', body.blurb), this.wiki(body.wiki));
  }

  private craftList(crafts: Craft[]): HTMLElement {
    const list = el('ul', 'pc-list');
    for (const craft of crafts) {
      const row = el('li');
      const button = el('button', craft.status === 'silent' ? 'is-silent' : '');
      button.type = 'button';
      button.append(el('b', '', craft.short), el('span', '', craft.passing ? `${fmt(craft.passing.distanceKm / MOON_KM, 1)} × the Moon’s distance` : craft.role));
      button.addEventListener('click', () => this.showCraft(craft));
      row.append(button);
      list.append(row);
    }
    return list;
  }

  private craftCard(craft: Craft, into: HTMLElement): void {
    $('pc-name').textContent = craft.name;
    $('pc-kind').textContent = craft.agency ? `${craft.role} · ${craft.agency}` : craft.role;
    const pass = craft.passing;
    const centre = BODIES[craft.centre];
    const contact = el('p', 'pc-contact');
    const distance = el('span'), light = el('span'), fromCentre = el('span'), speed = el('span');
    const year = Number(craft.launched.slice(0, 4));
    const surface = craft.motion.type === 'surface';
    const rows: [string, HTMLElement | string][] = [['From Earth now', distance], ['Its signal takes', light]];
    if (!surface && craft.centre !== 'earth') rows.push([craft.centre === 'sun' ? 'From the Sun' : `Above ${centre.name}`, fromCentre]);
    if (!surface) rows.push([`Speed past ${craft.centre === 'sun' ? 'the Sun' : centre.name}`, speed]);
    if (pass) {
      rows.length = 0;
      rows.push(['From Earth now', distance], ['Closest', clockStamp(pass.timeMs)], ['Misses by', `${fmtKm(pass.distanceKm)} (${fmt(pass.distanceKm / MOON_KM, 1)} × the Moon)`],
        ['Speed past Earth', speed], ['Size', `${fmtInt(pass.sizeM[0])} – ${fmtInt(pass.sizeM[1])} m`]);
    } else {
      rows.push(['Launched', `${year} (${fmtInt(new Date(this.host.time()).getUTCFullYear() - year)} years ago)`]);
    }
    const held = el('p', 'note');
    into.append(contact, this.facts(rows), held);

    const a: Vec = [0, 0, 0], b: Vec = [0, 0, 0], c: Vec = [0, 0, 0];
    this.live = () => {
      const t = this.host.time();
      const now = craftPosition(craft, t, a);
      const centreFromEarth = bodyRelative(craft.centre, 'earth', t, c);
      const km = Math.hypot(now.pos[0] + centreFromEarth[0], now.pos[1] + centreFromEarth[1], now.pos[2] + centreFromEarth[2]);
      distance.textContent = farText(km);
      light.textContent = duration((km / LIGHT_KM_S) * 1000);
      const r = Math.hypot(now.pos[0], now.pos[1], now.pos[2]);
      fromCentre.textContent = farText(craft.centre === 'sun' ? r : Math.max(0, r - centre.radiusKm));
      const next = craftPosition(craft, t + 1000, b).pos;
      speed.textContent = fmtKmS(Math.hypot(next[0] - now.pos[0], next[1] - now.pos[1], next[2] - now.pos[2]));
      held.textContent = !now.held ? '' : pass ? 'Its path is only known for a few days either side of the pass.' : 'Outside the span its path is predicted for: shown where the prediction ends.';

      const names = new Set(craft.dsn.map((name) => name.toUpperCase()));
      const link = this.links.find((candidate) => names.has(candidate.craft.toUpperCase()) && (candidate.up || candidate.down));
      contact.className = `pc-contact ${link ? 'is-live' : craft.status === 'silent' ? 'is-silent' : ''}`;
      contact.textContent = link
        ? `In contact now · ${link.site} ${link.dish} ${link.up && link.down ? 'sending and receiving' : link.down ? 'receiving' : 'sending'}`
        : craft.status === 'silent' ? 'No longer answering' : '';
    };

    const where = this.view.where;
    if (where?.kind === 'place') {
      const back = el('button', 'link pc-back', `Back to ${centre.id === 'sun' || centre.id === 'moon' ? 'the ' : ''}${centre.name}`);
      back.type = 'button';
      back.addEventListener('click', () => this.pick(null));
      into.append(back);
    }
    into.append(el('p', 'pc-blurb', craft.blurb));
    if (craft.wiki) into.append(this.wiki(craft.wiki));
  }

  private wiki(title: string): HTMLElement {
    const link = el('a', 'link pc-wiki', 'Wikipedia');
    link.href = wikiLink(title);
    link.target = '_blank';
    link.rel = 'noopener';
    return link;
  }

  // ---- search and links ------------------------------------------------------------------------

  /** Bodies and craft for the search field (App.addSearch). */
  search(query: string): SearchHit[] {
    const hits: SearchHit[] = [];
    const system = this.host.match(query, 'solar system', 'planets', 'the solar system', 'map of the solar system');
    if (system > 0) hits.push({ title: 'The solar system', note: 'Map', group: 'Beyond Earth orbit', score: system, run: () => this.go({ kind: 'system' }) });
    for (const body of BODY_LIST) {
      const score = this.host.match(query, body.name, ...(body.id === 'moon' ? ['the moon', 'luna'] : body.id === 'sun' ? ['the sun'] : []));
      if (score <= 0 || body.id === 'earth') continue;
      hits.push({
        title: body.name,
        note: kindText(body),
        group: 'Beyond Earth orbit',
        score,
        run: () => (body.visitable ? this.go({ kind: 'place', body: body.id }) : this.go({ kind: 'place', body: body.parent! }, { kind: 'body', body })),
      });
    }
    for (const craft of this.crafts) {
      const score = this.host.match(query, craft.name, craft.short, ...craft.aliases);
      if (score > 0) hits.push({ title: craft.name, note: craft.role, group: 'Beyond Earth orbit', score, run: () => this.showCraft(craft) });
    }
    return hits.sort((p, q) => q.score - p.score).slice(0, 8);
  }

  /** What to add to a share link so that it opens here: `place=mars`, `craft=webb`. */
  linkParams(q: URLSearchParams): void {
    const where = this.view.where;
    if (!where) return;
    q.set('place', where.kind === 'system' ? 'system' : where.body);
    if (this.view.focus?.kind === 'craft') q.set('craft', this.view.focus.craft.id);
  }

  /** Open what a share link describes. False if it says nothing about places. */
  async applyLink(q: URLSearchParams): Promise<boolean> {
    const place = q.get('place'), craftId = q.get('craft');
    if (!place && !craftId) return false;
    const deep = await loadDeep();
    const craft = deep?.craft.find((candidate) => candidate.id === craftId);
    if (craft) this.showCraft(craft);
    else if (place === 'system') this.go({ kind: 'system' });
    else if (place && place in BODIES && BODIES[place as BodyId].visitable && place !== 'earth') this.go({ kind: 'place', body: place as BodyId });
    else return false;
    return true;
  }

  /** The key of what the card shows (for tests and for deciding whether a card is open). */
  get showing(): string {
    return this.shown ? targetKey(this.shown) : '';
  }
}
