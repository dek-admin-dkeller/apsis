/**
 * OrbitHash — entry point. Creates every module and wires them together:
 *
 *   data/      catalogue + Map/Set indexes, orbit maths, catalogue facts, Wikipedia lookups
 *   worker/    SGP4 for the whole catalogue + screening, off the UI thread
 *   hashing/   the spatial hash (the algorithm behind the close-approach monitor)
 *   render/    globe, sky, map layers, satellites, 3D models, ground track, encounter view
 *   ui/        tool panels, inspector, monitor, encounter panel, walkthrough, transport bar
 */

import '@fontsource-variable/inter/index.css';
import '@fontsource-variable/space-grotesk/index.css';
import '@fontsource-variable/jetbrains-mono/index.css';
import './style.css';
import './mobile.css';

import * as THREE from 'three';
import { eciToGeodetic, gstime, type SatRec } from 'satellite.js';
import { buildCatalog, loadLive, loadSnapshot, type Catalog } from './data/catalog.ts';
import { describe } from './data/describe.ts';
import { makeSatrec, rangeKm, stateAt, wrapLon, type Observer, type Vec3 } from './data/ephemeris.ts';
import { loadRegions } from './data/regions.ts';
import { loadFacts, type CatalogFacts } from './data/satcat.ts';
import type { OmmRecord, Satellite, Snapshot } from './data/types.ts';
import { CameraRig } from './render/cameraRig.ts';
import { ConjunctionMarkers } from './render/conjunctionMarkers.ts';
import { EncounterViz, type EncounterFrame } from './render/encounterViz.ts';
import { FirstPersonView } from './render/firstPerson.ts';
import { GeoOverlay } from './render/geoOverlay.ts';
import { createGlobe } from './render/globe.ts';
import { GridViz } from './render/gridViz.ts';
import { GroundTrack } from './render/groundTrack.ts';
import { OrbitLine } from './render/orbitLine.ts';
import { SatelliteModel } from './render/satModels.ts';
import { behindEarth, SatelliteCloud } from './render/satellites.ts';
import { createScene, EARTH_RADIUS, EARTH_RADIUS_KM, KM } from './render/scene.ts';
import { SiteMarker } from './render/siteMarker.ts';
import { createSky } from './render/sky.ts';
import { AheadPanel } from './ui/ahead.ts';
import { BenchmarkModal } from './ui/benchmarkModal.ts';
import { Cinema } from './ui/cinema.ts';
import { CUSTOM_NORAD_ID, Designer } from './ui/designer.ts';
import { renderFeed } from './ui/feed.ts';
import { $, fmt, fmtInt } from './ui/dom.ts';
import { EncounterPanel, type EncounterFocus } from './ui/encounterPanel.ts';
import { Filters } from './ui/filters.ts';
import { HashTrace } from './ui/hashTrace.ts';
import { HowTo } from './ui/howto.ts';
import { Inspector, utcStamp } from './ui/inspector.ts';
import { LoadingScreen } from './ui/intro.ts';
import { Labels } from './ui/labels.ts';
import { Monitor } from './ui/monitor.ts';
import { initSearch } from './ui/search.ts';
import { SettingsStore, type Settings } from './ui/settings.ts';
import { ShareDialog } from './ui/share.ts';
import { Sheets } from './ui/sheet.ts';
import { TimeControls, type SimClock } from './ui/timeControls.ts';
import { Tour } from './ui/tour.ts';
import { Watchlist } from './ui/watchlist.ts';
import type { ScreenStats } from './worker/protocol.ts';
import { SimClient } from './worker/SimClient.ts';

// ---------------------------------------------------------------- state

const clock: SimClock = { time: Date.now(), speed: 1, paused: false };
let catalog: Catalog | null = null;
let baseSnapshot: Snapshot | null = null; // the downloaded data, without anything the user designed
let baseLive = false;
let customRecord: OmmRecord | null = null; // the user's own satellite (Objects → Design a satellite)
let facts = new Map<number, CatalogFacts>();
let conjunctionOn = false;
let gridOn = false;
let screeningDistance = 10; // alert distance d, km
let observer: Observer = { name: '', latDeg: 0, lonDeg: 0 };
let skyLabelsOn = true;

// the selected object: exact SGP4 state, refreshed every frame
let selected: Satellite | null = null;
let selectedRec: SatRec | null = null;
let selEci: Vec3 | null = null; // km, inertial
let selScene: THREE.Vector3 | null = null; // scene units
const selVelocity = new THREE.Vector3(); // travel direction, scene axes

// the open close-approach view
let encFrame: EncounterFrame | null = null;
let replay: { endMs: number; holdMs: number } | null = null;
let encFocus: EncounterFocus = 'both'; // what the camera is centred on
let encModelSize = 0; // scene units
let encViewDistance = 0; // camera distance that frames both objects

// screening bookkeeping
let screenSeq = 0;
let screenPending = false;
let screenDirty = false; // something changed → screen again right away
let lastScreenAt = -Infinity;
let lastStats: ScreenStats | null = null;
let lastPairs: { a: Uint32Array; b: Uint32Array } | null = null; // the monitor's latest list, closest first
let lastTraceAt = -Infinity;

// ---------------------------------------------------------------- modules

const canvas = $<HTMLCanvasElement>('scene');
const kit = createScene(canvas);
const sim = new SimClient();
const loading = new LoadingScreen();
let texturesDone = 0;
const { globe, ready: texturesReady } = createGlobe(kit.scene, () =>
  loading.progress(0.4 + 0.1 * ++texturesDone, 'Loading Earth textures'),
);
const sky = createSky(kit);
const overlay = new GeoOverlay(globe.earth, kit.scene);
const cloud = new SatelliteCloud(kit, sim);
const orbit = new OrbitLine(kit.eciGroup);
const track = new GroundTrack(kit.eciGroup);
const markers = new ConjunctionMarkers(kit, sim);
const encViz = new EncounterViz(kit);
const grid = new GridViz(kit, sim);
const rig = new CameraRig(kit);
const model = new SatelliteModel(kit);
const encModels = [new SatelliteModel(kit, false), new SatelliteModel(kit, false)]; // the two objects of a close approach
const labels = new Labels(kit, sim, cloud);
const trace = new HashTrace(sim);
const site = new SiteMarker(globe.earth, kit); // the ground station / "you are here" marker
const fp = new FirstPersonView(kit, canvas, () => {
  // back from a ride-along or sky view: the ordinary camera and the 3D model take over again
  model.enabled = store.settings.model && !encPanel.isOpen;
});
const watch = new Watchlist(sim, (sat) => select(sat), () => {
  labels.setPinned(watch.indices());
  if (selected) inspector.setStarred(watch.has(selected));
});

