/**
 * The Sun, the planets and the moons the app knows: the facts that do not change.
 *
 * Where each one IS at a given moment is ephem.ts; what it looks like is imagery.ts. This file
 * is only the table: size, mass (as GM, which is what orbit maths needs), how long its day and
 * its year are, and a sentence to show beside it.
 *
 * Sources: radii and rotation periods from the IAU Working Group on Cartographic Coordinates
 * and Rotational Elements (2015 report); GM from JPL's DE440 planetary and satellite
 * ephemerides; orbital periods are sidereal. For the giant planets GM is the planet alone, not
 * the planet with its moons, because it is used for craft and moons orbiting close to it.
 */

import type { Body, BodyId } from './types.ts';

export const BODIES: Record<BodyId, Body> = {
  sun: {
    id: 'sun', name: 'Sun', parent: null, kind: 'star', radiusKm: 695700, gm: 1.32712440041e11,
    dayHours: 609.12, periodDays: 0, visitable: true, color: [1.0, 0.86, 0.55],
    blurb: 'The star at the centre: 99.86 % of the solar system\'s mass, turning once in about 25 days at its equator.',
    wiki: 'Sun',
  },
  mercury: {
    id: 'mercury', name: 'Mercury', parent: 'sun', kind: 'planet', radiusKm: 2439.4, gm: 22031.868551,
    dayHours: 1407.51, periodDays: 87.9691, visitable: true, color: [0.62, 0.59, 0.56],
    blurb: 'The smallest planet and the closest to the Sun; it turns three times for every two trips round it.',
    wiki: 'Mercury (planet)',
  },
  venus: {
    id: 'venus', name: 'Venus', parent: 'sun', kind: 'planet', radiusKm: 6051.8, gm: 324858.592,
    dayHours: -5832.54, periodDays: 224.701, visitable: true, color: [0.93, 0.83, 0.62],
    blurb: 'Earth\'s size, hidden under sulphuric-acid cloud and hot enough to melt lead; it turns backwards, more slowly than it orbits.',
    wiki: 'Venus',
  },
  earth: {
    id: 'earth', name: 'Earth', parent: 'sun', kind: 'planet', radiusKm: 6371.0084, gm: 398600.435507,
    dayHours: 23.9345, periodDays: 365.256, visitable: true, color: [0.29, 0.5, 0.86],
    blurb: 'Home: the only world known to have oceans on its surface, and the one every other object in this app was launched from.',
    wiki: 'Earth',
  },
  moon: {
    id: 'moon', name: 'Moon', parent: 'earth', kind: 'moon', radiusKm: 1737.4, gm: 4902.800118,
    dayHours: 655.72, periodDays: 27.321661, visitable: true, color: [0.72, 0.71, 0.69],
    blurb: 'Earth\'s companion, about 384,400 km away, keeping one face turned towards us.',
    wiki: 'Moon',
  },
  mars: {
    id: 'mars', name: 'Mars', parent: 'sun', kind: 'planet', radiusKm: 3389.5, gm: 42828.375816,
    dayHours: 24.6229, periodDays: 686.98, visitable: true, color: [0.84, 0.44, 0.27],
    blurb: 'A cold desert half Earth\'s width with the tallest volcano and the deepest canyon known; several orbiters and two rovers are at work there.',
    wiki: 'Mars',
  },
  phobos: {
    id: 'phobos', name: 'Phobos', parent: 'mars', kind: 'moon', radiusKm: 11.08, gm: 7.087e-4,
    dayHours: 7.6538, periodDays: 0.31891023, visitable: false, color: [0.52, 0.47, 0.43],
    blurb: 'The larger moon of Mars: a 22 km lump that goes round three times in a Martian day.',
    wiki: 'Phobos (moon)',
  },
  deimos: {
    id: 'deimos', name: 'Deimos', parent: 'mars', kind: 'moon', radiusKm: 6.2, gm: 9.62e-5,
    dayHours: 30.2986, periodDays: 1.2624407, visitable: false, color: [0.6, 0.55, 0.49],
    blurb: 'The smaller, outer moon of Mars, about 12 km across.',
    wiki: 'Deimos (moon)',
  },
  jupiter: {
    id: 'jupiter', name: 'Jupiter', parent: 'sun', kind: 'planet', radiusKm: 69911, gm: 126686531.9,
    dayHours: 9.925, periodDays: 4332.589, visitable: true, color: [0.85, 0.72, 0.56],
    blurb: 'The largest planet: a ball of hydrogen and helium more massive than all the others together, with a storm wider than Earth.',
    wiki: 'Jupiter',
  },
  io: {
    id: 'io', name: 'Io', parent: 'jupiter', kind: 'moon', radiusKm: 1821.49, gm: 5959.9155,
    dayHours: 42.4593, periodDays: 1.769137786, visitable: true, color: [0.93, 0.83, 0.42],
    blurb: 'The most volcanic place known: Jupiter\'s tides keep hundreds of volcanoes erupting across its sulphur-yellow surface.',
    wiki: 'Io (moon)',
  },
  europa: {
    id: 'europa', name: 'Europa', parent: 'jupiter', kind: 'moon', radiusKm: 1560.8, gm: 3202.7121,
    dayHours: 85.2283, periodDays: 3.551181041, visitable: true, color: [0.82, 0.76, 0.66],
    blurb: 'A cracked shell of ice over a salt-water ocean holding more water than all of Earth\'s seas.',
    wiki: 'Europa (moon)',
  },
  ganymede: {
    id: 'ganymede', name: 'Ganymede', parent: 'jupiter', kind: 'moon', radiusKm: 2631.2, gm: 9887.8328,
    dayHours: 171.7093, periodDays: 7.15455296, visitable: true, color: [0.62, 0.58, 0.53],
    blurb: 'The largest moon in the solar system, bigger than Mercury, and the only moon with a magnetic field of its own.',
    wiki: 'Ganymede (moon)',
  },
  callisto: {
    id: 'callisto', name: 'Callisto', parent: 'jupiter', kind: 'moon', radiusKm: 2410.3, gm: 7179.2834,
    dayHours: 400.5364, periodDays: 16.6890184, visitable: true, color: [0.43, 0.39, 0.35],
    blurb: 'A dark, ancient moon covered edge to edge in craters: the most heavily cratered surface known.',
    wiki: 'Callisto (moon)',
  },
  saturn: {
    id: 'saturn', name: 'Saturn', parent: 'sun', kind: 'planet', radiusKm: 58232, gm: 37931206.2,
    dayHours: 10.6562, periodDays: 10759.22, visitable: true, color: [0.89, 0.8, 0.6],
    blurb: 'The ringed planet: its bright rings of ice span 280,000 km and are in places only tens of metres thick.',
    wiki: 'Saturn',
  },
  enceladus: {
    id: 'enceladus', name: 'Enceladus', parent: 'saturn', kind: 'moon', radiusKm: 252.1, gm: 7.210367,
    dayHours: 32.8852, periodDays: 1.370218, visitable: false, color: [0.95, 0.96, 0.98],
    blurb: 'A small, brilliantly white moon that sprays water from an ocean under its south pole into space.',
    wiki: 'Enceladus',
  },
  titan: {
    id: 'titan', name: 'Titan', parent: 'saturn', kind: 'moon', radiusKm: 2574.73, gm: 8978.1382,
    dayHours: 382.69, periodDays: 15.945421, visitable: true, color: [0.87, 0.66, 0.33],
    blurb: 'The only moon with a thick atmosphere, and the only other world with rivers, lakes and rain: of liquid methane.',
    wiki: 'Titan (moon)',
  },
  uranus: {
    id: 'uranus', name: 'Uranus', parent: 'sun', kind: 'planet', radiusKm: 25362, gm: 5793951.3,
    dayHours: -17.24, periodDays: 30685.4, visitable: true, color: [0.62, 0.84, 0.88],
    blurb: 'An ice giant tipped on its side, so each pole has 42 years of daylight followed by 42 of night.',
    wiki: 'Uranus',
  },
  neptune: {
    id: 'neptune', name: 'Neptune', parent: 'sun', kind: 'planet', radiusKm: 24622, gm: 6835099.97,
    dayHours: 16.11, periodDays: 60189, visitable: true, color: [0.3, 0.45, 0.88],
    blurb: 'The outermost planet, found by calculation before it was seen; its winds are the fastest measured anywhere.',
    wiki: 'Neptune',
  },
  triton: {
    id: 'triton', name: 'Triton', parent: 'neptune', kind: 'moon', radiusKm: 1352.6, gm: 1428.495,
    dayHours: -141.0445, periodDays: 5.876854, visitable: false, color: [0.8, 0.74, 0.72],
    blurb: 'Neptune\'s large moon orbits backwards, which marks it as a captured world from the Kuiper belt.',
    wiki: 'Triton (moon)',
  },
  pluto: {
    id: 'pluto', name: 'Pluto', parent: 'sun', kind: 'dwarf', radiusKm: 1188.3, gm: 869.326,
    dayHours: -153.2928, periodDays: 90560, visitable: true, color: [0.8, 0.68, 0.56],
    blurb: 'A dwarf planet of nitrogen ice plains and water-ice mountains, seen close only once, by New Horizons in 2015.',
    wiki: 'Pluto',
  },
  charon: {
    id: 'charon', name: 'Charon', parent: 'pluto', kind: 'moon', radiusKm: 606, gm: 106.1,
    dayHours: -153.2928, periodDays: 6.3872304, visitable: false, color: [0.6, 0.58, 0.57],
    blurb: 'Pluto\'s moon is half Pluto\'s width; the two keep the same faces towards each other all the time.',
    wiki: 'Charon (moon)',
  },
};

/** The Sun, then the planets outward, each followed by its moons (the order lists are drawn in). */
export const BODY_LIST: Body[] = [
  'sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'phobos', 'deimos',
  'jupiter', 'io', 'europa', 'ganymede', 'callisto', 'saturn', 'enceladus', 'titan',
  'uranus', 'neptune', 'triton', 'pluto', 'charon',
].map((id) => BODIES[id as BodyId]);
