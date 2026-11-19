/**
 * Finding catalogue objects for what was typed in the search field: hash lookups first,
 * forgiveness second.
 *
 * Scoring 20,000 names on every key press would work but is wasteful, so the names are only
 * scored after a hash table has cut them down to a few candidates:
 *
 *   1. a catalogue number          byNorad.get(number): one lookup
 *   2. the words typed             prefixIndex.get(first four letters) for each word; the
 *                                  SHORTEST list is the one walked, since an object that fits
 *                                  every typed word must be in all of them
 *   3. well-known names            the few dozen objects that have a nickname or a full name
 *                                  (data/names.ts), found by words their catalogue name lacks
 *   4. misspellings                only if 1–3 found nothing: `vocabulary`, a
 *                                  Map<word, objects> of every distinct word in the names
 *                                  (a few thousand), is scanned for words within a slip or
 *                                  two of what was typed
 *
 * Each candidate is then scored against its names with matchScore (ui/searchMatch.ts), so
 * case, punctuation and spacing do not matter and "hubbel" still finds Hubble.
 */

import { PREFIX_LEN, type Catalog } from '../data/catalog.ts';
import { searchNames } from '../data/names.ts';
import type { Satellite } from '../data/types.ts';
import { matchNormalized, normalize, wordFit } from './searchMatch.ts';

export interface ObjectHit {
  sat: Satellite;
  score: number; // 0 … 1, as matchScore
}

const WORTH_SHOWING = 0.3;
const MAX_MISSPELT = 400; // candidates taken from the vocabulary scan before scoring

export class ObjectFinder {
  private readonly catalog: Catalog;
  /** Per object, its names normalised for matching. Filled in as objects come up, never for all 20,000. */
  private readonly texts: (string[] | undefined)[] = [];
  private known: number[] | null = null; // objects with a nickname or a full name
  private vocabulary: Map<string, number[]> | null = null; // name word → objects, built at the first misspelling

  constructor(catalog: Catalog) {
    this.catalog = catalog;
  }

  private textsOf(sat: Satellite): string[] {
    return (this.texts[sat.index] ??= searchNames(sat).map(normalize));
  }

  /** The objects that fit `query`, best first. */
  find(query: string, limit = 6): ObjectHit[] {
    const typed = normalize(query);
    if (!typed) return [];
    const { sats, byNorad, prefixIndex } = this.catalog;
    const scores = new Map<number, number>(); // object index → its best score so far
    const offer = (index: number, score: number) => {
      if (score >= WORTH_SHOWING && score > (scores.get(index) ?? 0)) scores.set(index, score);
    };
    const consider = (index: number) => offer(index, matchNormalized(typed, ...this.textsOf(sats[index])));

    // 1. a catalogue number, whole or begun
    const numeric = /^\d+$/.test(typed);
    if (numeric) {
      const exact = byNorad.get(Number(typed));
      if (exact) offer(exact.index, 1);
    }

    // 2. the words typed: walk the shortest of their candidate lists
    const words = typed.split(' ');
    let candidates: number[] | undefined;
    for (const word of words) {
      const list = prefixIndex.get(word.slice(0, PREFIX_LEN).toUpperCase());
      if (list && (!candidates || list.length < candidates.length)) candidates = list;
    }
    for (const index of candidates ?? []) {
      consider(index);
      if (numeric && String(sats[index].noradId).startsWith(typed)) offer(index, 0.5); // a number still being typed
    }

    // 3. names people use that the catalogue does not: "hubble", "chandra", "space station"
    this.known ??= sats.filter((sat) => searchNames(sat).length > 1).map((sat) => sat.index);
    for (const index of this.known) consider(index);

    // 4. nothing at all: perhaps a word is misspelt
    if (scores.size === 0) {
      const near = new Set<number>();
      const vocabulary = this.words();
      for (const word of words) {
        // Too short to be sure of, a number, or a word that exists (so it is not the misspelt one).
        if (word.length < 4 || /\d/.test(word) || vocabulary.has(word)) continue;
        for (const [known, indices] of vocabulary) {
          if (near.size >= MAX_MISSPELT) break;
          if (wordFit(word, known) > 0) for (const index of indices) near.add(index);
        }
      }
      for (const index of near) consider(index);
    }

    // Best first; of equals, a well-known object, then the shorter name, then the older object.
    const famous = new Set(this.known);
    return [...scores]
      .map(([index, score]) => ({ sat: sats[index], score }))
      .sort((a, b) => b.score - a.score
        || Number(famous.has(b.sat.index)) - Number(famous.has(a.sat.index))
        || a.sat.name.length - b.sat.name.length
        || a.sat.index - b.sat.index)
      .slice(0, limit);
  }

  /** Every distinct word of the names (letters only, four or more) → the objects whose name has it. */
  private words(): Map<string, number[]> {
    if (this.vocabulary) return this.vocabulary;
    const vocabulary = new Map<string, number[]>();
    for (const sat of this.catalog.sats) {
      for (const word of new Set(this.textsOf(sat).flatMap((text) => text.split(' ')))) {
        if (word.length < 4 || /\d/.test(word)) continue;
        const list = vocabulary.get(word);
        if (list) list.push(sat.index);
        else vocabulary.set(word, [sat.index]);
      }
    }
    return (this.vocabulary = vocabulary);
  }
}
