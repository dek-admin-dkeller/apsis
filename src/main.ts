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
import { mountLaunch } from './ui/launch.ts';
import { eciToGeodetic, gstime, type SatRec } from 'satellite.js';
import { buildCatalog, loadLive, loadSnapshot, searchCatalog, type Catalog } from './data/catalog.ts';
import { describe } from './data/describe.ts';
import { makeSatrec, rangeKm, stateAt, wrapLon, type Observer, type Vec3 } from './data/ephemeris.ts';
import { loadRegions } from './data/regions.ts';
import { loadFacts, type CatalogFacts } from './data/satcat.ts';
import type { OmmRecord, Satellite, Snapshot } from './data/types.ts';
import { Aurora } from './render/aurora.ts';
import { CameraRig, easeIn, easeOut } from './render/cameraRig.ts';
import { ConjunctionMarkers } from './render/conjunctionMarkers.ts';
import { ConstellationView } from './render/constellation.ts';
import { EncounterViz, type EncounterFrame } from './render/encounterViz.ts';
import { FirstPersonView } from './render/firstPerson.ts';
import { GeoOverlay } from './render/geoOverlay.ts';
import { createGlobe } from './render/globe.ts';
import { GridViz } from './render/gridViz.ts';
import { GroundTrack } from './render/groundTrack.ts';
import { OrbitLine } from './render/orbitLine.ts';
import { prewarmModels, SatelliteModel } from './render/satModels.ts';
import { behindEarth, legendFor, SatelliteCloud } from './render/satellites.ts';
import { createScene, EARTH_RADIUS, EARTH_RADIUS_KM, KM } from './render/scene.ts';
import { SiteMarker } from './render/siteMarker.ts';
import { createSky } from './render/sky.ts';
import { Places } from './ui/places.ts';
import type { Pose } from './render/space/spaceView.ts';
import { EarthTiles } from './render/tiles.ts';
import { TOGETHER_KM_S } from './hashing/conjunction.ts';
import { AheadPanel } from './ui/ahead.ts';
import { BenchmarkModal } from './ui/benchmarkModal.ts';
import { Cinema } from './ui/cinema.ts';
import { ConstellationsPanel } from './ui/constellations.ts';
import { Contacts } from './ui/contacts.ts';
import { renderCrew, renderCrewSummary } from './ui/crew.ts';
import { CUSTOM_NORAD_ID, Designer } from './ui/designer.ts';
import { renderFeed } from './ui/feed.ts';
import { $, fmt, fmtInt, fmtKm, fmtKmS, fmtRange, setClockZone, setUnits } from './ui/dom.ts';
import { EncounterPanel, type Encounter, type EncounterFocus } from './ui/encounterPanel.ts';
import { Filters } from './ui/filters.ts';
import { HashTrace } from './ui/hashTrace.ts';
import { HowTo } from './ui/howto.ts';
import { alertDistance, clockStamp, duration, Inspector } from './ui/inspector.ts';
import { LoadingScreen } from './ui/intro.ts';
import { Landing } from './ui/landing.ts';
import type { App, FrameInfo, SearchProvider } from './ui/app.ts';
import { installChanges } from './features/changes.ts';
import { installCommand } from './features/command.ts';
import { installGrowth } from './features/growth.ts';
import { installLaunches } from './features/launches.ts';
import { installRadio } from './features/radio.ts';
import { installReport } from './features/report.ts';
import { installTonight } from './features/tonight.ts';
import { installWeather } from './features/weather.ts';
import { Labels } from './ui/labels.ts';
import { DOCKED_KM, Monitor } from './ui/monitor.ts';
import { initSearch } from './ui/search.ts';
import { DEFAULT_SITE, SettingsStore, type Settings } from './ui/settings.ts';
import { ShareDialog } from './ui/share.ts';
import { Sheets } from './ui/sheet.ts';
import { thumbnail } from './ui/thumb.ts';
import { TimeControls, type SimClock } from './ui/timeControls.ts';
import { ObjectTabs } from './ui/objectTabs.ts';
import { Tour } from './ui/tour.ts';
import { Watchlist } from './ui/watchlist.ts';
import type { ScreenStats } from './worker/protocol.ts';
import { SimClient } from './worker/SimClient.ts';

// The loading screen's launch scene goes up first, before anything heavy starts.
mountLaunch(document.querySelector<HTMLElement>('.launch')!);

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
let encPairDistance = 0; // … before allowing for the screening cells
let encTogether = false; // the open pair flies together (docked, in formation) rather than crossing
let encAutoFrame = false; // the camera keeps both objects in view by itself (until the user zooms)

// screening bookkeeping
let screenSeq = 0;
let screenPending = false;
let screenDirty = false; // something changed → screen again right away
let lastScreenAt = -Infinity;
let lastStats: ScreenStats | null = null;
let frameCount = 0;

// Listeners registered by the feature modules (src/features/, through the App interface).
const frameHooks: ((frame: FrameInfo) => void)[] = [];
const selectHooks: ((sat: Satellite | null) => void)[] = [];
const catalogHooks: ((next: Catalog, previous: Catalog | null) => void)[] = [];
const factsHooks: ((facts: Map<number, CatalogFacts>) => void)[] = [];
const settingsHooks: ((settings: Settings, changed: keyof Settings | null) => void)[] = [];
const encounterHooks: ((encounter: Encounter | null) => void)[] = [];
const skyHooks: ((open: boolean) => void)[] = []; // the phone's full-screen sky view opened or closed
const homeHooks: (() => void)[] = [];
let lastPairs: { a: Uint32Array; b: Uint32Array } | null = null; // the monitor's latest list, closest first
let lastTraceAt = -Infinity;

// ---------------------------------------------------------------- modules

const canvas = $<HTMLCanvasElement>('scene');
if (!document.createElement('canvas').getContext('webgl2')) {
  // No 3D graphics here at all: say so instead of sitting on the loading screen for ever.
  $('loading-status').textContent = 'This browser or device cannot show 3D graphics (WebGL 2 is switched off or unsupported).';
  $('loading-status').style.color = 'var(--red)';
  throw new Error('WebGL 2 is not available');
}
const kit = createScene(canvas);

// ---- when something goes wrong ------------------------------------------------------------
// The graphics card can take the 3D context away (driver reset, memory pressure, the laptop
// switching GPUs). Left alone that is a permanently black canvas, so: say what happened and
// reload once the browser gives the context back (at most twice in a row, to avoid a loop).
let lastProblem = '';
canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  lastProblem = 'graphics context lost';
  showProblem('The graphics were reset by the browser. Reloading…', false);
  setTimeout(() => showProblem('The graphics were reset by the browser and did not come back.', true), 5000);
});
canvas.addEventListener('webglcontextrestored', () => {
  let reloads = 0;
  try {
    reloads = Number(sessionStorage.getItem('apsis.reloads') ?? '0');
    sessionStorage.setItem('apsis.reloads', String(reloads + 1));
  } catch { /* no storage: reload anyway, once */ }
  if (reloads < 2) location.reload();
  else showProblem('The graphics keep resetting on this device. Try Settings → Display → Fast after reloading.', true);
});
window.addEventListener('error', (event) => (lastProblem = event.message));
window.addEventListener('unhandledrejection', (event) => (lastProblem = String(event.reason)));

