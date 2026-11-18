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
  items: Feature[];
}

export const FEATURES: FeatureGroup[] = [
  {
    title: 'See everything in orbit',
    items: [
      { name: 'A live globe', text: 'Every tracked satellite, rocket stage and fragment, placed from public tracking data and moving in real time.' },
      { name: 'Sharp ground', text: 'Zoom in and the ground under you is redrawn from detailed NASA imagery, by day and by night.' },
      { name: 'Names and a hover card', text: 'Names appear as you zoom in. Point at any dot for a picture, what it is and who runs it.' },
      { name: 'Colour and filter', text: 'Colour the dots by type, orbit, height, owner, launch year or tilt, and hide what you do not need.' },
      { name: 'The sky behind', text: 'Real stars, constellations, the planets, the Moon, and tonight’s aurora over the poles.' },
      { name: 'Views and time', text: 'Whole Earth, low orbit, the geostationary ring, Earth with the Moon. Pause time, run it backwards, or up to a thousand times faster.' },
    ],
  },
  {
    title: 'Follow one object',
    items: [
      { name: 'Inspector', text: 'Live height, speed and position, the path over the ground, the shape of the orbit, and its record: owner, launch date, size.' },
      { name: '3D models and photos', text: 'Twenty-one kinds of spacecraft modelled in 3D, beside a real photo where one exists.' },
      { name: 'Ride along', text: 'Sit on a satellite and look out from it.' },
      { name: 'Passes over you', text: 'When it will next cross your sky, and the path it will take across it.' },
      { name: 'Watchlist and contact timeline', text: 'Star the objects you care about and see when ground stations can reach each of them.' },
      { name: 'People in space', text: 'Who is aboard the International Space Station and Tiangong right now.' },
    ],
  },
  {
    title: 'Watch for close approaches',
    items: [
      { name: 'Monitor', text: 'Every object is checked against every other about once a second. Pairs are sorted into those crossing paths and those that simply fly together.' },
      { name: 'Close-approach view', text: 'Both objects in 3D, their flight paths, the distance between them as it changes, and a slow-motion replay.' },
      { name: 'Coming hours', text: 'A scan up to 24 hours ahead for predicted close passes.' },
      { name: 'Screening cells', text: 'The grid that makes the search fast, drawn in space around the objects it is sorting.' },
    ],
  },
  {
    title: 'Explore',
    items: [
      { name: 'Constellations', text: 'All of GPS, Starlink or Iridium at once, with a live map of how much of the ground each can see.' },
      { name: 'Launches, trains and re-entries', text: 'The newest objects in orbit, freshly launched batches still flying in a line, and the lowest orbits that will come down next.' },
      { name: 'Design a satellite', text: 'Choose an orbit, put your own object into the catalogue, and see what it would pass close to.' },
      { name: 'Autopilot and recording', text: 'A hands-free tour of the highlights. Save a picture or record a video of what you see.' },
      { name: 'Share', text: 'A link or QR code that reopens exactly what you are looking at.' },
    ],
  },
  {
    title: 'On a phone',
    items: [
      { name: 'Hold it up to the sky', text: 'The sky button fills the screen with what is overhead in the direction the phone is pointing.' },
      { name: 'Built around the globe', text: 'Few controls on screen, and panels you can drag out of the way.' },
    ],
  },
];
