# OrbitHash

Real-time satellite conjunction (close-approach) screening with a **3D spatial hash grid**.
CSC 2710 Algorithms — hashing team project.

On screen the app calls itself **Apsis** (an apsis is the nearest or farthest point of an
orbit); OrbitHash remains the project and repository name. The display name appears only
in `index.html`.

OrbitHash shows every tracked object in Earth orbit — about 19,500 active satellites and
debris fragments — on a live 3D globe and, about once a second, finds every pair that is
closer than a screening distance `d`. The naive way compares every pair: n(n−1)/2 ≈
**191 million** distance checks per tick. OrbitHash hashes each object's position into a
grid cell and gets the *identical* answer with a few hundred checks.

Working on the code, or handing it to an AI agent? Start with [CLAUDE.md](CLAUDE.md): it
explains the architecture, the coordinate frames, the conventions and how to verify a change.

## Run it

Needs Node 22.18 or newer (the benchmark script imports the TypeScript files directly).

```bash
npm install
npm run fetch-data   # one-time download of orbital data + Earth textures (already included)
npm run dev          # open the printed http://localhost:5173 address
```

Other commands:

```bash
npm run bench        # brute force vs spatial hash in Node — prints a table for the report
npm run build        # type-check + production build into dist/
npm run check        # the feature checks: orbit changes, visible passes, the report, decay, the search,
                     # and the solar system against JPL Horizons (prints the worst errors)
npm run fetch-radio  # refresh the SatNOGS radio records in public/data/radio.json (at most about every 6 hours)
npm run fetch-deep   # refresh public/data/deep.json: spacecraft beyond Earth orbit, fly-bys, fireballs (JPL; at most about every 6 hours)
npm run smoke        # the built site in headless Chrome: starts, the bell, the solar system, Mars (the deploy runs it on pushes)
npm run shots        # retake the home page's screenshots (needs Chrome and `npm run dev` running)
```

The data snapshot and textures live in `public/`, so the app runs **offline** (only the
Wikipedia photos and the sharper close-up ground imagery need a connection). Fonts are
bundled too (the Google Fonts families Inter, Space Grotesk and JetBrains Mono, installed
from npm so no network request is needed).

## Using the app

The screen is laid out like a tracking console: a tool rail on the left opens one panel at
a time, the selected object's inspector docks on the right, and the transport bar and
status line sit along the bottom.

