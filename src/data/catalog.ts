/**
 * The catalogue: loads the orbital-element snapshot, turns each OMM record into a
 * `Satellite`, and builds the hash-table indexes the UI uses for instant lookups.
 *
 * Every index here is a built-in JS Map or Set (a hash table), so each lookup is O(1)
 * expected no matter how many objects are loaded:
 *   byNorad      Map<noradId, Satellite>      — search by catalogue number
 *   byName       Map<NAME, Satellite[]>       — search by exact name
 *   prefixIndex  Map<prefix, index[]>         — autocomplete (see buildPrefixIndex)
 *   byCategory   Map<Category, Set<index>>    — filter toggles + live counts
 *   byOrbit      Map<OrbitClass, Set<index>>  — orbit-class toggles
 */

import { categorize, classifyOrbit, meanAltitudeKm } from './categorize.ts';
import { CATEGORIES, ORBIT_CLASSES, type Category, type OmmRecord, type OrbitClass, type Satellite, type Snapshot } from './types.ts';

export interface Catalog {
  fetchedAt: string;
  live: boolean; // true when the data came straight from CelesTrak this session
  sats: Satellite[];
  byNorad: Map<number, Satellite>;
  byName: Map<string, Satellite[]>;
  prefixIndex: Map<string, number[]>;
  byCategory: Map<Category, Set<number>>;
  byOrbit: Map<OrbitClass, Set<number>>;
}

const PREFIX_LEN = 4; // longest prefix stored in the autocomplete index
const LIVE_GROUPS = ['active', 'cosmos-2251-debris', 'iridium-33-debris', 'fengyun-1c-debris', 'cosmos-1408-debris'];

/** The bundled snapshot written by `npm run fetch-data`. Works offline. */
export async function loadSnapshot(): Promise<Snapshot> {
  const res = await fetch('./data/satellites.json');
  if (!res.ok) throw new Error(`snapshot missing (HTTP ${res.status}) — run "npm run fetch-data"`);
  return (await res.json()) as Snapshot;
}

/** One manual attempt to get fresh data from CelesTrak. Throws on any failure (CORS, offline, rate limit). */
export async function loadLive(): Promise<Snapshot> {
  const byId = new Map<number, OmmRecord>();
  for (const group of LIVE_GROUPS) {
    const res = await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=json`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`CelesTrak ${group}: HTTP ${res.status}`);
    const records = (await res.json()) as OmmRecord[];
    if (!Array.isArray(records)) throw new Error(`CelesTrak ${group}: unexpected response`);
    for (const rec of records) if (!byId.has(rec.NORAD_CAT_ID)) byId.set(rec.NORAD_CAT_ID, { ...rec, GROUP: group });
  }
  if (byId.size < 1000) throw new Error('CelesTrak returned too little data');
  return { fetchedAt: new Date().toISOString(), objects: [...byId.values()] };
}

function toSatellite(omm: OmmRecord, index: number): Satellite {
  const year = Number.parseInt(omm.OBJECT_ID.slice(0, 4), 10); // "1998-067A" → 1998
  return {
    index,
    noradId: omm.NORAD_CAT_ID,
    name: omm.OBJECT_NAME,
    intlDes: omm.OBJECT_ID,
    launchYear: Number.isFinite(year) ? year : null,
    category: categorize(omm),
    orbitClass: classifyOrbit(omm),
    inclinationDeg: omm.INCLINATION,
    periodMin: 1440 / omm.MEAN_MOTION,
    meanAltKm: meanAltitudeKm(omm),
    omm,
  };
}

/**
 * Autocomplete index: for every word of every name (and the NORAD id), store the object
 * under each of the word's first 1…PREFIX_LEN characters.
 *   "ISS (ZARYA)", id 25544  →  I, IS, ISS, Z, ZA, ZAR, ZARY, 2, 25, 255, 2554
 * Typing "zar" is then ONE Map lookup that returns a short candidate list, instead of
 * scanning all ~20,000 names on every keystroke.
 */
function buildPrefixIndex(sats: Satellite[]): Map<string, number[]> {
  const index = new Map<string, number[]>();
  for (const sat of sats) {
    const words = new Set(sat.name.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean));
    words.add(String(sat.noradId));
    const prefixes = new Set<string>();
    for (const word of words) {
      for (let len = 1; len <= Math.min(PREFIX_LEN, word.length); len++) prefixes.add(word.slice(0, len));
    }
    for (const prefix of prefixes) {
      const list = index.get(prefix);
      if (list) list.push(sat.index);
      else index.set(prefix, [sat.index]);
    }
  }
  return index;
}

export function buildCatalog(snapshot: Snapshot, live = false): Catalog {
  const sats = snapshot.objects.filter((o) => o.MEAN_MOTION > 0 && o.OBJECT_NAME).map(toSatellite);

  const byNorad = new Map<number, Satellite>();
  const byName = new Map<string, Satellite[]>();
  const byCategory = new Map<Category, Set<number>>(CATEGORIES.map((c) => [c, new Set<number>()]));
  const byOrbit = new Map<OrbitClass, Set<number>>(ORBIT_CLASSES.map((o) => [o, new Set<number>()]));

  for (const sat of sats) {
    byNorad.set(sat.noradId, sat);
    const key = sat.name.toUpperCase();
    const sameName = byName.get(key);
    if (sameName) sameName.push(sat);
    else byName.set(key, [sat]);
    byCategory.get(sat.category)!.add(sat.index);
    byOrbit.get(sat.orbitClass)!.add(sat.index);
  }

  return { fetchedAt: snapshot.fetchedAt, live, sats, byNorad, byName, prefixIndex: buildPrefixIndex(sats), byCategory, byOrbit };
}

/**
 * Search by name or NORAD id. Three hash lookups, each O(1) expected:
 *   1. exact NORAD id   → byNorad.get(id)
 *   2. exact name       → byName.get(NAME)
 *   3. autocomplete     → prefixIndex.get(first ≤4 chars of the first word typed), then the
 *                         short candidate list is filtered against the full query text.
 */
export function searchCatalog(catalog: Catalog, query: string, limit = 8): Satellite[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const results: Satellite[] = [];
  const seen = new Set<number>();
  const add = (sat: Satellite | undefined) => {
    if (sat && !seen.has(sat.index) && results.length < limit) {
      seen.add(sat.index);
      results.push(sat);
    }
  };

  if (/^\d+$/.test(q)) add(catalog.byNorad.get(Number(q)));
  for (const sat of catalog.byName.get(q) ?? []) add(sat);

  const firstWord = q.split(/[^A-Z0-9]+/).filter(Boolean)[0] ?? '';
  const candidates = catalog.prefixIndex.get(firstWord.slice(0, PREFIX_LEN)) ?? [];
  for (const index of candidates) {
    if (results.length >= limit) break;
    const sat = catalog.sats[index];
    if (sat.name.toUpperCase().includes(q) || String(sat.noradId).startsWith(q)) add(sat);
  }
  return results;
}
