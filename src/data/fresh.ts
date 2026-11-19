/**
 * What was launched in the last few days: the catalogue's objects grouped by launch.
 *
 * Every object's international designator starts with its launch ("2026-204A" → "2026-204").
 * A launch counts as new when the SATCAT facts date it within the last `days` days, or when
 * it has no date yet but its number is higher than the newest dated launch of that year: the
 * daily facts file lags the elements by up to a day, so the very newest launches are exactly
 * the ones without a date. Debris is left out (a new launch is its payloads and its stages).
 *
 * Pure (no DOM), so it can be checked in Node.
 */

import type { Catalog } from './catalog.ts';
import type { CatalogFacts } from './satcat.ts';

export interface FreshLaunch {
  /** "2026-204" */
  id: string;
  /** YYYY-MM-DD from the facts, or '' when the facts do not have it yet. */
  date: string;
  /** Object indices in the catalogue, payloads first. */
  members: number[];
  /** The object to name it by and go to: its first payload. */
  lead: number;
  /** "Starlink G10-5 + 23 more" */
  title: string;
}

export function freshLaunches(catalog: Catalog, facts: Map<number, CatalogFacts>, nowMs: number, days = 3): FreshLaunch[] {
  const groups = new Map<string, { date: string; members: number[] }>();
  for (const sat of catalog.sats) {
    if (sat.category === 'Debris' || sat.intlDes.length < 8) continue;
    const id = sat.intlDes.slice(0, 8);
    const group = groups.get(id) ?? { date: '', members: [] };
    group.members.push(sat.index);
    group.date ||= facts.get(sat.noradId)?.launchDate ?? '';
    groups.set(id, group);
  }
  // The newest launch number with a date, per year: anything above it is newer than the facts.
  const newestDated = new Map<string, number>();
  for (const [id, group] of groups) {
    if (!group.date) continue;
    const year = id.slice(0, 4), n = Number(id.slice(5, 8));
    if (n > (newestDated.get(year) ?? 0)) newestDated.set(year, n);
  }
  const cutoff = nowMs - days * 86400000;
  const out: FreshLaunch[] = [];
  for (const [id, group] of groups) {
    const year = id.slice(0, 4), n = Number(id.slice(5, 8));
    const recent = group.date ? Date.parse(`${group.date}T23:59:59Z`) >= cutoff : facts.size > 0 && n > (newestDated.get(year) ?? Infinity);
    if (!recent) continue;
    const stage = (i: number) => Number(/R\/B|DEB/.test(catalog.sats[i].name)); // rocket bodies after payloads
    const members = group.members.sort((a, b) => stage(a) - stage(b) || a - b);
    const lead = members[0];
    const name = catalog.sats[lead].name;
    out.push({ id, date: group.date, members, lead, title: members.length > 1 ? `${name} + ${members.length - 1} more` : name });
  }
  return out.sort((a, b) => (a.id < b.id ? 1 : -1));
}
