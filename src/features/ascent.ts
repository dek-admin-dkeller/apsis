/**
 * Rockets climbing to orbit, drawn on the globe on an ESTIMATED path (data/ascent.ts).
 *
 * For every launch in the Launch Library list whose pad and time are known to the minute:
 *   - from an hour before lift-off its planned path is drawn faintly, from the pad up to its
 *     first orbit and twice round it;
 *   - from lift-off a rocket model (its own kind where the catalogue of models has one, else a
 *     generic launcher; the upper stage alone after staging) climbs along that path with a
 *     glow while an engine burns, and the part already flown is drawn brighter;
 *   - a card beside it says what it is, T+ time, height, speed and the last event, that the
 *     path is an estimate and why, with "Follow" (the camera stays with it) and "Watch live"
 *     (the webcast the service lists, else a search for one).
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
import { buildModel } from '../render/satModels.ts';
import type { App } from '../ui/app.ts';
import { fmtKm, fmtKmS } from '../ui/dom.ts';

const BEFORE_MS = 60 * 60000; // the planned path appears an hour before lift-off
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
    // Rockets are built standing on their engine bells (render/rocketModels.ts: lowest point −0.5
    // once normalised): lift by half, so the holder's origin is the base and it stands ON the pad.
    model.position.y = 0.5;
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
  /** "Now tracked: …": the real objects of this launch, once they are in the catalogue. */
  real: HTMLElement;
  realFor: string;
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

  function make(launch: Launch, ascent: Ascent): Flight {
    const group = new THREE.Group();
    // The whole path, sampled once: the climb densely, then two trips round the first orbit.
    const span = ascentSpanS(ascent);
    const positions = new Float32Array(POINTS * 3);
    for (let i = 0; i < POINTS; i++) {
      const x = i / (POINTS - 1);
      const t = x < 0.4 ? (x / 0.4) * ascent.burnS : ascent.burnS + ((x - 0.4) / 0.6) * (span - ascent.burnS);
      positions.set(ascentState(ascent, ascent.liftoffMs + t * 1000).pos, i * 3);
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

    const tag = el('div', 'ascent-tag');
    const head = el('div', 'at-head');
    head.append(el('b', '', `${launch.rocket}`), el('span', '', launch.mission));
    const live = el('div', 'at-live');
    const stage = el('div', 'at-stage');
    const note = el('div', 'at-note', `Estimated path, from the pad and ${ascent.basis}. The real orbit arrives with the next tracking data.`);
    const buttons = el('div', 'at-buttons');
    const follow = el('button', '', 'Follow');
    follow.type = 'button';
    follow.addEventListener('click', () => startFollowing(launch.id));
    const watch = el('a', '', 'Watch live ↗');
    watch.href = launch.webcast ?? `https://www.youtube.com/results?search_query=${encodeURIComponent(`${launch.rocket} ${launch.mission} launch`)}`;
    watch.target = '_blank';
    watch.rel = 'noopener noreferrer';
    watch.title = launch.webcast ? 'The webcast Launch Library lists for this launch' : 'No webcast is listed yet: search for one';
    buttons.append(follow, watch);
    // The booster's way down (estimated): a small first stage, and a mark where it lands.
    let booster: THREE.Group | null = null;
    let landing: THREE.Sprite | null = null;
    if (ascent.booster) {
      booster = new THREE.Group();
      booster.add(rocketModel(kind));
      booster.visible = false;
      landing = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0x7fe3ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      landing.visible = false;
      group.add(booster, landing);
      note.textContent += ` Booster: lands on ${ascent.booster.where}${ascent.booster.estimated ? ' (usual for this rocket; not confirmed)' : ''}.`;
    }
    const real = el('div', 'at-real');
    tag.append(head, live, stage, note, real, buttons);
    root.append(tag);
    return { ascent, group, flown, ahead, holder, model, glow: sprite, kind, staged: false, tag, live, stage, world: new THREE.Vector3(), shown: false, booster, landing, real, realFor: '' };
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
    if (following === id) following = null;
  }

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
      window.setTimeout(() => {
        update(app.time());
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
      const inWindow = timeMs > ascent.liftoffMs - BEFORE_MS && timeMs < ascent.liftoffMs + ascentSpanS(ascent) * 1000 && launch.state !== 'failed';
      if (inWindow && !flights.has(launch.id)) flights.set(launch.id, make(launch, ascent));
      else if (!inWindow && flights.has(launch.id)) drop(launch.id);
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

  let checkAt = 0;
  app.onFrame((frame) => {
    if (frame.realSeconds - checkAt > 1) {
      checkAt = frame.realSeconds;
      update(frame.timeMs);
    }
    const away = app.away();
    root.classList.toggle('is-hidden', away || frame.uiHidden);
    for (const [id, flight] of flights) {
      const { ascent } = flight;
      const state = ascentState(ascent, frame.timeMs);
      flight.group.visible = !away;
      const before = state.t < 0;
      // The path flown so far, and the rest: split where the rocket is now.
      const span = ascentSpanS(ascent);
      const x = before ? 0 : state.t < ascent.burnS ? 0.4 * (state.t / ascent.burnS) : 0.4 + 0.6 * ((state.t - ascent.burnS) / (span - ascent.burnS));
      const k = Math.max(1, Math.min(POINTS, Math.round(x * (POINTS - 1)) + 1));
      flight.flown.geometry.setDrawRange(0, k);
      flight.ahead.geometry.setDrawRange(k - 1, POINTS - k + 1);
      (flight.ahead.material as THREE.LineBasicMaterial).opacity = before ? 0.22 : 0.3;
      // The rocket: on the pad until lift-off, pointing along its motion after.
      flight.holder.visible = !before || state.t > -600; // on the pad for the last ten minutes
      flight.holder.position.set(...state.pos);
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
      flight.glow.visible = state.burning;
      flight.glow.scale.setScalar(0.6 + 0.15 * Math.sin(frame.realSeconds * 31));
      flight.holder.updateMatrixWorld(true);
      flight.world.setFromMatrixPosition(flight.holder.matrixWorld);
      // Drawn larger than life, like a satellite's model: a fixed share of the distance to the camera.
      const distance = app.camera.position.distanceTo(flight.world);
      const size = THREE.MathUtils.clamp(distance * 0.045, 0.004, 0.4) * 1000; // km: the group's parent shrinks by 1000
      flight.holder.scale.setScalar(size);
      // The booster coming down, nose up (it lands standing), and the spot it lands on.
      const down = boosterState(ascent, frame.timeMs);
      if (flight.booster && flight.landing) {
        flight.booster.visible = !!down && !down.landed;
        const end = boosterState(ascent, ascent.liftoffMs + (ascent.booster!.landS + 1) * 1000);
        flight.landing.visible = state.t > ascent.stagingS - 60 && state.t < ascent.booster!.landS + 1800 && !!end;
        if (end) flight.landing.position.set(...end.pos);
        flight.landing.scale.setScalar(size * 0.5);
        if (down) {
          flight.booster.position.set(...down.pos);
          flight.booster.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...down.pos).normalize());
          flight.booster.scale.setScalar(size * 0.8);
        }
      }
      // Once the launch's own objects are in the catalogue (data/fresh.ts), say so and offer them.
      if (frame.realSeconds - realCheck > 2) matchReal(flight);
      flight.shown = !away;

      // The card, beside the rocket on screen.
      toScreen.copy(flight.world).project(app.camera);
      const visible = !away && !frame.uiHidden && toScreen.z < 1 && Math.abs(toScreen.x) < 1.05 && Math.abs(toScreen.y) < 1.05;
      flight.tag.classList.toggle('is-hidden', !visible);
      if (!visible) continue;
      const sx = (toScreen.x * 0.5 + 0.5) * window.innerWidth, sy = (0.5 - toScreen.y * 0.5) * window.innerHeight;
      flight.tag.style.transform = `translate(${Math.round(sx + 18)}px, ${Math.round(sy - 20)}px)`;
      flight.live.textContent = before ? `${clockText(state.t)} · on the pad` : `${clockText(state.t)} · ${fmtKm(state.altKm)} up · ${fmtKmS(state.speedKmS)}`;
      flight.stage.textContent = state.stage;
      flight.tag.classList.toggle('is-followed', following === id);
    }
  });
  app.onHome(() => {
    following = null;
  });
}
