/**
 * The keyword index: typing "telescope" finds every telescope.
 *
 * The catalogue names nothing by what it is. Hubble is filed as "HST", so a search of the
 * names alone can never answer "telescope", "weather" or "chinese". What each object IS comes
 * from elsewhere: its model kind, purpose and operator (data/describe.ts), its category
 * (data/categorize.ts), its orbit, and the owner in the catalogue facts (data/satcat.ts).
 *
 * This module turns those descriptions round into an INVERTED INDEX, the same structure a
 * search engine uses, built from two hash tables in one pass over the catalogue:
 *
 *   topics   Map<description, Topic>     "space telescope" → { label: "Space telescopes", members: [412, 3050, …] }
 *   byWord   Map<keyword, number[]>      "telescope"       → [412, 3050, …]    (object indices, ascending)
 *
 * Building: for each object, each of its descriptions is looked up in `topics` (one Map.get)
 * and the object's index appended to that topic's list. The objects are visited in index
 * order, so every list comes out sorted without ever being sorted. Then each word of each
 * description gets the objects of every topic it appears in. About 20,000 objects × 6
 * descriptions: a few tens of milliseconds, once per catalogue.
 *
 * Asking: a typed word is ONE Map.get, O(1) expected, where a scan would test every object
 * against every description on every key press. Several words ("chinese weather") are the
 * INTERSECTION of their lists; because the lists are sorted, two of them are intersected by
 * walking both at once (O(n + m)), never by comparing every pair.
 *
 * The search field shows a topic as one row, "Space telescopes · 16 objects"; choosing it
 * shows only those objects on the globe.
 */

import { describe, KIND_LABEL, type ModelKind } from '../data/describe.ts';
import { ownerName, type CatalogFacts } from '../data/satcat.ts';
import type { Category, OrbitClass, Satellite } from '../data/types.ts';
import { matchNormalized, normalize, wordFit } from './searchMatch.ts';

/** One description shared by several objects, as the search field offers it. */
export interface Topic {
  /** "Space telescopes" */
  label: string;
  /** What kind of description it is: Type, Purpose, Operator, Owner, Orbit. */
  note: string;
  /** Indices of the objects it describes, ascending. */
  members: number[];
  /** The label and the other ways of asking for it, normalised, for matching what is typed. */
  texts: string[];
}

export interface KeywordIndex {
  topics: Topic[];
  byWord: Map<string, number[]>;
}

// ---------------------------------------------------------------- what the descriptions are called

/**
 * Plural names for the model kinds. Not every kind needs one: anything missing falls back to
 * the kind's own label, so a kind added later still gets a row.
 */
const KIND_TOPIC: Partial<Record<ModelKind, string>> = {
  starlink: 'Starlink satellites', oneweb: 'OneWeb satellites', comsat: 'Communications satellites',
  geocomsat: 'Geostationary communications satellites', gnss: 'Navigation satellites', smallsat: 'Small satellites',
  cubesat: 'CubeSats', observer: 'Earth-imaging satellites', radarsat: 'Radar-imaging satellites',
  weather: 'Weather satellites', spinner: 'Weather satellites', telescope: 'Space telescopes',
  iss: 'International Space Station', tiangong: 'Tiangong space station', station: 'Space station modules',
  dragon: 'Dragon capsules', soyuz: 'Soyuz-type spacecraft', cygnus: 'Cygnus cargo spacecraft', capsule: 'Cargo spacecraft',
  rocketbody: 'Rocket upper stages', debris: 'Debris fragments',
  // Telescopes that have a 3D model of their own are still telescopes.
  chandra: 'Space telescopes', xmm: 'Space telescopes', webb: 'Space telescopes', euclid: 'Space telescopes', tess: 'Space telescopes',
  lasersphere: 'Laser-ranging spheres', relay: 'Data-relay satellites', phasedarray: 'Direct-to-phone satellites',
  soho: 'Solar observatories', l1monitor: 'Space-weather and magnetosphere probes',
  // Families that took over part of a general kind keep its topic, so a type is never split in
  // two ("radar" still finds ICEYE and Capella with the rest) …
  globalstar: 'Communications satellites', iceye: 'Radar-imaging satellites', capella: 'Radar-imaging satellites', dove: 'CubeSats',
  // … except the two Chinese constellations, which people ask for by name (their purpose,
  // "Broadband internet constellation", still files them with the other broadband fleets).
  qianfan: 'Qianfan satellites', guowang: 'Guowang satellites',
  // Kinds added with their own models (Nov 2026): the same topics as before, so a model of its
  // own never splits a type ("starlink" still finds every Starlink, V1 and V2 Mini alike).
  starlinkv2: 'Starlink satellites', kuiper: 'Amazon Kuiper satellites', iridium: 'Iridium satellites', o3b: 'O3b satellites',
  galileo: 'Navigation satellites', glonass: 'Navigation satellites', goes: 'Weather satellites',
  shenzhou: 'Crewed spacecraft', starliner: 'Crewed spacecraft', orion: 'Crewed spacecraft', dreamchaser: 'Cargo spacecraft',
};

