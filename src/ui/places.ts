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
import { MAP_REST, PLACE_REST, PLACE_REST_PHONE, SpaceView, targetKey, type Pose, type SpaceHost, type SpaceOptions, type Target } from '../render/space/spaceView.ts';
import { wikiSummary } from '../data/wiki.ts';
import { BODIES, BODY_LIST } from '../space/bodies.ts';
import { craftPeriodMs, craftPosition, loadDeep } from '../space/deep.ts';
import { DSN_NOW_URL, watchDsn } from '../space/dsn.ts';
import { bodyAxes, bodyPosition, bodyRelative } from '../space/ephem.ts';
import { IMAGERY, UNSEEN } from '../space/imagery.ts';
import { loadRovers, onRoversRefresh, roverPath } from '../space/rovers.ts';
import { SITES } from '../space/sites.ts';
import type { Body, BodyId, Craft, DeepData, DsnLink, Flyby, Motion, Site, Vec } from '../space/types.ts';
import type { SearchHit } from './app.ts';
import { isModelKind } from '../data/describe.ts';
import { modelThumbnail } from '../render/satModels.ts';
import { $, fmt, fmtInt, fmtKm, fmtKmS, getUnits, lengthUnit, lengthValue } from './dom.ts';
import { clockStamp, duration } from './inspector.ts';
import { PlaceWatch } from './placeWatch.ts';

export interface PlacesHost {
  kit: SceneKit;
  /** A copy of the stars and Milky Way for another scene (Sky.backdrop()); called once per view. */
  backdrop(): THREE.Group;
  time(): number;
  isPhone(): boolean;
  drift(): boolean;
  /** The constellation figures: name and direction among the stars (Sky.constellations). */
  figures(): { name: string; direction: THREE.Vector3 }[];
  /** How well `query` matches any of `texts`, 0…1 (the search field's own scorer). */
  match(query: string, ...texts: string[]): number;
  /** Move the clock. */
  jumpTo(timeMs: number): void;
  /** Back to the present, at normal speed. */
  jumpToNow(): void;
  /** The tracker's own "put everything back" (the logo there). */
  home(): void;
  /** The hover card setting (Settings.hoverCard): one switch for the tracker and every place. */
  hoverCard(): boolean;
  /** Switch the screening cells on or off (one switch for the tracker and every place). */
  setGrid(on: boolean): void;
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

const SITE_KIND: Record<Site['kind'], string> = { crewed: 'Crewed landing', lander: 'Landing site', rover: 'Rover landing site', probe: 'Probe' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '1969-07-20' → '20 Jul 1969' (a day in history is the same day on any clock). */
function dayText(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return month && day ? `${day} ${MONTHS[month - 1]} ${year}` : String(year);
}
const yearsSince = (iso: string, nowMs: number): number => Math.max(0, Math.floor((nowMs - Date.parse(iso)) / (365.25 * DAY)));
/** A temperature in the unit that goes with the chosen length unit: °C with kilometres, °F with miles. */
const tempText = (c: number): string => (getUnits() === 'metric' ? `${fmtInt(c)} °C` : `${fmtInt(c * 1.8 + 32)} °F`);
const latLonText = (lat: number, lon: number): string => {
  const east = ((lon + 540) % 360) - 180;
  return `${fmt(Math.abs(lat), 1)}° ${lat >= 0 ? 'N' : 'S'}, ${fmt(Math.abs(east), 1)}° ${east >= 0 ? 'E' : 'W'}`;
};

/**
 * A historic landing site, dressed as a craft that stands on the ground (see Craft.site), so
 * the views can mark it, name it and show its card with the code they already have.
 */
function siteCraft(site: Site): Craft {
  return {
    id: `site-${site.id}`,
    name: site.name,
    short: site.name,
    aliases: [site.name.toLowerCase()],
    centre: site.body,
    model: site.model,
    status: 'silent',
    agency: site.agency,
    launched: site.date,
    role: SITE_KIND[site.kind],
    blurb: site.blurb,
    wiki: site.wiki,
    dsn: [],
    motion: { type: 'surface', latDeg: site.latDeg, lonDeg: site.lonDeg },
    site,
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
  private readonly hud = $('place-hud');
  private readonly watcher: PlaceWatch;
  private readonly pathEl = $('path');
  private shownSpot: Spot = 'tracker'; // what the page's chrome is set for (it changes when a move starts, ahead of `spot`)
  private shownBody: BodyId = 'earth';
  private prepareTimer = 0;
  private readonly tabAt = new Map<string, number>(); // the tab last open on a body's card and on a craft's
  private spot: Spot = 'tracker';
  private trackerOn = true; // the tracker's scene is being drawn (alone, or as one side of a change)
  private mix: Mix | null = null;
  private busy = false;
  /** A journey asked for while another was under way (a search typed mid-move): run when that one ends. */
  private queued: Destination | null = null;
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
      onHover: (target, x, y) => this.hover(target, x, y),
      figures: host.figures,
      isPhone: host.isPhone,
      drift: host.drift,
    });
    this.place = new SpaceView(host.kit, host.backdrop(), side(() => this.place));
    this.map = new SpaceView(host.kit, host.backdrop(), side(() => this.map));
    $('pc-close').addEventListener('click', () => this.closeCard());
    // The close-approach monitor of a place (or of the solar system): choosing a pair looks at its first craft, at that moment.
    this.watcher = new PlaceWatch(this.place, host.time, (craft, timeMs) => {
      if (timeMs !== null) host.jumpTo(timeMs - 30000);
      if (this.spot !== 'tracker') this.pick(this.view(this.spot), { kind: 'craft', craft });
    });
    $<HTMLInputElement>('watch-grid').addEventListener('change', () => host.setGrid($<HTMLInputElement>('watch-grid').checked));
    $('ph-enter').addEventListener('click', () => this.enter());
    for (const button of document.querySelectorAll<HTMLElement>('[data-place-view], [data-map-view]')) {
      button.addEventListener('click', () => this.goView((button.dataset.placeView ?? button.dataset.mapView) as 'whole'));
    }
    this.drawPath();
    // The solar system is built and drawn once out of sight, a little after the app has
    // started, so that the first zoom out has nothing to set up (see "changing scene").
    window.setTimeout(() => {
      if (this.map.where || this.busy) return;
      this.map.build({ kind: 'system' }, host.time());
      this.map.warmBody('earth');
      window.setTimeout(() => {
        if (this.spot !== 'map' && !this.mix) this.map.prewarm();
      }, 1500);
    }, 9000);
    this.crafts = SITES.map(siteCraft);
    this.place.setCraft(this.crafts, host.time());
    void loadDeep().then((deep) => {
      if (deep) this.refreshData(deep);
    });
    onRoversRefresh(() => this.placeRovers());
  }

