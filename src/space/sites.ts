/**
 * Historic landing sites: the places where something from Earth came down and stayed.
 *
 * Craft that are still on the ground and in the data file (Curiosity, Perseverance, InSight,
 * Zhurong, Blue Ghost, Odysseus, Vikram, SLIM) are not repeated here; these are the others.
 * ui/places.ts gives each to the views as a craft that stands on the ground.
 *
 * Coordinates are planetocentric latitude and EAST longitude, degrees, and every one was
 * checked against a primary source in November 2026:
 *
 *   the Moon   NASA NSSDC, "Table of Anthropogenic Impacts and Spacecraft on the Moon" and
 *              "Apollo Landing Site Coordinates": positions measured on Lunar Reconnaissance
 *              Orbiter pictures (Wagner et al. 2017) wherever the hardware has been found, in
 *              the Mean Earth / Polar Axis frame. The Apollo figures are the Lunar Modules.
 *              Luna 2 struck before anything could watch it: "30° N, 0° E" is all that is known.
 *   Mars       NSSDC's record of each lander. Viking 1, Viking 2 and Opportunity are quoted
 *              there in today's planetocentric frame. Spirit's and Phoenix's are the missions'
 *              own final figures (NSSDC's 14.572° S, 175.478° E and its pre-landing 68.15° N
 *              agree with them to a hundredth and a tenth of a degree). Pathfinder is quoted
 *              there as 19.33° N, 33.55° W in the older planetographic frame, which is the
 *              19.13° N, 33.22° W used here.
 *   Venus      Venera 7 and 13 as published by the Soviet programme and repeated by NASA
 *              (5° S 351° E; 7.5° S 303° E). NSSDC's own pages for these two were returning
 *              errors when this was checked, so they rest on the published figures.
 *   Titan      Huygens, from the reconstruction of its descent (ESA; Kazeminejad et al. 2011):
 *              10.573° S, 192.335° W. The same caveat as for Venus applies.
 *
 * Dates are UTC days. `kind` says what happened there: people walked, a lander stayed put, a
 * rover drove off, or a probe only struck (Luna 2) or fell through the air reporting (Huygens).
 */

import type { Site } from './types.ts';

