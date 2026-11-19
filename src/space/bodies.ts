/**
 * The Sun, the planets and the moons the app knows: the facts that do not change.
 *
 * Where each one IS at a given moment is ephem.ts; what it looks like is imagery.ts. This file
 * is only the table: size, mass (as GM, which is what orbit maths needs), how long its day and
 * its year are, who found it, how warm it is, what its air is, and a sentence to show beside it.
 *
 * Sources:
 *   radius, GM     JPL Solar System Dynamics, "Planetary Satellite Physical Parameters" (the
 *                  satellite ephemerides JUP365, SAT441, URA111, NEP097, PLU060) and DE440 for
 *                  the planets. For the giant planets GM is the planet alone, not the planet
 *                  with its moons, because it is used for things orbiting close to it. The GM of
 *                  Puck, Nereid, Kerberos and Styx is not measured: a nominal figure is given
 *                  and nothing uses it.
 *   periods        NASA NSSDC planetary and satellite fact sheets; orbital periods are sidereal.
 *                  A moon that keeps one face to its planet has a day equal to its orbit.
 *   temperatures   NSSDC "Planetary Fact Sheet" (mean; at the one-bar level for the giants);
 *                  for moons only where NASA quotes one figure for the whole surface.
 *   discoveries    NSSDC fact sheets. Bodies known since antiquity have no entry.
 *
 * `dayHours` is negative for a body that turns backwards compared with the planets' common
 * direction (Venus, Uranus and its moons, Triton, Pluto and Charon) and 0 where there is no
 * steady rotation to state (Hyperion tumbles).
 *
 * `visitable` = it has a map in imagery.ts. Twelve small moons have never been mapped (or are
 * too small to have a surface worth standing on in this app): they are plain coloured balls.
 */

import type { Body, BodyId } from './types.ts';

