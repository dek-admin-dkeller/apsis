/**
 * Operator logos, shown beside names on the globe and in the inspector.
 *
 * The logos are not stored in this project. Each operator is matched to its Wikipedia
 * article and the article's lead image (usually the logo) is loaded from Wikipedia the
 * first time it is needed, then remembered in a Map. Offline, or for operators without an
 * article here, names simply appear without a logo. Logos are trademarks of their owners
 * and are shown only to identify who operates an object.
 */

import { wikiSummary } from './wiki.ts';

/** Operator text (as inferred in describe.ts) → article title. First match wins. */
const ARTICLES: [RegExp, string][] = [
  [/SpaceX/i, 'SpaceX'],
  [/OneWeb/i, 'Eutelsat OneWeb'],
  [/^NASA|NASA,|NASA \//, 'NASA'],
  [/NOAA/, 'National Oceanic and Atmospheric Administration'],
  [/EUMETSAT/, 'European Organisation for the Exploitation of Meteorological Satellites'],
  [/ESA|European Union/, 'European Space Agency'],
  [/Roscosmos|^Russia/, 'Roscosmos'],
  [/China Manned/, 'China Manned Space Agency'],
  [/China Meteorological/, 'China Meteorological Administration'],
  [/^China$|China SatNet|Spacesail/, 'China National Space Administration'],
  [/ISRO/, 'ISRO'],
  [/JAXA|^Japan$/, 'JAXA'],
  [/Japan Meteorological/, 'Japan Meteorological Agency'],
  [/Amazon/, 'Project Kuiper'],
  [/Iridium/, 'Iridium Communications'],
  [/Globalstar/, 'Globalstar'],
  [/ORBCOMM/i, 'Orbcomm'],
  [/Planet Labs/, 'Planet Labs'],
  [/Spire/, 'Spire Global'],
  [/Space Force/, 'United States Space Force'],
  [/Intelsat/, 'Intelsat'],
  [/^SES$/, 'SES (company)'],
  [/Eutelsat/, 'Eutelsat'],
  [/Viasat|Inmarsat/, 'Viasat (American company)'],
  [/Northrop/, 'Northrop Grumman'],
  [/Maxar|Vantor/, 'Maxar Technologies'],
  [/ICEYE/, 'ICEYE'],
  [/Capella/, 'Capella Space'],
  [/AST SpaceMobile/, 'AST SpaceMobile'],
  [/DLR|Airbus/, 'German Aerospace Center'],
];

const logos = new Map<string, string | null>(); // article → image URL; null = none, or not loaded yet
const asked = new Set<string>();

function articleFor(operator: string | null): string | null {
  if (!operator) return null;
  for (const [pattern, title] of ARTICLES) if (pattern.test(operator)) return title;
  return null;
}

/** The logo if it is already known; otherwise null (and the first call starts loading it). */
export function operatorLogo(operator: string | null): string | null {
  const article = articleFor(operator);
  if (!article) return null;
  if (!asked.has(article)) void operatorLogoAsync(operator);
  return logos.get(article) ?? null;
}

export async function operatorLogoAsync(operator: string | null): Promise<string | null> {
  const article = articleFor(operator);
  if (!article) return null;
  asked.add(article);
  if (!logos.has(article)) logos.set(article, (await wikiSummary(article))?.imageUrl ?? null);
  return logos.get(article) ?? null;
}
