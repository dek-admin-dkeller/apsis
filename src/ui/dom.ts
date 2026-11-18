/** Tiny DOM + number-formatting helpers shared by the UI modules. */

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

export const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-US');

export const fmt = (n: number, digits: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Big counts in a compact form: 191,521,806 → "191.5 M". */
export function fmtCompact(n: number): string {
  if (n >= 1e9) return fmt(n / 1e9, 2) + ' B';
  if (n >= 1e6) return fmt(n / 1e6, 1) + ' M';
  return fmtInt(n);
}

// ---- units and clock (Settings → Units) ---------------------------------------------------
//
// The simulation works in kilometres, km/s and UTC throughout. Only the very last step — the
// text put on screen — is converted, and it all goes through the helpers below, so one
// setting changes every panel at once.

export type Units = 'metric' | 'imperial';
export type ClockZone = 'utc' | 'local';

let units: Units = 'metric';
let clockZone: ClockZone = 'utc';
const MILES_PER_KM = 0.621371;
const FEET_PER_KM = 3280.84;

export const setUnits = (next: Units): void => void (units = next);
export const setClockZone = (next: ClockZone): void => void (clockZone = next);
export const getUnits = (): Units => units;
export const getClockZone = (): ClockZone => clockZone;

/** The name of the length unit in use: "km" or "mi" (for axis labels and column headings). */
export const lengthUnit = (): string => (units === 'metric' ? 'km' : 'mi');
/** A length in km as a bare number in the chosen unit (for charts that draw their own labels). */
export const lengthValue = (km: number): number => (units === 'metric' ? km : km * MILES_PER_KM);

/** A length given in km, with its unit: "412 km" or "256 mi". */
export const fmtKm = (km: number, digits = 0): string => `${fmt(lengthValue(km), digits)} ${lengthUnit()}`;

/** A short distance given in km: metres or feet below one kilometre, two decimals above. */
export function fmtRange(km: number): string {
  if (!Number.isFinite(km)) return '–';
  if (km >= 1) return fmtKm(km, 2);
  return units === 'metric' ? `${fmtInt(km * 1000)} m` : `${fmtInt(km * FEET_PER_KM)} ft`;
}

/** A speed given in km/s: "7.66 km/s" or "17,134 mph". */
export const fmtKmS = (kmS: number, digits = 2): string =>
  units === 'metric' ? `${fmt(kmS, digits)} km/s` : `${fmtInt(kmS * 3600 * MILES_PER_KM)} mph`;

/** A slow speed given in km/s (two objects drifting apart): "12 m/s" or "27 mph". */
export const fmtSlow = (kmS: number): string =>
  units === 'metric' ? `${fmt(kmS * 1000, kmS < 0.01 ? 1 : 0)} m/s` : `${fmt(kmS * 3600 * MILES_PER_KM, kmS < 0.01 ? 1 : 0)} mph`;
