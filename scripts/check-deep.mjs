// Checks that everything beyond Earth orbit is where, and when, NASA says it is.
//
//   node scripts/check-deep.mjs        exits 1 if any check fails; prints the worst errors
//
// Two sources of truth, both from JPL Horizons, neither needing the network here:
//
//   scripts/fixtures/deep-truth.json      twelve dates in 2024–2030: every planet from the Sun,
//                                         every moon from its planet, and how each body with a
//                                         map is turned (made once by make-deep-fixture.mjs)
//   scripts/fixtures/deep-reference.json  Horizons' positions of the spacecraft and moons in
//                                         public/data/deep.json at LATER moments, from the same
//                                         download (rewritten by fetch-deep.mjs)
//
// What is asserted (the tolerances the project set itself):
//   planets             1900–2100 from the VSOP87 series (planetSeries.ts): Mercury to Saturn within
//                       1″ of direction from the Sun, Uranus and Neptune within 3″, distance within
//                       10 parts per million; the old table's errors are printed beside them
//   Pluto               (and any planet outside 1900–2100) the table: within 0.1°, distance 0.5 %
//   the Moon            within 0.5°
//   other moons         within 2° of direction from their planet: the 34 in the table over all
//                       twelve dates, and again over the ten days after the download
//   rotation            poles within 0.1°, prime meridians within 0.5°, for all 36 bodies
//                       that have a rotation model
//   spacecraft          within 1 % of Horizons' distance at the download moment; sampled paths
//                       within 1,000 km wherever Horizons was asked between two samples
//   fly-by paths        closest point within 3 % of the listed distance and an hour of the listed time
//   meteor showers      the Sun's longitude within 0.05° at two published peak times
//   landing sites       every site's body exists and can be visited, coordinates in range
//   maps                every bundled picture present, 2:1, at its stated width, with its small copy
// Everything else printed (how far orbits drift in a day, a week, a month) is information.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BODIES, BODY_LIST } from '../src/space/bodies.ts';
import { craftPeriodMs, craftPosition, motionPosition } from '../src/space/deep.ts';
import { bodyAxes, bodyPosition, bodyRelative, elementsPosition, hasRotationModel, planetByTable, setMoonElements, stateToElements } from '../src/space/ephem.ts';
import { PLANET_SERIES } from '../src/space/planetSeries.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (path) => JSON.parse(readFileSync(join(HERE, path), 'utf8'));
const DEG = Math.PI / 180;
const C_KM_S = 299792.458;
const MODELS = ['webb', 'voyager', 'pioneer', 'newhorizons', 'juno', 'parker', 'solarorbiter', 'soho', 'l1monitor', 'tess', 'euclid', 'lunarorbiter', 'marsorbiter', 'rover', 'lander', 'clipper', 'lucy', 'psyche', 'bepi', 'samplereturn', 'stereo', 'roadster', 'probe',
  'roman', 'gaia', 'kepler', 'spitzer', 'juice', 'hayabusa2', 'hera', 'mmx', 'dscovr', 'wind', 'imap', 'ulysses', 'dawn', 'cubesat',
  'chandrayaan2', 'danuri', 'odyssey', 'marsexpress', 'tgo', 'hope', 'insight', 'blueghost', 'novac', 'vikram', 'slim', 'zhurong'];

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** Angle between two vectors, degrees (atan2 form: exact for tiny angles too). */
const angle = (a, b) => Math.atan2(norm(cross(a, b)), dot(a, b)) / DEG;
const fromRaDec = (raDeg, decDeg) => [Math.cos(decDeg * DEG) * Math.cos(raDeg * DEG), Math.cos(decDeg * DEG) * Math.sin(raDeg * DEG), Math.sin(decDeg * DEG)];
const wrap180 = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180;
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const km = (v) => `${Math.round(v).toLocaleString('en-US')} km`;

// ── 0. Works with nothing loaded ────────────────────────────────────────────────────────

{
  const t = Date.UTC(2026, 10, 18, 12);
  const broken = [];
  for (const body of BODY_LIST) {
    try {
      const p = bodyPosition(body.id, t), { pole, prime } = bodyAxes(body.id, t);
      const about = body.parent ? bodyRelative(body.id, body.parent, t) : [0, 0, 0];
      const unitOk = Math.abs(norm(pole) - 1) < 1e-9 && Math.abs(norm(prime) - 1) < 1e-9 && Math.abs(dot(pole, prime)) < 1e-9;
      if (![...p, ...about].every(Number.isFinite) || !unitOk) broken.push(body.id);
    } catch (error) {
      broken.push(`${body.id} (${error.message})`);
    }
  }
  check(`all ${BODY_LIST.length} bodies have a position and axes from the built-in orbits alone`, broken.length === 0, broken.join(', '));
  const back = sub(bodyRelative('earth', 'moon', t), bodyRelative('moon', 'earth', t).map((v) => -v));
  const viaSun = sub(bodyRelative('io', 'europa', t), sub(bodyPosition('io', t), bodyPosition('europa', t)));
  check('bodyRelative agrees with itself (reverse, and two moons of one planet)', norm(back) < 1e-6 && norm(viaSun) < 1e-3);
}

