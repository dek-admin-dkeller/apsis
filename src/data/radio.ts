/**
 * Radio records: which transmitters an object carries, and when a ground station last
 * received it.
 *
 * Source: SatNOGS (satnogs.org), a network of volunteer ground stations. Its APIs cannot be
 * called from a web page (they send no Access-Control-Allow-Origin header), so
 * `npm run fetch-radio` saves a compact copy to public/data/radio.json at build time and this
 * file only unpacks it. The file is optional: without it the inspector says so in one line.
 *
 * "Last heard" is honest about its limits. The script reads only the newest few hundred
 * observations of the whole network, so the file also says how far back it looked
 * (`heardFromMs`); for an object with no report the right sentence is "not picked up in the
 * N hours before …", never "never heard".
 *
 * Stored in a Map keyed by NORAD id, so the lookup for the selected object is O(1).
 */

import { fetchData } from './freshness.ts';

export interface Transmitter {
  description: string;
  downlinkHz: number | null; // what the satellite sends, i.e. what a ground station tunes to
  downlinkHighHz: number | null; // upper edge of a transponder's passband, otherwise null
  uplinkHz: number | null;
  mode: string; // "FM", "BPSK", … ("" when SatNOGS does not know)
  baud: number | null;
  active: boolean; // SatNOGS marks each transmitter active or inactive
  unconfirmed: boolean; // listed, but nobody has confirmed it yet
  service: string; // "Amateur", "Meteorological", … ("" when not stated)
}

export interface Heard {
  observationId: number; // the report on network.satnogs.org
  timeMs: number; // end of the pass in which it was received
  station: string;
  latDeg: number | null;
  lonDeg: number | null;
  /** Which of the object's transmitters the station was tuned to (index into `transmitters`), or −1 if unknown. */
  transmitter: number;
}

export interface RadioRecord {
  /** SatNOGS's word for the satellite: "in orbit", "re-entered", "future" (older data: "alive", "dead"). */
  status: string;
  transmitters: Transmitter[]; // active ones first, then by frequency
  heard: Heard | null;
  /**
   * Set when SatNOGS has NOT matched its satellite to this tracked object for certain: it only
   * listens for a satellite of this name along this object's orbit. Empty for a firm match.
   */
  filedAs: string;
  /** The number SatNOGS's own pages know it by (differs from the NORAD id only when `filedAs` is set). */
  satnogsId: number;
}

export interface RadioData {
  madeMs: number; // when the file was put together
  /** Reception reports were read from this instant up to `madeMs`; nothing earlier was looked at. */
  heardFromMs: number;
  byId: Map<number, RadioRecord>; // NORAD id → record (the hash table this module is built around)
}

// ---- the file's compact layout (written by scripts/fetch-radio.mjs) -------------------------

type TransmitterRow = [description: string, downHz: number, downHighHz: number, upHz: number, mode: number, baud: number, flags: number, service: number];
type HeardRow = [observationId: number, endUnixSeconds: number, station: number, transmitter: number];
type SatRow = [noradId: number, status: number, transmitters: TransmitterRow[], heard: HeardRow | 0, filedAs?: string, satnogsId?: number];

interface RadioFile {
  fetchedAt: string;
  heardFrom: string;
  statuses: string[];
  modes: string[];
  services: string[];
  stations: [name: string, latDeg: number | null, lonDeg: number | null][];
  sats: SatRow[];
}

/**
 * Read public/data/radio.json. Null when it is not bundled or cannot be read. `fresh` asks the
 * site before trusting the browser's cached copy (data/freshness.ts).
 */
export async function loadRadio(fresh = false): Promise<RadioData | null> {
  try {
    const res = await fetchData('./data/radio.json', fresh);
    if (!res.ok) return null;
    const file = (await res.json()) as RadioFile;
    const madeMs = Date.parse(file.fetchedAt);
    const heardFromMs = Date.parse(file.heardFrom);
    if (!Number.isFinite(madeMs) || !Array.isArray(file.sats)) return null;

    const byId = new Map<number, RadioRecord>();
    for (const [noradId, status, rows, heard, filedAs, satnogsId] of file.sats) {
      const transmitters = rows.map(([description, down, downHigh, up, mode, baud, flags, service]): Transmitter => ({
        description,
        downlinkHz: down || null, // 0 in the file means "not given"
        downlinkHighHz: downHigh || null,
        uplinkHz: up || null,
        mode: file.modes[mode] ?? '',
        baud: baud || null,
        active: (flags & 1) !== 0,
        unconfirmed: (flags & 2) !== 0,
        service: file.services[service] ?? '',
      }));
      const station = heard ? file.stations[heard[2]] : undefined;
      byId.set(noradId, {
        status: file.statuses[status] ?? '',
        transmitters,
        heard: heard
          ? {
              observationId: heard[0], timeMs: heard[1] * 1000,
              station: station?.[0] ?? '', latDeg: station?.[1] ?? null, lonDeg: station?.[2] ?? null,
              transmitter: heard[3] ?? -1,
            }
          : null,
        filedAs: filedAs ?? '',
        satnogsId: satnogsId ?? noradId,
      });
    }
    return { madeMs, heardFromMs: Number.isFinite(heardFromMs) ? heardFromMs : madeMs, byId };
  } catch {
    return null; // not bundled, offline before the first visit, or a damaged file: carry on without it
  }
}

/** "437.800 MHz": three decimals is the kilohertz, which is how frequencies are published. */
export const megahertz = (hz: number, digits = 3): string =>
  `${(hz / 1e6).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })} MHz`;