const filters = new Filters(() => {
  cloud.visibilityChanged();
  screenDirty = true;
});
const inspector = new Inspector(
  {
    onClose: () => select(null),
    onLock: (on) => setLock(on),
    onJump: (t) => jumpTo(t),
    onTrace: () => howto.open('hw-trace'),
    onStar: () => selected && watch.toggle(selected),
    onRide: () => rideAlong(),
  },
  () => observer,
);
const encPanel = new EncounterPanel({
  onClose: () => closeEncounter(),
  onInspect: (sat) => {
    closeEncounter(true);
    select(sat);
  },
  onFocus: (which) => focusEncounter(which),
  onScrub: (t) => {
    replay = null;
    clock.speed = 1;
    clock.paused = true;
    timeControls.sync();
    jumpTo(t, true);
  },
  onReplay: (fromMs, toMs, speed) => startReplay(fromMs, toMs, speed, encPanel.encounter?.approach.tcaMs ?? toMs),
});
const monitor = new Monitor({
  onToggle: (on) => setConjunction(on),
  onDistance: (d) => {
    screeningDistance = d;
    screenDirty = true;
  },
  onPair: (a, b) => openEncounter(a, b),
  onHow: () => howto.open('hw-grid'),
});
const ahead = new AheadPanel(
  () => (catalog ? { records: catalog.sats.map((sat) => sat.omm), sats: catalog.sats, mask: cloud.visible.slice(), startMs: clock.time } : null),
  (approach) => {
    // A predicted pass: go to that moment and open it like any other close approach.
    jumpTo(approach.tcaMs);
    openEncounter(approach.a, approach.b);
  },
);
const bench = new BenchmarkModal(() => sim.send({ type: 'benchmark', t: clock.time, d: screeningDistance }));
const howto = new HowTo((on) => setGrid(on), () => bench.start(screeningDistance));
const timeControls = new TimeControls(
  clock,
  () => {
    replay = null; // touching the transport takes over from a running replay
    screenDirty = true;
  },
  (t) => jumpTo(t),
  () => jumpToNow(),
);
initSearch(() => catalog, (sat) => select(sat));

// ---- settings (layers, appearance, quality, ground station) -------------------------------

let qualitySetting: Settings['quality'] | null = null;
function applySettings(s: Settings, changed: keyof Settings | null): void {
  cloud.setColorMode(s.colorMode);
  for (const mode of ['category', 'orbit', 'altitude']) document.body.classList.toggle(`color-${mode}`, s.colorMode === mode);
  $('altitude-legend').classList.toggle('is-hidden', s.colorMode !== 'altitude');
  labels.mode = s.labels;
  cloud.setPointSize(s.pointSize);
  kit.setBloom(s.glow);
  orbit.enabled = s.orbitPath;
  track.trackOn = s.groundTrack;
  track.footprintOn = s.footprint;
  model.enabled = s.model && !encPanel.isOpen;
  rig.autoOrbit = s.autoOrbit;
  rig.earthDrift = s.earthDrift;
  document.body.classList.toggle('quiet-ui', s.quietUi);
  site.set(s.siteLat, s.siteLon);
  site.setVisible(s.siteMarker);
  sky.setConstellations(s.constellations);
  globe.setClouds(s.clouds);
  globe.setAtmosphere(s.atmosphere);
  overlay.setBorders(s.borders);
  overlay.setGraticule(s.graticule);
  overlay.setTerminator(s.terminator);
  sky.setStars(s.stars);
  sky.setPlanets(s.planets);
  skyLabelsOn = s.skyLabels;
  observer = { name: s.siteName, latDeg: s.siteLat, lonDeg: s.siteLon };
  if (changed === null || changed.startsWith('site')) inspector.observerChanged();
  if (s.quality !== qualitySetting) {
    qualitySetting = s.quality;
    kit.setQuality(s.quality === 'auto' ? 'balanced' : s.quality); // Auto starts balanced and steps down if needed
  }
  // Blurring the globe behind every panel costs GPU time each frame; skip it in Fast quality.
  document.body.classList.toggle('no-glass', !s.glass || kit.quality === 'fast');
}
const store = new SettingsStore(applySettings);

// Location is only ever used after the user has said yes in Apsis itself (the button, the
// tour, or the one-time question below) — and then the browser asks again in its own prompt.
const LOCATION_CONSENT = 'apsis.location.consent'; // 'yes' | 'no'
const consent = (): string | null => {
  try {
    return localStorage.getItem(LOCATION_CONSENT);
  } catch {
    return null;
  }
};
const setConsent = (value: 'yes' | 'no') => {
  try {
    localStorage.setItem(LOCATION_CONSENT, value);
  } catch { /* storage unavailable: the question may be asked again next visit */ }
};

/**
 * Ask the browser where the user is, make that the ground station, and show it on the globe.
 * `quiet` = a returning visitor who already agreed: update the position without messages or camera moves.
 */
function locate(quiet = false): void {
  if (!navigator.geolocation) {
    if (!quiet) toast('This browser cannot share a location');
    return;
  }
  if (!quiet) {
    setConsent('yes'); // pressing the button is the yes
    toast('Asking the browser for your location…', 9000);
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      store.set('siteName', 'My location');
      store.set('siteLat', Math.round(position.coords.latitude * 100) / 100);
      store.set('siteLon', Math.round(position.coords.longitude * 100) / 100);
      store.set('siteMarker', true);
      if (quiet) return;
      toast('You are the green dot. Passes and the sky view now use this spot.', 5000);
      if (fp.mode === 'off' && !encPanel.isOpen) {
        rig.follow = false;
        inspector.setLock(false);
        rig.flyToView(site.worldPosition(new THREE.Vector3()).normalize().multiplyScalar(15), ORIGIN.clone(), 2);
      }
    },
    () => {
      if (!quiet) toast('Location was not shared. You can type coordinates in Settings.', 5000);
    },
    { timeout: 10000, maximumAge: 600000 },
  );
}

/** The one-time question, shown after the tour (or the intro, for returning visitors who were never asked). */
function askForLocation(): void {
  if (consent() !== null || !navigator.geolocation || document.getElementById('loc-ask')) return;
  const card = document.createElement('div');
  card.id = 'loc-ask';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Show your location');
  card.innerHTML = '<h2>Show where you are on the globe?</h2>'
    + '<p>Apsis can mark your location with a green dot and use it for passes overhead and the sky view. It stays in this browser and is never shared.</p>'
    + '<div><button class="btn" data-answer="no">No thanks</button><button class="btn btn-primary" data-answer="yes">Allow</button></div>';
  card.addEventListener('click', (event) => {
    const answer = (event.target as HTMLElement).closest<HTMLElement>('[data-answer]')?.dataset.answer;
    if (!answer) return;
    card.remove();
    if (answer === 'yes') locate();
    else setConsent('no');
  });
  document.body.append(card);
}

/** A returning visitor who agreed before, and whose browser still grants it: refresh the position silently. */
function refreshLocationIfAllowed(): void {
  if (consent() !== 'yes' || !navigator.permissions) return;
  void navigator.permissions.query({ name: 'geolocation' }).then((status) => {
    if (status.state === 'granted') locate(true);
  }, () => { /* permissions API not supported for geolocation: leave the saved position */ });
}
$('locate').addEventListener('click', () => locate());
$('locate-top').addEventListener('click', () => locate());

