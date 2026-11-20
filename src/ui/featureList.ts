/**
 * Everything Apsis can do, in one list.
 *
 * The home page (src/ui/landing.ts) draws its "What it does" section straight from this
 * file, so this is the ONE place to describe a feature to visitors. When a feature is added,
 * changed or removed, edit its entry here in the same change — the page then cannot fall out
 * of date. Keep each line to what the visitor can do, in plain words, without overselling.
 *
 * `fresh: true` puts a small "new" mark beside a feature; take it off again after a while.
 *
 * WHATS_NEW (below) is the change log visitors see: on the home page ("What's new") and in
 * About. Add an entry at the TOP for every visible change, in plain words; it is how returning
 * visitors discover what they have not tried yet.
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
      { name: 'Country names', text: 'Names of the countries on the globe, as on a map: the largest from far away, more as you come closer, only on the side facing you.', fresh: true },
      { name: 'Sharp ground', text: 'Zoom in and the ground under you is redrawn from detailed NASA imagery, by day and by night. At the Moon, Mars and Mercury too.' },
      { name: 'Names and a hover card', text: 'Names appear as you zoom in. Point at any dot for a picture, what it is and who runs it.' },
      { name: 'Colour and filter', text: 'Colour the dots by type, orbit, height, owner, launch year or tilt, and hide what you do not need.' },
      { name: 'Search', text: 'One field finds an object by name, nickname or number, a place, a time or an action, and forgives a misspelling. Press / or Ctrl K.', fresh: true },
      { name: 'Search by type', text: 'Type “spacex”, “telescope” or “chinese radar” and choose the type: only those objects stay on the globe, and you step through them one at a time with their 3D models (‹ ›, the arrow keys, or a swipe on a phone). Done leaves you on the one you stopped at.', fresh: true },
      { name: 'The sky behind', text: 'Real stars, constellations, the planets, the Moon, and tonight’s aurora over the poles.' },
      { name: 'Views and time', text: 'Whole Earth, low orbit, the geostationary ring, Earth with the Moon. Pause time, run it backwards, or up to a thousand times faster.' },
      { name: 'Growth by year', text: 'Drag across a chart of launch years, or press play, and the globe winds back to 1957: only what was launched by then stays.', fresh: true },
      { name: 'Data age', text: 'Colour every object by how recently its orbit was measured, so stale ones stand out.', fresh: true },
      { name: 'Live and coming up', text: 'The bell in the top bar lists what is happening now — spacecraft in contact with NASA’s dishes, a rocket lifting off, an active meteor shower — and what is next. Choose one to go and see it.', fresh: true },
      { name: 'A filter you cannot miss', text: 'While anything is hidden, a banner at the top says how many objects are shown, what is hiding the rest, and puts everything back in one click.', fresh: true },
      { name: 'Always current', text: 'The tracking data is refreshed about every two hours, as often as CelesTrak publishes it, and a tab you leave open picks up the new data by itself.', fresh: true },
    ],
  },
  {
    title: 'Follow one object',
    summary: 'Pick anything and stay with it: where it is, what it is, and what it can see.',
    items: [
      { name: 'Inspector', text: 'Live height, speed and position, the path over the ground, the shape of the orbit, its record (owner, launch date, size) and a link to its Wikipedia article.' },
      { name: '3D models and photos', text: '127 kinds of spacecraft, landers and rockets modelled in 3D: every spacecraft beyond Earth orbit and nearly every landing site has its own, from Gaia and JUICE to Viking, Lunokhod and Apollo’s lunar module, and the big satellite fleets too. Beside a real photo where one exists.', fresh: true },
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
      { name: 'The solar system', text: 'Zoom out, or press Escape, and the satellites fade away, leaving the Earth among the planets, each on the right side of the Sun for today’s date.', fresh: true },
      { name: 'Guided overview', text: 'Press play on the solar system for a hands-free tour of what Apsis does: the Earth’s tracked objects, a real piece of debris, the geostationary ring, then out to the planets, an orbiter at Mars and the Webb telescope. → and ← move between stops; any other key stops it. The menus step aside while it plays; the cards it stops at stay.', fresh: true },
      { name: 'Other worlds', text: 'Click a planet or a moon, then go in: the Moon, Mars, Jupiter and its four big moons, Saturn and its rings, out to Pluto, each lit and turning as it is right now.', fresh: true },
      { name: 'Thirty-five moons', text: 'Every moon that is round or well known, from Phobos to Pluto’s Hydra, each where it really is today. Twenty-one are mapped from NASA’s pictures and open to visit.', fresh: true },
      { name: 'Unseen sides', text: 'Parts of Pluto, Charon, Triton and Uranus’s moons have never been photographed. They are filled in with an educated guess made from each world’s own photographed terrain, and each world’s card says what is real; one switch shows them as a plain tone instead.', fresh: true },
      { name: 'Spacecraft out there', text: 'The Webb telescope, the orbiters and rovers at Mars, Juno, the Voyagers: fifty craft placed from NASA’s own trajectory data, with how far away each is and how long its signal takes.', fresh: true },
      { name: 'In contact now', text: 'A green mark on any craft that one of NASA’s deep-space dishes is talking to this minute.', fresh: true },
      { name: 'Asteroids passing', text: 'Follow a near-Earth asteroid along its real path as it goes past.', fresh: true },
      { name: 'Rover paths', text: 'The routes Curiosity and Perseverance have driven, drawn on the Martian ground from NASA’s daily record, with each rover standing where it is now and how far it has gone.', fresh: true },
      { name: 'Search where you are', text: 'At another world, what is there comes first: at Mars, “curiosity” or “orbiter” finds Mars’s own before anything else.', fresh: true },
      { name: 'Landing sites', text: 'Where the Apollo crews, the Vikings and the other historic landers came down, each with its date and whether the Sun is up there now.', fresh: true },
      { name: 'A full card for every craft', text: 'A photo, what it is for, its orbit, how far its signal has to travel, and switches for its orbit, its path over the ground and the ground that can see it.', fresh: true },
      { name: 'Close approaches at every world', text: 'The same screening as round the Earth, on the craft at Mars or the Moon and on the craft out between the planets: who is nearest whom now, the closest passes of the coming day, and the grid that finds them (G), with the selected craft’s cell and the 27 cells searched round it.', fresh: true },
      { name: 'Time for the solar system', text: 'Away from the Earth, run time at a day, a week, a month or a year a second and watch the planets go round.', fresh: true },
      { name: 'Views of every world', text: 'The whole of it, low over the day side, the night side, or far enough back to take in its moons.', fresh: true },
      { name: 'Your choice of what is drawn', text: 'Planet orbits, spacecraft orbits, names, moons, spacecraft, landing sites and constellation names can each be switched off, on the solar system as at any world.', fresh: true },
    ],
  },
  {
    title: 'Explore',
    summary: 'Whole constellations, what was launched lately, your own satellite, and ways to show others.',
    items: [
      { name: 'Constellations', text: 'All of GPS, Starlink or Iridium at once, with a live map of how much of the ground each can see.' },
      { name: 'Launches, trains and re-entries', text: 'The newest objects in orbit; freshly launched batches still flying in a line, shown whole and followed as they fly (Done puts them away); and the lowest orbits, which will come down next.' },
      { name: 'Designer', text: 'An orbit lab: pick any of the 3D models and a mass, shape the orbit with the preview drawn live, and read the physics (how fast the Earth’s bulge turns it, whether it is sun-synchronous, time in shadow, how long drag leaves it up, the Δv to get there). Launch it among the real objects and see what it passes; select any other object and its card offers to aim yours at it.', fresh: true },
      { name: 'Collision course', text: 'In the designer, choose any object as a target, when and from which direction: Apsis solves the orbit that meets it, shows the approach in its hash-grid cells, slows the last moments down until the two 3D models meet, and at the moment of impact a cloud of fragments (NASA’s break-up model) spreads along the orbit while the same screening counts the close approaches it causes. A simulation in your page only.', fresh: true },
      { name: 'Autopilot and recording', text: 'A hands-free tour of the highlights. Save a picture or record a video of what you see.' },
      { name: 'Share', text: 'A link or QR code that reopens exactly what you are looking at.' },
      { name: 'Visible tonight', text: 'The bright passes you could see with your own eyes in the next 24 hours from where you are, and where to look. On a phone it opens inside the sky view.', fresh: true },
      { name: 'Upcoming launches', text: 'What is due to launch next, with a countdown and the pads marked on the globe.', fresh: true },
      { name: 'Watch a launch climb', text: 'A rocket rising from its pad to orbit on the globe, live as it launches: an estimated path from the pad, the time and the target orbit, with its height, speed and stages, the booster flying back to land, the webcast when one is listed, and a link to the launch’s own page. Preview any upcoming launch, replay a recent one, share the moment, and see the real objects once tracking has caught up. A launch that failed is shown as far as it got, with the reported cause; one in flight whose time is listed only to the hour is drawn from that time and says so. Point at a rocket for a preview; click it for its card: the photo, the mission’s goal, time to orbit and the climb’s milestones, the mission and its record, and links. Layers → Live launches turns them off.', fresh: true },
      { name: 'New launches', text: 'What went up in the last three days stands out: brighter dots and a “New” name, until the novelty wears off.', fresh: true },
      { name: 'Orbit changes', text: 'Which satellites have raised or lowered their orbits since the data was last refreshed, and what is new or gone.', fresh: true },
      { name: 'Space weather and re-entries', text: 'How active the Sun is today, and roughly how long the lowest objects have left.', fresh: true },
      { name: 'Spacecraft catalogue', text: 'Every 3D model on one page. Pick one to turn it round, read what it is, and go and find one in orbit.', fresh: true },
      { name: 'Asteroid fly-bys', text: 'The rocks passing the Earth in the coming weeks: when, how far away in kilometres and Moon-distances, how big and how fast. The closest two dozen (marked 3D) have their real path from NASA JPL: choose one to fly out and watch the rock go by.', fresh: true },
      { name: 'Fireballs', text: 'The brightest meteors recorded lately (NASA JPL): choose one and watch it come in on its measured path and burst, with what it was (a rock of roughly so many metres), how fast and the energy it let go.', fresh: true },
      { name: 'Eclipses and transits', text: 'The next solar and lunar eclipses and the shadows of Jupiter’s moons crossing its face, worked out in the app and listed in the bell. During a solar eclipse the Moon’s shadow darkens the Earth and the track of its centre is drawn on the ground. Choose one to go to it.', fresh: true },
      { name: 'The Station over you', text: 'With your location shared, the bell says when the Space Station is about to pass overhead and whether it will be bright to the eye.', fresh: true },
      { name: 'Notifications', text: 'Turn them on in the bell and the browser tells you when something unusual starts: a launch, an eclipse, a close asteroid, the Station overhead. Never for routine things.', fresh: true },
      { name: 'Meteor showers', text: 'Which annual showers are active now and which come next, with the hour of each peak worked out for this year. Choose one to see its stream of dust coming at the Earth from the radiant, at the peak.', fresh: true },
      { name: 'Deep Space Network', text: 'Which of NASA’s giant dishes is talking to which spacecraft this minute, how far away it is and how long the signal takes.', fresh: true },
    ],
  },
  {
    title: 'On a phone',
    summary: 'The same tracker, made for a small screen and for pointing at the sky.',
    items: [
      { name: 'Hold it up to the sky', text: 'The sky button fills the screen with what is overhead in the direction the phone is pointing. Tap anything for a small card saying what it is.', fresh: true },
      { name: 'One pill between worlds', text: 'A small “‹ Earth ›” in the middle of the tab bar: tap it for the whole solar system, swipe it (or tap ‹ ›) for the next world, swipe it up for every world at once. A two-finger tap on the picture goes up a level.', fresh: true },
      { name: 'Built around the globe', text: 'Few controls on screen, and panels you can drag out of the way.' },
    ],
  },
];

/**
 * Where to find each feature, in a few words: shown on the home page beside what it does
 * (keyed by the feature's name). A key in brackets is its shortcut on a computer.
 */
