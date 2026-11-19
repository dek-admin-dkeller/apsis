/**
 * Human-friendly profile of an object: who operates it, what it is for, and which 3D model
 * shape represents it. The orbital-element data contains none of this, so everything here
 * is INFERRED FROM THE NAME using a table of well-known programmes — a best guess that is
 * labelled as such in the UI.
 */

import type { Satellite } from './types.ts';

export type ModelKind =
  | 'starlink' | 'oneweb' | 'comsat' | 'geocomsat' | 'gnss'
  | 'smallsat' | 'cubesat'
  | 'observer' | 'radarsat' | 'weather' | 'spinner' | 'telescope'
  | 'iss' | 'tiangong' | 'station'
  | 'dragon' | 'soyuz' | 'cygnus' | 'capsule'
  | 'rocketbody' | 'debris'
  | 'lasersphere' | 'relay' | 'phasedarray'
  // Beyond Earth orbit (render/deepModels.ts). The deep-space data file names these as plain
  // strings, so the spelling here is a contract: check with isModelKind before trusting one.
  | 'webb' | 'euclid' | 'tess' | 'chandra' | 'xmm' | 'soho' | 'l1monitor' | 'stereo'
  | 'parker' | 'solarorbiter' | 'bepi'
  | 'voyager' | 'pioneer' | 'newhorizons' | 'probe'
  | 'juno' | 'clipper' | 'lucy' | 'psyche' | 'samplereturn'
  | 'lunarorbiter' | 'marsorbiter' | 'rover' | 'lander'
  | 'asteroid';

export interface Profile {
  kind: ModelKind;
  operator: string | null;
  purpose: string;
}