| What | How |
| --- | --- |
| Look around | drag = rotate, scroll = zoom, right-drag = pan. Drag and zoom slow down as you get close to the surface |
| Home | the logo (or `0`) closes everything and returns to the whole Earth at the present time |
| Inspect an object | click a dot, or find it in the search field. The camera flies to the object and locks on: dragging now turns the view around **it**, not the Earth (`T` unlocks). Where the catalogue files an object under a code, its title is the name people know, with the code after it: "Hubble Space Telescope (HST)" |
| Inspector tabs | **Live** telemetry, ground-track map, altitude chart · **Orbit** shape to scale, orbital elements, speed and sunlight charts · **Passes** over your ground station with a sky chart · **Record** owner, launch, size, a Wikipedia summary and the raw element record. Under the name there is always a link to Wikipedia: the object's article when one is known or found, otherwise Wikipedia's search for its name |
| Objects panel (`O`) | three tabs. **Browse** is a page of controls: watchlist, notable objects, filters by type, orbit regime and altitude band, colour by type, orbit, altitude, owner, launch year, tilt or data age, labels, marker size. **Activity** and **Tools** are grids of tiles, one per feature (an icon, a name and a live figure where there is one): visible tonight, launches, orbit changes, newest, trains, lowest orbits; constellations, growth by year, the designer, the contact timeline, the benchmark, the walkthrough, the tour. A tile opens its feature in place of the grid; the feature's title is the way back |
| Search (`/`, or `Ctrl` `K` / `Cmd` `K`) | one field for everything. Type an object's name, nickname or catalogue number ("iss", "hubble", "25544"), a type ("telescope", "weather", "spacex", "chinese radar"), a place ("tokyo"), a time ("tomorrow 9 pm", "+90m", "now"), a speed ("100x", "pause") or an action ("monitor on", "launches", "sky view", "miles"). The answers come as one list under headings (Objects, Types, Places, Time, Actions), each row saying what it is or what it will do; Enter takes the first. Case, punctuation and spacing do not matter and small misspellings are forgiven ("hubbel"). Choosing a type shows only those objects on the globe and opens a bar to step through them one at a time, each selected with its 3D model (‹ ›, the arrow keys, a swipe along the bar on a phone); **Done** or Escape shows everything again and stays on the object in view. The chip in the field (or Home) also shows everything again. With nothing typed, the field lists one example of each kind |
| The solar system | the path in the top bar ("Solar system / Earth") is the way between places: click **Solar system**, or simply zoom out as far as a view goes and keep going. The camera pulls back, the satellites fade away, and the Earth is left as a world among the planets, each on the right side of the Sun for the date on the clock. There is no cut: for half a second both pictures are drawn and dissolved, with the Earth and the stars held still. Escape in the tracker, with nothing else to close, makes the same move. One more step out (Escape, a click on empty space) shows the whole system. Views: whole, inner planets, straight down. **Layers** works there too: orbits, names, moons, spacecraft and constellation names can each be switched off, or every craft named |
| Other worlds | on the solar system, click a planet or moon: the camera goes up to it and its name, distance and light-time are written under it. Press **Enter**, click it again or zoom in, and the camera carries on in while its moons and spacecraft appear. Every world has the same rail as the Earth: **Objects** (what is there), **Layers**, **Monitor** (close approaches among the craft there, now and over the next 24 hours, found with the same hash grid, which can be drawn), **Settings**, and views (whole, close, night side, moons; keys `1`–`4`). The logo puts the view of the world you are at back the way it starts. The Sun, every planet, Pluto and 21 moons can be visited |
| Spacecraft beyond Earth orbit | search for one ("webb", "voyager", "curiosity") or find it at its world. Fifty craft are placed from NASA JPL's trajectory data: the telescopes round the L2 point, orbiters and rovers at the Moon and Mars, Juno, the craft cruising between the planets, and the five leaving the solar system. The card shows the distance from Earth, the signal's travel time, the speed, and **In contact now** when one of NASA's deep-space dishes is talking to it this minute. An asteroid of the fly-by list can be followed along its real path past the Earth. A craft in orbit has the same **Orbit / Track / Footprint / 3D model** switches as a satellite, and its card adds the article's photo and opening lines, the period, lowest and highest point and tilt of its orbit. Historic **landing sites** (Apollo, Viking, Huygens …) are marked on the ground, each with its date and whether the Sun is up there now |
| Visible tonight | the bright passes you could see with your own eyes in the next 24 hours from where you are (the satellite in sunlight, your sky dark), brightest first, with where to look. Pressing the button asks for your location if the ground station is still the built-in example. On a computer: Objects → Activity → Tonight. On a phone it lives in the sky view: the small faded eye beside the cross opens the list over the sky, and tapping a pass moves the clock to just before it |
| Upcoming launches | Objects → Activity: what is due to go up next, who is launching it and from where, with a countdown; the pads are marked on the globe and a click flies to one |
| Orbit changes | Objects → Activity: what differs between the two most recent downloads of the catalogue: orbits raised, lowered or tilted by more than drag and noise explain (possible manoeuvres), new objects, objects that are gone |
| Space weather and re-entries | Objects → Activity → Lowest orbits: today's solar radio flux and geomagnetic activity from NOAA in plain words, and a rough "time left" beside each of the lowest objects |
| Asteroid fly-bys | Objects → Activity: every asteroid coming within 7.5 million km of the Earth in the next two months, soonest first: when, how far (in km or miles, and in Moon-distances), a size range and its speed. The tile counts the next 30 days. Click one to move the clock to its closest approach |
| Fireballs | Objects → Activity: the forty most recent bright meteors recorded by US Government sensors, with where each exploded, how high, and its energy in kilotons of TNT. While the list is open they are marked on the globe; click one to fly there |
| Meteor showers | Objects → Activity: which of the twelve main annual showers are active (on the simulated clock) and which come next, with each one's peak time for the year, best hourly rate, parent comet and the constellation it comes from. Click one to move the clock to its peak |
| Deep Space Network | Objects → Activity → *Deep space links*: NASA's live list of which dish at Goldstone, Madrid and Canberra is pointed at which spacecraft, which way signals are flowing, how far away the craft is and the round-trip light time. Refreshed each minute while it is open |
| Growth by year | Objects → Tools: drag a slider from 1957 to today (or press Play) and the globe shows only what had been launched by that year, with a chart of what is still up from each year |
| Radio, last heard, Doppler | inspector, Live tab: when a volunteer ground station last received the object and on which frequency. Passes tab: its listed transmitters and the Doppler shift of one of them as heard at your ground station right now |
| Data age | inspector, Live tab: how old the object's orbital elements are, with a warning once they are stale, and its catalogue status. Objects → Browse → Colour by → **Data age** colours the whole catalogue the same way |
| Close-approach report | with a close approach open: **Report** opens a one-page summary to print or save as a PDF; **Data (CSV)** downloads both objects' positions, velocities and the range between them through the approach |
| Layers panel (`L`) | every layer is a small tile, lit while it is on, so the state of the picture reads at a glance: orbit path, ground track, coverage footprint, 3D model; clouds, atmosphere, coastlines and borders, lat/long grid, day/night line, aurora, sharp ground, ground-station marker; stars, constellations, planets, names in the sky; screening cells (`G`). Name tags (off, well-known, as you zoom) are here too |
| Close-approach monitor (`C`) | **Right now**: switch it on, set the alert distance; the pairs inside it are sorted into two lists — **Passing** (objects on different orbits crossing paths, with their passing speed) and **Flying together** (docked spacecraft, formations and launch trains, which are close all the time). A spacecraft that the catalogue lists as several objects, such as the Space Station with its modules and docked capsules, appears there once, under a **Joined** heading apart from the formations and trains, and clicking it selects the spacecraft instead of opening a pair. The counts in the top bar and on the globe are of the passing kind only. **Coming hours**: scan up to 24 hours ahead for predicted close passes. Click any pair to open the **close-approach view** (time keeps running live; the panel's replay and scrubber give a slow-motion or frozen look): both spacecraft as 3D models, their flight paths, the live distance between them, a range chart you can scrub, and a slow-motion replay |
| Ride along (`V`) | from the inspector: sit on the selected object and look out from it. Drag to look around, scroll to zoom |
| Sky view (`4`) | the **Sky** button at the foot of the rail: stand at the ground station and watch objects cross overhead |
| Your location | Apsis asks once whether it may show where you are; the crosshair button in the top bar does the same at any time. Only after a yes does the browser's own permission prompt appear. You are then a green dot, and passes and the sky view use that spot |
| Watchlist (`S`) | star an object in the inspector; it stays in the Objects panel and keeps its name tag on the globe |
| Screening cells in a close approach (`G`) | with a close approach open, the cells drawing is about that pair: the grid of occupied cells dimmed around them, one object's cell in cyan with an outline of the 27 cells its search covers, the other's in amber, both lit red while the two are inside the alert distance. The camera keeps both objects in view as they fly apart, and their flight paths are drawn as long arcs |
| Share | the link button in the top bar copies an address that reopens the same object, close approach, time or camera position |
| Tour | offered on the first visit and always available from the controls sheet (`?`) |
| Launch climbs | every launch with a known pad and minute is drawn rising from its pad to orbit on an ESTIMATED path (pad, time and target orbit; no one publishes a rocket's live position), with T+, height, speed and stage, **Follow**, and a quiet **Webcast** / **Recording** link only when Launch Library lists one. In the launches list: **Preview / Watch / Replay the climb** (the clock moves to lift-off). A failed launch is drawn up to the moment it was lost when the reported cause says when (then a burst), otherwise not flown at all, and its card gives the cause; a partial failure flies and says so. Escape closes the card; pressing Live lets the camera go |
| New launches | objects launched in the last three days are brighter, mint, and named "New" (Layers → New launches) |
| Rover paths | at Mars, the routes Curiosity and Perseverance have driven, from NASA's daily record; each rover stands at the end of its path (Layers → Rover paths) |
| Eclipses and transits | during a solar eclipse the Moon's shadow darkens the globe and the track of its centre is drawn; the bell lists the next solar and lunar eclipses (an alert while one is happening), a planet crossing the Sun, and the shadows of Jupiter's moons on the planet (routine); choosing one moves the clock to its peak and goes to where the shadow falls. Worked out in the app (`space/skyEvents.ts`) and checked against NASA's eclipse tables |
| The Station over you | with your location shared, the bell gives the Space Station's next pass and raises an alert when it is about to rise high overhead |
| Notifications | opt-in, from the bell: a browser notification when an alert starts (launch, eclipse, close asteroid, Station overhead), once each |
| Solar-system speeds | away from the Earth the time bar adds a day, a week, a month and a year a second; back at the Earth it returns to 1000× |
| Share links | `#launch=<id>&t=…` opens a launch climb at that moment, `#event=solar-2027-02-06` an eclipse at its peak, besides `#sat=`, `#pair=`, `#place=`, `#craft=` |
| Phones: worlds | one pill in the middle of the tab bar, "‹ Earth ›" (it replaces the path at the top on a phone): tap it for the whole solar system (on the solar system: go in to the world beside you, or open the list); swipe it or tap ‹ › for the next world outwards; swipe it up or hold it for a sheet of every world as a small globe, with the moons of the planet you are at. A two-finger tap on the picture goes up a level, like Escape |
| Screening away from the Earth | the Monitor and **G** work at every world and on the solar system: the craft there go through the same hash grid as the Earth's objects (on the solar system the craft round the Sun, with cells of 1, 10 or 100 million km, drawn bent by the map's squeeze of distance). Occupied cells are cyan, red where a pair is inside the alert distance; with a craft selected its own cell is amber, the 27 cells searched round it are outlined, and the panel says what shares that block |
| Unseen sides | parts of Pluto, Charon, Triton, Uranus's five moons, Phoebe and Callisto were never photographed (the bundled maps hold one flat tone there). By default they are filled in with an educated guess: that world's own photographed terrain, mirrored north–south and turned half a turn, laid in off the main thread (`worker/unseen.worker.ts`). Layers → **Unseen sides** turns it off; the world's Facts tab says what is missing and why |
| Phones: sky view | tap a satellite, the Sun, the Moon, a planet or a constellation for a small card; it closes after 8 s or at the next tap |
| Escape in full screen | Chrome and Edge: the app keeps Escape (hold Esc to leave full screen); on the whole solar system Escape leaves full screen |
| What's new | the home page and About list the latest additions, newest first |
| Live and coming up | the bell in the top bar (on a phone, in the menu): spacecraft a Deep Space Network dish is talking to now, a launch in flight or about to lift off, an active meteor shower, then the next launches, asteroid and shower peak. A green dot and count while anything is live; each row goes to it |
| Filters | while any filter hides part of the catalogue (a type chosen in the search, the type and orbit chips, the height range, the year slider), an amber banner at the top of the globe says how many are shown and why, and **Show all** clears every one of them |
| Autopilot (`A`) | a hands-free cinematic tour of the view; any key or click stops it. Away from the Earth the same button is **Autoplay**: a trip from the Sun out to Pluto, stopping at each world with a caption |
| Picture and video (`P`, `M`) | the camera button in the top bar opens a two-item menu: save a picture, or record a video of the 3D view (with captions). They sit one click deeper on purpose, so neither starts from a stray click |
| Launch and re-entry feed | Objects panel: **Newest in orbit** (grouped by launch), **Satellite trains** (recent batches still flying in a line; click to light one up) and **Lowest orbits** (next to come down) |
| Constellations | Objects panel: pick GPS, Starlink, Iridium and so on to draw all its orbits and a live map of how many of its satellites can see each point on the ground |
| Aurora | Layers → Earth: tonight's aurora oval from NOAA's forecast, with the current geomagnetic activity |
| Sharp ground | zoom in and the ground under the camera is redrawn from detailed NASA imagery, about sixteen times finer than the globe's own picture (Layers → *Sharp ground*). The same at the Moon, Mars and Mercury: come close and craters a few hundred metres across appear |
| Spacecraft catalogue | Objects panel → Tools → **Spacecraft** (also in About): every 3D model on one page, grouped by where the craft work. Pick one to see it large and turn it round with the mouse or a finger (`←` `→` step through them); **Show one in orbit** selects an object of that kind in the tracker |
| Hover card | point at any dot for a small card: a photo or a 3D picture of it, what it is, who runs it, its height and speed now |
| People in space | who is aboard the ISS and Tiangong right now, in those stations' Record tab |
| Contact timeline | Watchlist → **Contact timeline**: when each of several ground stations can see each starred object over the next 24 hours |
| Point your phone | on a phone, the round sky button asks where you are (and, on an iPhone, for the motion sensors), then fills the screen with the sky: hold the phone up and it shows what is overhead in that direction. A faint cross in the corner closes it |
| Design a satellite | Objects panel: choose an orbit, launch your own object into the live catalogue, and check what it will pass close to in the next 24 hours |
| Time | the bar at the bottom: drag the timeline to move up to 12 hours either way, pause (`Space`), 1× – 1000×, run backwards (`R`), step 10 minutes (`[` `]`), **Now** (`N`), or click the clock to type a date |
| Hover | pointing at an object shows a small card: picture, what it is, who runs it, height and speed |
| Views | `1` `2` `3`, `5` (Earth with the Moon beyond it), or the buttons at the foot of the tool rail. Left alone, a whole-Earth view drifts slowly around the planet (Settings → Camera to switch off), and the bars around the picture dim a little until the pointer moves again |
| Fresh data | the site refreshes its tracking data every 3 hours. A tab you leave open notices (it asks its own site, at most every 30 minutes and only while visible), loads the new data at a quiet moment and says so in one line; what you had selected stays selected, and **Tracking data** in the top bar (how old the data is, e.g. "2 h 57 min old"; the download time on hover) starts again |
| Settings (`,`) | one line per setting, in five groups: **Units** (kilometres or miles; local time, which is what the clock shows unless changed, or UTC), **Display** (rendering quality, frosted panels, hover card, quiet time bar, home page on arrival), **Camera** (drift around the Earth, circle a selected object), **Ground station** (name, coordinates, use my location), **Data** (download current elements). Reset is at the foot |
| Home page | the first thing a visitor sees, while the tracker loads behind it: the live globe as soon as its map has arrived (the objects, then the clouds and city lights, follow), real screens that change by themselves like a slideshow, how the search works, six of the 3D models, everything it can do, and **Open the tracker**. Going in before the tracker is ready shows the loading screen until it is. **About** in the tracker's top bar (the round **i** on a phone) brings it back. Skipped on arrival for share links and when switched off in Settings |
| How it works | summarised on the home page, with a link to the full walkthrough: the screening algorithm with a live trace, live hash-table statistics, the look-ahead method and the benchmark. Also reachable from the monitor panel |
| Phones | below 760 px the layout is built around the globe: a search field, two round buttons (sky view, and a menu: the four views as a row of icons, then autopilot, time and speed, location and share), a short four-tool tab bar, and sheets that rest on the tab bar and can be dragged to any height or tucked away. There is no time bar on a phone; a small chip appears only while time is not running live. Left alone, once the globe starts its slow turn the controls dim until they are barely there and come back at the next touch. It can be added to the home screen and then runs full screen like an app |
| Other keys | `P` save a picture, `F` full screen, `H` hide the interface, `?` all controls, `Esc` close / deselect |

## How the spatial hash works

**Idea.** Two objects on opposite sides of the planet cannot be 10 km apart, so comparing
them is wasted work. Cut space into cubes exactly `d` wide. If two objects are closer than
`d`, their coordinates differ by less than `d` on every axis, so their integer cell
coordinates `floor(x / d)` differ by at most 1. A close pair is therefore always in the
same cube or in two touching cubes — and around any cube there are only 3 × 3 × 3 = 27.

```
 2D picture (the real grid is 3D: 27 cubes instead of 9 squares)

 +-----+-----+-----+-----+-----+
 |  .  |     |     |  .  |     |      .  object, never compared with A
 +-----+-----+-----+-----+-----+
 |     | : : | : o | : : |     |      A  the object being checked
 +-----+-----+-----+-----+-----+      o  a candidate: its distance to A is measured
 |  .  | : : | :A: | : : |  .  |
 +-----+-----+-----+-----+-----+      : : the 9 (in 3D: 27) cells looked up for A
 |     | : o | : : | : : |     |
 +-----+-----+-----+-----+-----+      each cell is d wide, so anything closer than d
 |     |     |  .  |     |  .  |      to A MUST be inside the dotted block
 +-----+-----+-----+-----+-----+
```

**The hash table.** `Map<number, number[]>` — key = the cell, value = the bucket of object
ids inside it.

**The hash function** (`SpatialHash.ts`):

1. `ix = floor(x / d)`, likewise `iy`, `iz` — which cube the point is in.
2. Shift each by 65,536 so it is non-negative, then pack the three numbers into one:
   `key = (ix · R + iy) · R + iz` with `R = 2^17`. That is a 3-digit number in base `R`, so
   different cubes always get different keys, and it stays below 2^53, so it is an exact
   integer in JavaScript.

A numeric key instead of a string like `"3,-2,7"` avoids building and hashing a string for
every one of the ~28 lookups per object; `npm run bench` measures it at about 4–5× faster.

**Screening** (`conjunction.ts`): insert all n objects (build), then for each object
collect the ids in its 27 surrounding buckets and measure the true distance only to those,
keeping pairs with `i < j` so each pair is reported once.

### Complexity

| | Brute force | Spatial hash |
| --- | --- | --- |
| Build | – | n inserts, O(1) expected each → **O(n)** |
| Query | n(n−1)/2 distance checks → **O(n²)** | 27 lookups per object + one check per candidate → **O(n + k)** expected, k = pairs found |
| Worst case | O(n²) | **O(n²)** — if everything lands in one cell (huge `d`, or all objects clustered), that one bucket holds all n objects, exactly like a hash table whose keys all collide |
| Space | O(1) extra | O(n) |

Measured on the development laptop with the bundled snapshot, `d` = 10 km (`npm run bench`):

| Objects | Brute force | Spatial hash | Speedup | Distance checks (brute → hash) |
| ---: | ---: | ---: | ---: | --- |
| 1,000 | 0.9 ms | 0.95 ms | 0.9× | 499,500 → 0 |
| 5,000 | 22 ms | 4.2 ms | 5× | 12.5 M → 6 |
| 10,000 | 87 ms | 9.0 ms | 10× | 50 M → 30 |
| 19,572 | 335 ms | 18 ms | 18.5× | 191.5 M → 154 |

Both methods return identical pair lists at every size (also checked on a dense random
cloud with 1,131 pairs). Below about 1,000 objects brute force is just as fast — the hash
only pays off once n² is large. Orbits are so sparse at 10 km that the fullest bucket is
the space station with its docked modules; nearly every other bucket holds one object.

### Looking ahead

The live monitor asks "who is close right now". The **Coming hours** scan asks "who *will*
be close", which needs the same question at many future instants. Sampling once a minute
and looking for pairs inside 1 km would miss almost everything, because two objects closing
at 15 km/s are that close for a fraction of a second. So `hashing/lookahead.ts` widens the
net and reasons about motion:

1. Every 60 simulated seconds, propagate everything and hash it into cells of size
   `alert distance + fastest closing speed × 30 s` (about 490 km). Any pair that passes
   close during that minute is no further apart than this at the sample, so the 27-cell
   query is guaranteed to return it.
2. For each candidate pair, treat the relative motion as a straight line for that minute
   and solve for the moment of closest approach, `t* = −(r · v) / |v|²`. Keep the pair only
   if `t*` falls inside this minute and the straight-line miss is small.
3. Refine the survivors with exact SGP4 and a golden-section search.

One hour for all 19,572 objects takes about 3.5 s: 41 million candidate pairs instead of
11 billion pair-checks. `npm run bench` also checks completeness: against brute-force
sampling every 0.2 s on a 4,000-object subset, the scan reported every crossing pair.

## Publishing

The app is static files, so it runs on GitHub Pages. `.github/workflows/deploy.yml` builds
and deploys on every push to `main`, and every 3 hours it first refreshes the data and
compares the new elements with the ones published before (the "Orbit changes" list). The
refreshed data is published but not committed, so the repository stays small; if a source
cannot be reached, the site keeps the data it already had.

How often each source is asked. Every run starts from the data the site is showing, and each
download script declines while its own file is too young, so the limits below hold however
often the workflow runs (a run started by hand just after a scheduled one downloads nothing):

| Source | Asked | Requests each time |
| --- | --- | --- |
| [CelesTrak](https://celestrak.org) orbital elements | every 3 hours (it updates about every 2 and asks for no more than one download per update) | 5, a second apart |
| CelesTrak catalogue facts (owner, launch, size) | once a day | 1 |
| [SatNOGS](https://satnogs.org) radio records | every 6 hours | at most 22, 1.5 s apart |
| [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) and CNEOS (deep space, fly-bys, fireballs) | every 6 hours | about 130, strictly one at a time |

A tab that stays open picks the new data up by itself: at most every 30 minutes, and only
while it is visible, the page asks its own site (never anyone else) whether a data file has
been published again, with a request that returns headers only, and loads a file only if it
has. The catalogue is swapped at a quiet moment (not during a close-approach replay, not
while you are at another world); what you had selected stays selected. A build started by a push downloads nothing from outside: it reads the data files
back from the site as it is published and keeps them if they are newer than the repository's
(`scripts/carry-over.mjs`), so a push never puts the site back on older data. In the
repository settings, Pages must be set to deploy from **GitHub Actions**.

GitHub switches off scheduled workflows in repositories with no activity for 60 days. That
would not take the site down — it would only stop the data refreshing — and the workflow
guards against it by re-enabling itself through the API on every scheduled run.

## Where the code is

```
src/
  hashing/
    SpatialHash.ts       THE algorithm: hash function, insert, queryNeighbors, stats. Standalone.
    conjunction.ts       bruteForcePairs() and hashedPairs() — same sorted output, so they can be compared
    benchmark.ts         timing + identical-result check, shared by the app and `npm run bench`
    lookahead.ts         prediction scan: wide hash cells + straight-line closest approach + SGP4 refinement
    groups.ts            union–find over a Map: merges pairs of joined objects back into one spacecraft
  data/
    catalog.ts           loads the snapshot; builds the Map/Set indexes (by NORAD id, name, prefix, category, orbit)
    categorize.ts        category + orbit class (LEO / MEO / GEO / HEO) from name and mean motion
    describe.ts          operator / purpose / model shape, inferred from the name
    spacecraft.ts        one sentence about each kind of model, and the catalogue's groups
    ephemeris.ts         orbit maths for one or two objects: sampled orbit, look angles, passes, closest approach
    satcat.ts            catalogue facts (owner, launch, size) in a Map keyed by NORAD id
    wiki.ts              name → Wikipedia article (a table, then the name itself); summary, lead photo and link on demand
    regions.ts           rough place name under a latitude / longitude
    radio.ts             SatNOGS records (transmitters, last heard) in a Map keyed by NORAD id
    doppler.ts           range rate and Doppler shift of a transmitter as heard at the ground station
    changes.ts           compares two downloads: raised, lowered, tilted, new, gone
    decay.ts             rough time left in orbit for the lowest objects        spaceWeather.ts   NOAA solar flux and Kp
    launches.ts          upcoming launches (Launch Library 2), cached           places.ts   cities the search can fly to
    ascent.ts            an ESTIMATED climb to orbit for any listed launch (pad, time, target orbit)
    fresh.ts             what was launched in the last three days, grouped by launch
    names.ts             readable names for objects filed under a code: "Hubble Space Telescope (HST)"
    freshness.ts         a tab left open asks its own site for newer data files (headers only, every 30 minutes)
    visibility.ts        which passes are bright enough to see, and when        approachData.ts   numbers for the report
    types.ts
  worker/
    sim.worker.ts        Web Worker: SGP4 propagation, screening, benchmark
    SimClient.ts         main-thread side: holds two position snapshots and interpolates between them
    lookahead.worker.ts  runs the prediction scan on its own thread
    tonight.worker.ts    looks through the next 24 hours for visible passes
    propagate.ts         SGP4 helpers (satellite.js)        protocol.ts   message types
  render/
    scene.ts             renderer, camera, bloom, quality presets
    globe.ts             Earth shader: relief, clouds and their shadows, city lights, atmosphere, close-up detail
    tiles.ts             close-up ground: map tiles streamed from NASA GIBS (Earth) and NASA Trek (Moon, Mars, Mercury), kept in a Map keyed "z/x/y"
    geoOverlay.ts        coastlines and borders, latitude / longitude grid, day / night line
    sky.ts               Milky Way, real bright stars, constellation figures, planets, Sun, Moon
    satellites.ts        all objects as one THREE.Points draw call; GPU-side interpolation; picking
    satModels.ts         procedural 3D models: the 24 kinds found in Earth orbit, building and caching, cropped thumbnails
    modelParts.ts        the kit they are built from: painted textures, shared materials, one helper per part
    observatoryModels.ts  Webb, Euclid, TESS, Chandra, XMM-Newton, SOHO, the solar-wind monitors, STEREO
    deepModels.ts        Voyager, Pioneer, New Horizons, Juno, Lucy, Psyche, BepiColombo, Parker Solar Probe …
    planetaryModels.ts   a lunar orbiter, a Mars orbiter, a rover, a lander, and an asteroid
    constellationModels.ts  Starlink V2 Mini, Amazon Kuiper, Iridium NEXT, O3b, Galileo, GLONASS, GOES-R
    vehicleModels.ts     Shenzhou, Starliner, Orion, Dream Chaser, and the Tesla Roadster with Starman
    missionModels.ts, planetMissionModels.ts  a model for nearly every craft beyond Earth orbit (Gaia, JUICE, the Mars orbiters, the landers …)
    historicModels.ts    the landing sites: Apollo LM (and LRV), Surveyor, Luna, Lunokhod, Yutu, Viking, Pathfinder, MER, Phoenix, Venera, Huygens
    fleetModels.ts       GPS III, BeiDou, Lemur, SDA tranche, HawkEye 360, SkySat, NuSat, Orbcomm, Umbra, Strix, QPS-SAR
    rocketModels.ts      Falcon 9 and Heavy, Starship, Electron, Long March, Soyuz, Atlas V, Vulcan, Ariane 6, New Glenn, a generic launcher
    prewarm.ts           builds the models in idle moments when there is no loading screen to work behind
    cameraRig.ts         fly-to, object-centred focus camera, view presets
    space/spaceView.ts   a scene away from the tracker: one body at true scale ("a place") or the solar system; poses for dissolving between scenes
    space/bodyMesh.ts    one shader for every planet and moon (per-pixel shadows from geometry), the Sun, Saturn's rings
    firstPerson.ts       ride-along and sky-view cameras        siteMarker.ts   the ground-station dot
    constellation.ts     all orbits of a group + ground coverage map   aurora.ts   live aurora oval
    orbitLine.ts  groundTrack.ts  encounterViz.ts  conjunctionMarkers.ts  gridViz.ts  padMarkers.ts
  space/                 beyond Earth orbit; one frame for all of it (ICRF, km, Unix ms):
    types.ts             the shared shapes: Body, Craft, Motion, Flyby, Fireball, DsnLink, Imagery
    bodies.ts            the Sun, eight planets, Pluto and 35 moons: radius, GM, day, year, discovery, temperature, air
    ephem.ts             where each body is and how it is turned; Kepler's equation for ellipses and hyperbolas
    moonOrbits.ts        the fitted orbit of every moon (generated by scripts/make-deep-fixture.mjs --fit)
    sites.ts             the historic landing sites, with the source of each coordinate
    deep.ts              loads public/data/deep.json; where each spacecraft is at any moment
    imagery.ts           each body's map, its streamed tile layer and the picture credits
    dsn.ts               NASA's live Deep Space Network feed           showers.ts   the annual meteor showers
    skyEvents.ts         solar and lunar eclipses, Mercury/Venus transits, Jupiter's moons crossing its face
    rovers.ts            the Mars rovers' driven paths (public/data/rovers.json, from NASA/JPL)
  features/              later additions, each one file installed through the App interface (ui/app.ts):
    radio.ts             last heard, transmitters, Doppler            changes.ts   orbit changes and data age
    weather.ts           space weather and time-left estimates        launches.ts  upcoming launches and pads
    tonight.ts           passes visible tonight (+ tonightWords.ts)   report.ts    close-approach report and CSV (+ reportPage.ts)
    growth.ts            growth by year                               commands.ts  places, times and actions for the search field (+ commandParse.ts)
    flybys.ts            asteroid fly-bys                             fireballs.ts fireballs, marked on the globe
    showers.ts           meteor showers                               dsn.ts       the Deep Space Network, live
    bell.ts              the bell: happening now, ongoing, coming up  ascent.ts    rockets climbing on their estimated paths
  ui/
    inspector.ts         the selected object's four tabs          charts.ts   hand-drawn canvas charts
    monitor.ts           close-approach list (right now)          encounterPanel.ts   one pair in detail
    places.ts            leaving the tracker for another world or the solar system, and back: the moves between
                         scenes, the card about what is being looked at, the list of what is at a place (+ space.css)
    ahead.ts             close passes predicted for the coming hours
    watchlist.ts         starred objects (a Set of NORAD numbers)  tour.ts   first-visit tour
    feed.ts              newest launches, trains, lowest orbits    designer.ts   design-your-own satellite
    constellations.ts    constellation picker                      contacts.ts   ground-station contact timeline
    crew.ts              people in space                           share.ts   QR code and link
    cinema.ts            autopilot tour and video recording        sheet.ts   draggable bottom sheets on phones
    landing.ts           the home page (what it does, how it works)  dom.ts   DOM, number, unit and clock helpers
    featureList.ts       every feature in one list; the home page is drawn from it
    app.ts               the App interface: all a feature module may know about the rest
    objectTabs.ts        the Objects panel's Browse / Activity / Tools tabs
    gallery.ts           the spacecraft catalogue: every model on one page, and one at a time, large
    launch.ts            the loading screen's launch scene         intro.ts   loading progress and hand-over
    howto.ts             the walkthrough page                     hashTrace.ts   one object through the hash
    search.ts            the one search field: objects, types, places, times and actions in one list
    searchMatch.ts       forgiving text matching (case, spacing, misspellings): matchScore
    searchIndex.ts       the keyword hash table behind "telescope": Map<keyword, objects>
    searchObjects.ts     objects by name: hash lookups first, a typo-tolerant vocabulary scan second
    filters.ts  settings.ts  timeControls.ts  labels.ts  benchmarkModal.ts  intro.ts
  mobile.css             phone layout: bottom tab bar and bottom sheets
  main.ts                wires everything together; the per-frame loop
scripts/
  fetch-data.mjs         one-time download of the element snapshot, catalogue facts and textures
  fetch-radio.mjs        SatNOGS radio records into public/data/radio.json
  fetch-deep.mjs         spacecraft beyond Earth orbit, moons, fly-bys and fireballs into public/data/deep.json
  deep-craft.mjs         the table of those spacecraft: names, aliases, launch dates, a sentence each
  horizons.mjs           the one place that talks to JPL Horizons (one request at a time)
  make-deep-fixture.mjs  downloads the reference positions the check compares against and, with --fit, fits the
                         moons' orbits into src/space/moonOrbits.ts (run by hand, rarely)
  build-space-maps.py    how every map in public/textures/space/ was made (run by hand; needs Python with Pillow)
  diff-elements.mjs      compares two element downloads and writes public/data/changes.json
  carry-over.mjs         push builds: keep the data the published site is already showing
  build-borders.mjs      turns the world-atlas map data into public/data/borders.bin
  bench.mjs              the benchmark in Node
  check-*.mjs  decay-check.mjs  test-command.mjs    the feature checks behind `npm run check`
                         (check-deep.mjs: planets, moons, rotation and spacecraft against JPL Horizons)
  shots.mjs              retakes the home page's screenshots
```

Other places hashing is used: every catalogue lookup is a built-in `Map` or `Set` —
`Map<noradId, Satellite>` for search, a prefix index `Map<prefix, ids[]>` for
autocomplete, `Map<category, Set<id>>` for the filter toggles, `Map<noradId, facts>` for
the inspector, a `Map<title, summary>` cache for Wikipedia lookups, a `Set` of starred
NORAD numbers for the watchlist, a `Map<pair, time>` that stops the look-ahead scan
reporting the same pass twice, a `Map<typed name, catalogue name>` so that "hubble" finds
the object filed as HST, a `Map<noradId, radio record>` for the radio details, the
two `Map<noradId, record>` tables that the orbit-change comparison joins, and the
`Map<object, parent>` behind the union–find that groups a station's parts (`groups.ts`).
The search field adds an inverted index (`src/ui/searchIndex.ts`): a `Map<description, topic>`
files every object under what it is (kind, purpose, operator, owner, orbit) in one pass, and a
`Map<keyword, object indices>` built from it answers "telescope" with one lookup and
"chinese weather" by intersecting two sorted lists; `searchObjects.ts` keeps a
`Map<word, objects>` of every word in the names for finding misspellings, and `data/names.ts`
a `Map<catalogue name, full name>` for "Hubble Space Telescope (HST)".

## Data and its limits

- **Source:** [CelesTrak](https://celestrak.org) GP element sets in OMM/JSON format — the
  `active` group plus the debris clouds from Cosmos 2251, Iridium 33, Fengyun-1C and
  Cosmos 1408. `npm run fetch-data` saves them to `public/data/satellites.json` with a
  `fetchedAt` timestamp. CelesTrak updates about every two hours and asks clients not to
  re-download more often; the script refuses to (unless `--force`) and the app never polls.
  **Display → Refresh live data** makes one manual attempt and silently keeps the snapshot
  if it fails.
- **Positions are predictions, not telemetry.** Each position is computed by the SGP4
  model from published orbital elements. Accuracy is roughly a kilometre near the element
  epoch and degrades over days, so a listed "2 km approach" is an estimate. Re-run
  `fetch-data` before a demo for fresh elements.
- **Catalogue facts** (owner, launch date and site, object type, radar size) come from
  CelesTrak's SATCAT, saved by `npm run fetch-data` to `public/data/satcat.json`. The file
  is optional; without it those rows show a dash.
- **Aurora, geomagnetic activity and station crews** are fetched live when used (NOAA Space
  Weather Prediction Center and a public crew list); offline, those features stay empty.
- **Nobody can "ping" a satellite.** "Last heard" and the transmitter lists come from
  [SatNOGS](https://satnogs.org), a volunteer ground-station network (Libre Space Foundation,
  CC BY-SA). A copy of its records is saved when the site is built (every 6 hours), so the
  page never calls SatNOGS itself. It covers only the newest few hours of reports, and
  stations listen only to what somebody scheduled: an object with no report was not picked
  up in that window, which is not the same as being silent. The Doppler figures are geometry.
- **Upcoming launches** come from Launch Library 2 (The Space Devs), asked only when the
  section is opened and kept for an hour. Launch times are "no earlier than" and slip.
- **Orbit changes are inferences.** "Raised", "lowered" and "tilted" mean the elements moved
  by more than air drag and measurement noise explain between two downloads. That is a
  possible manoeuvre, not a confirmed one. The thresholds have been checked on synthetic
  cases, not yet against a long run of real data.
- **Time left in orbit is rough.** It comes from each object's own sinking rate and today's
  solar activity; it could easily be half or double, and a thruster changes it at will.
- **Visible passes use estimated brightness.** A pass is listed when the satellite is in
  sunlight, the ground is dark and the object is well above the horizon; the magnitude is
  an estimate from size and distance, not a measurement.
- **Growth by year counts what is still in orbit today**, not everything ever launched, and
  a fragment carries the launch year of the object it came from.
- **Close-up ground imagery** is NASA's Blue Marble (shaded relief and bathymetry), streamed
  as map tiles from the public GIBS service only while the camera is within about 6,000 km of
  the ground. Its finest level is roughly 600 m per pixel, so cities and coastlines sharpen
  but individual streets never appear. It shows no clouds, so the globe's cloud layer fades
  out underneath it. It works on the night side too: close to the ground the land is shown
  in brighter moonlight than is realistic (otherwise there would be nothing to see), with the
  city lights smoothed into a glow on top. Offline, or with the setting off, the globe's own
  picture is used. About → "This device" says how many detailed tiles are on screen.
  A coarser layer is loaded first and the sharp one fades in over it, the edges of the detailed
  area fade into the globe, and tiles are fetched ahead of a moving camera, so the loading is
  rarely seen.
- **Close-up ground at the Moon, Mars and Mercury** comes the same way from NASA's Solar
  System Treks: the Lunar Reconnaissance Orbiter's wide-angle mosaic (about 100 m per pixel),
  the Viking orbiters' colour mosaic of Mars (232 m) and MESSENGER's of Mercury (166 m). These
  are photographs taken with the Sun low, so their shadows do not move with the clock, and
  their tone is adjusted to match the globe they are laid over. Near the Moon's poles the
  mosaic is coarse.
- **Name tags appear as you zoom.** The whole-Earth view names only the ISS, Tiangong, Hubble
  and your watchlist; closer in, well-known spacecraft and then the nearest objects are named
  (Layers → Names: Off / Well-known / As you zoom).
- **Operator logos** beside names are loaded from each operator's Wikipedia article, not
  stored here, and only when the article's picture really is a logo (transparent
  background); they are trademarks of their owners, shown only to identify the operator.
- **The Moon is drawn four times its true size** so it can be found; its position is real.
- **Photos and descriptions** come from Wikipedia, fetched when an object is selected. An
  object is matched to the article for its programme (a Starlink satellite shows the
  Starlink article's picture), so the photo shows that kind of spacecraft, not necessarily
  that exact one. An object no programme in the table claims has its own name tried once as
  an article title; an article is only accepted if it reads like one about something in
  space. This needs a network connection; offline, the 3D model is shown instead, and the
  link under the name still goes to the article or to Wikipedia's search.
- **Operator, purpose and 3D model are inferred from the object's name** against a table
  of well-known programmes. The models are one representative shape per kind of object,
  not replicas of individual spacecraft, and are drawn far larger than life so they are
  visible. Long booms are drawn shorter than life (Voyager's is 13 m on a 3.7 m dish), and
  the craft beyond Earth orbit are posed to be looked at, not turned towards the real Sun.
- **Coastlines and borders** are Natural Earth data via the `world-atlas` package.
- **Beyond Earth orbit, positions are computed, not downloaded live.** The planets come from
  JPL's "approximate positions" elements, the Moon from a 70-term series, and 34 other moons
  (every one JPL can place that is round or well known, from Phobos to Pluto's Hydra) from
  orbits fitted to sixty years of JPL positions, including the slow dances a plain ellipse
  misses: Mimas swinging 44° either way over seventy years, Janus and Epimetheus trading
  orbits every four. `npm run check` compares all of it with JPL Horizons on twelve dates
  from 2024 to 2030: planets within 0.08° of direction and 0.1 % of distance (Saturn is the
  worst), the Moon within 0.005°, the other moons within 1.3° (Himalia, which the Sun keeps
  pulling about; most are within a tenth of a degree), and the pole and prime meridian of
  all 36 bodies that have a rotation model within 0.1°. Nine moons have none: Hyperion
  tumbles unpredictably, and the spin of the smallest is not known well enough; they are
  drawn keeping one face to their planet. Outside 1800–2050 the planet table is not valid,
  and outside 1996–2056 the moons' orbits are extrapolated.
- **Spacecraft beyond Earth orbit** (`public/data/deep.json`) are placed from
  [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) when the site is built (every 6 hours):
  an orbit about the body each one circles, a run of positions for the craft round the L1 and
  L2 points, or a landing site. At the moment of the download they are exact. Afterwards an
  orbit is carried forward by Kepler's equation: good for decades for the Voyagers, for
  weeks on a cruise between planets (until the next engine burn or fly-by), and for orbiters
  at the Moon, Mars and Jupiter within about a degree for a week, using turning rates
  measured from Horizons. A sampled path is held at its last position beyond its end. Rovers
  and landers are fixed at one place; several of the landers are long silent.
- **Asteroid fly-bys and fireballs** are from NASA/JPL's Center for Near Earth Object Studies,
  saved with the same build. A fly-by's distance is the nominal one and can shift as the
  orbit is refined; sizes are estimated from brightness, so they are ranges. Fireball reports
  are published weeks late and only for events the sensors happened to see.
- **Meteor shower rates are the textbook best case** (dark sky, radiant overhead); a real
  count is usually a third to a half. Peaks are computed from the Sun's longitude and are
  good to an hour or two; a shower can still surprise.
- **The Deep Space Network list** is NASA's own live feed (eyes.nasa.gov/dsn), read once when
  the page starts and then each minute only while the list is open. It shows NASA's network
  only: a craft talking to ESA's or China's dishes is not listed.
- **Maps of other worlds** are NASA mosaics (public domain) where a surface has been mapped:
  Mercury, Venus by radar, the Moon, Mars and Phobos, Io, Europa, Ganymede, Callisto, eight
  moons of Saturn (Mimas, Enceladus, Tethys, Dione, Rhea, Titan, Iapetus, Phoebe), five of
  Uranus (Miranda, Ariel, Umbriel, Titania, Oberon), Triton, Pluto and Charon; close up,
  sharper tiles are streamed from NASA's Solar System Treks for fourteen of them. The Sun,
  Jupiter, Saturn and its rings, Uranus, Neptune and the clouds of Venus are the "Solar System
  Scope" textures (CC BY 4.0), which are artist-finished from NASA imagery. Fourteen small
  moons have no map and are plain balls of their own colour. **What no camera has seen is
  not invented:** Pluto's and Charon's south, a third of Triton, a quarter of Phoebe and the
  northern halves of all five moons of Uranus were in darkness when the one spacecraft
  passed, and those parts of the maps are a single flat tone. Titan's map is one infrared
  colour, tinted here; Mimas and Rhea are NASA's colour maps shown in grey, because their
  colours are exaggerated beyond what an eye would see. On the gas giants longitude is not
  tied to anything visible. `src/space/imagery.ts` lists the source and licence of every file.
- **Facts on the cards** (who found a moon and when, how cold it is, when a craft arrived,
  what it weighed at launch) are filled in only where NASA's fact sheets, JPL's own record
  of the mission or the agency's press kit gives one answer; where sources disagree the line
  is left off. Landing-site coordinates are NASA's measurements from orbit where the
  hardware has been found (`src/space/sites.ts` names the source of each).

## Limitations

- **Snapshot screening, not conjunction analysis.** OrbitHash checks where everything is
  at one instant. Real operators screen a whole time window (days ahead), find the time of
  closest approach for each candidate pair and compute a collision probability from
  position uncertainty. Two objects that pass close *between* two ticks are not reported.
- **Many "close pairs" are intentional:** docked spacecraft, formation-flying pairs such
  as TerraSAR-X / TanDEM-X, and co-located geostationary satellites. The monitor separates
  them by relative speed: under 100 m/s a pair is listed as "flying together", not as an
  approach. That threshold is a rule of thumb, not a standard.
- **Cell size is tied to `d`.** That is what makes the 27-cell argument work, but a very
  large `d` puts many objects in each cell and the method slides towards O(n²).
- The grid covers ±65,536 cells per axis; coordinates beyond that are clamped to the edge
  cell (correct, just more crowded). It never happens for Earth orbits at `d` ≥ 1 km
  except for a few very distant objects.
- Between worker snapshots (~3 per second) drawn positions are interpolated, so at 1000×
  speed markers can sit a few km from the exact SGP4 position. Screening, the selected
  object and the close-approach view always use exact positions.
- **The closest point is searched only ±10 minutes** around the moment a pair was listed,
  and pass predictions cover the next two days at 20-second resolution.
- **Predicted passes are only as good as the elements.** Orbital elements a day old can be
  several kilometres off along the orbit, so a predicted 100 m pass means "these two orbits
  cross closely around then", not that a collision is likely. Real operators manoeuvre and
  screen with far more precise data. The scan assumes no pair closes faster than 16 km/s,
  leaves out pairs that fly together, and lists the closest 250.
- **Your location** is used only after you say yes in Apsis and then in the browser's own
  prompt, is stored only in your browser, and is never put in a share link.
- **A designed satellite** exists only in your browser for that visit, has no drag, and is
  screened against predicted positions like everything else.
- The "over" place names are coarse (ocean or continent), from a short table of regions.
