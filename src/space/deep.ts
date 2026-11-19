/**
 * Spacecraft beyond Earth orbit: loading public/data/deep.json and working out where each
 * craft is at any moment.
 *
 * The file is written at build time by scripts/fetch-deep.mjs (JPL Horizons cannot be asked from
 * a web page). Each craft carries a `motion` about a `centre` body, in one of three forms (see
 * types.ts), and this file turns that into a position:
 *
 *   elements  Kepler's equation, with the centre's GM from bodies.ts: the same number the
 *             script used when it turned Horizons' position and velocity into the orbit, so at
 *             the download moment the position is exact, and it stays close for as long as the
 *             real path stays a two-body orbit (decades for the Voyagers, weeks for a cruise
 *             between planets). Orbiters close to a planet carry measured `rates` as well,
 *             because the planet's bulge turns their orbit and changes its pace.
 *   samples   a smooth curve through the stored positions (Catmull–Rom: a cubic through each
 *             pair of neighbours whose slope is set by the two beyond them).
 *   surface   a point on the ground, turned with the body by bodyAxes().
 *
 * Positions are km in the ICRF frame RELATIVE TO `centre`; add bodyPosition(centre) for a
 * place in the solar system. Like ephem.ts this is pure arithmetic apart from loadDeep().
 */

import { BODIES } from './bodies.ts';
import { bodyAxes, elementsPosition, meanMotion, setMoonElements } from './ephem.ts';
import type { BodyId, Craft, DeepData, Motion, Vec } from './types.ts';

let loading: Promise<DeepData | null> | null = null;

/**
 * The deep-space data, fetched once (later calls share the same promise). Resolves null if the
 * file is missing or unreadable: the bodies still work from their built-in orbits. On success
 * the moons' orbits in ephem.ts are refreshed from the file.
 */
export function loadDeep(): Promise<DeepData | null> {
  loading ??= (async () => {
    try {
      const res = await fetch('data/deep.json'); // relative: the site may live under any sub-path
      if (!res.ok) return null;
      const data = (await res.json()) as DeepData;
      if (!data || !Array.isArray(data.craft)) return null;
      // Older or partial files must not break a caller that loops over these.
      data.moons ??= {};
      data.flybys ??= [];
      data.fireballs ??= [];
      setMoonElements(data.moons);
      return data;
    } catch {
      return null;
    }
  })();
  return loading;
}

/**
 * Where something with the given motion is at `tMs`: km, ICRF, relative to `centre`.
 * `held` is true when the moment lies outside a sampled span and the nearest end is returned.
 * (A fly-by's path is a Motion too, about the Earth: this is the function to call for it.)
 */
export function motionPosition(motion: Motion, centre: BodyId, tMs: number, out: Vec = [0, 0, 0]): { pos: Vec; held: boolean } {
  if (motion.type === 'elements') {
    return { pos: elementsPosition(motion, BODIES[centre].gm, tMs, out), held: false };
  }
  if (motion.type === 'surface') {
    const { pole, prime } = bodyAxes(centre, tMs);
    const lat = (motion.latDeg * Math.PI) / 180, lon = (motion.lonDeg * Math.PI) / 180;
    const r = BODIES[centre].radiusKm;
    // East is a quarter turn from the prime meridian about the pole: pole × prime.
    const a = r * Math.cos(lat) * Math.cos(lon), b = r * Math.cos(lat) * Math.sin(lon), c = r * Math.sin(lat);
    out[0] = a * prime[0] + b * (pole[1] * prime[2] - pole[2] * prime[1]) + c * pole[0];
    out[1] = a * prime[1] + b * (pole[2] * prime[0] - pole[0] * prime[2]) + c * pole[1];
    out[2] = a * prime[2] + b * (pole[0] * prime[1] - pole[1] * prime[0]) + c * pole[2];
    return { pos: out, held: false };
  }
  return sampled(motion.xyz, (tMs - motion.t0Ms) / motion.stepMs, out);
}

/** Where a craft is at `tMs`: km, ICRF, relative to `craft.centre`. */
export function craftPosition(craft: Craft, tMs: number, out: Vec = [0, 0, 0]): { pos: Vec; held: boolean } {
  return motionPosition(craft.motion, craft.centre, tMs, out);
}

/**
 * Catmull–Rom through equally spaced positions, at `u` steps from the first. Linear
 * interpolation would cut the corners of a curved path by tens of kilometres; this is good to a
 * few kilometres at the steps the file uses (the check prints the worst case).
 */
function sampled(xyz: number[], u: number, out: Vec): { pos: Vec; held: boolean } {
  const last = xyz.length / 3 - 1;
  if (last < 0) {
    out[0] = out[1] = out[2] = 0;
    return { pos: out, held: true };
  }
  const held = !(u >= 0 && u <= last);
  const at = Math.min(last, Math.max(0, held ? (u > last ? last : 0) : u));
  const i = Math.min(Math.max(last - 1, 0), Math.floor(at)), f = at - i;
  const f2 = f * f, f3 = f2 * f;
  for (let k = 0; k < 3; k++) {
    const p1 = xyz[i * 3 + k], p2 = xyz[Math.min(last, i + 1) * 3 + k];
    // The first and last intervals have a neighbour on one side only. Invent the missing one
    // by continuing the curve's bend (the parabola through the three nearest points); with
    // only two points in all, the straight line through them.
    const inner = i + 2 <= last ? xyz[(i + 2) * 3 + k] : NaN, outer = i > 0 ? xyz[(i - 1) * 3 + k] : NaN;
    const p0 = i > 0 ? outer : i + 2 <= last ? 3 * p1 - 3 * p2 + inner : 2 * p1 - p2;
    const p3 = i + 2 <= last ? inner : i > 0 ? 3 * p2 - 3 * p1 + outer : 2 * p2 - p1;
    out[k] = 0.5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (3 * p1 - p0 - 3 * p2 + p3) * f3);
  }
  return { pos: out, held };
}

/**
 * How long one circuit takes, ms: for a craft on a closed orbit about its centre. Null for
 * the ones that never come back (the Voyagers), for sampled paths and for craft on the ground.
 */
export function craftPeriodMs(craft: Craft): number | null {
  const m = craft.motion;
  if (m.type !== 'elements' || !(m.e < 1) || !(m.aKm > 0)) return null;
  return ((2 * Math.PI) / (m.rates ? m.rates.m : meanMotion(m.aKm, BODIES[craft.centre].gm))) * 1000;
}
