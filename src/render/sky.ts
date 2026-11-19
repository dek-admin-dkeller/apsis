/**
 * Deep space: the Milky Way in its real orientation, the brightest real stars, the five
 * naked-eye planets, the Sun and the Moon — all in (approximately) their true directions for
 * the simulated date. Purely scenery — nothing here affects the simulation.
 *
 * Frame: the scene is the inertial (ECI) frame with ECI (x, y, z) → scene (x, z, −y), so a
 * star at right ascension α, declination δ sits at (cos δ cos α, sin δ, −cos δ sin α).
 *
 * Cost: the galaxy is drawn ONCE into a texture at start-up. Per frame there are three tiny
 * point clouds (stars, planets, Sun) and one small sphere (Moon).
 */

import * as THREE from 'three';
import { EARTH_RADIUS, type SceneKit } from './scene.ts';

const DEG = Math.PI / 180;
const SUN_DISTANCE = 2400; // scene units; only its direction matters
const STAR_DISTANCE = 2600;
const MOON_RADIUS = 1.737; // 1,737 km
const OBLIQUITY = 23.4393 * DEG; // tilt of Earth's axis: ecliptic → equatorial

/** Right ascension / declination (degrees) → unit direction in scene coordinates. */
function eqToScene(raDeg: number, decDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  const a = raDeg * DEG;
  const d = decDeg * DEG;
  return out.set(Math.cos(d) * Math.cos(a), Math.sin(d), -Math.cos(d) * Math.sin(a));
}

/** Ecliptic rectangular coordinates → scene coordinates (same units). */
function eclipticToScene(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  const ye = y * Math.cos(OBLIQUITY) - z * Math.sin(OBLIQUITY);
  const ze = y * Math.sin(OBLIQUITY) + z * Math.cos(OBLIQUITY);
  return out.set(x, ze, -ye);
}

const centuriesSinceJ2000 = (date: Date): number => (date.getTime() / 86400000 + 2440587.5 - 2451545.0) / 36525;

/** Small deterministic random generator, so the star field is the same on every load. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── The Moon ────────────────────────────────────────────────────────────────────────────

/** Low-precision lunar position (Astronomical Almanac series, ~0.3°): scene units. */
function moonPosition(date: Date, out: THREE.Vector3): THREE.Vector3 {
  const T = centuriesSinceJ2000(date);
  const s = (deg0: number, rate: number): number => Math.sin((deg0 + rate * T) * DEG);
  const c = (deg0: number, rate: number): number => Math.cos((deg0 + rate * T) * DEG);
  const lon =
    (218.32 + 481267.881 * T + 6.29 * s(135.0, 477198.87) - 1.27 * s(259.3, -413335.36) + 0.66 * s(235.7, 890534.22) +
      0.21 * s(269.9, 954397.74) - 0.19 * s(357.5, 35999.05) - 0.11 * s(186.5, 966404.03)) * DEG;
  const lat = (5.13 * s(93.3, 483202.02) + 0.28 * s(228.2, 960400.89) - 0.28 * s(318.3, 6003.15) - 0.17 * s(217.6, -407332.21)) * DEG;
  const parallax =
    (0.9508 + 0.0518 * c(135.0, 477198.87) + 0.0095 * c(259.3, -413335.36) + 0.0078 * c(235.7, 890534.22) + 0.0028 * c(269.9, 954397.74)) * DEG;
  const distKm = 6378.14 / Math.sin(parallax);
  const r = distKm * 0.001;
  return eclipticToScene(Math.cos(lat) * Math.cos(lon) * r, Math.cos(lat) * Math.sin(lon) * r, Math.sin(lat) * r, out);
}

// ── The planets ─────────────────────────────────────────────────────────────────────────

/**
 * Keplerian elements at J2000 and their change per century (JPL "approximate positions",
 * valid 1800–2050): a (AU), e, inclination, mean longitude, longitude of perihelion,
 * longitude of ascending node (degrees), then the six rates in the same order.
 */
type Elements = readonly [number, number, number, number, number, number, number, number, number, number, number, number];
const EARTH_ELEMENTS: Elements = [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0, 0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0];

interface Planet {
  name: string;
  elements: Elements;
  /** Brightness at 1 AU from Sun and Earth, and how fast it dims with phase angle (mag / degree). */
  absMag: number;
  phaseCoeff: number;
  color: [number, number, number];
}
const PLANETS: Planet[] = [
  { name: 'Mercury', elements: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593, 0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081], absMag: -0.42, phaseCoeff: 0.038, color: [0.88, 0.84, 0.78] },
  { name: 'Venus', elements: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255, 0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418], absMag: -4.4, phaseCoeff: 0.013, color: [1.0, 0.97, 0.86] },
  { name: 'Mars', elements: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891, 0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343], absMag: -1.52, phaseCoeff: 0.016, color: [1.0, 0.56, 0.36] },
  { name: 'Jupiter', elements: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909, -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106], absMag: -9.4, phaseCoeff: 0.005, color: [1.0, 0.9, 0.76] },
  { name: 'Saturn', elements: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448, -0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794], absMag: -8.88, phaseCoeff: 0.044, color: [1.0, 0.88, 0.62] },
];