/** A plain message over the view, optionally with a Reload button. */
function showProblem(text: string, withReload: boolean): void {
  let box = document.getElementById('problem');
  if (!box) {
    box = document.createElement('div');
    box.id = 'problem';
    box.setAttribute('role', 'alert');
    document.body.append(box);
  }
  box.replaceChildren(text);
  if (withReload) {
    const reload = document.createElement('button');
    reload.className = 'btn btn-primary';
    reload.textContent = 'Reload';
    reload.addEventListener('click', () => location.reload());
    box.append(reload);
  }
}
const sim = new SimClient();
const loading = new LoadingScreen();
const landing = new Landing(); // the welcome page in front of everything (skipped for share links)
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
// Everything beyond Earth orbit (the Moon, the planets, Webb, the Voyagers) is drawn by scenes
// of its own (ui/places.ts). `places.elsewhere` says the visitor is in one of them;
// `places.away` that the tracker is not being drawn at all, so none of its work needs doing.
// While one scene dissolves into another, the camera of the scene coming in is held where the
// other one's is; when that scene is the tracker, the pose to hold is kept here.
let heldPose: Pose | null = null;
const places = new Places({
  kit,
  backdrop: () => sky.backdrop(),
  time: () => clock.time,
  isPhone: () => isPhone(),
  drift: () => store.settings.earthDrift,
  match: roughMatch,
  jumpTo: (timeMs) => jumpTo(timeMs),
  toast: (text) => toast(text),
  trackerView: () => ({ scene: kit.scene, camera: kit.camera, target: kit.controls.target }),
  trackerPose: () => ({ rel: kit.camera.position.clone().divideScalar(EARTH_RADIUS), quat: kit.camera.quaternion.clone() }),
  holdTracker: (pose) => (heldPose = pose),
  surge: (factor, seconds) => {
    // Straight back from the Earth (as far as the tracker's camera may go), gathering speed.
    rig.follow = false;
    rig.flyToView(kit.camera.position.clone().setLength(Math.min(kit.camera.position.length() * factor, 410)), ORIGIN.clone(), seconds, easeIn);
  },
  settle: (seconds) => {
    // Carry on in from wherever the camera is to the whole-Earth distance, on the side it is on.
    rig.follow = false;
    rig.flyToView(kit.camera.position.clone().setLength(homeView().length()), ORIGIN.clone(), seconds, easeOut);
  },
  leaving: () => leaveTracker(),
  onAway: (away) => setAway(away),
});
const model = new SatelliteModel(kit);
const encModels = [new SatelliteModel(kit, false), new SatelliteModel(kit, false)]; // the two objects of a close approach
const labels = new Labels(kit, sim, cloud);
const trace = new HashTrace(sim);
const site = new SiteMarker(globe.earth, kit); // the ground station / "you are here" marker
const tiles = new EarthTiles(globe.earth); // detailed imagery streamed in when zoomed close
const aurora = new Aurora(globe.earth); // tonight's aurora oval (live NOAA forecast)
aurora.onStatus = (text) => ($('aurora-status').textContent = text);
const constView = new ConstellationView(kit.eciGroup, globe.earth); // all orbits of one constellation + its ground coverage
let constMembers: number[] = []; // object indices of the constellation on show
const fp = new FirstPersonView(kit, canvas, () => {
  // back from a ride-along or sky view: the ordinary camera and the 3D model take over again
  model.enabled = store.settings.model && !encPanel.isOpen;
  if (document.body.classList.contains('sky-immersive')) {
    document.body.classList.remove('sky-immersive'); // the phone's full-screen sky view puts the interface back
    for (const run of skyHooks) run(false);
  }
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
  onJoined: (members) => showJoined(members),
  onHow: () => howto.open('hw-grid'),
});
const ahead = new AheadPanel(
  () => (catalog ? { records: catalog.sats.map((sat) => sat.omm), sats: catalog.sats, mask: cloud.visible.slice(), startMs: clock.time } : null),
  (approach) => {
    // A predicted pass: go to a few seconds before it and watch it happen live.
    jumpTo(approach.tcaMs - 6000);
    openEncounter(approach.a, approach.b);
  },
);
const bench = new BenchmarkModal(() => sim.send({ type: 'benchmark', t: clock.time, d: screeningDistance }));
const howto = new HowTo((on) => {
  // "Draw the cells on the globe" pressed while reading the walkthrough from the home page:
  // there is no globe to see there, so go into the tracker first.
  if (on && landing.showing) {
    howto.close();
    landing.enter();
  }
  setGrid(on);
}, () => bench.start(screeningDistance));
landing.setHost({ howItWorks: () => howto.open() });
$('landing-open').addEventListener('click', () => {
  if (cinema.isPlaying) cinema.stop();
  landing.open();
});
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
  if (changed === null || changed === 'colorMode') renderLegend(s.colorMode);
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
  aurora.setVisible(s.aurora);
  tiles.enabled = s.sharpGround;
  globe.setClouds(s.clouds);
  globe.setAtmosphere(s.atmosphere);
  overlay.setBorders(s.borders);
  overlay.setGraticule(s.graticule);
  overlay.setTerminator(s.terminator);
  sky.setStars(s.stars);
  sky.setPlanets(s.planets);
  skyLabelsOn = s.skyLabels;
  observer = { name: s.siteName, latDeg: s.siteLat, lonDeg: s.siteLon };
  // Units and clock: the formatting helpers in ui/dom.ts read these, so every panel follows.
  setUnits(s.units);
  setClockZone(s.clockZone);
  places.setSky(s.stars, s.constellations);
  if (changed === null || changed === 'units') $('d-label').textContent = alertDistance(screeningDistance);
  if (changed === 'units' || changed === 'clockZone') {
    // Panels that only redraw when something happens are told to redraw now.
    ahead.refreshUnits();
    designer.refreshUnits();
    filters.refreshUnits();
    places.refreshUnits();
    updateDataNote();
  }
  if (changed === null || changed.startsWith('site') || changed === 'units' || changed === 'clockZone') inspector.observerChanged();
  if (s.quality !== qualitySetting) {
    qualitySetting = s.quality;
    kit.setQuality(s.quality === 'auto' ? 'balanced' : s.quality); // Auto starts balanced and steps down if needed
  }
  // Blurring the globe behind every panel costs GPU time each frame; skip it in Fast quality.
  document.body.classList.toggle('no-glass', !s.glass || kit.quality === 'fast');
  for (const run of settingsHooks) run(s, changed);
}
/** The key under the colour picker: a gradient with tick labels, or a list of swatches. */
function renderLegend(mode: Settings['colorMode']): void {
  const legend = legendFor(mode);
  const box = $('color-legend');
  box.classList.toggle('is-hidden', legend === null);
  box.replaceChildren();
  if (!legend) return;
  if ('gradient' in legend) {
    const bar = document.createElement('i');
    bar.style.setProperty('--legend-bar', legend.gradient);
    const ticks = document.createElement('div');
    ticks.append(...legend.ticks.map((text) => Object.assign(document.createElement('span'), { textContent: text })));
    box.append(bar, ticks);
  } else {
    const list = document.createElement('div');
    list.className = 'swatches';
    list.append(...legend.swatches.map(([name, color]) => {
      const item = document.createElement('span');
      const dot = document.createElement('b');
      dot.style.background = color;
      item.append(dot, name);
      return item;
    }));
    box.append(list);
  }
}
const store = new SettingsStore(applySettings);
ahead.refreshUnits(); // these two were built before the saved units were known
filters.refreshUnits();

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

/** Make the position the browser gave the ground station (rounded to about a kilometre) and mark it on the globe. */
function placeMe(position: GeolocationPosition): void {
  store.set('siteName', 'My location');
  store.set('siteLat', Math.round(position.coords.latitude * 100) / 100);
  store.set('siteLon', Math.round(position.coords.longitude * 100) / 100);
  store.set('siteMarker', true);
}

