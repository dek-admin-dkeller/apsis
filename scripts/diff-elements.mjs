// scripts/diff-elements.mjs — the build-time half of "Orbit changes"
//
// Compares two downloads of the orbital elements and writes public/data/changes.json: which
// objects raised or lowered their orbit by more than drag and noise explain ("possible
// manoeuvres"), which are new and which are gone, with the time of both downloads. The rules
// are in src/data/changes.ts, the very file the browser uses, imported here directly
// (Node 22.18+ runs TypeScript by stripping the types).
//
// fetch-data.mjs calls writeChanges() after each successful download. It can also be run by
// hand on any two snapshot files; then it only prints unless --out is given:
//
//   node scripts/diff-elements.mjs <previous.json> <next.json> [--out=public/data/changes.json]
//
// It never downloads anything.

import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHANGE_KINDS, compareElements } from '../src/data/changes.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CHANGES = join(ROOT, 'public/data/changes.json');

/** Read a snapshot file; null if it is missing, cut short or not a snapshot (never throws). */
export async function readSnapshot(path) {
  try {
    const snapshot = JSON.parse(await readFile(path, 'utf8'));
    return Array.isArray(snapshot.objects) && Number.isFinite(Date.parse(snapshot.fetchedAt)) ? snapshot : null;
  } catch {
    return null;
  }
}

/** Why two snapshots cannot be compared, or '' if they can. */
function refusal(previous, next) {
  if (!previous) return 'there is no earlier download to compare with';
  if (!next) return 'there is no new download';
  if (!(Date.parse(next.fetchedAt) > Date.parse(previous.fetchedAt))) return 'the "earlier" download is not older than the new one';
  if (previous.objects.length < 1000) return 'the earlier download is too small to be a real catalogue';
  return '';
}

const summary = (report) => CHANGE_KINDS.map((kind) => `${report.counts[kind]} ${kind}`).join(', ');

/**
 * Compare and write the file. When there is nothing honest to compare, any existing file is
 * REMOVED instead: a changes file left over from another download would describe objects and
 * dates that no longer match the snapshot beside it. Returns the report or null.
 */
export async function writeChanges(previous, next, out = CHANGES) {
  const why = refusal(previous, next);
  if (why) {
    await rm(out, { force: true });
    console.log(`  no comparison: ${why}`);
    return null;
  }
  const report = compareElements(previous, next);
  const file = {
    about: 'Differences between two CelesTrak downloads. "raised", "lowered" and "plane" are possible manoeuvres inferred from the elements (see src/data/changes.ts), not confirmed reports.',
    ...report,
  };
  // Three decimals (metres, thousandths of a degree) are all the precision there is.
  await writeFile(out, JSON.stringify(file, (_key, value) => (typeof value === 'number' && !Number.isInteger(value) ? Math.round(value * 1000) / 1000 : value)));
  console.log(`  ${previous.fetchedAt} → ${next.fetchedAt}: ${summary(report)}`);
  console.log(`  (${report.compared} objects had a newer measurement, ${report.unchanged} had not been measured again)`);
  return report;
}

// ---- run by hand ---------------------------------------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const outArg = process.argv.find((arg) => arg.startsWith('--out='));
  if (files.length !== 2) {
    console.error('usage: node scripts/diff-elements.mjs <previous.json> <next.json> [--out=public/data/changes.json]');
    process.exit(1);
  }
  const [previous, next] = await Promise.all(files.map(readSnapshot));
  console.log('Orbit changes:');
  if (outArg) {
    await writeChanges(previous, next, outArg.slice(6));
  } else {
    const why = refusal(previous, next);
    if (why) console.log(`  no comparison: ${why}`);
    else {
      const report = compareElements(previous, next);
      console.log(`  ${previous.fetchedAt} → ${next.fetchedAt}: ${summary(report)}  (not written; pass --out=… to write)`);
      for (const c of report.changes.filter((c) => c.kind !== 'new' && c.kind !== 'gone').slice(0, 15)) {
        console.log(`    ${c.name.padEnd(26)} ${c.kind.padEnd(8)} ${c.deltaKm.toFixed(2).padStart(9)} km  (allowance ${c.allowanceKm.toFixed(2)} km, tilt ${c.deltaIncDeg >= 0 ? '+' : ''}${c.deltaIncDeg.toFixed(3)}°)`);
      }
    }
  }
}