// ---- tool panels (the rail on the left opens one at a time) -------------------------------

type PanelName = 'objects' | 'layers' | 'conj' | 'settings';
let openPanelName: PanelName | null = null;
function openPanel(name: PanelName | null): void {
  openPanelName = name;
  document.body.classList.toggle('panel-open', name !== null); // bars stay solid while a tool panel is in use
  for (const button of document.querySelectorAll<HTMLElement>('.rail-btn')) {
    const on = button.dataset.panel === name;
    button.classList.toggle('is-on', on);
    $(`panel-${button.dataset.panel}`).classList.toggle('is-hidden', !on);
  }
}
const togglePanel = (name: PanelName) => openPanel(openPanelName === name ? null : name);
for (const button of document.querySelectorAll<HTMLElement>('.rail-btn')) {
  button.addEventListener('click', () => togglePanel(button.dataset.panel as PanelName));
}
for (const button of document.querySelectorAll<HTMLElement>('[data-close-panel]')) {
  button.addEventListener('click', () => openPanel(null));
}

// ---- phones: panels are bottom sheets ------------------------------------------------------

const isPhone = () => Sheets.isPhone;
let viewShift = -1;
const sheets = new Sheets(() => (viewShift = -1)); // sheets can be dragged to any height
window.addEventListener('resize', () => (viewShift = -1));
/**
 * On a phone a sheet covers the lower part of the screen, so the centre of the 3D view is
 * moved up into the visible part — otherwise the selected object would sit behind the sheet.
 */
function updateViewShift(): void {
  const sheetOpen = isPhone() && (inspector.isOpen || encPanel.isOpen || openPanelName !== null);
  const shift = sheetOpen ? sheets.current : 0;
  if (shift === viewShift) return;
  viewShift = shift;
  if (shift > 0) kit.camera.setViewOffset(window.innerWidth, window.innerHeight, 0, shift / 2, window.innerWidth, window.innerHeight);
  else kit.camera.clearViewOffset();
}

// ---- small helpers -------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);
const ORIGIN = new THREE.Vector3();
const toScene = (p: Vec3) => new THREE.Vector3(p.x, p.z, -p.y).multiplyScalar(KM);

let toastTimer = 0;
const toastEl = document.createElement('div');
toastEl.id = 'toast';
document.body.append(toastEl);
function toast(text: string, ms = 2600): void {
  toastEl.textContent = text;
  toastEl.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('is-on'), ms);
}

/** Recompute the selected object's exact position and velocity for the current clock time. */
function refreshSelected(): void {
  const state = selectedRec ? stateAt(selectedRec, clock.time) : null;
  if (!state) {
    selEci = selScene = null;
    return;
  }
  selEci = state.position;
  selScene = toScene(state.position);
  selVelocity.set(state.velocity.x, state.velocity.z, -state.velocity.y);
}

// ---------------------------------------------------------------- selection + camera

const FOCUS_DISTANCE = 0.1; // scene units (100 km): the 3D model fills about a quarter of the view

function select(sat: Satellite | null): void {
  if (encPanel.isOpen && sat) closeEncounter(true);
  if (fp.mode === 'satellite') fp.exit(); // the ride is tied to the object being left
  selected = sat;
  selectedRec = sat ? makeSatrec(sat) : null;
  orbit.setSatellite(sat);
  track.setSatellite(selectedRec, sat ? sat.periodMin : 0);
  lastTraceAt = -Infinity;
  refreshSelected();
  if (!sat) {
    inspector.hide();
    model.setKind(null);
    $('reticle').classList.add('is-hidden');
    rig.follow = false;
    rig.release();
    return;
  }
  model.setKind(describe(sat).kind);
  rig.follow = true;
  if (isPhone()) openPanel(null); // one sheet at a time on a phone
  inspector.show(sat, facts.get(sat.noradId), true);
  inspector.setStarred(watch.has(sat));
  rig.flyToFocus(() => selScene, FOCUS_DISTANCE);
}

/** Camera lock: on = the object stays in the centre and the camera turns around it. */
function setLock(on: boolean): void {
  rig.follow = on;
  inspector.setLock(on);
  if (on && selected && selScene) {
    const distance = THREE.MathUtils.clamp(kit.camera.position.distanceTo(selScene), 0.03, 16);
    rig.flyToFocus(() => selScene, Math.min(distance, 1.2), 1.2);
  }
}

// ---- first-person views -------------------------------------------------------------------

/** Ride along: sit on the selected object and look out from it. */
function rideAlong(): void {
  if (fp.mode === 'satellite') return fp.exit();
  if (!selected) return;
  model.enabled = false; // the camera is inside it
  fp.enterSatellite(selected.name);
}

/** Sky view: stand at the ground station and watch the objects cross overhead. */
function skyView(): void {
  if (fp.mode === 'ground') return fp.exit();
  if (encPanel.isOpen) closeEncounter(true);
  fp.enterGround(observer);
}
$('view-sky').addEventListener('click', skyView);

// ---- close-approach view ------------------------------------------------------------------

function openEncounter(aIndex: number, bIndex: number): void {
  if (!catalog) return;
  if (fp.mode !== 'off') fp.exit();
  if (selected) {
    // leave the inspector without sending the camera back to the whole-Earth view
    selected = selectedRec = null;
    orbit.setSatellite(null);
    track.setSatellite(null, 0);
    model.setKind(null);
    inspector.hide();
    $('reticle').classList.add('is-hidden');
  }
  if (isPhone()) openPanel(null);
  const encounter = encPanel.open(catalog.sats[aIndex], catalog.sats[bIndex], clock.time, screeningDistance);
  const { approach, windowS } = encounter;
  encViz.show(encounter.recA, encounter.recB, approach, windowS);
  monitor.setActive(aIndex, bIndex);
  markers.setVisible(false); // the encounter drawing replaces the generic red markers
  model.enabled = false;

  // Both objects get their 3D model. Models are drawn far larger than life, so their size is
  // tied to the miss distance — big enough to see, never so big that the two overlap.
  encModels[0].setKind(describe(encounter.a).kind);
  encModels[1].setKind(describe(encounter.b).kind);
  encViz.setModelsShown(store.settings.model);

  // Frame the pair itself: close enough that the two models and the gap between them fill
  // the view (the gap spans roughly half the screen at the closest point).
  const nowKm = rangeKm(encounter.recA, encounter.recB, clock.time);
  const gapKm = approach.coMoving && Number.isFinite(nowKm) ? Math.max(nowKm, approach.missKm) : approach.missKm;
  encViewDistance = THREE.MathUtils.clamp(Math.max(gapKm, 0.3) * 2.6 * KM, 0.0004, 1.2);
  encModelSize = Math.max(gapKm * 0.32, 0.05) * KM; // a third of the gap: large, but they can never touch
  if (approach.coMoving) {
    clock.paused = true;
    timeControls.sync();
  } else {
    // Play the approach in: from the edge of the window up to the closest point, then hold there.
    startReplay(approach.tcaMs - windowS * 1000, approach.tcaMs, (2 * windowS) / 10, approach.tcaMs);
  }
  encFrame = encViz.update(clock.time, realSeconds);
  focusEncounter('both', 1.4);
}

