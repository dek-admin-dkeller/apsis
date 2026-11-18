// scripts/fetch-data.mjs — `npm run fetch-data`
//
// Downloads the orbital-element snapshot (CelesTrak GP data, OMM/JSON format) and the
// Earth textures ONCE and stores them in public/, so the demo runs fully offline.
//
// Politeness: CelesTrak only refreshes its data every ~2 hours and asks clients not to
// re-download more often than that. This script refuses to re-download a snapshot that
// is younger than 2 hours (use --force to override) and the app itself never polls.
//
// After a successful download it also compares the new elements with the ones it replaces
// and writes public/data/changes.json (the "Orbit changes" list; see diff-elements.mjs).
// --previous=<file> compares against that snapshot instead of the one on disk: the deploy
// workflow passes the elements of the site as published, because the copy in the repository
// is weeks old. If that file cannot be read there is no comparison, and no changes file.

import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSnapshot, writeChanges } from './diff-elements.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = join(ROOT, 'public/data/satellites.json');
const TEXTURE_DIR = join(ROOT, 'public/textures');

// "active" = every active payload. The debris groups are the clouds left behind by the
// 2009 Iridium 33 / Cosmos 2251 collision and by two anti-satellite weapon tests.
const GROUPS = ['active', 'cosmos-2251-debris', 'iridium-33-debris', 'fengyun-1c-debris', 'cosmos-1408-debris'];
const groupUrl = (g) => `https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=json`;

// Only the OMM fields the app needs (keeps the snapshot small). Names are unchanged, so
// the same parser handles both this snapshot and a live CelesTrak response.
const KEEP = [
  'OBJECT_NAME', 'OBJECT_ID', 'NORAD_CAT_ID', 'EPOCH', 'MEAN_MOTION', 'ECCENTRICITY',
  'INCLINATION', 'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'BSTAR',
  'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT',
];

const TEXTURE_BASE = 'https://unpkg.com/three-globe@2.45.6/example';
const TEXTURES = [
  ['img/earth-blue-marble.jpg', 'earth-blue-marble.jpg'],
  ['img/earth-night.jpg', 'earth-night.jpg'],
  ['img/earth-topology.png', 'earth-topology.png'],
  ['img/earth-water.png', 'earth-water.png'],
  ['clouds/clouds.png', 'clouds.png'],
];

const exists = (p) => access(p).then(() => true, () => false);

