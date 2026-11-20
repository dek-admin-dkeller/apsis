/**
 * Beyond Earth orbit: the shared vocabulary.
 *
 * The tracker itself (everything outside this folder) knows only objects in Earth orbit, from
 * CelesTrak element sets. This folder adds the rest of the solar system: the Sun, planets and
 * moons ("bodies"), and spacecraft that CelesTrak cannot describe because they do not orbit the
 * Earth in the ordinary way ("craft": Webb at L2, orbiters at the Moon and Mars, the Voyagers).
 *
 * ONE FRAME for everything in this folder: ICRF / J2000 equatorial, kilometres.
 *   x → the vernal equinox, z → the celestial north pole, y completes the right-handed set.
 * That is (to a third of a degree) the frame SGP4 already uses for the tracker, so the same
 * conversion to scene axes applies: ICRF (x, y, z) → scene (x, z, −y).
 * Times are Unix milliseconds (UTC), as everywhere else in the app.
 *
 * Who provides what (see CLAUDE.md, "Beyond Earth orbit"):
 *   bodies.ts    BODIES: the static facts below for every BodyId
 *   ephem.ts     bodyPosition, bodyRelative, bodyAxes                        (pure maths)
 *   deep.ts      loadDeep, craftPosition, craftPeriodMs  (reads public/data/deep.json)
 *   dsn.ts       watchDsn                                (NASA's live Deep Space Network feed)
 *   imagery.ts   IMAGERY: the map of each body, bundled and streamed
 */

export type BodyId =
  | 'sun'
  | 'mercury' | 'venus' | 'earth' | 'moon'
  | 'mars' | 'phobos' | 'deimos'
  | 'jupiter' | 'amalthea' | 'thebe' | 'io' | 'europa' | 'ganymede' | 'callisto' | 'himalia'
  | 'saturn' | 'epimetheus' | 'janus' | 'mimas' | 'enceladus' | 'tethys' | 'dione' | 'rhea' | 'titan' | 'hyperion' | 'iapetus' | 'phoebe'
  | 'uranus' | 'puck' | 'miranda' | 'ariel' | 'umbriel' | 'titania' | 'oberon'
  | 'neptune' | 'proteus' | 'triton' | 'nereid'
  | 'pluto' | 'charon' | 'styx' | 'nix' | 'kerberos' | 'hydra';

/** Kilometres (or a unit direction) in the ICRF frame described above. */
export type Vec = [number, number, number];

export interface Body {
  id: BodyId;
  name: string;
  /** What it orbits; null only for the Sun. */
  parent: BodyId | null;
  kind: 'star' | 'planet' | 'dwarf' | 'moon';
  /** Mean radius, km. */
  radiusKm: number;
  /** Gravitational parameter GM, km³/s² (Kepler's third law for anything orbiting it). */
  gm: number;
  /** Sidereal rotation period, hours; negative = turns backwards (Venus, Pluto). */
  dayHours: number;
  /** Time to go once round its parent, days (0 for the Sun). */
  periodDays: number;
  /** A place the visitor can go to (it has a map). The small moons are only drawn beside their planet. */
  visitable: boolean;
  /** A plain colour for dots, orbit lines and the moments before its map has loaded: 0…1 each. */
  color: [number, number, number];
  /** One sentence for the information card. */
  blurb: string;
  /** English Wikipedia article title. */
  wiki: string;
  /** Who found it and when, for a body that had to be discovered: 'Galileo Galilei, 1610'. */
  discovered?: string;
  /** Typical temperature at the surface (for a giant, at the cloud tops), °C. */
  tempC?: number;
  /** What its air is made of, in a few words, if it has any worth the name: 'Thin carbon dioxide'. */
  air?: string;
}