// ── 1. Kepler's equation, both kinds of orbit ───────────────────────────────────────────

{
  // Position and velocity → elements → position must come back, including for a hyperbola
  // (Voyager-like) and for a very long ellipse (Parker-like); half a period later an ellipse
  // must be on the far side, one period later back where it started.
  const gm = BODIES.sun.gm;
  const cases = [
    ['a hyperbola', [2.0e10, -1.1e10, 0.9e10], [14.1, -7.3, 6.2]],
    ['a long ellipse', [9.0e6, 2.0e6, -1.0e6], [-20, 160, 12]],
    ['a circle in the reference plane', [1.5e8, 0, 0], [0, Math.sqrt(gm / 1.5e8), 0]],
  ];
  let worst = 0, shapes = [];
  for (const [name, pos, vel] of cases) {
    const el = stateToElements(pos, vel, gm, 0);
    worst = Math.max(worst, norm(sub(elementsPosition(el, gm, 0), pos)) / norm(pos));
    // Half a second either side it must be moving with the velocity (checks the direction of travel).
    const moved = sub(elementsPosition(el, gm, 500), elementsPosition(el, gm, -500));
    worst = Math.max(worst, norm(sub(moved, vel)) / norm(vel));
    if (el.e < 1) {
      const period = craftPeriodMs({ centre: 'sun', motion: el });
      worst = Math.max(worst, norm(sub(elementsPosition(el, gm, period), pos)) / norm(pos));
    }
    shapes.push(`${name} e ${el.e.toFixed(3)}`);
  }
  check('position and velocity → orbit → position round trip', worst < 1e-6, `${shapes.join(', ')}; worst relative error ${worst.toExponential(1)}`);
}

// ── 2. Planets, moons and rotation against the fixture ──────────────────────────────────

const truth = read('fixtures/deep-truth.json');
console.log(`\nAgainst JPL Horizons on ${truth.dates.length} dates, ${day(truth.dates[0])} … ${day(truth.dates.at(-1))} (built-in orbits only):`);

{
  // Each planet's worst error over the twelve dates: now (the VSOP87 series) and with the old
  // table of approximate elements that was the only method before (planetByTable).
  const rows = [];
  for (const [id, list] of Object.entries(truth.planets)) {
    let dir = 0, dist = 0, oldDir = 0, oldDist = 0;
    list.forEach((want, i) => {
      const got = bodyPosition(id, truth.dates[i]), old = planetByTable(id, truth.dates[i]);
      dir = Math.max(dir, angle(got, want) * 3600);
      dist = Math.max(dist, Math.abs(norm(got) / norm(want) - 1) * 1e6);
      oldDir = Math.max(oldDir, angle(old, want) * 3600);
      oldDist = Math.max(oldDist, Math.abs(norm(old) / norm(want) - 1) * 1e6);
    });
    rows.push({ id, dir, dist, oldDir, oldDist });
  }
  const series = rows.filter((r) => PLANET_SERIES[r.id]);
  const inner = series.filter((r) => !['uranus', 'neptune'].includes(r.id)), outer = series.filter((r) => ['uranus', 'neptune'].includes(r.id));
  const worst = (list, key) => list.reduce((a, b) => (b[key] > a[key] ? b : a));
  check('Mercury to Saturn from the Sun: direction within 1″', worst(inner, 'dir').dir < 1, `worst ${worst(inner, 'dir').dir.toFixed(3)}″ (${worst(inner, 'dir').id}); with the old table ${worst(inner, 'oldDir').oldDir.toFixed(0)}″ (${worst(inner, 'oldDir').id})`);
  check('Uranus and Neptune from the Sun: direction within 3″', worst(outer, 'dir').dir < 3, `worst ${worst(outer, 'dir').dir.toFixed(3)}″ (${worst(outer, 'dir').id}); with the old table ${worst(outer, 'oldDir').oldDir.toFixed(0)}″`);
  check('the eight planets from the Sun: distance within 10 ppm', worst(series, 'dist').dist < 10, `worst ${worst(series, 'dist').dist.toFixed(2)} ppm (${worst(series, 'dist').id}); with the old table ${worst(series, 'oldDist').oldDist.toFixed(0)} ppm`);
  const pluto = rows.find((r) => r.id === 'pluto');
  check('Pluto from the Sun (the table): direction within 0.1°, distance 0.5 %', pluto.dir < 360 && pluto.dist < 5000, `${(pluto.dir / 3600).toFixed(4)}°, ${(pluto.dist / 1e4).toFixed(4)} %`);
  console.log(`     worst direction now / with the old table: ${rows.map((r) => `${r.id} ${r.dir.toFixed(2)}″ / ${r.oldDir.toFixed(1)}″`).join(', ')}`);
  // The cost: one planet at a new moment (the answer for the same moment is kept), microseconds.
  const micro = (f) => {
    const t0 = performance.now();
    for (let k = 0; k < 4000; k++) f(Date.UTC(2026, 0, 1) + k * 3600000);
    return (((performance.now() - t0) / 4000) * 1000).toFixed(1);
  };
  for (const r of series) micro((t) => bodyPosition(r.id, t) && planetByTable(r.id, t)); // let the compiler settle first
  const cost = series.map((r) => `${r.id} ${micro((t) => bodyPosition(r.id, t))} (table ${micro((t) => planetByTable(r.id, t))})`);
  console.log(`     cost of one planet at a new moment, µs (the same moment again is kept): ${cost.join(', ')}`);
}