/**
 * For features that are about "where you are" (visible passes): make sure the ground station
 * is the visitor's own place, asking the browser for it if it is still the built-in example.
 * Resolves true when it is theirs (found now, found earlier, or typed into Settings), false if
 * the browser cannot say or they declined. Called from the visitor's own click, which is the yes.
 */
function useMyLocation(): Promise<boolean> {
  const site = store.settings;
  const builtIn = site.siteName === DEFAULT_SITE.name && site.siteLat === DEFAULT_SITE.latDeg && site.siteLon === DEFAULT_SITE.lonDeg;
  if (!builtIn) return Promise.resolve(true);
  if (!navigator.geolocation) return Promise.resolve(false);
  setConsent('yes');
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        placeMe(position);
        resolve(true);
      },
      () => resolve(false),
      { timeout: 10000, maximumAge: 600000 },
    );
  });
}

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
      placeMe(position);
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
  if (name !== null) sheets.reset(); // phones: a sheet always opens at its normal height
  document.body.classList.toggle('panel-open', name !== null); // bars stay solid while a tool panel is in use
  for (const button of document.querySelectorAll<HTMLElement>('.rail-btn')) {
    const on = button.dataset.panel === name;
    button.classList.toggle('is-on', on);
    // At another world "Objects" is the list of what is there, not the Earth's catalogue.
    if (button.dataset.panel === 'objects' && places.atPlace) places.toggleHere(on);
    else $(`panel-${button.dataset.panel}`).classList.toggle('is-hidden', !on);
  }
}
const togglePanel = (name: PanelName) => openPanel(openPanelName === name ? null : name);
const objectTabs = new ObjectTabs(); // the Objects panel's Browse / Activity / Tools tabs
for (const button of document.querySelectorAll<HTMLElement>('.rail-btn')) {
  button.addEventListener('click', () => togglePanel(button.dataset.panel as PanelName));
}
for (const button of document.querySelectorAll<HTMLElement>('[data-close-panel]')) {
  button.addEventListener('click', () => openPanel(null));
}

// ---- phones: panels are bottom sheets ------------------------------------------------------

const isPhone = () => Sheets.isPhone;
let viewKey = ''; // the view offset last given to the camera (cleared to force it to be set again)
let heroShift = 0; // 0 … 1: how far the globe is moved aside to sit beside the home page's headline
const sheets = new Sheets(() => (viewKey = '')); // sheets can be dragged to any height
window.addEventListener('resize', () => (viewKey = ''));
/**
 * On a phone a sheet covers the lower part of the screen, so the centre of the 3D view is
 * moved up into the visible part — otherwise the selected object would sit behind the sheet.
 */
/**
 * Where the globe sits on the screen. Normally in the middle; moved up on a phone while a
 * bottom sheet is open; and, while the home page is up, moved to the right of its headline
 * (above it on a narrow screen) so the live globe is that page's picture. The move to and
 * from the home-page position is eased, so going into the tracker is one continuous shot.
 */
function updateViewShift(dt: number): void {
  const immersive = document.body.classList.contains('sky-immersive'); // every sheet is put away: the sky gets the whole screen
  const sheetOpen = isPhone() && !immersive && (inspector.isOpen || encPanel.isOpen || openPanelName !== null);
  const sheet = sheetOpen ? sheets.current : 0;
  const target = landing.showing ? 1 : 0;
  heroShift = Math.abs(target - heroShift) < 0.002 ? target : heroShift + (target - heroShift) * Math.min(1, dt * 2.6);
  const width = window.innerWidth, height = window.innerHeight;
  const narrow = width <= 860; // the home page stacks its picture over its words below this width
  const dx = Math.round(heroShift * (narrow ? 0 : -0.21 * width)); // a negative offset moves the picture right
  const dy = Math.round(heroShift * (narrow ? 0.17 * height : 0) + sheet / 2); // a positive one moves it up
  const key = `${width},${height},${dx},${dy}`;
  if (key === viewKey) return;
  viewKey = key;
  if (dx === 0 && dy === 0) kit.camera.clearViewOffset();
  else kit.camera.setViewOffset(width, height, dx, dy, width, height);
}

// Phone-only buttons simply press the control they stand in for.
const viewsMenu = $('m-views');
const setViewsMenu = (open: boolean) => {
  viewsMenu.classList.toggle('is-hidden', !open);
  $('m-views-open').setAttribute('aria-expanded', String(open));
};
for (const button of document.querySelectorAll<HTMLElement>('[data-proxy]')) {
  button.addEventListener('click', () => {
    setViewsMenu(false);
    document.querySelector<HTMLElement>(button.dataset.proxy!)?.click();
  });
}
// Whatever a menu item does (some belong to feature modules, such as "Type a command"), choosing it puts the menu away.
viewsMenu.addEventListener('click', (event) => {
  if ((event.target as HTMLElement).closest('button')) setViewsMenu(false);
});
$('m-views-open').addEventListener('click', (event) => {
  event.stopPropagation();
  setViewsMenu(viewsMenu.classList.contains('is-hidden'));
});
document.addEventListener('pointerdown', (event) => {
  // a tap anywhere else closes the views menu
  if (!viewsMenu.classList.contains('is-hidden') && !(event.target as HTMLElement).closest('#m-views, #m-views-open')) setViewsMenu(false);
});
// Phones: the time bar is not on the screen at all (the globe gets the room). It opens from the
// menu, closes again with a tap anywhere else (the bar's own rule), and a small chip beside
// the menu button says so whenever time is NOT running live, so a paused or fast-forwarded
// clock is never a mystery.
const timeBar = document.querySelector<HTMLElement>('.timebar')!;
const timeChip = $('m-time-chip');
const openPhoneTime = () => {
  setViewsMenu(false);
  openPanel(null); // one thing at a time
  timeBar.classList.add('is-open');
};
$('m-time-open').addEventListener('click', openPhoneTime);
timeChip.addEventListener('click', openPhoneTime);
// Whatever opens or closes the bar (the menu, the tour, its own tap-elsewhere rule), the page
// follows: mobile.css shows the bar only while <body> carries `m-time-open`.
new MutationObserver(() => {
  document.body.classList.toggle('m-time-open', timeBar.classList.contains('is-open'));
}).observe(timeBar, { attributes: true, attributeFilter: ['class'] });
let timeChipText = '';
function updateTimeChip(): void {
  if (!isPhone()) return;
  const offset = clock.time - Date.now();
  const text = clock.paused ? 'Paused'
    : clock.speed !== 1 ? (Math.abs(clock.speed) < 1 ? 'Slow motion' : `${clock.speed < 0 ? '−' : ''}${fmtInt(Math.abs(clock.speed))}×`)
    : Math.abs(offset) >= 5000 ? `${offset > 0 ? '+' : '−'}${duration(offset)}`
    : '';
  if (text === timeChipText) return;
  timeChipText = text;
  timeChip.textContent = text;
  timeChip.classList.toggle('is-hidden', text === '');
}

const fitLabelsToScreen = () => (labels.nearby = Sheets.isPhone ? 14 : 70); // a phone screen fits fewer name tags
fitLabelsToScreen();
window.addEventListener('resize', fitLabelsToScreen);
/** A short tick on phones that support it (Android), so a tap that selects something can be felt. */
const haptic = () => {
  if (isPhone() && navigator.userActivation?.hasBeenActive) navigator.vibrate?.(8); // browsers refuse it before the first tap
};

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
    for (const run of selectHooks) run(null);
    return;
  }
  model.setKind(describe(sat).kind);
  rig.follow = true;
  if (isPhone()) openPanel(null); // one sheet at a time on a phone
  sheets.reset();
  haptic();
  inspector.show(sat, facts.get(sat.noradId), true);
  inspector.setStarred(watch.has(sat));
  // The two crewed stations also list who is aboard right now.
  $('rc-crew').replaceChildren();
  if (sat.name === 'ISS (ZARYA)') renderCrew($('rc-crew'), 'ISS');
  else if (sat.name === 'CSS (TIANHE)') renderCrew($('rc-crew'), 'Tiangong');
  rig.flyToFocus(() => selScene, FOCUS_DISTANCE);
  for (const run of selectHooks) run(sat);
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

