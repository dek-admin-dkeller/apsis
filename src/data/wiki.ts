/**
 * Real photographs, a short description and a link, from Wikipedia.
 *
 * There is no photo of each of 19,000 objects, but most belong to a programme that has a
 * Wikipedia article with a lead picture (a Starlink satellite, the ISS, a GPS block…). The
 * object's name is matched to an article title here, and the article's summary is fetched
 * the first time it is needed — one small request per article per session, remembered in
 * a Map. Offline, or when an article has no picture, the inspector keeps its 3D model.
 *
 * Every object gets a link, picture or not:
 *   - its programme's article, when the table below knows one (`articleFor`, `wikiUrl`);
 *   - otherwise its own name is tried once as an article title when it is selected
 *     (`wikiGuess`: "NUSANTARA SATU" has an article of its own that no table lists);
 *   - failing that, Wikipedia's search for the name (`wikiSearchUrl`).
 *
 * The requests carry the article title and nothing else: no identifying headers, no cookies.
 */

import type { Satellite } from './types.ts';

export interface WikiSummary {
  title: string;
  extract: string;
  /** The article's lead picture, when it is a photograph (or anything with a solid background). */
  imageUrl: string | null;
  /** The article's lead picture, when it is a logo instead (see-through background). */
  logoUrl: string | null;
  /** That logo is mostly dark artwork (a black wordmark, say). */
  logoDark: boolean;
  pageUrl: string;
}

/**
 * Photo or logo? An article's lead image is sometimes the programme's logo rather than a
 * picture of the spacecraft (Starlink's is). A logo has a see-through background, so: load
 * the image and call it a logo if a fair share of its pixels are transparent. While the
 * pixels are in hand, measure how dark the artwork is. Returns null if the pixels cannot be
 * read, in which case the image is treated as a photo.
 */
function classify(url: string): Promise<{ logo: boolean; dark: boolean } | null> {
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
        let light = 0, weight = 0, clear = 0;
        for (let i = 0; i < px.length; i += 4) {
          const a = px[i + 3] / 255;
          if (a < 0.1) clear++;
          light += (a * (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2])) / 255;
          weight += a;
        }
        // A photograph fills its frame; artwork on a see-through background does not. (Corners alone
        // are not enough: the Starlink mark runs into two of them.)
        const logo = clear / (px.length / 4) > 0.12;
        resolve({ logo, dark: weight > 0 && light / weight < 0.3 });
      } catch {
        resolve(null);
      }
    };
    image.src = url;
  });
}

