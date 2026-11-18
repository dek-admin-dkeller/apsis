/**
 * Upcoming rocket launches from Launch Library 2 (The Space Devs), a free public list:
 *     https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=12&mode=normal
 *
 * The free tier allows roughly 15 requests an hour, shared by everyone behind the same
 * address, so this file is built round asking as little as possible:
 *   - the answer is kept in localStorage and reused for 60 minutes;
 *   - after any failed attempt nothing is asked again for 10 minutes, even across reloads;
 *   - one request at a time, no retries; the caller decides when to ask (features/launches.ts
 *     asks when its section is opened, never on a timer);
 *   - a failure hands back the saved copy, however old, so the list does not vanish.
 * The request is a plain GET with no referrer, no cookies and no added headers.
 *
 * Only the fields the app shows are kept (the full answer is about 50 kB). `parseLaunches`
 * is pure and tolerant of missing fields, so it can be tried in Node on a saved answer.
 *
 * Where things live in the answer (checked against the real service, November 2026):
 *   results[].net                         "no earlier than" time, ISO 8601 UTC
 *   results[].net_precision.name          how exact that time is: "Second", "Minute", "Hour", "Day", "Month" …
 *   results[].status.id / .abbrev         1 Go, 2 TBD, 3 Success, 4 Failure, 5 Hold, 6 In Flight,
 *                                         7 Partial Failure, 8 TBC, 9 Payload Deployed
 *   results[].mission.name                the payload ("USSF-317"); results[].name is "Rocket | Mission"
 *   results[].rocket.configuration.name   the rocket
 *   results[].launch_service_provider.name   who is launching it
 *   results[].pad.name, .pad.location.name   pad and launch site
 *   results[].pad.latitude / .longitude   degrees, as strings
 */

const LAUNCHES_URL = 'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=12&mode=normal';
const CACHE_KEY = 'apsis.launches';
const FRESH_MS = 60 * 60 * 1000;
const RETRY_AFTER_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 15000;

/** How exactly the launch time is known; the countdown must not pretend to more. */
export type NetPrecision = 'exact' | 'hour' | 'day' | 'vague';
/** What the status means for how the row is drawn. */
export type LaunchState = 'go' | 'unconfirmed' | 'hold' | 'flying' | 'done' | 'failed';

export interface Launch {
  id: string;
  mission: string;
  rocket: string;
  provider: string;
  pad: string; // "Space Launch Complex 4E"
  place: string; // "Vandenberg SFB, CA, USA"
  latDeg: number | null; // null when the service has no position for the pad
  lonDeg: number | null;
  netMs: number; // "no earlier than", Unix ms
  precision: NetPrecision;
  state: LaunchState;
  status: string; // the word shown: "go", "to be confirmed", "hold" …
}

export interface LaunchList {
  at: number; // when the list was downloaded, Unix ms
  launches: Launch[];
}

/** Why the newest list could not be fetched ('' = it was, or the saved copy is still fresh). */
export type LaunchProblem = '' | 'limited' | 'unreachable';

const STATUS: Record<number, [LaunchState, string]> = {
  1: ['go', 'go'],
  2: ['unconfirmed', 'to be decided'],
  3: ['done', 'launched'],
  4: ['failed', 'failed'],
  5: ['hold', 'hold'],
  6: ['flying', 'in flight'],
  7: ['failed', 'partial failure'],
  8: ['unconfirmed', 'to be confirmed'],
  9: ['done', 'launched'],
};