/**
 * The phone's sky button: hold the phone up and see what is overhead, with nothing else on
 * the screen. Tapping it is the visitor asking for exactly that, so the browser's own
 * location question (and, on an iPhone, the motion-sensor question) is put straight away;
 * both have to be asked from inside the tap or the browser ignores them. The view opens once
 * the location has been answered either way: refused, it shows the sky above the saved
 * ground station instead and says so.
 */
function skyFromPhone(): void {
  if (fp.mode === 'ground') return fp.exit();
  const motion = fp.askMotionPermission();
  const enter = (note: string | null) => {
    setViewsMenu(false);
    openPanel(null);
    if (encPanel.isOpen) closeEncounter(true);
    document.body.classList.add('sky-immersive');
    fp.enterGround(observer);
    for (const run of skyHooks) run(true);
    void motion.then((allowed) => {
      if (allowed && fp.mode === 'ground') fp.useMotion();
    });
    if (note) toast(note, 5000);
  };
  if (!navigator.geolocation) return enter(`This browser cannot share a location. Showing the sky above ${observer.name}.`);
  setConsent('yes'); // pressing the button is the yes
  navigator.geolocation.getCurrentPosition(
    (position) => {
      placeMe(position);
      enter(null);
    },
    () => enter(`Location was not shared. Showing the sky above ${observer.name}.`),
    { timeout: 10000, maximumAge: 600000 },
  );
}
$('m-sky').addEventListener('click', skyFromPhone);

// ---- close-approach view ------------------------------------------------------------------

/** Are these two catalogued objects one spacecraft right now: at the same place and not moving apart? */
function joinedNow(a: Satellite, b: Satellite): boolean {
  const sa = stateAt(makeSatrec(a), clock.time), sb = stateAt(makeSatrec(b), clock.time);
  if (!sa || !sb) return false;
  const apart = Math.hypot(sa.position.x - sb.position.x, sa.position.y - sb.position.y, sa.position.z - sb.position.z);
  const drift = Math.hypot(sa.velocity.x - sb.velocity.x, sa.velocity.y - sb.velocity.y, sa.velocity.z - sb.velocity.z);
  return apart < DOCKED_KM && drift < TOGETHER_KM_S;
}

/**
 * A spacecraft that the catalogue lists as several objects (a station's modules, the capsules
 * docked to it, a servicing vehicle on its client). There is no pair to draw: they are at the
 * same place, so the close-approach view would show one model and "0 m". Select the
 * spacecraft itself (its oldest part) and say what the visitor is looking at.
 */
function showJoined(members: number[]): void {
  if (!catalog) return;
  const sats = members.map((index) => catalog!.sats[index]).sort((p, q) => p.noradId - q.noradId);
  select(sats[0]);
  toast(
    sats.length === 2
      ? `${sats[0].name} and ${sats[1].name} are joined: listed as two objects, flying as one.`
      : `${sats[0].name} is listed as ${sats.length} objects (its parts and what is docked to it). They fly as one spacecraft.`,
    6500,
  );
}

function openEncounter(aIndex: number, bIndex: number): void {
  if (!catalog) return;
  if (joinedNow(catalog.sats[aIndex], catalog.sats[bIndex])) return showJoined([aIndex, bIndex]); // one spacecraft, not a pair
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
  sheets.reset();
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
  encTogether = approach.coMoving;
  encPairDistance = THREE.MathUtils.clamp(Math.max(gapKm, 0.3) * 2.6 * KM, 0.0004, 1.2);
  encViewDistance = encounterViewDistance();
  encModelSize = Math.max(gapKm * 0.32, 0.05) * KM; // a third of the gap: large, but they can never touch
  // Time keeps running: the pair is watched live. (Replay and the scrubber in the panel are there
  // for a slow-motion or frozen look at the closest point.)
  encFrame = encViz.update(clock.time, realSeconds);
  focusEncounter('both', 1.4);
  for (const run of encounterHooks) run(encounter);
}

/**
 * How far back the camera sits for the whole pair. With the screening cells shown it has to
 * be far enough to take in both objects' cells (each d km wide), not just the two objects.
 */
function encounterViewDistance(): number {
  return gridOn ? Math.max(encPairDistance, screeningDistance * KM * 5.5) : encPairDistance;
}

/** Centre the camera on one object of the pair (to zoom in and turn around it), or on both. */
function focusEncounter(which: EncounterFocus, duration = 1.1): void {
  encFocus = which;
  encAutoFrame = which === 'both';
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
  for (const run of encounterHooks) run(null);
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
  // A close approach is open: step back (or in again) so the two objects' cells fit the view.
  if (encPanel.isOpen) {
    encViewDistance = encounterViewDistance();
    if (encFocus === 'both') focusEncounter('both', 1.2);
    return;
  }
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

/**
 * Move simulated time on by one frame.
 *
 * At normal speed the clock follows the COMPUTER'S clock, not a sum of frame times. A browser
 * stops drawing a tab that is in the background, a phone stops everything when it is locked,
 * and a sum of frame times (capped, so that a hiccup cannot make things leap) then falls behind
 * by however long that lasted: come back after ten minutes and "now" was ten minutes ago. So:
 *   - showing the present (within a second and a half of it): the clock IS the present;
 *   - showing another moment at normal speed: it moves on by the real time that passed.
 * Either way a gap of more than a couple of seconds counts as a jump, so the simulation starts
 * from fresh positions instead of gliding everything across the gap.
 * At any other speed a long gap is not replayed (ten minutes asleep at 600× would be four days).
 */
let lastWallMs = Date.now();
function advanceClock(elapsedSeconds: number): void {
  const wallNow = Date.now();
  const wallElapsed = Math.max(0, wallNow - lastWallMs);
  lastWallMs = wallNow;
  if (clock.paused) return;
  if (clock.speed !== 1) {
    clock.time += Math.min(elapsedSeconds, 5) * 1000 * clock.speed;
    return;
  }
  const wasLive = Math.abs(clock.time + wallElapsed - wallNow) < 1500;
  const next = wasLive ? wallNow : clock.time + wallElapsed;
  if (wallElapsed > 2500) jumpTo(next, replay !== null);
  else clock.time = next;
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
  } else if (which === 5) {
    // Earth in front, the Moon beyond it: stand on the far side of the Earth from the Moon,
    // stepped a little off the line so the Moon clears the Earth's edge. On a tall phone
    // screen the Moon is placed above the Earth; on a wide screen, beside it.
    const moon = sky.bodies[0].direction.clone();
    const tall = window.innerHeight > window.innerWidth;
    const axis = tall ? new THREE.Vector3().crossVectors(moon, up).normalize() : up;
    const from = moon.clone().negate().applyAxisAngle(axis, tall ? -0.3 : 0.36);
    rig.flyToView(from.multiplyScalar(30), ORIGIN.clone(), 2.4);
    toast('The Moon is drawn four times its real size so it is easy to find.', 4500);
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
  const previous = catalog;
  catalog = next;
  screenSeq++; // ignore screening results that belong to the previous catalogue
  screenPending = false;
  markers.setPairs(new Uint32Array(0), new Uint32Array(0), screeningDistance);
  sim.init(next.sats.map((sat) => sat.omm));
  cloud.setCatalog(next);
  filters.setCatalog(next, cloud.visible);
  labels.setCatalog(next);
  watch.setCatalog(next);
  constMembers = [];
  constPanel.catalogChanged();
  labels.setPinned(watch.indices());
  ahead.reset();
  $('stat-tracked').textContent = fmtInt(next.sats.length);
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
  for (const run of catalogHooks) run(next, previous);
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
    jumpTo(tcaMs - 6000);
    openEncounter(a, b);
  },
  now: () => clock.time,
});