{
  const worstOf = (id) => {
    let worst = 0, worstDist = 0;
    truth.moons[id].xyz.forEach((want, i) => {
      const got = bodyRelative(id, truth.moons[id].centre, truth.dates[i]);
      worst = Math.max(worst, angle(got, want));
      worstDist = Math.max(worstDist, Math.abs(norm(got) / norm(want) - 1) * 100);
    });
    return [worst, worstDist];
  };
  const [moonDir, moonDist] = worstOf('moon');
  check('the Moon from the Earth: within 0.5°', moonDir < 0.5, `worst ${moonDir.toFixed(4)}°, distance ${moonDist.toFixed(4)} %`);
  const others = Object.keys(truth.moons).filter((id) => id !== 'moon').map((id) => [id, ...worstOf(id)]);
  const worst = others.reduce((a, b) => (b[1] > a[1] ? b : a));
  check('the other moons from their planets: within 2°', worst[1] < 2, others.map(([id, a]) => `${id} ${a.toFixed(2)}°`).join(', '));
}

{
  // What an observer at the centre of `from` sees: the middle of the body's disc is the point
  // whose longitude and latitude Horizons printed. Rebuild that point from bodyAxes(), at the
  // moment the light left the body (Jupiter turns 24° while its light crosses to the Earth).
  let worstPole = { v: 0 }, worstPrime = { v: 0 }, worstLat = 0;
  const lines = [], standIns = [];
  for (const [id, rot] of Object.entries(truth.rotation)) {
    let pole = 0, prime = 0, lat = 0;
    for (const row of rot.rows) {
      const toBody = fromRaDec(row.raDeg, row.decDeg);
      const tLeft = row.tMs - (row.rangeKm / C_KM_S) * 1000;
      const axes = bodyAxes(id, tLeft);
      pole = Math.max(pole, angle(axes.pole, fromRaDec(row.poleRaDeg, row.poleDecDeg)));
      const toObserver = toBody.map((v) => -v);
      const east = cross(axes.pole, axes.prime);
      const lonEast = Math.atan2(dot(toObserver, east), dot(toObserver, axes.prime)) / DEG;
      const wantEast = rot.westPositive ? -row.subLonDeg : row.subLonDeg;
      prime = Math.max(prime, Math.abs(wrap180(lonEast - wantEast)));
      // Latitude too, as a guard on the whole construction (Horizons' is measured from the
      // flattened surface's vertical: convert ours the same way).
      const latCentric = Math.asin(dot(toObserver, axes.pole));
      lat = Math.max(lat, Math.abs(Math.atan(Math.tan(latCentric) / (1 - rot.flattening) ** 2) / DEG - row.subLatDeg));
    }
    if (!hasRotationModel(id)) {
      // Janus and Epimetheus: the IAU's models turn at a constant rate; here they stay locked
      // to Saturn through their exchange of orbits, so only the pole is comparable.
      standIns.push(`${id} pole ${pole.toFixed(2)}°`);
      continue;
    }
    // The latitude guard only makes sense on a body that is nearly a sphere: on a lump such as
    // Amalthea (250 x 146 x 128 km) Horizons' "latitude" follows the lump's own surface.
    if (rot.flattening < 0.02) worstLat = Math.max(worstLat, lat);
    lines.push(`${id} ${pole.toFixed(3)}°/${prime.toFixed(3)}°`);
    if (pole > worstPole.v) worstPole = { v: pole, id };
    if (prime > worstPrime.v) worstPrime = { v: prime, id };
  }
  check('rotation: north poles within 0.1°', worstPole.v < 0.1 && worstLat < 0.1, `worst ${worstPole.v.toFixed(4)}° (${worstPole.id}); latitude of the disc's centre within ${worstLat.toFixed(4)}°`);
  check('rotation: prime meridians within 0.5°', worstPrime.v < 0.5, `worst ${worstPrime.v.toFixed(4)}° (${worstPrime.id})`);
  console.log(`     pole / prime meridian: ${lines.join(', ')}`);
  console.log(`     not modelled, so not compared: ${[...standIns, ...(truth.unturned ?? []).map((id) => `${id} (Horizons has no model either)`)].join(', ')}`);
}

