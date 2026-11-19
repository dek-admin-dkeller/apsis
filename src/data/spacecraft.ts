/**
 * What the spacecraft catalogue (ui/gallery.ts) says about each kind of 3D model: one
 * sentence about the real thing, and the order and groups the models are laid out in.
 *
 * The sentences avoid anything that goes out of date ("still in orbit", "due to arrive"):
 * the app does not know what has happened to a mission since the line was written.
 */

import { KIND_LABEL, type ModelKind } from './describe.ts';

export const KIND_FACT: Record<ModelKind, string> = {
  starlink: 'SpaceX’s broadband satellites: flat as a table, launched in stacks of dozens, and by far the most numerous things in orbit.',
  oneweb: 'A broadband satellite the size of a fridge; several hundred of them circle over the poles, 1,200 km up.',
  comsat: 'The workhorse of the phone and data constellations in low and medium orbit, such as Iridium and Globalstar.',
  geocomsat: 'A television and data relay as big as a bus, parked 35,786 km up, where it keeps pace with the turning Earth.',
  gnss: 'A clock in the sky: GPS, Galileo, GLONASS and BeiDou satellites broadcast the time, and a receiver works out where it is from the delays.',
  smallsat: 'A satellite of a hundred kilograms or so, about the size of a washing machine: cheap enough to launch by the dozen.',
  cubesat: 'Built from 10 cm cubes and small enough to hold in two hands; universities and start-ups fly them by the hundred.',
  observer: 'A telescope pointed down: Landsat, Sentinel-2 and their kind photograph every field and coastline every few days.',
  radarsat: 'Its long antenna maps the ground with radar, at night and straight through cloud.',
  weather: 'The source of the pictures in every forecast, from an orbit over the poles or from geostationary height.',
  spinner: 'A drum that spins a hundred times a minute to hold itself steady, scanning the Earth one line with each turn.',
  telescope: 'Above the air that blurs and blocks the view; the Hubble Space Telescope, launched in 1990, is the famous one.',
  iss: 'People have lived aboard without a break since November 2000; it is as long as a football pitch.',
  tiangong: 'China’s space station, assembled in orbit in 2021 and 2022 and home to three astronauts at a time.',
  station: 'A single pressurised module with wings of its own: the way every space station begins.',
  dragon: 'SpaceX’s capsule: it carries crews and cargo to the Space Station, splashes down in the sea and flies again.',
  soyuz: 'The Russian design that has carried people to orbit since 1967; Progress is its cargo version, Shenzhou its Chinese cousin.',
  cygnus: 'A cargo ship named after the swan; it delivers supplies to the Space Station and burns up with the rubbish on the way down.',
  capsule: 'A supply ship for a space station: a pressurised can of cargo with engines and two wings.',
  rocketbody: 'The upper stage that delivered a satellite and was left behind; about two thousand are still circling, dead and tumbling.',
  debris: 'A fragment of something that exploded or was hit; even a small one arrives at ten times the speed of a rifle bullet.',
  lasersphere: 'A ball of metal and glass prisms with no moving parts; laser flashes bounced off it measure the shape of the Earth to millimetres.',
  relay: 'A switchboard in geostationary orbit that keeps the Space Station and other low-flying craft in touch with the ground.',
  phasedarray: 'One flat antenna the size of a squash court, strong enough for an ordinary phone on the ground to hear.',
  webb: 'The largest telescope ever sent into space: a 6.5 m gold mirror kept at −233 °C behind a sunshield the size of a tennis court.',
  euclid: 'Europe’s survey telescope, mapping billions of galaxies to trace dark matter and dark energy.',
  tess: 'Four cameras that watch for the tiny dip in a star’s light when a planet crosses in front of it.',
  chandra: 'NASA’s X-ray observatory, launched in 1999, with the smoothest mirrors ever made.',
  xmm: 'Europe’s X-ray observatory, launched in 1999: three telescopes, each of 58 gold mirrors nested like Russian dolls.',
  soho: 'It was launched in 1995 to stare at the Sun without a night, and has found thousands of comets by accident.',
  l1monitor: 'A sentry between the Earth and the Sun: it feels a solar storm up to an hour before the storm reaches us.',
  stereo: 'One of two twins launched in 2006 to see the Sun from two sides at once.',
  parker: 'The fastest thing people have built: it flies through the Sun’s outer atmosphere at up to 190 km a second.',
  solarorbiter: 'It took the closest pictures of the Sun ever made, and the first of its poles.',
  bepi: 'A European and a Japanese orbiter sent to Mercury together, stacked on one tug.',
  voyager: 'Launched in 1977, both Voyagers have left the Sun’s bubble and are the most distant things people have made.',
  pioneer: 'The first craft to cross the asteroid belt and pass Jupiter; silent now, each carries a plaque for whoever finds it.',
  newhorizons: 'It flew past Pluto in 2015 and showed a world with mountains of ice and a heart-shaped plain.',
  probe: 'A craft on its way to another world: a dish to talk to Earth, a camera, and an engine to stop with when it arrives.',
  juno: 'It reached Jupiter in 2016 on wings nine metres long, needed because sunlight there is twenty-five times weaker.',
  clipper: 'Sent to Jupiter’s moon Europa to find out whether the ocean under its ice could support life.',
  lucy: 'The first mission to the Trojan asteroids, which share Jupiter’s orbit round the Sun.',
  psyche: 'Bound for a metal-rich asteroid of the same name, pushed gently for years by electric thrusters.',
  samplereturn: 'It touches an asteroid for a few seconds, takes a handful of gravel and brings it home.',
  lunarorbiter: 'It maps the Moon from low orbit, sharply enough to show the Apollo landers and the astronauts’ footpaths.',
  marsorbiter: 'Its camera can make out something the size of a kitchen table on Mars, and it passes the rovers’ data on to Earth.',
  rover: 'A laboratory the size of a car on six wheels: it drills rock, studies it on board and finds its own way round obstacles.',
  lander: 'It comes down on its engine and its legs, and works where it lands.',
  asteroid: 'A leftover from the making of the planets; small ones pass closer than the Moon every few days.',
};