/** Heliocentric ecliptic position (AU) from Keplerian elements at T centuries past J2000. */
function heliocentric(el: Elements, T: number): [number, number, number] {
  const a = el[0] + el[6] * T;
  const e = el[1] + el[7] * T;
  const inc = (el[2] + el[8] * T) * DEG;
  const meanLon = el[3] + el[9] * T;
  const peri = el[4] + el[10] * T;
  const node = el[5] + el[11] * T;
  const w = (peri - node) * DEG; // argument of perihelion
  const O = node * DEG;
  const M = (((meanLon - peri) % 360) + 360) % 360 * DEG; // mean anomaly
  let E = M; // solve Kepler's equation M = E − e sin E by Newton's method
  for (let i = 0; i < 6; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(inc), si = Math.sin(inc);
  return [
    (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp,
    (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp,
    sw * si * xp + cw * si * yp,
  ];
}

/** Display brightness 0…1.25 from an astronomical magnitude (smaller = brighter). */
const brightnessFromMagnitude = (mag: number): number => Math.min(1.25, Math.max(0.04, (6.8 - mag) / 8.3));

// ── Stars ───────────────────────────────────────────────────────────────────────────────

/** Star colours by spectral class, hot (blue) to cool (red). */
const SPECTRAL: Record<string, [number, number, number]> = {
  B: [0.64, 0.75, 1.0],
  A: [0.8, 0.87, 1.0],
  F: [1.0, 0.97, 0.9],
  G: [1.0, 0.92, 0.76],
  K: [1.0, 0.8, 0.56],
  M: [1.0, 0.63, 0.42],
};

/** The brightest real stars: [RA°, Dec°, magnitude, spectral class] (J2000). */
const BRIGHT_STARS: [number, number, number, string][] = [
  [101.287, -16.716, -1.46, 'A'], // Sirius
  [95.988, -52.696, -0.74, 'F'], // Canopus
  [219.902, -60.834, -0.27, 'G'], // Alpha Centauri
  [213.915, 19.182, -0.05, 'K'], // Arcturus
  [279.235, 38.784, 0.03, 'A'], // Vega
  [79.172, 45.998, 0.08, 'G'], // Capella
  [78.634, -8.202, 0.13, 'B'], // Rigel
  [114.825, 5.225, 0.34, 'F'], // Procyon
  [24.429, -57.237, 0.46, 'B'], // Achernar
  [88.793, 7.407, 0.5, 'M'], // Betelgeuse
  [210.956, -60.373, 0.61, 'B'], // Hadar
  [297.696, 8.868, 0.76, 'A'], // Altair
  [68.98, 16.509, 0.86, 'K'], // Aldebaran
  [247.352, -26.432, 0.96, 'M'], // Antares
  [201.298, -11.161, 0.97, 'B'], // Spica
  [116.329, 28.026, 1.14, 'K'], // Pollux
  [344.413, -29.622, 1.16, 'A'], // Fomalhaut
  [310.358, 45.28, 1.25, 'A'], // Deneb
  [152.093, 11.967, 1.35, 'B'], // Regulus
  [104.656, -28.972, 1.5, 'B'], // Adhara
  [113.65, 31.888, 1.58, 'A'], // Castor
  [263.402, -37.104, 1.62, 'B'], // Shaula
  [81.283, 6.35, 1.64, 'B'], // Bellatrix
  [81.573, 28.608, 1.65, 'B'], // Elnath
  [138.3, -69.717, 1.68, 'A'], // Miaplacidus
  [332.058, -46.961, 1.74, 'B'], // Alnair
  [51.081, 49.861, 1.79, 'F'], // Mirfak
  [107.098, -26.393, 1.84, 'F'], // Wezen
  [276.043, -34.385, 1.85, 'B'], // Kaus Australis
  [125.628, -59.51, 1.86, 'K'], // Avior
  [264.33, -42.998, 1.87, 'F'], // Sargas
  [89.882, 44.947, 1.9, 'A'], // Menkalinan
  [252.166, -69.028, 1.92, 'K'], // Atria
  [99.428, 16.399, 1.93, 'A'], // Alhena
  [306.412, -56.735, 1.94, 'B'], // Peacock
  [95.675, -17.956, 1.98, 'B'], // Mirzam
  [141.897, -8.659, 1.98, 'K'], // Alphard
  [37.954, 89.264, 1.98, 'F'], // Polaris
  [31.793, 23.462, 2.0, 'K'], // Hamal
  [283.816, -26.297, 2.02, 'B'], // Nunki
  [17.433, 35.621, 2.05, 'M'], // Mirach
  [2.097, 29.09, 2.06, 'B'], // Alpheratz
  [263.734, 12.56, 2.07, 'A'], // Rasalhague
  [222.676, 74.156, 2.08, 'K'], // Kochab
  [47.042, 40.956, 2.1, 'B'], // Algol
  [177.265, 14.572, 2.14, 'A'], // Denebola
  [305.557, 40.257, 2.2, 'F'], // Sadr
  [233.672, 26.715, 2.23, 'A'], // Alphecca
  [30.975, 42.33, 2.26, 'K'], // Almach
  [240.083, -22.622, 2.32, 'B'], // Dschubba
  [326.046, 9.875, 2.39, 'K'], // Enif
  [345.944, 28.083, 2.42, 'M'], // Scheat
  [311.553, 33.97, 2.46, 'K'], // Gienah Cygni
  [346.19, 15.205, 2.49, 'A'], // Markab
  [3.309, 15.184, 2.83, 'B'], // Algenib
  [292.68, 27.96, 3.08, 'K'], // Albireo
  // Orion's belt and Saiph
  [84.053, -1.202, 1.69, 'B'],
  [85.19, -1.943, 1.77, 'B'],
  [83.002, -0.299, 2.23, 'B'],
  [86.939, -9.67, 2.09, 'B'],
  // Southern Cross
  [186.65, -63.099, 0.76, 'B'],
  [191.93, -59.689, 1.25, 'B'],
  [187.791, -57.113, 1.63, 'M'],
  [183.786, -58.749, 2.8, 'B'],
  // Big Dipper
  [165.932, 61.751, 1.79, 'K'],
  [165.46, 56.382, 2.37, 'A'],
  [178.458, 53.695, 2.44, 'A'],
  [183.857, 57.033, 3.31, 'A'],
  [193.507, 55.96, 1.77, 'A'],
  [200.981, 54.925, 2.27, 'A'],
  [206.885, 49.313, 1.86, 'B'],
  // Cassiopeia's W
  [10.127, 56.537, 2.23, 'K'],
  [2.295, 59.15, 2.27, 'F'],
  [14.177, 60.717, 2.47, 'B'],
  [21.454, 60.235, 2.68, 'A'],
  [28.599, 63.67, 3.38, 'B'],
  // The Pleiades
  [56.871, 24.105, 2.87, 'B'],
  [57.291, 24.053, 3.63, 'B'],
  [56.219, 24.113, 3.7, 'B'],
  [56.457, 24.368, 3.87, 'B'],
  [56.582, 23.948, 4.18, 'B'],
  [56.302, 24.467, 4.3, 'B'],
];

// ── Constellations ──────────────────────────────────────────────────────────────────────

/**
 * Stick figures of the best-known constellations. Each lists its stars as
 * [RA°, Dec°, magnitude, spectral class] (J2000) and the lines as chains of indices into
 * that list. Stars already in BRIGHT_STARS use the same coordinates, so the lines end
 * exactly on the star points; the fainter ones are added to the star field as well.
 */
interface Figure {
  name: string;
  stars: [number, number, number, string][];
  paths: number[][];
}

const FIGURES: Figure[] = [
  {
    name: 'Orion',
    stars: [
      [88.793, 7.407, 0.5, 'M'], [81.283, 6.35, 1.64, 'B'], [83.002, -0.299, 2.23, 'B'], [84.053, -1.202, 1.69, 'B'],
      [85.19, -1.943, 1.77, 'B'], [86.939, -9.67, 2.09, 'B'], [78.634, -8.202, 0.13, 'B'], [83.784, 9.934, 3.39, 'B'],
    ], // Betelgeuse, Bellatrix, Mintaka, Alnilam, Alnitak, Saiph, Rigel, Meissa
    paths: [[0, 7, 1], [0, 4, 5, 6, 2, 1], [2, 3, 4]],
  },
  {
    name: 'Ursa Major',
    stars: [
      [165.932, 61.751, 1.79, 'K'], [165.46, 56.382, 2.37, 'A'], [178.458, 53.695, 2.44, 'A'], [183.857, 57.033, 3.31, 'A'],
      [193.507, 55.96, 1.77, 'A'], [200.981, 54.925, 2.27, 'A'], [206.885, 49.313, 1.86, 'B'],
    ], // Dubhe, Merak, Phecda, Megrez, Alioth, Mizar, Alkaid
    paths: [[0, 1, 2, 3, 0], [3, 4, 5, 6]],
  },
  {
    name: 'Ursa Minor',
    stars: [
      [37.954, 89.264, 1.98, 'F'], [263.054, 86.586, 4.35, 'A'], [251.493, 82.037, 4.21, 'G'], [236.015, 77.795, 4.29, 'A'],
      [222.676, 74.156, 2.08, 'K'], [230.182, 71.834, 3.0, 'A'], [244.376, 75.755, 4.95, 'F'],
    ], // Polaris, Yildun, ε, ζ, Kochab, Pherkad, η
    paths: [[0, 1, 2, 3, 4, 5, 6, 3]],
  },
  {
    name: 'Cassiopeia',
    stars: [[2.295, 59.15, 2.27, 'F'], [10.127, 56.537, 2.23, 'K'], [14.177, 60.717, 2.47, 'B'], [21.454, 60.235, 2.68, 'A'], [28.599, 63.67, 3.38, 'B']],
    paths: [[0, 1, 2, 3, 4]],
  },
  {
    name: 'Cygnus',
    stars: [
      [310.358, 45.28, 1.25, 'A'], [305.557, 40.257, 2.2, 'F'], [299.077, 35.083, 3.89, 'K'], [292.68, 27.96, 3.08, 'K'],
      [296.244, 45.131, 2.87, 'B'], [311.553, 33.97, 2.46, 'K'],
    ], // Deneb, Sadr, η, Albireo, δ, Gienah
    paths: [[0, 1, 2, 3], [4, 1, 5]],
  },
  {
    name: 'Lyra',
    stars: [[279.235, 38.784, 0.03, 'A'], [281.193, 37.605, 4.34, 'A'], [282.52, 33.363, 3.52, 'B'], [284.736, 32.69, 3.25, 'B'], [283.626, 36.899, 4.3, 'M']],
    // Vega, ζ, Sheliak, Sulafat, δ
    paths: [[0, 1, 2, 3, 4, 1]],
  },
  {
    name: 'Aquila',
    stars: [
      [297.696, 8.868, 0.76, 'A'], [296.565, 10.613, 2.72, 'K'], [298.828, 6.407, 3.71, 'G'], [291.375, 3.115, 3.36, 'F'],
      [286.353, 13.863, 2.99, 'A'], [286.562, -4.883, 3.43, 'B'], [302.826, -0.821, 3.24, 'B'],
    ], // Altair, Tarazed, Alshain, δ, ζ, λ, θ
    paths: [[1, 0, 2], [0, 3], [4, 3, 5], [3, 6]],
  },
  {
    name: 'Scorpius',
    stars: [
      [241.359, -19.805, 2.62, 'B'], [240.083, -22.622, 2.32, 'B'], [239.713, -26.114, 2.89, 'B'], [245.297, -25.593, 2.89, 'B'],
      [247.352, -26.432, 0.96, 'M'], [248.971, -28.216, 2.82, 'B'], [252.541, -34.293, 2.29, 'K'], [252.968, -38.047, 3.0, 'B'],
      [253.646, -42.361, 3.62, 'K'], [258.038, -43.239, 3.33, 'F'], [264.33, -42.998, 1.87, 'F'], [266.896, -40.127, 3.03, 'F'],
      [265.622, -39.03, 2.41, 'B'], [263.402, -37.104, 1.62, 'B'], [262.691, -37.296, 2.7, 'B'],
    ], // Acrab, Dschubba, π, σ, Antares, τ, ε, μ, ζ, η, Sargas, ι, κ, Shaula, Lesath
    paths: [[0, 1, 2], [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]],
  },
  {
    name: 'Sagittarius',
    stars: [
      [271.452, -30.424, 2.99, 'K'], [275.249, -29.828, 2.7, 'K'], [276.043, -34.385, 1.85, 'B'], [276.993, -25.422, 2.82, 'K'],
      [281.414, -26.991, 3.17, 'B'], [283.816, -26.297, 2.02, 'B'], [286.735, -27.67, 3.32, 'K'], [285.653, -29.88, 2.6, 'A'],
    ], // Alnasl, Kaus Media, Kaus Australis, Kaus Borealis, φ, Nunki, τ, Ascella — the Teapot
    paths: [[0, 1, 2, 0], [1, 3, 4, 1], [2, 7, 4], [4, 5, 6, 7]],
  },
  {
    name: 'Leo',
    stars: [
      [152.093, 11.967, 1.35, 'B'], [151.833, 16.763, 3.49, 'A'], [154.993, 19.842, 2.08, 'K'], [154.173, 23.417, 3.44, 'F'],
      [148.191, 26.007, 3.88, 'K'], [146.463, 23.774, 2.98, 'G'], [168.527, 20.524, 2.56, 'A'], [177.265, 14.572, 2.14, 'A'],
      [168.56, 15.43, 3.34, 'A'],
    ], // Regulus, η, Algieba, Adhafera, μ, ε, Zosma, Denebola, Chertan
    paths: [[0, 1, 2, 3, 4, 5], [2, 6, 7, 8, 0], [6, 8]],
  },
  {
    name: 'Taurus',
    stars: [
      [68.98, 16.509, 0.86, 'K'], [64.948, 15.628, 3.65, 'K'], [65.734, 17.543, 3.76, 'K'], [67.154, 19.18, 3.53, 'K'],
      [81.573, 28.608, 1.65, 'B'], [84.411, 21.143, 3.0, 'B'], [60.17, 12.49, 3.47, 'B'],
    ], // Aldebaran, γ, δ, Ain, Elnath, ζ, λ
    paths: [[0, 1, 2, 3], [3, 4], [0, 5], [1, 6]],
  },
  {
    name: 'Gemini',
    stars: [
      [113.65, 31.888, 1.58, 'A'], [116.329, 28.026, 1.14, 'K'], [100.983, 25.131, 3.06, 'G'], [95.74, 22.514, 2.87, 'M'],
      [93.719, 22.507, 3.3, 'M'], [110.031, 21.982, 3.53, 'F'], [106.027, 20.57, 3.8, 'G'], [99.428, 16.399, 1.93, 'A'],
    ], // Castor, Pollux, Mebsuta, Tejat, Propus, Wasat, Mekbuda, Alhena
    paths: [[0, 1], [0, 2, 3, 4], [1, 5, 6, 7]],
  },
  {
    name: 'Canis Major',
    stars: [
      [101.287, -16.716, -1.46, 'A'], [95.675, -17.956, 1.98, 'B'], [105.756, -23.833, 3.02, 'B'], [107.098, -26.393, 1.84, 'F'],
      [104.656, -28.972, 1.5, 'B'], [111.024, -29.303, 2.45, 'B'],
    ], // Sirius, Mirzam, ο², Wezen, Adhara, Aludra
    paths: [[1, 0, 2, 3, 4], [3, 5]],
  },
  {
    name: 'Canis Minor',
    stars: [[114.825, 5.225, 0.34, 'F'], [111.788, 8.289, 2.89, 'B']], // Procyon, Gomeisa
    paths: [[0, 1]],
  },
  {
    name: 'Auriga',
    stars: [[79.172, 45.998, 0.08, 'G'], [89.882, 44.947, 1.9, 'A'], [89.93, 37.213, 2.62, 'A'], [81.573, 28.608, 1.65, 'B'], [74.248, 33.166, 2.69, 'K']],
    // Capella, Menkalinan, θ, Elnath (shared with Taurus), Hassaleh
    paths: [[0, 1, 2, 3, 4, 0]],
  },
  {
    name: 'Perseus',
    stars: [
      [46.199, 53.506, 2.93, 'G'], [51.081, 49.861, 1.79, 'F'], [55.731, 47.788, 3.01, 'B'], [59.463, 40.01, 2.89, 'B'],
      [58.533, 31.884, 2.85, 'B'], [47.042, 40.956, 2.1, 'B'],
    ], // γ, Mirfak, δ, ε, ζ, Algol
    paths: [[0, 1, 2, 3, 4], [1, 5]],
  },
  {
    name: 'Andromeda',
    stars: [[2.097, 29.09, 2.06, 'B'], [9.832, 30.861, 3.27, 'K'], [17.433, 35.621, 2.05, 'M'], [30.975, 42.33, 2.26, 'K']],
    // Alpheratz, δ, Mirach, Almach
    paths: [[0, 1, 2, 3]],
  },
  {
    name: 'Pegasus',
    stars: [
      [346.19, 15.205, 2.49, 'A'], [345.944, 28.083, 2.42, 'M'], [2.097, 29.09, 2.06, 'B'], [3.309, 15.184, 2.83, 'B'],
      [340.366, 10.831, 3.4, 'B'], [332.55, 6.198, 3.53, 'A'], [326.046, 9.875, 2.39, 'K'], [340.75, 30.221, 2.94, 'G'],
    ], // Markab, Scheat, Alpheratz, Algenib, Homam, Biham, Enif, Matar — the Great Square
    paths: [[0, 1, 2, 3, 0], [0, 4, 5, 6], [1, 7]],
  },
  {
    name: 'Boötes',
    stars: [
      [213.915, 19.182, -0.05, 'K'], [221.247, 27.074, 2.37, 'K'], [228.876, 33.315, 3.47, 'G'], [225.486, 40.391, 3.5, 'G'],
      [218.019, 38.308, 3.03, 'A'], [217.957, 30.371, 3.58, 'K'], [208.671, 18.398, 2.68, 'G'],
    ], // Arcturus, Izar, δ, Nekkar, Seginus, ρ, Muphrid
    paths: [[0, 1, 2, 3, 4, 5, 0], [0, 6]],
  },
  {
    name: 'Virgo',
    stars: [
      [201.298, -11.161, 0.97, 'B'], [190.415, -1.449, 2.74, 'F'], [184.976, -0.667, 3.89, 'A'], [177.674, 1.765, 3.61, 'F'],
      [193.901, 3.397, 3.38, 'M'], [195.544, 10.959, 2.83, 'G'], [203.673, -0.596, 3.37, 'A'],
    ], // Spica, Porrima, Zaniah, Zavijava, δ, Vindemiatrix, Heze
    paths: [[0, 1, 2, 3], [1, 4, 5], [4, 6, 0]],
  },
  {
    name: 'Crux',
    stars: [[186.65, -63.099, 0.76, 'B'], [187.791, -57.113, 1.63, 'M'], [191.93, -59.689, 1.25, 'B'], [183.786, -58.749, 2.8, 'B']],
    // Acrux, Gacrux, Mimosa, δ — the Southern Cross
    paths: [[0, 1], [2, 3]],
  },
  {
    name: 'Centaurus',
    stars: [
      [219.902, -60.834, -0.27, 'G'], [210.956, -60.373, 0.61, 'B'], [204.972, -53.466, 2.3, 'B'], [208.885, -47.288, 2.55, 'B'],
      [218.877, -42.158, 2.31, 'B'], [190.379, -48.96, 2.17, 'A'], [182.09, -50.722, 2.6, 'B'], [211.671, -36.37, 2.06, 'K'],
    ], // Rigil Kentaurus, Hadar (the Pointers), ε, ζ, η, Muhlifain, δ, Menkent
    paths: [[0, 1, 2, 3, 4], [2, 5, 6], [3, 7]],
  },
  {
    name: 'Triangulum Australe',
    stars: [[252.166, -69.028, 1.92, 'K'], [238.786, -63.431, 2.85, 'F'], [229.727, -68.679, 2.89, 'A']], // Atria, β, γ
    paths: [[0, 1, 2, 0]],
  },
  {
    name: 'Corona Borealis',
    stars: [
      [233.232, 31.359, 4.14, 'B'], [231.957, 29.106, 3.68, 'F'], [233.672, 26.715, 2.23, 'A'], [235.686, 26.296, 3.84, 'A'],
      [237.399, 26.068, 4.63, 'G'], [239.397, 26.878, 4.15, 'K'], [240.361, 29.851, 4.99, 'A'],
    ], // θ, Nusakan, Alphecca, γ, δ, ε, ι
    paths: [[0, 1, 2, 3, 4, 5, 6]],
  },
  {
    name: 'Hercules',
    stars: [
      [255.072, 30.926, 3.92, 'A'], [250.322, 31.603, 2.81, 'G'], [250.724, 38.922, 3.48, 'G'], [258.762, 36.809, 3.16, 'K'],
      [247.555, 21.49, 2.78, 'G'], [258.758, 24.839, 3.12, 'A'],
    ], // ε, ζ, η, π (the Keystone), Kornephoros, Sarin
    paths: [[0, 1, 2, 3, 0], [1, 4], [0, 5]],
  },
  {
    name: 'Aries',
    stars: [[42.496, 27.26, 3.61, 'B'], [31.793, 23.462, 2.0, 'K'], [28.66, 20.808, 2.64, 'A'], [28.383, 19.294, 3.88, 'A']],
    // 41 Arietis, Hamal, Sheratan, Mesarthim
    paths: [[0, 1, 2, 3]],
  },
  {
    name: 'Capricornus',
    stars: [
      [304.514, -12.545, 3.57, 'G'], [305.253, -14.781, 3.08, 'K'], [311.524, -25.271, 4.14, 'F'], [312.955, -26.919, 4.11, 'K'],
      [321.667, -22.411, 3.74, 'G'], [326.76, -16.127, 2.87, 'A'], [325.023, -16.662, 3.68, 'A'], [316.487, -17.233, 4.07, 'A'],
    ], // Algedi, Dabih, ψ, ω, ζ, Deneb Algedi, Nashira, θ
    paths: [[0, 1, 2, 3, 4, 5, 6, 7, 0]],
  },
];

/**
 * Figure stars that are not already among the brightest ones (each once, even when two
 * constellations share it) — createStars() adds them to the star field.
 */
function extraFigureStars(): [number, number, number, string][] {
  const known = BRIGHT_STARS.map(([ra, dec]) => eqToScene(ra, dec));
  const extra: [number, number, number, string][] = [];
  const SAME = Math.cos(0.08 * DEG); // within 0.08° = the same star
  for (const figure of FIGURES) {
    for (const star of figure.stars) {
      const v = eqToScene(star[0], star[1]);
      if (known.some((k) => k.dot(v) > SAME)) continue;
      known.push(v);
      extra.push(star);
    }
  }
  return extra;
}

/** All the figures as one set of thin line segments on the star sphere. Built once. */
function createConstellations(): { lines: THREE.LineSegments; centres: { name: string; direction: THREE.Vector3 }[] } {
  const positions: number[] = [];
  const centres: { name: string; direction: THREE.Vector3 }[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), p = new THREE.Vector3(), q = new THREE.Vector3();
  for (const figure of FIGURES) {
    const centre = new THREE.Vector3();
    for (const [ra, dec] of figure.stars) centre.add(eqToScene(ra, dec, a));
    centres.push({ name: figure.name, direction: centre.lengthSq() > 1e-9 ? centre.normalize() : centre.set(0, 1, 0) });
    for (const path of figure.paths) {
      for (let k = 0; k + 1 < path.length; k++) {
        const s0 = figure.stars[path[k]], s1 = figure.stars[path[k + 1]];
        eqToScene(s0[0], s0[1], a);
        eqToScene(s1[0], s1[1], b);
        // Stop each line a little short of its stars, so the star stays a clean point.
        const angle = a.angleTo(b);
        const gap = angle > 1e-6 ? Math.min(0.011, angle * 0.22) / angle : 0;
        p.lerpVectors(a, b, gap).normalize().multiplyScalar(STAR_DISTANCE);
        q.lerpVectors(a, b, 1 - gap).normalize().multiplyScalar(STAR_DISTANCE);
        positions.push(p.x, p.y, p.z, q.x, q.y, q.z);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
    color: new THREE.Color(0.5, 0.66, 1.0), // cool blue-white, kept dim so the glow pass leaves it alone
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    depthTest: true, // the Earth must hide the figures behind it
  }));
  lines.frustumCulled = false;
  lines.renderOrder = 1; // drawn after the Earth has written its depth, so the test above works
  return { lines, centres };
}

/** Galactic frame in scene coordinates: towards the centre, towards longitude 90°, north pole. */
function galacticFrame(): { centre: THREE.Vector3; side: THREE.Vector3; pole: THREE.Vector3 } {
  const pole = eqToScene(192.859, 27.128);
  const side = new THREE.Vector3().crossVectors(pole, eqToScene(266.405, -28.936)).normalize();
  const centre = new THREE.Vector3().crossVectors(side, pole).normalize();
  return { centre, side, pole };
}

const STAR_VERTEX = /* glsl */ `
  attribute float aBright;
  attribute vec3 aColor;
  attribute float aSeed;
  uniform float uPixelRatio;
  uniform float uTime;
  uniform float uTwinkle;
  varying float vBright;
  varying vec3 vColor;
  void main() {
    // gentle twinkle, each star on its own phase (planets shine steadily: uTwinkle = 0)
    vBright = aBright * (1.0 + uTwinkle * sin(uTime * (0.7 + aSeed * 1.9) + aSeed * 400.0));
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = (1.3 + 2.4 * aBright + 6.5 * aBright * aBright * aBright) * uPixelRatio;
  }`;

const STAR_FRAGMENT = /* glsl */ `
  varying float vBright;
  varying vec3 vColor;
  void main() {
    vec2 p = (gl_PointCoord - 0.5) * 2.0;
    float r2 = dot(p, p);
    float core = exp(-r2 * 5.0);
    // faint diffraction cross, only on the very brightest
    float spikes = (exp(-abs(p.x) * 18.0) + exp(-abs(p.y) * 18.0)) * exp(-r2 * 2.5) * smoothstep(0.62, 1.0, vBright) * 0.3;
    float fade = 1.0 - smoothstep(0.7, 1.0, sqrt(r2));
    vec3 col = mix(vColor, vec3(1.0), core * 0.5) * (core * (0.2 + 1.25 * vBright) + spikes) * fade;
    gl_FragColor = vec4(clamp(col, 0.0, 4.0), 1.0);
  }`;

function starMaterial(twinkle: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: 1 }, uTime: { value: 0 }, uTwinkle: { value: twinkle } },
    vertexShader: STAR_VERTEX,
    fragmentShader: STAR_FRAGMENT,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
}

function pointCloud(positions: Float32Array, bright: Float32Array, colors: Float32Array, twinkle: number, renderOrder: number): THREE.Points {
  const count = bright.length;
  const seeds = new Float32Array(count);
  const random = mulberry32(99);
  for (let i = 0; i < count; i++) seeds[i] = random();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const points = new THREE.Points(geometry, starMaterial(twinkle));
  points.frustumCulled = false;
  points.renderOrder = renderOrder;
  return points;
}

/**
 * The star field: the real bright stars (so Orion, the Southern Cross, the Big Dipper…
 * are where they should be) plus thousands of generated faint ones. Like the real sky there
 * are about three times as many stars for every magnitude fainter, and they crowd towards
 * the plane of the Milky Way.
 */
function createStars(): THREE.Points {
  const generated = 8000;
  const named = [...BRIGHT_STARS, ...extraFigureStars()]; // the brightest stars + the rest of the constellation figures
  const count = generated + named.length;
  const positions = new Float32Array(count * 3);
  const bright = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const random = mulberry32(2710);
  const { centre, side, pole } = galacticFrame();
  const classes = ['B', 'A', 'A', 'F', 'F', 'G', 'G', 'K', 'K', 'M'];
  const v = new THREE.Vector3();
  for (let i = 0; i < generated; i++) {
    if (random() < 0.45) {
      // near the galactic plane, denser towards the centre
      let l = (random() - 0.5) * 2 * Math.PI;
      if (random() < 0.5) l *= 0.5;
      const b = (random() + random() + random() - 1.5) * 0.42;
      v.set(0, 0, 0)
        .addScaledVector(centre, Math.cos(b) * Math.cos(l))
        .addScaledVector(side, Math.cos(b) * Math.sin(l))
        .addScaledVector(pole, Math.sin(b));
    } else {
      // uniform over the sphere
      const y = random() * 2 - 1;
      const a = random() * 2 * Math.PI;
      const s = Math.sqrt(1 - y * y);
      v.set(s * Math.cos(a), y, s * Math.sin(a));
    }
    positions.set([v.x * STAR_DISTANCE, v.y * STAR_DISTANCE, v.z * STAR_DISTANCE], i * 3);
    // magnitudes 2.6 … 6.6, with N(<m) ∝ 3^m
    const mag = 2.6 + Math.log(1 + random() * (Math.pow(3, 4) - 1)) / Math.log(3);
    bright[i] = brightnessFromMagnitude(mag);
    colors.set(SPECTRAL[classes[Math.floor(random() * classes.length)]], i * 3);
  }
  named.forEach(([ra, dec, mag, cls], k) => {
    const i = generated + k;
    eqToScene(ra, dec, v);
    positions.set([v.x * STAR_DISTANCE, v.y * STAR_DISTANCE, v.z * STAR_DISTANCE], i * 3);
    bright[i] = brightnessFromMagnitude(mag);
    colors.set(SPECTRAL[cls], i * 3);
  });
  return pointCloud(positions, bright, colors, 0.07, -10);
}

// ── The Milky Way ───────────────────────────────────────────────────────────────────────

/**
 * Generate the galaxy backdrop procedurally, in its real orientation: the band follows the
 * true galactic plane, the bright bulge sits towards Sagittarius, the Great Rift splits it
 * with dust, and the Magellanic Clouds, Andromeda, the Orion and Carina nebulae and the
 * Pleiades are where they are in the real sky. Drawn ONCE into a 4096 × 2048 texture at
 * start-up, so it costs nothing per frame afterwards.
 *
 * Texture coordinates match THREE.SphereGeometry: u = longitude / 2π, v = 0 at the south pole.
 */
function bakeMilkyWay(renderer: THREE.WebGLRenderer): THREE.Texture {
  const target = new THREE.WebGLRenderTarget(4096, 2048, { depthBuffer: false, generateMipmaps: false });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  target.texture.wrapS = THREE.RepeatWrapping;
  const { centre, side, pole } = galacticFrame();

  // Andromeda is a tilted disc: its long axis points 35° east of north on the sky.
  const m31Ra = 10.685 * DEG, m31Dec = 41.269 * DEG, m31Angle = 35 * DEG;
  const north = [-Math.sin(m31Dec) * Math.cos(m31Ra), -Math.sin(m31Dec) * Math.sin(m31Ra), Math.cos(m31Dec)];
  const east = [-Math.sin(m31Ra), Math.cos(m31Ra), 0];
  const ax = north.map((n, i) => n * Math.cos(m31Angle) + east[i] * Math.sin(m31Angle));
  const m31Axis = new THREE.Vector3(ax[0], ax[2], -ax[1]).normalize();

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uCentre: { value: centre },
      uSide: { value: side },
      uPole: { value: pole },
      uLmc: { value: eqToScene(80.89, -69.76) },
      uSmc: { value: eqToScene(13.19, -72.83) },
      uM31: { value: eqToScene(10.685, 41.269) },
      uM31Axis: { value: m31Axis },
      uOrion: { value: eqToScene(83.82, -5.39) },
      uCarina: { value: eqToScene(161.26, -59.87) },
      uPleiades: { value: eqToScene(56.75, 24.12) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform vec3 uCentre, uSide, uPole;
      uniform vec3 uLmc, uSmc, uM31, uM31Axis, uOrion, uCarina, uPleiades;

      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      float fbm(vec3 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 6; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
        return v;
      }
      // Soft round patch of angular radius r (radians) around direction c.
      float blob(vec3 dir, vec3 c, float r) { return exp(-2.0 * max(1.0 - dot(dir, c), 0.0) / (r * r)); }
      // One layer of tiny baked stars; a higher threshold means fewer of them.
      float starLayer(vec3 dir, float scale, float threshold) {
        vec3 q = dir * scale;
        vec3 c = floor(q);
        vec3 p = fract(q) - 0.5 - (vec3(hash(c + 1.3), hash(c + 2.7), hash(c + 4.1)) - 0.5) * 0.5;
        float size = hash(c + 9.0);
        return step(threshold, hash(c)) * (1.0 - smoothstep(0.0, 0.3, length(p))) * (0.12 + 0.88 * size * size * size);
      }

      void main() {
        // Same mapping as THREE.SphereGeometry, so the texture lands where the maths says.
        float lon = vUv.x * 6.2831853, lat = (vUv.y - 0.5) * 3.14159265;
        vec3 dir = vec3(-cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));

        // Galactic coordinates of this direction.
        float gx = dot(dir, uCentre);   // +1 towards the galactic centre
        float gy = dot(dir, uSide);
        float gz = dot(dir, uPole);     // height above the plane (sine of galactic latitude)
        float toward = clamp(0.5 + 0.5 * gx, 0.0, 1.0);

        // The disc: a band that is thicker and much brighter towards the centre.
        float h = gz + (fbm(dir * 3.0) - 0.5) * 0.10;
        float sigma = mix(0.085, 0.16, toward * toward);
        float band = exp(-(h * h) / (sigma * sigma));
        float along = 0.26 + 0.74 * pow(toward, 1.6);
        float halo = exp(-(gz * gz) / (0.34 * 0.34)) * 0.07 * along;
        // The central bulge in Sagittarius: wider than the disc, flattened along the plane.
        float bulge = exp(-((gy * gy) / (0.30 * 0.30) + (gz * gz) / (0.19 * 0.19))) * smoothstep(-0.2, 0.3, gx);

        // Star clouds: clumpy brightness at two scales.
        float clump = fbm(dir * 9.0 + 3.0);
        float fine = fbm(dir * 26.0 + 11.0);
        float cloudiness = (0.45 + 1.1 * clump) * (0.75 + 0.5 * fine);

        // Dust: the Great Rift down the middle, blotchy clouds, and thin dark filaments.
        float riftH = gz + (fbm(dir * 5.0 + 31.0) - 0.5) * 0.09;
        float rift = exp(-(riftH * riftH) / (0.028 * 0.028)) * smoothstep(-0.55, 0.25, gx) * (0.5 + 0.5 * fbm(dir * 14.0 + 7.0));
        float blotch = smoothstep(0.46, 0.66, fbm(dir * 12.0 + 17.0)) * band;
        float ridge = 1.0 - abs(2.0 * fbm(dir * 20.0 + 23.0) - 1.0);
        float filament = ridge * ridge * ridge * ridge * ridge * ridge * band;
        float clear = clamp(1.0 - 0.85 * rift - 0.6 * blotch - 0.35 * filament, 0.08, 1.0);

        float glow = (band * along + bulge * 0.7) * cloudiness * clear + halo;
        vec3 tint = mix(vec3(0.50, 0.62, 1.0), vec3(1.0, 0.80, 0.56), clamp(bulge * 1.2 + toward * toward * 0.35, 0.0, 1.0));
        tint = mix(tint, vec3(1.0, 0.62, 0.40), (1.0 - clear) * 0.5);   // dust reddens what shines through
        vec3 col = glow * tint * 0.24;

        // Glowing hydrogen clouds scattered along the plane, and a whisper of far-off haze.
        col += vec3(1.0, 0.30, 0.45) * smoothstep(0.66, 0.80, fbm(dir * 30.0 + 50.0)) * band * clear * 0.09;
        float haze = fbm(dir * 2.1 + 80.0);
        col += vec3(0.10, 0.22, 0.45) * haze * haze * haze * haze * haze * 0.45;

        // Real deep-sky objects, roughly where they are.
        float lmc = blob(dir, uLmc, 0.060) * (0.55 + 0.9 * fine) + blob(dir, uLmc, 0.022) * 0.6;
        col += vec3(0.80, 0.86, 1.0) * lmc * 0.17;
        col += vec3(0.82, 0.87, 1.0) * blob(dir, uSmc, 0.034) * (0.6 + 0.8 * fine) * 0.13;
        vec3 dm = dir - uM31;
        float am = dot(dm, uM31Axis);
        float pm2 = max(dot(dm, dm) - am * am, 0.0);
        float m31 = exp(-((am * am) / (0.034 * 0.034) + pm2 / (0.010 * 0.010)));
        col += vec3(0.92, 0.88, 0.80) * (m31 * 0.14 + blob(dir, uM31, 0.006) * 0.22);
        col += vec3(1.0, 0.42, 0.62) * blob(dir, uOrion, 0.011) * 0.34 + vec3(0.45, 0.55, 1.0) * blob(dir, uOrion, 0.028) * 0.05;
        col += vec3(1.0, 0.36, 0.42) * blob(dir, uCarina, 0.022) * (0.5 + clump) * 0.22;
        col += vec3(0.50, 0.66, 1.0) * blob(dir, uPleiades, 0.017) * 0.10;

        // Very faint distant galaxies: tiny elongated smudges, hidden behind the Milky Way's dust.
        vec3 gq = dir * 46.0;
        vec3 gc = floor(gq);
        vec3 gp = fract(gq) - 0.5 - (vec3(hash(gc + 1.1), hash(gc + 2.2), hash(gc + 5.5)) - 0.5) * 0.5;
        vec3 gaRaw = vec3(hash(gc + 7.0), hash(gc + 8.0), hash(gc + 9.0)) - 0.5;
        vec3 ga = gaRaw / max(length(gaRaw), 1e-4);
        float gal = dot(gp, ga);
        float gper2 = max(dot(gp, gp) - gal * gal, 0.0);
        float smudge = step(0.955, hash(gc + 3.7)) * exp(-((gal * gal) / 0.020 + gper2 / 0.004));
        col += vec3(1.0, 0.90, 0.78) * smudge * (1.0 - band) * (0.04 + 0.08 * hash(gc + 6.1));

        // Star dust: sparse everywhere, crowded in the band, with an unresolved grain on top.
        float density = clamp(band * along + bulge * 0.6, 0.0, 1.0) * clear;
        float dust = starLayer(dir, 300.0, mix(0.975, 0.84, density));
        vec3 dustTint = mix(vec3(0.75, 0.84, 1.0), vec3(1.0, 0.86, 0.68), hash(floor(dir * 300.0) + 5.0));
        col += dustTint * dust * 0.5;
        col += vec3(0.9, 0.92, 1.0) * starLayer(dir, 520.0, mix(1.0, 0.72, density)) * 0.16;

        gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0); // linear; the sRGB target encodes it on write
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  renderer.setRenderTarget(target);
  renderer.render(scene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
  renderer.setRenderTarget(null);
  quad.geometry.dispose();
  material.dispose();
  return target.texture;
}

// ── Putting it together ─────────────────────────────────────────────────────────────────

export interface Sky {
  update(date: Date, sunDirection: THREE.Vector3, realSeconds: number): void;
  /** Milky Way + stars. */
  setStars(on: boolean): void;
  /** The five naked-eye planets. */
  setPlanets(on: boolean): void;
  /** Unit directions in SCENE coordinates, refreshed in update(): Moon, then Mercury … Saturn. */
  readonly bodies: { name: string; direction: THREE.Vector3 }[];
  /** Constellation stick figures (on by default; also hidden whenever the stars are). */
  setConstellations(on: boolean): void;
  /** Name + unit direction (scene coordinates) of each figure's centre, for DOM labels. Fixed. */
  readonly constellations: { name: string; direction: THREE.Vector3 }[];
  /**
   * The same Milky Way and stars for ANOTHER scene (the views beyond Earth orbit): new objects
   * that share these buffers, the baked texture and the materials, so they cost nothing extra.
   * Keep the group at the camera's position — the stars are drawn at a fixed radius.
   */
  backdrop(): THREE.Group;
}

export function createSky(kit: SceneKit): Sky {
  const { scene } = kit;

  // The Milky Way, painted on the inside of a huge sphere.
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(3200, 96, 48),
    new THREE.MeshBasicMaterial({ map: bakeMilkyWay(kit.renderer), side: THREE.BackSide, depthWrite: false, depthTest: false }),
  );
  dome.renderOrder = -20;
  dome.frustumCulled = false;
  scene.add(dome);

  const stars = createStars();
  scene.add(stars);

  // Constellation figures: thin lines joining the real stars.
  const { lines: figures, centres: constellations } = createConstellations();
  scene.add(figures);
  let starsOn = true, figuresOn = true;

  // The planets: five steady points, repositioned as the simulated date changes.
  const planetPositions = new Float32Array(PLANETS.length * 3);
  const planetBright = new Float32Array(PLANETS.length);
  const planetColors = new Float32Array(PLANETS.length * 3);
  PLANETS.forEach((p, i) => planetColors.set(p.color, i * 3));
  const planets = pointCloud(planetPositions, planetBright, planetColors, 0, -9);
  scene.add(planets);
  const bodies = [{ name: 'Moon', direction: new THREE.Vector3(1, 0, 0) }, ...PLANETS.map((p) => ({ name: p.name, direction: new THREE.Vector3(1, 0, 0) }))];
  let planetsTime = NaN;

  function updatePlanets(date: Date): void {
    const T = centuriesSinceJ2000(date);
    const earth = heliocentric(EARTH_ELEMENTS, T);
    const earthSun = Math.hypot(earth[0], earth[1], earth[2]);
    PLANETS.forEach((planet, i) => {
      const p = heliocentric(planet.elements, T);
      const gx = p[0] - earth[0], gy = p[1] - earth[1], gz = p[2] - earth[2];
      const sunDist = Math.hypot(p[0], p[1], p[2]);
      const earthDist = Math.max(Math.hypot(gx, gy, gz), 1e-6);
      const direction = eclipticToScene(gx / earthDist, gy / earthDist, gz / earthDist, bodies[i + 1].direction);
      planetPositions.set([direction.x * STAR_DISTANCE, direction.y * STAR_DISTANCE, direction.z * STAR_DISTANCE], i * 3);
      // apparent magnitude: distance from Sun and Earth, dimmed by how much of the lit side we see
      const cosPhase = Math.min(1, Math.max(-1, (sunDist * sunDist + earthDist * earthDist - earthSun * earthSun) / (2 * sunDist * earthDist)));
      const mag = planet.absMag + 5 * Math.log10(sunDist * earthDist) + planet.phaseCoeff * (Math.acos(cosPhase) / DEG);
      planetBright[i] = brightnessFromMagnitude(mag);
    });
    planets.geometry.attributes.position.needsUpdate = true;
    planets.geometry.attributes.aBright.needsUpdate = true;
  }

  // The Sun: a white-hot disc, a corona with fine streamers, and a faint lens halo.
  const sunGeometry = new THREE.BufferGeometry();
  sunGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  const sunMaterial = new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: 1 }, uClear: { value: 1 } },
    vertexShader: /* glsl */ `
      uniform float uPixelRatio;
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 240.0 * uPixelRatio;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uClear;   // 1 = Sun in the open, 0 = hidden behind the Earth
      void main() {
        vec2 p = (gl_PointCoord - 0.5) * 2.0;
        float r = length(p);
        float angle = atan(p.y, abs(p.x) < 1e-5 ? 1e-5 : p.x);
        float disc = 1.0 - smoothstep(0.034, 0.052, r);
        float corona = exp(-r * 9.0) * 1.0 + exp(-r * 3.0) * 0.17;
        float streamers = pow(abs(cos(angle * 3.0)), 30.0) * exp(-r * 3.4) * 0.3
                        + pow(0.5 + 0.5 * sin(angle * 17.0 + 1.3), 4.0) * exp(-r * 6.5) * 0.12;
        float streak = exp(-abs(p.y) * 38.0) * exp(-abs(p.x) * 2.6) * 0.2;   // lens streak
        float ringX = (r - 0.52) * 16.0;
        float ring = exp(-ringX * ringX);                                    // lens halo
        vec3 ringTint = mix(vec3(0.45, 0.65, 1.0), vec3(1.0, 0.55, 0.35), smoothstep(0.46, 0.58, r));
        float fade = 1.0 - smoothstep(0.78, 1.0, r);
        vec3 warm = mix(vec3(1.0, 0.97, 0.90), vec3(1.0, 0.82, 0.60), smoothstep(0.0, 0.5, r));
        vec3 col = vec3(1.0, 0.96, 0.88) * disc * 3.0
                 + (warm * (corona + streamers + streak) + ringTint * ring * 0.03) * (0.35 + 0.65 * uClear);
        gl_FragColor = vec4(clamp(col * fade, 0.0, 4.0), 1.0);
      }`,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const sun = new THREE.Points(sunGeometry, sunMaterial);
  sun.frustumCulled = false;
  sun.renderOrder = -5;
  scene.add(sun);

  // Lens ghosts: a few faint discs strung along the line from the Sun through the middle
  // of the screen. They fade out as the Sun slips behind the Earth or off-screen.
  const ghostGeometry = new THREE.BufferGeometry();
  ghostGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 3), 3));
  ghostGeometry.setAttribute('aAlong', new THREE.BufferAttribute(new Float32Array([0.55, 1.0, 1.35, 1.8]), 1));
  ghostGeometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array([26, 70, 40, 120]), 1));
  ghostGeometry.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array([0.05, 0.07, 0.1, 0.03, 0.05, 0.045, 0.07, 0.05, 0.03, 0.02, 0.03, 0.045]), 3));
  const ghostMaterial = new THREE.ShaderMaterial({
    uniforms: { uSunPos: { value: new THREE.Vector3() }, uPixelRatio: { value: 1 }, uStrength: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aAlong;
      attribute float aSize;
      attribute vec3 aTint;
      uniform vec3 uSunPos;
      uniform float uPixelRatio;
      uniform float uStrength;
      varying vec3 vTint;
      void main() {
        vec4 clip = projectionMatrix * viewMatrix * vec4(uSunPos, 1.0);
        gl_PointSize = aSize * uPixelRatio;
        if (clip.w <= 0.0) {            // Sun is behind the camera: draw nothing
          vTint = vec3(0.0);
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        vec2 sunOnScreen = clip.xy / clip.w;
        float inView = 1.0 - smoothstep(0.75, 1.15, max(abs(sunOnScreen.x), abs(sunOnScreen.y)));
        vTint = aTint * uStrength * inView;
        gl_Position = vec4(sunOnScreen * (1.0 - aAlong), 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vTint;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float disc = (1.0 - smoothstep(0.55, 1.0, r)) * 0.6;
        float rim = smoothstep(0.70, 0.86, r) * (1.0 - smoothstep(0.86, 1.0, r)) * 0.5;
        gl_FragColor = vec4(clamp(vTint * (disc + rim), 0.0, 1.0), 1.0);
      }`,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    transparent: true,
  });
  const ghosts = new THREE.Points(ghostGeometry, ghostMaterial);
  ghosts.frustumCulled = false;
  ghosts.renderOrder = 50;
  scene.add(ghosts);

  // The Moon: a cratered grey sphere lit by the same Sun (so its phase is right), with the
  // dark part faintly lit by earthshine. It keeps the same face towards the Earth.
  const moonUniforms = { uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uEarthshine: { value: 0.02 } };
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(MOON_RADIUS, 64, 32),
    new THREE.ShaderMaterial({
      uniforms: moonUniforms,
      vertexShader: /* glsl */ `
        varying vec3 vNormalW;
        varying vec3 vPosObj;
        void main() {
          vNormalW = normalize(mat3(modelMatrix) * normal);
          vPosObj = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir;
        uniform float uEarthshine;
        varying vec3 vNormalW;
        varying vec3 vPosObj;
        float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float noise(vec3 p) {
          vec3 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        // One layer of craters: a darker bowl with a bright raised rim.
        float craters(vec3 p, float scale) {
          vec3 q = p * scale;
          vec3 c = floor(q);
          vec3 f = fract(q) - 0.5 - (vec3(hash(c + 1.0), hash(c + 2.0), hash(c + 3.0)) - 0.5) * 0.5;
          float d = length(f);
          float radius = 0.10 + 0.20 * hash(c + 5.0);
          float rimX = (d - radius) * 14.0;
          return exp(-rimX * rimX) * 0.22 - (1.0 - smoothstep(0.0, radius, d)) * 0.16;
        }
        void main() {
          vec3 p = normalize(vPosObj);
          float maria = smoothstep(0.42, 0.62, noise(p * 2.3 + 4.0));        // dark lava plains
          float rough = noise(p * 14.0) * 0.5 + noise(p * 31.0) * 0.25;
          float pits = craters(p, 5.0) + craters(p + 7.3, 11.0) * 0.7 + craters(p + 3.1, 23.0) * 0.45;
          vec3 albedo = mix(vec3(0.62, 0.61, 0.58), vec3(0.30, 0.30, 0.31), maria) * clamp(0.75 + rough * 0.4 + pits, 0.2, 1.6);
          // The dusty surface scatters light back, so the lit disc is nearly evenly bright.
          float light = pow(max(dot(normalize(vNormalW), uSunDir), 0.0), 0.7);
          vec3 col = albedo * light * 1.1 + albedo * vec3(0.55, 0.70, 1.0) * uEarthshine;
          gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
        }`,
    }),
  );
  // Drawn four times its true size: at its real half a degree the Moon is a dozen pixels and nobody notices it.
  moon.scale.setScalar(4);
  scene.add(moon);

  const cameraToSun = new THREE.Vector3();

  return {
    bodies,
    update(date, sunDirection, realSeconds) {
      sun.position.copy(sunDirection).multiplyScalar(SUN_DISTANCE);
      sunMaterial.uniforms.uPixelRatio.value = kit.pixelRatio;
      for (const points of [stars, planets]) {
        const material = points.material as THREE.ShaderMaterial;
        material.uniforms.uPixelRatio.value = kit.pixelRatio;
        material.uniforms.uTime.value = realSeconds;
      }

      // How clearly the camera sees the Sun: 1 in the open, 0 once the Earth is in the way.
      const cam = kit.camera.position;
      const along = -cam.dot(sunDirection); // distance along the sight line to its closest point to Earth's centre
      const miss = along > 0 ? cameraToSun.copy(cam).addScaledVector(sunDirection, along).length() : cam.length();
      const clear = THREE.MathUtils.smoothstep(miss, EARTH_RADIUS * 0.99, EARTH_RADIUS * 1.04);
      sunMaterial.uniforms.uClear.value = clear;
      ghostMaterial.uniforms.uSunPos.value.copy(sun.position);
      ghostMaterial.uniforms.uPixelRatio.value = kit.pixelRatio;
      ghostMaterial.uniforms.uStrength.value = clear;

      moonPosition(date, moon.position);
      moon.lookAt(0, 0, 0); // tidally locked: the same face always towards Earth
      bodies[0].direction.copy(moon.position).normalize();
      moonUniforms.uSunDir.value.copy(sunDirection);
      // Earthshine is strongest near new Moon, when the Moon sees a fully lit Earth.
      moonUniforms.uEarthshine.value = 0.008 + 0.03 * 0.5 * (1 + bodies[0].direction.dot(sunDirection));

      // The planets crawl; recompute only when the simulated clock has moved a minute.
      const t = date.getTime();
      if (!(Math.abs(t - planetsTime) < 60000)) {
        planetsTime = t;
        updatePlanets(date);
      }
    },
    backdrop() {
      const group = new THREE.Group();
      const far = new THREE.Mesh(dome.geometry, dome.material);
      far.renderOrder = dome.renderOrder;
      far.frustumCulled = false;
      const points = new THREE.Points(stars.geometry, stars.material);
      points.renderOrder = stars.renderOrder;
      points.frustumCulled = false;
      group.add(far, points);
      return group;
    },
    setStars(on) {
      starsOn = on;
      stars.visible = on;
      dome.visible = on;
      figures.visible = starsOn && figuresOn;
    },
    constellations,
    setConstellations(on) {
      figuresOn = on;
      figures.visible = starsOn && figuresOn;
    },
    setPlanets(on) {
      planets.visible = on;
    },
  };
}