  /**
   * Take a (newer) copy of public/data/deep.json: the craft, and the asteroids with a path.
   * Called once at start-up, and again whenever the site has published fresher data while this
   * tab was open. What is being looked at stays selected if it is still in the data.
   */
  refreshData(deep: DeepData): void {
    this.crafts = [...deep.craft, ...deep.flybys.map(rockCraft).filter((rock): rock is Craft => rock !== null), ...SITES.map(siteCraft)];
    this.placeRovers();
    this.place.setCraft(this.crafts, this.host.time());
    this.map.setCraft(this.crafts, this.host.time());
    if (this.spot === 'place') this.fillHere();
  }

  /**
   * A rover stands where its driven path ends (space/rovers.ts, NASA's own daily record), not
   * where Horizons puts it: deep.json's rovers sit at their landing sites, 12–14 km from where
   * Curiosity and Perseverance have since driven, and the model sat at the START of its path.
   * Applied whenever either file arrives or is refreshed.
   */
  private placeRovers(): void {
    const moved = new Set<string>();
    for (const craft of this.crafts) {
      const path = craft.motion.type === 'surface' && !craft.site ? roverPath(craft.id) : null;
      const end = path?.points[path.points.length - 1];
      if (!end || craft.motion.type !== 'surface' || (craft.motion.latDeg === end[0] && craft.motion.lonDeg === end[1])) continue;
      craft.motion = { type: 'surface', latDeg: end[0], lonDeg: end[1] };
      moved.add(craft.id);
    }
    // A card already open on a rover that has just moved was written with the old place: write it again.
    const focus = this.current?.focus;
    if (focus?.kind === 'craft' && moved.has(focus.craft.id)) this.show(focus);
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
    if (this.spot !== 'tracker' && !mix) this.watcher.frame(realSeconds);
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
    this.watcher.refreshUnits();
  }

  /** The Layers switch "Screening cells" (the tracker's own): at a place it draws that place's grid. */
  setGrid(on: boolean): void {
    $<HTMLInputElement>('watch-grid').checked = on;
    this.watcher.setGrid(on);
  }

  /** The rail's "Monitor" button at a place: the close-approach monitor for the craft there. */
  toggleWatch(open: boolean): void {
    this.watcher.toggle(open && this.spot !== 'tracker');
  }

  /** The Layers switches that apply away from the tracker (see SpaceOptions). */
  setOptions(options: SpaceOptions): void {
    this.place.setOptions(options);
    this.map.setOptions(options);
  }

  /** The Layers switches for the sky apply everywhere. */
  setSky(stars: boolean, figures: boolean): void {
    this.place.setSky(stars, figures);
    this.map.setSky(stars, figures);
  }

  /** So does "Sharp ground", at the worlds that have close-up imagery. */
  setSharpGround(on: boolean): void {
    this.place.setSharpGround(on);
  }

  /** The Layers switch "Unseen sides": the never-photographed parts of a few worlds guessed, or one plain tone. */
  setGuessUnseen(on: boolean): void {
    this.guessUnseen = on;
    SpaceView.setGuessUnseen(on);
  }
  private guessUnseen = true;

