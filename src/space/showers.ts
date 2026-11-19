/**
 * The annual meteor showers: when each is active, when it peaks, and where in the sky it
 * comes from.
 *
 * A shower happens when the Earth crosses the trail of dust a comet (or, twice, an asteroid)
 * has left along its orbit. The Earth is at the same place in its own orbit on the same date
 * each year, so showers keep to the calendar. Astronomers pin the peak not to a date but to the
 * Sun's ecliptic longitude as seen from the Earth (that IS the Earth's place in its orbit),
 * because the calendar slips by a quarter of a day a year until a leap day pulls it back.
 * showerPeak() solves for the moment the Sun reaches that longitude, with the app's own
 * ephemeris, so the peak comes out to within an hour or so for any year.
 *
 * The table is the International Meteor Organization's working list, cut down to the showers
 * worth going outside for (and the Taurids, which are few but famous for fireballs). "Rate" is
 * the zenithal hourly rate: what one watcher would count under a perfectly dark sky with the
 * radiant overhead. Real counts are usually a third to a half of it.
 *
 * Pure arithmetic: no DOM, importable by Node.
 */

import { bodyPosition } from './ephem.ts';

export interface Shower {
  name: string;
  /** The IMO's three-letter code. */
  code: string;
  /** First and last day of activity, [month, day]; the Quadrantids start in December and end in January. */
  start: [number, number];
  end: [number, number];
  /** The usual date of the peak, [month, day]: where showerPeak() starts looking. */
  peak: [number, number];
  /** The Sun's ecliptic longitude at the peak, degrees (equinox J2000). */
  peakSunLon: number;
  /** Zenithal hourly rate at the peak. */
  rate: number;
  /** The radiant: the point the meteors seem to spread from. Right ascension and declination, degrees. */
  raDeg: number;
  decDeg: number;
  /** The constellation the radiant is in (and the shower is named after). */
  radiant: string;
  /** What left the dust. */
  parent: string;
  /** How fast the meteors hit the atmosphere, km/s. */
  speedKmS: number;
}

export const SHOWERS: Shower[] = [
  { name: 'Quadrantids', code: 'QUA', start: [12, 28], end: [1, 12], peak: [1, 3], peakSunLon: 283.15, rate: 80, raDeg: 230, decDeg: 49, radiant: 'Boötes', parent: 'asteroid 2003 EH1', speedKmS: 41 },
  { name: 'Lyrids', code: 'LYR', start: [4, 14], end: [4, 30], peak: [4, 22], peakSunLon: 32.32, rate: 18, raDeg: 271, decDeg: 34, radiant: 'Lyra', parent: 'comet Thatcher', speedKmS: 49 },
  { name: 'Eta Aquariids', code: 'ETA', start: [4, 19], end: [5, 28], peak: [5, 6], peakSunLon: 45.5, rate: 50, raDeg: 338, decDeg: -1, radiant: 'Aquarius', parent: 'comet Halley', speedKmS: 66 },
  { name: 'Southern Delta Aquariids', code: 'SDA', start: [7, 12], end: [8, 23], peak: [7, 30], peakSunLon: 127, rate: 25, raDeg: 340, decDeg: -16, radiant: 'Aquarius', parent: 'comet Machholz', speedKmS: 41 },
  { name: 'Perseids', code: 'PER', start: [7, 17], end: [8, 24], peak: [8, 12], peakSunLon: 140, rate: 100, raDeg: 48, decDeg: 58, radiant: 'Perseus', parent: 'comet Swift–Tuttle', speedKmS: 59 },
  { name: 'Draconids', code: 'DRA', start: [10, 6], end: [10, 10], peak: [10, 8], peakSunLon: 195.4, rate: 10, raDeg: 262, decDeg: 54, radiant: 'Draco', parent: 'comet Giacobini–Zinner', speedKmS: 20 },
  { name: 'Orionids', code: 'ORI', start: [10, 2], end: [11, 7], peak: [10, 21], peakSunLon: 208, rate: 20, raDeg: 95, decDeg: 16, radiant: 'Orion', parent: 'comet Halley', speedKmS: 66 },
  { name: 'Southern Taurids', code: 'STA', start: [9, 20], end: [11, 20], peak: [11, 5], peakSunLon: 223, rate: 7, raDeg: 52, decDeg: 15, radiant: 'Taurus', parent: 'comet Encke', speedKmS: 27 },
  { name: 'Northern Taurids', code: 'NTA', start: [10, 20], end: [12, 10], peak: [11, 12], peakSunLon: 230, rate: 5, raDeg: 58, decDeg: 22, radiant: 'Taurus', parent: 'comet Encke', speedKmS: 29 },
  { name: 'Leonids', code: 'LEO', start: [11, 6], end: [11, 30], peak: [11, 17], peakSunLon: 235.27, rate: 15, raDeg: 152, decDeg: 22, radiant: 'Leo', parent: 'comet Tempel–Tuttle', speedKmS: 71 },
  { name: 'Geminids', code: 'GEM', start: [12, 4], end: [12, 20], peak: [12, 14], peakSunLon: 262.2, rate: 150, raDeg: 112, decDeg: 33, radiant: 'Gemini', parent: 'asteroid 3200 Phaethon', speedKmS: 35 },
  { name: 'Ursids', code: 'URS', start: [12, 17], end: [12, 26], peak: [12, 22], peakSunLon: 270.7, rate: 10, raDeg: 217, decDeg: 76, radiant: 'Ursa Minor', parent: 'comet Tuttle', speedKmS: 33 },
];

