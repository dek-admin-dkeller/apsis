import type { Category, OmmRecord, OrbitClass } from './types.ts';

const EARTH_RADIUS_KM = 6378.137;
const MU = 398600.4418; // Earth's gravitational parameter, km^3/s^2

/** Kepler's third law: mean motion (rev/day) → semi-major axis (km). */
export function semiMajorAxisKm(meanMotionRevPerDay: number): number {
  const n = (meanMotionRevPerDay * 2 * Math.PI) / 86400; // rad/s
  return Math.cbrt(MU / (n * n));
}

export function meanAltitudeKm(rec: OmmRecord): number {
  return semiMajorAxisKm(rec.MEAN_MOTION) - EARTH_RADIUS_KM;
}

/** Orbit class from mean motion (→ altitude) and eccentricity. */
export function classifyOrbit(rec: OmmRecord): OrbitClass {
  const alt = meanAltitudeKm(rec);
  if (rec.ECCENTRICITY >= 0.25) return 'HEO'; // highly elliptical (Molniya, transfer orbits…)
  if (rec.MEAN_MOTION > 0.9 && rec.MEAN_MOTION < 1.1) return 'GEO'; // ~1 revolution per day
  if (alt < 2000) return 'LEO';
  if (alt < 35786) return 'MEO';
  return 'HEO'; // above the geostationary belt
}

const DEBRIS_GROUPS = new Set(['cosmos-2251-debris', 'iridium-33-debris', 'fengyun-1c-debris', 'cosmos-1408-debris']);

const STATIONS = /^(ISS\b|CSS\b|TIANHE|WENTIAN|MENGTIAN|TIANGONG|PROGRESS[- ]MS|SOYUZ[- ]MS|CREW DRAGON|CARGO DRAGON|DRAGON |CYGNUS|SHENZHOU|TIANZHOU|HTV)/;
const GNSS = /^(GPS |NAVSTAR|GLONASS|BEIDOU|QZS|IRNSS|NVS-)|GALILEO|\[GLONASS|^COSMOS \d+ \([78]\d\d\)/; // (\[GLONASS: CelesTrak names many "COSMOS 2501 [GLONASS-M]")
const EARTH_OBS = new RegExp(
  '^(NOAA|GOES|METEOSAT|METOP|METEOR-M|FENGYUN|FY-|HIMAWARI|DMSP|JPSS|SUOMI|ELEKTRO|GEO-KOMPSAT|INSAT-3D|' +
    'LANDSAT|SENTINEL|TERRA$|AQUA$|AURA$|WORLDVIEW|GEOEYE|PLEIADES|SPOT |GAOFEN|YAOGAN|JILIN|SUPERVIEW|ZIYUAN|' +
    'TIANHUI|HAIYANG|YUNHAI|TIANMU|YUNYAO|PIESAT|FLOCK|DOVE|SKYSAT|PELICAN|LEMUR|ICEYE|CAPELLA|UMBRA|STRIX|QPS|' +
    'RADARSAT|COSMO-SKYMED|TERRASAR|TANDEM|KOMPSAT|RESOURCESAT|CARTOSAT|OCEANSAT|EOS-|NUSAT|GHGSAT|HAWK|' +
    'TOMORROW|WILDFIRE|FORMOSAT|GRUS|GCOM|ALOS|CBERS|SMAP|GPM|CALIPSO|CLOUDSAT|IRIDE)',
);

/** Sort an object into one display category, from its name and source group. */
export function categorize(rec: OmmRecord): Category {
  const name = rec.OBJECT_NAME.toUpperCase();
  if ((rec.GROUP && DEBRIS_GROUPS.has(rec.GROUP)) || /\bDEB\b/.test(name)) return 'Debris';
  if (name.startsWith('STARLINK')) return 'Starlink';
  if (name.startsWith('ONEWEB')) return 'OneWeb';
  if (STATIONS.test(name)) return 'Space Stations';
  if (GNSS.test(name)) return 'GNSS';
  if (EARTH_OBS.test(name)) return 'Weather / Earth-obs';
  return 'Other';
}
