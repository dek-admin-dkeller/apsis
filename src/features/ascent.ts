/**
 * Rockets climbing to orbit, drawn on the globe on an ESTIMATED path (data/ascent.ts).
 *
 * For every launch in the Launch Library list whose pad and time are known to the minute:
 *   - from an hour before lift-off its planned path is drawn faintly, from the pad up to its
 *     first orbit and twice round it;
 *   - from lift-off a rocket model (its own kind where the catalogue of models has one, else a
 *     generic launcher; the upper stage alone after staging) climbs along that path with a
 *     glow while an engine burns, and the part already flown is drawn brighter;
 *   - pointing at the rocket shows a small preview beside it (name, T+, height, speed, the last
 *     event, "Details"); it is never on by itself (the owner found an always-on card loud and in
 *     the way, even with the rocket on the far side of the Earth), and never while the rocket is
 *     behind the Earth;
 *   - clicking or tapping the rocket, or "Details", opens the launch's CARD in the right dock
 *     (features/launchCard.ts: photo, Live / Mission / Record, links), like any object's card;
 *     choosing a launch in the bell or "Watch it climb" also locks the camera on it;
 *   - Layers → "Live launches" (`Settings.liveLaunches`) turns the rockets and paths off; a
 *     launch the visitor chooses to watch (the list, the bell, a share link) is still drawn;
 *   - a launch that FAILED is drawn as far as it got when the service's words say when it was
 *     lost (then a burst, and nothing beyond); when they do not, the climb is not flown at all
 *     and the card says where it failed is not published. A partial failure flies, and says so.
 * Escape closes the card (App.onEscape); leaving the climb's time (Live, a jump) lets the camera go.
 * It all follows the SIMULATED clock, so any launch in the list can be watched again or ahead
 * of time: "Watch the climb" (launches section, the bell) moves the clock to just before
 * lift-off when it is not already in the window.
 *
 * Once the new objects' real orbits reach the catalogue (usually within a day), they are the
 * truth; this drawing stops two orbits after the engine cuts off.
 */

import * as THREE from 'three';
import { planAscent, ascentSpanS, ascentState, boosterState, type Ascent } from '../data/ascent.ts';
import { rocketKind, type ModelKind } from '../data/describe.ts';
import { loadLaunches, type Launch } from '../data/launches.ts';
import { buildModel, modelBase } from '../render/satModels.ts';
import type { App } from '../ui/app.ts';
import { clockStamp } from '../ui/inspector.ts';
import { LaunchCard } from './launchCard.ts';
import { fmtKm, fmtKmS } from '../ui/dom.ts';

const BEFORE_MS = 60 * 60000; // the planned path appears an hour before lift-off
const R_KM = 6371;
/**
 * The ground as drawn close up: the sharp map tiles are patches lifted 3–8 km above the globe
 * (render/tiles.ts), so a rocket on the pad at true height 0 stood half inside them (the owner
 * saw a Falcon 9 "glitched into the ground"). Anything lower than this is drawn at this height.
 */
const GROUND_KM = 8;
/** A position at least GROUND_KM above the globe. */
function aboveGround(pos: [number, number, number]): [number, number, number] {
  const r = Math.hypot(pos[0], pos[1], pos[2]);
  if (r >= R_KM + GROUND_KM || r === 0) return pos;
  const k = (R_KM + GROUND_KM) / r;
  return [pos[0] * k, pos[1] * k, pos[2] * k];
}
const POINTS = 360;

/** A model, or the plain rocket stage if that kind cannot be built: a missing model must not stop the drawing. */
function rocketModel(kind: ModelKind): THREE.Object3D {
  let model: THREE.Object3D;
  try {
    model = buildModel(kind);
  } catch {
    kind = 'rocketbody';
    model = buildModel(kind);
  }
  if (kind === 'rocketbody') {
    // A spent stage is built lying along +X, nose forward: stand it along the direction of flight (+Y here).
    model.rotation.z = Math.PI / 2;
  } else {
    // Rockets are built standing on their engine bells: lift each by its own lowest point (about
    // half its height once normalised, but not exactly for every rocket), so the holder's origin
    // is the base and it stands ON the pad.
    model.position.y = -modelBase(kind);
  }
  return model;
}