const constPanel = new ConstellationsPanel($('constellation-body'), {
  catalog: () => catalog,
  highlight: (indices) => cloud.setHighlight(indices),
  show: (members, options) => {
    constMembers = members ?? [];
    // Drawing 11,000 Starlink orbits would be a solid ball: sample at most 300 evenly.
    const stride = Math.max(1, Math.ceil(constMembers.length / 300));
    const drawn = options.orbits && catalog ? constMembers.filter((_, k) => k % stride === 0).map((i) => catalog!.sats[i]) : [];
    constView.setOrbits(drawn.map(makeSatrec), drawn.map((sat) => sat.periodMin), new THREE.Color(options.color));
    constView.setCoverage(constMembers.length > 0 && options.coverage, options.minElevationDeg);
  },
  stats: () => ({ coveredFraction: constView.coveredFraction, maxInView: constView.maxInView }),
});

const contacts = new Contacts({
  watchlist: () => (catalog ? watch.indices().map((i) => catalog!.sats[i]) : []),
  home: () => observer,
  now: () => clock.time,
  select: (sat) => select(sat),
  jumpTo: (timeMs) => jumpTo(timeMs),
});
$('contacts-open').addEventListener('click', () => contacts.open());

function updateDataNote(): void {
  if (!catalog) return;
  const ageH = (Date.now() - Date.parse(catalog.fetchedAt)) / 3.6e6;
  // One line: when the elements are from. (The owner, launch and size table is only mentioned when it is missing.)
  $('data-note').textContent =
    `Elements ${catalog.live ? 'downloaded' : 'from'} ${clockStamp(Date.parse(catalog.fetchedAt))}, ${ageH < 48 ? `${fmt(ageH, 0)} hours` : `${fmt(ageH / 24, 0)} days`} ago.`
    + (facts.size > 0 ? '' : ' Owner, launch and size details are not loaded.');
  const all = catalog;
  cloud.setOwners((index) => facts.get(all.sats[index].noradId)?.owner);
  renderFeed(catalog, facts, (sat) => select(sat), (members, lead) => {
    cloud.setHighlight(members); // a satellite train: light up the whole batch
    if (lead) select(lead);
  });
  $('about-data').textContent = `${fmtInt(catalog.sats.length)} objects, elements from ${clockStamp(Date.parse(catalog.fetchedAt))}`;
  $('data-age').textContent = `${clockStamp(Date.parse(catalog.fetchedAt))}${catalog.live ? ' (live)' : ''}`;
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
    // Markers on the globe, and the autopilot's pick, are for genuine approaches only: pairs
    // that merely fly together (docked, in formation) would otherwise be flagged all day.
    const crossing: number[] = [];
    for (let k = 0; k < msg.pairA.length; k++) if (msg.pairSpeed[k] >= TOGETHER_KM_S) crossing.push(k);
    const passA = Uint32Array.from(crossing, (k) => msg.pairA[k]);
    const passB = Uint32Array.from(crossing, (k) => msg.pairB[k]);
    markers.setPairs(passA, passB, msg.d);
    lastPairs = { a: passA, b: passB };
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
  if (places.elsewhere) return; // another scene is on screen: there is nothing of the tracker's under the pointer
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
  if (!catalog || places.elsewhere || Math.hypot(event.clientX - pointer.downX, event.clientY - pointer.downY) > 4) return; // it was a drag
  if (document.body.classList.contains('sky-immersive')) return; // full-screen sky: a tap must not bring a panel up
  const index = cloud.pick(event.clientX, event.clientY, 12);
  if (index >= 0 && index !== selected?.index) select(catalog.sats[index]);
});

let hoverIndex = -1; // object the hover card is currently showing

/** Hover card: a picture, the name, what it is, who runs it, and where it is right now. */
function updateHover(): void {
  if (!pointer.dirty || !catalog) return;
  pointer.dirty = false;
  const index = cloud.pick(pointer.x, pointer.y);
  canvas.style.cursor = index >= 0 ? 'pointer' : '';
  tooltip.classList.toggle('is-hidden', index < 0 || !store.settings.hoverCard);
  if (index < 0 || !store.settings.hoverCard) {
    hoverIndex = -1;
    return;
  }
  const sat = catalog.sats[index];
  if (index !== hoverIndex) {
    // a different object: rebuild the card (the picture loads itself: photo if there is one, else the 3D model)
    hoverIndex = index;
    const profile = describe(sat);
    const line = (className: string, text: string) => Object.assign(document.createElement('span'), { className, textContent: text });
    const text = document.createElement('div');
    text.className = 'tip-text';
    text.append(line('tip-name', sat.name), line('tip-what', profile.purpose), line('tip-live', ''));
    if (profile.operator) text.append(line('tip-op', profile.operator));
    tooltip.replaceChildren(thumbnail(sat), text);
  }
  // live line: height and speed now (speed from the vis-viva equation for its orbit)
  const here = { x: 0, y: 0, z: 0 };
  if (sim.getPosition(index, here)) {
    const r = Math.hypot(here.x, here.y, here.z);
    const speed = Math.sqrt(Math.max(0, 398600.4418 * (2 / r - 1 / (EARTH_RADIUS_KM + sat.meanAltKm))));
    tooltip.querySelector('.tip-live')!.textContent = `${fmtKm(r - EARTH_RADIUS_KM)} up, ${fmtKmS(speed)}`;
  }
  // beside the pointer, flipped to the left near the right edge so it never leaves the screen
  tooltip.classList.toggle('is-left', pointer.x > window.innerWidth - 340);
  tooltip.style.left = `${pointer.x}px`;
  tooltip.style.top = `${Math.min(Math.max(pointer.y, 70), window.innerHeight - 70)}px`;
}

// ---------------------------------------------------------------- top-bar tools + keyboard

let wantShot = false;
$('shot').addEventListener('click', () => (wantShot = true));