  // ---- changing scene --------------------------------------------------------------------------
  //
  // What makes a change of scene smooth is that nothing is SET UP during it. So: the solar
  // system is built and drawn once out of sight soon after the app starts; the place for a
  // world is built while the camera is on its way up to that world's dot, not when the visitor
  // goes in; what is on screen besides the picture (the rail, the path) is switched at the
  // START of a move, while the camera is still slow, because restyling the page costs a frame;
  // and a view that has been left is kept as it is rather than torn down mid-move.

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
      document.body.classList.remove('arriving');
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
    this.watch();
  }

  /** Make sure the place view holds `body` (built now, unless it already does and is recent). */
  private ensurePlace(body: BodyId): void {
    const t = this.host.time();
    // A world with rovers on it: stand them at the ends of their driven paths (fetched once).
    if (this.crafts.some((craft) => craft.centre === body && craft.motion.type === 'surface' && !craft.site)) void loadRovers().then(() => this.placeRovers());
    const where = this.place.where;
    if (where?.kind === 'place' && where.body === body && Math.abs(t - this.place.builtTime) < 3600000) this.place.setFocus(null, t, 0);
    else this.place.build({ kind: 'place', body }, t);
  }

  /**
   * What is on screen besides the picture, for where the visitor is (or is on the way to):
   * the page's classes, the path in the top bar, the rail's views. Called when a move STARTS.
   */
  private chrome(spot: Spot, body: BodyId): void {
    this.shownSpot = spot;
    this.shownBody = body;
    const away = spot !== 'tracker';
    document.body.classList.toggle('away', away);
    this.hover(null, 0, 0); // whatever was under the pointer belongs to the scene being left
    // On the way back into the tracker its name tags (ISS, Hubble, the planets) would show at
    // once, placed by a camera that is not the one on screen, over the solar system's dive in.
    // They wait until the tracker is the picture (removed at the end of the dissolve).
    document.body.classList.toggle('arriving', spot === 'tracker' && this.spot !== 'tracker');
    document.body.classList.toggle('on-map', spot === 'map');
    // One button, two tours: the Earth's autopilot in the tracker, the solar system's autoplay everywhere else.
    $('autopilot').title = away ? 'Autoplay: a tour of the solar system, world by world (A)' : 'Autopilot: a hands-free tour of the view (A)';
    document.body.classList.toggle('no-moons', spot === 'place' && !BODY_LIST.some((other) => other.parent === body || (BODIES[body].kind === 'moon' && other.id === BODIES[body].parent)));
    this.here.classList.add('is-hidden');
    if (!away) this.show(null);
    this.drawPath();
  }

  /** Live things that only matter away from the tracker: the Deep Space Network, the list of what is here. */
  private watch(): void {
    const away = this.spot !== 'tracker';
    if (away && !this.stopDsn) {
      this.stopDsn = watchDsn((links) => {
        this.links = links;
        this.markLinked();
      });
    } else if (!away) {
      this.stopDsn?.();
      this.stopDsn = null;
    }
    if (this.spot === 'place') {
      this.fillHere();
      const body = this.hereBody;
      this.watcher.setCraft(this.crafts.filter((craft) => craft.centre === body && !craft.site), this.place, 'place');
    } else if (this.spot === 'map') {
      // On the solar system: the craft out between the planets, with cells millions of km wide.
      this.watcher.setCraft(this.crafts.filter((craft) => craft.centre === 'sun' && !craft.site && !craft.passing), this.map, 'map');
    } else {
      this.watcher.toggle(false);
    }
    this.markLinked();
    this.drawPath();
  }

  // ---- the hover card (the tracker's own #tooltip, filled with what is under the pointer) ---------

  private hoverKey = '';

  private hover(target: Target | null, x: number, y: number): void {
    const tip = $('tooltip');
    if (!target || this.busy || !this.host.hoverCard() || document.body.classList.contains('ui-hidden')) {
      tip.classList.add('is-hidden');
      this.hoverKey = '';
      if (!target) this.host.kit.renderer.domElement.style.cursor = '';
      return;
    }
    const key = targetKey(target);
    if (key !== this.hoverKey) {
      this.hoverKey = key;
      const line = (className: string, text: string) => el('span', className, text);
      const text = el('div', 'tip-text');
      let picture: HTMLElement;
      const t = this.host.time();
      if (target.kind === 'body') {
        const body = target.body;
        picture = el('span', 'tip-orb');
        const [r, g, b] = body.color.map((c) => Math.round(c * 255));
        picture.style.setProperty('--orb', `rgb(${r}, ${g}, ${b})`);
        const kind = body.kind === 'star' ? 'Star' : body.kind === 'planet' ? 'Planet' : body.kind === 'dwarf' ? 'Dwarf planet' : `Moon of ${BODIES[body.parent!].name}`;
        const v = bodyRelative(body.id, 'earth', t);
        const km = Math.hypot(v[0], v[1], v[2]);
        text.append(line('tip-name', body.name), line('tip-what', kind));
        if (body.id !== 'earth') text.append(line('tip-live', `${farText(km)} from Earth`));
        const inside = this.spot === 'place' && this.hereBody === body.id;
        text.append(line('tip-op', inside ? 'Click for its card' : body.visitable || body.id === 'earth' ? 'Click to look · again to go in' : 'Click to look'));
      } else {
        const craft = target.craft;
        if (isModelKind(craft.model) && !craft.site) {
          const img = el('img', 'thumb') as HTMLImageElement;
          img.alt = '';
          img.src = modelThumbnail(craft.model);
          picture = img;
        } else {
          picture = el('span', 'tip-orb is-site');
        }
        const c = bodyRelative(craft.centre, 'earth', t), p = craftPosition(craft, t, this.vecTip).pos;
        const km = Math.hypot(c[0] + p[0], c[1] + p[1], c[2] + p[2]);
        text.append(line('tip-name', craft.name), line('tip-what', craft.site ? `${SITE_KIND[craft.site.kind]} · ${BODIES[craft.centre].name}` : craft.role));
        if (!craft.site) text.append(line('tip-live', `${farText(km)} from Earth${craft.status === 'silent' ? ' · silent' : ''}`));
        if (craft.agency) text.append(line('tip-op', craft.agency));
      }
      tip.replaceChildren(picture, text);
    }
    tip.classList.remove('is-hidden');
    tip.classList.toggle('is-left', x > window.innerWidth - 340);
    tip.style.left = `${x}px`;
    tip.style.top = `${Math.min(Math.max(y, 70), window.innerHeight - 70)}px`;
  }
  private readonly vecTip: Vec = [0, 0, 0];

  /** The body the visitor is at: the place's, or the Earth in the tracker. */
  private get hereBody(): BodyId {
    const where = this.place.where;
    return this.spot === 'place' && where?.kind === 'place' ? where.body : 'earth';
  }

  /**
   * The path in the top bar: "Solar system / Earth", "Solar system / Jupiter / Europa". The
   * last name is where the visitor is; each name before it is one step out. On the solar
   * system, a world the camera has gone up to is added in amber as the way in.
   */
  /** The status bar's numbers for the scene on screen (SpaceView.readout); null in the tracker. */
  readout(): ReturnType<SpaceView['readout']> {
    return this.spot === 'tracker' ? null : this.view(this.spot).readout();
  }

  /** Told whenever where the visitor is (or is heading) changes: a phone's world strip follows it. */
  onWhere: (() => void) | null = null;

  /** Where the visitor is, for the world strip: the kind of scene, its world, and on the solar system the world the camera is beside. */
  whereNow(): { spot: Spot; body: BodyId; beside: BodyId | null } {
    const beside = this.shownSpot === 'map' && this.map.focus?.kind === 'body' ? this.map.focus.body.id : null;
    return { spot: this.shownSpot, body: this.shownBody, beside };
  }

  /**
   * A world chosen from the phone's strip: on the solar system, the camera goes up to it (and a
   * second choice goes in, as a second tap on its dot does); anywhere else, the journey there.
   * Choosing the world you are at puts its usual view back.
   */
  goWorld(id: BodyId | 'system'): void {
    // (During a journey the next one is queued by travel(), so a quick second swipe is not lost.)
    if (this.busy && this.spot === 'map') return;
    if (id === 'system') return this.spot === 'map' ? this.pick(this.map, null) : this.openSystem();
    const body = BODIES[id];
    if (this.spot === 'map') {
      const beside = this.map.focus?.kind === 'body' && this.map.focus.body.id === id;
      if (beside) return this.open({ kind: 'body', body });
      if (this.map.keyFor(id) === `body:${id}`) return this.pick(this.map, { kind: 'body', body });
      return this.goBody(id); // not drawn on the solar system (a small moon): straight there
    }
    if ((this.spot === 'place' && this.hereBody === id) || (this.spot === 'tracker' && id === 'earth')) return this.resetView();
    this.goBody(id);
  }

  private drawPath(): void {
    this.onWhere?.();
    const segments: { text: string; state: '' | 'is-here' | 'is-next'; run: () => void; glyph?: boolean }[] = [];
    const onMap = this.shownSpot === 'map';
    const next = onMap && this.map.focus?.kind === 'body' ? this.map.focus.body : null;
    segments.push({ text: 'Solar system', state: onMap ? 'is-here' : '', glyph: true, run: () => (this.spot === 'map' ? this.pick(this.map, null) : this.openSystem()) });
    if (!onMap) {
      const body = BODIES[this.shownBody];
      if (body.kind === 'moon') segments.push({ text: BODIES[body.parent!].name, state: '', run: () => this.goBody(body.parent!) });
      segments.push({ text: body.name, state: 'is-here', run: () => this.resetView() });
    } else if (next) {
      segments.push({ text: next.name, state: 'is-next', run: () => this.open({ kind: 'body', body: next }) });
    }
    this.pathEl.replaceChildren();
    segments.forEach((segment, i) => {
      if (i > 0) this.pathEl.append(el('span', 'path-sep', '/'));
      const button = el('button', `path-seg ${segment.state}`);
      button.type = 'button';
      if (segment.glyph) button.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="1.8"/><ellipse cx="10" cy="10" rx="8.2" ry="3.4"/><ellipse cx="10" cy="10" rx="5" ry="2"/></svg>';
      button.append(el('span', '', segment.text));
      button.title = segment.state === 'is-here' ? `${segment.text}: back to the usual view` : segment.state === 'is-next' ? `Go in to ${segment.text}` : `Out to ${segment.glyph ? 'the solar system' : segment.text}`;
      button.addEventListener('click', segment.run);
      this.pathEl.append(button);
    });
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
    this.chrome('map', body);
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
    this.prepare(dot);
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
    this.prepare(dot);
    await wait(already ? 0.6 : 1.5);
    return dot;
  }

  /**
   * The camera is on its way up to a world's dot: get that world's place ready now, in idle
   * moments, so that going in has nothing to build, compile or upload. (For the Earth there
   * is nothing to do: the tracker's scene always exists.)
   */
  private prepare(dot: Target): void {
    window.clearTimeout(this.prepareTimer);
    if (dot.kind !== 'body' || !dot.body.visitable || dot.body.id === 'earth') return;
    const body = dot.body.id;
    this.prepareTimer = window.setTimeout(() => {
      if (this.busy || this.spot !== 'map' || this.map.focus?.kind !== 'body' || this.map.focus.body.id !== body) return;
      this.ensurePlace(body);
      window.setTimeout(() => {
        if (!this.busy && this.spot === 'map') this.place.prewarm();
      }, 700); // after its maps have had a moment to arrive
    }, 1700);
  }

  /**
   * From beside a body's dot on the solar system, on in to that body. For the Earth that is the
   * tracker, unless `farEarth`: the Earth as a place, the far view that holds Webb, Wind and the
   * passing asteroids (going to the tracker and then across lost what the visitor had asked for).
   */
  private async fromMap(body: BodyId, farEarth = false): Promise<void> {
    const dot = await this.toDot(body);
    if (!dot || dot.kind !== 'body' || dot.body.id !== body) return;
    window.clearTimeout(this.prepareTimer);
    const key = targetKey(dot);
    const to: Spot = body === 'earth' && !farEarth ? 'tracker' : 'place';
    if (to === 'tracker') {
      this.trackerOn = true;
      this.host.onAway(false); // the simulation starts again now, so the satellites are there when the picture is
    } else {
      this.ensurePlace(body);
    }
    this.show(null);
    this.chrome(to, body);
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
      this.ensurePlace('earth');
      this.chrome('place', 'earth');
      await this.dissolve('place', null, null, FADE);
    } else {
      this.show(null);
      if (this.place.focus) {
        this.place.setFocus(null, this.host.time(), 1.4); // come back to the Earth first
        await wait(1.4);
      }
      this.trackerOn = true;
      this.host.onAway(false);
      this.chrome('tracker', 'earth');
      await wait(0.25); // a few frames for the first positions
      await this.dissolve('tracker', null, null, FADE);
      this.host.settle(1.6);
    }
  }

  /** Go somewhere, by whatever chain of moves gets there from here. One journey at a time. */
  private async travel(to: Destination): Promise<void> {
    if (this.busy) {
      this.queued = to; // the latest wish wins, and is carried out once the camera is free
      return;
    }
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
            await this.fromMap(to.body, true);
          }
        }
        if (this.spot === 'place' && this.hereBody === to.body && to.focus) this.pick(this.place, to.focus);
      }
    } finally {
      this.busy = false;
      const next = this.queued;
      this.queued = null;
      if (next) void this.travel(next);
    }
  }

  // ---- what the visitor can ask for --------------------------------------------------------------

  /** One step outwards: from a world to the solar system beside it; there, to the whole of it. */
  openSystem(): void {
    if (this.spot === 'map') this.pick(this.map, null);
    else void this.travel({ kind: 'map' });
  }

  /** For the autoplay (ui/spaceTour.ts): go to a world, the Earth being the tracker, and resolve once there. */
  visit(body: BodyId): Promise<void> {
    return this.travel(body === 'earth' ? { kind: 'tracker' } : { kind: 'place', body });
  }

  /** For the autoplay: out to the whole solar system, and resolve once there. */
  visitSystem(): Promise<void> {
    return this.travel({ kind: 'map', focus: null });
  }

  /** A journey is under way (it cannot be interrupted, and a new one is refused until it ends). */
  get moving(): boolean {
    return this.busy;
  }

  /** Enter (the key, or the prompt on the solar system): go in to the world the camera has gone up to. */
  enter(): void {
    const focus = this.spot === 'map' ? this.map.focus : null;
    if (focus?.kind === 'body') this.open(focus);
  }

  /** Escape: stop looking at one thing; from a place, out to the solar system; there, out to all of it. */
  back(): boolean {
    if (this.busy) return true; // a move is under way: Escape is spent on it
    if (this.spot === 'place' && this.place.focus) this.pick(this.place, null);
    else if (this.spot === 'place') void this.travel({ kind: 'map' });
    else if (this.spot === 'map' && this.map.focus) this.pick(this.map, null);
    else return false; // the whole solar system: nothing further out
    return true;
  }

  /**
   * The logo, and the last name of the path: everything back the way it starts HERE, wherever
   * here is — the usual view of this world (or of the whole solar system), nothing selected,
   * no panel open. It does not go back to the Earth: no place is "home" more than another.
   */
  resetView(): void {
    if (this.spot === 'tracker') return this.host.home();
    if (this.busy) return;
    this.host.jumpToNow();
    this.here.classList.add('is-hidden');
    this.show(this.spot === 'place' && !this.host.isPhone() ? { kind: 'body', body: BODIES[this.hereBody] } : null);
    this.view(this.spot).goView('whole', this.host.time());
    this.drawPath();
  }

  /** One of the rail's views, at a place or on the solar system. */
  goView(name: 'whole' | 'close' | 'night' | 'moons' | 'inner' | 'above'): void {
    if (this.busy || this.spot === 'tracker') return;
    if (this.current?.focus) this.show(null);
    this.view(this.spot).goView(name, this.host.time());
    this.drawPath();
  }

  /** To the tracker at once, with no journey (only for when the page itself is being reset). */
  leaveNow(): void {
    this.queued = null;
    if (this.spot === 'tracker' && !this.mix) return;
    this.mix?.done();
    this.mix = null;
    const { kit } = this.host;
    kit.blend(null);
    kit.show();
    this.place.setLive(false);
    this.map.setLive(false);
    this.spot = 'tracker';
    this.host.holdTracker(null);
    document.body.classList.remove('arriving');
    if (!this.trackerOn) {
      this.trackerOn = true;
      this.host.onAway(false);
    }
    this.chrome('tracker', 'earth');
    this.watch();
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
    this.chrome(to.kind, to.kind === 'place' ? to.body : 'earth');
    this.watch();
    if (to.focus) {
      view.setFocus(to.focus, t, 0);
      this.show(to.focus);
    } else if (to.kind === 'place' && !this.host.isPhone()) {
      this.show({ kind: 'body', body: BODIES[to.body] });
    }
  }

  /** Go and watch one asteroid pass the Earth (by its name in the fly-by list). False if its path is not known. */
  showFlyby(name: string): boolean {
    const rock = this.crafts.find((craft) => craft.passing?.name === name);
    if (rock) this.showCraft(rock);
    return rock !== undefined;
  }

  /** Go and look at the craft a Deep Space Network dish calls `code` ('JNO', 'JWST'). False if no craft has it. */
  showByDsn(code: string): boolean {
    const craft = this.crafts.find((candidate) => candidate.dsn.some((own) => own.toUpperCase() === code.toUpperCase()));
    if (craft) this.showCraft(craft);
    return craft !== undefined;
  }

  /** How many of the craft beyond Earth orbit are drawn with one kind of 3D model, and a way to go and see one. */
  countOf(model: string): number {
    return this.crafts.filter((craft) => craft.model === model && !craft.site).length;
  }
  showOne(model: string): boolean {
    const craft = this.crafts.find((candidate) => candidate.model === model && !candidate.passing && !candidate.site) ?? this.crafts.find((candidate) => candidate.model === model && !candidate.site);
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
    if (craft.motion.type === 'surface' && !craft.site) void loadRovers().then(() => this.placeRovers()); // stand it at the end of its path
    const target: Target = { kind: 'craft', craft };
    // An asteroid can only be shown around its pass: go to a little before its closest moment.
    if (craft.passing && Math.abs(this.host.time() - craft.passing.timeMs) > 2 * DAY) this.host.jumpTo(craft.passing.timeMs - 40 * 60000);
    if (this.spot === 'place' && this.hereBody === craft.centre) this.pick(this.place, target); // already there
    else if (craft.centre === 'sun' && !this.nearSun(craft)) void this.travel({ kind: 'map', focus: target });
    else void this.travel({ kind: 'place', body: craft.centre, focus: target });
  }

  private nearSun(craft: Craft): boolean {
    const p = craftPosition(craft, this.host.time()).pos;
    return Math.hypot(p[0], p[1], p[2]) < 1.1 * AU;
  }

  /** A click on something in a view (or on nothing): look at it, and show what there is to say about it. */
  private pick(view: SpaceView, target: Target | null): void {
    if (!view.where || (this.busy && view !== this.view(this.spot))) return;
    view.setFocus(target, this.host.time());
    if (target) this.show(target);
    else if (view === this.place && !this.host.isPhone()) this.show({ kind: 'body', body: BODIES[this.hereBody] });
    else this.show(null);
    if (view === this.map && target) this.prepare(target);
    this.drawPath();
  }

  /** "Go in": a second click on what is being looked at, zooming all the way in on it, Enter. */
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

  /** The spacecraft, landing sites, passing asteroids and moons of a body, as lists that take the visitor to each. */
  private lists(body: Body, into: HTMLElement): void {
    const crafts = this.crafts.filter((craft) => craft.centre === body.id && !craft.passing && !craft.site && (body.id !== 'sun' || this.nearSun(craft)));
    if (crafts.length > 0) into.append(el('h3', 'pc-label', body.id === 'earth' ? 'Beyond Earth orbit' : 'Spacecraft'), this.craftList(crafts));
    const sites = this.crafts.filter((craft) => craft.centre === body.id && craft.site).sort((a, b) => a.launched.localeCompare(b.launched));
    if (sites.length > 0) into.append(el('h3', 'pc-label', 'Landing sites'), this.craftList(sites));
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
      const button = el('button', craft.status === 'silent' && !craft.site ? 'is-silent' : '');
      button.type = 'button';
      button.append(el('b', '', craft.short), el('span', '', craft.passing ? `${fmt(craft.passing.distanceKm / MOON_KM, 1)} × the Moon’s distance` : craft.site ? craft.launched.slice(0, 4) : craft.role));
      button.addEventListener('click', () => this.showCraft(craft));
      row.append(button);
      list.append(row);
    }
    return list;
  }

  // ---- what there is to say about the thing being looked at --------------------------------------
  //
  // On the solar system a WORLD is captioned in the picture itself (its name, where it is, the
  // way in). Everything else — a craft anywhere, a world from inside its own place — gets the
  // card, which is the inspector's own parts: header, picture, switches, tabs, readings.

  private show(target: Target | null): void {
    this.shown = target;
    this.live = null;
    const caption = target?.kind === 'body' && this.spot === 'map';
    this.hud.classList.toggle('is-hidden', !caption);
    this.card.classList.toggle('is-hidden', !target || caption);
    document.body.classList.toggle('place-card-open', !!target && !caption); // (a phone's world strip steps aside for the card)
    // Keep what is being looked at clear of the words: above a caption or a phone's card, beside a computer's card.
    const shift: [number, number] = !target ? [0, 0] : caption ? [0, 0.09] : this.host.isPhone() ? [0, 0.17] : [0.07, 0];
    this.place.setShift(...shift);
    this.map.setShift(...shift);
    if (!target) return;
    if (target.kind === 'body' && caption) this.captionFor(target.body);
    else this.cardFor(target);
    this.refreshLive();
  }

  /** Fill in the moving numbers now (whatever built the card or caption left a function for that in `live`). */
  private refreshLive(): void {
    this.live?.();
  }

  private captionFor(body: Body): void {
    $('ph-name').textContent = body.name;
    $('ph-enter-text').textContent = body.id === 'earth' || body.visitable ? `Enter ${body.name}` : body.name;
    $('ph-enter').classList.toggle('is-hidden', !(body.id === 'earth' || body.visitable));
    const meta = $('ph-meta');
    const distance = el('b'), light = el('b');
    meta.replaceChildren(kindText(body));
    if (body.id !== 'earth') meta.append(' · ', distance, ' from Earth · light takes ', light);
    const vec: Vec = [0, 0, 0];
    this.live = () => {
      if (body.id === 'earth') return;
      const p = bodyRelative(body.id, 'earth', this.host.time(), vec);
      const km = Math.hypot(p[0], p[1], p[2]);
      distance.textContent = farText(km);
      light.textContent = duration((km / LIGHT_KM_S) * 1000);
    };
    // Its moons that can be visited (each is a dot beside it): a tap goes up to that moon.
    const moons = $('ph-moons');
    moons.replaceChildren();
    for (const moon of BODY_LIST.filter((other) => other.parent === body.id && other.kind === 'moon' && other.visitable)) {
      const link = el('button', '', moon.name);
      link.type = 'button';
      link.addEventListener('click', () => this.pick(this.map, { kind: 'body', body: moon }));
      moons.append(link);
    }
  }

  private cells(rows: [string, HTMLElement | string][]): HTMLElement {
    const list = el('dl', 'telemetry');
    for (const [name, value] of rows) {
      const cell = el('div'), dd = el('dd');
      dd.append(value);
      cell.append(el('dt', '', name), dd);
      list.append(cell);
    }
    return list;
  }

  private facts(rows: [string, HTMLElement | string][]): HTMLElement {
    const list = el('dl', 'kv pc-kv');
    for (const [name, value] of rows) {
      const row = el('div');
      const dd = el('dd', 'plain');
      dd.append(value);
      row.append(el('dt', '', name), dd);
      list.append(row);
    }
    return list;
  }

  /** The card: header, picture, switches, and one tab of readings at a time. */
  private cardFor(target: Target): void {
    const key = targetKey(target);
    const craft = target.kind === 'craft' ? target.craft : null;
    const body = target.kind === 'body' ? target.body : null;
    const title = craft ? craft.wiki : body!.wiki;
    $('pc-name').textContent = craft ? craft.name : body!.name;
    $('pc-kind').textContent = craft ? (craft.agency ? `${craft.role} · ${craft.agency}` : craft.role) : kindText(body!);
    const dot = $('pc-dot');
    dot.style.color = craft ? (craft.site ? '#c3dcff' : craft.passing ? '#d9c6b0' : craft.status === 'silent' ? '#9fb0c8' : '#ffb454') : `rgb(${body!.color.map((c) => Math.round(c * 255)).join(',')})`;
    const wiki = $<HTMLAnchorElement>('pc-wiki');
    if (title) wiki.href = wikiLink(title);
    else wiki.removeAttribute('href');

    // The picture: the article's own photograph, for a craft (no photograph of a world beats the one on screen).
    const hero = $('pc-hero'), photo = $<HTMLImageElement>('pc-photo');
    hero.classList.add('is-hidden');
    $('pc-tag').textContent = craft ? craft.role : '';
    $('pc-status').textContent = craft ? (craft.site ? dayText(craft.launched) : craft.passing ? 'Passing' : craft.status === 'silent' ? 'Silent' : 'Operational') : '';
    let extract = '';
    let showExtract: (() => void) | null = null;
    if (title) {
      void wikiSummary(title).then((summary) => {
        if (!summary || !this.shown || targetKey(this.shown) !== key) return;
        extract = summary.extract;
        showExtract?.();
        if (craft && summary.imageUrl) {
          photo.src = summary.imageUrl;
          hero.classList.remove('is-hidden');
        }
      });
    }
    // The switches a selected satellite has in the tracker, for a craft in orbit at a place.
    // A rover on the ground has its own: where it has driven, and its model.
    const onGround = !!craft && craft.motion.type === 'surface' && !craft.site;
    $('pc-acts').classList.toggle('is-hidden', !(craft && this.spot === 'place' && !craft.passing && !craft.site && (craft.motion.type !== 'surface' || onGround)));
    $('pc-acts').classList.toggle('is-ground', onGround);

    const about = (into: HTMLElement, text: string) => {
      into.append(el('p', 'pc-blurb', text));
      const more = el('p', 'pc-extract', extract);
      into.append(more);
      showExtract = () => (more.textContent = extract);
    };
    const tabs: [string, (into: HTMLElement) => void][] = craft ? this.craftTabs(craft, about) : this.bodyTabs(body!, about);
    const bar = $('pc-tabs'), into = $('pc-body');
    const open = (index: number) => {
      this.tabAt.set(craft ? 'craft' : 'body', index);
      [...bar.children].forEach((button, i) => button.classList.toggle('is-on', i === index));
      into.replaceChildren();
      this.live = null;
      showExtract = null;
      tabs[index][1](into);
      into.scrollTop = 0;
      this.refreshLive();
    };
    bar.replaceChildren();
    tabs.forEach(([name], i) => {
      const button = el('button', '', name);
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.addEventListener('click', () => open(i));
      bar.append(button);
    });
    open(Math.min(this.tabAt.get(craft ? 'craft' : 'body') ?? 0, tabs.length - 1));
  }

  private bodyTabs(body: Body, about: (into: HTMLElement, text: string) => void): [string, (into: HTMLElement) => void][] {
    const here = this.spot === 'place' && this.hereBody === body.id;
    return [
      ['Now', (into) => {
        const distance = el('span'), light = el('span'), fromSun = el('span'), sunLight = el('span');
        // (For our own Moon "from its planet" is "from Earth", which the first cell already says.)
        const parent = body.parent && body.parent !== 'sun' && body.parent !== 'earth' ? BODIES[body.parent] : null;
        const rows: [string, HTMLElement | string][] = [];
        if (body.id !== 'earth') rows.push(['From Earth', distance], ['Light takes', light]);
        if (body.id !== 'sun') rows.push([parent ? `From ${parent.name}` : 'From the Sun', fromSun], ['Sunlight takes', sunLight]);
        into.append(this.cells(rows));
        const a: Vec = [0, 0, 0];
        this.live = () => {
          const t = this.host.time();
          if (body.id !== 'earth') {
            const p = bodyRelative(body.id, 'earth', t, a);
            const km = Math.hypot(p[0], p[1], p[2]);
            distance.textContent = farText(km);
            light.textContent = duration((km / LIGHT_KM_S) * 1000);
          }
          if (body.id !== 'sun') {
            const s = bodyPosition(body.id, t, a);
            const sunKm = Math.hypot(s[0], s[1], s[2]);
            sunLight.textContent = duration((sunKm / LIGHT_KM_S) * 1000);
            if (parent) {
              const q = bodyRelative(body.id, parent.id, t, a);
              fromSun.textContent = farText(Math.hypot(q[0], q[1], q[2]));
            } else {
              fromSun.textContent = farText(sunKm);
            }
          }
        };
        if (here && IMAGERY[body.id]?.clouds && body.id !== 'earth') {
          // A world under permanent cloud: the visitor can look beneath it.
          const under = el('button', 'link pc-under', this.place.showingSurface ? 'Show the clouds again' : 'Look under the clouds');
          under.type = 'button';
          under.addEventListener('click', () => {
            this.place.setSurface(!this.place.showingSurface);
            under.textContent = this.place.showingSurface ? 'Show the clouds again' : 'Look under the clouds';
          });
          into.append(under);
        }
        if (!here) this.lists(body, into); // at the place itself that list is the rail's "Objects" panel
      }],
      ['Facts', (into) => {
        const rows: [string, HTMLElement | string][] = [['Diameter', fmtKm(body.radiusKm * 2)]];
        // Gravity at the surface follows from its mass and size: g = GM / r² (km³/s² and km → m/s²).
        const gravity = (body.gm / (body.radiusKm * body.radiusKm)) * 1000;
        if (body.id !== 'sun') rows.push(['Gravity', `${fmt(gravity, gravity < 1 ? 3 : 2)} m/s² (${fmt(gravity / 9.807, gravity < 0.98 ? 3 : 2)} of Earth’s)`]);
        if (body.dayHours) rows.push(['Turns once in', `${spanText(body.dayHours / 24)}${body.dayHours < 0 ? ', backwards' : ''}`]);
        if (body.parent) rows.push([`Round ${body.parent === 'sun' ? 'the Sun' : BODIES[body.parent].name} in`, spanText(body.periodDays)]);
        if (body.tempC !== undefined) rows.push([body.kind === 'star' || body.radiusKm > 20000 ? 'Temperature' : 'Temperature on the ground', tempText(body.tempC)]);
        if (body.air) rows.push(['Air', body.air]);
        if (body.discovered) rows.push(['Found by', body.discovered]);
        into.append(this.facts(rows));
        // Part of it never photographed: say so, and what the picture shows there.
        const unseen = UNSEEN[body.id];
        if (unseen) {
          into.append(el('p', 'pc-unseen', `${unseen} No one has seen that part: ${this.guessUnseen
            ? 'it is drawn as an educated guess made from the photographed side (the Layers switch “Unseen sides” shows it as a plain tone instead).'
            : 'it is drawn in one plain tone (the Layers switch “Unseen sides” fills it in with an educated guess).'}`));
        }
      }],
      ['About', (into) => about(into, body.blurb)],
    ];
  }

  private craftTabs(craft: Craft, about: (into: HTMLElement, text: string) => void): [string, (into: HTMLElement) => void][] {
    const pass = craft.passing, site = craft.site;
    const centre = BODIES[craft.centre];
    const motion = craft.motion;
    const now0 = this.host.time();
    const period = motion.type === 'surface' || pass ? null : craftPeriodMs(craft);
    const tabs: [string, (into: HTMLElement) => void][] = [];

    tabs.push([site ? 'Site' : pass ? 'Pass' : 'Live', (into) => {
      const contact = el('p', 'pc-contact');
      const distance = el('span'), light = el('span'), fromCentre = el('span'), speed = el('span'), sun = el('span');
      const rows: [string, HTMLElement | string][] = [];
      if (pass) {
        rows.push(['From Earth', distance], ['Speed past Earth', speed], ['Closest', clockStamp(pass.timeMs)], ['Misses by', `${fmt(pass.distanceKm / MOON_KM, 1)} × the Moon`],
          ['Miss distance', fmtKm(pass.distanceKm)], ['Size', `${fmtInt(pass.sizeM[0])} – ${fmtInt(pass.sizeM[1])} m`]);
      } else if (motion.type === 'surface') {
        rows.push(['Where', latLonText(motion.latDeg, motion.lonDeg)], ['Sun there now', sun], ['From Earth', distance], [site ? 'Light takes' : 'Its signal takes', light]);
      } else {
        rows.push(['From Earth', distance], ['Its signal takes', light]);
        if (craft.centre !== 'earth') rows.push([craft.centre === 'sun' ? 'From the Sun' : `Above ${centre.name}`, fromCentre]);
        rows.push([`Speed past ${craft.centre === 'sun' ? 'the Sun' : centre.name}`, speed]);
      }
      const held = el('p', 'note');
      into.append(contact, this.cells(rows), held);
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
        if (motion.type === 'surface' && r > 0) {
          // How high the Sun stands there: the angle between "straight up" at the spot and the Sun.
          const toSun = bodyPosition(craft.centre, t, c);
          const sunKm = Math.hypot(toSun[0], toSun[1], toSun[2]) || 1;
          const up = -(now.pos[0] * toSun[0] + now.pos[1] * toSun[1] + now.pos[2] * toSun[2]) / (r * sunKm);
          const height = (Math.asin(Math.max(-1, Math.min(1, up))) * 180) / Math.PI;
          sun.textContent = height > 0.5 ? `Day, ${fmt(height, 0)}° up` : height > -6 ? 'On the horizon' : 'Night';
        }
        const names = new Set(craft.dsn.map((name) => name.toUpperCase()));
        const link = this.links.find((candidate) => names.has(candidate.craft.toUpperCase()) && (candidate.up || candidate.down));
        contact.className = `pc-contact ${link ? 'is-live' : ''}`;
        const said = link ? `In contact now · ${link.site} ${link.dish} ${link.up && link.down ? 'sending and receiving' : link.down ? 'receiving' : 'sending'}` : '';
        // Rebuilt only when it changes (this runs twice a second), so the link stays clickable.
        if (contact.dataset.said !== said) {
          contact.dataset.said = said;
          contact.replaceChildren();
          if (link) {
            const source = el('a', 'pc-source', 'NASA DSN Now ↗');
            source.href = DSN_NOW_URL;
            source.target = '_blank';
            source.rel = 'noopener noreferrer';
            source.title = 'Where this comes from: NASA’s live Deep Space Network page';
            contact.append(`${said} · `, source);
          }
        }
      };
    }]);

    if (period !== null && period < 400 * 365.25 * DAY) {
      tabs.push(['Orbit', (into) => {
        // One trip round, sampled along the real path (so an orbit that the body's shape is
        // dragging round is still right): how long, how low, how high, how tilted.
        const rows: [string, HTMLElement | string][] = [['Once round in', spanText(period / DAY)]];
        let low = Infinity, high = 0;
        const p: Vec = [0, 0, 0];
        for (let i = 0; i < 90; i++) {
          craftPosition(craft, now0 + (period * i) / 90, p);
          const r = Math.hypot(p[0], p[1], p[2]);
          low = Math.min(low, r);
          high = Math.max(high, r);
        }
        if (craft.centre === 'sun') rows.push(['Nearest the Sun', farText(low)], ['Farthest', farText(high)]);
        else rows.push(['Lowest', fmtKm(Math.max(0, low - centre.radiusKm))], ['Highest', fmtKm(Math.max(0, high - centre.radiusKm))]);
        const a: Vec = [0, 0, 0], b: Vec = [0, 0, 0];
        craftPosition(craft, now0, a);
        craftPosition(craft, now0 + Math.min(period / 400, 60000), b);
        const h = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        const pole = bodyAxes(craft.centre, now0).pole;
        const size = Math.hypot(h[0], h[1], h[2]);
        if (size > 0) rows.push([`Tilt to ${craft.centre === 'sun' ? 'the Sun' : centre.name}’s equator`, `${fmt((Math.acos(Math.max(-1, Math.min(1, (h[0] * pole[0] + h[1] * pole[1] + h[2] * pole[2]) / size))) * 180) / Math.PI, 1)}°`]);
        into.append(this.facts(rows));
      }]);
    }

    tabs.push([site || pass ? 'About' : 'Record', (into) => {
      const rows: [string, HTMLElement | string][] = [];
      if (site) rows.push(['Landed', `${dayText(craft.launched)} (${fmtInt(yearsSince(craft.launched, now0))} years ago)`]);
      else if (!pass) rows.push(['Launched', `${dayText(craft.launched)} (${fmtInt(yearsSince(craft.launched, now0))} years ago)`]);
      if (craft.arrived) rows.push([motion.type === 'surface' ? 'Landed' : 'Arrived', dayText(craft.arrived)]);
      if (craft.ended) rows.push(['Last contact', dayText(craft.ended)]);
      if (craft.massKg) rows.push(['Mass at launch', `${fmtInt(craft.massKg)} kg`]);
      if (craft.agency) rows.push(['Run by', craft.agency]);
      if (!site && !pass) rows.push(['Status', craft.status === 'silent' ? 'No longer answering' : 'Operational']);
      // A rover's odometry, from NASA's traverse maps (space/rovers.ts). The file may still be on
      // its way, so the row is filled when it arrives, and taken away if this rover has no path.
      // Asked of the data, not of the model's name: a rover may have a model of its own.
      const driven = el('span');
      const known = roverPath(craft.id);
      if (known) driven.textContent = `${fmtKm(known.drivenKm, 1)} by sol ${fmtInt(known.sol)}`;
      if (motion.type === 'surface' && !site) rows.push(['Driven so far', driven]);
      if (rows.length > 0) into.append(this.facts(rows));
      if (driven.parentElement && !known) {
        void loadRovers().then(() => {
          const path = roverPath(craft.id);
          if (path) driven.textContent = `${fmtKm(path.drivenKm, 1)} by sol ${fmtInt(path.sol)}`;
          else driven.closest('div')?.remove();
        });
      }
      about(into, craft.blurb);
    }]);
    return tabs;
  }

  // ---- search and links ------------------------------------------------------------------------

  /** Bodies and craft for the search field (App.addSearch). */
  search(query: string): SearchHit[] {
    const hits: SearchHit[] = [];
    // At another world, what is THERE comes first: its moons and the craft round it or on its
    // ground get a lift and a heading of their own ("At Mars"), so "curiosity" at Mars or "ice"
    // at Jupiter finds the local thing before a namesake elsewhere.
    const at = this.spot === 'place' ? this.hereBody : null;
    const local = (centre: BodyId | null): boolean => at !== null && centre !== null && (centre === at || BODIES[centre].parent === at || BODIES[at].parent === centre);
    const here = at ? `At ${BODIES[at].name}` : '';
    const lift = (score: number, isLocal: boolean): number => (isLocal ? Math.min(1, score + 0.12) : score);
    const system = this.host.match(query, 'solar system', 'planets', 'the solar system', 'map of the solar system');
    if (system > 0) hits.push({ title: 'The solar system', note: 'Every planet, where it is now', group: 'Beyond Earth orbit', score: system, run: () => void this.travel({ kind: 'map', focus: null }) });
    for (const body of BODY_LIST) {
      const score = this.host.match(query, body.name, ...(body.id === 'moon' ? ['the moon', 'luna'] : body.id === 'sun' ? ['the sun'] : []));
      if (score <= 0 || body.id === 'earth') continue;
      const near = local(body.parent) && body.id !== at;
      hits.push({ title: body.name, note: kindText(body), group: near ? here : 'Beyond Earth orbit', score: lift(score, near), run: () => this.goBody(body.id) });
    }
    for (const craft of this.crafts) {
      const score = this.host.match(query, craft.name, craft.short, ...craft.aliases);
      const near = local(craft.centre);
      if (score > 0) hits.push({ title: craft.name, note: craft.role, group: near ? here : 'Beyond Earth orbit', score: lift(score, near), run: () => this.showCraft(craft) });
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