export const HOW: Record<string, string> = {
  'A live globe': 'Open the tracker',
  'Country names': 'Layers',
  'Sharp ground': 'Zoom in · Layers',
  'Names and a hover card': 'Point at a dot',
  'Colour and filter': 'Objects → Browse',
  'Search': 'Top bar · /',
  'Search by type': 'Search → Types',
  'The sky behind': 'Layers',
  'Views and time': '1–5 · time bar',
  'Growth by year': 'Objects → Tools',
  'Data age': 'Objects → Browse → Colour',
  'Live and coming up': 'The bell, top bar',
  'A filter you cannot miss': 'Appears by itself',
  'Always current': 'Automatic',
  'Inspector': 'Click any object',
  '3D models and photos': 'Object card · catalogue',
  'Ride along': 'Object card',
  'Passes over you': 'Object card → Passes',
  'Watchlist and contact timeline': 'Objects → Browse · Tools',
  'People in space': 'Objects → Activity',
  'Last heard': 'Object card → Live',
  'Radio and Doppler': 'Object card → Passes',
  'Freshness and orbit changes': 'Object card',
  'Monitor': 'Rail → Monitor · C',
  'Close-approach view': 'Monitor → a pair',
  'Coming hours': 'Monitor → Coming hours',
  'Screening cells': 'G',
  'Report and data': 'Close-approach view',
  'The solar system': 'Zoom out · Esc',
  'Guided overview': 'Play, on the solar system',
  'Other worlds': 'Click a planet, then Enter',
  'Thirty-five moons': 'Beside their planets',
  'Unseen sides': 'Layers · Settings',
  'Spacecraft out there': 'Search · Objects',
  'In contact now': 'The bell · craft cards',
  'Asteroids passing': 'Objects → Activity',
  'Rover paths': 'At Mars · Layers',
  'Search where you are': 'Search, at any world',
  'Landing sites': 'At a world → Objects',
  'A full card for every craft': 'Click a craft',
  'Close approaches at every world': 'Monitor · G, anywhere',
  'Time for the solar system': 'Time bar, away from Earth',
  'Views of every world': 'View, in the rail · 1–4',
  'Your choice of what is drawn': 'Layers',
  'Constellations': 'Objects → Activity',
  'Launches, trains and re-entries': 'Objects → Activity',
  'Designer': 'Objects → Tools → Designer',
  'Collision course': 'Designer → Collision course',
  'Autopilot and recording': 'A · capture menu',
  'Share': 'Top bar · share',
  'Visible tonight': 'Objects → Activity',
  'Upcoming launches': 'Objects → Activity',
  'Watch a launch climb': 'Upcoming launches',
  'New launches': 'Layers',
  'Orbit changes': 'Objects → Activity',
  'Space weather and re-entries': 'Lowest orbits',
  'Spacecraft catalogue': 'Objects → Tools',
  'Asteroid fly-bys': 'Objects → Activity',
  'Fireballs': 'Objects → Activity',
  'Eclipses and transits': 'The bell',
  'The Station over you': 'The bell, with your location',
  'Notifications': 'The bell → Notify me',
  'Meteor showers': 'Objects → Activity',
  'Deep Space Network': 'Objects → Activity',
  'Hold it up to the sky': 'Sky button, on a phone',
  'One pill between worlds': 'Tab bar, on a phone',
  'Built around the globe': 'On a phone',
};