const CATEGORY_TOPIC: Partial<Record<Category, string>> = {
  Starlink: 'Starlink satellites', OneWeb: 'OneWeb satellites', GNSS: 'Navigation satellites', Debris: 'Debris fragments',
  'Space Stations': 'Space stations and visiting craft', 'Weather / Earth-obs': 'Weather and Earth observation',
};

const ORBIT_TOPIC: Record<OrbitClass, string> = {
  LEO: 'Low Earth orbit', MEO: 'Medium Earth orbit', GEO: 'Geostationary orbit', HEO: 'Highly elliptical orbit',
};

/** Purposes that say nothing a kind does not already say. */
const DULL_PURPOSES = new Set(['Satellite', 'Orbital debris fragment', 'Spent rocket upper stage']);

/**
 * Other words people use for a description, keyed the way `topics` is (see topicKey). One
 * more hash table: the words are added to the topic when it is first made.
 */
const ALSO = new Map<string, string>([
  ['space telescope', 'telescope, observatory, astronomy, astronomical'],
  ['debris fragment', 'debris, space junk, junk, fragment, wreckage'],
  ['rocket upper stage', 'rocket, rocket body, booster, upper stage, spent stage'],
  ['navigation satellite', 'navigation, gnss, satnav, positioning'],
  ['weather satellite', 'weather, meteorology, meteorological'],
  ['communication satellite', 'communications, comsat, telecom, telecommunications'],
  ['geostationary communication satellite', 'tv satellite, broadcast, television'],
  ['cubesat', 'cube sat, nanosatellite, nanosat'],
  ['small satellite', 'smallsat, microsatellite'],
  ['earth imaging satellite', 'earth observation, imaging, remote sensing, camera'],
  ['radar imaging satellite', 'radar, sar, synthetic aperture radar'],
  ['space station and visiting craft', 'space station, crewed, crew, astronauts'],
  ['broadband internet constellation', 'internet, broadband, megaconstellation'],
  ['low earth orbit', 'leo'],
  ['medium earth orbit', 'meo'],
  ['geostationary orbit', 'geo, geosynchronous, geostationary'],
  ['highly elliptical orbit', 'heo, elliptical, molniya'],
  ['united state', 'usa, us, america, american'],
  ['russia cis', 'russian, soviet, ussr'],
  ['china', 'chinese, prc'],
  ['united kingdom', 'uk, british, britain'],
  ['european space agency', 'esa, europe, european'],
  ['japan', 'japanese'],
  ['india', 'indian'],
  ['france', 'french'],
  ['germany', 'german'],
  ['canada', 'canadian'],
  ['italy', 'italian'],
  ['spain', 'spanish'],
  ['south korea', 'korea, korean'],
  ['israel', 'israeli'],
  ['australia', 'australian'],
  ['brazil', 'brazilian'],
  ['argentina', 'argentine, argentinian'],
]);

/** Words that describe everything, so they cannot narrow a search: "weather satellites" means "weather". */
const FILLER = new Set(['satellite', 'sat', 'object', 'spacecraft', 'craft', 'all', 'the', 'of', 'in', 'from', 'and', 'by', 'for', 'a', 'an', 'show', 'me', 'find', 'only', 'owned', 'made', 'operated']);

/** "telescopes" → "telescope", so that plural and singular are one keyword. ("debris", "cygnus" and "progress" stay.) */
function singular(word: string): string {
  return word.length > 3 && word.endsWith('s') && !/(?:ss|is|us)$/.test(word) ? word.slice(0, -1) : word;
}

/** A description as a key: "Space telescopes" and "Space telescope" are the same topic. */
function topicKey(label: string): string {
  return normalize(label).split(' ').map(singular).join(' ');
}

// ---------------------------------------------------------------- building

/** Every description of one object, with the kind of description each is. */
function descriptions(sat: Satellite, facts: CatalogFacts | undefined): [label: string, note: string][] {
  const profile = describe(sat);
  const list: [string, string][] = [[KIND_TOPIC[profile.kind] ?? KIND_LABEL[profile.kind], 'Type']];
  const category = CATEGORY_TOPIC[sat.category];
  if (category) list.push([category, 'Type']);
  // A fragment's purpose is a sentence ("Fragment of Fengyun-1C, destroyed in …"): keep what comes before the comma.
  const purpose = profile.purpose.split(',')[0].replace(/^Fragment /, 'Fragments ');
  if (!DULL_PURPOSES.has(profile.purpose) && purpose !== sat.category) list.push([purpose, 'Purpose']);
  if (profile.operator) list.push([profile.operator, 'Operator']);
  if (facts?.owner) list.push([ownerName(facts.owner), 'Owner']);
  list.push([ORBIT_TOPIC[sat.orbitClass], 'Orbit']);
  return list;
}

