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