export const SITES: Site[] = [
  // ---- the Moon: first arrivals ----
  { id: 'luna-2', name: 'Luna 2', body: 'moon', latDeg: 30, lonDeg: 0, date: '1959-09-13', agency: 'Soviet Union', kind: 'probe', model: 'lander', wiki: 'Luna 2',
    blurb: 'The first thing made by people to reach another world: a Soviet probe that struck the Moon here, or near here. The place is known only roughly.' },
  { id: 'luna-9', name: 'Luna 9', body: 'moon', latDeg: 7.13, lonDeg: -64.37, date: '1966-02-03', agency: 'Soviet Union', kind: 'lander', model: 'lander', wiki: 'Luna 9',
    blurb: 'The first soft landing on the Moon, and the first pictures from its surface. They settled a worry of the time: the ground would bear a spacecraft\'s weight.' },
  { id: 'surveyor-1', name: 'Surveyor 1', body: 'moon', latDeg: -2.4745, lonDeg: -43.3398, date: '1966-06-02', agency: 'NASA', kind: 'lander', model: 'lander', wiki: 'Surveyor 1',
    blurb: 'America\'s first soft landing on the Moon. It sent back more than eleven thousand pictures of the ground around its feet.' },
  { id: 'surveyor-3', name: 'Surveyor 3', body: 'moon', latDeg: -3.0162, lonDeg: -23.418, date: '1967-04-20', agency: 'NASA', kind: 'lander', model: 'lander', wiki: 'Surveyor 3',
    blurb: 'It dug the first trenches on the Moon with a scoop. Two and a half years later the crew of Apollo 12 walked over to it and took parts of it home.' },
  { id: 'surveyor-5', name: 'Surveyor 5', body: 'moon', latDeg: 1.4551, lonDeg: 23.1943, date: '1967-09-11', agency: 'NASA', kind: 'lander', model: 'lander', wiki: 'Surveyor 5',
    blurb: 'Made the first chemical analysis of the soil of another world, in the Sea of Tranquillity, 25 km from where Apollo 11 would land.' },
  { id: 'surveyor-6', name: 'Surveyor 6', body: 'moon', latDeg: 0.4742, lonDeg: -1.4275, date: '1967-11-10', agency: 'NASA', kind: 'lander', model: 'lander', wiki: 'Surveyor 6',
    blurb: 'The first craft to lift off from the Moon: it fired its engines for two and a half seconds and came down again a few metres away.' },
  { id: 'surveyor-7', name: 'Surveyor 7', body: 'moon', latDeg: -40.9812, lonDeg: -11.5127, date: '1968-01-10', agency: 'NASA', kind: 'lander', model: 'lander', wiki: 'Surveyor 7',
    blurb: 'The last Surveyor, sent for science rather than to scout for Apollo: it landed on the rugged rim of the crater Tycho.' },

  // ---- the Moon: Apollo ----
  { id: 'apollo-11', name: 'Apollo 11', body: 'moon', latDeg: 0.67416, lonDeg: 23.47314, date: '1969-07-20', agency: 'NASA', kind: 'crewed', model: 'lander', wiki: 'Apollo 11',
    blurb: 'Tranquility Base, where Neil Armstrong and Buzz Aldrin became the first people to walk on another world.' },
  { id: 'apollo-12', name: 'Apollo 12', body: 'moon', latDeg: -3.0128, lonDeg: -23.4219, date: '1969-11-19', agency: 'NASA', kind: 'crewed', model: 'lander', wiki: 'Apollo 12',
    blurb: 'A pinpoint landing within walking distance of the Surveyor 3 probe, which the crew visited and brought parts of home.' },
  { id: 'apollo-14', name: 'Apollo 14', body: 'moon', latDeg: -3.64589, lonDeg: -17.47194, date: '1971-02-05', agency: 'NASA', kind: 'crewed', model: 'lander', wiki: 'Apollo 14',
    blurb: 'The Fra Mauro highlands, the target Apollo 13 never reached. Alan Shepard hit two golf balls here.' },
  { id: 'apollo-15', name: 'Apollo 15', body: 'moon', latDeg: 26.13239, lonDeg: 3.6333, date: '1971-07-30', agency: 'NASA', kind: 'crewed', model: 'lander', wiki: 'Apollo 15',
    blurb: 'Hadley Rille, at the foot of the Apennine mountains: the first mission to bring a car, the Lunar Roving Vehicle.' },
  { id: 'apollo-16', name: 'Apollo 16', body: 'moon', latDeg: -8.9734, lonDeg: 15.5011, date: '1972-04-21', agency: 'NASA', kind: 'crewed', model: 'lander', wiki: 'Apollo 16',
    blurb: 'The Descartes highlands, the only Apollo landing in the bright, ancient uplands of the Moon.' },
  { id: 'apollo-17', name: 'Apollo 17', body: 'moon', latDeg: 20.1911, lonDeg: 30.7723, date: '1972-12-11', agency: 'NASA', kind: 'crewed', model: 'lander', wiki: 'Apollo 17',
    blurb: 'The Taurus–Littrow valley. Nobody has stood on the Moon since Gene Cernan and Harrison Schmitt left it.' },

  // ---- the Moon: Soviet sample returns and rovers ----
  { id: 'luna-16', name: 'Luna 16', body: 'moon', latDeg: -0.5137, lonDeg: 56.3638, date: '1970-09-20', agency: 'Soviet Union', kind: 'lander', model: 'lander', wiki: 'Luna 16',
    blurb: 'The first robot to bring a piece of another world home: 101 grams of soil from the Sea of Fertility.' },
  { id: 'luna-17', name: 'Luna 17 and Lunokhod 1', body: 'moon', latDeg: 38.23764, lonDeg: -35.00163, date: '1970-11-17', agency: 'Soviet Union', kind: 'rover', model: 'rover', wiki: 'Lunokhod 1',
    blurb: 'Delivered Lunokhod 1, the first rover on another world. Steered from Earth, it drove ten kilometres in ten months.' },
  { id: 'luna-20', name: 'Luna 20', body: 'moon', latDeg: 3.7863, lonDeg: 56.6242, date: '1972-02-21', agency: 'Soviet Union', kind: 'lander', model: 'lander', wiki: 'Luna 20',
    blurb: 'Drilled into the lunar highlands and sent 55 grams of them back to Earth.' },
  { id: 'luna-21', name: 'Luna 21 and Lunokhod 2', body: 'moon', latDeg: 25.9994, lonDeg: 30.4076, date: '1973-01-15', agency: 'Soviet Union', kind: 'rover', model: 'rover', wiki: 'Lunokhod 2',
    blurb: 'Delivered Lunokhod 2, which drove 39 km in four months: farther than anything on another world for the next forty years.' },
  { id: 'luna-24', name: 'Luna 24', body: 'moon', latDeg: 12.7142, lonDeg: 62.2129, date: '1976-08-18', agency: 'Soviet Union', kind: 'lander', model: 'lander', wiki: 'Luna 24',
    blurb: 'The last Soviet Moon lander: it drilled two metres down and sent 170 grams of soil home. Nothing landed softly on the Moon again for 37 years.' },

  // ---- the Moon: China's landers, and one more ----
  { id: 'change-3', name: 'Chang\'e 3 and Yutu', body: 'moon', latDeg: 44.1214, lonDeg: -19.5117, date: '2013-12-14', agency: 'CNSA', kind: 'rover', model: 'rover', wiki: 'Chang\'e 3',
    blurb: 'China\'s first Moon landing, and the first soft landing by anyone since 1976. It carried the rover Yutu, the Jade Rabbit.' },
  { id: 'change-4', name: 'Chang\'e 4 and Yutu-2', body: 'moon', latDeg: -45.4561, lonDeg: 177.5885, date: '2019-01-03', agency: 'CNSA', kind: 'rover', model: 'rover', wiki: 'Chang\'e 4',
    blurb: 'The first landing on the far side of the Moon, in Von Kármán crater. It can never see the Earth, so it talks through a relay satellite beyond the Moon.' },
  { id: 'change-5', name: 'Chang\'e 5', body: 'moon', latDeg: 43.0576, lonDeg: -51.9161, date: '2020-12-01', agency: 'CNSA', kind: 'lander', model: 'lander', wiki: 'Chang\'e 5',
    blurb: 'Collected 1.7 kg of unusually young volcanic rock from the Ocean of Storms and sent it to Earth: the first lunar samples in 44 years.' },
  { id: 'change-6', name: 'Chang\'e 6', body: 'moon', latDeg: -41.6385, lonDeg: -153.9852, date: '2024-06-01', agency: 'CNSA', kind: 'lander', model: 'lander', wiki: 'Chang\'e 6',
    blurb: 'Brought home the first samples ever taken from the far side of the Moon: 1.9 kg from the South Pole–Aitken basin.' },
  { id: 'athena', name: 'Athena (IM-2)', body: 'moon', latDeg: -84.7906, lonDeg: 29.1957, date: '2025-03-06', agency: 'Intuitive Machines / NASA', kind: 'lander', model: 'lander', wiki: 'IM-2',
    blurb: 'Came down nearer the south pole than any lander before it, but on its side in a shadowed crater, and ran out of power within a day.' },

  // ---- Mars ----
  { id: 'viking-1', name: 'Viking 1', body: 'mars', latDeg: 22.27, lonDeg: -47.95, date: '1976-07-20', agency: 'NASA', kind: 'lander', model: 'lander', wiki: 'Viking 1',
    blurb: 'The first spacecraft to work on the surface of Mars; it sent pictures and weather reports from Chryse Planitia for six years.' },
  { id: 'viking-2', name: 'Viking 2', body: 'mars', latDeg: 47.6673, lonDeg: 134.2809, date: '1976-09-03', agency: 'NASA', kind: 'lander', model: 'lander', wiki: 'Viking 2',
    blurb: 'The second Viking, on the plain of Utopia Planitia, where it photographed frost on the ground in winter.' },
  { id: 'pathfinder', name: 'Mars Pathfinder', body: 'mars', latDeg: 19.13, lonDeg: -33.22, date: '1997-07-04', agency: 'NASA', kind: 'rover', model: 'rover', wiki: 'Mars Pathfinder',
    blurb: 'It bounced to a stop on airbags and let out Sojourner, the first rover to drive on another planet.' },
  { id: 'spirit', name: 'Spirit', body: 'mars', latDeg: -14.5684, lonDeg: 175.4726, date: '2004-01-04', agency: 'NASA', kind: 'rover', model: 'rover', wiki: 'Spirit (rover)',
    blurb: 'Built to last ninety days in Gusev crater, it drove for six years before its wheels stuck in soft sand.' },
  { id: 'opportunity', name: 'Opportunity', body: 'mars', latDeg: -1.946, lonDeg: -5.527, date: '2004-01-25', agency: 'NASA', kind: 'rover', model: 'rover', wiki: 'Opportunity (rover)',
    blurb: 'Spirit’s twin landed on Meridiani Planum and kept going for more than fourteen years and 45 kilometres, until a dust storm ended it.' },
  { id: 'phoenix', name: 'Phoenix', body: 'mars', latDeg: 68.2188, lonDeg: -125.7492, date: '2008-05-25', agency: 'NASA', kind: 'lander', model: 'lander', wiki: 'Phoenix (spacecraft)',
    blurb: 'It landed in the far north, dug into the soil, and found water ice a few centimetres down.' },

  // ---- Venus ----
  { id: 'venera-7', name: 'Venera 7', body: 'venus', latDeg: -5, lonDeg: -9, date: '1970-12-15', agency: 'Soviet Union', kind: 'lander', model: 'lander', wiki: 'Venera 7',
    blurb: 'The first craft to send data from the surface of another planet: 23 minutes of faint signal from the ground of Venus, at 475 °C and ninety times the Earth\'s air pressure.' },
  { id: 'venera-13', name: 'Venera 13', body: 'venus', latDeg: -7.5, lonDeg: -57, date: '1982-03-01', agency: 'Soviet Union', kind: 'lander', model: 'lander', wiki: 'Venera 13',
    blurb: 'Lasted 127 minutes on Venus, long enough to take the first colour pictures of its surface and record the first sounds from another planet.' },

  // ---- Titan ----
  { id: 'huygens', name: 'Huygens', body: 'titan', latDeg: -10.573, lonDeg: 167.665, date: '2005-01-14', agency: 'ESA', kind: 'probe', model: 'lander', wiki: 'Huygens (spacecraft)',
    blurb: 'Carried to Saturn by Cassini, it parachuted through Titan’s haze onto a plain of ice pebbles: the most distant landing ever made.' },
];