/** Centre the camera on one object of the pair (to zoom in and turn around it), or on both. */
function focusEncounter(which: EncounterFocus, duration = 1.1): void {
  encFocus = which;
  encPanel.setFocus(which);
  rig.follow = true;
  rig.flyToFocus(
    () => (!encFrame ? null : encFocus === 'a' ? encFrame.a : encFocus === 'b' ? encFrame.b : encFrame.mid),
    which === 'both' ? encViewDistance : encModelSize * 4.5,
    duration,
    encModelSize * 1.1, // may zoom right up to the model
  );
}

function closeEncounter(keepCamera = false): void {
  if (!encPanel.isOpen) return;
  encPanel.close();
  encViz.hide();
  for (const m of encModels) m.setKind(null);
  encFrame = null;
  replay = null;
  monitor.setActive(-1, -1);
  markers.setVisible(conjunctionOn);
  model.enabled = store.settings.model;
  $('range-tag').classList.add('is-hidden');
  clock.speed = 1;
  clock.paused = false;
  timeControls.sync();
  screenDirty = true;
  if (!keepCamera) {
    rig.follow = false;
    rig.release();
  }
}

function startReplay(fromMs: number, toMs: number, speed: number, holdMs: number): void {
  replay = { endMs: toMs, holdMs };
  clock.speed = speed;
  clock.paused = false;
  timeControls.sync();
  jumpTo(fromMs, true);
}

// ---- monitor + screening cells ------------------------------------------------------------

function setConjunction(on: boolean): void {
  conjunctionOn = on;
  monitor.setEnabled(on);
  markers.setVisible(on && !encPanel.isOpen);
  $('readout-pairs').classList.toggle('is-on', on);
  $('sb-screen-wrap').classList.toggle('is-hidden', !on);
  if (on) {
    screenDirty = true;
    openPanel('conj');
  } else {
    closeEncounter();
    markers.setPairs(new Uint32Array(0), new Uint32Array(0), screeningDistance);
  }
}

function setGrid(on: boolean): void {
  gridOn = on;
  $<HTMLInputElement>('layer-grid').checked = on;
  $<HTMLInputElement>('grid-toggle').checked = on;
  grid.setVisible(on);
  if (!on) $('grid-note').textContent = '';
  // Cells are only d km wide — move in close enough to actually see them.
  if (on && selected && selScene) {
    const want = screeningDistance * KM * 14;
    if (kit.camera.position.distanceTo(selScene) > want * 2.5 || kit.camera.position.distanceTo(selScene) < want * 0.4) {
      rig.follow = true;
      inspector.setLock(true);
      rig.flyToFocus(() => selScene, want, 1.4);
    }
  }
}
$('layer-grid').addEventListener('change', () => setGrid($<HTMLInputElement>('layer-grid').checked));

// ---- time ---------------------------------------------------------------------------------

/** Move the clock. `keepReplay` is used by the replay itself; any other jump cancels it. */
function jumpTo(timeMs: number, keepReplay = false): void {
  if (!keepReplay) replay = null;
  clock.time = timeMs;
  sim.reset();
  screenDirty = true;
  lastTraceAt = -Infinity;
}

function jumpToNow(): void {
  clock.speed = 1;
  clock.paused = false;
  timeControls.sync();
  jumpTo(Date.now());
}

// ---- view presets (keys 1 / 2 / 3), placed relative to the sun so the day side is in view

function sunFrame() {
  const sun = globe.sunDirection.clone();
  const side = new THREE.Vector3().crossVectors(UP, sun).normalize();
  return { sun, side, up: UP.clone() };
}

function homeView(): THREE.Vector3 {
  const { sun, side, up } = sunFrame();
  return sun.multiplyScalar(0.72).add(side.multiplyScalar(0.62)).add(up.multiplyScalar(0.3)).normalize().multiplyScalar(23);
}

function preset(which: number): void {
  if (fp.mode !== 'off') fp.exit();
  rig.follow = false;
  inspector.setLock(false);
  const { sun, side, up } = sunFrame();
  if (which === 1) {
    rig.flyToView(homeView(), ORIGIN.clone());
  } else if (which === 2) {
    // Skim low over the day side, looking south along the horizon through the LEO shell.
    const spot = sun.setY(0).normalize().multiplyScalar(0.75).add(side.multiplyScalar(0.35)).add(up.clone().multiplyScalar(0.62)).normalize();
    const south = up.clone().negate().addScaledVector(spot, spot.y).normalize(); // "down the map", tangent to the surface
    const target = spot.clone().multiplyScalar(7.05);
    rig.flyToView(target.clone().addScaledVector(south, -3.0).addScaledVector(spot, 0.35), target);
  } else {
    // High above the north pole: the geostationary belt shows up as a clean ring.
    rig.flyToView(sun.setY(0).normalize().multiplyScalar(74).add(up.multiplyScalar(66)), ORIGIN.clone(), 2.2);
  }
}

// ---------------------------------------------------------------- catalogue loading

/** Shortcuts to well-known objects (Objects panel). Each entry: label + how to find it. */
const NOTABLE: [string, (c: Catalog) => Satellite | undefined][] = [
  ['Space Station', (c) => c.byName.get('ISS (ZARYA)')?.[0]],
  ['Tiangong', (c) => c.byName.get('CSS (TIANHE)')?.[0]],
  ['Hubble', (c) => c.byName.get('HST')?.[0]],
  ['Landsat 9', (c) => c.byName.get('LANDSAT 9')?.[0]],
  ['GOES 19', (c) => c.byName.get('GOES 19')?.[0]],
  ['TerraSAR-X', (c) => c.byName.get('TERRASAR-X')?.[0]],
  ['A Starlink', (c) => c.sats[[...(c.byCategory.get('Starlink') ?? [])][0]]],
  ['A GPS satellite', (c) => c.sats.find((s) => s.name.startsWith('GPS '))],
  ['A debris fragment', (c) => c.sats[[...(c.byCategory.get('Debris') ?? [])][0]]],
];