// [name pattern, operator, purpose] — first match wins.
const PROGRAMMES: [RegExp, string, string][] = [
  [/^STARLINK/, 'SpaceX', 'Broadband internet constellation'],
  [/^ONEWEB/, 'Eutelsat OneWeb', 'Broadband internet constellation'],
  [/^KUIPER/, 'Amazon', 'Broadband internet constellation'],
  [/^QIANFAN/, 'Spacesail (China)', 'Broadband internet constellation'],
  [/^HULIANWANG/, 'China SatNet', 'Broadband internet constellation'],
  [/^IRIDIUM/, 'Iridium', 'Satellite phone and data network'],
  [/^GLOBALSTAR/, 'Globalstar', 'Satellite phone and data network'],
  [/^ORBCOMM/, 'ORBCOMM', 'Machine-to-machine messaging'],
  [/^(GPS |NAVSTAR)/, 'US Space Force', 'GPS navigation'],
  [/^GLONASS|^COSMOS \d+ \([78]\d\d\)/, 'Roscosmos (Russia)', 'GLONASS navigation'],
  [/GALILEO/, 'European Union / ESA', 'Galileo navigation'],
  [/^BEIDOU/, 'China', 'BeiDou navigation'],
  [/^QZS/, 'Japan', 'QZSS regional navigation'],
  [/^(IRNSS|NVS-)/, 'ISRO (India)', 'NavIC regional navigation'],
  [/^ISS\b/, 'NASA, Roscosmos, ESA, JAXA, CSA', 'International Space Station'],
  [/^(CSS\b|TIANHE|WENTIAN|MENGTIAN)/, 'China Manned Space Agency', 'Tiangong space station'],
  [/^(CREW DRAGON|CARGO DRAGON|DRAGON )/, 'SpaceX', 'Crew / cargo spacecraft'],
  [/^(SOYUZ|PROGRESS)/, 'Roscosmos (Russia)', 'Crew / cargo spacecraft'],
  [/^CYGNUS/, 'Northrop Grumman', 'Cargo spacecraft'],
  [/^(SHENZHOU|TIANZHOU)/, 'China Manned Space Agency', 'Crew / cargo spacecraft'],
  [/^HTV/, 'JAXA (Japan)', 'Cargo spacecraft'],
  [/^HST$/, 'NASA / ESA', 'Hubble Space Telescope'],
  [/^(NOAA|GOES|JPSS|SUOMI)/, 'NOAA (USA)', 'Weather satellite'],
  [/^(METEOSAT|METOP)/, 'EUMETSAT', 'Weather satellite'],
  [/^(FENGYUN|FY-)/, 'China Meteorological Administration', 'Weather satellite'],
  [/^HIMAWARI/, 'Japan Meteorological Agency', 'Weather satellite'],
  [/^METEOR-M|^ELEKTRO/, 'Roscosmos (Russia)', 'Weather satellite'],
  [/^SENTINEL/, 'ESA / EU Copernicus', 'Earth observation'],
  [/^LANDSAT/, 'NASA / USGS', 'Earth observation'],
  [/^(TERRA|AQUA|AURA)$|^(SMAP|GPM|CALIPSO|CLOUDSAT)/, 'NASA', 'Earth science'],
  [/^(FLOCK|DOVE|SKYSAT|PELICAN|TANAGER)/, 'Planet Labs', 'Earth imaging'],
  [/^LEMUR/, 'Spire Global', 'Weather and ship tracking'],
  [/^ICEYE/, 'ICEYE', 'Radar Earth imaging'],
  [/^CAPELLA/, 'Capella Space', 'Radar Earth imaging'],
  [/^UMBRA/, 'Umbra', 'Radar Earth imaging'],
  [/^(WORLDVIEW|GEOEYE)/, 'Maxar / Vantor', 'Earth imaging'],
  [/^(TERRASAR|TANDEM)/, 'DLR / Airbus (Germany)', 'Radar Earth imaging'],
  [/^(YAOGAN|GAOFEN|JILIN|SUPERVIEW|ZIYUAN|TIANHUI|HAIYANG|PIESAT)/, 'China', 'Earth observation'],
  [/^(SHIJIAN|SHIYAN|SJ-|TJS)/, 'China', 'Technology demonstration'],
  [/^(CARTOSAT|RESOURCESAT|OCEANSAT|EOS-)/, 'ISRO (India)', 'Earth observation'],
  [/^INTELSAT/, 'Intelsat', 'Communications'],
  [/^(SES|ASTRA|O3B)/, 'SES', 'Communications'],
  [/^EUTELSAT/, 'Eutelsat', 'Communications'],
  [/^INMARSAT/, 'Viasat / Inmarsat', 'Mobile communications'],
  [/^(VIASAT|ECHOSTAR|GALAXY|DIRECTV|SIRIUS|XM)/, 'US commercial operator', 'Communications / broadcast'],
  [/^(ZHONGXING|CHINASAT|APSTAR|ASIASAT|TIANLIAN)/, 'China', 'Communications'],
  [/^(EXPRESS|GONETS|RASSVET)/, 'Russia', 'Communications'],
  [/^(TDRS)/, 'NASA', 'Data relay'],
  [/^(USA \d|WGS|SDA|NROL|MUOS|AEHF)/, 'US government', 'Defence'],
  [/^COSMOS \d/, 'Russia', 'Government satellite'],
  [/^GSAT-?\d/, 'ISRO (India)', 'Communications'],
  [/^(SPACEMOBILE|BLUEWALKER|BLUEBIRD)/, 'AST SpaceMobile', 'Direct-to-phone broadband'],
  [/^KINEIS/, 'Kinéis', 'Internet of things'],
  [/^HAWK/, 'HawkEye 360', 'Radio-signal mapping'],
];

const DEBRIS_SOURCES: [RegExp, string][] = [
  [/FENGYUN 1C/, 'Fragment of Fengyun-1C, destroyed in a 2007 anti-satellite test'],
  [/COSMOS 2251/, 'Fragment of Cosmos 2251, from its 2009 collision with Iridium 33'],
  [/IRIDIUM 33/, 'Fragment of Iridium 33, from its 2009 collision with Cosmos 2251'],
  [/COSMOS 1408/, 'Fragment of Cosmos 1408, destroyed in a 2021 anti-satellite test'],
];