// ── 3. The downloaded file against the same download's reference positions ──────────────

const deep = JSON.parse(readFileSync(join(HERE, '../public/data/deep.json'), 'utf8'));
const reference = read('fixtures/deep-reference.json');
const epoch = Date.parse(deep.fetchedAt);
console.log(`\npublic/data/deep.json, downloaded ${deep.fetchedAt}:`);
check('the reference positions are from the same download as deep.json', reference.fetchedAt === deep.fetchedAt, reference.fetchedAt === deep.fetchedAt ? '' : `reference ${reference.fetchedAt}: run "npm run fetch-deep -- --force" and commit both files`);

{
  const problems = [];
  const ids = new Set();
  for (const craft of deep.craft) {
    if (ids.has(craft.id)) problems.push(`${craft.id}: listed twice`);
    ids.add(craft.id);
    if (!MODELS.includes(craft.model)) problems.push(`${craft.id}: unknown model ${craft.model}`);
    if (!BODIES[craft.centre]) problems.push(`${craft.id}: unknown centre ${craft.centre}`);
    if (craft.aliases.some((alias) => alias !== alias.toLowerCase())) problems.push(`${craft.id}: an alias is not lower case`);
    if (!/^\d{4}-\d\d-\d\d$/.test(craft.launched)) problems.push(`${craft.id}: launch date ${craft.launched}`);
    for (const field of ['name', 'short', 'agency', 'role', 'blurb', 'wiki']) if (!craft[field]) problems.push(`${craft.id}: no ${field}`);
    const { pos } = craftPosition(craft, epoch);
    if (!pos.every(Number.isFinite) || norm(pos) < BODIES[craft.centre].radiusKm * 0.99) problems.push(`${craft.id}: not a sane position (${km(norm(pos))} from the centre of ${craft.centre})`);
  }
  check(`${deep.craft.length} spacecraft: fields complete, models known, positions sane`, problems.length === 0, problems.join('; '));
}

{
  // Orbits: exact at the download moment by construction (that tests the whole chain: reading
  // Horizons, building the elements, solving Kepler's equation). Later moments show how long
  // each orbit stays true. Orbiters carry rates measured at +1 and +7 days (marked *), so the
  // honest test of those is the moment in between, +3 days, which the fit never saw.
  let worstNow = { v: 0 }, worstBetween = { v: 0 }, orbiters = 0;
  const drift = [];
  for (const craft of deep.craft) {
    const ref = reference.craft[craft.id];
    if (craft.motion.type !== 'elements' || !ref) continue;
    const fitted = ref.fitted ?? [];
    const errors = ref.tMs.map((t, i) => {
      const got = craftPosition(craft, t).pos, want = ref.xyz[i];
      return { range: Math.abs(norm(got) / norm(want) - 1) * 100, angle: angle(got, want), days: Math.round((t - epoch) / 86400000) };
    });
    if (errors[0].range > worstNow.v) worstNow = { v: errors[0].range, id: craft.id };
    if (errors[0].angle > 0.01) worstNow = { v: 99, id: `${craft.id} direction` };
    const between = errors.find((e) => e.days === 3);
    if (craft.motion.rates && fitted.includes(7) && between) {
      orbiters++;
      if (between.angle > worstBetween.v) worstBetween = { v: between.angle, id: craft.id };
    }
    drift.push(`${craft.id} (${craft.centre}${craft.motion.rates ? ', measured rates' : ''}) ${errors.slice(1).map((e) => `+${e.days} d${fitted.includes(e.days) ? '*' : ''} ${e.range.toFixed(2)} % ${e.angle.toFixed(2)}°`).join(', ') || 'no later positions'}`);
  }
  check('orbiting and cruising craft: within 1 % of Horizons\' distance at the download moment', worstNow.v < 1, `worst ${worstNow.v.toExponential(1)} % (${worstNow.id})`);
  check(`${orbiters} orbiters with measured rates: within 3° of their true place three days after the download`, orbiters > 0 && worstBetween.v < 3, `worst ${worstBetween.v.toFixed(2)}° (${worstBetween.id})`);
  console.log(`     how far each orbit has drifted later (distance, direction from its centre; * = used to measure the rates):\n       ${drift.join('\n       ')}`);
}

