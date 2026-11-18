// scripts/test-command.mjs — `node scripts/test-command.mjs`
//
// Checks the command bar's grammar (src/features/commandParse.ts) and its list of places
// (src/data/places.ts) without a browser. Every case is a typed phrase and the exact moment or
// speed it must turn into; phrases that must NOT be understood are tested just as strictly,
// because a wrong guess would move the visitor's clock. Exits 1 on any failure.
// Node 22.18+ imports the project's TypeScript files directly (built-in type stripping).

import { matchScore, normalize, parseSpeed, parseTime } from '../src/features/commandParse.ts';
import { PLACES } from '../src/data/places.ts';

let failed = 0, passed = 0;
const pad = (text, width) => String(text).padEnd(width);
function check(group, label, got, want) {
  const ok = got === want;
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${pad(group, 9)} ${pad(JSON.stringify(label), 34)} → ${got}${ok ? '' : `   (expected ${want})`}`);
}

// ---- three clocks to read the phrases on ---------------------------------------------------
const UTC = () => 0;
const FIXED_MINUS_5 = () => -5 * 3600000; // a zone five hours behind UTC all year
// A zone with daylight saving, written out so the test does not depend on this machine's own
// zone: UTC−4 until 06:00 UTC on 1 Nov 2026, UTC−5 after it (the US east coast's rule that year).
const DST_END = Date.UTC(2026, 10, 1, 6);
const EASTERN = (utcMs) => (utcMs < DST_END ? -4 : -5) * 3600000;

const NOW = Date.UTC(2026, 10, 18, 15, 30, 0); // Wed 18 Nov 2026, 15:30:00 UTC
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');

function time(label, phrase, want, { now = NOW, sim = now, shift = UTC } = {}) {
  const parsed = parseTime(phrase, { nowMs: now, simMs: sim, shiftMs: shift });
  const got = parsed === null ? 'not a time' : parsed.now ? 'NOW' : iso(parsed.ms);
  check(label, phrase, got, want);
}

console.log(`\nTimes. The real present is ${iso(NOW)}; the simulation clock shows the same unless a case says otherwise.\n`);

// the phrases named in the brief
time('utc', 'now', 'NOW');
time('utc', 'tomorrow 9 pm', '2026-11-19T21:00:00Z');
time('utc', 'in 2 hours', '2026-11-18T17:30:00Z');
time('utc', '+90m', '2026-11-18T17:00:00Z');
time('utc', '-1d', '2026-11-17T15:30:00Z');
time('utc', '2026-12-01 14:00', '2026-12-01T14:00:00Z');
time('utc', 'midnight', '2026-11-19T00:00:00Z');

// offsets
time('offset', 'in 90 minutes', '2026-11-18T17:00:00Z');
time('offset', 'in an hour', '2026-11-18T16:30:00Z');
time('offset', 'in 1 hour and 30 minutes', '2026-11-18T17:00:00Z');
time('offset', '+1h30m', '2026-11-18T17:00:00Z');
time('offset', '+ 1.5 h', '2026-11-18T17:00:00Z');
time('offset', '−2h', '2026-11-18T13:30:00Z'); // a typographic minus
time('offset', '3 days ago', '2026-11-15T15:30:00Z');
time('offset', '2 weeks later', '2026-12-02T15:30:00Z');
time('offset', '+45s', '2026-11-18T15:30:45Z');
time('offset', '+90m', '2026-12-01T15:30:00Z', { sim: Date.UTC(2026, 11, 1, 14) }); // counted from the simulation clock

// named days
time('day', 'tomorrow', '2026-11-19T15:30:00Z');
time('day', 'yesterday', '2026-11-17T15:30:00Z');
time('day', 'today 6am', '2026-11-18T06:00:00Z');
time('day', 'tomorrow at 9:15 pm', '2026-11-19T21:15:00Z');
time('day', 'yesterday noon', '2026-11-17T12:00:00Z');
time('day', 'tomorrow midnight', '2026-11-19T00:00:00Z');
time('day', 'tomorrow 21:00', '2026-11-19T21:00:00Z');
time('day', 'tomorrow', '2026-12-01T09:00:00Z', { now: Date.UTC(2026, 10, 30, 9) }); // over the end of a month

// written dates
time('date', '2026-12-01', '2026-12-01T00:00:00Z');
time('date', '2026-12-01T14:00', '2026-12-01T14:00:00Z');
time('date', '2026-12-01T14:00Z', '2026-12-01T14:00:00Z');
time('date', '2026-12-01 14:00:30', '2026-12-01T14:00:30Z');
time('date', '2026/12/01 2pm', '2026-12-01T14:00:00Z');
time('date', '1 dec', '2026-12-01T00:00:00Z');
time('date', 'dec 1 14:00', '2026-12-01T14:00:00Z');
time('date', '1 December 2027 9 pm', '2027-12-01T21:00:00Z');
time('date', 'jan 3rd', '2026-01-03T00:00:00Z');
time('date', '29 feb 2028', '2028-02-29T00:00:00Z');

// a clock time alone: the next time the simulation clock reads it
time('clock', '9 pm', '2026-11-18T21:00:00Z');
time('clock', '9 am', '2026-11-19T09:00:00Z'); // already past today
time('clock', '15:30', '2026-11-18T15:30:00Z'); // exactly now counts as "next"
time('clock', '21:00', '2026-12-01T21:00:00Z', { sim: Date.UTC(2026, 11, 1, 14) }); // the simulated day, not the real one
time('clock', 'noon', '2026-11-19T12:00:00Z');
time('clock', '12 am', '2026-11-19T00:00:00Z');
time('clock', '12 pm', '2026-11-19T12:00:00Z');
time('clock', '9:30 p.m.', '2026-11-18T21:30:00Z');

// the words people put in front
time('lead', 'set the clock to tomorrow 9 pm', '2026-11-19T21:00:00Z');
time('lead', 'jump to 2026-12-01 14:00', '2026-12-01T14:00:00Z');
time('lead', 'at 21:00', '2026-11-18T21:00:00Z');
time('lead', 'time +90m', '2026-11-18T17:00:00Z');
time('lead', 'Tomorrow 9 PM', '2026-11-19T21:00:00Z');

// a local clock five hours behind UTC: it is 10:30 on 18 Nov there
time('local', 'tomorrow 9 pm', '2026-11-20T02:00:00Z', { shift: FIXED_MINUS_5 });
time('local', 'midnight', '2026-11-19T05:00:00Z', { shift: FIXED_MINUS_5 });
time('local', '2026-12-01 14:00', '2026-12-01T19:00:00Z', { shift: FIXED_MINUS_5 });
time('local', '9 am', '2026-11-19T14:00:00Z', { shift: FIXED_MINUS_5 }); // 09:00 local has passed (it is 10:30)
time('local', '11 am', '2026-11-18T16:00:00Z', { shift: FIXED_MINUS_5 });
time('local', 'tomorrow 9 pm utc', '2026-11-19T21:00:00Z', { shift: FIXED_MINUS_5 }); // "utc" overrides the setting
time('local', 'today', '2026-11-18T15:30:00Z', { shift: FIXED_MINUS_5 });
time('local', '+90m', '2026-11-18T17:00:00Z', { shift: FIXED_MINUS_5 }); // offsets do not depend on the zone
// just after midnight UTC it is still the evening before on the local clock
time('local', 'tomorrow 9 pm', '2026-11-19T02:00:00Z', { shift: FIXED_MINUS_5, now: Date.UTC(2026, 10, 18, 1) });

// across the end of daylight saving: it is Sat 31 Oct 2026, 15:00 local (UTC−4); clocks go back that night
const BEFORE = Date.UTC(2026, 9, 31, 19);
time('dst', 'tomorrow 9 pm', '2026-11-02T02:00:00Z', { shift: EASTERN, now: BEFORE }); // 21:00 at UTC−5
time('dst', 'today 9 pm', '2026-11-01T01:00:00Z', { shift: EASTERN, now: BEFORE }); // 21:00 at UTC−4
time('dst', 'tomorrow', '2026-11-01T20:00:00Z', { shift: EASTERN, now: BEFORE }); // the same wall time, 25 hours on
time('dst', '2026-07-04 12:00', '2026-07-04T16:00:00Z', { shift: EASTERN }); // a summer date typed in winter
time('dst', 'midnight', '2026-11-01T04:00:00Z', { shift: EASTERN, now: BEFORE });

// must not be read as times
for (const phrase of ['', '9', '25544', 'tomorrow 9', 'tomorrow 25:00', '13 pm', '0 am', '9:60', '2026-13-01', '31 feb', '1950-01-01',
  'in 5', 'in five minutes', '+90', '+90x', '100x', 'tokyo', 'today tokyo', 'iss', 'utc', 'starlink 1234', 'dec 2026', 'march', '2026', 'to', 'at']) {
  time('refuse', phrase, 'not a time');
}

// ---- speeds ---------------------------------------------------------------------------------
console.log('\nSpeeds.\n');
function speed(phrase, want) {
  const parsed = parseSpeed(phrase);
  const got = parsed === null ? 'not a speed' : parsed.kind === 'set' ? `${parsed.speed}x${parsed.clamped ? ' (clamped)' : ''}` : parsed.kind;
  check('speed', phrase, got, want);
}
speed('100x', '100x');
speed('speed 10', '10x');
speed('pause', 'pause');
speed('real time', '1x');
speed('x10', '10x');
speed('10 x', '10x');
speed('1000×', '1000x');
speed('0.5x', '0.5x');
speed('-10x', '-10x');
speed('set speed to 100', '100x');
speed('speed 100x', '100x');
speed('50 times', '50x');
speed('5000x', '1000x (clamped)');
speed('-99999x', '-1000x (clamped)');
speed('0x', 'pause');
speed('stop', 'pause');
speed('play', 'resume');
speed('resume', 'resume');
speed('realtime', '1x');
speed('normal speed', '1x');
speed('backwards', 'reverse');
speed('reverse', 'reverse');
for (const phrase of ['', '100', '25544', '+90m', '-1d', 'speed', 'x', 'fast', '10 km', 'tomorrow 9 pm']) speed(phrase, 'not a speed');

// ---- matching -------------------------------------------------------------------------------
console.log('\nMatching (higher is a better fit, 0 is none).\n');
const score = (query, phrase, want) => check('match', `${query} ~ ${phrase}`, matchScore(normalize(query), normalize(phrase)), want);
score('Monitor', 'monitor', 100);
score('mon', 'monitor', 80);
score('colour by', 'colour by altitude', 85);
score('col alt', 'colour by altitude', 60);
score('altitude', 'colour by altitude', 50);
score('titu', 'colour by altitude', 25);
score('sao paulo', 'São Paulo', 100);
score('washington dc', 'Washington, D.C.', 100);
score('day night', 'Day / night line', 85);
score('xyz', 'monitor', 0);
score('monitor on', 'monitor', 0);
const order = ['monitor', 'mon', 'col alt', 'altitude', 'titu'].map((q) => matchScore(q, q === 'monitor' || q === 'mon' ? 'monitor' : 'colour by altitude'));
check('match', 'exact > prefix > words > loose', String(order.every((s, i) => i === 0 || s < order[i - 1])), 'true');

// ---- the places list ------------------------------------------------------------------------
console.log('\nPlaces.\n');
const names = new Map(); // normalised name or other name → the place that owns it (a hash table, to catch duplicates)
let clashes = 0, outOfRange = 0;
for (const place of PLACES) {
  if (!(place.lat >= -90 && place.lat <= 90 && place.lon >= -180 && place.lon <= 180)) outOfRange++;
  const key = normalize(place.name);
  if (names.has(key)) {
    clashes++;
    console.log(`     "${place.name}" is listed twice`);
  }
  names.set(key, place);
}
check('places', 'how many', String(PLACES.length >= 200 && PLACES.length <= 300), 'true');
check('places', 'coordinates in range', outOfRange, 0);
check('places', 'names listed twice', clashes, 0);
const spot = (name, lat, lon) => {
  const place = names.get(normalize(name));
  check('places', name, place ? `${place.lat}, ${place.lon}` : 'missing', `${lat}, ${lon}`);
};
spot('Tokyo', 35.68, 139.69);
spot('Cairo', 30.04, 31.24);
spot('São Paulo', -23.55, -46.63);
spot('Sydney', -33.87, 151.21);
spot('Baikonur', 45.96, 63.31);
spot('Cape Canaveral', 28.49, -80.58);
console.log(`     ${PLACES.length} places in the list`);

console.log(`\n${passed} passed, ${failed} failed.\n`);
process.exit(failed ? 1 : 0);
