/**
 * An ESTIMATED climb to orbit for any launch in the list: where a rocket probably is, minute
 * by minute, from its pad to its first orbit.
 *
 * Nobody publishes a rocket's live position (SpaceX's telemetry exists only inside its video),
 * so this is a model, and the app always says so. What it is built from:
 *   - the pad's position and the lift-off time (Launch Library 2);
 *   - the target orbit (Launch Library's "LEO", "SSO", "ISS", "GTO" …), which with a few known
 *     constellations and the pad's usual direction gives the inclination, and from that the
 *     direction of flight (sin Az = cos i / cos φ);
 *   - a typical climb: about nine minutes to orbit, the height following a smooth S-curve
 *     (≈ 65 km at first-stage cut-off, as a Falcon 9 is) and the speed growing as t^1.4 up to
 *     the circular speed of the insertion height. Distance downrange is the integral of that
 *     speed, so position and speed agree.
 * Everything is done in the inertial frame frozen at lift-off: the pad is placed by GMST, the
 * rocket flies a great circle, and the Earth turns underneath as it really does. After the
 * engine stops, the rocket keeps going round on a circular orbit until the real elements of
 * the new objects reach the catalogue (usually within a day; see the "launched" highlight).
 *
 * Pure: no DOM, no three.js (scripts/check-ascent.mjs runs it in Node).
 */

import type { Launch } from './launches.ts';

const MU = 398600.4418; // km³/s²
const R_KM = 6371; // the globe's radius in the app (a sphere), so the rocket stands on the drawn ground
const EARTH_TURN = 7.2921159e-5; // rad/s

export interface AscentStage {
  /** Seconds after lift-off. */
  t: number;
  label: string;
}

export interface Ascent {
  launch: Launch;
  liftoffMs: number;
  /** Seconds from lift-off to the engine cutting off in orbit. */
  burnS: number;
  insertionKm: number;
  inclinationDeg: number;
  azimuthDeg: number;
  /** Seconds after lift-off of the first stage's cut-off (the model swaps to the upper stage there). */
  stagingS: number;
  stages: AscentStage[];
  /** How the inclination was chosen, in words (shown in the card: it is a guess). */
  basis: string;
  /**
   * The first stage's way down, for rockets whose boosters land (Falcon, New Glenn): a droneship
   * downrange (usual) or back to land near the pad (when the service says "RTLS").
   */
  booster: { landS: number; landAngle: number; where: string; estimated: boolean } | null;
  /** Pad in the inertial frame at lift-off (unit vector) and the direction of flight there. */
  u: [number, number, number];
  d: [number, number, number];
}

export interface AscentState {
  /** Inertial position, km (TEME-like: z = north). */
  pos: [number, number, number];
  altKm: number;
  /** Inertial speed, km/s. */
  speedKmS: number;
  /** Seconds since lift-off (negative before). */
  t: number;
  /** The last thing that has happened. */
  stage: string;
  burning: boolean;
  staged: boolean;
}

/** Inclinations known for some payloads, matched on the mission name (most specific first). */
const MISSION_INCLINATION: [RegExp, number, string][] = [
  [/progress|soyuz ms|crew-|crs-|cygnus|dragon|axiom|\bax-|starliner|htv|dream chaser/i, 51.64, 'a trip to the Space Station'],
  [/shenzhou|tianzhou|mengtian|wentian/i, 41.47, 'a trip to Tiangong'],
  [/amazon leo|kuiper/i, 51.9, 'an Amazon Kuiper launch'],
  [/oneweb/i, 87.9, 'a OneWeb launch'],
  [/transporter|bandwagon/i, 97.5, 'a rideshare to sun-synchronous orbit'],
];