/** The catalogue's rows: [heading, the kinds under it, in order]. */
const GROUPS: [string, ModelKind[]][] = [
  ['Earth orbit', ['starlink', 'oneweb', 'comsat', 'phasedarray', 'geocomsat', 'relay', 'gnss', 'weather', 'spinner', 'observer', 'radarsat', 'smallsat', 'cubesat', 'lasersphere', 'rocketbody', 'debris']],
  ['Crews and cargo', ['iss', 'tiangong', 'station', 'dragon', 'soyuz', 'cygnus', 'capsule']],
  ['Telescopes', ['telescope', 'webb', 'euclid', 'tess', 'chandra', 'xmm']],
  ['The Sun', ['soho', 'stereo', 'l1monitor', 'parker', 'solarorbiter']],
  ['Moon and Mars', ['lunarorbiter', 'marsorbiter', 'rover', 'lander']],
  ['Deep space', ['voyager', 'pioneer', 'newhorizons', 'juno', 'clipper', 'lucy', 'psyche', 'bepi', 'samplereturn', 'probe', 'asteroid']],
];

/**
 * The groups, with a guarantee that every kind appears exactly once: a kind added to
 * describe.ts later and forgotten here still shows up, at the end.
 */
export function kindGroups(): [string, ModelKind[]][] {
  const listed = new Set(GROUPS.flatMap(([, kinds]) => kinds));
  const missing = (Object.keys(KIND_LABEL) as ModelKind[]).filter((kind) => !listed.has(kind));
  return GROUPS.map(([heading, kinds], i) => [heading, i === GROUPS.length - 1 ? [...kinds, ...missing] : kinds]);
}