/** Build both tables for a catalogue. `facts` may be empty (it loads a little later): owners are then simply missing. */
export function buildKeywordIndex(sats: Satellite[], facts: Map<number, CatalogFacts>): KeywordIndex {
  // Pass 1: file every object under each of its descriptions.
  const byKey = new Map<string, Topic>();
  for (const sat of sats) {
    for (const [label, note] of descriptions(sat, facts.get(sat.noradId))) {
      const key = topicKey(label);
      let topic = byKey.get(key);
      if (!topic) {
        const also = (ALSO.get(key) ?? '').split(',').map(normalize).filter(Boolean);
        topic = { label, note, members: [], texts: [...new Set([normalize(label), key, ...also])] };
        byKey.set(key, topic);
      }
      // Two descriptions of one object can be the same topic (kind and category both say "Starlink"): file it once.
      if (topic.members[topic.members.length - 1] !== sat.index) topic.members.push(sat.index);
    }
  }
  const topics = [...byKey.values()].filter((topic) => topic.members.length >= 2); // one object is not a type

  // Pass 2: every word of a description → the objects of every topic that uses the word.
  const gathered = new Map<string, number[][]>();
  for (const topic of topics) {
    const words = new Set(topic.texts.flatMap((text) => text.split(' ')).map(singular));
    for (const word of words) {
      if (FILLER.has(word) || word.length < 2) continue;
      const lists = gathered.get(word);
      if (lists) lists.push(topic.members);
      else gathered.set(word, [topic.members]);
    }
  }
  const byWord = new Map<string, number[]>();
  for (const [word, lists] of gathered) byWord.set(word, lists.length === 1 ? lists[0] : union(lists));
  return { topics, byWord };
}

/** Several sorted lists as one sorted list without repeats. */
function union(lists: number[][]): number[] {
  const seen = new Set<number>();
  for (const list of lists) for (const index of list) seen.add(index);
  return [...seen].sort((a, b) => a - b);
}

/**
 * The objects in both of two sorted lists. Both are walked once, each step moving past
 * whichever number is smaller: O(n + m), where testing every pair would be O(n × m).
 */
export function intersect(a: number[], b: number[]): number[] {
  const both: number[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      both.push(a[i]);
      i++;
      j++;
    } else if (a[i] < b[j]) i++;
    else j++;
  }
  return both;
}

// ---------------------------------------------------------------- asking

/** The topics that fit what was typed, best first; of two that fit equally, the larger. */
export function findTopics(index: KeywordIndex, query: string, limit = 3): { topic: Topic; score: number }[] {
  const typed = normalize(query);
  if (typed.length < 2) return [];
  const asOne = typed.split(' ').map(singular).filter((word) => !FILLER.has(word)).join(' '); // "weather satellites" → "weather"
  const found: { topic: Topic; score: number }[] = [];
  for (const topic of index.topics) {
    const score = Math.max(matchNormalized(typed, ...topic.texts), asOne ? matchNormalized(asOne, ...topic.texts) : 0);
    if (score >= 0.45) found.push({ topic, score });
  }
  found.sort((a, b) => b.score - a.score || b.topic.members.length - a.topic.members.length);
  // Two descriptions of exactly the same objects ("OneWeb satellites", operator "Eutelsat OneWeb"): the better fit is enough.
  const same = (a: Topic, b: Topic) => a.members.length === b.members.length && a.members[0] === b.members[0] && a.members.at(-1) === b.members.at(-1);
  const chosen: { topic: Topic; score: number }[] = [];
  for (const hit of found) {
    if (chosen.length >= limit) break;
    if (!chosen.some((other) => same(other.topic, hit.topic))) chosen.push(hit);
  }
  return chosen;
}

/** The keyword a typed word stands for: itself, or the nearest one if it is cut short or misspelt. */
function keywordFor(index: KeywordIndex, word: string): string | null {
  if (index.byWord.has(word)) return word; // the usual case: one hash lookup
  let best: string | null = null, bestFit = 0.8; // a beginning (0.9) or one slip in a longer word
  for (const keyword of index.byWord.keys()) {
    const fit = wordFit(word, keyword);
    if (fit > bestFit) {
      best = keyword;
      bestFit = fit;
    }
  }
  return best;
}

/**
 * Several words that each describe something: "chinese weather", "spacex geostationary".
 * Each word is looked up in `byWord` and the lists are intersected, shortest first so the
 * work is bounded by the smallest list. Null unless at least two words were understood and
 * something is described by all of them.
 */
export function findDescribed(index: KeywordIndex, query: string): { keywords: string[]; members: number[] } | null {
  const words = normalize(query).split(' ').map(singular).filter((word) => word && !FILLER.has(word));
  if (words.length < 2) return null;
  const keywords: string[] = [];
  for (const word of words) {
    const keyword = keywordFor(index, word);
    if (!keyword) return null; // one word that describes nothing: this is a name, not a description
    if (!keywords.includes(keyword)) keywords.push(keyword);
  }
  if (keywords.length < 2) return null;
  const lists = keywords.map((keyword) => index.byWord.get(keyword)!).sort((a, b) => a.length - b.length);
  let members = lists[0];
  for (let k = 1; k < lists.length && members.length > 0; k++) members = intersect(members, lists[k]);
  return members.length > 0 ? { keywords, members } : null;
}