/** Pads by rough position: their usual direction of flight (some cannot fly east over land). */
interface Site { lat: number; lon: number; leo: number; south: boolean; name: string }
const SITES: Site[] = [
  { lat: 28.5, lon: -80.6, leo: 43, south: false, name: 'Florida' }, // Starlink's 43° shell
  { lat: 34.6, lon: -120.6, leo: 70, south: true, name: 'Vandenberg' }, // south over the Pacific
  { lat: 45.9, lon: 63.3, leo: 51.6, south: false, name: 'Baikonur' },
  { lat: 51.9, lon: 128.3, leo: 51.7, south: false, name: 'Vostochny' },
  { lat: 62.9, lon: 40.6, leo: 67, south: false, name: 'Plesetsk' },
  { lat: 40.96, lon: 100.3, leo: 41.5, south: true, name: 'Jiuquan' },
  { lat: 38.85, lon: 111.6, leo: 97.5, south: true, name: 'Taiyuan' },
  { lat: 28.2, lon: 102.0, leo: 28.5, south: false, name: 'Xichang' },
  { lat: 19.6, lon: 110.95, leo: 50, south: false, name: 'Wenchang' },
  { lat: 5.2, lon: -52.8, leo: 51.9, south: false, name: 'Kourou' },
  { lat: 13.7, lon: 80.2, leo: 45, south: true, name: 'Sriharikota' },
  { lat: -39.3, lon: 177.9, leo: 45, south: false, name: 'Mahia' },
  { lat: 30.4, lon: 131.0, leo: 30.5, south: false, name: 'Tanegashima' },
  { lat: 69.1, lon: 15.6, leo: 97.5, south: false, name: 'Andøya' },
  { lat: 26.0, lon: -97.2, leo: 26.5, south: false, name: 'Starbase' },
];

/** Engine time to orbit by family, seconds (typical figures from webcasts and press kits). */
const BURN: [RegExp, number][] = [
  [/falcon/i, 525],
  [/starship/i, 520],
  [/electron/i, 540],
  [/ariane/i, 900],
  [/soyuz/i, 530],
  [/long march/i, 600],
  [/new glenn/i, 750],
  [/vulcan|atlas/i, 800],
  [/pslv|gslv|lvm/i, 1000],
  [/h3|h-ii/i, 900],
];

/** Insertion height by target orbit, km (the first, parking, orbit for transfers). */
function insertionKm(orbit: string): number {
  const o = orbit.toUpperCase();
  if (o === 'SSO' || o === 'PO') return 500;
  if (o === 'ISS') return 210;
  if (o === 'MEO') return 400;
  if (o === 'SUB') return 150;
  return 220; // LEO, and the parking orbit of GTO / GEO / TLI / heliocentric departures
}

function siteOf(lat: number, lon: number): Site | null {
  let best: Site | null = null, bestD = 3; // degrees
  for (const site of SITES) {
    const d = Math.hypot(site.lat - lat, (site.lon - lon) * Math.cos((lat * Math.PI) / 180));
    if (d < bestD) {
      bestD = d;
      best = site;
    }
  }
  return best;
}

/** Greenwich sidereal angle, radians (IAU 1982; plenty for placing a pad). */
function gmst(ms: number): number {
  const d = (ms - Date.UTC(2000, 0, 1, 12)) / 86400000;
  const deg = 280.46061837 + 360.98564736629 * d;
  return ((((deg % 360) + 360) % 360) * Math.PI) / 180;
}