/** A soft round glow for the engine (additive, so bloom carries it). */
function glowTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d')!;
  const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,240,210,1)');
  gradient.addColorStop(0.25, 'rgba(255,170,80,0.8)');
  gradient.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

const clockText = (s: number): string => {
  const a = Math.abs(Math.round(s));
  const m = Math.floor(a / 60), sec = a % 60;
  return `T${s < 0 ? '−' : '+'}${m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : m}:${String(sec).padStart(2, '0')}`;
};

interface Flight {
  ascent: Ascent;
  group: THREE.Group; // in the inertial frame (app.eciGroup), km
  flown: THREE.Line;
  ahead: THREE.Line;
  holder: THREE.Group;
  model: THREE.Object3D;
  glow: THREE.Sprite;
  kind: ModelKind;
  staged: boolean;
  tag: HTMLElement;
  live: HTMLElement;
  stage: HTMLElement;
  world: THREE.Vector3; // where the rocket is, scene units (for the camera and the card)
  shown: boolean;
  /** The first stage on its way down (when it lands), and the spot it comes down on. */
  booster: THREE.Group | null;
  landing: THREE.Sprite | null;
  /** "Now tracked: …": the real objects of this launch, once they are in the catalogue (shown on its card). */
  real: HTMLElement;
  launch: Launch;
  /** What the card says about the drawing: the estimate, a failure, the booster. */
  notes: { estimate: string; failure: string; booster: string };
  /** Its path is drawn (the card's Path switch). */
  pathOn: boolean;
  realFor: string;
  /** Lost in flight: the seconds after lift-off it was lost (null: not published, so nothing is flown). */
  lostAtS: number | null | undefined;
  failReason: string;
  burst: THREE.Sprite | null;
  /** Where the rocket is on screen this frame (px), or null when it is not to be seen (off screen, behind the Earth). */
  screen: { x: number; y: number } | null;
}

/** The moment a full failure was lost: from the service's words, else after staging if they say the upper stage. */
function lostAt(launch: Launch, ascent: Ascent): number | null | undefined {
  const failure = launch.failure;
  if (!failure || failure.partial) return undefined; // flew (a partial failure reaches some orbit)
  return failure.atS !== null ? Math.min(failure.atS, ascent.burnS) : null;
}

let watchHandler: ((launch: Launch) => boolean) | null = null;

/** Go and watch a launch climb (the bell and the launches list call this). False if it cannot be placed. */
export function watchLaunch(launch: Launch): boolean {
  return watchHandler ? watchHandler(launch) : false;
}

/** Can this launch's climb be drawn (pad and time known)? */
export const canWatch = (launch: Launch): boolean => planAscent(launch) !== null;

