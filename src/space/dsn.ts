/**
 * NASA's Deep Space Network, live: which dish is talking to which spacecraft right now.
 *
 * The network is three sites a third of the way round the world from each other (Goldstone
 * in California, Madrid, Canberra), so that whichever way the Earth is turned one of them
 * faces any craft in deep space. NASA publishes what every dish is doing as a small XML file
 * ("DSN Now", eyes.nasa.gov/dsn), refreshed every few seconds and readable from any web page
 * (it is served with Access-Control-Allow-Origin: *).
 *
 * The file is flat: a <station> line, then that station's <dish> elements, then the next
 * station. Inside a dish: <upSignal> and <downSignal> (one per signal, with `active` and the
 * spacecraft's code) and one <target> per spacecraft the dish is pointed at, with its
 * distance (km) and round-trip light time (s); −1 means not known.
 *
 * Politeness: the file is read at most once a minute, only while something is watching (and
 * the page is visible), and one failed read just waits for the next minute. Nothing here
 * throws: a watcher is simply not called until there is something to tell it.
 */

import type { DsnLink } from './types.ts';

const FEED = 'https://eyes.nasa.gov/dsn/data/dsn.xml';
const EVERY_MS = 60000;
const TIMEOUT_MS = 20000;

/**
 * The feed's spacecraft codes in words (from the feed's own configuration file, cut down to
 * what is flying or was recently). A code not listed here is shown as it comes.
 */
const NAMES: Record<string, string> = {
  ACE: 'ACE', BEPI: 'BepiColombo', BIOS: 'BioSentinel', CAPS: 'CAPSTONE', CGO: 'Carruthers Geocorona Observatory',
  CH2: 'Chandrayaan-2', CH2O: 'Chandrayaan-2', CH3: 'Chandrayaan-3', CHDR: 'Chandra X-ray Observatory', DSCO: 'DSCOVR',
  EMM: 'Hope (Emirates Mars Mission)', ESCB: 'ESCAPADE Blue', ESCG: 'ESCAPADE Gold', EURC: 'Europa Clipper', GAIA: 'Gaia',
  GTL: 'Geotail', HYB2: 'Hayabusa2', IMAP: 'IMAP', INTG: 'INTEGRAL', JNO: 'Juno', JWST: 'James Webb Space Telescope',
  KPLO: 'Danuri', LRO: 'Lunar Reconnaissance Orbiter', LTB: 'Lunar Trailblazer', LUCY: 'Lucy', M01O: 'Mars Odyssey',
  M01S: 'Mars Odyssey', M20: 'Perseverance', MEX: 'Mars Express', MMS1: 'MMS 1', MMS2: 'MMS 2', MMS3: 'MMS 3', MMS4: 'MMS 4',
  MMX: 'Martian Moons eXploration', MRO: 'Mars Reconnaissance Orbiter', MROS: 'Mars Reconnaissance Orbiter', MSL: 'Curiosity',
  MVN: 'MAVEN', NHPC: 'New Horizons', NSYT: 'InSight', ORX: 'OSIRIS-APEX', PLC: 'Akatsuki', PSYC: 'Psyche',
  RST: 'Roman Space Telescope', SLIM: 'SLIM', SOHO: 'SOHO', SPP: 'Parker Solar Probe', STA: 'STEREO-A', STB: 'STEREO-B',
  SWFO: 'SWFO-L1', TESS: 'TESS', TGO: 'ExoMars Trace Gas Orbiter', THB: 'ARTEMIS P1', THC: 'ARTEMIS P2',
  VGR1: 'Voyager 1', VGR2: 'Voyager 2', WIND: 'Wind', XMM: 'XMM-Newton',
  // Retired craft that still have a code (they are in deep.json, so their names are kept together here).
  DAWN: 'Dawn', KEPL: 'Kepler', STF: 'Spitzer Space Telescope', ULYS: 'Ulysses',
};
/** Things a dish can be "pointed at" that are not spacecraft: maintenance, radio astronomy, test signals. */
const NOT_CRAFT = new Set(['DSN', 'DSS', 'TEST', 'CASS', 'GBRA', 'VLBI', 'RFC', 'ATOT', 'EGS', 'GSSR', 'HCRA', 'GVRT', 'SGP', 'RSTS']);
const SITES: Record<string, DsnLink['site']> = { gdscc: 'Goldstone', mdscc: 'Madrid', cdscc: 'Canberra' };

