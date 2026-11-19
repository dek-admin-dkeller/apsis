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
      { name: 'Sharp ground', text: 'Zoom in and the ground under you is redrawn from detailed NASA imagery, by day and by night. At the Moon, Mars and Mercury too.' },
      { name: 'Names and a hover card', text: 'Names appear as you zoom in. Point at any dot for a picture, what it is and who runs it.' },
      { name: 'Colour and filter', text: 'Colour the dots by type, orbit, height, owner, launch year or tilt, and hide what you do not need.' },
      { name: 'Search', text: 'One field finds an object by name, nickname or number, a place, a time or an action, and forgives a misspelling. Press / or Ctrl K.', fresh: true },
      { name: 'Search by type', text: 'Type “spacex”, “telescope” or “chinese radar” and choose the type: only those objects stay on the globe, and you step through them one at a time with their 3D models (‹ ›, the arrow keys, or a swipe on a phone). Done leaves you on the one you stopped at.', fresh: true },
      { name: 'The sky behind', text: 'Real stars, constellations, the planets, the Moon, and tonight’s aurora over the poles.' },
      { name: 'Views and time', text: 'Whole Earth, low orbit, the geostationary ring, Earth with the Moon. Pause time, run it backwards, or up to a thousand times faster.' },
      { name: 'Growth by year', text: 'Drag a slider from 1957 to today and see what is still up there from each year.', fresh: true },
      { name: 'Data age', text: 'Colour every object by how recently its orbit was measured, so stale ones stand out.', fresh: true },
      { name: 'Live and coming up', text: 'The bell in the top bar lists what is happening now — spacecraft in contact with NASA’s dishes, a rocket lifting off, an active meteor shower — and what is next. Choose one to go and see it.', fresh: true },
      { name: 'A filter you cannot miss', text: 'While anything is hidden, a banner at the top says how many objects are shown, what is hiding the rest, and puts everything back in one click.', fresh: true },
      { name: 'Always current', text: 'The tracking data is refreshed every three hours, and a tab you leave open picks up the new data by itself.', fresh: true },
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
      { name: 'Autoplay', text: 'Press play on the solar system and sit back: a hands-free trip from the Sun out to Pluto, stopping at each world with a line about it. Any key or click stops it where it is.', fresh: true },
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
      { name: 'Launches, trains and re-entries', text: 'The newest objects in orbit, freshly launched batches still flying in a line, and the lowest orbits that will come down next.' },
      { name: 'Design a satellite', text: 'Choose an orbit, put your own object into the catalogue, and see what it would pass close to.' },
      { name: 'Autopilot and recording', text: 'A hands-free tour of the highlights. Save a picture or record a video of what you see.' },
      { name: 'Share', text: 'A link or QR code that reopens exactly what you are looking at.' },
      { name: 'Visible tonight', text: 'The bright passes you could see with your own eyes in the next 24 hours from where you are, and where to look. On a phone it opens inside the sky view.', fresh: true },
      { name: 'Upcoming launches', text: 'What is due to launch next, with a countdown and the pads marked on the globe.', fresh: true },
      { name: 'Watch a launch climb', text: 'A rocket rising from its pad to orbit on the globe, live as it launches: an estimated path from the pad, the time and the target orbit, with its height, speed and stages, the booster flying back to land, and the webcast when one is listed. Preview any upcoming launch, replay a recent one, share the moment, and see the real objects once tracking has caught up. A launch that failed is shown as far as it got, with the reported cause.', fresh: true },
      { name: 'New launches', text: 'What went up in the last three days stands out: brighter dots and a “New” name, until the novelty wears off.', fresh: true },
      { name: 'Orbit changes', text: 'Which satellites have raised or lowered their orbits since the data was last refreshed, and what is new or gone.', fresh: true },
      { name: 'Space weather and re-entries', text: 'How active the Sun is today, and roughly how long the lowest objects have left.', fresh: true },
      { name: 'Spacecraft catalogue', text: 'Every 3D model on one page. Pick one to turn it round, read what it is, and go and find one in orbit.', fresh: true },
      { name: 'Asteroid fly-bys', text: 'The rocks passing the Earth in the coming weeks: when, how far away in kilometres and Moon-distances, how big and how fast. Choose one to move the clock to its closest approach.', fresh: true },
      { name: 'Fireballs', text: 'The brightest meteors recorded lately, with the energy of each, marked on the globe where they exploded.', fresh: true },
      { name: 'Eclipses and transits', text: 'The next solar and lunar eclipses and the shadows of Jupiter’s moons crossing its face, worked out in the app and listed in the bell. During a solar eclipse the Moon’s shadow darkens the Earth and the track of its centre is drawn on the ground. Choose one to go to it.', fresh: true },
      { name: 'The Station over you', text: 'With your location shared, the bell says when the Space Station is about to pass overhead and whether it will be bright to the eye.', fresh: true },
      { name: 'Notifications', text: 'Turn them on in the bell and the browser tells you when something unusual starts: a launch, an eclipse, a close asteroid, the Station overhead. Never for routine things.', fresh: true },
      { name: 'Meteor showers', text: 'Which annual showers are active now and which come next, with the hour of each peak worked out for this year.', fresh: true },
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

/** One release as visitors see it: newest first in WHATS_NEW. */
export interface Update {
  date: string; // YYYY-MM-DD
  title: string;
  items: string[];
}

export const WHATS_NEW: Update[] = [
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
