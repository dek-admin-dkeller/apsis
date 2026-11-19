/**
 * Everything Apsis can do, in one list.
 *
 * The home page (src/ui/landing.ts) draws its "What it does" section straight from this
 * file, so this is the ONE place to describe a feature to visitors. When a feature is added,
 * changed or removed, edit its entry here in the same change — the page then cannot fall out
 * of date. Keep each line to what the visitor can do, in plain words, without overselling.
 *
 * `fresh: true` puts a small "new" mark beside a feature; take it off again after a while.
 */

export interface Feature {
  name: string;
  text: string;
  fresh?: boolean;
}

export interface FeatureGroup {
  title: string;
  /** One sentence for the whole group, shown until the visitor points at one of its features. */
  summary: string;
  items: Feature[];
}

/** The pictures in the home page's showcase: real screens, retaken with `npm run shots` (scripts/shots.mjs). */
export interface Shot {
  file: string; // public/shots/<file>.webp — the names are set in scripts/shots.mjs
  tab: string;
  text: string;
  phone?: boolean; // a tall phone screen rather than a wide desktop one
}

export const SHOTS: Shot[] = [
  { file: 'sky', tab: 'The whole sky', text: 'Every tracked object at once, coloured by what it is, on a globe you can turn, zoom and run forwards or backwards in time.' },
  { file: 'object', tab: 'One object', text: 'Select anything to follow it: live readings, a 3D model beside a real photo, its path over the ground, and when its radio was last heard.' },
  { file: 'approach', tab: 'Close approaches', text: 'Two objects passing within kilometres of each other, each in its cell of the grid that makes the search fast.' },
  { file: 'ground', tab: 'Down to the ground', text: 'Zoom in and the surface sharpens from NASA imagery, with everything overhead still moving above it.' },
  { file: 'system', tab: 'The solar system', text: 'Zoom out and the satellites fade away, leaving the Earth among the planets, each where it is today. The spacecraft out there are placed from NASA’s own trajectory data.' },
  { file: 'world', tab: 'Other worlds', text: 'Click a planet and go in: Mars with its orbiters and rovers, lit and turning as it is right now.' },
  { file: 'phone', tab: 'On a phone', text: 'The same tracker in your hand. Hold it up and it shows what is overhead.', phone: true },
];