// Picture and video live in a small menu behind one button: two deliberate clicks, so a
// stray click on the toolbar can no longer start a recording or drop a file in Downloads.
const captureMenu = $('capture-menu');
const setCaptureMenu = (open: boolean) => {
  captureMenu.classList.toggle('is-hidden', !open);
  $('capture-open').setAttribute('aria-expanded', String(open));
};
$('capture-open').addEventListener('click', () => setCaptureMenu(captureMenu.classList.contains('is-hidden')));
captureMenu.addEventListener('click', () => setCaptureMenu(false)); // a choice was made
document.addEventListener('pointerdown', (event) => {
  if (!$('capture').contains(event.target as Node)) setCaptureMenu(false);
});
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
const setKeys = (open: boolean) => {
  keysOverlay.classList.toggle('is-hidden', !open);
  if (open) renderCrewSummary($('crew-summary'));
};
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
  if (places.elsewhere) {
    places.linkParams(q);
    if (Math.abs(clock.time - Date.now()) > 60000) q.set('t', String(Math.round(clock.time / 1000)));
  } else if (enc) {
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
  if (q.has('place') || q.has('craft')) {
    // A link to somewhere beyond Earth orbit: the Moon, a planet, a spacecraft out there.
    if (q.has('t') && Number.isFinite(t)) jumpTo(t * 1000);
    void places.applyLink(q);
    return true;
  }
  const byId = (id: string | undefined) => catalog!.byNorad.get(Number(id));
  const [idA, idB] = (q.get('pair') ?? '').split('-');
  const a = byId(idA), b = byId(idB), sat = byId(q.get('sat') ?? undefined);
  const cam = (q.get('cam') ?? '').split(',').map(Number);
  if (!(a && b) && !sat && cam.length !== 3 && !q.has('t')) return false;
  if (q.has('t') && Number.isFinite(t)) jumpTo(t * 1000 - (a && b ? 6000 : 0)); // a shared pass opens a few seconds before its closest point
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
const setAbout = (open: boolean) => {
  aboutOverlay.classList.toggle('is-hidden', !open);
  if (!open) return;
  // What a friend can read out if something looks wrong on their machine.
  const gl = kit.renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'graphics card not reported';
  $('about-diag').textContent = `${gpu}; ${kit.quality} quality at ${fmt(kit.pixelRatio, 2)}× pixels, ${$('sb-fps').textContent}`
    + `; ${tiles.status}`
    + (lastProblem ? `; last problem: ${lastProblem.slice(0, 120)}` : '; no problems recorded');
};
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
tour.onStop = () => {
  // Finished or skipped: leave the visitor at the familiar whole-Earth view, not wherever the
  // tour last took them (possibly a close-up over the unlit night side).
  if (fp.mode !== 'off') fp.exit();
  closeEncounter(true);
  if (selected) select(null);
  if (conjunctionOn) setConjunction(false);
  openPanel(null);
  preset(1);
};
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

// ---- home: the logo puts everything back the way it started ---------------------------------

/** About to leave the tracker for somewhere else (ui/places.ts): everything of the tracker's is put away. */
function leaveTracker(): void {
  if (cinema.isPlaying) cinema.stop();
  if (fp.mode !== 'off') fp.exit();
  closeEncounter(true);
  if (selected) select(null);
  openPanel(null);
  setViewsMenu(false);
  sheets.reset();
  setResting(false);
}

/**
 * The tracker has stopped being drawn (true) or is about to be drawn again (false). While it
 * is not drawn the simulation is not kept up (see step()), so on the way back it starts again
 * from fresh positions.
 */
function setAway(away: boolean): void {
  if (!away) {
    jumpTo(clock.time, true);
    viewKey = '';
  }
  openPanel(null);
  setResting(false);
}

/** A rough name match, 0…1: exact, starts with, contains. */
function roughMatch(query: string, ...texts: string[]): number {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return 0;
  let best = 0;
  for (const text of texts) {
    const t = text.toLowerCase();
    best = Math.max(best, t === q ? 1 : t.startsWith(q) ? 0.8 : t.includes(q) ? 0.5 : 0);
  }
  return best;
}

/** Put the tracker's camera exactly where another scene's camera is, relative to the Earth (see heldPose). */
function holdCamera(pose: Pose): void {
  const camera = kit.camera;
  camera.position.copy(pose.rel).multiplyScalar(EARTH_RADIUS);
  camera.quaternion.copy(pose.quat);
  camera.up.set(0, 1, 0).applyQuaternion(pose.quat);
  // What it is looking at: the point straight ahead, as far away as the Earth.
  kit.controls.target.copy(camera.position).add(new THREE.Vector3(0, 0, -1).applyQuaternion(pose.quat).multiplyScalar(camera.position.length()));
}

function goHome(): void {
  places.leaveNow();
  if (cinema.isPlaying) cinema.stop();
  if (fp.mode !== 'off') fp.exit();
  closeEncounter(true);
  if (selected) select(null);
  openPanel(null);
  setViewsMenu(false);
  setKeys(false);
  setAbout(false);
  shareDialog.close();
  if (howto.isOpen) howto.close();
  if (bench.isOpen) bench.close();
  sheets.reset();
  jumpToNow();
  preset(1);
  for (const run of homeHooks) run(); // feature modules undo what they changed (a year filter, say)
}
$('home').addEventListener('click', goHome);
$('home').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    event.stopPropagation();
    goHome();
  }
});