/** Name pattern → article title. First match wins, so specific entries come first. */
const ARTICLES: [RegExp, string][] = [
  [/^ISS \(|^ISS$/, 'International Space Station'],
  [/^CSS \(|TIANHE|WENTIAN|MENGTIAN/, 'Tiangong space station'],
  [/^HST$/, 'Hubble Space Telescope'],
  [/CREW DRAGON|^DRAGON /, 'SpaceX Dragon 2'],
  [/^SOYUZ[- ]MS/, 'Soyuz MS'],
  [/^PROGRESS[- ]MS/, 'Progress (spacecraft)'],
  [/^CYGNUS/, 'Cygnus (spacecraft)'],
  [/^TIANZHOU/, 'Tianzhou (spacecraft)'],
  [/^SHENZHOU/, 'Shenzhou (spacecraft)'],
  [/^STARLINK/, 'Starlink'],
  [/^ONEWEB/, 'OneWeb'],
  [/^KUIPER/, 'Project Kuiper'],
  [/^QIANFAN/, 'Qianfan'],
  [/^(GUOWANG|HULIANWANG)/, 'Guowang'],
  [/^(GPS|NAVSTAR)/, 'Global Positioning System'],
  [/^GSAT0|GALILEO/, 'Galileo (satellite navigation)'],
  [/GLONASS|^COSMOS 24\d\d|^COSMOS 25[0-5]\d/, 'GLONASS'],
  [/^BEIDOU/, 'BeiDou'],
  [/^QZS/, 'Quasi-Zenith Satellite System'],
  [/^IRNSS|^NVS-/, 'Indian Regional Navigation Satellite System'],
  [/IRIDIUM 33 DEB|COSMOS 2251 DEB/, '2009 satellite collision'],
  [/FENGYUN 1C DEB/, '2007 Chinese anti-satellite missile test'],
  [/COSMOS 1408/, 'Kosmos 1408'],
  [/^IRIDIUM/, 'Iridium satellite constellation'],
  [/^GLOBALSTAR/, 'Globalstar'],
  [/^ORBCOMM/, 'Orbcomm'],
  [/^LANDSAT 9/, 'Landsat 9'],
  [/^LANDSAT 8/, 'Landsat 8'],
  [/^LANDSAT 7/, 'Landsat 7'],
  [/^SENTINEL-1/, 'Sentinel-1'],
  [/^SENTINEL-2/, 'Sentinel-2'],
  [/^SENTINEL-3/, 'Sentinel-3'],
  [/^SENTINEL-5P/, 'Sentinel-5 Precursor'],
  [/^SENTINEL-6/, 'Sentinel-6 Michael Freilich'],
  [/^NOAA 2[01]/, 'Joint Polar Satellite System'],
  [/^SUOMI NPP/, 'Suomi NPP'],
  [/^NOAA 1\d/, 'NOAA-19'],
  [/^GOES 1[6-9]/, 'GOES-16'],
  [/^GOES /, 'Geostationary Operational Environmental Satellite'],
  [/^METEOSAT/, 'Meteosat'],
  [/^HIMAWARI/, 'Himawari (satellite)'],
  [/^METOP/, 'MetOp'],
  [/^(FENGYUN|FY-)/, 'Fengyun'],
  [/^TERRA$/, 'Terra (satellite)'],
  [/^AQUA$/, 'Aqua (satellite)'],
  [/^AURA$/, 'Aura (satellite)'],
  [/^TDRS/, 'Tracking and Data Relay Satellite System'],
  [/^TERRASAR-X/, 'TerraSAR-X'],
  [/^TANDEM-X/, 'TanDEM-X'],
  [/^SWARM [ABC]$/, 'Swarm (spacecraft)'],
  [/^CRYOSAT/, 'CryoSat-2'],
  [/^ICESAT-2/, 'ICESat-2'],
  [/^GRACE-FO/, 'GRACE-FO'],
  [/^CXO$|CHANDRA/, 'Chandra X-ray Observatory'],
  [/^XMM/, 'XMM-Newton'],
  [/^FGRST|FERMI/, 'Fermi Gamma-ray Space Telescope'],
  [/^SWIFT$/, 'Neil Gehrels Swift Observatory'],
  [/^TESS$/, 'Transiting Exoplanet Survey Satellite'],
  [/^NUSTAR/, 'NuSTAR'],
  [/^IXPE/, 'Imaging X-ray Polarimetry Explorer'],
  [/^SDO$/, 'Solar Dynamics Observatory'],
  [/^IRIS$/, 'Interface Region Imaging Spectrograph'],
  [/^MMS /, 'Magnetospheric Multiscale Mission'],
  [/^THEMIS/, 'THEMIS'],
  [/^INTEGRAL$/, 'Integral (spacecraft)'],
  [/^CHEOPS/, 'CHEOPS'],
  [/^ASTROSAT/, 'AstroSat'],
  [/^XRISM/, 'XRISM'],
  [/^GPM/, 'Global Precipitation Measurement'],
  [/^SMAP$/, 'Soil Moisture Active Passive'],
  [/^OCO[- ]2/, 'Orbiting Carbon Observatory 2'],
  [/^JASON[- ]3/, 'Jason-3'],
  [/^SWOT$/, 'Surface Water and Ocean Topography'],
  [/^PACE$/, 'Plankton, Aerosol, Cloud, ocean Ecosystem'],
  [/^EARTHCARE/, 'EarthCARE'],
  [/^SMOS$/, 'Soil Moisture and Ocean Salinity'],
  [/^PROBA/, 'PROBA'],
  [/^(WORLDVIEW )?LEGION/, 'WorldView Legion'],
  [/^WORLDVIEW/, 'WorldView-3'],
  [/^PLEIADES/, 'Pléiades (satellite)'],
  [/^SPOT \d/, 'SPOT (satellite)'],
  [/^COSMO-SKYMED|^CSG-/, 'COSMO-SkyMed'],
  [/^RCM-|^RADARSAT/, 'RADARSAT Constellation'],
  [/^ALOS/, 'Advanced Land Observing Satellite'],
  [/^KOMPSAT/, 'KOMPSAT'],
  [/^CARTOSAT/, 'Cartosat'],
  [/^RESOURCESAT/, 'Resourcesat-2'],
  [/^INSAT/, 'Indian National Satellite System'],
  [/^GSAT-/, 'GSAT'],
  [/^(FLOCK|DOVE|SUPERDOVE|PELICAN|TANAGER)/, 'Planet Labs'],
  [/^SKYSAT/, 'SkySat'],
  [/^LEMUR/, 'Spire Global'],
  [/^ICEYE/, 'ICEYE'],
  [/^CAPELLA/, 'Capella Space'],
  [/^(BLACKSKY|GLOBAL-\d)/, 'BlackSky'],
  [/^HAWK-/, 'HawkEye 360'],
  [/^SPACEBEE/, 'Swarm Technologies'],
  [/^(BLUEWALKER|BLUEBIRD|SPACEMOBILE)/, 'AST SpaceMobile'],
  [/^O3B/, 'O3b'],
  [/^YAOGAN/, 'Yaogan'],
  [/^GAOFEN/, 'Gaofen'],
  [/^JILIN-1/, 'Jilin-1'],
  [/^SHIJIAN|^SJ-/, 'Shijian'],
  [/^TIANLIAN/, 'Tianlian'],
  [/^(CHINASAT|ZHONGXING)/, 'ChinaSat'],
  [/^HAIYANG|^HY-/, 'Haiyang (satellite)'],
  [/^ZIYUAN|^ZY-/, 'Ziyuan (satellite)'],
  [/^METEOR-M/, 'Meteor-M'],
  [/^ELEKTRO-L/, 'Elektro–L'],
  [/^ARKTIKA-M/, 'Arktika-M'],
  [/^GONETS/, 'Gonets'],
  [/^(EXPRESS|EKSPRESS)/, 'Ekspress'],
  [/^YAMAL/, 'Yamal (satellite constellation)'],
  [/^MOLNIYA/, 'Molniya (satellite)'],
  [/^INTELSAT/, 'Intelsat'],
  [/^(SES|ASTRA)[- ]/, 'SES (company)'],
  [/^(EUTELSAT|HOTBIRD|HOT BIRD)/, 'Eutelsat'],
  [/^INMARSAT/, 'Inmarsat'],
  [/^VIASAT/, 'Viasat (American company)'],
  [/^ECHOSTAR/, 'EchoStar'],
  [/^DIRECTV/, 'DirecTV satellite fleet'],
  [/^(TELSTAR|ANIK|NIMIQ)/, 'Telesat'],
  [/^GALAXY \d/, 'Galaxy (satellite)'],
  [/^(SIRIUS|XM|SXM)[- ]/, 'Sirius XM'],
  [/^THURAYA/, 'Thuraya'],
  [/^ARABSAT|^BADR/, 'Arabsat'],
  [/^TURKSAT/, 'Türksat (satellite)'],
  [/^THAICOM/, 'Thaicom'],
  [/^NILESAT/, 'Nilesat'],
  [/^ASIASAT/, 'AsiaSat'],
  [/^APSTAR/, 'Apstar'],
  [/^(WGS|USA) .*WGS|^WGS/, 'Wideband Global SATCOM'],
  [/^AEHF/, 'Advanced Extremely High Frequency'],
  [/^MUOS/, 'Mobile User Objective System'],
  [/^SBIRS/, 'Space-Based Infrared System'],
  [/^DMSP/, 'Defense Meteorological Satellite Program'],
  [/^SKYNET/, 'Skynet (satellite)'],
  // Science missions filed under a code or a short name.
  [/^DAMPE/, 'Dark Matter Particle Explorer'],
  [/^HINODE/, 'Hinode (satellite)'],
  [/^NEOSSAT/, 'Near Earth Object Surveillance Satellite'],
  [/^HXMT/, 'Hard X-ray Modulation Telescope'],
  [/^EINSTEIN PROBE/, 'Einstein Probe'],
  [/^SVOM/, 'Space Variable Objects Monitor'],
  [/^SPHEREX/, 'SPHEREx'],
  [/^PUNCH-/, 'Polarimeter to Unify the Corona and Heliosphere'],
  [/^TIMED$/, 'TIMED'],
  [/^XPOSAT/, 'XPoSat'],
  [/^ACS3$/, 'Solar sail'],
  [/^BIOMASS$/, 'Biomass (satellite)'],
  [/^POLAR$/, 'Polar (satellite)'],
  [/^LAGEOS/, 'LAGEOS'],
  [/^CYGFM/, 'Cyclone Global Navigation Satellite System'],
  [/^GOSAT/, 'Greenhouse Gases Observing Satellite'],
  // The largest families that had no article at all (counted in public/data/satellites.json).
  [/^GEESAT/, 'Geespace'],
  [/^(PRAETORIAN |SDA[-_ ])/, 'Space Development Agency'],
  [/^SITRO-AIS/, 'Sitronics'],
  [/^SHIYAN/, 'Shiyan (satellite)'],
  [/^RASSVET/, 'Bureau 1440'],
  [/^TJS/, 'Tongxin Jishu Shiyan'],
  [/^ION SCV/, 'ION Satellite Carrier'],
  [/^USA \d/, 'List of USA satellites'],
  [/^NUSAT/, 'ÑuSat'],
  [/^IRIDE/, 'IRIDE'],
  [/^PIESAT/, 'Hongtu-1'],
  [/^TOMORROW/, 'Tomorrow.io'],
  [/^QPS-SAR/, 'IQPS'],
  [/^GHGSAT/, 'GHGSat'],
  [/^STRIX/, 'Synspective'],
  [/^APRIZESAT/, 'AprizeSat'],
  [/^FOREST-/, 'OroraTech'],
  [/^JCSAT/, 'JSAT (satellite constellation)'],
  [/^FORMOSAT/, 'Taiwan Space Agency'],
  [/^SATELIOT/, 'Sateliot'],
  [/^FOSSASAT/, 'FOSSA Systems'],
  [/^KOREASAT/, 'Koreasat'],
  [/^ABS[- ]\d/, 'ABS (satellite operator)'],
  [/^BSAT/, 'Broadcasting Satellite System Corporation'],
  [/^ASTROCAST/, 'Astrocast'],
  [/^KEPLER/, 'Kepler Communications'],
  [/^LYNK/, 'Lynk Global'],
  [/^UFO /, 'UHF Follow-On satellite'],
  [/^(AMAZONAS|HISPASAT)/, 'Hispasat'],
  [/^MERIDIAN/, 'Meridian (satellite)'],
  [/^KANOPUS/, 'Kanopus'],
  [/^(HUANJING|HJ-)/, 'Huanjing (satellite)'],
  [/^HELLAS[- ]SAT/, 'Hellas Sat'],
  [/^SYRACUSE/, 'Syracuse (satellite)'],
  [/^THOR \d/, 'Thor (satellite)'],
  [/^STAR ONE/, 'Star One (satellite operator)'],
  [/^AMOS[- ]/, 'AMOS (satellite)'],
  [/^MEASAT/, 'MEASAT Satellite Systems'],
  [/^HYLAS/, 'Avanti Communications'],
  [/^LUCH/, 'Luch (satellite)'],
  [/^RISAT/, 'RISAT'],
  [/^OPTUS/, 'Optus (satellite)'],
  [/^DUBAISAT/, 'DubaiSat-1'],
  [/^CZ-\d.* R\/B/, 'Long March (rocket family)'],
  [/^COSMOS \d/, 'Kosmos (satellite)'], // last: the navigation and debris Cosmos entries above come first
];

export function articleFor(sat: Satellite): string | null {
  const name = sat.name.toUpperCase();
  for (const [pattern, title] of ARTICLES) if (pattern.test(name)) return title;
  return null;
}

const cache = new Map<string, Promise<WikiSummary | null>>();

/** The address of an article whose title is known (no request needed to make the link). */
export const wikiUrl = (title: string): string => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

/** Wikipedia's own search for a name: where the link goes when no article is known. */
export const wikiSearchUrl = (text: string): string => `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(text)}`;

/** Summary of one article (null if offline, missing, or not a normal article). */
export function wikiSummary(title: string): Promise<WikiSummary | null> {
  let hit = cache.get(title);
  if (!hit) {
    hit = load(title);
    cache.set(title, hit);
  }
  return hit;
}

/** A fetch that gives up after six seconds, so a slow answer never leaves a panel waiting. */
async function getJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok ? await res.json() : null;
  } finally {
    clearTimeout(timer);
  }
}

