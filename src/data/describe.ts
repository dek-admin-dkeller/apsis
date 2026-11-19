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
  // Particular constellations and vehicles common enough to deserve their own shape
  // (render/constellationModels.ts, render/vehicleModels.ts).
  | 'starlinkv2' | 'kuiper' | 'qianfan' | 'guowang' | 'iridium' | 'globalstar' | 'o3b' | 'galileo' | 'glonass' | 'goes'
  | 'iceye' | 'capella' | 'dove'
  | 'gpsiii' | 'beidou' | 'lemur' | 'sdatranche' | 'strix' | 'qpssar' | 'umbra' | 'skysat' | 'nusat' | 'hawkeye' | 'orbcomm'
  | 'shenzhou' | 'starliner' | 'orion' | 'dreamchaser' | 'roadster'
  // Launch vehicles standing on their pad (render/rocketModels.ts): +Y is up the rocket's axis
  // and y = 0 is the bottom of its engine bells, so modelBase() stands one on the ground.
  | 'falcon9' | 'falconheavy' | 'starship' | 'electron' | 'longmarch' | 'soyuzrocket'
  | 'atlasv' | 'vulcan' | 'ariane6' | 'newglenn' | 'launcher'
  // Particular missions beyond Earth orbit (render/missionModels.ts, planetMissionModels.ts) and
  // what stands at the historic landing sites (render/historicModels.ts): named in deep.json and
  // space/sites.ts as plain strings, like the other deep-space kinds.
  | 'roman' | 'gaia' | 'kepler' | 'spitzer' | 'juice' | 'hayabusa2' | 'hera' | 'mmx'
  | 'dscovr' | 'wind' | 'imap' | 'ulysses' | 'dawn'
  | 'chandrayaan2' | 'danuri' | 'odyssey' | 'marsexpress' | 'tgo' | 'hope'
  | 'insight' | 'blueghost' | 'novac' | 'vikram' | 'slim' | 'zhurong'
  | 'apollolm' | 'apollolrv' | 'surveyor' | 'luna' | 'lunokhod' | 'change' | 'yutu'
  | 'viking' | 'pathfinder' | 'mer' | 'phoenix' | 'venera' | 'huygens'
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
  [/^GLONASS|^COSMOS \d+ \([78]\d\d\)|\[GLONASS/, 'Roscosmos (Russia)', 'GLONASS navigation'],
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
  [/^(STARLINER|CST-100)/, 'Boeing', 'Crew spacecraft'],
  [/^DREAM CHASER/, 'Sierra Space', 'Cargo spaceplane'],
  [/^ORION\b/, 'NASA / ESA', 'Crew spacecraft'],
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
  [/^SHENZHOU/, 'shenzhou'],
  [/^(SOYUZ|PROGRESS)/, 'soyuz'],
  [/^CYGNUS/, 'cygnus'],
  [/^(STARLINER|CST-100)/, 'starliner'],
  [/^DREAM CHASER/, 'dreamchaser'],
  [/^ORION\b/, 'orion'],
  [/^(TIANZHOU|HTV)/, 'capsule'],
  [/^CXO\b/, 'chandra'],
  [/^XMM\b/, 'xmm'],
  [/^SDO$/, 'soho'],
  [/^(MMS \d|THEMIS|ARASE|TRACERS|POLAR$|IMAGE$)/, 'l1monitor'], // spinning drums with booms, like their cousins out in the solar wind
  [/^(LAGEOS|LARES|STARLETTE|STELLA$|AJISAI|WESTPAC|LARETS)|ETALON/, 'lasersphere'], // (not the Calspheres: those are bare radar targets, with no prisms)
  [/^(TDRS|LUCH|TIANLIAN)/, 'relay'],
  [/^(SPACEMOBILE|BLUEWALKER|BLUEBIRD)/, 'phasedarray'], // (must come before the constellation line below, which used to claim them)
  [/^(HST|FGRST|SWIFT|FERMI|NUSTAR|IXPE|XPOSAT|ASTROSAT|CHEOPS|TESS|XRISM|HXMT|DAMPE|INTEGRAL|NEOSSAT|EINSTEIN PROBE|SVOM|SPHEREX|HINODE)\b|^IRIS$/, 'telescope'],
  // V2 Mini satellites (from 2023) are numbered from 10,000 up, the V1.0 and V1.5 ones below
  // that; the Direct-to-Cell satellites ("[DTC]") are V2 Minis with a bigger phone antenna.
  [/^STARLINK-\d{5}\b/, 'starlinkv2'],
  [/^STARLINK/, 'starlink'],
  [/^KUIPER/, 'kuiper'],
  [/^QIANFAN/, 'qianfan'],
  [/^HULIANWANG/, 'guowang'], // the Guowang satellites (DIGUI) and their test flights (JISHU SHIYAN)
  [/^GLOBALSTAR/, 'globalstar'],
  [/^ICEYE/, 'iceye'],
  [/^CAPELLA/, 'capella'],
  [/^(FLOCK|DOVE|SUPERDOVE)/, 'dove'], // Planet's Doves (must come before the CubeSat line, which used to claim them)
  [/^NAVSTAR (7[7-9]|[89]\d|1\d\d)\b/, 'gpsiii'], // GPS III and IIIF (NAVSTAR 77, launched 2018, onwards); older GPS keep the gnss shape
  [/^BEIDOU/, 'beidou'],
  [/^LEMUR/, 'lemur'],
  [/^(PRAETORIAN|SDA[_-])/, 'sdatranche'],
  [/^STRIX/, 'strix'],
  [/^QPS-SAR/, 'qpssar'],
  [/^UMBRA/, 'umbra'],
  [/^SKYSAT/, 'skysat'],
  [/^NUSAT/, 'nusat'],
  [/^HAWK/, 'hawkeye'],
  [/^ORBCOMM/, 'orbcomm'],
  [/^IRIDIUM 1\d\d$/, 'iridium'], // Iridium NEXT (100–180); the first generation, numbered below 100, keeps the comsat shape
  [/^O3B/, 'o3b'],
  [/GALILEO/, 'galileo'],
  [/\[GLONASS-M\]|^GLONASS/, 'glonass'], // the pressurised GLONASS-M; the newer GLONASS-K are plain boxes (gnss)
  [/^GOES (1[6-9]|2\d)\b/, 'goes'], // GOES-R series: GOES 16 onwards
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
  starlinkv2: 'Starlink V2 Mini',
  kuiper: 'Amazon Kuiper satellite',
  qianfan: 'Qianfan broadband satellite',
  guowang: 'Guowang broadband satellite',
  iridium: 'Iridium NEXT satellite',
  globalstar: 'Globalstar satellite',
  iceye: 'ICEYE radar satellite',
  capella: 'Capella radar satellite',
  dove: 'Planet Dove',
  gpsiii: 'GPS III satellite',
  beidou: 'BeiDou navigation satellite',
  lemur: 'Spire Lemur',
  sdatranche: 'SDA Tranche satellite',
  strix: 'StriX radar satellite',
  qpssar: 'QPS-SAR radar satellite',
  umbra: 'Umbra radar satellite',
  skysat: 'SkySat',
  nusat: 'Satellogic NewSat',
  hawkeye: 'HawkEye 360 satellite',
  orbcomm: 'ORBCOMM satellite',
  o3b: 'O3b medium-orbit satellite',
  galileo: 'Galileo navigation satellite',
  glonass: 'GLONASS navigation satellite',
  goes: 'GOES-R weather satellite',
  shenzhou: 'Shenzhou spacecraft',
  starliner: 'Starliner capsule',
  orion: 'Orion spacecraft',
  dreamchaser: 'Dream Chaser spaceplane',
  roadster: 'Tesla Roadster',
  roman: 'Nancy Grace Roman Space Telescope',
  gaia: 'Gaia',
  kepler: 'Kepler',
  spitzer: 'Spitzer Space Telescope',
  juice: 'JUICE',
  hayabusa2: 'Hayabusa2',
  hera: 'Hera',
  mmx: 'MMX',
  dscovr: 'DSCOVR',
  wind: 'Wind',
  imap: 'IMAP',
  ulysses: 'Ulysses',
  dawn: 'Dawn',
  chandrayaan2: 'Chandrayaan-2 orbiter',
  danuri: 'Danuri',
  odyssey: '2001 Mars Odyssey',
  marsexpress: 'Mars Express',
  tgo: 'ExoMars Trace Gas Orbiter',
  hope: 'Hope',
  insight: 'InSight',
  blueghost: 'Blue Ghost',
  novac: 'Nova-C lander',
  vikram: 'Vikram',
  slim: 'SLIM',
  zhurong: 'Zhurong',
  apollolm: 'Apollo lunar module',
  apollolrv: 'Apollo lunar module and rover',
  surveyor: 'Surveyor',
  luna: 'Luna sample-return lander',
  lunokhod: 'Lunokhod',
  change: 'Chang’e lander',
  yutu: 'Yutu rover',
  viking: 'Viking lander',
  pathfinder: 'Mars Pathfinder',
  mer: 'Mars Exploration Rover',
  phoenix: 'Phoenix lander',
  venera: 'Venera lander',
  huygens: 'Huygens',
  falcon9: 'Falcon 9',
  falconheavy: 'Falcon Heavy',
  starship: 'Starship',
  electron: 'Electron',
  longmarch: 'Long March 5',
  soyuzrocket: 'Soyuz rocket',
  atlasv: 'Atlas V',
  vulcan: 'Vulcan Centaur',
  ariane6: 'Ariane 6',
  newglenn: 'New Glenn',
  launcher: 'Launch vehicle',
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

// [rocket name pattern, model] — first match wins. Names as Launch Library 2 writes them
// (rocket.configuration.name: "Falcon 9 Block 5", "Long March 3B", "Soyuz 2.1b", "Ariane 64" …).
const ROCKETS: [RegExp, ModelKind][] = [
  [/falcon heavy/i, 'falconheavy'],
  [/falcon 9/i, 'falcon9'],
  [/starship|super heavy/i, 'starship'],
  [/electron/i, 'electron'],
  // Long Marches with strap-on boosters look like the 5 (core, boosters with pointed noses);
  // the others (2C, 2D, 4, 6, 11, 12 …) are plain two- or three-stage rockets.
  [/(long march |chang ?zheng |\bcz-)(5b?|7a?|8a?|3b|3c|2f)\b/i, 'longmarch'],
  [/soyuz/i, 'soyuzrocket'],
  [/atlas v/i, 'atlasv'],
  [/vulcan/i, 'vulcan'],
  [/ariane 6/i, 'ariane6'],
  [/new glenn/i, 'newglenn'],
];

/** The model for a rocket, from its name; anything not listed is drawn as a generic launcher. */
export function rocketKind(rocket: string): ModelKind {
  return ROCKETS.find(([pattern]) => pattern.test(rocket))?.[1] ?? 'launcher';
}

/**
 * Is this string the name of a model? Data files name models as plain text (the deep-space
 * list says 'webb', 'marsorbiter' …); a name this build does not know must fall back to
 * 'probe' rather than reach buildModel().
 */
export function isModelKind(name: string): name is ModelKind {
  return Object.hasOwn(KIND_LABEL, name);
}