async function fetchTextures() {
  await mkdir(TEXTURE_DIR, { recursive: true });
  for (const [remote, local] of TEXTURES) {
    const out = join(TEXTURE_DIR, local);
    if (await exists(out)) { console.log(`  texture ${local}: already present`); continue; }
    try {
      const res = await fetch(`${TEXTURE_BASE}/${remote}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await writeFile(out, Buffer.from(await res.arrayBuffer()));
      console.log(`  texture ${local}: downloaded`);
    } catch (err) {
      // Not fatal: the globe falls back to a procedural shader for missing textures.
      console.warn(`  texture ${local}: FAILED (${err.message}) — app will use its procedural fallback`);
    }
  }
}

async function fetchSatellites() {
  const force = process.argv.includes('--force');
  const old = await readSnapshot(SNAPSHOT); // what we have now: the "before" of the comparison below
  if (!force && old) {
    const ageHours = (Date.now() - Date.parse(old.fetchedAt)) / 3.6e6;
    if (ageHours < 2) {
      console.log(`  snapshot is only ${ageHours.toFixed(1)} h old (${old.objects.length} objects) — not re-downloading.`);
      console.log('  CelesTrak updates every ~2 h; use --force only if you really need to.');
      return;
    }
  }

  const byId = new Map(); // NORAD id -> record (dedupes objects that appear in two groups)
  const groupCounts = {};
  for (const group of GROUPS) {
    try {
      const res = await fetch(groupUrl(group));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const records = JSON.parse(await res.text()); // throws if CelesTrak sent an error page
      if (!Array.isArray(records)) throw new Error('response was not a JSON array');
      let added = 0;
      for (const rec of records) {
        if (byId.has(rec.NORAD_CAT_ID)) continue;
        const slim = { GROUP: group };
        for (const key of KEEP) slim[key] = rec[key];
        byId.set(rec.NORAD_CAT_ID, slim);
        added++;
      }
      groupCounts[group] = added;
      console.log(`  ${group}: ${records.length} records (${added} new)`);
    } catch (err) {
      console.warn(`  ${group}: SKIPPED (${err.message})`);
    }
    await new Promise((r) => setTimeout(r, 1000)); // be gentle between requests
  }

  if (!groupCounts.active) {
    console.error('  Could not download the main "active" group — keeping the existing snapshot untouched.');
    process.exitCode = 1;
    return;
  }

  const snapshot = {
    fetchedAt: new Date().toISOString(),
    source: 'CelesTrak GP data (https://celestrak.org), OMM JSON format',
    groups: groupCounts,
    objects: [...byId.values()],
  };
  await mkdir(dirname(SNAPSHOT), { recursive: true });
  await writeFile(SNAPSHOT, JSON.stringify(snapshot));
  console.log(`  wrote ${snapshot.objects.length} objects to public/data/satellites.json`);

  console.log('Orbit changes since the previous download:');
  const previousArg = process.argv.find((arg) => arg.startsWith('--previous='));
  await writeChanges(previousArg ? await readSnapshot(previousArg.slice('--previous='.length)) : old, snapshot);
}

// ---------------------------------------------------------------- catalogue facts (SATCAT)
//
// CelesTrak's satellite catalogue has what the orbital elements lack: who owns an object,
// when and where it was launched, what kind of object it is and its radar size. It is one
// CSV for every object ever tracked (~7 MB); we keep only the rows for objects in our
// snapshot. Downloaded at most once a day.

const SATCAT = join(ROOT, 'public/data/satcat.json');
const SATCAT_URL = 'https://celestrak.org/pub/satcat.csv';

/** Split one CSV line, honouring double-quoted fields. */
function csvLine(line) {
  const out = [];
  let field = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(field); field = ''; }
    else field += c;
  }
  out.push(field);
  return out;
}

async function fetchSatcat() {
  if (!(await exists(SNAPSHOT))) return console.log('  no orbital snapshot yet — skipped');
  if (!FORCE && (await exists(SATCAT))) {
    const ageHours = (Date.now() - Date.parse(JSON.parse(await readFile(SATCAT, 'utf8')).fetchedAt)) / 3.6e6;
    if (ageHours < 24) return console.log(`  catalogue facts are ${ageHours.toFixed(1)} h old — not re-downloading (use --force)`);
  }
  const wanted = new Set(JSON.parse(await readFile(SNAPSHOT, 'utf8')).objects.map((o) => Number(o.NORAD_CAT_ID)));
  let text;
  try {
    const res = await fetch(SATCAT_URL, { headers: { 'User-Agent': 'OrbitHash student project (one-time snapshot)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (error) {
    console.error(`  could not download the catalogue (${error.message}) — the app works without it`);
    return;
  }
  const lines = text.split(/\r?\n/);
  const head = csvLine(lines[0]);
  const col = (name) => head.indexOf(name);
  const C = { id: col('NORAD_CAT_ID'), type: col('OBJECT_TYPE'), status: col('OPS_STATUS_CODE'), owner: col('OWNER'), launch: col('LAUNCH_DATE'), site: col('LAUNCH_SITE'), rcs: col('RCS') };
  if (Object.values(C).some((i) => i < 0)) return console.error('  unexpected catalogue format — skipped');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = csvLine(lines[i]);
    const id = Number(f[C.id]);
    if (!wanted.has(id)) continue;
    rows.push([id, f[C.type], f[C.status], f[C.owner], f[C.launch], f[C.site], f[C.rcs] === '' ? null : Number(f[C.rcs])]);
  }
  await writeFile(SATCAT, JSON.stringify({
    fetchedAt: new Date().toISOString(),
    source: 'CelesTrak SATCAT (https://celestrak.org/satcat/)',
    fields: ['noradId', 'type', 'status', 'owner', 'launchDate', 'launchSite', 'rcs'],
    rows,
  }));
  console.log(`  wrote facts for ${rows.length} of ${wanted.size} objects to public/data/satcat.json`);
}

const FORCE = process.argv.includes('--force');
if (!process.argv.includes('--satcat-only')) {
  console.log('Earth textures (three-globe@2.45.6 via unpkg):');
  await fetchTextures();
  console.log('Orbital elements (CelesTrak):');
  await fetchSatellites();
}
console.log('Catalogue facts (CelesTrak SATCAT):');
await fetchSatcat();
