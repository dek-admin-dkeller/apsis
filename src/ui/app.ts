/**
 * The App interface: what a feature module is allowed to know about the rest of the program.
 *
 * `src/main.ts` creates the scene, the simulation and the core panels, and has grown large.
 * Features added later (radio details, orbit changes, launches, the command bar …) do not
 * reach into it. Each lives in its own file under `src/features/`, exports one function
 * `install(app: App)`, and does everything through this interface: it reads state through the
 * getters, asks for things through the actions, and is told about changes through the `on…`
 * hooks. `main.ts` builds the one object that implements it (search for `const app: App`) and
 * calls every installer once, after everything else exists.
 *
 * Rules for a feature module:
 *   - never import `main.ts`; import data and render helpers directly if needed;
 *   - draw its interface inside the empty element reserved for it in index.html (ids listed
 *     where each module is installed) and bring its own stylesheet;
 *   - keep per-frame work tiny and skip it while `frame.uiHidden` is true unless it draws in 3D.
 */

import type * as THREE from 'three';
import type { Catalog } from '../data/catalog.ts';
import type { Observer } from '../data/ephemeris.ts';
import type { CatalogFacts } from '../data/satcat.ts';
import type { Satellite } from '../data/types.ts';
import type { Encounter } from './encounterPanel.ts';
import type { Settings } from './settings.ts';

export type Vec3 = { x: number; y: number; z: number };

export interface FrameInfo {
  timeMs: number; // simulated time, Unix ms
  realSeconds: number; // seconds this page has been running (for animation)
  dt: number; // seconds since the previous frame, capped at 0.1
  uiHidden: boolean; // the interface is hidden (H key, autopilot): skip panel-only work
}

/** Things that can be switched on or off (or just opened) by name. */
export type Toggle = 'monitor' | 'cells' | 'autopilot' | 'sky' | 'ride' | 'fullscreen' | 'howto' | 'keys' | 'share';
export type ViewName = 'home' | 'earth' | 'leo' | 'geo' | 'moon';
export type PanelName = 'objects' | 'layers' | 'conj' | 'settings';
/** The sections of the Objects panel, by the name each carries in index.html (`data-section`). */
export type SectionName =
  | 'watchlist' | 'notable' | 'type' | 'orbit' | 'appearance' // Browse
  | 'tonight' | 'launches' | 'changes' | 'newest' | 'trains' | 'lowest' // Activity
  | 'constellations' | 'growth' | 'designer'; // Tools

/**
 * One line the search field can offer. Anything may add its own (see App.addSearch): the
 * catalogue, cities, actions, and the bodies and spacecraft beyond Earth orbit.
 */
export interface SearchHit {
  /** The main text: 'James Webb Space Telescope'. */
  title: string;
  /** Quiet text beside it saying what kind of thing this is: 'Space telescope', 'Planet'. */
  note?: string;
  /** The heading it is listed under: 'Objects', 'Places', 'Beyond Earth orbit', 'Actions' … */
  group: string;
  /** How well it matches, 0…1 (1 = the name exactly); orders hits that come from different sources. */
  score: number;
  /** What choosing it does. */
  run(): void;
}
/** Given what has been typed (trimmed, as typed), the hits a source has for it, best first. */
export type SearchProvider = (query: string) => SearchHit[];

export interface App {
  // ---- what is loaded, selected and open -------------------------------------------------
  /** The catalogue in use (null only for the first moments after start-up). */
  catalog(): Catalog | null;
  /** Owner, launch date, type and radar size per NORAD id (empty until public/data/satcat.json has loaded). */
  facts(): Map<number, CatalogFacts>;
  selected(): Satellite | null;
  /** The close approach on screen, if one is open. */
  encounter(): Encounter | null;
  /** The monitor's alert distance, km. */
  alertKm(): number;

  // ---- time -------------------------------------------------------------------------------
  /** Simulated time, Unix ms. */
  time(): number;
  /** How fast simulated time runs (1 = real time, 0 = paused, negative = backwards). */
  speed(): number;
  /** Move the clock (keeps the current speed). */
  jumpTo(timeMs: number): void;
  /** Back to the present at normal speed. */
  jumpToNow(): void;
  setSpeed(multiplier: number): void;

  // ---- place and preferences --------------------------------------------------------------
  /** The ground station (the visitor's own position once they have allowed it). */
  observer(): Observer;
  settings(): Settings;
  setSetting<K extends keyof Settings>(name: K, value: Settings[K]): void;

  // ---- actions ----------------------------------------------------------------------------
  /** Select an object (camera flies to it, the inspector opens) or deselect with null. */
  select(sat: Satellite | null): void;
  /** Objects whose name starts with or contains the query, or whose NORAD id matches. */
  search(query: string, limit?: number): Satellite[];
  /** Offer more things in the search field (bodies, spacecraft beyond Earth orbit …). */
  addSearch(provider: SearchProvider): void;
  /** Fly to look straight down at a place from `altitudeKm` up (default 2,500). */
  flyToGround(latDeg: number, lonDeg: number, altitudeKm?: number): void;
  view(which: ViewName): void;
  /** Open one of the left-hand panels (or close them all with null). */
  openPanel(name: PanelName | null): void;
  /** Open the Objects panel at one of its sections (whichever tab that section is in). */
  openSection(name: SectionName): void;
  /** Switch something on or off; without `on`, flip it (or simply open it). */
  toggle(what: Toggle, on?: boolean): void;
  /** A short message at the bottom of the screen. */
  toast(text: string): void;
  /** Is the tracker itself in front and ready for input? False while it is loading and while the home page covers it. */
  ready(): boolean;
  /**
   * Hide objects from the globe (and from screening). Every registered test must pass for an
   * object to be shown; register under a key of your own, and pass null to remove the test.
   */
  setFilter(key: string, keep: ((sat: Satellite) => boolean) | null): void;

  // ---- drawing ----------------------------------------------------------------------------
  /** Where object `index` is drawn right now, km in the inertial frame. False if it has no position. */
  position(index: number, out: Vec3): boolean;
  /**
   * The turning Earth (radius 6.371 scene units). A child placed at
   * (R cosφ cosλ, R sinφ, −R cosφ sinλ) stays over latitude φ, longitude λ.
   */
  earth: THREE.Object3D;
  /** Parent for anything expressed in inertial kilometres (see "Coordinate frames" in CLAUDE.md). */
  eciGroup: THREE.Group;
  camera: THREE.PerspectiveCamera;

  // ---- being told about changes -----------------------------------------------------------
  onFrame(run: (frame: FrameInfo) => void): void;
  onSelect(run: (sat: Satellite | null) => void): void;
  /** A catalogue was loaded or replaced (start-up, "Download current elements", a designed satellite). */
  onCatalog(run: (next: Catalog, previous: Catalog | null) => void): void;
  onFacts(run: (facts: Map<number, CatalogFacts>) => void): void;
  onSettings(run: (settings: Settings, changed: keyof Settings | null) => void): void;
  onEncounter(run: (encounter: Encounter | null) => void): void;
  /** The logo (or `0`) was pressed: everything is being put back the way it started. Undo what you changed. */
  onHome(run: () => void): void;
  /** The phone's full-screen sky view opened (true) or closed (false). */
  onSkyView(run: (open: boolean) => void): void;
  /**
   * Make sure the ground station is the visitor's own place, asking the browser for their
   * position if it is still the built-in example. Call it from the visitor's own click.
   * Resolves false if the browser cannot say or they declined.
   */
  useMyLocation(): Promise<boolean>;
}
