/**
 * Forgiving text matching for the search field: how well does what was typed fit a name?
 *
 * Pure functions with nothing from the browser, so they are tested from Node
 * (`node scripts/test-command.mjs`) and can be used by anything that offers rows to the search
 * field: the catalogue, the types, the places, the actions, the bodies beyond Earth orbit.
 *
 *   matchScore('james webber telescope', 'James Webb Space Telescope', 'jwst', 'webb')  →  0.58
 *
 * The answer runs from 0 (not a match) to 1 (the same text). Several texts can be given for one
 * thing (its name, its nickname, its abbreviation); the best fit counts. Case, accents,
 * punctuation and spacing never matter. From best to worst:
 *
 *   1.00  the same text                               "hubble"        ~ "Hubble"
 *   0.96  the same once the spaces are taken out      "space x"       ~ "SpaceX"
 *   0.90  the beginning, up to the end of a word      "colour by"     ~ "Colour by altitude"
 *   0.85  the beginning, part-way through a word      "mon"           ~ "Monitor"
 *   0.72  every typed word begins a word, in step     "col alt"       ~ "Colour by altitude"
 *   0.62  every typed word begins a word              "altitude"      ~ "Colour by altitude"
 *   < 0.6 every typed word found, some misspelt       "hubbel telescpe" ~ "Hubble Space Telescope"
 *   < 0.55 the whole name is somewhere in the text    "hubble telescope" ~ "Hubble"
 *   0.40  found inside a word                         "titu"          ~ "Colour by altitude"
 *
 * So 0.6 is the line between "what was typed is in the name" and "probably meant": a list
 * that has a proper match can leave everything below it out.
 *
 * Misspelling is measured as edit distance (letters added, dropped, changed or swapped), and
 * the number of slips allowed grows with the length of the word: none in a word of three
 * letters or fewer, one up to seven, two beyond. Numbers are never treated as misspelt:
 * "starlink 1234" must not find Starlink 1235.
 */

/** Lower case, no accents, punctuation as spaces: "São Paulo" → "sao paulo", "TERRASAR-X" → "terrasar x". */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // the accents NFD has just split off
    .replace(/['’.]/g, '') // "d.c." → "dc", "xi'an" → "xian"
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The verbs people put in front of what they want: they say what to do with it, not what it is called. */
const VERB = /^(?:please )?(?:go to|goto|go|fly to|fly over|take me to|jump to|zoom to|show me|show|open|find|select|look at|view|switch to|use|search for|search) (?:the )?/;

/**
 * A normalised phrase without its leading verb ("go to cairo" → "cairo", "show telescopes" →
 * "telescopes"), and whether that verb was one of travel: then a place is what is wanted.
 * `bare` equals the phrase when there is no verb.
 */
export function withoutVerb(phrase: string): { bare: string; going: boolean } {
  const bare = phrase.replace(VERB, '');
  return { bare, going: bare !== phrase && /^(?:please )?(?:go|goto|fly|take|jump|zoom)/.test(phrase) };
}

/** How many slips a typed word of this length may contain and still count as that word. */
function slipsAllowed(length: number): number {
  return length <= 3 ? 0 : length <= 7 ? 1 : 2;
}

/**
 * Edit distance between two words: the fewest single-letter insertions, deletions,
 * substitutions and swaps of neighbours that turn one into the other ("hubbel" → "hubble" is
 * one swap). The classic table, kept to two rows plus the one before for the swap; gives up
 * with `limit + 1` as soon as the lengths alone rule a match out.
 */
export function editDistance(a: string, b: string, limit = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let before: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, before[j - 2] + 1);
      row.push(best);
    }
    before = previous;
    previous = row;
  }
  return previous[b.length];
}

/**
 * How well one typed word stands for one word of a name, 0 … 1: the word itself, its
 * beginning, the word with a little more on the end ("webber" for Webb), or a misspelling.
 */
export function wordFit(typed: string, word: string): number {
  if (typed === word) return 1;
  if (word.startsWith(typed)) return 0.9;
  if (word.length >= 4 && typed.length - word.length <= 2 && typed.startsWith(word)) return 0.75;
  const allowed = slipsAllowed(typed.length);
  if (allowed === 0 || /\d/.test(typed) || /\d/.test(word)) return 0;
  const slips = editDistance(typed, word, allowed);
  return slips > allowed ? 0 : 1 - slips / Math.max(typed.length, word.length);
}

/** The fit of two texts that have already been through normalize(). */
function fit(query: string, text: string): number {
  if (!query || !text) return 0;
  if (query === text) return 1;
  const tight = query.replace(/ /g, ''), textTight = text.replace(/ /g, '');
  if (tight === textTight) return 0.96;
  if (text.startsWith(query)) return text[query.length] === ' ' ? 0.9 : 0.85;
  const typed = query.split(' '), words = text.split(' ');
  if (typed.every((t) => words.some((w) => w.startsWith(t)))) return words[0].startsWith(typed[0]) ? 0.72 : 0.62;
  if (tight.length >= 4 && textTight.startsWith(tight)) return 0.6; // "one web 01" ~ "ONEWEB-0123"

  // Every typed word is in the text, give or take a slip: "hubbel telescpe".
  let sum = 0, found = 0;
  for (const t of typed) {
    let best = 0;
    for (const w of words) best = Math.max(best, wordFit(t, w));
    if (best > 0) {
      sum += best;
      found++;
    }
  }
  let score = 0;
  if (found === typed.length) score = 0.3 + 0.3 * (sum / found);
  // Most of them are (two at least): "james webb telescope nasa" still finds the telescope.
  else if (found >= 2 && found * 3 >= typed.length * 2) score = (0.3 + 0.3 * (sum / found)) * (found / typed.length);

  // The other way round: the whole name is in what was typed ("hubble telescope" holds "hubble").
  // Short names must be there letter for letter, or "mi" would be found in every other phrase.
  let back = 0, all = true;
  for (const w of words) {
    let best = 0;
    for (const t of typed) best = Math.max(best, t === w ? 1 : w.length > 3 ? wordFit(t, w) * (w.startsWith(t) ? 0 : 1) : 0);
    if (best === 0) {
      all = false;
      break;
    }
    back += best;
  }
  if (all) score = Math.max(score, 0.25 + 0.3 * (back / words.length));

  if (score === 0 && query.length >= 4 && text.includes(query)) return 0.4; // inside a word ("now" inside "known" would be noise)
  return score;
}

/** Like matchScore, for texts that are already normalised (the catalogue's names are, once, when it loads). */
export function matchNormalized(query: string, ...texts: string[]): number {
  let best = 0;
  for (const text of texts) {
    best = Math.max(best, fit(query, text));
    if (best === 1) break;
  }
  return best;
}

/**
 * How well `query` fits the best of `texts`: 0 = no match … 1 = the same text. The scale is in
 * the header of this file; rows scoring under about 0.3 are not worth showing.
 */
export function matchScore(query: string, ...texts: string[]): number {
  return matchNormalized(normalize(query), ...texts.map(normalize));
}
