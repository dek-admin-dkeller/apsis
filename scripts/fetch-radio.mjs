// scripts/fetch-radio.mjs — `npm run fetch-radio`
//
// Saves what is publicly known about each satellite's RADIO to public/data/radio.json:
// which transmitters it carries, and when a ground station last received it.
//
// Nobody can "ping" a satellite. The nearest public equivalent is SatNOGS (satnogs.org), a
// network of volunteer ground stations: its database lists the transmitters of ~2,800
// satellites, and its network logs every reception attempt with a verdict (good / bad / …).
//
// Why this runs at build time and not in the browser: the SatNOGS APIs answer with JSON but
// without an Access-Control-Allow-Origin header, so a web page is not allowed to read them.
//
// Politeness: at most 22 requests in all, at least 1.5 s apart, never repeated or polled. The
// script refuses to run again while the file is younger than about 6 hours (use --force), every
// request has a timeout, and any failure leaves the existing file untouched and exits 0, so
// a SatNOGS outage can never break a deploy. The site's build runs every 3 hours and this goes
// with every second one: 6 hours is also about how far back one download's reports reach, so
// "last heard" has no gaps.

import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/data/radio.json');
const SNAPSHOT = join(ROOT, 'public/data/satellites.json');

const SATELLITES_URL = 'https://db.satnogs.org/api/satellites/?format=json';
const TRANSMITTERS_URL = 'https://db.satnogs.org/api/transmitters/?format=json';
// The network API's own filter is `status` (failed / bad / unknown / future / good); "good"
// means the satellite's signal was found in the recording. Newest observations come first,
// 25 to a page (the page size is fixed), and the reply's Link header points at the next page.
const OBSERVATIONS_URL = 'https://network.satnogs.org/api/observations/?status=good&format=json';

// "Every second 3-hourly build". Half an hour under 6: that build starts a few minutes short of
// six hours after the last download finished, and a guard of exactly 6 would turn it away
// and leave the records nine hours apart.
const MIN_AGE_HOURS = 5.5;
const MAX_PAGES = 20; // 500 observations: roughly the last 6 to 8 hours of the whole network
const PAUSE_MS = 1500;
const TIMEOUT_MS = 45000;
// Older pages take the server longer and longer to produce. Stop asking after three minutes
// in all, so a slow day costs a shorter look back rather than a long build.
const PAGING_BUDGET_MS = 180000;
const MAX_DESCRIPTION = 90;
// SatNOGS gives a satellite it cannot match to a tracked object yet a made-up number from
// 90000 up. Those are not catalogue numbers (the app's own designed satellite is 99001), so
// they are never used as keys here.
const FIRST_TEMPORARY_ID = 90000;

const exists = (p) => access(p).then(() => true, () => false);
const pause = () => new Promise((resolve) => setTimeout(resolve, PAUSE_MS));