export const FEATURES: FeatureGroup[] = [
  {
    title: 'See everything in orbit',
    summary: 'The whole catalogue on a live globe, down to the ground beneath it.',
    items: [
      { name: 'A live globe', text: 'Every tracked satellite, rocket stage and fragment, placed from public tracking data and moving in real time.' },
      { name: 'Sharp ground', text: 'Zoom in and the ground under you is redrawn from detailed NASA imagery, by day and by night. At the Moon, Mars and Mercury too.' },
      { name: 'Names and a hover card', text: 'Names appear as you zoom in. Point at any dot for a picture, what it is and who runs it.' },
      { name: 'Colour and filter', text: 'Colour the dots by type, orbit, height, owner, launch year or tilt, and hide what you do not need.' },
      { name: 'Search', text: 'One field finds an object by name, nickname or number, a place, a time or an action, and forgives a misspelling. Press / or Ctrl K.', fresh: true },
      { name: 'Search by type', text: 'Type “telescope”, “weather” or “chinese radar” and choose the type: only those objects stay on the globe until you clear it.', fresh: true },
      { name: 'The sky behind', text: 'Real stars, constellations, the planets, the Moon, and tonight’s aurora over the poles.' },
      { name: 'Views and time', text: 'Whole Earth, low orbit, the geostationary ring, Earth with the Moon. Pause time, run it backwards, or up to a thousand times faster.' },
      { name: 'Growth by year', text: 'Drag a slider from 1957 to today and see what is still up there from each year.', fresh: true },
      { name: 'Data age', text: 'Colour every object by how recently its orbit was measured, so stale ones stand out.', fresh: true },
      { name: 'Always current', text: 'The tracking data is refreshed every three hours, and a tab you leave open picks up the new data by itself.', fresh: true },
    ],
  },
  {
    title: 'Follow one object',
    summary: 'Pick anything and stay with it: where it is, what it is, and what it can see.',
    items: [
      { name: 'Inspector', text: 'Live height, speed and position, the path over the ground, the shape of the orbit, its record (owner, launch date, size) and a link to its Wikipedia article.' },
      { name: '3D models and photos', text: 'Forty-nine kinds of spacecraft modelled in 3D, from a CubeSat to the Webb telescope, beside a real photo where one exists.' },
      { name: 'Ride along', text: 'Sit on a satellite and look out from it.' },
      { name: 'Passes over you', text: 'When it will next cross your sky, and the path it will take across it.' },
      { name: 'Watchlist and contact timeline', text: 'Star the objects you care about and see when ground stations can reach each of them.' },
      { name: 'People in space', text: 'Who is aboard the International Space Station and Tiangong right now.' },
      { name: 'Last heard', text: 'When a volunteer ground station last picked up its radio, and from where.', fresh: true },
      { name: 'Radio and Doppler', text: 'The frequencies it transmits on, and how far the signal is shifted by its speed as it passes you.', fresh: true },
      { name: 'Freshness and orbit changes', text: 'How old its tracking data is, and whether its orbit has been raised or lowered since the last update.', fresh: true },
    ],
  },
  {
    title: 'Watch for close approaches',
    summary: 'Which objects are near each other now, and which will be in the coming hours.',
    items: [
      { name: 'Monitor', text: 'Every object is checked against every other about once a second. Pairs are sorted into those crossing paths and those that simply fly together, and a station’s docked parts count as one spacecraft.' },
      { name: 'Close-approach view', text: 'Both objects in 3D, their flight paths, the distance between them as it changes, and a slow-motion replay.' },
      { name: 'Coming hours', text: 'A scan up to 24 hours ahead for predicted close passes.' },
      { name: 'Screening cells', text: 'The grid that makes the search fast, drawn in space around the objects it is sorting.' },
      { name: 'Report and data', text: 'Save any close approach as a one-page report to print, or as a table of numbers.', fresh: true },
    ],
  },
  {
    title: 'Go beyond Earth orbit',
    summary: 'Zoom out of the Earth into the solar system, and into any other world in it.',
    items: [
      { name: 'The solar system', text: 'Zoom out and the satellites fade away, leaving the Earth among the planets, each on the right side of the Sun for today’s date.', fresh: true },
      { name: 'Other worlds', text: 'Click a planet or a moon, then go in: the Moon, Mars, Jupiter and its four big moons, Saturn and its rings, out to Pluto, each lit and turning as it is right now.', fresh: true },
      { name: 'Thirty-five moons', text: 'Every moon that is round or well known, from Phobos to Pluto’s Hydra, each where it really is today. Twenty-one are mapped from NASA’s pictures and open to visit; what no camera has seen is left blank rather than made up.', fresh: true },
      { name: 'Spacecraft out there', text: 'The Webb telescope, the orbiters and rovers at Mars, Juno, the Voyagers: fifty craft placed from NASA’s own trajectory data, with how far away each is and how long its signal takes.', fresh: true },
      { name: 'In contact now', text: 'A green mark on any craft that one of NASA’s deep-space dishes is talking to this minute.', fresh: true },
      { name: 'Asteroids passing', text: 'Follow a near-Earth asteroid along its real path as it goes past.', fresh: true },
      { name: 'Landing sites', text: 'Where the Apollo crews, the Vikings and the other historic landers came down, each with its date and whether the Sun is up there now.', fresh: true },
      { name: 'A full card for every craft', text: 'A photo, what it is for, its orbit, how far its signal has to travel, and switches for its orbit, its path over the ground and the ground that can see it.', fresh: true },
      { name: 'Your choice of what is drawn', text: 'Orbits, names, spacecraft, landing sites and constellation names can each be switched off, on the solar system as at any world.', fresh: true },
    ],
  },
  {
    title: 'Explore',
    summary: 'Whole constellations, what was launched lately, your own satellite, and ways to show others.',
    items: [
      { name: 'Constellations', text: 'All of GPS, Starlink or Iridium at once, with a live map of how much of the ground each can see.' },
      { name: 'Launches, trains and re-entries', text: 'The newest objects in orbit, freshly launched batches still flying in a line, and the lowest orbits that will come down next.' },
      { name: 'Design a satellite', text: 'Choose an orbit, put your own object into the catalogue, and see what it would pass close to.' },
      { name: 'Autopilot and recording', text: 'A hands-free tour of the highlights. Save a picture or record a video of what you see.' },
      { name: 'Share', text: 'A link or QR code that reopens exactly what you are looking at.' },
      { name: 'Visible tonight', text: 'The bright passes you could see with your own eyes in the next 24 hours from where you are, and where to look. On a phone it opens inside the sky view.', fresh: true },
      { name: 'Upcoming launches', text: 'What is due to launch next, with a countdown and the pads marked on the globe.', fresh: true },
      { name: 'Orbit changes', text: 'Which satellites have raised or lowered their orbits since the data was last refreshed, and what is new or gone.', fresh: true },
      { name: 'Space weather and re-entries', text: 'How active the Sun is today, and roughly how long the lowest objects have left.', fresh: true },
      { name: 'Spacecraft catalogue', text: 'Every 3D model on one page. Pick one to turn it round, read what it is, and go and find one in orbit.', fresh: true },
      { name: 'Asteroid fly-bys', text: 'The rocks passing the Earth in the coming weeks: when, how far away in kilometres and Moon-distances, how big and how fast. Choose one to move the clock to its closest approach.', fresh: true },
      { name: 'Fireballs', text: 'The brightest meteors recorded lately, with the energy of each, marked on the globe where they exploded.', fresh: true },
      { name: 'Meteor showers', text: 'Which annual showers are active now and which come next, with the hour of each peak worked out for this year.', fresh: true },
      { name: 'Deep Space Network', text: 'Which of NASA’s giant dishes is talking to which spacecraft this minute, how far away it is and how long the signal takes.', fresh: true },
    ],
  },
  {
    title: 'On a phone',
    summary: 'The same tracker, made for a small screen and for pointing at the sky.',
    items: [
      { name: 'Hold it up to the sky', text: 'The sky button fills the screen with what is overhead in the direction the phone is pointing.' },
      { name: 'Built around the globe', text: 'Few controls on screen, and panels you can drag out of the way.' },
    ],
  },
];