/** A few official names are too long for a narrow panel; these are the names people actually use. */
const SHORTER: Record<string, string> = {
  'China Aerospace Science and Technology Corporation': 'China Aerospace (CASC)',
  'Russian Federal Space Agency (ROSCOSMOS)': 'Roscosmos',
  'National Aeronautics and Space Administration': 'NASA',
  'Indian Space Research Organization': 'ISRO',
  'Japan Aerospace Exploration Agency': 'JAXA',
  'United Launch Alliance': 'ULA',
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const field = (object: unknown, key: string): unknown =>
  object && typeof object === 'object' ? (object as Record<string, unknown>)[key] : undefined;
/** A coordinate, which the service sends as a string ("34.632"); NaN for anything missing or empty. */
const degrees = (value: unknown): number =>
  typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;

function precisionOf(name: string): NetPrecision {
  const lower = name.toLowerCase();
  if (lower === 'second' || lower === 'minute') return 'exact';
  if (lower === 'hour') return 'hour';
  if (lower === 'day') return 'day';
  return 'vague'; // month, quarter, half, year — or a word this file has not met
}

/** The service's answer → the launches the app can show, soonest first. Anything malformed is skipped. */
export function parseLaunches(file: unknown): Launch[] {
  const results = field(file, 'results');
  if (!Array.isArray(results)) return [];
  const launches: Launch[] = [];
  for (const entry of results as unknown[]) {
    const netMs = Date.parse(text(field(entry, 'net')));
    const fullName = text(field(entry, 'name')); // "Falcon 9 Block 5 | USSF-317"
    if (!Number.isFinite(netMs) || !fullName) continue;
    const [beforeBar, afterBar] = fullName.split('|').map((part) => part.trim());
    const pad = field(entry, 'pad');
    const lat = degrees(field(pad, 'latitude')), lon = degrees(field(pad, 'longitude'));
    // 0, 0 is what the service stores for "position unknown", not a pad in the Gulf of Guinea.
    const located = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
    const status = field(entry, 'status');
    const known = STATUS[Number(field(status, 'id'))];
    const provider = text(field(field(entry, 'launch_service_provider'), 'name'));
    launches.push({
      id: text(field(entry, 'id')) || `${fullName} ${netMs}`,
      mission: text(field(field(entry, 'mission'), 'name')) || afterBar || fullName,
      rocket: text(field(field(field(entry, 'rocket'), 'configuration'), 'name')) || (afterBar ? beforeBar : ''),
      provider: SHORTER[provider] ?? provider,
      pad: text(field(pad, 'name')),
      place: text(field(field(pad, 'location'), 'name')),
      latDeg: located ? lat : null,
      lonDeg: located ? lon : null,
      netMs,
      precision: precisionOf(text(field(field(entry, 'net_precision'), 'name'))),
      state: known ? known[0] : 'unconfirmed',
      status: known ? known[1] : text(field(status, 'name')).toLowerCase() || 'status unknown',
    });
  }
  return launches.sort((a, b) => a.netMs - b.netMs);
}

// ---- the saved copy ---------------------------------------------------------------------------

interface Saved {
  at: number; // last successful download (0: never)
  tried: number; // last attempt, successful or not
  problem: LaunchProblem; // how the last attempt ended
  launches: Launch[];
}

function readSaved(): Saved {
  const empty: Saved = { at: 0, tried: 0, problem: '', launches: [] };
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as Partial<Saved> | null;
    if (!saved || typeof saved.at !== 'number' || typeof saved.tried !== 'number' || !Array.isArray(saved.launches)) return empty;
    const now = Date.now();
    if (saved.at > now + 60000 || saved.tried > now + 60000) return empty; // the clock was wrong when it was written
    const launches = saved.launches.filter((launch) => launch && typeof launch.netMs === 'number' && typeof launch.mission === 'string');
    return { at: saved.at, tried: saved.tried, problem: saved.problem === 'limited' || saved.problem === 'unreachable' ? saved.problem : '', launches };
  } catch {
    return empty; // storage switched off, or something else wrote to the key
  }
}

function writeSaved(saved: Saved): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(saved));
  } catch {
    // private browsing: nothing is remembered, and the in-memory copy below still limits this session
  }
}

let memory: Saved | null = null; // this session's copy, for browsers where storage is unavailable
let inFlight: Promise<{ list: LaunchList | null; problem: LaunchProblem }> | null = null;

const answer = (saved: Saved): { list: LaunchList | null; problem: LaunchProblem } => ({
  list: saved.at > 0 ? { at: saved.at, launches: saved.launches } : null,
  problem: saved.problem,
});

/**
 * The launch list: the saved copy if it is under an hour old (or if an attempt failed within
 * the last ten minutes), otherwise one request. Never rejects. `problem` says why the newest
 * list is missing, and `list` is then the last good copy (null if there has never been one).
 */
export function loadLaunches(): Promise<{ list: LaunchList | null; problem: LaunchProblem }> {
  if (inFlight) return inFlight;
  const stored = readSaved();
  const saved = memory && memory.tried > stored.tried ? memory : stored;
  const now = Date.now();
  if (saved.at > 0 && now - saved.at < FRESH_MS) return Promise.resolve({ list: { at: saved.at, launches: saved.launches }, problem: '' });
  if (now - saved.tried < RETRY_AFTER_MS) return Promise.resolve(answer(saved));

  inFlight = (async () => {
    // Note the attempt before making it: a reload half-way through must not lead to a second request.
    let next: Saved = { ...saved, tried: now, problem: 'unreachable' };
    memory = next;
    writeSaved(next);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(LAUNCHES_URL, { signal: controller.signal, referrerPolicy: 'no-referrer', credentials: 'omit' });
      if (res.status === 429) next = { ...next, problem: 'limited' };
      else if (res.ok) {
        const launches = parseLaunches(await res.json());
        if (launches.length > 0) next = { at: Date.now(), tried: now, problem: '', launches };
      }
    } catch {
      // offline, blocked or timed out: `next` already says unreachable
    } finally {
      clearTimeout(timer);
    }
    memory = next;
    writeSaved(next);
    inFlight = null;
    return answer(next);
  })();
  return inFlight;
}