function applyCatalog(next: Catalog): void {
  closeEncounter(true);
  if (selected) select(null);
  catalog = next;
  screenSeq++; // ignore screening results that belong to the previous catalogue
  screenPending = false;
  markers.setPairs(new Uint32Array(0), new Uint32Array(0), screeningDistance);
  sim.init(next.sats.map((sat) => sat.omm));
  cloud.setCatalog(next);
  filters.setCatalog(next, cloud.visible);
  labels.setCatalog(next);
  watch.setCatalog(next);
  labels.setPinned(watch.indices());
  ahead.reset();
  $('stat-tracked').textContent = fmtInt(next.sats.length);
  $('data-age').textContent = `${utcStamp(Date.parse(next.fetchedAt))} UTC${next.live ? ' (live)' : ''}`;
  updateDataNote();

  $('quick-list').replaceChildren(...NOTABLE.flatMap(([label, find]) => {
    const sat = find(next);
    if (!sat) return [];
    const button = document.createElement('button');
    button.textContent = label;
    button.title = sat.name;
    button.addEventListener('click', () => select(sat));
    return [button];
  }));
}

/** Rebuild the catalogue from the downloaded data plus the user's own satellite, if there is one. */
function rebuildCatalog(): void {
  if (!baseSnapshot) return;
  const snapshot = customRecord ? { ...baseSnapshot, objects: [...baseSnapshot.objects, customRecord] } : baseSnapshot;
  applyCatalog(buildCatalog(snapshot, baseLive));
  designer.catalogChanged(customRecord !== null);
}

const designer = new Designer($('designer-body'), {
  launch: (record) => {
    customRecord = record;
    rebuildCatalog();
    const sat = catalog?.byNorad.get(CUSTOM_NORAD_ID) ?? null;
    if (sat) select(sat);
    return sat;
  },
  remove: () => {
    customRecord = null;
    rebuildCatalog();
  },
  context: () => (catalog ? { records: catalog.sats.map((sat) => sat.omm), sats: catalog.sats, mask: cloud.visible.slice(), startMs: clock.time } : null),
  openApproach: (a, b, tcaMs) => {
    jumpTo(tcaMs);
    openEncounter(a, b);
  },
  now: () => clock.time,
});

function updateDataNote(): void {
  if (!catalog) return;
  const ageH = (Date.now() - Date.parse(catalog.fetchedAt)) / 3.6e6;
  $('data-note').textContent =
    `Orbital elements ${catalog.live ? 'downloaded' : 'saved'} ${utcStamp(Date.parse(catalog.fetchedAt))} UTC, ${ageH < 48 ? `${fmt(ageH, 0)} hours` : `${fmt(ageH / 24, 0)} days`} ago. `
    + (facts.size > 0 ? `Catalogue facts loaded for ${fmtInt(facts.size)} objects.` : 'Catalogue facts (owner, launch, size) are not bundled yet.');
  renderFeed(catalog, facts, (sat) => select(sat));
  $('about-data').textContent = `${fmtInt(catalog.sats.length)} objects, elements from ${utcStamp(Date.parse(catalog.fetchedAt))} UTC`;
}

$('refresh').addEventListener('click', async () => {
  const button = $<HTMLButtonElement>('refresh');
  button.disabled = true;
  button.textContent = 'Contacting CelesTrak…';
  try {
    baseSnapshot = await loadLive();
    baseLive = true;
    rebuildCatalog();
    button.textContent = 'Current elements loaded';
  } catch {
    // CORS, offline, or rate-limited: quietly keep the saved data.
    button.textContent = 'Unavailable — keeping saved data';
  }
  setTimeout(() => {
    button.disabled = false;
    button.textContent = 'Download current elements';
  }, 4000);
});

// ---------------------------------------------------------------- worker messages

let firstSnapshot: (() => void) | null = null;
sim.onSnapshot = () => {
  cloud.onSnapshot();
  firstSnapshot?.();
};

sim.onMessage = (msg) => {
  if (msg.type === 'screen') {
    screenPending = false;
    if (msg.seq !== screenSeq || !catalog) return;
    lastStats = msg.stats;
    howto.setStats(msg.stats, msg.d);
    if (!conjunctionOn) return;
    markers.setPairs(msg.pairA, msg.pairB, msg.d);
    lastPairs = { a: msg.pairA, b: msg.pairB };
    monitor.setResult(msg, catalog);
    $('sb-screen').textContent = `${fmt(msg.stats.hashMs, 1)} ms`;
  } else if (msg.type === 'benchRow') {
    bench.addRow(msg.row, msg.index, msg.total);
  } else if (msg.type === 'benchDone') {
    bench.done();
  }
};

/** Ask the worker for a screening pass: about once a second, or right away after a change. */
function requestScreening(realSeconds: number): void {
  const wanted = conjunctionOn || (howto.isOpen && (!lastStats || screenDirty));
  if (!wanted || screenPending || !sim.hasData) return;
  if (clock.paused && !screenDirty && lastStats) return; // nothing moves while paused
  if (realSeconds - lastScreenAt < (screenDirty ? 0.12 : 1)) return;
  screenPending = true;
  screenDirty = false;
  lastScreenAt = realSeconds;
  sim.send({ type: 'screen', t: clock.time, d: screeningDistance, mask: cloud.visible, seq: ++screenSeq });
}

// ---------------------------------------------------------------- mouse: hover + click

const tooltip = $('tooltip');
const pointer = { x: 0, y: 0, dirty: false, downX: 0, downY: 0 };

canvas.addEventListener('pointermove', (event) => {
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  pointer.dirty = event.buttons === 0; // no hover test while dragging
  if (event.buttons !== 0) tooltip.classList.add('is-hidden');
});
canvas.addEventListener('pointerleave', () => tooltip.classList.add('is-hidden'));
canvas.addEventListener('pointerdown', (event) => {
  pointer.downX = event.clientX;
  pointer.downY = event.clientY;
});
canvas.addEventListener('pointerup', (event) => {
  if (!catalog || Math.hypot(event.clientX - pointer.downX, event.clientY - pointer.downY) > 4) return; // it was a drag
  const index = cloud.pick(event.clientX, event.clientY, 12);
  if (index >= 0 && index !== selected?.index) select(catalog.sats[index]);
});

function updateHover(): void {
  if (!pointer.dirty || !catalog) return;
  pointer.dirty = false;
  const index = cloud.pick(pointer.x, pointer.y);
  canvas.style.cursor = index >= 0 ? 'pointer' : '';
  tooltip.classList.toggle('is-hidden', index < 0);
  if (index >= 0) {
    const sat = catalog.sats[index];
    const kind = document.createElement('span');
    kind.textContent = `${sat.category}, ${fmtInt(sat.meanAltKm)} km`;
    tooltip.replaceChildren(sat.name, kind);
    tooltip.style.left = `${pointer.x}px`;
    tooltip.style.top = `${pointer.y}px`;
  }
}

// ---------------------------------------------------------------- top-bar tools + keyboard