{
  let worst = { v: 0 }, count = 0;
  const lines = [], seams = [];
  for (const craft of deep.craft) {
    const ref = reference.craft[craft.id];
    if (craft.motion.type !== 'samples' || !ref) continue;
    const m = craft.motion, n = m.xyz.length / 3, end = m.t0Ms + (n - 1) * m.stepMs;
    // A seam is a jump in Horizons' OWN trajectory, where two of a mission's trajectory files
    // do not quite join. No interpolation can follow a jump, so the moments round one are set
    // aside (and reported). A jump by J between samples i and i+1 adds +J to the bend of the
    // path at i and −J at i+1, on top of the ordinary bend the samples before and after show:
    // so the two excesses are large, equal and opposite. A real path, however sharply it
    // turns, never does that.
    const point = (i) => m.xyz.slice(i * 3, i * 3 + 3);
    const bend = (i) => point(i - 1).map((v, k) => v - 2 * point(i)[k] + point(i + 1)[k]);
    const skipped = new Set();
    for (let i = 2; i + 3 < n; i++) {
      const extraHere = sub(bend(i), bend(i - 1)), extraNext = sub(bend(i + 1), bend(i + 2));
      const together = [extraHere[0] + extraNext[0], extraHere[1] + extraNext[1], extraHere[2] + extraNext[2]];
      if (norm(extraHere) > 1500 && norm(together) < 0.2 * norm(extraHere)) {
        seams.push(`${craft.id}: Horizons' own trajectory jumps ${km(norm(extraHere))} on ${day(m.t0Ms + (i + 0.5) * m.stepMs)}`);
        for (let j = i - 1; j <= i + 1; j++) skipped.add(j);
      }
    }
    let mine = 0, heldInside = false;
    ref.tMs.forEach((t, i) => {
      if (skipped.has(Math.floor((t - m.t0Ms) / m.stepMs))) return;
      const { pos, held } = craftPosition(craft, t);
      if (held) heldInside = true;
      mine = Math.max(mine, norm(sub(pos, ref.xyz[i])));
      count++;
    });
    // Outside the span the nearest end is held.
    const before = craftPosition(craft, m.t0Ms - 5 * 86400000), after = craftPosition(craft, end + 5 * 86400000);
    const holds = before.held && after.held && norm(sub(before.pos, m.xyz.slice(0, 3))) < 1e-6 && norm(sub(after.pos, m.xyz.slice(-3))) < 1e-6 && !craftPosition(craft, epoch).held;
    if (mine > worst.v || !holds || heldInside) worst = { v: !holds || heldInside ? Infinity : mine, id: craft.id };
    lines.push(`${craft.id} ${mine.toFixed(1)} km (to ${day(end)})`);
  }
  check(`sampled paths: within 1,000 km at ${count} moments between samples, ends held`, worst.v < 1000, `worst ${worst.v.toFixed(1)} km (${worst.id})`);
  console.log(`     ${lines.join(', ')}`);
  for (const seam of seams) console.log(`     not counted: ${seam} (two trajectory files that do not join); the three intervals round it are skipped`);
}

