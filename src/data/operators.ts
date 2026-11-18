/**
 * Operator logos, shown beside names on the globe and in the inspector.
 *
 * The logos are not stored in this project. Each operator is matched to its Wikipedia
 * article and the article's lead image (usually the logo) is loaded from Wikipedia the
 * first time it is needed, then remembered in a Map. Offline, or for operators without an
 * article here, or whose lead image turns out not to be a logo, names simply appear alone. Logos are trademarks of their owners
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

export interface Logo {
  url: string;
  /** Mostly dark artwork (a black wordmark, say): draw it in white so it shows against space. */
  dark: boolean;
}

const logos = new Map<string, Logo | null>(); // article → logo; null = none, not a logo, or not loaded yet
const asked = new Set<string>();

function articleFor(operator: string | null): string | null {
  if (!operator) return null;
  for (const [pattern, title] of ARTICLES) if (pattern.test(operator)) return title;
  return null;
}

/**
 * Is this picture really a logo? An article's lead image is sometimes a photograph or a
 * rendering instead. A logo has a transparent background, so: load it, look at the four
 * corners, and accept it only if they are see-through. While the pixels are in hand, also
 * measure how dark the artwork is.
 */
function inspect(url: string): Promise<Logo | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous'; // Wikimedia allows it; needed to read the pixels
    image.referrerPolicy = 'no-referrer';
    image.onerror = () => resolve(null);
    image.onload = () => {
      try {
        const w = 48, h = Math.max(1, Math.round((48 * image.naturalHeight) / Math.max(1, image.naturalWidth)));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(image, 0, 0, w, h);
        const px = ctx.getImageData(0, 0, w, h).data;
        const alpha = (x: number, y: number) => px[(y * w + x) * 4 + 3];
        const cornersClear = alpha(0, 0) < 24 && alpha(w - 1, 0) < 24 && alpha(0, h - 1) < 24 && alpha(w - 1, h - 1) < 24;
        if (!cornersClear) return resolve(null); // a photo or a boxed image: show the name alone
        let light = 0, weight = 0;
        for (let i = 0; i < px.length; i += 4) {
          const a = px[i + 3] / 255;
          light += a * (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
          weight += a;
        }
        resolve({ url, dark: weight > 0 && light / weight < 0.3 });
      } catch {
        resolve(null); // pixels not readable: do without
      }
    };
    image.src = url;
  });
}

/** The logo if it is already known; otherwise null (and the first call starts loading it). */
export function operatorLogo(operator: string | null): Logo | null {
  const article = articleFor(operator);
  if (!article) return null;
  if (!asked.has(article)) void operatorLogoAsync(operator);
  return logos.get(article) ?? null;
}

export async function operatorLogoAsync(operator: string | null): Promise<Logo | null> {
  const article = articleFor(operator);
  if (!article) return null;
  asked.add(article);
  if (!logos.has(article)) {
    logos.set(article, null); // claimed, so parallel callers do not fetch it twice
    const url = (await wikiSummary(article))?.imageUrl;
    logos.set(article, url ? await inspect(url) : null);
  }
  return logos.get(article) ?? null;
}
