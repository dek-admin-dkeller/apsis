// Checks the eclipse and transit predictions in src/space/skyEvents.ts against published tables.
//
//   node scripts/check-sky-events.mjs     exits 1 if any check fails; prints the worst errors
//
// The truth, entered by hand below or kept in scripts/fixtures/, so nothing here needs the network:
//
//   solar eclipses 2023–2032   NASA/GSFC, F. Espenak, "Catalog of Solar Eclipses: 2001 to 2100"
//                              (eclipse.gsfc.nasa.gov/SEcat5/SE2001-2100.html): date, TD of greatest
//                              eclipse, type, gamma, magnitude, latitude and longitude of greatest eclipse
//   lunar eclipses 2023–2032   NASA/GSFC, F. Espenak, "Catalog of Lunar Eclipses: 2001 to 2100"
//                              (eclipse.gsfc.nasa.gov/LEcat5/LE2001-2100.html): date, TD of greatest
//                              eclipse, type, gamma, penumbral and umbral magnitudes, durations of the
//                              penumbral, partial and total phases, where the Moon is overhead
//   transits 2003–2039         NASA/GSFC, F. Espenak, "Seven Century Catalog of Mercury Transits" and
//                              "… of Venus Transits" (eclipse.gsfc.nasa.gov/transit/catalog/): contacts
//                              I and IV and greatest transit (UT, to the minute), least separation
//   Jupiter's moons 2026–2027  IMCCE, "Phenomena of the Galilean satellites" (phenE.2026, phenE.2027),
//                              every shadow and transit ingress and egress: scripts/fixtures/galilean-imcce.json
//
// What is asserted:
//   eclipses     the same eclipses (none missing, none extra), type exact, greatest eclipse within
//                1.5 min, gamma within 0.006 and magnitude within 0.015 (both limited by the Moon's
//                series in ephem.ts: about 25 km of the Moon's place), place of greatest eclipse within 2° (NASA
//                gives it to the whole degree), lunar phase durations within 2 min (except phases
//                less than 0.15 of the Moon's width deep, whose length swings with any small error)
//   transits     the same transits 2000–2045, contacts and greatest within 1.5 min (NASA gives
//                whole minutes), least separation within 2″. (With the old planetary table these
//                were 3 min for Mercury and 6 min for Venus; the planets now come from VSOP87.)
//   Galilean     every IMCCE shadow / transit ingress and egress matched, and nothing extra; Io
//                within 1.5 min, Europa 2, Ganymede and Callisto 3. IMCCE prints whole minutes, and
//                Io's times come out 0.45 min late on average with the spread of a uniform
//                0–1 min error: the table cuts the seconds off. What is left for the outer moons
//                is their fitted orbits (moonOrbits.ts: Ganymede within 0.09°, Callisto 0.02°),
//                which a slow moon turns into minutes. (With the old planetary table Jupiter was
//                0.06° out and Callisto's events were 2.6 min late on average, worst 5.9 min.)
// Also printed: how long skyEvents() takes for the next 60 days (the notification bell's call).