{
  // Curiosity is the one craft on the ground that Horizons can place. Its position in space,
  // turned into a latitude and longitude with OUR rotation model of Mars, must come out in
  // Gale crater: a wrong prime meridian or a clock off by four minutes would move it a degree.
  const ref = reference.craft.curiosity, craft = deep.craft.find((c) => c.id === 'curiosity');
  if (ref && craft) {
    const { pole, prime } = bodyAxes('mars', ref.tMs[0]);
    const p = ref.xyz[0], east = cross(pole, prime);
    const lat = Math.asin(dot(p, pole) / norm(p)) / DEG, lon = Math.atan2(dot(p, east), dot(p, prime)) / DEG;
    const off = Math.hypot(lat - ref.site[0], wrap180(lon - ref.site[1]) * Math.cos(lat * DEG));
    const back = norm(sub(craftPosition(craft, ref.tMs[0]).pos, p));
    check('Curiosity, placed by Horizons and our rotation of Mars, is in Gale crater', off < 0.5 && back < 25, `${lat.toFixed(3)}°, ${lon.toFixed(3)}° E: ${(off * 59.2).toFixed(0)} km from its landing site; surface point ${back.toFixed(1)} km from Horizons' position`);
  } else {
    console.log('     (Curiosity has no Horizons position in this download: rotation of Mars not cross-checked this way)');
  }
}

{
  // The moons again, on the download day and the ten days after it: a second, independent set
  // of Horizons positions. First as the app places them (the table, since the download falls
  // inside the years it was fitted to), then with the downloaded ellipses forced on, which is
  // the path a download made after 2056 would take.
  const run = () => {
    const lines = [];
    let worst = { v: 0 };
    for (const [id, ref] of Object.entries(reference.moons)) {
      let mine = 0;
      ref.tMs.forEach((t, i) => { mine = Math.max(mine, angle(bodyRelative(id, ref.centre, t), ref.xyz[i])); });
      lines.push(`${id} ${mine.toFixed(2)}°`);
      if (mine > worst.v) worst = { v: mine, id };
    }
    return { lines, worst };
  };
  setMoonElements(deep.moons);
  const table = run();
  setMoonElements(deep.moons, true);
  const forced = run();
  setMoonElements(null);
  const everyMoon = BODY_LIST.filter((body) => body.kind === 'moon').every((body) => deep.moons[body.id] && reference.moons[body.id]);
  check(`${table.lines.length} moons on the download day and the ten days after: within 2°`, table.worst.v < 2 && everyMoon, `worst ${table.worst.v.toFixed(3)}° (${table.worst.id})`);
  console.log(`     ${table.lines.join(', ')}`);
  check('the same with the downloaded ellipses forced on (the path taken outside 1996–2056): within 2°', forced.worst.v < 2, `worst ${forced.worst.v.toFixed(3)}° (${forced.worst.id})`);
  console.log(`     ${forced.lines.join(', ')}`);
}

{
  const withPath = deep.flybys.filter((f) => f.motion);
  let worstDist = { v: 0 }, worstTime = { v: 0 };
  for (const flyby of withPath) {
    // Closest point of the interpolated path, searched every 20 s round the listed time.
    let best = Infinity, when = 0;
    for (let t = flyby.timeMs - 3 * 3600000; t <= flyby.timeMs + 3 * 3600000; t += 20000) {
      const r = norm(motionPosition(flyby.motion, 'earth', t).pos);
      if (r < best) { best = r; when = t; }
    }
    const d = Math.abs(best / flyby.distanceKm - 1) * 100, minutes = Math.abs(when - flyby.timeMs) / 60000;
    if (d > worstDist.v) worstDist = { v: d, id: flyby.name };
    if (minutes > worstTime.v) worstTime = { v: minutes, id: flyby.name };
  }
  const sane = deep.flybys.every((f) => f.distanceKm > 6371 && f.speedKmS > 0 && Number.isFinite(f.timeMs) && f.sizeM[0] <= f.sizeM[1]);
  check(`${deep.flybys.length} asteroid fly-bys listed, ${withPath.length} with a path: closest point within 3 % and an hour of the listing`, sane && worstDist.v < 3 && worstTime.v < 60,
    withPath.length ? `worst ${worstDist.v.toFixed(2)} % (${worstDist.id}), ${worstTime.v.toFixed(1)} min (${worstTime.id})` : 'no fly-by within 0.02 AU in this download');
  const balls = deep.fireballs;
  check(`${balls.length} fireballs: places and energies sane, newest first`, balls.every((b, i) => Math.abs(b.latDeg) <= 90 && Math.abs(b.lonDeg) <= 180 && b.energyKt > 0 && (i === 0 || b.timeMs <= balls[i - 1].timeMs)));
}

{
  // Every code a craft says the Deep Space Network knows it by must have a readable name.
  const { dsnKnown, dsnName } = await import('../src/space/dsn.ts');
  const nameless = deep.craft.flatMap((craft) => craft.dsn.filter((code) => !dsnKnown(code)).map((code) => `${craft.id}: ${code}`));
  check('every Deep Space Network code in deep.json has a readable name', nameless.length === 0 && dsnName('vgr1') === 'Voyager 1' && dsnName('ZZZ9') === 'ZZZ9', nameless.join(', '));
}