export function installAscent(app: App): void {
  const root = el('div', 'ascent-tags');
  document.body.append(root);
  const glow = glowTexture();
  const flights = new Map<string, Flight>();
  let launches: Launch[] = [];
  let following: string | null = null;
  // The preview: which rocket the pointer is on; and the launches the visitor asked for (drawn
  // even with the "Live launches" layer off).
  const wanted = new Set<string>();
  let hovered: string | null = null;
  let hoverUntil = 0; // the card lingers a moment after the pointer leaves, so it can be reached
  const pointerAt = { x: -1e4, y: -1e4, mouse: false };
  const HIT_PX = 26;
  /** The launch whose rocket is under a point on screen, if any. */
  const rocketAt = (x: number, y: number): string | null => {
    let best: string | null = null, bestD = HIT_PX;
    for (const [id, flight] of flights) {
      if (!flight.screen) continue;
      const d = Math.hypot(flight.screen.x - x, flight.screen.y - y);
      if (d < bestD) {
        best = id;
        bestD = d;
      }
    }
    return best;
  };
  window.addEventListener('pointermove', (event) => {
    pointerAt.x = event.clientX;
    pointerAt.y = event.clientY;
    pointerAt.mouse = event.pointerType === 'mouse';
  }, { passive: true });
  // A click or tap on a rocket opens its card (and does not also select whatever dot is behind it).
  let downAt = { x: 0, y: 0 };
  window.addEventListener('pointerdown', (event) => {
    downAt = { x: event.clientX, y: event.clientY };
  }, true);
  window.addEventListener('pointerup', (event) => {
    if (app.away() || !(event.target instanceof HTMLCanvasElement)) return;
    if (Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 8) return; // a drag
    const id = rocketAt(event.clientX, event.clientY);
    if (!id) return;
    event.stopImmediatePropagation();
    openCard(id);
  }, true);

  // The launch's card (right dock), and what its switches and × do.
  const card = new LaunchCard({
    onClose: () => closeCard(),
    onLock: (on) => {
      const id = card.openId;
      if (!id) return;
      if (on) startFollowing(id);
      else if (following === id) {
        following = null;
        app.follow(null);
      }
      card.setLocked(following === id);
    },
    onPath: (on) => {
      const flight = card.openId ? flights.get(card.openId) : undefined;
      if (flight) flight.pathOn = on;
    },
  });
  function openCard(id: string): void {
    const flight = flights.get(id);
    if (!flight) return;
    app.sideCard(true); // (closes a satellite's card first: one card at a time)
    card.open(flight.launch, flight.ascent, flight.kind, { locked: following === id, path: flight.pathOn }, spanEnd(flight));
    card.setNotes({ ...flight.notes, real: flight.real.childElementCount > 0 ? flight.real : null });
    hovered = null;
  }
  function closeCard(): void {
    const id = card.openId;
    if (!id) return;
    card.close();
    app.sideCard(false);
    if (following === id) {
      following = null;
      app.follow(null);
    }
  }
  // Another card took the dock (a satellite, a close approach), or Home: this one goes.
  app.onSelect((sat) => {
    if (!sat || !card.openId) return;
    card.close();
    app.sideCard(false);
    following = null;
  });
  app.onEncounter((encounter) => {
    if (encounter && card.openId) {
      card.close();
      app.sideCard(false);
      following = null;
    }
  });

  function make(launch: Launch, ascent: Ascent): Flight {
    const group = new THREE.Group();
    // The whole path, sampled once: the climb densely, then two trips round the first orbit.
    const span = ascentSpanS(ascent);
    const positions = new Float32Array(POINTS * 3);
    for (let i = 0; i < POINTS; i++) {
      const x = i / (POINTS - 1);
      const t = x < 0.4 ? (x / 0.4) * ascent.burnS : ascent.burnS + ((x - 0.4) / 0.6) * (span - ascent.burnS);
      positions.set(aboveGround(ascentState(ascent, ascent.liftoffMs + t * 1000).pos), i * 3);
    }
    const line = (opacity: number, color: number) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
      const l = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
      l.frustumCulled = false;
      return l;
    };
    const flown = line(0.9, 0xffb454), ahead = line(0.3, 0xffd9a0);
    const holder = new THREE.Group();
    const kind = rocketKind(`${launch.rocket} ${launch.family}`); // the family's own model, else a generic launcher
    const model = rocketModel(kind);
    holder.add(model);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sprite.position.set(0, -0.06, 0); // at the engine bells (the model's base is the holder's origin)
    sprite.scale.setScalar(0.7);
    holder.add(sprite);
    group.add(flown, ahead, holder);
    app.eciGroup.add(group);

    // The preview beside the rocket (only while pointed at): what it is, where it is, and the way to its card.
    const tag = el('div', 'ascent-tag');
    const head = el('div', 'at-head');
    head.append(el('b', '', launch.mission), el('span', '', launch.rocket));
    const live = el('div', 'at-live');
    const stage = el('div', 'at-stage');
    const open = el('button', 'at-open', 'Details');
    open.type = 'button';
    open.addEventListener('click', () => openCard(launch.id));
    const lost = lostAt(launch, ascent);
    const failure = launch.failure;
    // What the card says about the drawing.
    let estimate = `The path is an estimate, from the pad and ${ascent.basis}: no one publishes a rocket's position. The real orbit arrives with the next tracking data.`;
    if (ascent.timeApprox) estimate = `Lift-off time is published only to the hour, so it is drawn from the listed ${clockStamp(ascent.liftoffMs)} and where the rocket is along its path is a guess. ${estimate}`;
    let failText = '';
    if (failure) {
      const what = failure.partial ? 'Partial failure' : 'Launch failure';
      // (When it was lost comes from the reason's own words, so it is not said twice.)
      const when = failure.partial || lost != null ? '' : ' Where in the climb it was lost is not published, so the climb is not drawn.';
      failText = `${what}.${failure.reason ? ` ${failure.reason.length > 220 ? `${failure.reason.slice(0, 217)}…` : failure.reason}` : ' The cause has not been published yet.'}${when}`;
      if (!failure.partial) estimate = lost != null ? `The path up to the moment it was lost is an estimate, from the pad and ${ascent.basis}.` : `The planned path (faint) is an estimate, from the pad and ${ascent.basis}.`;
    }
    let boosterText = '';
    // The booster's way down (estimated): a small first stage, and a mark where it lands.
    let booster: THREE.Group | null = null;
    let landing: THREE.Sprite | null = null;
    if (ascent.booster && lost === undefined) {
      booster = new THREE.Group();
      booster.add(rocketModel(kind));
      booster.visible = false;
      landing = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0x7fe3ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      landing.visible = false;
      group.add(booster, landing);
      boosterText = `The first stage lands on ${ascent.booster.where}${ascent.booster.estimated ? ' (usual for this rocket; not confirmed)' : ''}.`;
    }
    const real = el('div', 'at-real');
    // Where it was lost: a burst that flares and fades.
    let burst: THREE.Sprite | null = null;
    if (lost != null) {
      burst = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xff7a4a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      burst.position.set(...ascentState(ascent, ascent.liftoffMs + lost * 1000).pos);
      burst.visible = false;
      group.add(burst);
    }
    tag.append(head, live, stage, open);
    root.append(tag);
    return {
      ascent, group, flown, ahead, holder, model, glow: sprite, kind, staged: false, tag, live, stage, world: new THREE.Vector3(), shown: false, booster, landing, real, realFor: '',
      lostAtS: lost, failReason: failure?.reason ?? '', burst, screen: null, launch, notes: { estimate, failure: failText, booster: boosterText }, pathOn: true,
    };
  }

  function drop(id: string): void {
    const flight = flights.get(id);
    if (!flight) return;
    app.eciGroup.remove(flight.group);
    for (const line of [flight.flown, flight.ahead]) {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    flight.tag.remove();
    flights.delete(id);
    wanted.delete(id);
    if (card.openId === id) {
      card.close();
      app.sideCard(false);
    }
    if (following === id) {
      // The clock has left this climb's time (Live, a jump): let the camera go, gently, rather
      // than leave it staring at the spot where the rocket was.
      following = null;
      app.follow(null);
    }
  }

  /** The climb's time span: an hour before lift-off to two orbits after; a lost rocket, a minute after the loss. */
  const endOf = (ascent: Ascent, lost: number | null | undefined): number => ascent.liftoffMs + (lost != null ? lost + 60 : lost === null ? 30 * 60 : ascentSpanS(ascent)) * 1000;
  const spanEnd = (flight: Flight): number => endOf(flight.ascent, flight.lostAtS);

  // Escape closes the card of the climb being followed (or any shown), before anything else.
  app.onEscape(() => {
    if (app.away()) return false;
    if (card.openId) {
      closeCard();
      return true;
    }
    if (!following) return false;
    hovered = null;
    {
      following = null;
      app.follow(null);
    }
    return true;
  });

  function startFollowing(id: string, tries = 0): void {
    const flight = flights.get(id);
    if (!flight) return;
    // The camera needs a position to fly to: a flight made this moment has none until its first
    // frame, and asked too soon the camera simply stayed put. Wait (a frame or a few) for it.
    if (!flight.shown) {
      if (tries < 60) requestAnimationFrame(() => startFollowing(id, tries + 1));
      return;
    }
    following = id;
    card.setLocked(card.openId === id);
    app.follow(() => (flights.get(id)?.shown ? flights.get(id)!.world.clone() : null), 0.9);
  }

  watchHandler = (launch) => {
    const ascent = planAscent(launch);
    if (!ascent) return false;
    const go = () => {
      const t = app.time();
      // Not in the window (a launch tomorrow, or one that has been and gone): move the clock to just before lift-off.
      if (t < ascent.liftoffMs - BEFORE_MS || t > ascent.liftoffMs + ascentSpanS(ascent) * 1000) app.jumpTo(ascent.liftoffMs - 30000);
      if (!launches.some((known) => known.id === launch.id)) launches = [...launches, launch];
      wanted.add(launch.id); // drawn even with the "Live launches" layer off
      window.setTimeout(() => {
        update(app.time());
        openCard(launch.id); // first: opening it closes a satellite's card, which lets the camera go
        startFollowing(launch.id);
      }, 60);
    };
    if (app.away()) void app.goEarth().then(go);
    else go();
    return true;
  };

  const refresh = (): void => {
    void loadLaunches().then(({ list }) => {
      if (list) launches = list.launches;
    });
  };
  window.setTimeout(refresh, 8500); // after the bell's first read: the same saved copy, no second request
  window.setInterval(() => {
    if (!document.hidden) refresh();
  }, 5 * 60000);

  const toScreen = new THREE.Vector3();
  function update(timeMs: number): void {
    for (const launch of launches) {
      const ascent = planAscent(launch);
      if (!ascent) continue;
      const known = flights.get(launch.id);
      // A launch whose status changed (it failed during the climb) is drawn afresh with the news.
      if (known && (known.lostAtS !== lostAt(launch, ascent) || (launch.failure?.reason ?? '') !== known.failReason)) drop(launch.id);
      const flight = flights.get(launch.id);
      const end = endOf(ascent, lostAt(launch, ascent)); // the same end the frame loop uses, or the two would fight
      const inWindow = timeMs > ascent.liftoffMs - BEFORE_MS && timeMs < end && (app.settings().liveLaunches || wanted.has(launch.id));
      if (inWindow && !flight) flights.set(launch.id, make(launch, ascent));
      else if (!inWindow && flight) drop(launch.id);
    }
    for (const id of [...flights.keys()]) if (!launches.some((launch) => launch.id === id)) drop(id);
  }

  /**
   * The real objects of a launch: a launch group of the last few days (app.freshLaunches) from
   * the same UTC day (± one), the one whose orbit tilt is nearest the estimate's. Then the card
   * says how the estimate did, and offers to show them.
   */
  let realCheck = 0;
  function matchReal(flight: Flight): void {
    realCheck = performance.now() / 1000;
    const catalog = app.catalog();
    if (!catalog) return;
    const day = flight.ascent.liftoffMs;
    const candidates = app.freshLaunches().filter((group) => group.date && Math.abs(Date.parse(`${group.date}T12:00:00Z`) - day) < 1.5 * 86400000);
    if (candidates.length === 0) return;
    const tilt = (group: (typeof candidates)[number]) => catalog.sats[group.lead].inclinationDeg;
    const best = candidates.sort((a, b) => Math.abs(tilt(a) - flight.ascent.inclinationDeg) - Math.abs(tilt(b) - flight.ascent.inclinationDeg))[0];
    if (flight.realFor === best.id) return;
    flight.realFor = best.id;
    flight.real.replaceChildren();
    const line = el('span', '', `Now tracked: ${best.members.length} object${best.members.length === 1 ? '' : 's'} at ${tilt(best).toFixed(1)}° (the estimate flew at ${flight.ascent.inclinationDeg.toFixed(1)}°). `);
    const show = el('button', 'at-link', 'Show them');
    show.type = 'button';
    show.addEventListener('click', () => app.showLaunchGroup(best.members));
    flight.real.append(line, show);
    if (card.openId === flight.launch.id) card.setNotes({ ...flight.notes, real: flight.real });
  }

  // The catalogue of models: a rocket kind with a launch in the list can be seen climbing.
  const upcomingOf = (kind: string): Launch[] => launches
    .filter((launch) => rocketKind(`${launch.rocket} ${launch.family}`) === kind && planAscent(launch) !== null && launch.netMs > Date.now() - 3 * 3600000)
    .sort((a, b) => a.netMs - b.netMs);
  app.addModelUser({
    label: 'Preview its next launch',
    count: (kind) => upcomingOf(kind).length,
    show: (kind) => {
      const next = upcomingOf(kind)[0];
      return next ? watchLaunch(next) : false;
    },
  });

  // Share links: "#launch=<id>&t=…" opens the climb being followed, at that moment.
  app.addShareLink({
    add: (q) => {
      if (!following || !flights.has(following)) return false;
      q.set('launch', following);
      q.set('t', String(Math.round(app.time() / 1000)));
      return true;
    },
    apply: (q) => {
      const id = q.get('launch');
      if (!id) return false;
      const t = Number(q.get('t'));
      void loadLaunches().then(({ list }) => {
        const launch = list?.launches.find((candidate) => candidate.id === id);
        if (!launch) return app.toast('That launch is no longer in the list of launches.');
        if (!launches.some((known) => known.id === id)) launches = [...launches, launch];
        if (Number.isFinite(t) && t > 0) app.jumpTo(t * 1000);
        watchLaunch(launch);
      });
      return true;
    },
  });

  /** Is a point (scene units) hidden from the camera by the Earth (radius 6.371, at the origin)? */
  const ray = new THREE.Vector3();
  function behindEarth(point: THREE.Vector3): boolean {
    const camera = app.camera.position;
    ray.copy(point).sub(camera);
    const length = ray.length();
    if (length < 1e-9) return false;
    ray.divideScalar(length);
    const t = -camera.dot(ray); // along the ray, the point nearest the Earth's centre
    if (t <= 0 || t >= length) return false;
    const nearest = camera.clone().addScaledVector(ray, t);
    return nearest.length() < 6.371 * 0.999;
  }

  // The layer switched off (or on): drop the climbs nobody asked for at once, not a second later.
  app.onSettings((settings, changed) => {
    if (changed !== 'liveLaunches') return;
    // Off means off: only a climb being followed right now stays (the others asked for earlier go too).
    if (!settings.liveLaunches) for (const id of [...wanted]) if (id !== following) wanted.delete(id);
    update(app.time());
  });

  let checkAt = 0;
  let cardAt = 0;
  app.onFrame((frame) => {
    if (frame.realSeconds - checkAt > 1) {
      checkAt = frame.realSeconds;
      update(frame.timeMs);
    }
    const away = app.away();
    root.classList.toggle('is-hidden', away || frame.uiHidden);
    // The pointer on a rocket (last frame's screen places) or on its open card: that card shows.
    const now = performance.now();
    const onCard = hovered !== null && !!flights.get(hovered)?.tag.matches(':hover');
    const under = pointerAt.mouse ? rocketAt(pointerAt.x, pointerAt.y) : null;
    if (under) {
      hovered = under;
      hoverUntil = now + 450;
    } else if (onCard) hoverUntil = now + 450;
    else if (now > hoverUntil) hovered = null;
    // (A satellite's hover card would stack under the preview: it steps aside while the pointer is on a rocket.)
    document.body.classList.toggle('on-rocket', !!under || onCard);
    for (const [id, flight] of flights) {
      const { ascent } = flight;
      // Out of the climb's time (Live was pressed, or a jump): gone at once, not a second later
      // with the rocket and the camera thrown along an orbit it never flew.
      if (frame.timeMs < ascent.liftoffMs - BEFORE_MS || frame.timeMs > spanEnd(flight)) {
        drop(id);
        continue;
      }
      const state = ascentState(ascent, frame.timeMs);
      flight.group.visible = !away;
      const before = state.t < 0;
      // Lost: nothing flies after the loss (or at all, when where it was lost is not known).
      const gone = flight.lostAtS === null ? !before : flight.lostAtS !== undefined && state.t > flight.lostAtS;
      // The path flown so far, and the rest: split where the rocket is now.
      const span = ascentSpanS(ascent);
      const at = (t: number) => (t < ascent.burnS ? 0.4 * (t / ascent.burnS) : 0.4 + 0.6 * ((t - ascent.burnS) / (span - ascent.burnS)));
      const flownTo = before || flight.lostAtS === null ? 0 : at(flight.lostAtS !== undefined ? Math.min(state.t, flight.lostAtS) : state.t);
      const k = Math.max(1, Math.min(POINTS, Math.round(flownTo * (POINTS - 1)) + 1));
      flight.flown.geometry.setDrawRange(0, k);
      flight.ahead.geometry.setDrawRange(k - 1, POINTS - k + 1);
      flight.ahead.visible = flight.pathOn && !(gone && flight.lostAtS != null);
      flight.flown.visible = flight.pathOn;
      (flight.ahead.material as THREE.LineBasicMaterial).opacity = flight.lostAtS === null ? 0.14 : before ? 0.22 : 0.3;
      if (flight.burst && flight.lostAtS != null) {
        const since = state.t - flight.lostAtS;
        flight.burst.visible = !away && since > 0 && since < 60;
        (flight.burst.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - since / 60);
      }
      // The rocket: on the pad until lift-off, pointing along its motion after.
      flight.holder.visible = !gone && (!before || state.t > -600); // on the pad for the last ten minutes
      // (Lost: the card stays where it was lost, or on the pad when that is not known.)
      flight.holder.position.set(...aboveGround((gone ? ascentState(ascent, ascent.liftoffMs + (flight.lostAtS ?? 0) * 1000) : state).pos));
      const next = ascentState(ascent, frame.timeMs + 2000).pos;
      const dir = new THREE.Vector3(next[0] - state.pos[0], next[1] - state.pos[1], next[2] - state.pos[2]);
      if (before || dir.lengthSq() < 1e-9) dir.set(...state.pos);
      flight.holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      if (state.staged !== flight.staged) {
        // First stage gone: the upper stage carries on alone.
        flight.staged = state.staged;
        flight.holder.remove(flight.model);
        flight.model = rocketModel(state.staged ? 'rocketbody' : flight.kind);
        flight.holder.add(flight.model);
      }
      flight.glow.visible = state.burning && !gone;
      flight.glow.scale.setScalar(0.6 + 0.15 * Math.sin(frame.realSeconds * 31));
      flight.holder.updateMatrixWorld(true);
      flight.world.setFromMatrixPosition(flight.holder.matrixWorld);
      // Drawn larger than life, like a satellite's model: a fixed share of the distance to the camera.
      const distance = app.camera.position.distanceTo(flight.world);
      const size = THREE.MathUtils.clamp(distance * 0.045, 0.004, 0.4) * 1000; // km: the group's parent shrinks by 1000
      flight.holder.scale.setScalar(size);
      if (flight.burst) flight.burst.scale.setScalar(size * (1.2 + Math.min(1, Math.max(0, state.t - (flight.lostAtS ?? 0)) / 8)));
      // The booster coming down, nose up (it lands standing), and the spot it lands on.
      const down = boosterState(ascent, frame.timeMs);
      if (flight.booster && flight.landing) {
        flight.booster.visible = !!down && !down.landed;
        const end = boosterState(ascent, ascent.liftoffMs + (ascent.booster!.landS + 1) * 1000);
        flight.landing.visible = state.t > ascent.stagingS - 60 && state.t < ascent.booster!.landS + 1800 && !!end;
        if (end) flight.landing.position.set(...aboveGround(end.pos));
        flight.landing.scale.setScalar(size * 0.5);
        if (down) {
          flight.booster.position.set(...aboveGround(down.pos));
          flight.booster.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...down.pos).normalize());
          flight.booster.scale.setScalar(size * 0.8);
        }
      }
      // Once the launch's own objects are in the catalogue (data/fresh.ts), say so and offer them.
      if (frame.realSeconds - realCheck > 2) matchReal(flight);
      flight.shown = !away;

      // Where the rocket is on screen, if it can be seen at all: in front of the camera, on the
      // screen, the rocket itself drawn (not gone), and not behind the Earth.
      toScreen.copy(flight.world).project(app.camera);
      const onScreen = !away && !frame.uiHidden && flight.holder.visible && toScreen.z < 1 && Math.abs(toScreen.x) < 1.05 && Math.abs(toScreen.y) < 1.05 && !behindEarth(flight.world);
      const sx = (toScreen.x * 0.5 + 0.5) * window.innerWidth, sy = (0.5 - toScreen.y * 0.5) * window.innerHeight;
      flight.screen = onScreen ? { x: sx, y: sy } : null;
      // The card: only when asked for (see the top of this file).
      const liveText = before ? `${clockText(state.t)} · on the pad`
        : flight.lostAtS === null ? `${clockText(state.t)} · failed`
        : gone ? `${clockText(state.t)} · lost at ${clockText(flight.lostAtS!)}`
        : `${clockText(state.t)} · ${fmtKm(state.altKm)} · ${fmtKmS(state.speedKmS)}`;
      const stageText = gone ? (flight.lostAtS === null ? 'Failed during the climb' : 'Lost') : state.stage;
      if (card.openId === id && frame.realSeconds - cardAt > 0.2) {
        cardAt = frame.realSeconds;
        card.live({ t: state.t, lost: flight.lostAtS !== undefined, clock: clockText(state.t), height: gone || before ? '–' : fmtKm(state.altKm), speed: gone || before ? '–' : fmtKmS(state.speedKmS), stage: before ? 'On the pad' : stageText });
        card.setLocked(following === id);
      }
      // The preview: only while pointed at, and not for the launch whose card is open.
      const visible = onScreen && hovered === id && card.openId !== id;
      flight.tag.classList.toggle('is-hidden', !visible);
      if (!visible) continue;
      // Beside the rocket, clear of it (the pointer is on the rocket), on whichever side has room.
      const width = flight.tag.offsetWidth || 220;
      const left = sx + HIT_PX + 10 + width < window.innerWidth - 8 ? sx + HIT_PX + 10 : sx - HIT_PX - 10 - width;
      flight.tag.style.transform = `translate(${Math.round(left)}px, ${Math.round(sy - 22)}px)`;
      flight.live.textContent = liveText;
      flight.stage.textContent = stageText;
    }
  });
  app.onHome(() => {
    following = null;
    closeCard();
  });
}