/** One GET with a timeout; returns the parsed JSON array and the address of the next page, if any. */
async function getList(url) {
  const res = await fetch(url, {
    // A generic name: nothing in the request says who or what project is asking.
    headers: { 'User-Agent': 'orbit-viewer radio snapshot (build-time, about 22 requests, never polled)', Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const list = JSON.parse(await res.text()); // throws if an error page came back instead
  if (!Array.isArray(list)) throw new Error('response was not a JSON array');
  const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1] ?? null;
  return { list, next };
}

/** A table of distinct strings: text → small number, so the file stores each word once. */
function wordTable() {
  const index = new Map(); // word → its position in `words`
  const words = [];
  return {
    words,
    of(word) {
      let i = index.get(word);
      if (i === undefined) {
        i = words.length;
        words.push(word);
        index.set(word, i);
      }
      return i;
    },
  };
}

async function main() {
  const force = process.argv.includes('--force');
  if (!force && (await exists(OUT))) {
    try {
      const ageHours = (Date.now() - Date.parse(JSON.parse(await readFile(OUT, 'utf8')).fetchedAt)) / 3.6e6;
      if (ageHours < MIN_AGE_HOURS) {
        console.log(`  radio records are only ${ageHours.toFixed(1)} h old — not re-downloading (use --force only if you really need to).`);
        return;
      }
    } catch { /* unreadable file: replace it */ }
  }

  // Only objects the app can show are kept (as with the catalogue facts): everything else
  // would be dead weight in the download.
  let wanted = null;
  if (await exists(SNAPSHOT)) {
    wanted = new Set(JSON.parse(await readFile(SNAPSHOT, 'utf8')).objects.map((o) => Number(o.NORAD_CAT_ID)));
  } else {
    console.log('  no orbital snapshot yet — keeping every satellite SatNOGS lists');
  }
  const shown = (id) => Number.isInteger(id) && id > 0 && id < FIRST_TEMPORARY_ID && (wanted === null || wanted.has(id));

  // ---- 1. satellites and their transmitters (two requests) --------------------------------
  let satellites, transmitters;
  try {
    satellites = (await getList(SATELLITES_URL)).list;
    console.log(`  satellites: ${satellites.length}`);
    await pause();
    transmitters = (await getList(TRANSMITTERS_URL)).list;
    console.log(`  transmitters: ${transmitters.length}`);
  } catch (error) {
    console.error(`  could not download the SatNOGS database (${error.message}) — keeping the existing file untouched`);
    return;
  }

  // NORAD id (the catalogue number the app knows the object by) → the record being built.
  const records = new Map();
  // SatNOGS's own number for a satellite → the key it is filed under here (they differ for "followed" objects).
  const keyOf = new Map();
  const statuses = wordTable(), modes = wordTable(), services = wordTable();

  // First the satellites SatNOGS has matched to a catalogue number …
  for (const sat of satellites) {
    if (!shown(sat.norad_cat_id) || records.has(sat.norad_cat_id)) continue;
    records.set(sat.norad_cat_id, { status: statuses.of(String(sat.status ?? '')), tx: [], heard: null, names: [], filedId: 0 });
    keyOf.set(sat.norad_cat_id, sat.norad_cat_id);
  }
  // … then those it has NOT matched for certain: it listens for them along the orbit of a
  // tracked object it believes to be the one ("norad_follow_id"). They are filed under that
  // object, with the name SatNOGS uses, so the app can say the match is provisional.
  for (const sat of satellites) {
    const follow = sat.norad_follow_id;
    if (sat.norad_cat_id == null || keyOf.has(sat.norad_cat_id) || !shown(follow) || sat.status === 're-entered') continue;
    let record = records.get(follow);
    if (record && record.names.length === 0) continue; // that object has a confirmed record of its own
    if (!record) {
      record = { status: statuses.of(String(sat.status ?? '')), tx: [], heard: null, names: [], filedId: sat.norad_cat_id };
      records.set(follow, record);
    }
    record.names.push(String(sat.name ?? '').trim() || `SatNOGS ${sat.norad_cat_id}`);
    keyOf.set(sat.norad_cat_id, follow);
  }

  let txCount = 0;
  for (const tx of transmitters) {
    const record = records.get(keyOf.get(tx.norad_cat_id));
    if (!record) continue;
    let description = String(tx.description ?? '').replace(/\s+/g, ' ').trim();
    if (description.length > MAX_DESCRIPTION) description = description.slice(0, MAX_DESCRIPTION - 1).trimEnd() + '…';
    const mode = tx.mode && tx.mode !== 'UNKNOWN' ? String(tx.mode) : '';
    const service = tx.service && tx.service !== 'Unknown' ? String(tx.service) : '';
    const down = Number(tx.downlink_low) || 0;
    const downHigh = Number(tx.downlink_high) || 0;
    record.tx.push([
      description,
      down,
      downHigh !== down ? downHigh : 0, // only a transponder's passband has a second edge
      Number(tx.uplink_low) || 0,
      modes.of(mode),
      Number(tx.baud) || 0,
      (tx.status === 'active' ? 1 : 0) | (tx.unconfirmed ? 2 : 0),
      services.of(service),
      // The last two are dropped below. They are only needed while building: whose transmitter
      // it is (when two satellites share a record) and SatNOGS's id for it (to match observations).
      tx.norad_cat_id,
      String(tx.uuid ?? ''),
    ]);
    txCount++;
  }
  const nameOf = new Map(satellites.map((sat) => [sat.norad_cat_id, String(sat.name ?? '').trim()])); // SatNOGS number → name
  for (const record of records.values()) {
    // Two satellites listened for along the same orbit: say whose transmitter each one is.
    if (record.names.length > 1) {
      for (const tx of record.tx) tx[0] = `${nameOf.get(tx[8]) ?? '?'}: ${tx[0]}`.slice(0, MAX_DESCRIPTION);
    }
    // Active first, then by downlink frequency: the order the app lists them in.
    record.tx.sort((a, b) => (b[6] & 1) - (a[6] & 1) || (a[1] || Infinity) - (b[1] || Infinity) || (a[0] < b[0] ? -1 : 1));
    // Transmitter id → its place in that list, so an observation can say which one was received.
    record.place = new Map(record.tx.map((tx, i) => [tx[9], i]));
    for (const tx of record.tx) tx.length = 8;
  }

  // ---- 2. "last heard": the newest good observation per satellite --------------------------
  //
  // The API can be asked about one satellite at a time (`norad_cat_id=`), but that would be
  // over a thousand requests. Instead the newest observations of the whole network are read
  // page by page, a bounded number of pages, keeping the most recent one per object. The file
  // records how far back that reached, so the app can say "not picked up in the N hours
  // before …" instead of pretending to know about all time.
  const stations = [];
  const stationIndex = new Map(); // SatNOGS station id → position in `stations`
  let url = OBSERVATIONS_URL, pages = 0, good = 0, oldestStart = Infinity, newestEnd = -Infinity;
  const pagingStarted = Date.now();
  while (url && pages < MAX_PAGES && Date.now() - pagingStarted < PAGING_BUDGET_MS) {
    await pause();
    let page;
    try {
      page = await getList(url);
    } catch (error) {
      console.warn(`  observations page ${pages + 1}: ${error.message} — stopping there`);
      break;
    }
    pages++;
    for (const obs of page.list) {
      const start = Date.parse(obs.start), end = Date.parse(obs.end);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      if (start < oldestStart) oldestStart = start;
      // A pass still in progress is reported as "future" even with the filter: skip it, it will be counted next time.
      if (obs.status !== 'good') continue;
      good++;
      if (end > newestEnd) newestEnd = end;
      const record = records.get(keyOf.get(obs.norad_cat_id));
      if (!record || (record.heard && record.heard[1] >= end / 1000)) continue;
      let station = stationIndex.get(obs.ground_station);
      if (station === undefined) {
        station = stations.length;
        stationIndex.set(obs.ground_station, station);
        const lat = Number(obs.station_lat), lon = Number(obs.station_lng);
        const located = Number.isFinite(lat) && Number.isFinite(lon) && obs.station_lat !== null && obs.station_lng !== null;
        // Two decimals (about a kilometre) is plenty to say where in the world a station is.
        stations.push([String(obs.station_name ?? '').trim().slice(0, 60), located ? Math.round(lat * 100) / 100 : null, located ? Math.round(lon * 100) / 100 : null]);
      }
      record.heard = [Number(obs.id) || 0, Math.round(end / 1000), station, record.place.get(String(obs.transmitter_uuid ?? '')) ?? -1];
    }
    // Follow the next-page link only if it really is the same API (it comes from a reply header).
    url = page.next && page.next.startsWith('https://network.satnogs.org/api/observations/') ? page.next : null;
  }
  if (pages === 0) {
    console.error('  could not read any observations — keeping the existing file untouched');
    return;
  }

  const sats = [...records.entries()].sort((a, b) => a[0] - b[0]).map(([id, r]) => {
    const row = [id, r.status, r.tx, r.heard ?? 0];
    if (r.names.length > 0) row.push(r.names.join(' / '), r.filedId);
    return row;
  });
  const heardCount = sats.filter((row) => row[3] !== 0).length;
  const file = {
    fetchedAt: new Date().toISOString(),
    source: 'SatNOGS DB (db.satnogs.org) and SatNOGS Network (network.satnogs.org), a volunteer project of the Libre Space Foundation; data under CC BY-SA',
    // Every good observation that STARTED in this stretch was looked at; nothing earlier was.
    heardFrom: new Date(oldestStart).toISOString(),
    heardTo: new Date(Number.isFinite(newestEnd) ? newestEnd : oldestStart).toISOString(),
    observations: good,
    fields: {
      sats: ['noradId', 'status (index into statuses)', 'transmitters', 'heard or 0', 'name SatNOGS files it under (only when the match is provisional)', 'SatNOGS temporary id (same case)'],
      transmitter: ['description', 'downlinkHz', 'downlinkHighHz or 0', 'uplinkHz or 0', 'mode (index into modes)', 'baud or 0', 'flags: 1 = active, 2 = unconfirmed', 'service (index into services)'],
      heard: ['observationId', 'end of the pass, Unix seconds', 'station (index into stations)', 'which transmitter was received (index into this satellite\'s transmitters, -1 if not listed)'],
      station: ['name', 'latDeg or null', 'lonDeg or null'],
    },
    statuses: statuses.words,
    modes: modes.words,
    services: services.words,
    stations,
    sats,
  };
  await mkdir(dirname(OUT), { recursive: true });
  const text = JSON.stringify(file);
  await writeFile(OUT, text);
  const hours = (Date.now() - oldestStart) / 3.6e6;
  console.log(`  ${pages} page(s) of observations: ${good} good ones reaching back ${hours.toFixed(1)} h, ${heardCount} of our satellites heard`);
  console.log(`  wrote ${sats.length} satellites with ${txCount} transmitters to public/data/radio.json (${(text.length / 1024).toFixed(0)} KB)`);
}

console.log('Radio records (SatNOGS):');
try {
  await main();
} catch (error) {
  // Whatever went wrong, the site must still build with the file it already has.
  console.error(`  unexpected problem (${error.message}) — keeping the existing file untouched`);
}
