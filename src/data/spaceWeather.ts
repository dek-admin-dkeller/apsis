/**
 * Today's space weather from NOAA's Space Weather Prediction Center: the two numbers that
 * decide how thick the upper air is, and so how fast low satellites come down.
 *
 *   Solar radio flux (F10.7)   services.swpc.noaa.gov/json/f107_cm_flux.json
 *                              the Sun's brightness at 10.7 cm wavelength, measured three
 *                              times a day in Canada; it rises and falls with the
 *                              ultraviolet that heats the upper air. About 70 is a quiet
 *                              Sun, 200 or more a very active one.
 *   Planetary K index (Kp)     services.swpc.noaa.gov/products/noaa-planetary-k-index.json
 *                              how disturbed the Earth's magnetic field has been in each
 *                              three-hour slot of the last week, 0 (calm) to 9 (extreme);
 *                              storms also heat the upper air, for a day or so.
 *
 * Politeness (same spirit as render/aurora.ts, which reads NOAA's aurora files): one request
 * per file per session at most, nothing on a timer, and a copy kept in localStorage so that
 * reloading the page within three hours asks for nothing at all. The fetches are plain GETs
 * with no referrer. If NOAA cannot be reached the last copy is returned, marked as old.
 *
 * The parsing functions are pure (and tolerant: NOAA has changed the shape of the K index
 * file from rows of strings to objects before), so they can be run in Node on a saved file.
 */

const FLUX_URL = 'https://services.swpc.noaa.gov/json/f107_cm_flux.json';
const KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';
const CACHE_KEY = 'apsis.weather';
const FRESH_MS = 3 * 3600 * 1000; // both files change every three hours at most
const USABLE_MS = 3 * 86400 * 1000; // an older copy than this says nothing about today
const TIMEOUT_MS = 15000;

export interface SpaceWeather {
  at: number; // when it was downloaded, Unix ms
  flux: number | null; // latest solar radio flux, solar flux units
  fluxMean: number | null; // its average over the last 90 days (or over the file, about 40 days, if NOAA left it out)
  kp: number | null; // latest three-hour planetary K index
  kpPeak: number | null; // the highest K index of the last 24 hours
}

