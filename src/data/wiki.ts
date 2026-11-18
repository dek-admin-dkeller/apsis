/**
 * Real photographs and a short description, from Wikipedia.
 *
 * There is no photo of each of 19,000 objects, but most belong to a programme that has a
 * Wikipedia article with a lead picture (a Starlink satellite, the ISS, a GPS block…). The
 * object's name is matched to an article title here, and the article's summary is fetched
 * the first time it is needed — one small request per article per session, remembered in
 * a Map. Offline, or when an article has no picture, the inspector keeps its 3D model.
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
  [/^(FLOCK|DOVE|SUPERDOVE)/, 'Planet Labs'],
  [/^SKYSAT/, 'SkySat'],
  [/^LEMUR/, 'Spire Global'],
  [/^ICEYE/, 'ICEYE'],
  [/^CAPELLA/, 'Capella Space'],
  [/^(BLACKSKY|GLOBAL-\d)/, 'BlackSky'],
  [/^HAWK-/, 'HawkEye 360'],
  [/^SPACEBEE/, 'Swarm Technologies'],
  [/^(BLUEWALKER|BLUEBIRD)/, 'AST SpaceMobile'],
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
  [/^(SIRIUS|XM)[- ]/, 'Sirius XM'],
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
];

export function articleFor(sat: Satellite): string | null {
  const name = sat.name.toUpperCase();
  for (const [pattern, title] of ARTICLES) if (pattern.test(name)) return title;
  return null;
}

const cache = new Map<string, Promise<WikiSummary | null>>();

/** Summary of one article (null if offline, missing, or not a normal article). */
export function wikiSummary(title: string): Promise<WikiSummary | null> {
  let hit = cache.get(title);
  if (!hit) {
    hit = load(title);
    cache.set(title, hit);
  }
  return hit;
}

async function load(title: string): Promise<WikiSummary | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const page = (await res.json()) as {
      type?: string; title?: string; extract?: string;
      thumbnail?: { source?: string };
      content_urls?: { desktop?: { page?: string } };
    };
    if (page.type !== 'standard') return null;
    const picture = page.thumbnail?.source ?? null;
    const kind = picture ? await classify(picture) : null;
    // If the pixels could not be read (a blocked or rate-limited download), fall back on the
    // file type: a lead image drawn as vector art (.svg) is a logo or a diagram, never a photo.
    const isLogo = kind ? kind.logo : !!picture && /\.svg/i.test(picture);
    return {
      title: page.title ?? title,
      extract: page.extract ?? '',
      imageUrl: isLogo ? null : picture,
      logoUrl: isLogo ? picture : null,
      logoDark: isLogo && (kind ? kind.dark : true), // unknown artwork is drawn white: safe on the dark interface
      pageUrl: page.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    };
  } catch {
    return null; // offline or blocked: the inspector keeps the 3D model
  }
}
