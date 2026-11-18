/**
 * Launch and re-entry feed (Objects panel): what went up most recently, and what is
 * lowest and therefore next to come down.
 *
 *   Newest in orbit   grouped by launch (the first part of the international designator,
 *                     e.g. 2026-204), dated from the catalogue facts when they are loaded
 *   Lowest orbits     smallest perigee altitude — where the air is thick enough that
 *                     these fall within days to months
 */

import type { Catalog } from '../data/catalog.ts';
import type { CatalogFacts } from '../data/satcat.ts';
import { CATEGORY_COLORS, type Satellite } from '../data/types.ts';
import { $, fmtKm } from './dom.ts';

const EARTH_RADIUS_KM = 6371;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Perigee altitude from the published elements (km). */
function perigeeKm(sat: Satellite): number {
  return (EARTH_RADIUS_KM + sat.meanAltKm) * (1 - sat.omm.ECCENTRICITY) - EARTH_RADIUS_KM;
}

function row(sat: Satellite, title: string, right: string, onSelect: (sat: Satellite) => void): HTMLLIElement {
  const li = document.createElement('li');
  const pick = document.createElement('button');
  pick.className = 'watch-pick';
  const dot = document.createElement('i');
  dot.className = 'dot';
  dot.style.color = CATEGORY_COLORS[sat.category];
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = title;
  const value = document.createElement('span');
  value.className = 'alt';
  value.textContent = right;
  pick.append(dot, name, value);
  pick.addEventListener('click', () => onSelect(sat));
  li.append(pick);
  return li;
}

/** A recently launched batch still flying together: its objects, for highlighting. */
export type TrainPick = (members: number[] | null, lead: Satellite | null) => void;
let activeTrain = '';

export function renderFeed(catalog: Catalog, facts: Map<number, CatalogFacts>, onSelect: (sat: Satellite) => void, onTrain: TrainPick): void {
  // ---- newest: one row per launch, most recent first
  const launches = new Map<string, { first: Satellite; count: number; date: string; members: number[]; altSum: number }>(); // launch id → its objects
  for (const sat of catalog.sats) {
    if (sat.category === 'Debris' || sat.intlDes.length < 8) continue;
    const id = sat.intlDes.slice(0, 8); // "2026-204"
    const known = launches.get(id);
    if (known) {
      known.count++;
      known.members.push(sat.index);
      known.altSum += sat.meanAltKm;
    } else launches.set(id, { first: sat, count: 1, date: facts.get(sat.noradId)?.launchDate ?? '', members: [sat.index], altSum: sat.meanAltKm });
  }
  const newest = [...launches.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 7);
  $('feed-new').replaceChildren(...newest.map(([id, launch]) => {
    const when = launch.date ? `${Number(launch.date.slice(8, 10))} ${MONTHS[Number(launch.date.slice(5, 7)) - 1]}` : id;
    const title = launch.count > 1 ? `${launch.first.name} + ${launch.count - 1} more` : launch.first.name;
    return row(launch.first, title, when, onSelect);
  }));

  // ---- trains: big batches from the last two months, still climbing in a line from their drop-off orbit
  const cutoff = Date.now() - 60 * 86400000;
  const trains = [...launches.entries()]
    .filter(([, launch]) => launch.count >= 6 && (launch.date ? Date.parse(launch.date) > cutoff : true))
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 6);
  if (!trains.some(([id]) => id === activeTrain)) activeTrain = '';
  $('feed-trains').replaceChildren(...trains.map(([id, launch]) => {
    const when = launch.date ? `${Number(launch.date.slice(8, 10))} ${MONTHS[Number(launch.date.slice(5, 7)) - 1]}` : id;
    const family = launch.first.name.replace(/[-\s]?\d+.*$/, '') || launch.first.name;
    const li = row(launch.first, `${launch.count} × ${family}, ${fmtKm(launch.altSum / launch.count)}`, when, () => {
      // First click: light up the whole batch and go to its lead object. Second click: back to normal.
      activeTrain = activeTrain === id ? '' : id;
      onTrain(activeTrain ? launch.members : null, activeTrain ? launch.first : null);
      for (const other of $('feed-trains').children) other.classList.toggle('is-on', other === li && activeTrain === id);
    });
    li.classList.toggle('is-on', id === activeTrain);
    return li;
  }));
  $('feed-trains-empty').classList.toggle('is-hidden', trains.length > 0);

  // ---- lowest: smallest perigee (ignoring nonsense values from stale elements)
  const lowest = catalog.sats
    .map((sat) => ({ sat, perigee: perigeeKm(sat) }))
    .filter((entry) => entry.perigee > 120 && entry.perigee < 2000)
    .sort((a, b) => a.perigee - b.perigee)
    .slice(0, 7);
  $('feed-low').replaceChildren(...lowest.map((entry) => row(entry.sat, entry.sat.name, fmtKm(entry.perigee), onSelect)));
}