export const BODIES: Record<BodyId, Body> = {
  sun: {
    id: 'sun', name: 'Sun', parent: null, kind: 'star', radiusKm: 695700, gm: 1.32712440041e11,
    dayHours: 609.12, periodDays: 0, visitable: true, color: [1.0, 0.86, 0.55],
    blurb: 'The star at the centre: 99.86 % of the solar system\'s mass, turning once in about 25 days at its equator.',
    wiki: 'Sun', tempC: 5500,
  },
  mercury: {
    id: 'mercury', name: 'Mercury', parent: 'sun', kind: 'planet', radiusKm: 2439.4, gm: 22031.868551,
    dayHours: 1407.51, periodDays: 87.9691, visitable: true, color: [0.62, 0.59, 0.56],
    blurb: 'The smallest planet and the closest to the Sun; it turns three times for every two trips round it.',
    wiki: 'Mercury (planet)', tempC: 167,
  },
  venus: {
    id: 'venus', name: 'Venus', parent: 'sun', kind: 'planet', radiusKm: 6051.8, gm: 324858.592,
    dayHours: -5832.54, periodDays: 224.701, visitable: true, color: [0.93, 0.83, 0.62],
    blurb: 'Earth\'s size, hidden under sulphuric-acid cloud and hot enough to melt lead; it turns backwards, more slowly than it orbits.',
    wiki: 'Venus', tempC: 464, air: 'Crushing carbon dioxide, with clouds of sulphuric acid',
  },
  earth: {
    id: 'earth', name: 'Earth', parent: 'sun', kind: 'planet', radiusKm: 6371.0084, gm: 398600.435507,
    dayHours: 23.9345, periodDays: 365.256, visitable: true, color: [0.29, 0.5, 0.86],
    blurb: 'Home: the only world known to have oceans on its surface, and the one every other object in this app was launched from.',
    wiki: 'Earth', tempC: 15, air: 'Nitrogen and oxygen',
  },
  moon: {
    id: 'moon', name: 'Moon', parent: 'earth', kind: 'moon', radiusKm: 1737.4, gm: 4902.800118,
    dayHours: 655.72, periodDays: 27.321661, visitable: true, color: [0.72, 0.71, 0.69],
    blurb: 'Earth\'s companion, about 384,400 km away, keeping one face turned towards us.',
    wiki: 'Moon', tempC: -20,
  },
  mars: {
    id: 'mars', name: 'Mars', parent: 'sun', kind: 'planet', radiusKm: 3389.5, gm: 42828.375816,
    dayHours: 24.6229, periodDays: 686.98, visitable: true, color: [0.84, 0.44, 0.27],
    blurb: 'A cold desert half Earth\'s width with the tallest volcano and the deepest canyon known; several orbiters and two rovers are at work there.',
    wiki: 'Mars', tempC: -65, air: 'Thin carbon dioxide',
  },
  phobos: {
    id: 'phobos', name: 'Phobos', parent: 'mars', kind: 'moon', radiusKm: 11.08, gm: 7.087e-4,
    dayHours: 7.6538, periodDays: 0.31891023, visitable: false, color: [0.52, 0.47, 0.43],
    blurb: 'The larger moon of Mars: a 22 km lump that goes round three times in a Martian day.',
    wiki: 'Phobos (moon)', discovered: 'Asaph Hall, 1877',
  },
  deimos: {
    id: 'deimos', name: 'Deimos', parent: 'mars', kind: 'moon', radiusKm: 6.2, gm: 9.62e-5,
    dayHours: 30.2986, periodDays: 1.2624407, visitable: false, color: [0.6, 0.55, 0.49],
    blurb: 'The smaller, outer moon of Mars, about 12 km across.',
    wiki: 'Deimos (moon)', discovered: 'Asaph Hall, 1877',
  },
  jupiter: {
    id: 'jupiter', name: 'Jupiter', parent: 'sun', kind: 'planet', radiusKm: 69911, gm: 126686531.9,
    dayHours: 9.925, periodDays: 4332.589, visitable: true, color: [0.85, 0.72, 0.56],
    blurb: 'The largest planet: a ball of hydrogen and helium more massive than all the others together, with a storm wider than Earth.',
    wiki: 'Jupiter', tempC: -110, air: 'Hydrogen and helium',
  },
  amalthea: {
    id: 'amalthea', name: 'Amalthea', parent: 'jupiter', kind: 'moon', radiusKm: 83.5, gm: 0.16456,
    dayHours: 11.9563, periodDays: 0.498179, visitable: false, color: [0.66, 0.42, 0.33],
    blurb: 'A red, potato-shaped moon inside Io\'s orbit; dust knocked off it feeds one of Jupiter\'s faint rings.',
    wiki: 'Amalthea (moon)', discovered: 'Edward Emerson Barnard, 1892',
  },
  thebe: {
    id: 'thebe', name: 'Thebe', parent: 'jupiter', kind: 'moon', radiusKm: 49.3, gm: 0.03015,
    dayHours: 16.188, periodDays: 0.6745, visitable: false, color: [0.55, 0.45, 0.4],
    blurb: 'A small inner moon whose dust makes the outermost of Jupiter\'s faint rings.',
    wiki: 'Thebe (moon)', discovered: 'Stephen Synnott, in Voyager 1 pictures, 1979',
  },
  io: {
    id: 'io', name: 'Io', parent: 'jupiter', kind: 'moon', radiusKm: 1821.49, gm: 5959.91547,
    dayHours: 42.4593, periodDays: 1.769137786, visitable: true, color: [0.93, 0.83, 0.42],
    blurb: 'The most volcanic place known: Jupiter\'s tides keep hundreds of volcanoes erupting across its sulphur-yellow surface.',
    wiki: 'Io (moon)', discovered: 'Galileo Galilei, 1610', tempC: -130,
  },
  europa: {
    id: 'europa', name: 'Europa', parent: 'jupiter', kind: 'moon', radiusKm: 1560.8, gm: 3202.7121,
    dayHours: 85.2283, periodDays: 3.551181041, visitable: true, color: [0.82, 0.76, 0.66],
    blurb: 'A cracked shell of ice over a salt-water ocean holding more water than all of Earth\'s seas.',
    wiki: 'Europa (moon)', discovered: 'Galileo Galilei, 1610', tempC: -160,
  },
  ganymede: {
    id: 'ganymede', name: 'Ganymede', parent: 'jupiter', kind: 'moon', radiusKm: 2631.2, gm: 9887.83275,
    dayHours: 171.7093, periodDays: 7.15455296, visitable: true, color: [0.62, 0.58, 0.53],
    blurb: 'The largest moon in the solar system, bigger than Mercury, and the only moon with a magnetic field of its own.',
    wiki: 'Ganymede (moon)', discovered: 'Galileo Galilei, 1610',
  },
  callisto: {
    id: 'callisto', name: 'Callisto', parent: 'jupiter', kind: 'moon', radiusKm: 2410.3, gm: 7179.2834,
    dayHours: 400.5364, periodDays: 16.6890184, visitable: true, color: [0.43, 0.39, 0.35],
    blurb: 'A dark, ancient moon covered edge to edge in craters: the most heavily cratered surface known.',
    wiki: 'Callisto (moon)', discovered: 'Galileo Galilei, 1610', tempC: -139,
  },
  himalia: {
    id: 'himalia', name: 'Himalia', parent: 'jupiter', kind: 'moon', radiusKm: 85, gm: 0.15155,
    dayHours: 7.782, periodDays: 250.5662, visitable: false, color: [0.5, 0.48, 0.45],
    blurb: 'The largest of Jupiter\'s outer, irregular moons, on a tilted orbit that takes 250 days.',
    wiki: 'Himalia (moon)', discovered: 'Charles Dillon Perrine, 1904',
  },
  saturn: {
    id: 'saturn', name: 'Saturn', parent: 'sun', kind: 'planet', radiusKm: 58232, gm: 37931206.2,
    dayHours: 10.6562, periodDays: 10759.22, visitable: true, color: [0.89, 0.8, 0.6],
    blurb: 'The ringed planet: its bright rings of ice span 280,000 km and are in places only tens of metres thick.',
    wiki: 'Saturn', tempC: -140, air: 'Hydrogen and helium',
  },
  epimetheus: {
    id: 'epimetheus', name: 'Epimetheus', parent: 'saturn', kind: 'moon', radiusKm: 58.2, gm: 0.03514,
    dayHours: 16.664, periodDays: 0.694333, visitable: false, color: [0.72, 0.72, 0.71],
    blurb: 'The smaller of two moons that share one orbit: every four years it and Janus draw close and swap places.',
    wiki: 'Epimetheus (moon)', discovered: 'Richard Walker, 1966',
  },
  janus: {
    id: 'janus', name: 'Janus', parent: 'saturn', kind: 'moon', radiusKm: 89.2, gm: 0.12662,
    dayHours: 16.672, periodDays: 0.69466, visitable: false, color: [0.75, 0.75, 0.74],
    blurb: 'Shares its orbit with Epimetheus: every four years the two moons draw close and swap places.',
    wiki: 'Janus (moon)', discovered: 'Audouin Dollfus, 1966',
  },
  mimas: {
    id: 'mimas', name: 'Mimas', parent: 'saturn', kind: 'moon', radiusKm: 198.2, gm: 2.50349,
    dayHours: 22.6181, periodDays: 0.942421959, visitable: false, color: [0.78, 0.78, 0.78],
    blurb: 'A small ball of ice whose one huge crater, Herschel, is a third as wide as the moon itself.',
    wiki: 'Mimas', discovered: 'William Herschel, 1789',
  },
  enceladus: {
    id: 'enceladus', name: 'Enceladus', parent: 'saturn', kind: 'moon', radiusKm: 252.1, gm: 7.21037,
    dayHours: 32.8852, periodDays: 1.370218, visitable: false, color: [0.95, 0.96, 0.98],
    blurb: 'A small, brilliantly white moon that sprays water from an ocean under its south pole into space.',
    wiki: 'Enceladus', discovered: 'William Herschel, 1789', tempC: -201,
  },
  tethys: {
    id: 'tethys', name: 'Tethys', parent: 'saturn', kind: 'moon', radiusKm: 531.1, gm: 41.21353,
    dayHours: 45.3072, periodDays: 1.88780216, visitable: false, color: [0.88, 0.88, 0.87],
    blurb: 'A ball of almost pure water ice, split by Ithaca Chasma, a canyon that runs three quarters of the way round it.',
    wiki: 'Tethys (moon)', discovered: 'Giovanni Domenico Cassini, 1684',
  },
  dione: {
    id: 'dione', name: 'Dione', parent: 'saturn', kind: 'moon', radiusKm: 561.4, gm: 73.11607,
    dayHours: 65.686, periodDays: 2.736914742, visitable: false, color: [0.82, 0.82, 0.8],
    blurb: 'An icy moon whose trailing side is laced with bright cliffs of ice hundreds of metres high.',
    wiki: 'Dione (moon)', discovered: 'Giovanni Domenico Cassini, 1684',
  },
  rhea: {
    id: 'rhea', name: 'Rhea', parent: 'saturn', kind: 'moon', radiusKm: 763.5, gm: 153.94175,
    dayHours: 108.437, periodDays: 4.518212, visitable: false, color: [0.8, 0.79, 0.77],
    blurb: 'Saturn\'s second-largest moon: a heavily cratered ball of ice and rock.',
    wiki: 'Rhea (moon)', discovered: 'Giovanni Domenico Cassini, 1672',
  },
  titan: {
    id: 'titan', name: 'Titan', parent: 'saturn', kind: 'moon', radiusKm: 2574.76, gm: 8978.1371,
    dayHours: 382.69, periodDays: 15.945421, visitable: true, color: [0.87, 0.66, 0.33],
    blurb: 'The only moon with a thick atmosphere, and the only other world with rivers, lakes and rain: of liquid methane.',
    wiki: 'Titan (moon)', discovered: 'Christiaan Huygens, 1655', tempC: -179, air: 'Thick nitrogen, with methane haze',
  },
  hyperion: {
    id: 'hyperion', name: 'Hyperion', parent: 'saturn', kind: 'moon', radiusKm: 135, gm: 0.37049,
    dayHours: 0, periodDays: 21.276609, visitable: false, color: [0.72, 0.62, 0.52],
    blurb: 'A spongy-looking, potato-shaped moon that tumbles unpredictably instead of keeping one face to Saturn.',
    wiki: 'Hyperion (moon)', discovered: 'William and George Bond, and William Lassell, 1848',
  },
  iapetus: {
    id: 'iapetus', name: 'Iapetus', parent: 'saturn', kind: 'moon', radiusKm: 734.3, gm: 120.51511,
    dayHours: 1903.92, periodDays: 79.330183, visitable: false, color: [0.62, 0.55, 0.47],
    blurb: 'A two-toned moon, one half as dark as coal and the other bright as snow, with a mountain ridge along its equator.',
    wiki: 'Iapetus (moon)', discovered: 'Giovanni Domenico Cassini, 1671',
  },
  phoebe: {
    id: 'phoebe', name: 'Phoebe', parent: 'saturn', kind: 'moon', radiusKm: 106.5, gm: 0.55479,
    dayHours: 9.2735, periodDays: 550.31, visitable: false, color: [0.36, 0.34, 0.33],
    blurb: 'A dark moon that orbits Saturn backwards, far out: almost certainly a body captured from the outer solar system.',
    wiki: 'Phoebe (moon)', discovered: 'William Henry Pickering, 1899',
  },
  uranus: {
    id: 'uranus', name: 'Uranus', parent: 'sun', kind: 'planet', radiusKm: 25362, gm: 5793951.3,
    dayHours: -17.24, periodDays: 30685.4, visitable: true, color: [0.62, 0.84, 0.88],
    blurb: 'An ice giant tipped on its side, so each pole has 42 years of daylight followed by 42 of night.',
    wiki: 'Uranus', discovered: 'William Herschel, 1781', tempC: -195, air: 'Hydrogen and helium, tinted by methane',
  },
  puck: {
    id: 'puck', name: 'Puck', parent: 'uranus', kind: 'moon', radiusKm: 81, gm: 0.19,
    dayHours: -18.284, periodDays: 0.761833, visitable: false, color: [0.45, 0.45, 0.47],
    blurb: 'The largest of Uranus\'s small inner moons, dark and cratered; Voyager 2 found it on the way in.',
    wiki: 'Puck (moon)', discovered: 'Stephen Synnott, in Voyager 2 pictures, 1985',
  },
  miranda: {
    id: 'miranda', name: 'Miranda', parent: 'uranus', kind: 'moon', radiusKm: 235.8, gm: 4.3,
    dayHours: -33.9235, periodDays: 1.413479, visitable: false, color: [0.74, 0.74, 0.74],
    blurb: 'A small moon with a patchwork surface and Verona Rupes, a cliff about 20 km high: the tallest known.',
    wiki: 'Miranda (moon)', discovered: 'Gerard Kuiper, 1948',
  },
  ariel: {
    id: 'ariel', name: 'Ariel', parent: 'uranus', kind: 'moon', radiusKm: 578.9, gm: 83.5,
    dayHours: -60.4891, periodDays: 2.520379, visitable: false, color: [0.78, 0.77, 0.75],
    blurb: 'The brightest of Uranus\'s moons, with the youngest surface: long fault valleys floored by frozen flows.',
    wiki: 'Ariel (moon)', discovered: 'William Lassell, 1851',
  },
  umbriel: {
    id: 'umbriel', name: 'Umbriel', parent: 'uranus', kind: 'moon', radiusKm: 584.7, gm: 85.1,
    dayHours: -99.4602, periodDays: 4.144176, visitable: false, color: [0.45, 0.45, 0.46],
    blurb: 'The darkest of Uranus\'s large moons, ancient and cratered, with one bright ring on the floor of the crater Wunda.',
    wiki: 'Umbriel (moon)', discovered: 'William Lassell, 1851',
  },
  titania: {
    id: 'titania', name: 'Titania', parent: 'uranus', kind: 'moon', radiusKm: 788.9, gm: 226.9,
    dayHours: -208.941, periodDays: 8.705867, visitable: false, color: [0.68, 0.65, 0.62],
    blurb: 'The largest moon of Uranus, crossed by canyons hundreds of kilometres long.',
    wiki: 'Titania (moon)', discovered: 'William Herschel, 1787',
  },
  oberon: {
    id: 'oberon', name: 'Oberon', parent: 'uranus', kind: 'moon', radiusKm: 761.4, gm: 205.3,
    dayHours: -323.118, periodDays: 13.463234, visitable: false, color: [0.6, 0.56, 0.54],
    blurb: 'The outermost large moon of Uranus, heavily cratered, with something dark on the floors of its craters.',
    wiki: 'Oberon (moon)', discovered: 'William Herschel, 1787',
  },
  neptune: {
    id: 'neptune', name: 'Neptune', parent: 'sun', kind: 'planet', radiusKm: 24622, gm: 6835099.97,
    dayHours: 16.11, periodDays: 60189, visitable: true, color: [0.3, 0.45, 0.88],
    blurb: 'The outermost planet, found by calculation before it was seen; its winds are the fastest measured anywhere.',
    wiki: 'Neptune', discovered: 'Johann Galle, where Urbain Le Verrier had calculated, 1846', tempC: -200, air: 'Hydrogen and helium, tinted by methane',
  },
  proteus: {
    id: 'proteus', name: 'Proteus', parent: 'neptune', kind: 'moon', radiusKm: 208, gm: 2.58342,
    dayHours: 26.9356, periodDays: 1.122315, visitable: false, color: [0.42, 0.42, 0.43],
    blurb: 'Neptune\'s second-largest moon, dark as soot and about as big as a body can be without pulling itself round.',
    wiki: 'Proteus (moon)', discovered: 'Voyager 2 (Stephen Synnott and Bradford Smith), 1989',
  },
  triton: {
    id: 'triton', name: 'Triton', parent: 'neptune', kind: 'moon', radiusKm: 1352.6, gm: 1428.49546,
    dayHours: -141.0445, periodDays: 5.876854, visitable: false, color: [0.8, 0.74, 0.72],
    blurb: 'Neptune\'s large moon orbits backwards, which marks it as a captured world from the Kuiper belt.',
    wiki: 'Triton (moon)', discovered: 'William Lassell, 1846', tempC: -235, air: 'A trace of nitrogen',
  },
  nereid: {
    id: 'nereid', name: 'Nereid', parent: 'neptune', kind: 'moon', radiusKm: 170, gm: 1.8,
    dayHours: 11.594, periodDays: 360.13619, visitable: false, color: [0.6, 0.6, 0.6],
    blurb: 'A moon on one of the most stretched orbits known: seven times farther from Neptune at its farthest than at its nearest.',
    wiki: 'Nereid (moon)', discovered: 'Gerard Kuiper, 1949',
  },
  pluto: {
    id: 'pluto', name: 'Pluto', parent: 'sun', kind: 'dwarf', radiusKm: 1188.3, gm: 869.326,
    dayHours: -153.2928, periodDays: 90560, visitable: true, color: [0.8, 0.68, 0.56],
    blurb: 'A dwarf planet of nitrogen ice plains and water-ice mountains, seen close only once, by New Horizons in 2015.',
    wiki: 'Pluto', discovered: 'Clyde Tombaugh, 1930', tempC: -225, air: 'A trace of nitrogen',
  },
  charon: {
    id: 'charon', name: 'Charon', parent: 'pluto', kind: 'moon', radiusKm: 606, gm: 106.1,
    dayHours: -153.2928, periodDays: 6.3872304, visitable: false, color: [0.6, 0.58, 0.57],
    blurb: 'Pluto\'s moon is half Pluto\'s width; the two keep the same faces towards each other all the time.',
    wiki: 'Charon (moon)', discovered: 'James Christy, 1978',
  },
  styx: {
    id: 'styx', name: 'Styx', parent: 'pluto', kind: 'moon', radiusKm: 5.2, gm: 0.0001,
    dayHours: 77.8, periodDays: 20.16155, visitable: false, color: [0.72, 0.72, 0.7],
    blurb: 'The smallest and innermost of Pluto\'s four small moons, about ten kilometres across.',
    wiki: 'Styx (moon)', discovered: 'Mark Showalter and team, with the Hubble Space Telescope, 2012',
  },
  nix: {
    id: 'nix', name: 'Nix', parent: 'pluto', kind: 'moon', radiusKm: 18, gm: 0.0015,
    dayHours: 43.9, periodDays: 24.85463, visitable: false, color: [0.82, 0.82, 0.8],
    blurb: 'A small, elongated moon of Pluto, bright with water ice, that spins fast on a tilted axis.',
    wiki: 'Nix (moon)', discovered: 'Hal Weaver, Alan Stern and team, with the Hubble Space Telescope, 2005',
  },
  kerberos: {
    id: 'kerberos', name: 'Kerberos', parent: 'pluto', kind: 'moon', radiusKm: 6, gm: 0.0001,
    dayHours: 127.4, periodDays: 32.16756, visitable: false, color: [0.7, 0.7, 0.68],
    blurb: 'A tiny two-lobed moon of Pluto, about twelve kilometres across.',
    wiki: 'Kerberos (moon)', discovered: 'Mark Showalter and team, with the Hubble Space Telescope, 2011',
  },
  hydra: {
    id: 'hydra', name: 'Hydra', parent: 'pluto', kind: 'moon', radiusKm: 18.5, gm: 0.002,
    dayHours: 10.31, periodDays: 38.20177, visitable: false, color: [0.85, 0.85, 0.83],
    blurb: 'Pluto\'s outermost moon: a bright lump of water ice spinning once every ten hours.',
    wiki: 'Hydra (moon)', discovered: 'Hal Weaver, Alan Stern and team, with the Hubble Space Telescope, 2005',
  },
};

/** The Sun, then the planets outward, each followed by its moons from the inside out (the order lists are drawn in). */
export const BODY_LIST: Body[] = [
  'sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'phobos', 'deimos',
  'jupiter', 'amalthea', 'thebe', 'io', 'europa', 'ganymede', 'callisto', 'himalia',
  'saturn', 'epimetheus', 'janus', 'mimas', 'enceladus', 'tethys', 'dione', 'rhea', 'titan', 'hyperion', 'iapetus', 'phoebe',
  'uranus', 'puck', 'miranda', 'ariel', 'umbriel', 'titania', 'oberon',
  'neptune', 'proteus', 'triton', 'nereid',
  'pluto', 'charon', 'styx', 'nix', 'kerberos', 'hydra',
].map((id) => BODIES[id as BodyId]);
