// Every build: start from the data the site is already showing.
//
// The scheduled build downloads fresh elements, radio records, catalogue facts and deep-space
// positions, and they live only in the published site (they are never committed back). A build started by a push
// would otherwise publish the older snapshot stored in the repository and lose the orbit-change
// comparison, until the next scheduled run.
//
// A scheduled build runs this first as well, for another reason: each download script
// declines while ITS file is too young (CelesTrak 2 hours, SatNOGS and JPL about 6, the
// catalogue facts a day). Measured against the weeks-old copies in the repository those
// guards never held, and every run asked every source. Measured against what the site is
// showing, a source is asked exactly as often as its script allows, however often the
// workflow runs. And if a source cannot be reached, the site keeps the data it had instead of
// falling back to the repository's old copy.
//
// So before a build this script reads the data files back from the published site — the
// project's own pages; nothing is asked of CelesTrak, SatNOGS or JPL — and keeps each one that
//   - parses as JSON,
//   - has the same top-level fields as the copy in the repository (a push that changes a
//     file's layout must not be handed the old layout back), and
//   - is newer than that copy (`fetchedAt`).
// changes.json has no copy in the repository: it is kept only when it was computed for the
// elements that end up on disk (its `to` equals their `fetchedAt`, the same test the app makes).
//
// Never fatal: anything that cannot be read or does not fit is skipped with a line in the log.
//
//   node scripts/carry-over.mjs https://<owner>.github.io/<repository>/

import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'public/data');
const FILES = ['satellites.json', 'radio.json', 'satcat.json', 'deep.json', 'rovers.json'];

const site = process.argv[2];
if (!site || !/^https:\/\//.test(site)) {
  console.log('carry-over: no site address given; building with the stored data');
  process.exit(0);
}
const base = site.endsWith('/') ? site : `${site}/`;

/** The published copy of one file as text, or null (missing, slow, not this site's file). */
async function published(name) {
  try {
    const res = await fetch(`${base}data/${name}`, { signal: AbortSignal.timeout(120_000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

const parse = (text) => {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null; // a missing file can come back as an HTML page
  }
};
const fields = (object) => Object.keys(object).sort().join(',');

for (const name of FILES) {
  const path = join(DATA, name);
  const stored = parse(await readFile(path, 'utf8').catch(() => ''));
  const text = await published(name);
  const live = text ? parse(text) : null;
  if (!live) console.log(`  ${name}: not readable on the site; keeping the stored copy`);
  else if (!stored) console.log(`  ${name}: no stored copy to check the layout against; skipped`);
  else if (fields(live) !== fields(stored)) console.log(`  ${name}: the layout has changed; keeping the stored copy`);
  else if (!(Date.parse(live.fetchedAt) > Date.parse(stored.fetchedAt))) console.log(`  ${name}: the stored copy is as new (${stored.fetchedAt})`);
  else {
    await writeFile(path, text);
    console.log(`  ${name}: kept the published copy (${live.fetchedAt}, stored was ${stored.fetchedAt})`);
  }
}

// The comparison belongs to one download of the elements, and only to that one.
const elements = parse(await readFile(join(DATA, 'satellites.json'), 'utf8').catch(() => ''));
const changesText = await published('changes.json');
const changes = changesText ? parse(changesText) : null;
if (changes && elements && Array.isArray(changes.changes) && changes.to === elements.fetchedAt) {
  await writeFile(join(DATA, 'changes.json'), changesText);
  console.log(`  changes.json: kept (${changes.from} → ${changes.to})`);
} else {
  await rm(join(DATA, 'changes.json'), { force: true });
  console.log('  changes.json: none that matches these elements');
}