window.addEventListener('keydown', (event) => {
  if (landing.showing) return; // the welcome page is up: its own Enter key is the only shortcut
  const el = event.target as HTMLElement;
  if (el instanceof HTMLInputElement && el.type !== 'checkbox' && el.type !== 'range') return; // typing in a field
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  // Away from the tracker, only the keys that mean something everywhere: time, picture, home, search.
  if (places.elsewhere && !['0', 'r', '[', ']', 'n', 'p', 'm', 'f', 'h', '/', ' ', 'escape', '?'].includes(event.key.toLowerCase())) return;
  switch (event.key.toLowerCase()) {
    case '0': goHome(); break;
    case '1': preset(1); break;
    case '2': preset(2); break;
    case '3': preset(3); break;
    case '4': skyView(); break;
    case '5': preset(5); break;
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
      else if (places.elsewhere) places.back();
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
  if (!uiHidden) inspector.frame(clock.time, realSeconds); // no point drawing charts nobody can see (autopilot)
}

// Zooming by hand means "I'll frame this myself": the automatic framing below lets go until
// the pair is re-centred from the panel.
canvas.addEventListener('wheel', () => (encAutoFrame = false), { passive: true });
// Zooming out past the furthest the tracker goes carries on out to the solar system.
canvas.addEventListener('wheel', (event) => {
  if (event.deltaY <= 0 || places.elsewhere || landing.showing || rig.flying || rig.focused || fp.mode !== 'off') return;
  if (kit.controls.target.lengthSq() < 1 && kit.camera.position.length() > kit.controls.maxDistance * 0.985) places.openSystem();
}, { passive: true });
canvas.addEventListener('touchstart', (event) => {
  if (event.touches.length > 1) encAutoFrame = false;
}, { passive: true });

function updateEncounter(realSeconds: number, dt: number): void {
  if (!encPanel.isOpen) return;
  encFrame = encViz.update(clock.time, realSeconds);
  if (!encFrame) return;

  // Keep both objects in the picture. Time runs live, and two objects crossing at 10 km/s are
  // 50 km apart five seconds after their closest point: with a fixed camera they would be out
  // of the frame almost at once, leaving only lines. So the camera eases back as they
  // separate — and comes in again when a replay brings them back together.
  if (encFocus === 'both' && encAutoFrame && !rig.flying) {
    const offset = kit.camera.position.clone().sub(kit.controls.target);
    const have = offset.length();
    const want = THREE.MathUtils.clamp(Math.max(encViewDistance, encFrame.rangeKm * KM * 1.5), 0.0004, 1.5);
    if (have > 1e-9 && Math.abs(want - have) > have * 0.002) {
      const next = have + (want - have) * Math.min(1, dt * 2.5);
      kit.camera.position.copy(kit.controls.target).addScaledVector(offset, next / have);
    }
  }
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
    rangeTag.textContent = fmtRange(encFrame.rangeKm);
    rangeTag.style.left = `${screen.x.toFixed(1)}px`;
    rangeTag.style.top = `${screen.y.toFixed(1)}px`;
  }
}

function updateGrid(realSeconds: number): void {
  if (!gridOn) return;
  // A close approach is open: the picture is about that pair — each object's cell, the block
  // of 27 cells the search looks through, and both cells lit red while they are inside the
  // alert distance.
  if (encPanel.isOpen && encFrame) {
    const toKm = (v: THREE.Vector3) => kit.eciGroup.worldToLocal(v.clone());
    grid.update(screeningDistance, encFrame.midEci, -1, cloud.visible, { a: toKm(encFrame.a), b: toKm(encFrame.b), rangeKm: encFrame.rangeKm, together: encTogether }, realSeconds);
    const where = grid.pairState === 'same' ? 'Both objects are in the same cell'
      : grid.pairState === 'neighbours' ? 'The two objects are in neighbouring cells (cyan and amber)'
      : 'The two objects are now more than one cell apart, so the search no longer pairs them';
    $('grid-note').textContent = encTogether
      ? `${where}. These two fly together, so they stay within one or two cells (${alertDistance(screeningDistance)} wide) all the time.`
      : `${where}. Cells are ${alertDistance(screeningDistance)} wide; they turn red while the pair is closer than that.`;
    return;
  }
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
    `${grid.cellsDrawn} occupied cells drawn, each ${alertDistance(screeningDistance)} wide.` +
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
  $('sb-cam').textContent = `${fmtKm(geo.height)} up`;
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

// ---- the interface steps back while the globe turns by itself ----
// Left alone in a whole-Earth view the globe starts its slow drift (cameraRig). The bars around
// the picture then dim (`ui-rest` on <body>): a little on a computer (style.css), nearly away
// on a phone, where the screen is small (mobile.css section 11). Any touch, key or movement
// of the pointer brings them straight back; nothing is switched off, a dimmed button still works.
let lastTouchMs = performance.now();
let resting = false;
const noteTouch = () => {
  lastTouchMs = performance.now();
  if (resting) setResting(false); // at once, not a frame later: the tap that wakes the controls may be on one of them
};
for (const kind of ['pointerdown', 'pointermove', 'wheel', 'keydown']) window.addEventListener(kind, noteTouch, { capture: true, passive: true });
function setResting(on: boolean): void {
  resting = on;
  document.body.classList.toggle('ui-rest', on);
}
function updateRest(now: number): void {
  if (places.elsewhere) {
    const calm = places.drifting && now - lastTouchMs > 4000 && !landing.showing && openPanelName === null && !timeBar.classList.contains('is-open') &&
      viewsMenu.classList.contains('is-hidden') && document.activeElement?.id !== 'search' &&
      !document.querySelector('.overlay:not(.is-hidden), .tool-menu:not(.is-hidden)');
    if (calm !== resting) setResting(calm);
    return;
  }
  const rest =
    rig.drifting && now - lastTouchMs > 4000 && fp.mode === 'off' && !landing.showing && !tour.isRunning &&
    openPanelName === null && !inspector.isOpen && !encPanel.isOpen && // something is being read
    viewsMenu.classList.contains('is-hidden') && !timeBar.classList.contains('is-open') &&
    document.activeElement?.id !== 'search' &&
    !document.querySelector('.overlay:not(.is-hidden), .tool-menu:not(.is-hidden), .cmd:not(.is-hidden)'); // a page, a menu or the command bar is open
  if (rest !== resting) setResting(rest);
}

let uiHidden = false; // interface hidden (H key, autopilot): skip work that only updates panels
let lastFrame = performance.now();
let realSeconds = 0;

/** One frame. Wrapped so that an unexpected error in any module cannot stop the loop and freeze the picture. */
let frameErrors = 0;
function frame(now: number): void {
  try {
    step(now);
  } catch (error) {
    lastProblem = error instanceof Error ? error.message : String(error);
    console.error(error);
    if (++frameErrors === 30) showProblem('Something went wrong while drawing. Reloading usually fixes it.', true);
  }
  requestAnimationFrame(frame);
}

function step(now: number): void {
  const elapsed = (now - lastFrame) / 1000;
  const dt = Math.min(elapsed, 0.1); // animation step, capped so a hiccup never makes the camera jump
  lastFrame = now;
  realSeconds += dt;
  advanceClock(elapsed);
  if (replay && clock.time >= replay.endMs) {
    // A replay ran to its end: go (back) to the closest point and hold there.
    const hold = replay.holdMs;
    clock.speed = 1;
    clock.paused = true;
    timeControls.sync();
    jumpTo(hold);
  }

  uiHidden = document.body.classList.contains('ui-hidden');
  if (places.away) {
    // Somewhere else in the solar system. Nothing of the Earth's is on screen, so none of its
    // machinery runs: no propagation, no screening, no globe. Only the clock, which is shared.
    sky.update(new Date(clock.time), globe.sunDirection, realSeconds); // keeps the shared star material's pixel size and twinkle current
    places.lead(dt, clock.time, realSeconds);
    places.follow(dt, clock.time, realSeconds);
    updateRest(now);
    timeControls.render();
    updateTimeChip();
    frameCount++;
    kit.render();
    if (wantShot) {
      wantShot = false;
      saveShot();
    }
    watchFrameRate(now);
    return;
  }
  // The tracker is being drawn; if another scene is on screen with it (one is dissolving into
  // the other), that scene's own camera moves first — the tracker's may have to follow it.
  if (places.active) places.lead(dt, clock.time, realSeconds);
  sim.update(clock.time, clock.paused ? 0 : clock.speed); // snapshot bookkeeping + interpolation factor
  cloud.update();
  const date = new Date(clock.time);
  const cameraDistance = kit.camera.position.length();
  globe.update(date, realSeconds, cameraDistance);
  sky.update(date, globe.sunDirection, realSeconds);
  overlay.update(globe.sunDirection, cameraDistance);
  refreshSelected();
  if (encPanel.isOpen) encFrame = encViz.update(clock.time, realSeconds); // before the camera follows it
  updateViewShift(dt);
  // One of two things drives the camera: a first-person view, or the ordinary rig.
  if (heldPose) holdCamera(heldPose);
  else if (fp.mode !== 'off') fp.update(dt, clock.time, selScene ? { position: selScene, velocity: selVelocity } : null);
  else rig.update(dt);
  updateRest(now);
  kit.camera.updateMatrixWorld();
  updateSelection(realSeconds);
  updateEncounter(realSeconds, dt);
  labels.update(realSeconds, selected ? selected.index : -1, labelAvoid);
  updateSkyLabels();
  site.update(realSeconds);
  aurora.update(realSeconds, globe.sunDirection);
  tiles.update(kit.camera, globe.sunDirection, realSeconds, dt, () => rig.destination, clock.paused ? 0 : Math.abs(clock.speed));
  constView.update(clock.time, realSeconds, constMembers.length, (i, out) => sim.getPosition(constMembers[i], out));
  if (!uiHidden) constPanel.frame(realSeconds);
  if (!uiHidden) watch.frame(realSeconds);
  markers.update(realSeconds);
  updateGrid(realSeconds);
  updateTrace(realSeconds);
  updateHover();
  if (!uiHidden) updateStatus(realSeconds);
  requestScreening(realSeconds);
  timeControls.render();
  updateTimeChip();
  if (frameHooks.length > 0) {
    const info: FrameInfo = { timeMs: clock.time, realSeconds, dt, uiHidden };
    for (const run of frameHooks) run(info);
  }
  // The home page's opening screen shows the live globe through it. Once the visitor has
  // scrolled past that, nobody can see the globe: draw it only now and then (often enough to
  // keep textures and shaders warm) and leave the GPU to the page.
  frameCount++;
  if (places.active) places.follow(dt, clock.time, realSeconds); // …and the scene coming in follows the tracker's camera
  if (!landing.showing || landing.heroInView || frameCount % 15 === 0) kit.render();
  if (wantShot) {
    wantShot = false;
    saveShot();
  }
  watchFrameRate(now);
}

// ---------------------------------------------------------------- feature modules
//
// Everything in src/features/ plugs in here, through the App interface (src/ui/app.ts). This
// object is the only thing those modules know about the rest of the program.

/** Extra sources for the search field (App.addSearch); the search module asks each one as the visitor types. */
const searchProviders: SearchProvider[] = [];

const app: App = {
  catalog: () => catalog,
  facts: () => facts,
  selected: () => selected,
  encounter: () => encPanel.encounter,
  alertKm: () => screeningDistance,

  time: () => clock.time,
  speed: () => (clock.paused ? 0 : clock.speed),
  jumpTo: (timeMs) => jumpTo(timeMs),
  jumpToNow: () => jumpToNow(),
  setSpeed: (multiplier) => {
    // 0 is how speed() reports a paused clock, so it means "pause" here too: the running speed
    // is kept, and Space or the play button resumes at it (a speed of 0 would leave the clock stuck).
    if (multiplier !== 0) clock.speed = multiplier;
    clock.paused = multiplier === 0;
    timeControls.sync();
  },

  observer: () => observer,
  settings: () => store.settings,
  setSetting: (name, value) => store.set(name, value as string | number | boolean),

  select: (sat) => select(sat),
  search: (query, limit) => (catalog ? searchCatalog(catalog, query, limit) : []),
  addSearch: (provider) => void searchProviders.push(provider),
  flyToGround: (latDeg, lonDeg, altitudeKm = 2500) => {
    if (fp.mode !== 'off') fp.exit();
    closeEncounter(true);
    if (selected) select(null);
    // The place in the Earth's own frame (see "Coordinate frames" in CLAUDE.md), then wherever
    // the Earth's rotation has carried it by now.
    const lat = THREE.MathUtils.degToRad(latDeg), lon = THREE.MathUtils.degToRad(lonDeg);
    const overhead = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon))
      .multiplyScalar(6.371 + Math.max(150, altitudeKm) * KM);
    rig.follow = false;
    rig.flyToView(globe.earth.localToWorld(overhead), ORIGIN.clone(), 2);
    rig.holdStill(); // stay over the place: the idle drift would slide it out of view
  },
  view: (which) => {
    if (which === 'home') return goHome();
    closeEncounter(true);
    if (selected) select(null);
    preset(which === 'earth' ? 1 : which === 'leo' ? 2 : which === 'geo' ? 3 : 5);
  },
  openPanel: (name) => openPanel(name),
  toggle: (what, on) => {
    const flip = (isOn: boolean, set: () => void) => {
      if (on === undefined || on !== isOn) set();
    };
    if (what === 'monitor') flip(conjunctionOn, () => setConjunction(!conjunctionOn));
    else if (what === 'cells') flip(gridOn, () => setGrid(!gridOn));
    else if (what === 'autopilot') flip(cinema.isPlaying, toggleAutopilot);
    else if (what === 'sky') flip(fp.mode === 'ground', skyView);
    else if (what === 'ride') flip(fp.mode === 'satellite', rideAlong);
    else if (what === 'fullscreen') flip(!!document.fullscreenElement, toggleFullscreen);
    else if (what === 'howto') flip(howto.isOpen, () => (howto.isOpen ? howto.close() : howto.open()));
    else if (what === 'keys') flip(!keysOverlay.classList.contains('is-hidden'), () => setKeys(keysOverlay.classList.contains('is-hidden')));
    else if (what === 'share') shareDialog.open(shareUrl(), !!selected || encPanel.isOpen);
  },
  openSection: (name) => {
    if (isPhone() && name === 'tonight') {
      // On a phone that list belongs to the full-screen sky view, where you can hold the phone up to it.
      toast('Tonight’s passes are in the sky view: tap the sky button, then the eye beside the cross.', 6000);
      return;
    }
    if (isPhone() && inspector.isOpen) select(null); // one sheet at a time on a phone
    openPanel('objects');
    objectTabs.open(name);
  },
  toast: (text) => toast(text),
  ready: () => !landing.showing && !$('hud').classList.contains('hud-hidden'),
  setFilter: (key, keep) => filters.setExtra(key, keep),

  position: (index, out) => sim.getPosition(index, out),
  earth: globe.earth,
  eciGroup: kit.eciGroup,
  camera: kit.camera,

  onFrame: (run) => void frameHooks.push(run),
  onSelect: (run) => void selectHooks.push(run),
  onCatalog: (run) => void catalogHooks.push(run),
  onFacts: (run) => void factsHooks.push(run),
  onSettings: (run) => void settingsHooks.push(run),
  onEncounter: (run) => void encounterHooks.push(run),
  onHome: (run) => void homeHooks.push(run),
  onSkyView: (run) => void skyHooks.push(run),
  useMyLocation,
};

