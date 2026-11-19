/**
 * The paths the Mars rovers have driven: loading public/data/rovers.json.
 *
 * The file is written at build time by scripts/fetch-rovers.mjs from NASA/JPL's own "Where is
 * the rover" maps (one line per drive, simplified to within a few metres). Each path belongs to
 * the craft in deep.json with the same `id`; points are [latitude, east longitude] in degrees,
 * planetocentric, oldest first: the same convention as a craft's `surface` motion.
 *
 * Nothing is fetched until a place with a rover on its ground is built (render/space/spaceView.ts)
 * or a rover's card is opened (ui/places.ts): a visitor who never goes to Mars never downloads
 * it. Once loaded, the file is watched like the other data files (data/freshness.ts), so a tab
 * left open takes the next day's drives.
 */

import { fetchData, watchData } from '../data/freshness.ts';

export interface RoverPath {
  /** The craft's id in deep.json. */
  id: string;
  name: string;
  /** The NASA layer the path was read from. */
  source: string;
  fetchedAt: string;
  /** The latest sol in the record (days on Mars since landing). */
  sol: number;
  /** The rover's own odometry, as the mission quotes it. */
  drivenKm: number;
  /** How far the simplified line may stray from the full one, metres. */
  toleranceM: number;
  /** [latDeg, lonDeg east], oldest first. */
  points: [number, number][];
}

export interface RoverData {
  fetchedAt: string;
  source: string;
  credit: string;
  rovers: RoverPath[];
}

const DATA_URL = 'data/rovers.json'; // relative: the site may live under any sub-path

let loading: Promise<RoverData | null> | null = null;
/** The paths by craft id, once loaded: a hash table, because the card and the view look one up by id. */
let byId = new Map<string, RoverPath>();
const refreshListeners: ((data: RoverData) => void)[] = [];

async function read(fresh: boolean): Promise<RoverData | null> {
  try {
    const res = await fetchData(DATA_URL, fresh);
    if (!res.ok) return null;
    const data = (await res.json()) as RoverData;
    if (!data || !Array.isArray(data.rovers)) return null;
    // A path needs two points to be a line; anything malformed is left out rather than drawn wrong.
    data.rovers = data.rovers.filter((rover) => typeof rover?.id === 'string' && Array.isArray(rover.points) && rover.points.length >= 2);
    return data;
  } catch {
    return null; // missing or unreadable: there are simply no paths to draw
  }
}

function use(data: RoverData): void {
  byId = new Map(data.rovers.map((rover) => [rover.id, rover]));
}

/** The paths, fetched once (later calls share the same promise). Null if the file is missing or unreadable. */
export function loadRovers(): Promise<RoverData | null> {
  loading ??= read(false).then((data) => {
    if (data) {
      use(data);
      watchData(DATA_URL, { reload: refresh });
    }
    return data;
  });
  return loading;
}

/** The path of one craft, if it is loaded and there is one (null for a lander, or before loadRovers() has finished). */
export function roverPath(craftId: string): RoverPath | null {
  return byId.get(craftId) ?? null;
}

/** Be told when a NEWER copy of the file has replaced the one in use (not for the first load). */
export function onRoversRefresh(run: (data: RoverData) => void): void {
  refreshListeners.push(run);
}

/** The site has published the file again: take it if it is newer by its own `fetchedAt` (freshness.ts). */
async function refresh(): Promise<'same'> {
  const current = await loadRovers();
  const next = await read(true);
  if (next && !(current && !(Date.parse(next.fetchedAt) > Date.parse(current.fetchedAt)))) {
    loading = Promise.resolve(next);
    use(next);
    for (const run of refreshListeners) run(next);
  }
  // A few more metres of track is nothing to announce.
  return 'same';
}