/** The climb of one launch, or null if it cannot be placed (no pad position, or no time to the minute). */
export function planAscent(launch: Launch): Ascent | null {
  if (launch.latDeg === null || launch.lonDeg === null || launch.precision !== 'exact') return null;
  const lat = launch.latDeg, lon = launch.lonDeg;
  const site = siteOf(lat, lon);
  const orbit = launch.orbit.toUpperCase();
  let incl: number, basis: string;
  const named = MISSION_INCLINATION.find(([pattern]) => pattern.test(launch.mission));
  if (orbit === 'ISS') [incl, basis] = [51.64, 'the Space Station’s orbit'];
  else if (named) [incl, basis] = [named[1], named[2]];
  else if (orbit === 'SSO') [incl, basis] = [97.5, 'a sun-synchronous orbit'];
  else if (orbit === 'PO') [incl, basis] = [90, 'a polar orbit'];
  else if (/starlink/i.test(launch.mission) && site) [incl, basis] = [site.leo, `Starlink’s usual shell from ${site.name}`];
  else if (orbit === 'GTO' || orbit === 'GEO' || orbit === 'TLI' || orbit === 'HELIOCENTRIC N/A') [incl, basis] = [Math.abs(lat), 'due east, the cheapest way up'];
  else if (site) [incl, basis] = [site.leo, `the usual direction from ${site.name}`];
  else [incl, basis] = [Math.abs(lat), 'due east, the cheapest way up'];

  // Direction of flight from the inclination: sin Az = cos i / cos φ (no solution below |φ|: due east).
  const phi = (lat * Math.PI) / 180;
  const ratio = Math.cos((incl * Math.PI) / 180) / Math.cos(phi);
  let az = Math.abs(ratio) >= 1 ? (ratio > 0 ? Math.PI / 2 : -Math.PI / 2) : Math.asin(ratio); // northward branch, east of north
  if (site?.south) az = Math.PI - az; // the southward branch: same inclination, flying south
  if (Math.abs(ratio) >= 1) incl = Math.abs(lat);

  const theta = gmst(launch.netMs) + (lon * Math.PI) / 180;
  const u: [number, number, number] = [Math.cos(phi) * Math.cos(theta), Math.cos(phi) * Math.sin(theta), Math.sin(phi)];
  const east = [-Math.sin(theta), Math.cos(theta), 0];
  const north = [-Math.sin(phi) * Math.cos(theta), -Math.sin(phi) * Math.sin(theta), Math.cos(phi)];
  const d: [number, number, number] = [0, 1, 2].map((k) => north[k] * Math.cos(az) + east[k] * Math.sin(az)) as [number, number, number];

  const burnS = BURN.find(([pattern]) => pattern.test(`${launch.family} ${launch.rocket}`))?.[1] ?? 560;
  const f = (x: number) => Math.round(burnS * x);
  // A booster that lands: on a droneship about 600 km downrange some six minutes after
  // separating (a Falcon 9's usual), or back near the pad when the service says so.
  const lands = /falcon|new glenn/i.test(`${launch.family} ${launch.rocket}`) && !/expendable/i.test(launch.rocket);
  const rtls = launch.landing?.type === 'RTLS';
  const booster = lands && launch.landing?.type !== 'NONE'
    ? {
      landS: f(0.29) + (rtls ? 420 : 360),
      landAngle: (rtls ? 9 : 600) / R_KM,
      where: launch.landing?.place || (rtls ? 'a landing zone near the pad' : 'a droneship about 600 km downrange'),
      estimated: !launch.landing,
    }
    : null;
  return {
    booster,
    launch, liftoffMs: launch.netMs, burnS, insertionKm: insertionKm(orbit), inclinationDeg: incl,
    azimuthDeg: ((az * 180) / Math.PI + 360) % 360, stagingS: f(0.29), basis, u, d,
    stages: [
      { t: 0, label: 'Lift-off' },
      { t: f(0.14), label: 'Max-Q: the hardest push of the air' },
      { t: f(0.29), label: 'First stage done, stages separate' },
      { t: f(0.37), label: 'Fairing off: the payload is in vacuum' },
      { t: burnS, label: 'Engine off: in orbit' },
      ...(booster ? [{ t: booster.landS, label: rtls ? 'Booster lands back at the coast' : 'Booster lands on the droneship' }] : []),
    ].sort((p, q) => p.t - q.t),
  };
}

