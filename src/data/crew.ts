/**
 * Who is in space right now.
 *
 * Source: a small community-maintained JSON file served from GitHub Pages
 * (corquaid.github.io/international-space-station-APIs) listing the crews of the ISS and
 * Tiangong with agency, role, spacecraft, launch time and a portrait. If it cannot be
 * reached, Launch Library 2 (ll.thespacedevs.com) is tried once as a fallback — it knows
 * who is in orbit but not on which station, so that is inferred from the agency.
 *
 * Fetched at most once per visit; any failure simply yields null and the interface shows
 * nothing.
 */

export interface CrewMember {
  name: string;
  craft: 'ISS' | 'Tiangong' | string;
  agency?: string;
  country?: string;
  role?: string;
  /** Days since this person's current flight launched. */
  daysInSpace?: number;
  /** Small HTTPS portrait, when the source has one. */
  photoUrl?: string;
  /** The ship they flew up on, e.g. "Soyuz MS-29". */
  spacecraft?: string;
}

const PRIMARY = 'https://corquaid.github.io/international-space-station-APIs/JSON/people-in-space.json';
const FALLBACK = 'https://ll.thespacedevs.com/2.2.0/astronaut/?in_space=true&limit=40';
const TIMEOUT_MS = 8000;

async function getJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/** Whole days since a launch, if that gives a believable figure. */
function daysSince(launchMs: number): number | undefined {
  const days = Math.floor((Date.now() - launchMs) / 86400000);
  return Number.isFinite(days) && days >= 0 && days < 2000 ? days : undefined;
}

/**
 * Wikimedia Commons originals can be several megabytes; ask for the 120 px rendition instead:
 *   …/commons/9/97/Name.jpg  →  …/commons/thumb/9/97/Name.jpg/120px-Name.jpg
 */
function smallPortrait(url: string | undefined): string | undefined {
  if (!url || !url.startsWith('https://')) return undefined;
  const commons = /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/([0-9a-f]\/[0-9a-f]{2})\/([^/]+\.(?:jpe?g|png))$/i.exec(url);
  return commons ? `${commons[1]}/thumb/${commons[2]}/${commons[3]}/120px-${commons[3]}` : url;
}

function fromPrimary(file: unknown): CrewMember[] {
  const people = (file as { people?: unknown }).people;
  if (!Array.isArray(people)) throw new Error('unexpected format');
  const crew: CrewMember[] = [];
  for (const entry of people as Record<string, unknown>[]) {
    const name = text(entry?.name);
    if (!name) continue;
    const spacecraft = text(entry.spacecraft), agency = text(entry.agency), country = text(entry.country);
    const chinese = /shenzhou|tiangong/i.test(spacecraft ?? '') || agency === 'CMSA' || country === 'China';
    const launched = Number(entry.launched); // Unix seconds
    crew.push({
      name,
      craft: entry.iss === true ? 'ISS' : chinese ? 'Tiangong' : spacecraft ?? 'In orbit',
      agency,
      country,
      role: text(entry.position),
      daysInSpace: Number.isFinite(launched) && launched > 0 ? daysSince(launched * 1000) : undefined,
      photoUrl: smallPortrait(text(entry.image)),
      spacecraft,
    });
  }
  if (crew.length === 0) throw new Error('empty list');
  return crew;
}

function fromFallback(file: unknown): CrewMember[] {
  const results = (file as { results?: unknown }).results;
  if (!Array.isArray(results)) throw new Error('unexpected format');
  const crew: CrewMember[] = [];
  for (const entry of results as Record<string, unknown>[]) {
    const name = text(entry?.name);
    const type = text((entry?.type as { name?: unknown } | null)?.name);
    const status = text((entry?.status as { name?: unknown } | null)?.name);
    if (!name || type === 'Non-Human' || (status && status !== 'Active')) continue; // the list includes a mannequin and a dog
    const agency = entry.agency as { name?: unknown; abbrev?: unknown } | null;
    const agencyName = text(agency?.name) ?? '';
    const lastFlight = Date.parse(text(entry.last_flight) ?? '');
    crew.push({
      name,
      craft: /china/i.test(agencyName) ? 'Tiangong' : 'ISS', // not stated by this source: inferred
      agency: text(agency?.abbrev) ?? (agencyName || undefined),
      country: text(entry.nationality),
      daysInSpace: Number.isFinite(lastFlight) ? daysSince(lastFlight) : undefined,
      photoUrl: smallPortrait(text(entry.profile_image_thumbnail)),
    });
  }
  if (crew.length === 0) throw new Error('empty list');
  return crew;
}

let cached: Promise<CrewMember[] | null> | null = null;

/** Everyone currently in orbit, or null if no source could be reached. One request per visit. */
export function loadCrew(): Promise<CrewMember[] | null> {
  cached ??= (async () => {
    try {
      return fromPrimary(await getJson(PRIMARY));
    } catch { /* try the other source */ }
    try {
      return fromFallback(await getJson(FALLBACK));
    } catch (error) {
      console.warn(`Apsis: the list of people in space is unavailable (${error instanceof Error ? error.message : String(error)}).`);
      return null;
    }
  })();
  return cached;
}
