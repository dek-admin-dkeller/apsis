// scripts/horizons.mjs — the one place that talks to JPL Horizons.
//
// Horizons (ssd.jpl.nasa.gov/horizons) is NASA's ephemeris service: ask it where any planet,
// moon or spacecraft is and it answers from the same trajectory files the missions fly by.
// fetch-deep.mjs uses it for the spacecraft beyond Earth orbit, make-deep-fixture.mjs for the
// reference positions that `npm run check` compares src/space/ephem.ts against.
//
// It answers in plain text and sends no Access-Control-Allow-Origin header, so only build-time
// scripts can use it; the browser never does.
//
// Politeness, enforced here so no caller can forget it: one request at a time, at least 1.1 s
// between the end of one and the start of the next, a generic User-Agent, a timeout on each.

const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const PAUSE_MS = 1100;
const TIMEOUT_MS = 60000;

/** The app's clock is UTC; Horizons vectors are tagged in TDB, 69.184 s ahead (see ephem.ts). */
export const TT_MINUS_UTC_MS = 69184;
/** Julian date on the TDB clock for a Unix time: what TLIST / START_TIME want for vector tables. */
export const jdTdb = (ms) => (ms + TT_MINUS_UTC_MS) / 86400000 + 2440587.5;
/** Julian date on the UT clock: what observer tables want. */
export const jdUt = (ms) => ms / 86400000 + 2440587.5;
/** A Julian date written with enough digits (under a tenth of a millisecond). */
export const jdText = (jd) => jd.toFixed(9);

let lastDone = 0;
let queue = Promise.resolve();

/** One request. `params` are Horizons' own names (COMMAND, CENTER, EPHEM_TYPE …); values are quoted here. Returns the reply text. */
export function horizons(params) {
  const run = async () => {
    const wait = lastDone + PAUSE_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const query = new URLSearchParams({ format: 'text', OBJ_DATA: "'NO'", MAKE_EPHEM: "'YES'", CSV_FORMAT: "'YES'" });
    for (const [key, value] of Object.entries(params)) query.set(key, `'${value}'`);
    try {
      const res = await fetch(`${API}?${query}`, {
        // A generic name: nothing in the request says who or what project is asking.
        headers: { 'User-Agent': 'orbit-viewer/1.0' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } finally {
      lastDone = Date.now();
    }
  };
  // Chain every call behind the previous one: strictly sequential whatever the caller does.
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}

/** The table between $$SOE and $$EOE as rows of trimmed cells; throws with Horizons' own words if there is none. */
export function tableRows(text) {
  const start = text.indexOf('$$SOE'), end = text.indexOf('$$EOE');
  if (start < 0 || end < 0) {
    // With no table the reply is a short explanation ("No ephemeris for target …").
    const reason = text.split('\n').map((line) => line.trim()).filter((line) => line && !/^(API|\*+$)/.test(line)).slice(0, 2).join(' / ');
    throw new Error(reason.slice(0, 160) || 'no table in the reply');
  }
  return text.slice(start + 5, end).trim().split('\n').map((line) => line.split(',').map((cell) => cell.trim()));
}

/** The column names of a table: the line just above the row of asterisks that precedes $$SOE. */
export function tableHeader(text) {
  const lines = text.slice(0, text.indexOf('$$SOE')).trimEnd().split('\n');
  return lines[lines.length - 2].split(',').map((cell) => cell.trim());
}

/**
 * State vectors of `target` about the centre of `centre` (Horizons codes: 399 = Earth, 10 = Sun,
 * −170 = Webb …), ICRF, km and km/s. `when` is either a list of Unix times, or
 * { startMs, stopMs, stepMinutes } for an even run. Returns [{ tMs, pos: [x,y,z], vel: [vx,vy,vz] }].
 */
export async function vectors(target, centre, when) {
  const params = { COMMAND: target, EPHEM_TYPE: 'VECTORS', CENTER: `500@${centre}`, REF_PLANE: 'FRAME', OUT_UNITS: 'KM-S', VEC_TABLE: '2' };
  if (Array.isArray(when)) params.TLIST = when.map((ms) => jdText(jdTdb(ms))).join(',');
  else {
    params.START_TIME = `JD ${jdText(jdTdb(when.startMs))}`;
    params.STOP_TIME = `JD ${jdText(jdTdb(when.stopMs))}`;
    params.STEP_SIZE = `${when.stepMinutes} m`;
  }
  return tableRows(await horizons(params)).map((cells) => {
    const numbers = cells.slice(2, 8).map(Number);
    if (numbers.length < 6 || !numbers.every(Number.isFinite)) throw new Error('unreadable vector row');
    return { tMs: Math.round((Number(cells[0]) - 2440587.5) * 86400000 - TT_MINUS_UTC_MS), pos: numbers.slice(0, 3), vel: numbers.slice(3, 6) };
  });
}
