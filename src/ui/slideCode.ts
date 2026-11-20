/**
 * The real code shown in the "How it works" scenes (ui/howSlides.ts): which blocks are cut out
 * of which file, and which lines are lit with which callout.
 *
 * Kept apart from the scenes (no DOM, no CSS, no `?raw` import) so that `npm run check`
 * (scripts/check-slides.mjs) can read the same rules against the files on disk: if a function is
 * renamed or a lit line changes, the check fails before a visitor sees a scene without its code.
 */

export interface Excerpt {
  file: string;
  lines: { n: number; text: string }[];
}

/**
 * The block that starts on the first line matching `start` (a method or a loop), up to its
 * closing brace, with its real line numbers. Doc comments above it are not included.
 */
export function excerpt(source: string, file: string, start: RegExp): Excerpt | null {
  const all = source.split('\n');
  const first = all.findIndex((line) => start.test(line));
  if (first < 0) return null;
  let depth = 0;
  let opened = false;
  const lines: Excerpt['lines'] = [];
  for (let i = first; i < all.length; i++) {
    const text = all[i];
    lines.push({ n: i + 1, text });
    for (const ch of text.replace(/\/\/.*$/, '').replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '')) {
      if (ch === '{') {
        depth++;
        opened = true;
      } else if (ch === '}') depth--;
    }
    if (opened && depth <= 0) break;
  }
  // Take off the common indentation, so the excerpt starts at the left.
  const indent = Math.min(...lines.filter((line) => line.text.trim()).map((line) => line.text.match(/^ */)![0].length));
  return { file, lines: lines.map((line) => ({ n: line.n, text: line.text.slice(indent) })) };
}

const SPATIAL = 'src/hashing/SpatialHash.ts';
const CONJUNCTION = 'src/hashing/conjunction.ts';

/** Where each excerpt starts. */
export const EXCERPT_RULES = {
  cellCoord: { file: SPATIAL, start: /^\s+cellCoord\(/ },
  key: { file: SPATIAL, start: /^\s+key\(ix/ },
  insert: { file: SPATIAL, start: /^\s+insert\(/ },
  query: { file: SPATIAL, start: /^\s+for \(let ix = cx - 1/ }, // the 27-cell loop inside queryNeighbors
  measure: { file: CONJUNCTION, start: /grid\.queryNeighbors\(xi/ }, // hashedPairs' inner loop
} as const;

/** The lit lines and what is said about them, per scene. */
export const CALLOUTS = {
  table: [
    { match: /Math\.floor\(v \/ this\.cellSize\)/, text: 'Divide by the cell size and round down. The shift (+2¹⁶) keeps every cell number positive.' },
    { match: /\(ix \* RADIX \+ iy\) \* RADIX \+ iz/, text: 'Three cell numbers packed into one key, like the digits of a single number. No two cells share a key.' },
    { match: /this\.buckets\.(get|set)\(k|bucket\.push\(id\)/, text: 'The key finds the cell’s bucket in a Map and the object’s ID goes in. A new cell gets a new bucket.' },
  ],
  measure: [
    { match: /this\.buckets\.get\(this\.key\(ix, iy, iz\)\)/, text: '27 lookups: A’s cube and the 26 around it. Only their IDs come back.' },
    { match: /if \(j <= i\) continue/, text: 'Each pair is seen from both sides; keeping j > i counts it once.' },
    { match: /if \(dist2 < d2\)/, text: 'Squared distance against the squared cutoff: the same test, with no square root.' },
  ],
} as const;

/** Which excerpts each code scene shows, in order. */
export const SCENE_EXCERPTS = {
  table: ['cellCoord', 'key', 'insert'],
  measure: ['query', 'measure'],
} as const;