/** Where the rocket is `tMs` (Unix ms), on the model; past the burn it coasts round its first orbit. */
export function ascentState(a: Ascent, tMs: number): AscentState {
  const t = (tMs - a.liftoffMs) / 1000;
  const T = a.burnS;
  const rIns = R_KM + a.insertionKm;
  const vIns = Math.sqrt(MU / rIns);
  let alt: number, angle: number, speed: number;
  if (t <= 0) {
    alt = 0;
    angle = 0;
    speed = 0;
  } else if (t < T) {
    const x = t / T;
    const s = 3 * x * x - 2 * x * x * x;
    alt = a.insertionKm * Math.pow(s, 0.7);
    speed = vIns * Math.pow(x, 1.4);
    angle = (vIns * T * Math.pow(x, 2.4)) / 2.4 / rIns; // the angle swept: the integral of the speed (measured at the insertion radius, so the rate meets the orbit's at cut-off)
  } else {
    alt = a.insertionKm;
    speed = vIns;
    angle = (vIns * T) / 2.4 / rIns + ((t - T) * vIns) / rIns;
  }
  const r = R_KM + alt;
  const c = Math.cos(angle), s = Math.sin(angle);
  const pos: [number, number, number] = [0, 1, 2].map((k) => r * (a.u[k] * c + a.d[k] * s)) as [number, number, number];
  if (t < 0) {
    // Still on the pad, which turns with the Earth: the frame above is frozen at lift-off.
    const w = EARTH_TURN * t, cw = Math.cos(w), sw = Math.sin(w);
    [pos[0], pos[1]] = [pos[0] * cw - pos[1] * sw, pos[0] * sw + pos[1] * cw];
  }
  let stage = t < 0 ? 'Waiting on the pad' : a.stages[0].label;
  for (const step of a.stages) if (t >= step.t) stage = step.label;
  return { pos, altKm: alt, speedKmS: speed, t, stage, burning: t >= 0 && t < T, staged: t >= a.stagingS };
}

/** How long after lift-off the model is still worth drawing: two trips round the first orbit. */
export function ascentSpanS(a: Ascent): number {
  const rIns = R_KM + a.insertionKm;
  return a.burnS + 2 * 2 * Math.PI * Math.sqrt((rIns * rIns * rIns) / MU);
}

/**
 * Where the first stage is, after separating, on its way down (null before separation, after
 * landing, or for a rocket whose booster does not land). It coasts up to about 125 km and comes
 * down at its landing place: a smooth arc between the two, in the same frozen inertial frame.
 */
export function boosterState(a: Ascent, tMs: number): { pos: [number, number, number]; altKm: number; landed: boolean } | null {
  const b = a.booster;
  if (!b) return null;
  const t = (tMs - a.liftoffMs) / 1000;
  if (t < a.stagingS) return null;
  const start = ascentState(a, a.liftoffMs + a.stagingS * 1000);
  const from = start.pos.map((v) => v / Math.hypot(...start.pos)) as [number, number, number];
  // Where it comes down (a unit vector, inertial): a droneship downrange along the flight path;
  // or the pad itself, which the Earth's turn has carried east by the time the booster is back.
  let to: [number, number, number];
  if (b.landAngle * R_KM < 50) {
    const w = EARTH_TURN * b.landS, cw = Math.cos(w), sw = Math.sin(w);
    to = [a.u[0] * cw - a.u[1] * sw, a.u[0] * sw + a.u[1] * cw, a.u[2]];
  } else {
    const c = Math.cos(b.landAngle), sn = Math.sin(b.landAngle);
    to = [0, 1, 2].map((k) => a.u[k] * c + a.d[k] * sn) as [number, number, number];
  }
  const s = Math.min(1, (t - a.stagingS) / (b.landS - a.stagingS));
  const ease = s * s * (3 - 2 * s);
  // Along the great circle between the two (slerp), coasting up to ~125 km and down to the landing.
  const omega = Math.acos(Math.max(-1, Math.min(1, from[0] * to[0] + from[1] * to[1] + from[2] * to[2])));
  const k0 = omega < 1e-9 ? 1 - ease : Math.sin((1 - ease) * omega) / Math.sin(omega);
  const k1 = omega < 1e-9 ? ease : Math.sin(ease * omega) / Math.sin(omega);
  const alt = start.altKm * (1 - s) + 4 * 90 * s * (1 - s);
  const r = R_KM + alt;
  const pos = [0, 1, 2].map((k) => r * (from[k] * k0 + to[k] * k1)) as [number, number, number];
  return { pos, altKm: alt, landed: s >= 1 };
}