// ── 4. Meteor showers ───────────────────────────────────────────────────────────────────

{
  const { SHOWERS, activeShowers, nextShowers, showerPeak, solarLongitude } = await import('../src/space/showers.ts');
  // Two anchors from the International Meteor Organization's 2025 calendar: the Perseids' peak
  // (Sun at 140.0°) was given as 12 August 20h UT, the Geminids' (262.2°) as 14 December 08h UT.
  const anchors = [['2025-08-12T20:00:00Z', 140.0], ['2025-12-14T08:00:00Z', 262.2]];
  const off = Math.max(...anchors.map(([iso, lon]) => Math.abs(solarLongitude(Date.parse(iso)) - lon)));
  // Each peak must land within a day and a half of its usual calendar date, in any year.
  let slip = 0;
  for (const shower of SHOWERS) for (const year of [2024, 2026, 2030]) slip = Math.max(slip, Math.abs(showerPeak(shower, year) - Date.UTC(year, shower.peak[0] - 1, shower.peak[1], 12)) / 86400000);
  check('meteor showers: the Sun\'s longitude matches the published peaks, and every peak falls on its usual date', off < 0.05 && slip < 1.5, `Sun's longitude within ${off.toFixed(3)}° at two published peaks; peaks within ${slip.toFixed(2)} days of their calendar dates`);
  const names = (list) => list.map((time) => time.shower.code).join(' ');
  const november = Date.parse('2026-11-19T06:00:00Z'), january = Date.parse('2027-01-05T00:00:00Z');
  check('meteor showers: active and next, across the turn of the year',
    names(activeShowers(november)) === 'LEO NTA STA' && names(nextShowers(november, 3)) === 'GEM URS QUA' && names(activeShowers(january)) === 'QUA' && names(activeShowers(Date.parse('2026-06-15T00:00:00Z'))) === '',
    `19 Nov 2026: ${names(activeShowers(november))} active, then ${names(nextShowers(november, 3))}; 5 Jan 2027: ${names(activeShowers(january))}`);
}

// ── 5. Landing sites ────────────────────────────────────────────────────────────────────

{
  const { SITES } = await import('../src/space/sites.ts');
  const { isModelKind } = await import('../src/data/describe.ts'); // a site may stand any 3D model there is
  const problems = [];
  const ids = new Set();
  // The thirteen that went live first: share links name them, so they must stay.
  const FIRST = ['apollo-11', 'apollo-12', 'apollo-14', 'apollo-15', 'apollo-16', 'apollo-17', 'viking-1', 'viking-2', 'pathfinder', 'spirit', 'opportunity', 'phoenix', 'huygens'];
  const standing = deep.craft.filter((craft) => craft.motion.type === 'surface');
  for (const site of SITES) {
    if (ids.has(site.id)) problems.push(`${site.id}: listed twice`);
    ids.add(site.id);
    const body = BODIES[site.body];
    if (!body) { problems.push(`${site.id}: no such body as ${site.body}`); continue; }
    if (!body.visitable) problems.push(`${site.id}: ${site.body} cannot be visited`);
    if (!(Math.abs(site.latDeg) <= 90) || !(site.lonDeg >= -180 && site.lonDeg <= 180)) problems.push(`${site.id}: coordinates out of range (${site.latDeg}, ${site.lonDeg})`);
    const landed = Date.parse(`${site.date}T00:00:00Z`);
    if (!/^\d{4}-\d\d-\d\d$/.test(site.date) || !(landed > Date.UTC(1959, 0, 1) && landed < Date.now())) problems.push(`${site.id}: date ${site.date}`);
    if (!['crewed', 'lander', 'rover', 'probe'].includes(site.kind) || !isModelKind(site.model)) problems.push(`${site.id}: kind or model`);
    for (const field of ['name', 'agency', 'blurb', 'wiki']) if (!site[field]) problems.push(`${site.id}: no ${field}`);
    // Not a craft the data file already stands on the ground: by name, and by place (within 20 km).
    if (deep.craft.some((craft) => craft.id === site.id)) problems.push(`${site.id}: also a craft in deep.json`);
    for (const craft of standing) {
      if (craft.centre !== site.body) continue;
      const apart = Math.hypot(craft.motion.latDeg - site.latDeg, wrap180(craft.motion.lonDeg - site.lonDeg) * Math.cos(site.latDeg * DEG)) * DEG * body.radiusKm;
      if (apart < 20) problems.push(`${site.id}: ${apart.toFixed(0)} km from ${craft.id}, which deep.json already places`);
    }
  }
  for (const id of FIRST) if (!ids.has(id)) problems.push(`${id}: missing (share links use it)`);
  const perBody = [...new Set(SITES.map((site) => site.body))].map((body) => `${SITES.filter((site) => site.body === body).length} on ${BODIES[body].name}`);
  check(`${SITES.length} landing sites: bodies exist, coordinates in range, none repeats a craft in deep.json`, problems.length === 0, problems.join('; ') || perBody.join(', '));
}

