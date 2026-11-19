/**
 * Readable names for objects the catalogue lists under a code.
 *
 * The tracking catalogue calls the telescope everyone knows as Hubble "HST", and Chandra
 * "CXO". Where the catalogue's name is a code like that, the name people know is shown first
 * and the code after it: "Hubble Space Telescope (HST)". Used wherever an object's name is
 * the headline (the inspector's title, the hover card, the search suggestions); lists that
 * must stay narrow, the name tags on the globe and everything that feeds the simulation keep
 * the catalogue's own name, and the catalogue data itself is never changed.
 *
 * One small hash table, Map<catalogue name, full name>: a single lookup per object shown.
 * Only programmes whose catalogue name really is a code are listed. "NUSTAR" or "XMM-NEWTON"
 * are already what people call them.
 */

import { COMMON_NAMES } from './catalog.ts';
import type { Satellite } from './types.ts';

const FULL_NAMES = new Map<string, string>([
  ['HST', 'Hubble Space Telescope'],
  ['CXO', 'Chandra X-ray Observatory'],
  ['FGRST (GLAST)', 'Fermi Gamma-ray Space Telescope'],
  ['ISS (ZARYA)', 'International Space Station'],
  ['CSS (TIANHE)', 'Tiangong space station'],
  ['SDO', 'Solar Dynamics Observatory'],
  ['IXPE', 'Imaging X-ray Polarimetry Explorer'],
  ['XRISM', 'X-Ray Imaging and Spectroscopy Mission'],
  ['HXMT (HUIYAN)', 'Hard X-ray Modulation Telescope'],
  ['SVOM', 'Space Variable Objects Monitor'],
  ['DAMPE', 'Dark Matter Particle Explorer'],
  ['CHEOPS', 'Characterising Exoplanet Satellite'],
  ['NEOSSAT', 'Near-Earth Object Surveillance Satellite'],
  ['XPOSAT', 'X-ray Polarimeter Satellite'],
  ['IRIS', 'Interface Region Imaging Spectrograph'],
  ['ACS3', 'Advanced Composite Solar Sail System'],
  ['SMAP', 'Soil Moisture Active Passive'],
  ['SMOS', 'Soil Moisture and Ocean Salinity'],
  ['SWOT', 'Surface Water and Ocean Topography'],
  ['GPM-CORE', 'Global Precipitation Measurement'],
  ['OCO 2', 'Orbiting Carbon Observatory 2'],
  ['MMS 1', 'Magnetospheric Multiscale 1'],
  ['MMS 2', 'Magnetospheric Multiscale 2'],
  ['MMS 3', 'Magnetospheric Multiscale 3'],
  ['MMS 4', 'Magnetospheric Multiscale 4'],
]);

/** The other way round from COMMON_NAMES: catalogue name → what people type for it. Built once. */
const NICKNAMES = new Map<string, string[]>();
for (const [typed, name] of COMMON_NAMES) {
  const list = NICKNAMES.get(name);
  if (list) list.push(typed);
  else NICKNAMES.set(name, [typed]);
}

/** The name to show as a headline: "Hubble Space Telescope (HST)", or the catalogue's name when that is already readable. */
export function displayName(sat: Satellite): string {
  const full = FULL_NAMES.get(sat.name.toUpperCase());
  if (!full) return sat.name;
  const code = sat.name.replace(/\s*\(.*\)\s*$/, ''); // "FGRST (GLAST)" → "FGRST"
  return `${full} (${code})`;
}

/** Everything an object may be looked up by: its catalogue name, its full name, its nicknames. */
export function searchNames(sat: Satellite): string[] {
  const key = sat.name.toUpperCase();
  const names = [sat.name];
  const full = FULL_NAMES.get(key);
  if (full) names.push(full);
  const also = NICKNAMES.get(key);
  if (also) names.push(...also);
  return names;
}