/** Sort an article's lead picture into photo or logo and put the summary together. */
async function summarise(title: string, extract: string, picture: string | null, pageUrl: string): Promise<WikiSummary> {
  const kind = picture ? await classify(picture) : null;
  // If the pixels could not be read (a blocked or rate-limited download), fall back on the
  // file type: a lead image drawn as vector art (.svg) is a logo or a diagram, never a photo.
  const isLogo = kind ? kind.logo : !!picture && /\.svg/i.test(picture);
  return {
    title,
    extract,
    imageUrl: isLogo ? null : picture,
    logoUrl: isLogo ? picture : null,
    logoDark: isLogo && (kind ? kind.dark : true), // unknown artwork is drawn white: safe on the dark interface
    pageUrl,
  };
}

async function load(title: string): Promise<WikiSummary | null> {
  try {
    const page = (await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`)) as {
      type?: string; title?: string; extract?: string;
      thumbnail?: { source?: string };
      content_urls?: { desktop?: { page?: string } };
    } | null;
    if (!page || page.type !== 'standard') return null;
    return await summarise(page.title ?? title, page.extract ?? '', page.thumbnail?.source ?? null, page.content_urls?.desktop?.page ?? wikiUrl(title));
  } catch {
    return null; // offline or blocked: the inspector keeps the 3D model
  }
}

// ---------------------------------------------------------------- objects no table lists

/** An object's name as it would be searched for: no bracketed aside, no catalogue suffix. "NUSAT-57 (EDMEE CHANDON)" → "NUSAT-57". */
export function plainName(sat: Satellite): string {
  return sat.name.replace(/\s*\(.*$/, '').replace(/\s+(DEB|R\/B)\b.*$/i, '').trim() || sat.name;
}

/** "KOREASAT 6A" → "Koreasat 6A": words of letters are written as a title has them; codes and numbers stay as they are. */
function asTitle(name: string): string {
  return name.replace(/[A-Z]{4,}/g, (word) => word[0] + word.slice(1).toLowerCase());
}

/** Does this text read like the article of something in space? (A satellite called HERMES must not link to the Greek god.) */
const ABOUT_SPACE = /satellite|spacecraft|space|orbit|launch|rocket|constellation|telescope|cubesat/i;

/**
 * An object the table does not know: try its own name as an article title, once. One request
 * asks for the name as the catalogue writes it and as a title would ("NUSANTARA SATU",
 * "Nusantara Satu", and with a hyphen before a final number); redirects are followed. A missing page, a disambiguation page or an article
 * about something that is not in space all count as "no article" (null).
 *
 * This uses Wikipedia's query API rather than the summary address used above, because that
 * one answers "no such page" with an error status, which the browser prints in the console
 * for every object without an article; the query API answers the same question with a plain
 * "missing". Fragments and rocket bodies are not asked about: they have no articles of their own.
 */
export function wikiGuess(sat: Satellite): Promise<WikiSummary | null> {
  if (sat.category === 'Debris' || /\b(DEB|R\/B)\b/i.test(sat.name)) return Promise.resolve(null);
  const name = plainName(sat);
  const key = `guess:${name}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = guess(name);
    cache.set(key, hit);
  }
  return hit;
}

interface QueryPage {
  title?: string;
  missing?: boolean;
  extract?: string;
  thumbnail?: { source?: string };
  pageprops?: { disambiguation?: string };
  fullurl?: string;
}

async function guess(name: string): Promise<WikiSummary | null> {
  try {
    const joined = name.replace(/ (?=\d)/, '-'); // "AZERSPACE 1" is written "Azerspace-1" as often as not
    const titles = [...new Set([name, asTitle(name), joined, asTitle(joined)])];
    const data = (await getJson(
      'https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*&redirects=1'
      + '&prop=extracts%7Cpageimages%7Cpageprops%7Cinfo&exintro=1&explaintext=1&exsentences=3&piprop=thumbnail&pithumbsize=640&ppprop=disambiguation&inprop=url'
      + `&titles=${encodeURIComponent(titles.join('|'))}`,
    )) as { query?: { pages?: QueryPage[] } } | null;
    const page = data?.query?.pages?.find((p) => !p.missing && p.title && p.pageprops?.disambiguation === undefined && ABOUT_SPACE.test(p.extract ?? ''));
    if (!page) return null;
    return await summarise(page.title!, page.extract ?? '', page.thumbnail?.source ?? null, page.fullurl ?? wikiUrl(page.title!));
  } catch {
    return null; // offline or blocked: the link stays a search
  }
}
