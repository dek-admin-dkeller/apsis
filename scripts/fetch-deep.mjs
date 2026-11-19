// scripts/fetch-deep.mjs — `npm run fetch-deep`
//
// Writes public/data/deep.json: everything the app shows BEYOND Earth orbit that has to be
// looked up rather than computed.
//
//   craft      where each spacecraft in scripts/deep-craft.mjs is: Webb at L2, the orbiters at
//              the Moon and Mars, the Voyagers … from JPL Horizons, as an orbit about the body
//              it circles, as a run of positions (the L1 / L2 craft and TESS, whose paths are no
//              ellipse), or as a place on the ground (rovers and landers)
//   moons      this moment's orbit of every moon the app draws, about its planet
//   flybys     asteroids passing within 0.05 AU of the Earth, a week back to two months ahead
//              (JPL CNEOS), with the path past the Earth of the closest dozen
//   fireballs  the latest bright meteors recorded by US Government sensors (JPL CNEOS)
//
// It also writes scripts/fixtures/deep-reference.json: Horizons' own positions for the same
// craft and moons at later moments, from the SAME download. `npm run check` propagates
// deep.json to those moments and compares, which is what proves the timing.
//
// Why build time: none of these services sends an Access-Control-Allow-Origin header a web
// page could use (Horizons) or should be asked by every visitor (CNEOS).
//
// Politeness: about 80 requests, strictly one at a time and at least 1.1 s apart (horizons.mjs
// enforces it), a generic User-Agent, never repeated or polled. The script refuses to run again
// while the file is younger than 12 hours (use --force). Nothing here is fatal: a craft that
// cannot be placed is skipped with a line in the log, a list that cannot be read is carried
// over from the file already on disk, and if no craft at all could be placed the old file is
// left untouched. The exit code is always 0, so an outage can never break a deploy.

import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CRAFT } from './deep-craft.mjs';
import { BODY_CODE, coverageLimit, TT_MINUS_UTC_MS, vectorRun, vectors } from './horizons.mjs';
import { BODIES } from '../src/space/bodies.ts';
import { bodyAxes, bodyPosition, meanMotion, stateToElements } from '../src/space/ephem.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/data/deep.json');
const REFERENCE = join(ROOT, 'scripts/fixtures/deep-reference.json');

const MIN_AGE_HOURS = 12;
const DAY = 86400000;
const AU_KM = 149597870.7;
const CAD_URL = 'https://ssd-api.jpl.nasa.gov/cad.api';
const FIREBALL_URL = 'https://ssd-api.jpl.nasa.gov/fireball.api';
const FIREBALLS = 40;
/** Fly-bys closer than this get a path (the app draws them passing the Earth); at most this many, nearest first. */
const PATH_WITHIN_AU = 0.02, PATHS = 12;

const CODE = BODY_CODE;
const MOONS = Object.values(BODIES).filter((body) => body.kind === 'moon').map((body) => body.id);

const exists = (p) => access(p).then(() => true, () => false);
/** A number with `digits` significant figures: plenty for the purpose and a third of the bytes. */
const sig = (value, digits = 10) => Number(value.toPrecision(digits));
const roundAll = (list) => list.map((v) => Math.round(v));

