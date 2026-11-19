/**
 * Historic landing sites: the places where something from Earth came down and stayed.
 *
 * Craft that are still on the ground and in the data file (Curiosity, Perseverance, the
 * recent Moon landers) are not repeated here; these are the ones whose work is over.
 * Coordinates are planetocentric latitude and EAST longitude, degrees (the Apollo sites from
 * the Lunar Reconnaissance Orbiter camera team's measurements, the Mars sites from NASA's
 * mission records). ui/places.ts gives each to the views as a craft that stands on the ground.
 */

import type { Site } from './types.ts';

export const SITES: Site[] = [
  // ---- the Moon ----
  { id: 'apollo-11', name: 'Apollo 11', body: 'moon', latDeg: 0.6741, lonDeg: 23.473, date: '1969-07-20', agency: 'NASA', kind: 'crewed', model: 'lander', wiki: 'Apollo 11',
    blurb: 'Tranquility Base, where Neil Armstrong and Buzz Aldrin became the first people to walk on another world.' },
  { id: 'apollo-12', name: 'Apollo 12', body: 'moon', latDeg: -3.0124, lonDeg: -23.4216, date: '1969-11-19', agency: 'NASA', kind: 'crewed', model: 'lander', wiki: 'Apollo 12',
    blurb: 'A pinpoint landing within walking distance of the Surveyor 3 probe, which the crew visited and brought parts of home.' },
  { id: 'apollo-14', name: 'Apollo 14', body: 'moon', latDeg: -3.6453, lonDeg: -17.4714, date: '1971-02-05', agency: 'NASA', kind: 'crewed', model: 'lander', wiki: 'Apollo 14',
    blurb: 'The Fra Mauro highlands, the target Apollo 13 never reached. Alan Shepard hit two golf balls here.' },
  { id: 'apollo-15', name: 'Apollo 15', body: 'moon', latDeg: 26.1322, lonDeg: 3.6339, date: '1971-07-30', agency: 'NASA', kind: 'crewed', model: 'lander', wiki: 'Apollo 15',
    blurb: 'Hadley Rille, at the foot of the Apennine mountains: the first mission to bring a car, the Lunar Roving Vehicle.' },
  { id: 'apollo-16', name: 'Apollo 16', body: 'moon', latDeg: -8.973, lonDeg: 15.5002, date: '1972-04-21', agency: 'NASA', kind: 'crewed', model: 'lander', wiki: 'Apollo 16',
    blurb: 'The Descartes highlands, the only Apollo landing in the bright, ancient uplands of the Moon.' },
  { id: 'apollo-17', name: 'Apollo 17', body: 'moon', latDeg: 20.1908, lonDeg: 30.7717, date: '1972-12-11', agency: 'NASA', kind: 'crewed', model: 'lander', wiki: 'Apollo 17',
    blurb: 'The Taurus–Littrow valley. Nobody has stood on the Moon since Gene Cernan and Harrison Schmitt left it.' },

  // ---- Mars ----
  { id: 'viking-1', name: 'Viking 1', body: 'mars', latDeg: 22.27, lonDeg: -47.95, date: '1976-07-20', agency: 'NASA', kind: 'lander', model: 'lander', wiki: 'Viking 1',
    blurb: 'The first spacecraft to work on the surface of Mars; it sent pictures and weather reports from Chryse Planitia for six years.' },
  { id: 'viking-2', name: 'Viking 2', body: 'mars', latDeg: 47.64, lonDeg: 134.29, date: '1976-09-03', agency: 'NASA', kind: 'lander', model: 'lander', wiki: 'Viking 2',
    blurb: 'The second Viking, on the plain of Utopia Planitia, where it photographed frost on the ground in winter.' },
  { id: 'pathfinder', name: 'Mars Pathfinder', body: 'mars', latDeg: 19.13, lonDeg: -33.22, date: '1997-07-04', agency: 'NASA', kind: 'rover', model: 'rover', wiki: 'Mars Pathfinder',
    blurb: 'It bounced to a stop on airbags and let out Sojourner, the first rover to drive on another planet.' },
  { id: 'spirit', name: 'Spirit', body: 'mars', latDeg: -14.5684, lonDeg: 175.4726, date: '2004-01-04', agency: 'NASA', kind: 'rover', model: 'rover', wiki: 'Spirit (rover)',
    blurb: 'Built to last ninety days in Gusev crater, it drove for six years before its wheels stuck in soft sand.' },
  { id: 'opportunity', name: 'Opportunity', body: 'mars', latDeg: -1.9462, lonDeg: -5.5266, date: '2004-01-25', agency: 'NASA', kind: 'rover', model: 'rover', wiki: 'Opportunity (rover)',
    blurb: 'Spirit’s twin landed on Meridiani Planum and kept going for more than fourteen years and 45 kilometres, until a dust storm ended it.' },
  { id: 'phoenix', name: 'Phoenix', body: 'mars', latDeg: 68.22, lonDeg: -125.7, date: '2008-05-25', agency: 'NASA', kind: 'lander', model: 'lander', wiki: 'Phoenix (spacecraft)',
    blurb: 'It landed in the far north, dug into the soil, and found water ice a few centimetres down.' },

  // ---- Titan ----
  { id: 'huygens', name: 'Huygens', body: 'titan', latDeg: -10.573, lonDeg: 167.665, date: '2005-01-14', agency: 'ESA', kind: 'probe', model: 'lander', wiki: 'Huygens (spacecraft)',
    blurb: 'Carried to Saturn by Cassini, it parachuted through Titan’s haze onto a plain of ice pebbles: the most distant landing ever made.' },
];