const DAY_MS = 86400000;
const OBLIQUITY = (23.4392911 * Math.PI) / 180;

/**
 * The Sun's ecliptic longitude seen from the Earth, degrees 0–360 (ecliptic and equinox of
 * J2000): 0 at the March equinox, 90 at the June solstice.
 */
export function solarLongitude(tMs: number): number {
  const earth = bodyPosition('earth', tMs);
  // The Sun from the Earth is minus the Earth from the Sun; then tip the equator onto the ecliptic.
  const x = -earth[0], y = -(earth[1] * Math.cos(OBLIQUITY) + earth[2] * Math.sin(OBLIQUITY));
  const lon = (Math.atan2(y, x) * 180) / Math.PI;
  return lon < 0 ? lon + 360 : lon;
}

/** One year's appearance of a shower. */
export interface ShowerTime {
  shower: Shower;
  /** From the first moment of its first day to the last moment of its last (UTC), Unix ms. */
  startMs: number;
  endMs: number;
  peakMs: number;
}

/** The peak of a shower in a given calendar year: the moment the Sun reaches the shower's longitude. */
export function showerPeak(shower: Shower, year: number): number {
  let t = Date.UTC(year, shower.peak[0] - 1, shower.peak[1], 12);
  // The Sun moves 0.9856° a day on average; three steps of Newton's method are exact to seconds.
  for (let i = 0; i < 4; i++) {
    const off = ((shower.peakSunLon - solarLongitude(t) + 540) % 360) - 180;
    t += (off / 0.9856) * DAY_MS;
  }
  return Math.round(t);
}

/** The appearance of a shower whose peak falls in `year`. */
function appearance(shower: Shower, year: number): ShowerTime {
  // A start month after the peak's month means it began the December before; likewise the end.
  const startYear = shower.start[0] > shower.peak[0] ? year - 1 : year;
  const endYear = shower.end[0] < shower.peak[0] ? year + 1 : year;
  return {
    shower,
    startMs: Date.UTC(startYear, shower.start[0] - 1, shower.start[1]),
    endMs: Date.UTC(endYear, shower.end[0] - 1, shower.end[1]) + DAY_MS - 1,
    peakMs: showerPeak(shower, year),
  };
}

/** The showers active at `tMs`, the one nearest its peak first. */
export function activeShowers(tMs: number): ShowerTime[] {
  const year = new Date(tMs).getUTCFullYear();
  const found: ShowerTime[] = [];
  for (const shower of SHOWERS) {
    for (const y of [year - 1, year, year + 1]) {
      const time = appearance(shower, y);
      if (tMs >= time.startMs && tMs <= time.endMs) found.push(time);
    }
  }
  return found.sort((a, b) => Math.abs(a.peakMs - tMs) - Math.abs(b.peakMs - tMs));
}

/** The next `count` showers that have not started yet at `tMs`, soonest first. */
export function nextShowers(tMs: number, count = 3): ShowerTime[] {
  const year = new Date(tMs).getUTCFullYear();
  const found: ShowerTime[] = [];
  for (const shower of SHOWERS) {
    // The first appearance that starts after now: this year's, or next year's if that has begun or gone.
    const time = [year, year + 1, year + 2].map((y) => appearance(shower, y)).find((candidate) => candidate.startMs > tMs);
    if (time) found.push(time);
  }
  return found.sort((a, b) => a.startMs - b.startMs).slice(0, count);
}