/** A readable name for one of the feed's spacecraft codes ('VGR1' → 'Voyager 1'); the code itself if it is not known. */
/** NASA's public page of the same live feed: where every "in contact" in the app comes from (linked wherever it is shown). */
export const DSN_NOW_URL = 'https://eyes.nasa.gov/dsn/dsn.html';

export const dsnName = (code: string): string => NAMES[code.toUpperCase()] ?? code.toUpperCase();
/** Is this one of the codes the table above has a name for? (The check uses it on every craft in deep.json.) */
export const dsnKnown = (code: string): boolean => code.toUpperCase() in NAMES;

/** A distance or a time from the feed: a positive number, or null for "−1" and anything unreadable. */
function positive(text: string | null): number | null {
  const value = Number(text);
  return text !== null && text !== '' && Number.isFinite(value) && value > 0 ? value : null;
}

/** The feed's XML as links. Throws on anything that is not the feed (the caller catches). */
function parse(xml: string): DsnLink[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.tagName !== 'dsn') throw new Error('not the DSN feed');
  const links: DsnLink[] = [];
  let site: DsnLink['site'] | null = null;
  for (const node of doc.documentElement.children) {
    if (node.tagName === 'station') {
      site = SITES[(node.getAttribute('name') ?? '').toLowerCase()] ?? null;
      continue;
    }
    if (node.tagName !== 'dish' || !site) continue;
    const dish = (node.getAttribute('name') ?? '').replace(/^DSS-?/i, 'DSS-');
    // Which spacecraft have a live signal in each direction on this dish.
    const live = (tag: string): Set<string> => new Set(
      [...node.querySelectorAll(tag)]
        .filter((signal) => signal.getAttribute('active') === 'true')
        .map((signal) => (signal.getAttribute('spacecraft') ?? '').toUpperCase()),
    );
    const up = live('upSignal'), down = live('downSignal');
    for (const target of node.querySelectorAll('target')) {
      const craft = (target.getAttribute('name') ?? '').toUpperCase();
      if (!craft || NOT_CRAFT.has(craft)) continue;
      links.push({
        dish, site, craft, name: dsnName(craft), up: up.has(craft), down: down.has(craft),
        rangeKm: positive(target.getAttribute('downlegRange')) ?? positive(target.getAttribute('uplegRange')),
        roundTripS: positive(target.getAttribute('rtlt')),
      });
    }
  }
  return links;
}

let links: DsnLink[] = [];
let readAt = 0; // when the feed was last read successfully (Unix ms); 0 = never
let askedAt = 0; // when it was last asked for
let failed = false; // the latest attempt did not succeed
let asking = false;
let timer: ReturnType<typeof setInterval> | null = null;
const watchers = new Set<(links: DsnLink[]) => void>();

function tell(): void {
  for (const run of watchers) {
    try {
      run(links);
    } catch (error) {
      console.error('A Deep Space Network watcher failed', error); // one broken listener must not stop the others
    }
  }
}

/** Read the feed now, unless it was asked for within the last minute. Never rejects. */
async function read(): Promise<void> {
  if (asking || Date.now() - askedAt < EVERY_MS - 2000) return;
  asking = true;
  askedAt = Date.now();
  try {
    // The address changes each minute because the file is served with an hour-long cache header.
    const res = await fetch(`${FEED}?r=${Math.floor(askedAt / EVERY_MS)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    links = parse(await res.text());
    readAt = Date.now();
    failed = false;
  } catch {
    failed = true; // keep what was read before; dsnStatus() says how old it is
  } finally {
    asking = false;
  }
  tell();
}

/**
 * Be told which dishes are in contact with which spacecraft: once straight away (as soon as
 * the feed has been read) and then after every read, about once a minute, for as long as
 * anything is watching. Returns the function that stops it. `run` also fires after a read that
 * failed, with the links from the last good one: ask dsnStatus() how fresh they are.
 */
export function watchDsn(run: (links: DsnLink[]) => void): () => void {
  watchers.add(run);
  if (readAt > 0) queueMicrotask(() => watchers.has(run) && run(links)); // what is already known, at once
  void read();
  timer ??= setInterval(() => {
    // A hidden tab has nobody looking at it; the next visible minute catches up.
    if (typeof document === 'undefined' || !document.hidden) void read();
  }, EVERY_MS);
  return () => {
    watchers.delete(run);
    if (watchers.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** The links from the last successful read (empty before the first). */
export const latestDsn = (): DsnLink[] => links;

/** When the feed was last read successfully (Unix ms, 0 = never) and whether the latest attempt failed. */
export const dsnStatus = (): { readAt: number; failed: boolean } => ({ readAt, failed });