import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eclipses, jupiterEvents, planetTransits, skyEvents } from '../src/space/skyEvents.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
/** Terrestrial (dynamical) time minus UTC: the tables are in TD/TT, the app's clock is UTC. */
const TT_MINUS_UTC_MS = 69184;
const MIN = 60000;

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`);
};
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
/** "2026 Aug 12", "17:47:06" → Unix ms of that clock reading taken as UTC. */
const when = (date, time) => {
  const [y, m, d] = date.split(' ');
  const [hh, mm, ss = 0] = time.split(':').map(Number);
  return Date.UTC(+y, MONTHS[m], +d, hh, mm, ss);
};
const signed = (text) => (text.endsWith('S') || text.endsWith('W') ? -1 : 1) * parseFloat(text);
const wrap180 = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180;
const minutes = (ms) => `${(ms / MIN).toFixed(2)} min`;
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

// ── 1. Solar eclipses ───────────────────────────────────────────────────────────────────

// Espenak, Catalog of Solar Eclipses 2001–2100: date, TD of greatest eclipse, type, gamma, magnitude, lat, long.
const SOLAR = [
  ['2023 Apr 20', '04:17:56', 'H', -0.3952, 1.0132, '10S', '126E'],
  ['2023 Oct 14', '18:00:41', 'A', 0.3753, 0.9520, '11N', '83W'],
  ['2024 Apr 08', '18:18:29', 'T', 0.3431, 1.0566, '25N', '104W'],
  ['2024 Oct 02', '18:46:13', 'A', -0.3509, 0.9326, '22S', '114W'],
  ['2025 Mar 29', '10:48:36', 'P', 1.0405, 0.9376, '61N', '77W'],
  ['2025 Sep 21', '19:43:04', 'P', -1.0651, 0.8550, '61S', '154E'],
  ['2026 Feb 17', '12:13:06', 'A', -0.9743, 0.9630, '65S', '87E'],
  ['2026 Aug 12', '17:47:06', 'T', 0.8977, 1.0386, '65N', '25W'],
  ['2027 Feb 06', '16:00:48', 'A', -0.2952, 0.9281, '31S', '48W'],
  ['2027 Aug 02', '10:07:50', 'T', 0.1421, 1.0790, '26N', '33E'],
  ['2028 Jan 26', '15:08:59', 'A', 0.3901, 0.9208, '3N', '52W'],
  ['2028 Jul 22', '02:56:40', 'T', -0.6056, 1.0560, '16S', '127E'],
  ['2029 Jan 14', '17:13:48', 'P', 1.0553, 0.8714, '64N', '114W'],
  ['2029 Jun 12', '04:06:13', 'P', 1.2943, 0.4576, '67N', '66W'],
  ['2029 Jul 11', '15:37:19', 'P', -1.4191, 0.2303, '64S', '86W'],
  ['2029 Dec 05', '15:03:58', 'P', -1.0609, 0.8911, '68S', '136E'],
  ['2030 Jun 01', '06:29:13', 'A', 0.5626, 0.9443, '57N', '80E'],
  ['2030 Nov 25', '06:51:37', 'T', -0.3867, 1.0468, '44S', '71E'],
  ['2031 May 21', '07:16:04', 'A', -0.1970, 0.9589, '9N', '72E'],
  ['2031 Nov 14', '21:07:31', 'H', 0.3078, 1.0106, '1S', '138W'],
  ['2032 May 09', '13:26:42', 'A', -0.9375, 0.9957, '51S', '7W'],
  ['2032 Nov 03', '05:34:13', 'P', 1.0643, 0.8554, '70N', '133E'],
];

// Espenak, Catalog of Lunar Eclipses 2001–2100: date, TD of greatest eclipse, type (N penumbral,
// P partial, T total), gamma, penumbral and umbral magnitude, durations of the penumbral, partial
// and total phases (minutes; 0 = none), latitude and longitude where the Moon is overhead.
const LUNAR = [
  ['2023 May 05', '17:24:05', 'N', -1.0349, 0.9636, -0.0457, 257.5, 0, 0, '17S', '98E'],
  ['2023 Oct 28', '20:15:18', 'P', 0.9471, 1.1181, 0.1220, 264.6, 77.4, 0, '14N', '52E'],
  ['2024 Mar 25', '07:13:59', 'N', 1.0609, 0.9557, -0.1325, 279.1, 0, 0, '1S', '106W'],
  ['2024 Sep 18', '02:45:25', 'P', -0.9792, 1.0372, 0.0848, 246.3, 62.8, 0, '3S', '42W'],
  ['2025 Mar 14', '06:59:56', 'T', 0.3484, 2.2595, 1.1784, 362.6, 218.3, 65.4, '3N', '102W'],
  ['2025 Sep 07', '18:12:58', 'T', -0.2752, 2.3440, 1.3619, 326.7, 209.4, 82.1, '6S', '87E'],
  ['2026 Mar 03', '11:34:52', 'T', -0.3765, 2.1838, 1.1507, 338.6, 207.2, 58.3, '6N', '171W'],
  ['2026 Aug 28', '04:14:04', 'P', 0.4964, 1.9645, 0.9299, 337.8, 198.1, 0, '9S', '63W'],
  ['2027 Feb 20', '23:14:06', 'N', -1.0480, 0.9266, -0.0569, 241.0, 0, 0, '10N', '15E'],
  ['2027 Jul 18', '16:04:09', 'N', -1.5758, 0.0014, -1.0680, 11.8, 0, 0, '22S', '121E'],
  ['2027 Aug 17', '07:14:59', 'N', 1.2797, 0.5456, -0.5254, 218.6, 0, 0, '12S', '108W'],
  ['2028 Jan 12', '04:14:13', 'P', 0.9817, 1.0468, 0.0662, 250.7, 56.0, 0, '23N', '61W'],
  ['2028 Jul 06', '18:20:57', 'P', -0.7903, 1.4266, 0.3892, 310.6, 141.5, 0, '23S', '86E'],
  ['2028 Dec 31', '16:53:15', 'T', 0.3258, 2.2742, 1.2463, 336.2, 208.8, 71.3, '23N', '108E'],
  ['2029 Jun 26', '03:23:22', 'T', 0.0124, 2.8266, 1.8436, 335.1, 219.5, 101.9, '23S', '50W'],
  ['2029 Dec 20', '22:43:12', 'T', -0.3811, 2.2008, 1.1174, 358.0, 213.3, 53.7, '23N', '19E'],
  ['2030 Jun 15', '18:34:34', 'P', 0.7534, 1.4480, 0.5025, 278.2, 144.4, 0, '23S', '82E'],
  ['2030 Dec 09', '22:28:51', 'N', -1.0731, 0.9416, -0.1628, 279.2, 0, 0, '22N', '21E'],
  ['2031 May 07', '03:52:02', 'N', -1.0694, 0.8814, -0.0904, 237.3, 0, 0, '18S', '59W'],
  ['2031 Jun 05', '11:45:17', 'N', 1.4731, 0.1292, -0.8199, 95.6, 0, 0, '21S', '176W'],
  ['2031 Oct 30', '07:46:45', 'N', 1.1773, 0.7161, -0.3204, 231.8, 0, 0, '15N', '121W'],
  ['2032 Apr 25', '15:14:51', 'T', -0.3558, 2.2192, 1.1913, 342.4, 211.2, 65.5, '14S', '131E'],
  ['2032 Oct 18', '19:03:40', 'T', 0.4169, 2.0830, 1.1028, 315.4, 195.9, 47.1, '10N', '71E'],
];

const SOLAR_TYPE = { T: 'total', A: 'annular', H: 'hybrid', P: 'partial' };
const LUNAR_TYPE = { T: 'total', P: 'partial', N: 'penumbral' };
const FROM = Date.UTC(2023, 0, 1), TO = Date.UTC(2033, 0, 1);
const found = eclipses(FROM, TO);
console.log(`Eclipses ${day(FROM)} … ${day(TO - 1)} against NASA/GSFC (Espenak) catalogues:`);

/** Pair each catalogue row with the computed eclipse of the same kind within a day of it. */
function pair(rows, kind) {
  const mine = found.filter((e) => e.kind === kind);
  const pairs = rows.map((row) => {
    const td = when(row[0], row[1]);
    return { row, td, e: mine.find((e) => Math.abs(e.peakMs + TT_MINUS_UTC_MS - td) < 86400000) };
  });
  const extra = mine.filter((e) => !pairs.some((p) => p.e === e));
  return { pairs, extra };
}

{
  const { pairs, extra } = pair(SOLAR, 'solar-eclipse');
  const missing = pairs.filter((p) => !p.e);
  check(`solar: all ${SOLAR.length} found, none extra`, !missing.length && !extra.length, [...missing.map((p) => `missing ${p.row[0]}`), ...extra.map((e) => `extra ${day(e.peakMs)}`)].join(', '));
  const got = pairs.filter((p) => p.e);
  const wrongType = got.filter((p) => p.e.subtype !== SOLAR_TYPE[p.row[2]]);
  check('solar: type exact (total / annular / hybrid / partial)', !wrongType.length, wrongType.map((p) => `${p.row[0]} ${p.e.subtype} ≠ ${SOLAR_TYPE[p.row[2]]}`).join(', '));
  const worst = (f) => got.reduce((w, p) => { const v = f(p); return v > w.v ? { v, at: p.row[0] } : w; }, { v: 0, at: '' });
  const time = worst((p) => Math.abs(p.e.peakMs + TT_MINUS_UTC_MS - p.td));
  check('solar: greatest eclipse within 1.5 min', time.v < 1.5 * MIN, `worst ${(time.v / 1000).toFixed(0)} s (${time.at})`);
  const mag = worst((p) => Math.abs(p.e.magnitude - p.row[4]));
  const gamma = worst((p) => Math.abs(p.e.gamma - p.row[3]));
  check('solar: magnitude within 0.015, gamma within 0.006', mag.v < 0.015 && gamma.v < 0.006, `worst magnitude ${mag.v.toFixed(4)} (${mag.at}), gamma ${gamma.v.toFixed(4)} (${gamma.at})`);
  const place = worst((p) => Math.max(Math.abs(p.e.latDeg - signed(p.row[5])), Math.abs(wrap180(p.e.lonDeg - signed(p.row[6]))) * Math.cos((p.e.latDeg * Math.PI) / 180)));
  check('solar: place of greatest eclipse within 2° (NASA rounds to 1°)', place.v < 2, `worst ${place.v.toFixed(2)}° (${place.at})`);
}

{
  const { pairs, extra } = pair(LUNAR, 'lunar-eclipse');
  const missing = pairs.filter((p) => !p.e);
  check(`lunar: all ${LUNAR.length} found, none extra`, !missing.length && !extra.length, [...missing.map((p) => `missing ${p.row[0]}`), ...extra.map((e) => `extra ${day(e.peakMs)}`)].join(', '));
  const got = pairs.filter((p) => p.e);
  const wrongType = got.filter((p) => p.e.subtype !== LUNAR_TYPE[p.row[2]]);
  check('lunar: type exact (total / partial / penumbral)', !wrongType.length, wrongType.map((p) => `${p.row[0]} ${p.e.subtype} ≠ ${LUNAR_TYPE[p.row[2]]}`).join(', '));
  const worst = (f) => got.reduce((w, p) => { const v = f(p); return v > w.v ? { v, at: p.row[0] } : w; }, { v: 0, at: '' });
  const time = worst((p) => Math.abs(p.e.peakMs + TT_MINUS_UTC_MS - p.td));
  check('lunar: greatest eclipse within 1.5 min', time.v < 1.5 * MIN, `worst ${(time.v / 1000).toFixed(0)} s (${time.at})`);
  const mag = worst((p) => Math.max(Math.abs(p.e.penumbralMagnitude - p.row[4]), Math.abs(p.e.magnitude - p.row[5])));
  const gamma = worst((p) => Math.abs(p.e.gamma - p.row[3]));
  check('lunar: penumbral and umbral magnitude within 0.015, gamma within 0.006', mag.v < 0.015 && gamma.v < 0.006, `worst magnitude ${mag.v.toFixed(4)} (${mag.at}), gamma ${gamma.v.toFixed(4)} (${gamma.at})`);
  const span = (a, b) => (a === undefined ? 0 : (b - a) / MIN);
  // A phase that only just happens (less than 0.15 of the Moon's width deep) lasts a time that swings with
  // the square root of how deep it goes: 20 km of error in the Moon's place (0.003 Earth radii,
  // what the ephemeris has) moves such a phase's length by minutes. Those are shown, not judged.
  const grazing = (p) => [p.row[4] < 0.15, p.row[5] > 0 && p.row[5] < 0.15, p.row[5] > 1 && p.row[5] < 1.15];
  const phases = (p) => [
    [span(p.e.startMs, p.e.endMs), p.row[6]],
    [span(p.e.partialStartMs, p.e.partialEndMs), p.row[7]],
    [span(p.e.totalStartMs, p.e.totalEndMs), p.row[8]],
  ];
  const dur = worst((p) => Math.max(...phases(p).map(([a, b], i) => (grazing(p)[i] ? 0 : Math.abs(a - b)))));
  const shown = got.flatMap((p) => phases(p).filter((_, i) => grazing(p)[i]).map(([a, b]) => `${p.row[0]} ${a.toFixed(1)} min (NASA ${b})`));
  check('lunar: penumbral, partial and total durations within 2 min', dur.v < 2, `worst ${dur.v.toFixed(2)} min (${dur.at}); grazing, not judged: ${shown.join(', ')}`);
  const place = worst((p) => Math.max(Math.abs(p.e.latDeg - signed(p.row[9])), Math.abs(wrap180(p.e.lonDeg - signed(p.row[10]))) * Math.cos((p.e.latDeg * Math.PI) / 180)));
  check('lunar: point under the Moon within 2° (NASA rounds to 1°)', place.v < 2, `worst ${place.v.toFixed(2)}° (${place.at})`);
}

// ── 2. Transits of Mercury and Venus ────────────────────────────────────────────────────

// Espenak, Seven Century Catalogs of Mercury and Venus transits: contacts I, greatest, IV (UT,
// to the minute; a contact listed past midnight is on the next day) and least separation, arcsec.
const TRANSITS = [
  ['mercury', '2003 May 07', '05:13', '07:52', '10:32', 708.3],
  ['venus', '2004 Jun 08', '05:13', '08:20', '11:26', 626.9],
  ['mercury', '2006 Nov 08', '19:12', '21:41', '00:10', 422.9],
  ['venus', '2012 Jun 05', '22:09', '01:29', '04:49', 554.4],
  ['mercury', '2016 May 09', '11:12', '14:57', '18:42', 318.5],
  ['mercury', '2019 Nov 11', '12:35', '15:20', '18:04', 75.9],
  ['mercury', '2032 Nov 13', '06:41', '08:54', '11:07', 572.1],
  ['mercury', '2039 Nov 07', '07:17', '08:46', '10:15', 822.3],
];

{
  const T0 = Date.UTC(2000, 0, 1), T1 = Date.UTC(2045, 0, 1);
  console.log(`\nTransits of Mercury and Venus ${day(T0)} … ${day(T1)} against NASA/GSFC (Espenak) catalogues:`);
  const mine = planetTransits(T0, T1);
  const rows = TRANSITS.map(([planet, date, i, g, iv, sep]) => {
    const start = when(date, i);
    const next = (hm) => { const t = when(date, hm); return t < start ? t + 86400000 : t; };
    return { planet, date, start, peak: next(g), end: next(iv), sep };
  });
  const pairs = rows.map((r) => ({ r, e: mine.find((e) => e.subject === r.planet && Math.abs(e.peakMs - r.peak) < 86400000) }));
  const extra = mine.filter((e) => !pairs.some((p) => p.e === e));
  check(`all ${TRANSITS.length} transits found, none extra`, pairs.every((p) => p.e) && !extra.length, extra.map((e) => `extra ${e.id}`).join(', '));
  for (const planet of ['mercury', 'venus']) {
    const got = pairs.filter((p) => p.e && p.r.planet === planet);
    let worst = { v: 0, at: '' };
    for (const { r, e } of got) {
      // The catalogue is to the minute: compare with our times rounded the same way.
      for (const [a, b] of [[e.startMs, r.start], [e.peakMs, r.peak], [e.endMs, r.end]]) {
        const v = Math.abs(Math.round(a / MIN) * MIN - b);
        if (v > worst.v) worst = { v, at: r.date };
      }
    }
    const limit = 1.5;
    check(`${planet}: contacts I, IV and greatest within ${limit} min`, worst.v <= limit * MIN, `worst ${minutes(worst.v)} (${worst.at})`);
  }
  const sepWorst = pairs.filter((p) => p.e).reduce((w, { r, e }) => {
    const v = Math.abs(e.separationArcsec - r.sep);
    return v > w.v ? { v, at: r.date } : w;
  }, { v: 0, at: '' });
  check('least separation from the Sun\'s centre within 2″', sepWorst.v < 2, `worst ${sepWorst.v.toFixed(1)}″ (${sepWorst.at})`);
}

// ── 3. Jupiter's moons ──────────────────────────────────────────────────────────────────

{
  const imcce = JSON.parse(readFileSync(join(HERE, 'fixtures/galilean-imcce.json'), 'utf8'));
  const SAT = { I: 'io', II: 'europa', III: 'ganymede', IV: 'callisto' };
  const rows = imcce.events.map((line) => {
    const [stamp, sat, code] = line.split(' ');
    return { tt: Date.parse(`${stamp}:00Z`), moon: SAT[sat], kind: code.startsWith('SH') ? 'shadow-transit' : 'moon-transit', edge: code.endsWith('I') ? 'startMs' : 'endMs', line };
  });
  const T0 = Date.UTC(2026, 0, 1), T1 = Date.UTC(2027, 11, 31);
  const inside = rows.filter((r) => r.tt > T0 && r.tt < T1);
  const mine = jupiterEvents(T0 - 86400000, T1 + 86400000);
  console.log(`\nGalilean shadow transits and transits ${day(T0)} … ${day(T1)} against IMCCE (${inside.length} ingresses and egresses):`);
  const used = new Set();
  const errors = { 'shadow-transit': [], 'moon-transit': [] };
  const unmatched = [];
  for (const r of inside) {
    let best = null, bestErr = Infinity;
    for (const e of mine) {
      if (e.subject !== r.moon || e.kind !== r.kind) continue;
      const err = e[r.edge] + TT_MINUS_UTC_MS - r.tt;
      if (Math.abs(err) < Math.abs(bestErr)) { best = e; bestErr = err; }
    }
    if (!best || Math.abs(bestErr) > 20 * MIN) unmatched.push(r.line);
    else { used.add(best); errors[r.kind].push({ err: bestErr, line: r.line }); }
  }
  // Ours that IMCCE does not list (it skips the weeks when Jupiter is too close to the Sun to observe).
  const extra = mine.filter((e) => !used.has(e) && e.startMs > T0 + 86400000 && e.endMs < T1 - 86400000);
  const quiet = extra.filter((e) => e.detail.includes('too close to the Sun'));
  check('every IMCCE shadow and transit ingress / egress found', unmatched.length === 0, unmatched.slice(0, 6).join('; '));
  check('every event we predict is in IMCCE\'s tables, or Jupiter is too near the Sun to observe', extra.length === quiet.length,
    `${extra.length - quiet.length} unexplained${extra.length > quiet.length ? ` (${extra.filter((e) => !quiet.includes(e)).slice(0, 4).map((e) => e.id).join(', ')})` : ''}, ${quiet.length} near conjunction`);
  // Per moon: the farther out, the slower it moves, so the same small error in where Jupiter
  // is (the planetary table in ephem.ts is good to a few hundredths of a degree for Jupiter)
  // becomes more minutes. IMCCE prints these times to the whole minute.
  const LIMIT = { io: 1.5, europa: 2, ganymede: 3, callisto: 3 };
  const all = [...errors['shadow-transit'].map((x) => ({ ...x, kind: 'shadow' })), ...errors['moon-transit'].map((x) => ({ ...x, kind: 'transit' }))];
  for (const [sat, moon] of Object.entries(SAT)) {
    const list = all.filter((x) => x.line.split(' ')[1] === sat);
    const abs = list.map((x) => Math.abs(x.err)).sort((a, b) => a - b);
    const worst = list.reduce((w, x) => (Math.abs(x.err) > Math.abs(w.err) ? x : w), { err: 0, line: '' });
    const bias = list.reduce((s, x) => s + x.err, 0) / list.length;
    check(`${moon}: shadow and moon transits within ${LIMIT[moon]} min`, Math.abs(worst.err) <= LIMIT[moon] * MIN,
      `${list.length} times, median ${minutes(abs[abs.length >> 1])}, mean ${bias > 0 ? 'late' : 'early'} by ${minutes(Math.abs(bias))}, worst ${minutes(worst.err)} (${worst.line})`);
  }
  for (const kind of ['shadow', 'transit']) {
    const list = all.filter((x) => x.kind === kind);
    const abs = list.map((x) => Math.abs(x.err)).sort((a, b) => a - b);
    console.log(`     ${kind === 'shadow' ? 'shadow transits' : 'moon transits  '}: ${list.length} times, median ${minutes(abs[abs.length >> 1])}, 95 % within ${minutes(abs[Math.floor(abs.length * 0.95)])}`);
  }
}

// ── 4. Cost of the bell's call ──────────────────────────────────────────────────────────

{
  // A fresh copy of the module (the query makes Node load it again), so its caches start empty.
  const fresh = await import(`../src/space/skyEvents.ts?cold=${Date.now()}`);
  const now = Date.UTC(2026, 10, 19, 12);
  let t = performance.now();
  const list = fresh.skyEvents(now, now + 60 * 86400000);
  const cold = performance.now() - t;
  t = performance.now();
  fresh.skyEvents(now + 5 * 60000, now + 5 * 60000 + 60 * 86400000);
  const warm = performance.now() - t;
  // Typically ~13 ms cold. The limit is generous on purpose: a timing on a busy machine (another
  // build, the OS indexing photos) ran to 57 ms and failed the whole check for nothing, and the
  // bell works this out in an idle moment anyway. It still catches a real slowdown.
  check('skyEvents for the next 60 days: first call under 150 ms (typically ~13 ms)', cold < 150, `${cold.toFixed(1)} ms cold, ${warm.toFixed(2)} ms five minutes later; ${list.length} events (${list.filter((e) => e.rare).length} rare)`);
  // The module the checks above used agrees with the fresh copy.
  check('skyEvents is eclipses + transits + Jupiter, sorted', JSON.stringify(skyEvents(now, now + 60 * 86400000)) === JSON.stringify(list));
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall sky-event checks passed');
process.exit(failed ? 1 : 0);
