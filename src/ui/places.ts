/**
 * Places: leaving the tracker for the rest of the solar system, and coming back.
 *
 * There are three kinds of picture, and the visitor moves between them by zooming:
 *
 *   the tracker        the Earth with everything in orbit round it (the rest of the app)
 *   a place            another body, close up and at true scale, with its moons and spacecraft
 *   the solar system   every planet on its orbit; the camera either beside one body's dot or
 *                      drawn back to the whole picture
 *
 * Going out, the camera pulls back from the world on screen, what belongs to that world fades
 * away, and what is left is that same world as a dot on the solar system, still in the middle
 * of the screen, still lit and turned the same way under the same stars. Going in is the
 * reverse: click a planet and the camera goes up to its dot; go on (click it again, zoom in,
 * or the button on its card) and the camera carries on in while that world's moons and
 * spacecraft appear round it. There is no cut and no menu of planets: the picture is the menu.
 *
 * How the join is hidden: each kind of picture is a scene of its own (the tracker's, and two
 * SpaceViews), and for the half second of a change two of them are drawn at once and
 * dissolved (SceneKit.blend) while the incoming scene's camera is held in the same position
 * relative to the body as the outgoing one's (SpaceView's "pose"). Both pictures then show
 * the same body, the same size, under the same sky; only its surroundings differ.
 *
 * This module also draws what is on screen only while away from the tracker: the card about
 * the body or craft being looked at, and the list of what is at a place (the tool rail's
 * "Objects" button opens it there). <body> carries `away` while the tracker is not the
 * picture, and `on-map` on the solar system; space.css hides the tracker's own controls.
 */

import '../space.css';
import type * as THREE from 'three';
import type { OtherView, SceneKit } from '../render/scene.ts';
import { MAP_REST, PLACE_REST, PLACE_REST_PHONE, SpaceView, targetKey, type Pose, type SpaceHost, type Target } from '../render/space/spaceView.ts';
import { BODIES, BODY_LIST } from '../space/bodies.ts';
import { craftPosition, loadDeep } from '../space/deep.ts';
import { watchDsn } from '../space/dsn.ts';
import { bodyRelative } from '../space/ephem.ts';
import type { Body, BodyId, Craft, DsnLink, Flyby, Motion, Vec } from '../space/types.ts';
import type { SearchHit } from './app.ts';
import { $, fmt, fmtInt, fmtKm, fmtKmS, lengthUnit, lengthValue } from './dom.ts';
import { clockStamp, duration } from './inspector.ts';

export interface PlacesHost {
  kit: SceneKit;
  /** A copy of the stars and Milky Way for another scene (Sky.backdrop()); called once per view. */
  backdrop(): THREE.Group;
  time(): number;
  isPhone(): boolean;
  drift(): boolean;
  /** How well `query` matches any of `texts`, 0…1 (the search field's own scorer). */
  match(query: string, ...texts: string[]): number;
  /** Move the clock. */
  jumpTo(timeMs: number): void;
  toast(text: string): void;

  // ---- the tracker's side of a change of scene -------------------------------------------------
  /** The tracker's scene, for a dissolve into it. */
  trackerView(): OtherView;
  /** Where the tracker's camera is relative to the Earth. */
  trackerPose(): Pose;
  /** Hold the tracker's camera at a pose (every frame of a dissolve into it), or give it back with null. */
  holdTracker(pose: Pose | null): void;
  /** The tracker's camera moves away from the Earth by `factor`, gathering speed, over `seconds`. */
  surge(factor: number, seconds: number): void;
  /** …or carries on from wherever it is to the whole-Earth view, slowing down. */
  settle(seconds: number): void;
  /** About to leave the tracker: put its panels, selection and special views away. */
  leaving(): void;
  /** The tracker has stopped being drawn at all (true), or is about to be drawn again (false). */
  onAway(away: boolean): void;
}

type Spot = 'tracker' | 'place' | 'map';
type Destination =
  | { kind: 'tracker' }
  | { kind: 'map'; focus?: Target | null }
  | { kind: 'place'; body: BodyId; focus?: Target | null };