// ── 6. The maps ─────────────────────────────────────────────────────────────────────────

{
  // Width and height straight from the file: a JPEG states them after its SOF marker
  // (FF C0 … FF CF, except C4, C8 and CC), a PNG in its first chunk.
  const sizeOf = (bytes) => {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
    for (let i = 2; i + 9 < bytes.length;) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return [bytes.readUInt16BE(i + 7), bytes.readUInt16BE(i + 5)];
      i += 2 + bytes.readUInt16BE(i + 2);
    }
    return null;
  };
  const { IMAGERY, IMAGE_CREDITS } = await import('../src/space/imagery.ts');
  const problems = [];
  let files = 0, total = 0;
  const look = (id, path, width) => {
    let bytes;
    try { bytes = readFileSync(join(HERE, '../public', path)); } catch { problems.push(`${id}: ${path} is missing`); return; }
    files++;
    if (path.startsWith('textures/space/')) total += bytes.length;
    const size = sizeOf(bytes);
    if (!size) problems.push(`${id}: ${path} is not a readable picture`);
    else if (width !== null && (size[0] !== width || size[1] * 2 !== size[0])) problems.push(`${id}: ${path} is ${size[0]} × ${size[1]}, not ${width} × ${width / 2}`);
  };
  const HALF_WIDTH = ['enceladus', 'phoebe', 'miranda', 'ariel', 'umbriel', 'titania', 'oberon']; // sources no finer than 1024 px
  let smalls = 0;
  /** The 256 px copy the solar-system view draws from: <name>_s.jpg beside the map. */
  const lookSmall = (id, path) => {
    const copy = path.replace(/(_m)?\.(jpg|png)$/, '_s.jpg'); // a "_m" copy (the Earth's 2048 map) shares the full map's
    try {
      const size = sizeOf(readFileSync(join(HERE, '../public', copy)));
      if (!size || size[0] !== 256 || size[1] !== 128) problems.push(`${id}: ${copy} is not 256 × 128`);
      else smalls++;
    } catch { problems.push(`${id}: ${copy} is missing`); }
  };
  for (const body of BODY_LIST) {
    const im = IMAGERY[body.id];
    if (!im) { if (body.visitable) problems.push(`${body.id}: a place to visit with no map`); continue; }
    if (!body.visitable) problems.push(`${body.id}: has a map but cannot be visited`);
    look(body.id, im.base, im.base.startsWith('textures/space/') ? (HALF_WIDTH.includes(body.id) ? 1024 : 2048) : null);
    lookSmall(body.id, im.base);
    if (im.baseHigh) look(body.id, im.baseHigh, 4096);
    if (im.clouds) { look(body.id, im.clouds, 2048); lookSmall(body.id, im.clouds); }
    if (im.ring) { look(body.id, im.ring.strip, null); if (!(im.ring.innerKm > body.radiusKm && im.ring.outerKm > im.ring.innerKm)) problems.push(`${body.id}: ring radii`); }
    if (im.tiles && !(/^https:\/\/trek\.nasa\.gov\/tiles\/.+\{z\}\/\{y\}\/\{x\}\.(jpg|png)$/.test(im.tiles.url) && im.tiles.maxZoom >= 3)) problems.push(`${body.id}: tile address`);
    if (!im.credit) problems.push(`${body.id}: no credit`);
  }
  if (IMAGE_CREDITS.some((c) => !c.body || !c.source || !c.licence || !/^https:\/\//.test(c.url))) problems.push('an incomplete credit line');
  check(`maps: ${files} pictures present, each 2:1 at its stated width, with ${smalls} small copies; a body can be visited exactly when it has a map`, problems.length === 0 && total < 16 * 1048576, problems.join('; ') || `${(total / 1048576).toFixed(1)} MB of maps in public/textures/space, ${IMAGE_CREDITS.length} credit lines`);
}

console.log(failed ? `\n${failed} failed` : '\nAll deep-space checks passed.');
process.exit(failed ? 1 : 0);