// [name pattern, model shape] — first match wins; anything unmatched falls back to its
// category and orbit class (see fallbackKind).
const SHAPES: [RegExp, ModelKind][] = [
  [/^ISS( \(|$)/, 'iss'],
  [/^(CSS\b|TIANHE|WENTIAN|MENGTIAN|TIANGONG)/, 'tiangong'],
  [/^(CREW DRAGON|CARGO DRAGON|DRAGON\b)/, 'dragon'],
  [/^(SOYUZ|PROGRESS|SHENZHOU)/, 'soyuz'],
  [/^CYGNUS/, 'cygnus'],
  [/^(TIANZHOU|HTV|DREAM CHASER|STARLINER|CST-100)/, 'capsule'],
  [/^CXO\b/, 'chandra'],
  [/^XMM\b/, 'xmm'],
  [/^SDO$/, 'soho'],
  [/^(MMS \d|THEMIS|ARASE|TRACERS|POLAR$|IMAGE$)/, 'l1monitor'], // spinning drums with booms, like their cousins out in the solar wind
  [/^(LAGEOS|LARES|STARLETTE|STELLA$|AJISAI|WESTPAC|LARETS|CALSPHERE|LCS \d|RIGIDSPHERE)|ETALON/, 'lasersphere'],
  [/^(TDRS|LUCH|TIANLIAN)/, 'relay'],
  [/^(SPACEMOBILE|BLUEWALKER|BLUEBIRD)/, 'phasedarray'], // (must come before the constellation line below, which used to claim them)
  [/^(HST|SWIFT|FERMI|NUSTAR|IXPE|ASTROSAT|CHEOPS|TESS|XRISM|HXMT|INTEGRAL|NEOSSAT|EINSTEIN PROBE|SVOM|HINODE|IRIS)\b/, 'telescope'],
  [/^STARLINK/, 'starlink'],
  [/^ONEWEB/, 'oneweb'],
  [/^(ICEYE|CAPELLA|UMBRA|TERRASAR|TANDEM|RADARSAT|RCM-|COSMO-SKYMED|CSG-|SAOCOM|SENTINEL-1|ALOS|RISAT|NISAR|PAZ\b|KOMPSAT-[56]|SAR-LUPE|SARAH|STRIX|QPS-SAR|NOVASAR|IRIDE-MS|LUTAN|HISEA|CONDOR)/, 'radarsat'],
  // Spin-stabilised drums (must come before the general weather line, which would claim them).
  [/^(FENGYUN 2|FY-2|METEOSAT-?\s?(8|9|10|11)\b)/, 'spinner'],
  [/^(NOAA|GOES|JPSS|SUOMI|METEOSAT|METOP|MSG|MTG|FENGYUN|FY-|HIMAWARI|METEOR-M|ELEKTRO|ARKTIKA|DMSP|INSAT-3D|GEO-KOMPSAT|YUNHAI|TOMORROW)/, 'weather'],
  [/^(ISS OBJECT|FLOCK|DOVE|LEMUR|ASTROCAST|SPACEBEE|FOSSASAT|TEVEL|AEROCUBE|KINEIS|CONNECTA|SATELIOT|CUBY|CENTAURI|GEOSCAN|NETSAT|NORSAT|TIANQI|SITRO|APRIZESAT|STARLING|HORS|SIDLOC|GNOMES|CYGFM|SKYKRAFT|LYNK|HAWK|KEPLER|SPIRE|CUBESAT)|CUBE|\b[1236]U\b/, 'cubesat'],
  [/^(IRIDIUM|GLOBALSTAR|ORBCOMM|O3B|KUIPER|QIANFAN|HULIANWANG|GONETS|GEESAT|CENTISPACE|SPACEMOBILE|BLUEWALKER|BLUEBIRD|SDA|PRAETORIAN|RASSVET)/, 'comsat'],
];

function fallbackKind(sat: Satellite): ModelKind {
  if (sat.category === 'Starlink') return 'starlink';
  if (sat.category === 'OneWeb') return 'oneweb';
  if (sat.category === 'GNSS') return 'gnss';
  if (sat.category === 'Space Stations') return 'capsule'; // a visiting vehicle the table above did not name
  if (sat.category === 'Weather / Earth-obs') return 'observer';
  if (sat.orbitClass === 'GEO') return 'geocomsat';
  if (sat.orbitClass === 'MEO' || sat.orbitClass === 'HEO') return 'comsat';
  return 'smallsat';
}

export function describe(sat: Satellite): Profile {
  const name = sat.name.toUpperCase();

  // Spent upper stages are catalogued as "<launcher> R/B" (rocket body).
  if (/\bR\/B\b/.test(name)) return { kind: 'rocketbody', operator: null, purpose: 'Spent rocket upper stage' };

  if (sat.category === 'Debris' || /\bDEB\b/.test(name)) {
    const source = DEBRIS_SOURCES.find(([pattern]) => pattern.test(name));
    return { kind: 'debris', operator: null, purpose: source ? source[1] : 'Orbital debris fragment' };
  }

  const programme = PROGRAMMES.find(([pattern]) => pattern.test(name));
  const operator = programme ? programme[1] : null;
  const purpose = programme ? programme[2] : sat.category === 'Other' ? 'Satellite' : sat.category;

  const shape = SHAPES.find(([pattern]) => pattern.test(name));
  return { kind: shape ? shape[1] : fallbackKind(sat), operator, purpose };
}

export const KIND_LABEL: Record<ModelKind, string> = {
  starlink: 'Flat-panel broadband satellite',
  oneweb: 'Broadband constellation satellite',
  comsat: 'Communications satellite',
  geocomsat: 'Geostationary communications satellite',
  gnss: 'Navigation satellite',
  smallsat: 'Small satellite',
  cubesat: 'CubeSat',
  observer: 'Earth-imaging satellite',
  radarsat: 'Radar-imaging satellite',
  weather: 'Weather satellite',
  spinner: 'Spin-stabilised weather satellite',
  telescope: 'Space telescope',
  iss: 'International Space Station',
  tiangong: 'Tiangong space station',
  station: 'Space station module',
  dragon: 'Dragon capsule',
  soyuz: 'Soyuz-type spacecraft',
  cygnus: 'Cygnus cargo spacecraft',
  capsule: 'Cargo spacecraft',
  rocketbody: 'Rocket upper stage',
  debris: 'Debris fragment',
  lasersphere: 'Laser-ranging sphere',
  relay: 'Data-relay satellite',
  phasedarray: 'Direct-to-phone satellite',
  webb: 'James Webb Space Telescope',
  euclid: 'Survey telescope',
  tess: 'Planet-hunting telescope',
  chandra: 'Chandra X-ray Observatory',
  xmm: 'XMM-Newton X-ray telescope',
  soho: 'Solar observatory',
  l1monitor: 'Space-weather monitor',
  stereo: 'STEREO solar observatory',
  parker: 'Parker Solar Probe',
  solarorbiter: 'Solar Orbiter',
  bepi: 'BepiColombo',
  voyager: 'Voyager',
  pioneer: 'Pioneer 10 / 11',
  newhorizons: 'New Horizons',
  probe: 'Deep-space probe',
  juno: 'Juno',
  clipper: 'Jupiter-system orbiter',
  lucy: 'Lucy',
  psyche: 'Psyche',
  samplereturn: 'Asteroid sample-return craft',
  lunarorbiter: 'Lunar orbiter',
  marsorbiter: 'Mars orbiter',
  rover: 'Mars rover',
  lander: 'Lander',
  asteroid: 'Asteroid',
};

/**
 * Is this string the name of a model? Data files name models as plain text (the deep-space
 * list says 'webb', 'marsorbiter' …); a name this build does not know must fall back to
 * 'probe' rather than reach buildModel().
 */
export function isModelKind(name: string): name is ModelKind {
  return Object.hasOwn(KIND_LABEL, name);
}