/** One release as visitors see it: newest first in WHATS_NEW. */
export interface Update {
  date: string; // YYYY-MM-DD
  title: string;
  items: string[];
}

export const WHATS_NEW: Update[] = [
  {
    date: '2026-11-20',
    title: 'Fireballs, fly-bys and showers you can watch; a simpler Browse tab',
    items: [
      'Fireballs: choose one to watch it come in on its measured path and burst, with a card that says what it was.',
      'Asteroid fly-bys: the closest two dozen carry their real path (marked 3D) and can be watched going by.',
      'Meteor showers: choose one to see its stream coming in from the radiant at the peak.',
      'The Browse tab is four plain groups (Find, Show, Orbits, Look), with a line on what each colour means.',
      'With your own spacecraft in orbit, any other object’s card offers to aim it there (a collision course).',
      'Escape closes the card on the right first, then the panel on the left, and only then steps out, at every world.',
      'The planets’ hover cards use the same lit globes as the phone’s worlds.',
      'The guided overview on the solar system hides the menus as the autopilot does; the cards it stops at stay on screen.',
      'Choosing a fireball now shows it: the camera looks at the streak and the burst from the side.',
      'A collision you watch ends in slow motion: the two models meet on screen, then the break-up.',
      'A launch in flight whose time is listed only to the hour now shows its estimated climb, saying the time is not confirmed.',
      'Search a world from anywhere, the Earth included, and go straight there.',
      'Every upcoming launch links to its own page (Space Launch Now, from the same source as the list).',
      'Left alone, the bars around the turning globe dim, then fade away entirely; any touch brings them back.',
      'A launch is an object with its own card: photo, the mission’s goal, time to orbit and a track of the climb, the mission, the record and links. Click the rocket, or choose it in the bell to follow it.',
      'A rocket’s preview shows only when you point at it; Layers → Live launches turns them off.',
      'Removing a collision’s debris always gives the camera and the clock back.',
      'Country names on the globe (Layers → Country names).',
      'A watched collision is seen from beside the target, its 3D model in view, with a readout of the closing gap on a scale from 1,000 km to contact.',
      'New launches say how new they are, on the globe and on the object’s card.',
      'The bell counts a launch as live only while it climbs; after that it is listed as in orbit.',
      'Tracking data now refreshes about every two hours, and a missed refresh no longer leaves it hours old.',
      'Phones: the card of a world or spacecraft drags and scrolls like a satellite’s; the code in How it works wraps.',
    ],
  },
  {
    date: '2026-11-20',
    title: 'The designer: an orbit lab, and a collision course',
    items: [
      'The designer is an orbit lab: any of the 127 models, a mass, every orbital element with the orbit drawn as you drag, and the physics that follows (plane drift, sun-synchronous, shadow, lifetime, Δv).',
      'Put your spacecraft on a collision course with any object: the approach in its hash-grid cells, then a fragment cloud by NASA’s break-up model, screened like everything else.',
      'While you have a spacecraft (or a debris cloud) of your own, a chip in the top bar says so: click it to go there, × to remove it.',
      'Satellite trains have a clear way out (a banner with Done; Escape and Home too), and the status bar shows the distance from the Sun away from the Earth.',
    ],
  },
  {
    date: '2026-11-20',
    title: 'How it works in eight scenes, and a guided overview',
    items: [
      'The home page explains how Apsis finds close approaches in eight scenes, from the question to the real code that answers it, with ← and → or full screen for presenting.',
      'Press play on the solar system for a guided overview: the Earth’s tracked objects, a piece of real debris, the geostationary ring, then out to the planets, an orbiter at Mars and the Webb telescope.',
      'A visit now opens with the launch screen: the rocket climbs as everything loads, then lifts off to the home page.',
      'A simpler list of everything Apsis can do, area by area, with where to find each feature.',
      'Satellite trains are shown whole and followed as they fly; Growth by year is one compact chart you drag across.',
    ],
  },
  {
    date: '2026-11-20',
    title: 'Flip through what you search, and a simpler phone',
    items: [
      'Search a type (“spacex”, “weather”, “telescope”) and step through every object of it one at a time, each with its 3D model: ‹ › or the arrow keys, a swipe on a phone. Done shows everything again and leaves you on the one you stopped at.',
      'On a phone, a small “‹ Earth ›” in the middle of the tab bar replaces the strip of planets and the path at the top: tap it for the whole solar system, swipe it for the next world, swipe it up for all of them. A two-finger tap goes up a level.',
      'The never-photographed parts of Pluto, Charon, Triton and Uranus’s moons are filled in with an educated guess made from each world’s own terrain (a switch in Layers turns it off), and each world’s card says which part no one has seen.',
      'The bell’s list is cleaner: spacecraft in contact folded into one row, a date column for what is coming, notifications as a switch.',
      'Launch climbs: a failed launch is shown as far as it got with its reported cause; the webcast link appears only when one is listed; pressing Live or Escape during a climb no longer leaves the camera stuck.',
      'The screening grid (G) now shows at every world and on the solar system, where its cells are millions of kilometres wide; select a craft to see its own cell, the 27 cells searched round it, and what shares them.',
      'Faster to open: the globe appears in well under a second on a good connection, about 4 MB less is downloaded, and on a strong computer Auto quality now steps up to High by itself.',
      'Fixed: searching for something beyond Earth orbit (Wind, Webb) from another world now takes you straight to it; the camera turns round a lander (Surveyor, Apollo) with the horizon level; a rocket waiting on its pad no longer sinks into the ground; the time bar’s text no longer runs over its buttons far from the present.',
    ],
  },
  {
    date: '2026-11-19',
    title: '49 more models, one for nearly everything out there',
    items: [
      'Every spacecraft beyond Earth orbit now has its own model or the one drawn from it: Gaia, Roman, Kepler, Spitzer, JUICE, Hayabusa2, Hera, the Mars orbiters, InSight, Zhurong, the Moon landers and more.',
      'The historic landing sites show what really stands there: Apollo’s lunar module (with the rover on Apollo 15–17), Surveyor, Lunokhod, Viking, Pathfinder and Sojourner, Spirit and Opportunity, Venera, Huygens on Titan.',
      'More satellite fleets drawn as themselves: GPS III, BeiDou, Spire’s Lemur, the Space Development Agency’s satellites, HawkEye 360, SkySat, Satellogic, Orbcomm, and the Umbra, Strix and QPS-SAR radar satellites. 127 kinds in all.',
      'The launch list shows each rocket, and the spacecraft catalogue can preview a rocket’s next launch.',
      'Wherever a spacecraft is “in contact”, a link goes to the source: NASA’s live Deep Space Network page.',
    ],
  },
  {
    date: '2026-11-19',
    title: 'Easier on a phone',
    items: [
      'A strip of worlds along the bottom on a phone: tap a planet to fly to it, tap again to go in; its moons appear beside it. A round button in the Earth view goes out to the solar system.',
      'In the phone’s sky view, tap anything you see — a satellite, the Moon, a planet, a constellation — for a small card saying what it is; it closes itself after 8 seconds.',
      'Planets and spacecraft are easier to hit with a finger.',
      'In full screen, Escape steps out of a world without leaving full screen (Chrome and Edge); on the whole solar system it leaves full screen as usual.',
      'The top bar shows how old the tracking data is (“2 h 57 min old”), and a clock that is paused or moved says so in words.',
      'The status bar at the bottom works at every world: how high you are above it and what is below you.',
      'Fixed: dragging the view to look straight down past a followed satellite (the Space Station, say) made it flip back and forth.',
    ],
  },
  {
    date: '2026-11-19',
    title: 'Eclipses you can see, the Station over you, faster time out there',
    items: [
      'The Moon’s shadow falls on the Earth during a solar eclipse, with the track of its centre drawn across the ground. Choose an eclipse in the bell to go to it.',
      'The bell tells you when the Space Station is about to pass over you, and can send a browser notification for alerts if you turn that on.',
      'Away from the Earth, time can run at a day, a week, a month or a year a second, so the planets visibly go round.',
      'Launch climbs show the booster flying back down to its droneship or landing zone, and, once tracking catches up, the real objects and how close the estimate was.',
      'Share a launch climb or an eclipse: the link opens it at that moment.',
      'Planets far more precise (VSOP87): eclipse and transit times now within a minute of NASA’s.',
      'A rebuilt Tesla Roadster with Starman at the wheel, and new models for Qianfan, Guowang, Planet Doves, ICEYE, Globalstar and Capella: 78 kinds in all. Scroll through every one on the home page.',
      'Rover paths are easier to find: drawn from farther out, and switched from the rover’s own card.',
      'Saturn opens from the side the Sun lights its rings (since 2025 that is the southern side), and a seam in the rings’ shadow is gone.',
      'The bell is more honest about asteroids: only a really close one is an alert, and it lists the next one you can actually follow.',
    ],
  },
  {
    date: '2026-11-19',
    title: 'Launches you can watch, rovers that move, eclipses ahead',
    items: [
      'Watch a rocket climb: every launch with a known pad and time is drawn rising from its pad to orbit on an estimated path, with “Follow” and “Watch live”. Preview any upcoming launch, or replay a recent one.',
      'New launches stand out: what went up in the last three days is brighter and named “New” on the globe.',
      'Curiosity and Perseverance now stand where they really are, at the end of the paths they have driven, drawn on the ground from NASA’s own record.',
      'Eclipses and transits: the next solar and lunar eclipses, and the moons of Jupiter crossing its face, in the bell.',
      'More 3D models, among them the Starlink V2 Mini, Falcon 9, Starship and the Tesla Roadster that flew to space.',
      'Search knows where you are: at Mars, Mars’s rovers and orbiters come first.',
      'Starts faster: the extras load alongside the globe instead of before it.',
    ],
  },
  {
    date: '2026-11-19',
    title: 'The bell, a solar-system tour, and filters you cannot miss',
    items: [
      'The bell (top right) lists what is happening now and what is coming up: launches, meteor showers, asteroids passing, spacecraft talking to NASA’s dishes. Only the unusual raises an alert.',
      'Autoplay: away from the Earth the play button tours the solar system from the Sun to Pluto.',
      'Escape takes you out of the Earth to the solar system, as it does at every other world.',
      'A banner says when a filter is hiding objects, and “Show all” clears every filter at once.',
      'Point at any world or spacecraft for a hover card; the cursor shows what can be clicked.',
      'Rovers and landers stand on the ground with soft shadows; planet and spacecraft orbits switch on and off separately.',
    ],
  },
  {
    date: '2026-11-19',
    title: 'One tool, many worlds',
    items: [
      'Every world has the same card, views, layers and close-approach monitor as the Earth; where you are is a path in the top bar.',
      'Thirty-five moons, each where it really is, and 32 historic landing sites.',
      'Sharp close-up ground at the Moon, Mars and Mercury.',
      'An open tab picks up the newest tracking data by itself.',
    ],
  },
  {
    date: '2026-11-18',
    title: 'Beyond Earth orbit',
    items: [
      'Zoom out of the Earth into the solar system, and into any world in it, with no cut between them.',
      'Fifty spacecraft placed from NASA JPL’s trajectory data, asteroid fly-bys, fireballs, meteor showers and the live Deep Space Network.',
      'Twenty-eight new 3D models and a catalogue of every model; one search field for everything.',
    ],
  },
];