interface Mix {
  from: Spot;
  to: Spot;
  keyFrom: string | null;
  keyTo: string | null;
  start: number;
  seconds: number;
  done: () => void;
}

const LIGHT_KM_S = 299792.458;
const AU = 149597870.7;
const MOON_KM = 384400;
const DAY = 86400000;
const FADE = 0.5; // seconds two scenes are on screen together
const MOVE = 0.95; // seconds the camera travels before a scene has changed

const wait = (seconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, seconds * 1000));
const reduced = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
const theName = (body: Body): string => `${body.id === 'sun' || body.id === 'moon' ? 'the ' : ''}${body.name}`;
const wikiLink = (title: string): string => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export class Places {
  private readonly host: PlacesHost;
  private readonly place: SpaceView;
  private readonly map: SpaceView;
  private readonly card = $('place-card');
  private readonly here = $('panel-here');
  private spot: Spot = 'tracker';
  private trackerOn = true; // the tracker's scene is being drawn (alone, or as one side of a change)
  private mix: Mix | null = null;
  private busy = false;
  private crafts: Craft[] = [];
  private shown: Target | null = null; // what the card is about
  private links: DsnLink[] = [];
  private stopDsn: (() => void) | null = null;
  private liveAt = 0;
  private live: (() => void) | null = null; // refreshes the card's moving numbers

  constructor(host: PlacesHost) {
    this.host = host;
    const side = (view: () => SpaceView): SpaceHost => ({
      tags: $('space-tags'),
      onPick: (target) => this.pick(view(), target),
      onOpen: (target) => this.open(target),
      onOut: () => this.openSystem(),
      isPhone: host.isPhone,
      drift: host.drift,
    });
    this.place = new SpaceView(host.kit, host.backdrop(), side(() => this.place));
    this.map = new SpaceView(host.kit, host.backdrop(), side(() => this.map));
    $('pc-close').addEventListener('click', () => this.closeCard());
    for (const button of document.querySelectorAll<HTMLElement>('[data-places-open]')) button.addEventListener('click', () => this.openSystem());
    void loadDeep().then((deep) => {
      if (!deep) return;
      this.crafts = [...deep.craft, ...deep.flybys.map(rockCraft).filter((rock): rock is Craft => rock !== null)];
      this.place.setCraft(this.crafts, host.time());
      this.map.setCraft(this.crafts, host.time());
      if (this.spot === 'place') this.fillHere();
    });
  }

  // ---- state the rest of the program may ask about ---------------------------------------------

  /** Is the tracker out of the picture altogether (so none of its work needs doing)? */
  get away(): boolean {
    return !this.trackerOn;
  }
  /** Is the tracker NOT what the visitor is looking at and using (it may still be fading in or out)? */
  get elsewhere(): boolean {
    return this.spot !== 'tracker';
  }
  /** Does update() need calling this frame? */
  get active(): boolean {
    return this.spot !== 'tracker' || this.mix !== null;
  }
  /** At a place, as opposed to on the solar system: the tool rail is on screen there. */
  get atPlace(): boolean {
    return this.spot === 'place';
  }
  get drifting(): boolean {
    return this.spot === 'place' ? this.place.drifting : this.spot === 'map' ? this.map.drifting : false;
  }

  private view(spot: Spot): SpaceView {
    return spot === 'map' ? this.map : this.place;
  }
  private get current(): SpaceView | null {
    return this.spot === 'tracker' ? null : this.view(this.spot);
  }

  // ---- every frame -----------------------------------------------------------------------------
  //
  // Two halves, because in a dissolve one camera follows another and the leader must move
  // first: lead() moves the cameras that move themselves (and, when the tracker is the scene
  // coming in, tells it where to be); main.ts then moves the tracker's own camera; follow()
  // puts the scene that is coming in where the tracker's camera now is, and sets the dissolve.

  lead(dt: number, tMs: number, realSeconds: number): void {
    const mix = this.mix;
    if (this.spot !== 'tracker') this.view(this.spot).update(dt, tMs, realSeconds);
    if (mix && mix.from !== 'tracker') {
      const pose = this.view(mix.from).pose(mix.keyFrom);
      if (pose && mix.to === 'tracker') this.host.holdTracker(pose);
      else if (pose) this.view(mix.to).update(dt, tMs, realSeconds, { key: mix.keyTo, pose });
    }
    if (this.live && realSeconds - this.liveAt > 0.5) {
      this.liveAt = realSeconds;
      this.live();
    }
  }

  follow(dt: number, tMs: number, realSeconds: number): void {
    const mix = this.mix;
    if (!mix) return;
    if (mix.from === 'tracker') this.view(mix.to).update(dt, tMs, realSeconds, { key: mix.keyTo, pose: this.host.trackerPose() });
    const t = Math.min(1, (performance.now() - mix.start) / (mix.seconds * 1000));
    this.host.kit.blend(mix.to === 'tracker' ? this.host.trackerView() : this.view(mix.to).view, t * t * (3 - 2 * t));
    if (t >= 1) mix.done();
  }

  /** Units or clock changed in Settings: redraw the card. */
  refreshUnits(): void {
    if (this.shown) this.show(this.shown);
  }

  /** The Layers switches for the sky apply everywhere. */
  setSky(stars: boolean, figures: boolean): void {
    this.place.setSky(stars, figures);
    this.map.setSky(stars, figures);
  }

  // ---- changing scene --------------------------------------------------------------------------

  /**
   * Dissolve from the scene on screen to another one, the incoming camera held to the outgoing
   * one, then make the new scene the one on screen.
   */
  private async dissolve(to: Spot, keyFrom: string | null, keyTo: string | null, seconds: number): Promise<void> {
    const from = this.spot;
    await new Promise<void>((done) => (this.mix = { from, to, keyFrom, keyTo, start: performance.now(), seconds, done }));
    this.mix = null;
    const { kit } = this.host;
    kit.blend(null);
    if (from !== 'tracker') this.view(from).setLive(false);
    if (to === 'tracker') {
      kit.show();
      this.host.holdTracker(null);
    } else {
      const view = this.view(to);
      kit.show(view.scene, view.camera, view.controls.target);
      view.setLive(true);
    }
    this.spot = to;
    if (from === 'tracker') {
      this.trackerOn = false;
      this.host.onAway(true);
    }
    if (from === 'place') this.place.clear(); // the map is kept; a place is rebuilt when next visited
    this.chrome();
  }

  /** What is on screen besides the picture follows where the visitor is. */
  private chrome(): void {
    const away = this.spot !== 'tracker';
    document.body.classList.toggle('away', away);
    document.body.classList.toggle('on-map', this.spot === 'map');
    this.here.classList.add('is-hidden');
    const where = this.spot === 'place' ? this.place.where : null;
    $('place-name').textContent = this.spot === 'map' ? 'Solar system' : where?.kind === 'place' ? BODIES[where.body].name : '';
    if (away && !this.stopDsn) {
      this.stopDsn = watchDsn((links) => {
        this.links = links;
        this.markLinked();
      });
    } else if (!away) {
      this.stopDsn?.();
      this.stopDsn = null;
      this.show(null);
    }
    if (this.spot === 'place') this.fillHere();
    this.markLinked();
  }

  /** The body the visitor is at: the place's, or the Earth in the tracker. */
  private get hereBody(): BodyId {
    const where = this.place.where;
    return this.spot === 'place' && where?.kind === 'place' ? where.body : 'earth';
  }

  /** Out of the tracker or a place to the solar system, coming to rest beside the world just left. */
  private async toMap(): Promise<void> {
    const body = this.hereBody;
    const t = this.host.time();
    if (this.spot === 'tracker') this.host.leaving();
    this.show(null);
    if (!this.map.where) this.map.build({ kind: 'system' }, t);
    const key = this.map.keyFor(body);
    if (!key) return;
    const dot: Target = { kind: 'body', body: BODIES[key.slice(5) as BodyId] };
    this.map.setFocus(dot, t, 0); // also gives the dot its full map, so the two pictures match
    // Pull back until the world is a little bigger than its dot will be at rest; the map then
    // carries the same movement on to rest.
    const now = this.spot === 'tracker' ? 1 / this.host.trackerPose().rel.length() : this.place.apparent(null);
    const rest = Math.min(MAP_REST, now / 1.6);
    const move = reduced() ? FADE : MOVE;
    const factor = Math.max(1.05, now / (rest * 1.3));
    if (this.spot === 'tracker') this.host.surge(factor, move);
    else this.place.surge(factor, move);
    await wait(move - FADE);
    await this.dissolve('map', null, key, FADE);
    this.map.settle(key, Math.min(rest, this.map.apparent(key) / 1.15), 1.7);
    this.show(dot);
  }

  /** On the solar system: bring the camera up to one body's dot (and wait until it is there). */
  private async toDot(body: BodyId): Promise<Target | null> {
    const key = this.map.keyFor(body);
    if (!key) return null;
    const dot: Target = { kind: 'body', body: BODIES[key.slice(5) as BodyId] };
    if (this.map.focus && targetKey(this.map.focus) === key && !this.map.flying) return dot;
    const already = this.map.focus !== null && targetKey(this.map.focus) === key;
    if (!already) this.map.setFocus(dot, this.host.time(), 1.5);
    this.show(dot);
    await wait(already ? 0.6 : 1.5);
    return dot;
  }

  /** From beside a body's dot on the solar system, on in to that body (or, the Earth, to the tracker). */
  private async fromMap(body: BodyId): Promise<void> {
    const dot = await this.toDot(body);
    if (!dot || dot.kind !== 'body' || dot.body.id !== body) return;
    const key = targetKey(dot);
    const t = this.host.time();
    const to: Spot = body === 'earth' ? 'tracker' : 'place';
    if (to === 'tracker') {
      this.trackerOn = true;
      this.host.onAway(false); // the simulation starts again now, so the satellites are there when the picture is
    } else {
      this.place.build({ kind: 'place', body }, t);
    }
    this.show(null);
    // Dive until the dot is nearly as big as the world will be at rest; the next scene carries on in.
    const rest = this.host.isPhone() ? PLACE_REST_PHONE : PLACE_REST;
    const now = this.map.apparent(key);
    const move = reduced() ? FADE : MOVE;
    this.map.surge(Math.min(0.95, now / (rest * 0.8)), move);
    await wait(move - FADE);
    await this.dissolve(to, key, null, FADE);
    if (to === 'tracker') {
      this.host.settle(2);
    } else {
      this.place.settle(null, Math.max(rest, this.place.apparent(null) * 1.12), 1.9);
      if (!this.host.isPhone()) this.show({ kind: 'body', body: BODIES[body] });
    }
  }

  /**
   * Between the tracker and the Earth as a place (the far view that holds what is beyond
   * Earth orbit: Webb, the asteroids): the same world in the same position, so only a dissolve.
   */
  private async acrossEarth(to: 'tracker' | 'place'): Promise<void> {
    if (to === 'place') {
      this.host.leaving();
      this.place.build({ kind: 'place', body: 'earth' }, this.host.time());
      await this.dissolve('place', null, null, FADE);
    } else {
      this.show(null);
      if (this.place.focus) {
        this.place.setFocus(null, this.host.time(), 1.4); // come back to the Earth first
        await wait(1.4);
      }
      this.trackerOn = true;
      this.host.onAway(false);
      await wait(0.25); // a few frames for the first positions
      await this.dissolve('tracker', null, null, FADE);
      this.host.settle(1.6);
    }
  }

  /** Go somewhere, by whatever chain of moves gets there from here. One journey at a time. */
  private async travel(to: Destination): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (to.kind === 'map') {
        if (this.spot !== 'map') await this.toMap();
        if (to.focus !== undefined) this.pick(this.map, to.focus);
      } else if (to.kind === 'tracker') {
        if (this.spot === 'tracker') return;
        if (this.spot === 'place' && this.hereBody === 'earth') await this.acrossEarth('tracker');
        else {
          if (this.spot !== 'map') await this.toMap();
          await this.fromMap('earth');
        }
      } else {
        const there = this.spot === 'place' && this.hereBody === to.body;
        if (!there) {
          if (to.body === 'earth' && this.spot === 'tracker') await this.acrossEarth('place');
          else {
            if (this.spot !== 'map') await this.toMap();
            await this.fromMap(to.body);
          }
        }
        if (this.spot === 'place' && to.focus) this.pick(this.place, to.focus);
      }
    } finally {
      this.busy = false;
    }
  }

  // ---- what the visitor can ask for --------------------------------------------------------------

  /** The "System" button, zooming out past the edge of a place, Escape: one step outwards. */
  openSystem(): void {
    if (this.spot === 'map') this.pick(this.map, null);
    else void this.travel({ kind: 'map' });
  }

  /** Escape: stop looking at one thing; from a place, out to the solar system; from there, out to all of it, then home. */
  back(): void {
    if (this.busy) return;
    if (this.spot === 'place' && this.place.focus) this.pick(this.place, null);
    else if (this.spot === 'place') void this.travel({ kind: 'map' });
    else if (this.spot === 'map' && this.map.focus) this.pick(this.map, null);
    else if (this.spot === 'map') void this.travel({ kind: 'tracker' });
  }

  /** Back to the tracker at once, no journey (the logo's "put everything back"). */
  leaveNow(): void {
    if (this.spot === 'tracker' && !this.mix) return;
    this.mix?.done();
    this.mix = null;
    const { kit } = this.host;
    kit.blend(null);
    kit.show();
    this.place.setLive(false);
    this.map.setLive(false);
    this.place.clear();
    this.spot = 'tracker';
    this.host.holdTracker(null);
    if (!this.trackerOn) {
      this.trackerOn = true;
      this.host.onAway(false);
    }
    this.chrome();
  }

  /**
   * Be somewhere at once, with no journey: for a link that opens the app at a place (nothing
   * was on screen before it, so there is nothing to move from).
   */
  private jump(to: Exclude<Destination, { kind: 'tracker' }>): void {
    if (this.busy) return;
    const t = this.host.time();
    if (this.spot === 'tracker') this.host.leaving();
    this.place.setLive(false);
    this.map.setLive(false);
    const view = to.kind === 'map' ? this.map : this.place;
    if (to.kind === 'map') {
      if (!this.map.where) this.map.build({ kind: 'system' }, t);
    } else {
      this.place.build({ kind: 'place', body: to.body }, t);
    }
    this.host.kit.blend(null);
    this.host.kit.show(view.scene, view.camera, view.controls.target);
    view.setLive(true);
    this.spot = to.kind;
    if (this.trackerOn) {
      this.trackerOn = false;
      this.host.onAway(true);
    }
    this.chrome();
    if (to.focus) {
      view.setFocus(to.focus, t, 0);
      this.show(to.focus);
    } else if (to.kind === 'place' && !this.host.isPhone()) {
      this.show({ kind: 'body', body: BODIES[to.body] });
    }
  }

  /** How many of the craft beyond Earth orbit are drawn with one kind of 3D model, and a way to go and see one. */
  countOf(model: string): number {
    return this.crafts.filter((craft) => craft.model === model).length;
  }
  showOne(model: string): boolean {
    const craft = this.crafts.find((candidate) => candidate.model === model && !candidate.passing) ?? this.crafts.find((candidate) => candidate.model === model);
    if (craft) this.showCraft(craft);
    return craft !== undefined;
  }

  /** Go to a body: its place, or for the Earth the tracker. */
  goBody(body: BodyId): void {
    if (body === 'earth') void this.travel({ kind: 'tracker' });
    else if (BODIES[body].visitable) void this.travel({ kind: 'place', body });
    else void this.travel({ kind: 'place', body: BODIES[body].parent!, focus: { kind: 'body', body: BODIES[body] } });
  }

  /** Look at one craft, wherever it is: in its body's place, or on the solar system if it is out between the planets. */
  showCraft(craft: Craft): void {
    const target: Target = { kind: 'craft', craft };
    // An asteroid can only be shown around its pass: go to a little before its closest moment.
    if (craft.passing && Math.abs(this.host.time() - craft.passing.timeMs) > 2 * DAY) this.host.jumpTo(craft.passing.timeMs - 40 * 60000);
    if (craft.centre === 'sun' && !this.nearSun(craft)) void this.travel({ kind: 'map', focus: target });
    else void this.travel({ kind: 'place', body: craft.centre, focus: target });
  }

  private nearSun(craft: Craft): boolean {
    const p = craftPosition(craft, this.host.time()).pos;
    return Math.hypot(p[0], p[1], p[2]) < 1.1 * AU;
  }

  /** A click on something in a view (or on nothing): look at it, and show its card. */
  private pick(view: SpaceView, target: Target | null): void {
    if (!view.where || (this.busy && view !== this.view(this.spot))) return;
    view.setFocus(target, this.host.time());
    if (target) this.show(target);
    else if (view === this.place && !this.host.isPhone()) this.show({ kind: 'body', body: BODIES[this.hereBody] });
    else this.show(null);
  }

  /** "Go there": a second click on what is being looked at, or zooming all the way in on it. */
  private open(target: Target): void {
    if (target.kind === 'craft') return;
    if (this.spot === 'place' && target.body.id === this.hereBody) return;
    this.goBody(target.body.id);
  }

  private closeCard(): void {
    // Closing the card of something being followed also lets go of it.
    const view = this.current;
    if (view?.focus) this.pick(view, null);
    this.show(null);
  }

  /** Craft that a Deep Space Network dish is talking to right now get a small live mark on their tag. */
  private markLinked(): void {
    const names = new Set(this.links.filter((link) => link.up || link.down).map((link) => link.craft.toUpperCase()));
    const linked = new Set(this.crafts.filter((craft) => craft.dsn.some((name) => names.has(name.toUpperCase()))).map((craft) => `craft:${craft.id}`));
    this.place.setLinked(linked);
    this.map.setLinked(linked);
    if (this.shown?.kind === 'craft') this.refreshLive();
  }

  // ---- the list of what is here (the rail's "Objects" button, at a place) ------------------------

  /** Open or close the list; true if it is now open. */
  toggleHere(open?: boolean): boolean {
    const show = open ?? this.here.classList.contains('is-hidden');
    this.here.classList.toggle('is-hidden', !show || this.spot !== 'place');
    return show && this.spot === 'place';
  }

  private fillHere(): void {
    const body = BODIES[this.hereBody];
    $('here-title').textContent = body.name;
    const into = $('here-body');
    into.replaceChildren();
    this.lists(body, into);
    if (!into.hasChildNodes()) into.append(el('p', 'note', 'Nothing in orbit here that is still being tracked.'));
  }

  /** The spacecraft, passing asteroids and moons of a body, as lists that take the visitor to each. */
  private lists(body: Body, into: HTMLElement): void {
    const crafts = this.crafts.filter((craft) => craft.centre === body.id && !craft.passing && (body.id !== 'sun' || this.nearSun(craft)));
    if (crafts.length > 0) into.append(el('h3', 'pc-label', body.id === 'earth' ? 'Beyond Earth orbit' : 'Spacecraft'), this.craftList(crafts));
    const rocks = this.crafts.filter((craft) => craft.centre === body.id && craft.passing && Math.abs(craft.passing.timeMs - this.host.time()) < 3 * DAY);
    if (rocks.length > 0) into.append(el('h3', 'pc-label', 'Asteroids passing'), this.craftList(rocks));
    const moons = BODY_LIST.filter((other) => other.parent === body.id && other.kind === 'moon');
    if (moons.length > 0) {
      const row = el('div', 'pc-chips');
      for (const moon of moons) {
        const chip = el('button', 'pc-chip', moon.name);
        chip.type = 'button';
        chip.addEventListener('click', () => this.goBody(moon.id));
        row.append(chip);
      }
      into.append(el('h3', 'pc-label', moons.length === 1 ? 'Moon' : 'Moons'), row);
    }
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

  // ---- the card --------------------------------------------------------------------------------

  private show(target: Target | null): void {
    this.shown = target;
    this.live = null;
    this.card.classList.toggle('is-hidden', !target);
    // Keep what is being looked at clear of the card: above it on a phone, beside it on a computer.
    const shift: [number, number] = !target ? [0, 0] : this.host.isPhone() ? [0, 0.17] : [0.07, 0];
    this.place.setShift(...shift);
    this.map.setShift(...shift);
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
    const here = this.spot === 'place' && this.hereBody === body.id;
    $('pc-name').textContent = body.name;
    $('pc-kind').textContent = kindText(body);

    // The way in comes first: on the solar system that is what the card is mostly for.
    if (!here && (body.id === 'earth' || body.visitable)) {
      const go = el('button', 'btn pc-go', body.id === 'earth' ? 'Open the live tracker' : `Go to ${theName(body)}`);
      go.type = 'button';
      go.addEventListener('click', () => this.goBody(body.id));
      into.append(go);
    } else if (here && body.id === 'earth') {
      const go = el('button', 'btn pc-go', 'Open the live tracker');
      go.type = 'button';
      go.addEventListener('click', () => this.goBody('earth'));
      into.append(go);
    }

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
    if (!here) this.lists(body, into); // at the place itself that list is the rail's "Objects" panel
    into.append(el('p', 'pc-blurb', body.blurb), this.wiki(body.wiki));
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
    if (system > 0) hits.push({ title: 'The solar system', note: 'Every planet, where it is now', group: 'Beyond Earth orbit', score: system, run: () => void this.travel({ kind: 'map', focus: null }) });
    for (const body of BODY_LIST) {
      const score = this.host.match(query, body.name, ...(body.id === 'moon' ? ['the moon', 'luna'] : body.id === 'sun' ? ['the sun'] : []));
      if (score <= 0 || body.id === 'earth') continue;
      hits.push({ title: body.name, note: kindText(body), group: 'Beyond Earth orbit', score, run: () => this.goBody(body.id) });
    }
    for (const craft of this.crafts) {
      const score = this.host.match(query, craft.name, craft.short, ...craft.aliases);
      if (score > 0) hits.push({ title: craft.name, note: craft.role, group: 'Beyond Earth orbit', score, run: () => this.showCraft(craft) });
    }
    return hits.sort((p, q) => q.score - p.score).slice(0, 8);
  }

  /** What to add to a share link so that it opens here: `place=mars`, `craft=webb`. */
  linkParams(q: URLSearchParams): void {
    if (this.spot === 'tracker') return;
    q.set('place', this.spot === 'map' ? 'system' : this.hereBody);
    const focus = this.current?.focus;
    if (focus?.kind === 'craft') q.set('craft', focus.craft.id);
    else if (focus?.kind === 'body' && this.spot === 'map') q.set('at', focus.body.id);
  }

  /** Open what a share link describes. False if it says nothing about places. */
  async applyLink(q: URLSearchParams): Promise<boolean> {
    const place = q.get('place'), craftId = q.get('craft'), at = q.get('at');
    if (!place && !craftId) return false;
    const deep = await loadDeep();
    const craft = this.crafts.find((candidate) => candidate.id === craftId) ?? deep?.craft.find((candidate) => candidate.id === craftId);
    if (craft) {
      const focus: Target = { kind: 'craft', craft };
      if (craft.passing && Math.abs(this.host.time() - craft.passing.timeMs) > 2 * DAY) this.host.jumpTo(craft.passing.timeMs - 40 * 60000);
      if (craft.centre === 'sun' && !this.nearSun(craft)) this.jump({ kind: 'map', focus });
      else this.jump({ kind: 'place', body: craft.centre, focus });
    } else if (place === 'system') {
      this.jump({ kind: 'map', focus: at && at in BODIES ? { kind: 'body', body: BODIES[at as BodyId] } : null });
    } else if (place && place in BODIES && place !== 'earth' && BODIES[place as BodyId].visitable) {
      this.jump({ kind: 'place', body: place as BodyId });
    } else {
      return false;
    }
    return true;
  }
}