/**
 * How a craft moves, about the body named in `Craft.centre`:
 *   elements  an ordinary two-body orbit (osculating elements from JPL Horizons): orbiters, and
 *             craft cruising round the Sun. Propagated in the browser with Kepler's equation
 *             (a < 0 and e > 1 for the hyperbolas of the craft leaving the solar system).
 *   samples   positions at equal steps of time, interpolated: for craft whose path is not an
 *             ellipse about one body (the L1 / L2 halo orbits). Outside the sampled span the
 *             nearest end is held.
 *   surface   it stands on the ground of `centre` (rovers and landers).
 */
export type Motion =
  | {
      type: 'elements'; epochMs: number; aKm: number; e: number; incl: number; node: number; peri: number; m0: number; // angles in radians, ICRF equator
      /**
       * Optional, for orbiters close to a planet or moon: how the orbit itself turns, measured
       * from Horizons over the week after `epochMs` (radians per second). A planet's bulge swings
       * the orbit's plane round the planet's pole (`axis`, a unit vector; `node` is how fast),
       * turns the ellipse within its plane (`peri`) and changes the pace along it (`m`, which
       * REPLACES the rate Kepler's third law gives). Without these a low Mars orbiter is 20° from
       * its true place after one day. Use ephem.ts's elementsPosition / deep.ts's craftPosition,
       * which apply them.
       */
      rates?: { axis: Vec; node: number; peri: number; m: number };
    }
  | { type: 'samples'; t0Ms: number; stepMs: number; xyz: number[] } // km, x y z x y z …
  | { type: 'surface'; latDeg: number; lonDeg: number }; // planetocentric latitude, east longitude

export interface Craft {
  /** Short stable name for links and lookups: 'webb', 'voyager-1'. */
  id: string;
  /** Full name as people say it: 'James Webb Space Telescope'. */
  name: string;
  /** What to write on a small label: 'Webb'. */
  short: string;
  /** Other words people type for it, lower case: ['jwst', 'james webb', 'webb telescope']. */
  aliases: string[];
  /** The body its motion is given about (and the place where it is shown). */
  centre: BodyId;
  /** Which 3D model: a ModelKind name from data/describe.ts ('webb', 'voyager', 'marsorbiter' …). */
  model: string;
  /** 'silent' = no longer answering (the Pioneers); still where physics says it is. */
  status: 'active' | 'silent';
  /** 'NASA', 'ESA', 'ISRO' … */
  agency: string;
  /** Launch date, ISO (yyyy-mm-dd). */
  launched: string;
  /** What it is, in a few words: 'Infrared space telescope'. */
  role: string;
  /** One or two sentences for the information card. */
  blurb: string;
  /** English Wikipedia article title. */
  wiki: string;
  /** The names NASA's Deep Space Network feed uses for it (upper case), if it talks through that network. */
  dsn: string[];
  /** The day it got where it is now (entered orbit, landed, reached its station), ISO, when that is known. */
  arrived?: string;
  /** For a craft that has fallen silent: the day of its last contact, ISO. */
  ended?: string;
  /** Mass at launch, kg. */
  massKg?: number;
  motion: Motion;
  /**
   * Set on an asteroid flying past the Earth. It is not a spacecraft, but it is drawn, named,
   * found and followed exactly like one, so the views treat it as a craft that carries the
   * numbers of its pass (ui/places.ts makes these from DeepData.flybys).
   */
  passing?: Flyby;
  /**
   * Set on a historic landing site (see Site). Like a passing asteroid it is not a working
   * spacecraft, but it is a named point with a card that the views can show with the code
   * they have, so ui/places.ts gives each site to them as a craft that stands on the ground.
   */
  site?: Site;
}

/**
 * A place on the ground where something from Earth came down and stayed: the Apollo landings,
 * the Vikings, Huygens on Titan. (Craft still working on the ground are in DeepData.craft with
 * a `surface` motion; these are the historic ones.) src/space/sites.ts holds the list.
 */