/** One GET of a JSON API (CNEOS), politely. */
async function getJson(url) {
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const res = await fetch(url, { headers: { 'User-Agent': 'orbit-viewer/1.0', Accept: 'application/json' }, signal: AbortSignal.timeout(45000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(await res.text());
}

/** State vectors at a list of moments; if the trajectory does not reach the later ones, at as many as it does reach. */
async function vectorsWithin(target, centre, times) {
  try {
    return await vectors(target, centre, times);
  } catch (error) {
    const limit = coverageLimit(error.message);
    const reachable = limit ? times.filter((t) => (limit.side === 'end' ? t < limit.ms - 60000 : t > limit.ms + 60000)) : [];
    if (reachable.length === 0 || reachable[0] !== times[0]) throw error; // the first moment is the one that matters
    return await vectors(target, centre, reachable);
  }
}

const run = vectorRun;

/**
 * Is a craft that is "round the Sun" in fact deep inside a planet's reach right now (a gravity
 * assist, an arrival)? Then its path for the next days is a hyperbola about that planet, and an
 * orbit about the Sun fitted to this instant would send it off in the wrong direction. The
 * sphere of influence is the usual a × (m / M)^(2/5).
 */
function planetHolding(sunPos, tMs) {
  for (const body of Object.values(BODIES)) {
    if (body.kind !== 'planet') continue;
    const p = bodyPosition(body.id, tMs);
    const reach = Math.hypot(...p) * (body.gm / BODIES.sun.gm) ** 0.4;
    if (Math.hypot(sunPos[0] - p[0], sunPos[1] - p[1], sunPos[2] - p[2]) < reach) return body.id;
  }
  return null;
}

/** Latitude and east longitude (degrees) of a position given about a body's centre, using the app's own rotation model. */
function groundPoint(centre, pos, tMs) {
  const { pole, prime } = bodyAxes(centre, tMs);
  const east = [pole[1] * prime[2] - pole[2] * prime[1], pole[2] * prime[0] - pole[0] * prime[2], pole[0] * prime[1] - pole[1] * prime[0]];
  const dot = (a) => pos[0] * a[0] + pos[1] * a[1] + pos[2] * a[2];
  const r = Math.hypot(...pos);
  return { latDeg: Math.asin(dot(pole) / r) * 180 / Math.PI, lonDeg: Math.atan2(dot(east), dot(prime)) * 180 / Math.PI, radiusKm: r };
}

// ── spacecraft ──────────────────────────────────────────────────────────────────────────

async function placeCraft(row, epoch, reference) {
  // The later moments are only for the check: how far has the stored orbit drifted from the truth?
  const later = [epoch, epoch + DAY, epoch + 3 * DAY, epoch + 7 * DAY, epoch + 30 * DAY];
  if (row.path === 'surface') {
    let [latDeg, lonDeg] = row.site;
    if (row.horizons) {
      try {
        const [state] = await vectors(row.horizons, CODE[row.centre], [epoch]);
        const here = groundPoint(row.centre, state.pos, epoch);
        // Only believe it if it really is on the ground: a cruise-stage trajectory would not be.
        if (Math.abs(here.radiusKm / BODIES[row.centre].radiusKm - 1) < 0.01) {
          reference[row.id] = { centre: row.centre, site: row.site, tMs: [epoch], xyz: [state.pos] };
          latDeg = sig(here.latDeg, 6);
          lonDeg = sig(here.lonDeg, 7);
        }
      } catch (error) {
        console.log(`    ${row.id}: Horizons has no position today (${error.message}); using its landing site`);
      }
    }
    return { centre: row.centre, motion: { type: 'surface', latDeg, lonDeg } };
  }

  if (row.path === 'samples') {
    // Ask at half the stored step: every second position is stored, and the ones in between
    // go to the reference file, where the check measures how well interpolation recovers them.
    const half = row.stepMin / 2;
    const rows = await run(row.horizons, CODE[row.centre], epoch - 10 * DAY, epoch + 90 * DAY, half);
    if (rows.length % 2 === 0) rows.pop(); // end on a stored position, not on an in-between one
    const kept = rows.filter((_, i) => i % 2 === 0), between = rows.filter((_, i) => i % 2 === 1);
    reference[row.id] = { centre: row.centre, tMs: between.map((r) => r.tMs), xyz: between.map((r) => roundAll(r.pos)) };
    return { centre: row.centre, motion: { type: 'samples', t0Ms: kept[0].tMs, stepMs: row.stepMin * 60000, xyz: kept.flatMap((r) => roundAll(r.pos)) } };
  }

  // An orbit about `centre` … unless a planet has hold of it at the moment.
  let centre = row.centre;
  let states = await vectorsWithin(row.horizons, CODE[centre], later);
  if (centre === 'sun') {
    const holder = planetHolding(states[0].pos, epoch);
    if (holder) {
      console.log(`    ${row.id}: inside the reach of ${holder} today, so its orbit is given about ${holder}`);
      centre = holder;
      states = await vectorsWithin(row.horizons, CODE[centre], later);
    }
  }
  const el = stateToElements(states[0].pos, states[0].vel, BODIES[centre].gm, epoch);
  const motion = tidy(el);
  // Round a planet or a moon the orbit itself turns: measure how fast (see measuredRates).
  const rates = centre !== 'sun' && el.e < 1 ? measuredRates(states, centre, el) : null;
  if (rates) motion.rates = { axis: rates.axis.map((v) => sig(v, 9)), node: sig(rates.node, 8), peri: sig(rates.peri, 8), m: sig(rates.m, 12) };
  reference[row.id] = { centre, fitted: rates ? rates.days : [], tMs: states.map((s) => s.tMs), xyz: states.map((s) => s.pos.map((v) => sig(v, 12))) };
  return { centre, motion };
}

/**
 * How an orbiter's orbit really turns and how fast the craft really goes round it, from Horizons'
 * positions one day and seven days after the epoch (whichever exist; the longer baseline refines
 * the shorter). A planet is not a point mass: its bulge swings the orbit's plane round the
 * planet's pole, turns the ellipse in its plane, and makes the pace differ from the one Kepler's
 * third law gives for the instantaneous ellipse. For Mars Reconnaissance Orbiter that last
 * difference alone is 17° of orbit a day.
 *
 * Everything is measured against the planet's own equator (its pole is `axis`): the node is
 * where the orbit crosses that equator going north, and the three rates are those of the node
 * along the equator, of the periapsis from the node, and of the mean anomaly.
 *
 * A nearly round orbit has no well-defined periapsis (it jumps about by tens of degrees), so
 * for e ≤ 0.1 the periapsis is left fixed and the rate of periapsis + mean anomaly together, the
 * craft's angle from the node, goes into `m`.
 */
function measuredRates(states, centre, el) {
  const TAU = 2 * Math.PI, gm = BODIES[centre].gm;
  const axis = bodyAxes(centre, el.epochMs).pole;
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  /** The orbit through one state, described against the planet's equator. */
  const describe = (state) => {
    const h = cross(state.pos, state.vel), r = Math.hypot(...state.pos);
    const vxh = cross(state.vel, h);
    const evec = [vxh[0] / gm - state.pos[0] / r, vxh[1] / gm - state.pos[1] / r, vxh[2] / gm - state.pos[2] / r];
    const node = cross(axis, h); // towards the ascending node on the planet's equator
    const quarter = cross(h, node); // a quarter turn further along the orbit
    const here = stateToElements(state.pos, state.vel, gm, state.tMs);
    return {
      e: here.e, m: here.m0,
      // The node's place along the equator: the direction of `node`, measured in the equator's plane from any fixed start.
      nodeAngle: Math.atan2(dot(node, cross(axis, START)), dot(node, START)),
      peri: Math.atan2(dot(evec, quarter) / Math.hypot(...quarter), dot(evec, node) / Math.hypot(...node)),
      tilted: Math.hypot(...node) > 1e-6 * Math.hypot(...h),
    };
  };
  // Any direction square to the pole will do as the place angles along the equator start from.
  const START = (() => { const s = cross(axis, Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]); const n = Math.hypot(...s); return s.map((v) => v / n); })();
  /** The change `delta` of an angle, with whole turns added so it lies nearest to `expected`. */
  const unwrap = (delta, expected) => delta + TAU * Math.round((expected - delta) / TAU);
  const first = describe(states[0]);
  if (!first.tilted) return null; // an orbit lying in the equator has no node to follow
  let rates = null;
  const days = [];
  for (const d of [1, 7]) {
    const state = states.find((s) => Math.abs(s.tMs - el.epochMs - d * DAY) < 1000);
    if (!state) continue;
    const then = describe(state);
    if (!(then.e < 1) || !then.tilted) return null; // it has left, or turned into the equator
    const dt = d * 86400;
    const pace = rates ? rates.m : meanMotion(el.aKm, gm);
    const node = unwrap(then.nodeAngle - first.nodeAngle, rates ? rates.node * dt : 0) / dt;
    if (el.e <= 0.1) rates = { node, peri: 0, m: unwrap(then.peri + then.m - first.peri - first.m, pace * dt) / dt };
    else rates = { node, peri: unwrap(then.peri - first.peri, rates ? rates.peri * dt : 0) / dt, m: unwrap(then.m - first.m, pace * dt) / dt };
    days.push(d);
  }
  // A pace more than 3 % from Kepler's is not a bulge, it is an engine burn in between: do not extrapolate from it.
  if (!rates || Math.abs(rates.m / meanMotion(el.aKm, gm) - 1) > 0.03) return null;
  return { axis, ...rates, days };
}

/** Elements with ten significant figures (a millimetre in an orbit round the Moon, 15 km at Voyager's distance). */
function tidy(el) {
  return { type: 'elements', epochMs: el.epochMs, aKm: sig(el.aKm), e: sig(el.e), incl: sig(el.incl), node: sig(el.node), peri: sig(el.peri), m0: sig(el.m0) };
}

async function allCraft(epoch, reference) {
  const craft = [];
  for (const row of CRAFT) {
    try {
      const { centre, motion } = await placeCraft(row, epoch, reference);
      craft.push({
        id: row.id, name: row.name, short: row.short, aliases: row.aliases, centre, model: row.model, status: row.status,
        agency: row.agency, launched: row.launched, role: row.role, blurb: row.blurb, wiki: row.wiki, dsn: row.dsn, motion,
      });
      const how = motion.type === 'elements' ? `orbit about ${centre} (e ${motion.e.toFixed(3)}${motion.rates ? ', measured rates' : ''})` : motion.type === 'samples' ? `${motion.xyz.length / 3} positions about ${centre}` : `on ${centre} at ${motion.latDeg}°, ${motion.lonDeg}°`;
      console.log(`  ${row.id}: ${how}`);
    } catch (error) {
      console.log(`  ${row.id}: skipped (${error.message})`);
    }
  }
  return craft;
}

// ── moons ───────────────────────────────────────────────────────────────────────────────

async function allMoons(epoch, reference) {
  const moons = {};
  for (const id of MOONS) {
    const parent = BODIES[id].parent;
    try {
      const states = await vectors(CODE[id], CODE[parent], [epoch, epoch + DAY, epoch + 3 * DAY, epoch + 10 * DAY]);
      // Two bodies circling each other: the sum of the masses sets the pace (12 % more than
      // Pluto alone for Charon). ephem.ts keeps its own fitted rates and takes only the shape
      // and phase from this.
      moons[id] = tidy(stateToElements(states[0].pos, states[0].vel, BODIES[parent].gm + BODIES[id].gm, epoch));
      reference[id] = { centre: parent, tMs: states.map((s) => s.tMs), xyz: states.map((s) => s.pos.map((v) => sig(v, 12))) };
    } catch (error) {
      console.log(`  ${id}: skipped (${error.message})`);
    }
  }
  console.log(`  moons: ${Object.keys(moons).length} of ${MOONS.length}`);
  return moons;
}

// ── asteroid fly-bys and fireballs (JPL CNEOS) ──────────────────────────────────────────

/**
 * Diameter in metres from the absolute magnitude H for a given albedo: D = 1329 km × 10^(−H/5) / √albedo.
 * Nobody has measured most of these rocks; bright (0.25) and dark (0.05) surfaces bracket the likely size.
 */
const sizeFromH = (h, albedo) => (1329000 * 10 ** (-h / 5)) / Math.sqrt(albedo);

async function allFlybys(epoch) {
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const reply = await getJson(`${CAD_URL}?dist-max=0.05&date-min=${day(epoch - 7 * DAY)}&date-max=${day(epoch + 60 * DAY)}&sort=date&fullname=true`);
  const col = Object.fromEntries(reply.fields.map((name, i) => [name, i]));
  const flybys = [];
  for (const row of reply.data ?? []) {
    const h = Number(row[col.h]), au = Number(row[col.dist]), speed = Number(row[col.v_rel]), jd = Number(row[col.jd]);
    if (![au, speed, jd].every(Number.isFinite)) continue;
    // "       (2026 WB)" → "2026 WB";  "  99942 Apophis (2004 MN4)" stays as it is.
    const full = String(row[col.fullname] ?? row[col.des]).trim();
    const size = Number.isFinite(h) ? [sizeFromH(h, 0.25), sizeFromH(h, 0.05)].map((m) => sig(m, 2)) : [0, 0];
    flybys.push({
      name: /^\((.+)\)$/.exec(full)?.[1] ?? full,
      des: String(row[col.des]), // dropped before writing: only needed to ask Horizons for the path
      timeMs: Math.round((jd - 2440587.5) * DAY - TT_MINUS_UTC_MS),
      distanceKm: Math.round(au * AU_KM), speedKmS: sig(speed, 4), h: Number.isFinite(h) ? h : 0, sizeM: size,
    });
  }
  console.log(`  fly-bys: ${flybys.length} within 0.05 AU`);

  // The closest few get a real path, so the app can draw them going past.
  const close = flybys.filter((f) => f.distanceKm < PATH_WITHIN_AU * AU_KM).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, PATHS);
  for (const flyby of close) {
    try {
      // Horizons finds an unnumbered asteroid by its designation and a numbered one by its number.
      const rows = await vectors(/^\d+$/.test(flyby.des) ? `${flyby.des};` : `DES=${flyby.des};`, CODE.earth, { startMs: flyby.timeMs - 3 * DAY, stopMs: flyby.timeMs + 3 * DAY, stepMinutes: 30 });
      flyby.motion = { type: 'samples', t0Ms: rows[0].tMs, stepMs: 30 * 60000, xyz: rows.flatMap((r) => roundAll(r.pos)) };
    } catch (error) {
      console.log(`    ${flyby.name}: no path (${error.message})`);
    }
  }
  console.log(`  fly-by paths: ${close.filter((f) => f.motion).length} of the ${close.length} closest`);
  return flybys.map(({ des: _des, ...rest }) => rest);
}

async function allFireballs() {
  // Newest first; a few extra in case some rows cannot be read.
  const reply = await getJson(`${FIREBALL_URL}?limit=${FIREBALLS + 10}&req-loc=true`);
  const col = Object.fromEntries(reply.fields.map((name, i) => [name, i]));
  const number = (value) => (value === null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
  const fireballs = [];
  for (const row of reply.data ?? []) {
    const timeMs = Date.parse(`${String(row[col.date]).replace(' ', 'T')}Z`);
    const lat = number(row[col.lat]), lon = number(row[col.lon]), energy = number(row[col['impact-e']]);
    if (!Number.isFinite(timeMs) || lat === null || lon === null || energy === null) continue;
    fireballs.push({
      timeMs,
      latDeg: row[col['lat-dir']] === 'S' ? -lat : lat,
      lonDeg: row[col['lon-dir']] === 'W' ? -lon : lon,
      altitudeKm: number(row[col.alt]), energyKt: energy, speedKmS: number(row[col.vel]),
    });
    if (fireballs.length === FIREBALLS) break;
  }
  console.log(`  fireballs: ${fireballs.length}`);
  return fireballs;
}

// ── main ────────────────────────────────────────────────────────────────────────────────

async function main() {
  let previous = null;
  if (await exists(OUT)) {
    try { previous = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* unreadable file: replace it */ }
  }
  if (previous && !process.argv.includes('--force')) {
    const ageHours = (Date.now() - Date.parse(previous.fetchedAt)) / 3.6e6;
    if (ageHours < MIN_AGE_HOURS) {
      console.log(`  deep-space data is only ${ageHours.toFixed(1)} h old — not re-downloading (use --force only if you really need to).`);
      return;
    }
  }

  // One instant for everything: every orbit in the file is the orbit AT this moment.
  const epoch = Math.floor(Date.now() / 60000) * 60000;
  const reference = { craft: {}, moons: {} };

  const craft = await allCraft(epoch, reference.craft);
  const placed = craft.filter((c) => c.motion.type !== 'surface').length;
  if (placed === 0) {
    console.error('  Horizons placed no spacecraft at all — keeping the existing file untouched');
    return;
  }
  const moons = await allMoons(epoch, reference.moons);

  // The two lists come from a different service; if it is down, keep what the old file had.
  let flybys = previous?.flybys ?? [], fireballs = previous?.fireballs ?? [];
  try { flybys = await allFlybys(epoch); } catch (error) { console.log(`  fly-bys: not readable (${error.message}); keeping the previous list`); }
  try { fireballs = await allFireballs(); } catch (error) { console.log(`  fireballs: not readable (${error.message}); keeping the previous list`); }

  const fetchedAt = new Date(epoch).toISOString();
  const text = JSON.stringify({ fetchedAt, craft, moons, flybys, fireballs });
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, text);
  await mkdir(dirname(REFERENCE), { recursive: true });
  await writeFile(REFERENCE, JSON.stringify({
    note: 'JPL Horizons positions (km, ICRF, about `centre`) from the same download as public/data/deep.json; written by scripts/fetch-deep.mjs, read by scripts/check-deep.mjs.',
    fetchedAt, ...reference,
  }));
  console.log(`  wrote ${craft.length} of ${CRAFT.length} spacecraft, ${Object.keys(moons).length} moons, ${flybys.length} fly-bys and ${fireballs.length} fireballs to public/data/deep.json (${(text.length / 1024).toFixed(0)} KB)`);
}

console.log('Beyond Earth orbit (JPL Horizons, JPL CNEOS):');
try {
  await main();
} catch (error) {
  // Whatever went wrong, the site must still build with the file it already has.
  console.error(`  unexpected problem (${error.message}) — keeping the existing file untouched`);
}