let wantShot = false;
$('shot').addEventListener('click', () => (wantShot = true));
function saveShot(): void {
  // Called right after a frame was drawn, while the picture is still in the canvas.
  canvas.toBlob((blob) => {
    if (!blob) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `apsis-${new Date(clock.time).toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    toast('Picture saved to your downloads');
  }, 'image/png');
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => toast('Full screen is not available here'));
}
$('fullscreen').addEventListener('click', toggleFullscreen);

const keysOverlay = $('keys');
const setKeys = (open: boolean) => keysOverlay.classList.toggle('is-hidden', !open);
$('keys-open').addEventListener('click', () => setKeys(true));
$('keys-close').addEventListener('click', () => setKeys(false));
keysOverlay.addEventListener('pointerdown', (event) => {
  if (event.target === keysOverlay) setKeys(false);
});
for (const button of document.querySelectorAll<HTMLElement>('[data-view]')) {
  button.addEventListener('click', () => preset(Number(button.dataset.view)));
}

// ---- share links: the address after # describes what is on screen ---------------------------

function shareUrl(): string {
  const q = new URLSearchParams();
  const enc = encPanel.encounter;
  if (enc) {
    q.set('pair', `${enc.a.noradId}-${enc.b.noradId}`);
    q.set('t', String(Math.round(enc.approach.tcaMs / 1000)));
  } else {
    if (selected) q.set('sat', String(selected.noradId));
    else q.set('cam', kit.camera.position.toArray().map((v) => v.toFixed(2)).join(','));
    if (Math.abs(clock.time - Date.now()) > 60000) q.set('t', String(Math.round(clock.time / 1000)));
  }
  return `${location.origin}${location.pathname}#${q.toString()}`;
}
const shareDialog = new ShareDialog();
$('share').addEventListener('click', () => shareDialog.open(shareUrl(), !!selected || encPanel.isOpen));

/** Was the page opened from a share link? If so, restore what it describes. */
function applyLink(): boolean {
  if (!catalog) return false;
  const q = new URLSearchParams(location.hash.slice(1));
  const t = Number(q.get('t'));
  const byId = (id: string | undefined) => catalog!.byNorad.get(Number(id));
  const [idA, idB] = (q.get('pair') ?? '').split('-');
  const a = byId(idA), b = byId(idB), sat = byId(q.get('sat') ?? undefined);
  const cam = (q.get('cam') ?? '').split(',').map(Number);
  if (!(a && b) && !sat && cam.length !== 3 && !q.has('t')) return false;
  if (q.has('t') && Number.isFinite(t)) jumpTo(t * 1000);
  if (a && b) openEncounter(a.index, b.index);
  else if (sat) select(sat);
  else if (cam.length === 3 && cam.every(Number.isFinite)) {
    kit.camera.position.set(cam[0], cam[1], cam[2]);
    kit.controls.target.set(0, 0, 0);
  }
  return true;
}

// ---- about, tour ---------------------------------------------------------------------------

const aboutOverlay = $('about');
const setAbout = (open: boolean) => aboutOverlay.classList.toggle('is-hidden', !open);
$('about-open').addEventListener('click', () => setAbout(true));
$('about-close').addEventListener('click', () => setAbout(false));
aboutOverlay.addEventListener('pointerdown', (event) => {
  if (event.target === aboutOverlay) setAbout(false);
});
$('about-how').addEventListener('click', () => {
  setAbout(false);
  howto.open();
});

const tour = new Tour({
  selectByName: (name) => {
    const sat = catalog?.byName.get(name)?.[0];
    if (sat) select(sat);
  },
  deselect: () => {
    closeEncounter(true);
    if (selected) select(null);
  },
  openPanel: (name) => openPanel(name),
  setMonitor: (on) => {
    if (on !== conjunctionOn) setConjunction(on);
  },
  preset: (which) => preset(which),
  locate: () => locate(),
  openHowTo: () => howto.open(),
});
$('tour-start').addEventListener('click', () => {
  setKeys(false);
  tour.start();
});

// ---- autopilot + video recording -------------------------------------------------------------

/** Open the closest pair in the monitor's list that is genuinely crossing (not flying together). */
function openClosestCrossing(): boolean {
  if (!catalog || !lastPairs || !conjunctionOn) return false;
  for (let k = 0; k < Math.min(lastPairs.a.length, 80); k++) {
    const a = catalog.sats[lastPairs.a[k]], b = catalog.sats[lastPairs.b[k]];
    const sa = stateAt(makeSatrec(a), clock.time), sb = stateAt(makeSatrec(b), clock.time);
    if (!sa || !sb) continue;
    const closing = Math.hypot(sa.velocity.x - sb.velocity.x, sa.velocity.y - sb.velocity.y, sa.velocity.z - sb.velocity.z);
    if (closing < 0.5) continue;
    openEncounter(a.index, b.index);
    return true;
  }
  return false;
}

const cinema = new Cinema({
  selectByName: (name) => {
    const sat = catalog?.byName.get(name)?.[0];
    if (sat) select(sat);
    return !!sat;
  },
  deselect: () => {
    closeEncounter(true);
    if (selected) select(null);
  },
  preset: (which) => preset(which),
  rideAlong: (on) => {
    if (on !== (fp.mode === 'satellite')) rideAlong();
  },
  skyView: (on) => {
    if (on !== (fp.mode === 'ground')) skyView();
  },
  setMonitor: (on) => {
    if (on !== conjunctionOn) setConjunction(on);
  },
  openClosestCrossing,
  closeApproach: () => closeEncounter(),
  setSpeed: (multiplier) => {
    replay = null;
    clock.speed = multiplier;
    clock.paused = false;
    timeControls.sync();
    screenDirty = true;
  },
  hideInterface: (on) => document.body.classList.toggle('ui-hidden', on),
  toast: (text) => toast(text, 4000),
}, canvas);
function toggleAutopilot(): void {
  if (cinema.isPlaying) return cinema.stop();
  if (tour.isRunning) tour.stop();
  setKeys(false);
  openPanel(null);
  cinema.play();
}
$('autopilot').addEventListener('click', toggleAutopilot);
$('record').addEventListener('click', () => cinema.toggleRecording());
cinema.onChange = () => {
  $('autopilot').setAttribute('aria-pressed', String(cinema.isPlaying));
  $('record').setAttribute('aria-pressed', String(cinema.isRecording));
};

window.addEventListener('keydown', (event) => {
  const el = event.target as HTMLElement;
  if (el instanceof HTMLInputElement && el.type !== 'checkbox' && el.type !== 'range') return; // typing in a field
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  switch (event.key.toLowerCase()) {
    case '1': preset(1); break;
    case '2': preset(2); break;
    case '3': preset(3); break;
    case '4': skyView(); break;
    case 'v': rideAlong(); break;
    case 's': if (selected) watch.toggle(selected); break;
    case 'o': togglePanel('objects'); break;
    case 'l': togglePanel('layers'); break;
    case ',': togglePanel('settings'); break;
    case 'c': setConjunction(!conjunctionOn); break;
    case 'g': setGrid(!gridOn); break;
    case 't': if (selected) setLock(!rig.follow); break;
    case 'r': timeControls.flip(); replay = null; screenDirty = true; break;
    case '[': timeControls.step(-1); break;
    case ']': timeControls.step(1); break;
    case 'n': jumpToNow(); break;
    case 'p': wantShot = true; break;
    case 'a': toggleAutopilot(); break;
    case 'm': cinema.toggleRecording(); break;
    case 'f': toggleFullscreen(); break;
    case 'h': document.body.classList.toggle('ui-hidden'); break;
    case '/':
      event.preventDefault();
      $('search').focus();
      break;
    case ' ':
      event.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur(); // so Space does not also "click" a focused button
      replay = null;
      clock.paused = !clock.paused;
      timeControls.sync();
      screenDirty = true;
      break;
    case 'escape':
      if (bench.isOpen) bench.close();
      else if (howto.isOpen) howto.close();
      else if (!keysOverlay.classList.contains('is-hidden')) setKeys(false);
      else if (!aboutOverlay.classList.contains('is-hidden')) setAbout(false);
      else if (shareDialog.isOpen) shareDialog.close();
      else if (fp.mode !== 'off') fp.exit();
      else if (document.body.classList.contains('ui-hidden')) document.body.classList.remove('ui-hidden');
      else if (encPanel.isOpen) closeEncounter();
      else if (selected) select(null);
      else openPanel(null);
      break;
    case '?': setKeys(keysOverlay.classList.contains('is-hidden')); break;
  }
});

// ---------------------------------------------------------------- per-frame updates

const reticle = $('reticle');
let labelAvoid: { x: number; y: number; r: number } | null = null;
const rangeTag = $('range-tag');

/** Project a scene point to screen pixels; null if it is behind the camera. */
function toScreen(point: THREE.Vector3): { x: number; y: number } | null {
  const p = point.clone().project(kit.camera);
  if (p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1) return null;
  return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (0.5 - p.y * 0.5) * window.innerHeight };
}

function updateSelection(realSeconds: number): void {
  if (!selected) {
    labelAvoid = null;
    return;
  }
  orbit.update(clock.time, realSeconds);
  track.update(clock.time, realSeconds, selEci);
  model.update(selScene, selVelocity, globe.sunDirection, realSeconds);

  // The ring marks the object from a distance; close up, the 3D model speaks for itself.
  const cameraEci = kit.eciGroup.worldToLocal(kit.camera.position.clone());
  const screen = selScene ? toScreen(selScene) : null;
  const riding = fp.mode === 'satellite';
  const near = riding || (!!selScene && model.enabled && kit.camera.position.distanceTo(selScene) < 0.6);
  const shown = !!screen && !!selEci && !near && !behindEarth(cameraEci, selEci);
  labelAvoid = near && screen && !riding ? { x: screen.x, y: screen.y, r: 150 } : null; // no name tags on top of the model
  reticle.classList.toggle('is-hidden', !shown);
  if (shown && screen) reticle.style.transform = `translate(${screen.x.toFixed(1)}px, ${screen.y.toFixed(1)}px)`;
  inspector.frame(clock.time, realSeconds);
}

function updateEncounter(realSeconds: number): void {
  if (!encPanel.isOpen) return;
  encFrame = encViz.update(clock.time, realSeconds);
  if (!encFrame) return;
  encPanel.frame(clock.time, realSeconds, encFrame.rangeKm, encFrame.midEci);
  encModels[0].enabled = encModels[1].enabled = store.settings.model;
  // Zoomed in on one object: its model speaks for itself, so drop the ring and the name tag over it.
  const closeness = kit.camera.position.distanceTo(kit.controls.target) / Math.max(encModelSize, 1e-9);
  encViz.setModelsShown(store.settings.model, THREE.MathUtils.smoothstep(closeness, 10, 18));
  // … and keep the ordinary name tags off the models (the panel already names both objects).
  const sa = toScreen(encFrame.a), sb = toScreen(encFrame.b);
  if (encFocus === 'both') {
    labelAvoid = sa && sb && closeness < 18
      ? { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2, r: Math.hypot(sa.x - sb.x, sa.y - sb.y) / 2 + 130 }
      : null;
  } else {
    const focusScreen = encFocus === 'a' ? sa : sb;
    labelAvoid = focusScreen && closeness < 14 ? { ...focusScreen, r: 170 } : null;
  }
  encModels[0].update(encFrame.a, encFrame.va, globe.sunDirection, realSeconds, encModelSize);
  encModels[1].update(encFrame.b, encFrame.vb, globe.sunDirection, realSeconds, encModelSize);
  model.aimLights(encFocus === 'a' ? encFrame.a : encFocus === 'b' ? encFrame.b : encFrame.mid, globe.sunDirection);
  const screen = toScreen(encFrame.mid);
  rangeTag.classList.toggle('is-hidden', !screen);
  if (screen) {
    rangeTag.textContent = encFrame.rangeKm < 1 ? `${fmtInt(encFrame.rangeKm * 1000)} m` : `${fmt(encFrame.rangeKm, 2)} km`;
    rangeTag.style.left = `${screen.x.toFixed(1)}px`;
    rangeTag.style.top = `${screen.y.toFixed(1)}px`;
  }
}

function updateGrid(): void {
  if (!gridOn) return;
  // Centre on the selected object; otherwise on the low-orbit region the camera is looking at.
  let focus = { x: 0, y: 0, z: 0 };
  if (selected && selEci) {
    focus = { ...selEci };
  } else {
    const anchor = kit.controls.target.lengthSq() > 1 ? kit.controls.target : kit.camera.position;
    const v = kit.eciGroup.worldToLocal(anchor.clone()).setLength(EARTH_RADIUS_KM + 550);
    focus = { x: v.x, y: v.y, z: v.z };
  }
  grid.update(screeningDistance, focus, selected ? selected.index : -1, cloud.visible);
  $('grid-note').textContent =
    `${grid.cellsDrawn} occupied cells drawn, each ${screeningDistance} km wide.` +
    (selected ? ' Bright cell: this object’s; the lattice around it is what gets searched.' : ' Select an object and zoom in to see the cells around it.');
}

/** The walkthrough's live trace: the selected object (or the Space Station) through the hash, twice a second. */
function updateTrace(realSeconds: number): void {
  if (!howto.isOpen || !catalog || realSeconds - lastTraceAt < 0.5) return;
  lastTraceAt = realSeconds;
  const subject = selected ?? catalog.byName.get('ISS (ZARYA)')?.[0] ?? catalog.sats[0];
  if (subject) trace.run(subject, catalog, cloud.visible, screeningDistance);
}

// ---- names of the Sun, Moon and planets ---------------------------------------------------

const skyLabels = new Map<string, HTMLDivElement>();
const MOON_DISTANCE = 384.4; // scene units
function updateSkyLabels(): void {
  const cam = kit.camera.position;
  const place = (name: string, direction: THREE.Vector3, distance: number, figure = false) => {
    let el = skyLabels.get(name);
    if (!el) {
      el = document.createElement('div');
      el.className = figure ? 'sky-label is-figure' : 'sky-label';
      el.textContent = name;
      $('labels').append(el);
      skyLabels.set(name, el);
    }
    // A body at `distance` (scene units); far ones are effectively at infinity.
    const point = distance > 0 ? direction.clone().multiplyScalar(distance) : cam.clone().addScaledVector(direction, 2000);
    const ray = point.clone().sub(cam).normalize();
    const b = cam.dot(ray);
    const blocked = b < 0 && b * b - (cam.lengthSq() - EARTH_RADIUS * EARTH_RADIUS) > 0; // the Earth is in the way
    const wanted = skyLabelsOn && (!figure || (store.settings.constellations && store.settings.stars));
    const screen = wanted && !blocked ? toScreen(point) : null;
    el.style.display = screen ? '' : 'none';
    if (screen) el.style.transform = figure
      ? `translate(${screen.x.toFixed(1)}px, ${screen.y.toFixed(1)}px) translate(-50%, -50%)`
      : `translate(${(screen.x + 9).toFixed(1)}px, ${(screen.y - 7).toFixed(1)}px)`;
  };
  place('Sun', globe.sunDirection, 0);
  for (const body of sky.bodies) place(body.name, body.direction, body.name === 'Moon' ? MOON_DISTANCE : 0);
  for (const figure of sky.constellations) place(figure.name, figure.direction, 0, true);
}

// ---- status bar ---------------------------------------------------------------------------

let lastStatusAt = -Infinity;
function updateStatus(realSeconds: number): void {
  if (realSeconds - lastStatusAt < 0.25) return;
  lastStatusAt = realSeconds;
  const cameraEci = kit.eciGroup.worldToLocal(kit.camera.position.clone());
  const geo = eciToGeodetic(cameraEci, gstime(new Date(clock.time)));
  const lat = THREE.MathUtils.radToDeg(geo.latitude), lon = wrapLon(THREE.MathUtils.radToDeg(geo.longitude));
  $('sb-cam').textContent = `${fmtInt(geo.height)} km up`;
  $('sb-sub').textContent = `${fmt(Math.abs(lat), 1)}° ${lat >= 0 ? 'N' : 'S'}  ${fmt(Math.abs(lon), 1)}° ${lon >= 0 ? 'E' : 'W'}`;
}

// ---- frame-rate watchdog: in Auto quality, step down if the GPU cannot keep up ------------

let fpsFrames = 0;
let fpsSince = performance.now();
let slowStreak = 0;
let watchdogArmed = false; // only after the intro, so shader compilation does not count as "slow"

function watchFrameRate(now: number): void {
  fpsFrames++;
  if (now - fpsSince < 1500) return;
  const fps = (fpsFrames * 1000) / (now - fpsSince);
  fpsFrames = 0;
  fpsSince = now;
  store.setFps(fps, kit.quality);
  // A browser throttles hidden / unfocused tabs to a few fps — that is not the GPU being slow.
  const trustworthy = document.hasFocus() || fps > 12;
  if (!watchdogArmed || store.settings.quality !== 'auto' || kit.quality === 'fast' || !trustworthy || fps >= 40) {
    slowStreak = 0;
    return;
  }
  if (++slowStreak >= 2) {
    slowStreak = 0;
    kit.setQuality('fast');
    document.body.classList.add('no-glass');
  }
}

let lastFrame = performance.now();
let realSeconds = 0;

function frame(now: number): void {
  const elapsed = (now - lastFrame) / 1000;
  const dt = Math.min(elapsed, 0.1); // animation step, capped so a hiccup never makes the camera jump
  lastFrame = now;
  realSeconds += dt;
  if (!clock.paused) clock.time += Math.min(elapsed, 5) * 1000 * clock.speed; // the clock keeps real pace even if frames drop
  if (replay && clock.time >= replay.endMs) {
    // A replay ran to its end: go (back) to the closest point and hold there.
    const hold = replay.holdMs;
    clock.speed = 1;
    clock.paused = true;
    timeControls.sync();
    jumpTo(hold);
  }

  sim.update(clock.time, clock.paused ? 0 : clock.speed); // snapshot bookkeeping + interpolation factor
  cloud.update();
  const date = new Date(clock.time);
  const cameraDistance = kit.camera.position.length();
  globe.update(date, realSeconds, cameraDistance);
  sky.update(date, globe.sunDirection, realSeconds);
  overlay.update(globe.sunDirection, cameraDistance);
  refreshSelected();
  if (encPanel.isOpen) encFrame = encViz.update(clock.time, realSeconds); // before the camera follows it
  updateViewShift();
  // One of two things drives the camera: a first-person view, or the ordinary rig.
  if (fp.mode !== 'off') fp.update(dt, clock.time, selScene ? { position: selScene, velocity: selVelocity } : null);
  else rig.update(dt);
  kit.camera.updateMatrixWorld();
  updateSelection(realSeconds);
  updateEncounter(realSeconds);
  labels.update(realSeconds, selected ? selected.index : -1, labelAvoid);
  updateSkyLabels();
  site.update(realSeconds);
  watch.frame(realSeconds);
  markers.update(realSeconds);
  updateGrid();
  updateTrace(realSeconds);
  updateHover();
  updateStatus(realSeconds);
  requestScreening(realSeconds);
  timeControls.render();
  kit.render();
  if (wantShot) {
    wantShot = false;
    saveShot();
  }
  watchFrameRate(now);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- start

async function boot(): Promise<void> {
  requestAnimationFrame(frame);
  loadRegions();
  void loadFacts().then((loaded) => {
    facts = loaded;
    updateDataNote();
  });
  try {
    loading.progress(0.1, 'Reading orbital elements');
    baseSnapshot = await loadSnapshot();
    const first = buildCatalog(baseSnapshot);
    loading.countTo(first.sats.length);
    loading.progress(0.4, 'Propagating orbits with SGP4');
    const positionsReady = new Promise<void>((resolve) => (firstSnapshot = resolve));
    applyCatalog(first);
    await Promise.all([texturesReady, positionsReady]);
    await loading.finish();

    const home = homeView();
    $('hud').classList.remove('hud-hidden');
    refreshLocationIfAllowed();
    kit.camera.position.copy(home);
    if (applyLink()) {
      // Opened from a share link: go straight to what it describes.
      setTimeout(() => (watchdogArmed = true), 4000);
    } else {
      // Intro: swoop in from deep space, then offer the tour to first-time visitors.
      kit.camera.position.applyAxisAngle(UP, -1.1).setLength(390);
      rig.flyToView(home, ORIGIN.clone(), 4.5);
      setTimeout(() => {
        watchdogArmed = true;
        if (!Tour.seen()) tour.start();
        // Once the tour is out of the way, ask (once) whether to show the visitor's location.
        const waiting = setInterval(() => {
          if (tour.isRunning) return;
          clearInterval(waiting);
          setTimeout(askForLocation, 1200);
        }, 500);
      }, 5200);
    }
  } catch (error) {
    loading.fail(error instanceof Error ? error.message : String(error));
  }
}

void boot();