app.addSearch((query) => places.search(query));

// One line per module. A module that throws while setting itself up is reported and skipped:
// an optional extra must never stop the tracker from starting.
for (const install of [installRadio, installChanges, installWeather, installLaunches, installTonight, installReport, installGrowth, installCommand]) {
  try {
    install(app);
  } catch (error) {
    console.error('A feature module failed to start', error);
  }
}

// ---------------------------------------------------------------- start

async function boot(): Promise<void> {
  requestAnimationFrame(frame);
  loadRegions();
  void loadFacts().then((loaded) => {
    facts = loaded;
    updateDataNote();
    for (const run of factsHooks) run(loaded);
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
    // Build the 3D models and compile their shaders now, behind the loading screen, so the
    // first click on a satellite (and every autopilot scene change) does not stutter.
    prewarmModels(kit.renderer, kit.scene, kit.camera);
    tiles.prewarm(kit.renderer, kit.scene, kit.camera);
    // Everything is ready. If the welcome page is still up, wait there until the visitor comes in.
    landing.status(`${fmtInt(first.sats.length)} objects loaded and moving`);
    landing.setCount(first.sats.length);
    const home = homeView();
    // If the visitor is still on the home page, the tracker becomes that page's picture: the
    // loading screen is put away quietly and the globe, held a little closer than the normal
    // whole-Earth view, shows through the top of the page until they come in.
    const fromHomePage = landing.showing;
    if (fromHomePage) {
      loading.skip();
      kit.camera.position.copy(home).setLength(window.innerWidth <= 860 ? 25 : 17.5);
      landing.goLive();
      await landing.entered;
    } else {
      await loading.finish();
      landing.goLive(); // so "About" later shows the globe behind the page too
    }

    // Running normally: forget any earlier graphics resets so the reload guard starts fresh.
    setTimeout(() => {
      try {
        sessionStorage.removeItem('apsis.reloads');
      } catch { /* no storage */ }
    }, 20000);
    $('hud').classList.remove('hud-hidden');
    refreshLocationIfAllowed();
    if (!fromHomePage) kit.camera.position.copy(home);
    if (applyLink()) {
      // Opened from a share link: go straight to what it describes.
      setTimeout(() => (watchdogArmed = true), 4000);
    } else {
      // Intro, then the tour for first-time visitors. Straight from the loading screen it is a
      // swoop in from deep space; from the home page the globe is already on screen, so the
      // camera simply eases back from there to the whole-Earth view.
      if (fromHomePage) {
        rig.flyToView(kit.camera.position.clone().normalize().multiplyScalar(home.length()), ORIGIN.clone(), 2.8);
      } else {
        kit.camera.position.applyAxisAngle(UP, -1.1).setLength(390);
        rig.flyToView(home, ORIGIN.clone(), 4.5);
      }
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
    landing.status('The tracker could not load. Open it to see why.');
  }
}

void boot();