export interface Site {
  /** Short stable name: 'apollo-11'. */
  id: string;
  /** 'Apollo 11' */
  name: string;
  body: BodyId;
  /** Planetocentric latitude and EAST longitude, degrees. */
  latDeg: number;
  lonDeg: number;
  /** The day it landed, ISO. */
  date: string;
  agency: string;
  /** People walked there; a lander that stayed put; one that drove; one that only fell or struck. */
  kind: 'crewed' | 'lander' | 'rover' | 'probe';
  /** Which 3D model stands there (a ModelKind: 'apollolm', 'viking', 'mer' …; 'lander' or 'rover' when there is no model of its own). */
  model: string;
  /** One or two sentences for the information card. */
  blurb: string;
  /** English Wikipedia article title. */
  wiki: string;
}

/** An asteroid passing the Earth (JPL CNEOS close-approach data). */
export interface Flyby {
  name: string;
  /** Closest approach, Unix ms. */
  timeMs: number;
  /** Nominal miss distance from the Earth's centre, km. */
  distanceKm: number;
  /** Speed relative to the Earth, km/s. */
  speedKmS: number;
  /** Absolute magnitude H (smaller = bigger); the size below is estimated from it. */
  h: number;
  /** Likely diameter range, metres. */
  sizeM: [number, number];
  /**
   * Its path past the Earth, for the closest dozen (within 0.02 AU): 'samples' about the Earth's
   * centre, every 30 minutes from three days before closest approach to three days after.
   */
  motion?: Motion;
}

/** A bright meteor seen by US Government sensors (JPL fireball data). */
export interface Fireball {
  timeMs: number;
  latDeg: number;
  lonDeg: number;
  /** Height of peak brightness, km (null when not reported). */
  altitudeKm: number | null;
  /** Total impact energy, kilotons of TNT. */
  energyKt: number;
  speedKmS: number | null;
  /** Its velocity before entry, Earth-fixed (x to longitude 0, z north), km/s, when published. */
  velocity?: [number, number, number];
}

/** public/data/deep.json, written by scripts/fetch-deep.mjs. */
export interface DeepData {
  fetchedAt: string; // ISO time of the download
  craft: Craft[];
  /**
   * Osculating elements of each moon about its planet (Motion of type 'elements'), each at its
   * own `epochMs`. For ephem.ts's setMoonElements only: Pluto's four small moons are given about
   * the centre of mass of Pluto and Charon, which is what they really circle (see moonOrbits.ts).
   */
  moons: Partial<Record<BodyId, Motion>>;
  flybys: Flyby[];
  fireballs: Fireball[];
}

/** One dish of the Deep Space Network talking to (or listening for) one spacecraft, right now. */
export interface DsnLink {
  dish: string; // 'DSS-56'
  site: 'Goldstone' | 'Madrid' | 'Canberra';
  /** The feed's own name for the spacecraft, upper case: 'JWST'. Match against Craft.dsn. */
  craft: string;
  /** A readable name when the feed's code is known, else the code. */
  name: string;
  up: boolean; // a signal is going up to it
  down: boolean; // a signal is coming down from it
  rangeKm: number | null;
  /** Round-trip light time, seconds. */
  roundTripS: number | null;
}

/** The map of one body. Paths are relative to the site root (they work under any sub-path). */
export interface Imagery {
  /** Bundled global map, 2:1 equirectangular, longitude 0 in the middle, east to the right. */
  base: string;
  /** A sharper copy (4096 px wide) used on the High quality setting, where one is bundled. */
  baseHigh?: string;
  /** A second layer drawn over the surface (Venus's clouds); same layout. */
  clouds?: string;
  /** Rings: a strip running from the inner edge (left) to the outer edge (right), with transparency. */
  ring?: { strip: string; innerKm: number; outerKm: number };
  /**
   * Streamed detail (NASA Trek, WMTS, equirectangular, 2 × 1 tiles at level 0). The address has
   * {z}, {y} (row from the north) and {x} (column from longitude −180°).
   */
  tiles?: { url: string; maxZoom: number };
  /** Who made the pictures, for the About sheet: 'NASA / JPL / USGS'. */
  credit: string;
}