/** NOAA writes UTC times without a zone ("2026-11-17T22:00:00" or "2026-11-17 22:00:00.000"). */
function parseUtc(tag: unknown): number {
  if (typeof tag !== 'string') return NaN;
  const iso = tag.trim().replace(' ', 'T');
  return Date.parse(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
}

const toNumber = (value: unknown): number =>
  typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;

/** The latest flux and its 90-day mean out of f107_cm_flux.json (one record per measurement, three a day). */
export function parseFlux(file: unknown): { flux: number | null; fluxMean: number | null } {
  if (!Array.isArray(file)) return { flux: null, fluxMean: null };
  let latest = -Infinity, flux: number | null = null;
  let latestMean = -Infinity, fluxMean: number | null = null;
  let sum = 0, count = 0;
  for (const entry of file as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as { time_tag?: unknown; flux?: unknown; ninety_day_mean?: unknown; frequency?: unknown };
    const when = parseUtc(row.time_tag);
    const value = toNumber(row.flux);
    const frequency = toNumber(row.frequency);
    // 2800 MHz is the 10.7 cm line; anything else in the file is not what we want. Values
    // outside 50…500 are instrument faults (the quietest Sun ever measured was about 64).
    if (!Number.isFinite(when) || !(value > 50 && value < 500) || (Number.isFinite(frequency) && frequency !== 2800)) continue;
    sum += value;
    count++;
    if (when > latest) {
      latest = when;
      flux = value;
    }
    const mean = toNumber(row.ninety_day_mean);
    if (mean > 50 && mean < 500 && when > latestMean) {
      latestMean = when;
      fluxMean = mean;
    }
  }
  if (fluxMean === null && count >= 30) fluxMean = sum / count; // ten days or more of readings: a usable stand-in
  return { flux, fluxMean };
}

/** The latest K index and the last day's highest out of noaa-planetary-k-index.json. */
export function parseKp(file: unknown, nowMs: number): { kp: number | null; kpPeak: number | null } {
  if (!Array.isArray(file)) return { kp: null, kpPeak: null };
  let latest = -Infinity, kp: number | null = null, kpPeak: number | null = null;
  for (const entry of file as unknown[]) {
    // Either an object {time_tag, Kp} or (the older layout) a row [time_tag, Kp, …] under a heading row.
    let tag: unknown, value: unknown;
    if (Array.isArray(entry)) [tag, value] = entry as unknown[];
    else if (entry && typeof entry === 'object') {
      const row = entry as { time_tag?: unknown; Kp?: unknown; kp?: unknown; kp_index?: unknown; estimated_kp?: unknown };
      tag = row.time_tag;
      value = [row.Kp, row.estimated_kp, row.kp_index, row.kp].find((candidate) => Number.isFinite(toNumber(candidate)));
    }
    const when = parseUtc(tag);
    const index = toNumber(value);
    if (!Number.isFinite(when) || !(index >= 0 && index <= 9)) continue;
    if (when > latest) {
      latest = when;
      kp = index;
    }
    if (nowMs - when < 27 * 3600 * 1000) kpPeak = Math.max(kpPeak ?? 0, index); // 24 h plus the three-hour slot itself
  }
  if (nowMs - latest > 12 * 3600 * 1000) return { kp: null, kpPeak: null }; // a stale file says nothing about now
  return { kp, kpPeak };
}

/** The K index in the words NOAA's own storm scale uses (the aurora layer's status line uses the same ones). */
export function kpWords(kp: number): string {
  if (kp < 3) return 'quiet';
  if (kp < 4) return 'unsettled';
  if (kp < 5) return 'active';
  if (kp < 6) return 'minor storm';
  if (kp < 7) return 'moderate storm';
  if (kp < 8) return 'strong storm';
  if (kp < 9) return 'severe storm';
  return 'extreme storm';
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, referrerPolicy: 'no-referrer', credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** The copy kept from an earlier visit, if there is one that still says something about today. */
export function cachedSpaceWeather(): SpaceWeather | null {
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as Partial<SpaceWeather> | null;
    if (!saved || typeof saved.at !== 'number' || Date.now() - saved.at > USABLE_MS || saved.at > Date.now() + 60000) return null;
    const pick = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
    return { at: saved.at, flux: pick(saved.flux), fluxMean: pick(saved.fluxMean), kp: pick(saved.kp), kpPeak: pick(saved.kpPeak) };
  } catch {
    return null; // storage switched off, or something else wrote to the key
  }
}

export const isFresh = (weather: SpaceWeather): boolean => Date.now() - weather.at < FRESH_MS;

let request: Promise<SpaceWeather | null> | null = null; // one attempt per session, shared by every caller

/**
 * Today's readings: from the saved copy if it is under three hours old, otherwise one request
 * to NOAA for each file. On failure: the saved copy however old (up to three days; check
 * `isFresh`), or null when there is none. Never rejects, never asks twice in one session.
 */
export function loadSpaceWeather(): Promise<SpaceWeather | null> {
  request ??= (async () => {
    const saved = cachedSpaceWeather();
    if (saved && isFresh(saved)) return saved;
    const [fluxFile, kpFile] = await Promise.allSettled([fetchJson(FLUX_URL), fetchJson(KP_URL)]);
    const now = Date.now();
    const flux = fluxFile.status === 'fulfilled' ? parseFlux(fluxFile.value) : { flux: null, fluxMean: null };
    const kp = kpFile.status === 'fulfilled' ? parseKp(kpFile.value, now) : { kp: null, kpPeak: null };
    if (flux.flux === null && kp.kp === null) {
      console.warn('Apsis: NOAA space weather is unavailable; re-entry estimates assume an average Sun.');
      return saved;
    }
    const weather: SpaceWeather = { at: now, ...flux, ...kp };
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(weather));
    } catch {
      // private browsing: it simply is not remembered
    }
    return weather;
  })();
  return request;
}
