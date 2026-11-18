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
```

The data snapshot and textures live in `public/`, so the app runs **offline** (only the
Wikipedia photos need a connection). Fonts are
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
| Inspect an object | click a dot, or search by name / NORAD ID (press `/`; suggestions show a photo or a 3D-model thumbnail). The camera flies to the object and locks on: dragging now turns the view around **it**, not the Earth (`T` unlocks) |
| Inspector tabs | **Live** telemetry, ground-track map, altitude chart · **Orbit** shape to scale, orbital elements, speed and sunlight charts · **Passes** over your ground station with a sky chart · **Record** owner, launch, size, a Wikipedia summary and the raw element record |
| Objects panel (`O`) | filter by type, orbit regime, altitude band; colour by type, orbit, altitude, owner, launch year or tilt; labels, marker size; shortcuts to notable objects |
| Layers panel (`L`) | orbit path, ground track, coverage footprint, 3D model; ground-station marker, clouds, atmosphere, coastlines and borders, lat/long grid, day/night line; stars, constellations, planets, names in the sky; screening cells (`G`) |
| Close-approach monitor (`C`) | **Right now**: switch it on, set the alert distance; the list shows every pair inside it. **Coming hours**: scan up to 24 hours ahead for predicted close passes. Click any pair to open the **close-approach view** (time keeps running live; the panel's replay and scrubber give a slow-motion or frozen look): both spacecraft as 3D models, their flight paths, the live distance between them, a range chart you can scrub, and a slow-motion replay |
| Ride along (`V`) | from the inspector: sit on the selected object and look out from it. Drag to look around, scroll to zoom |
| Sky view (`4`) | the **Sky** button at the foot of the rail: stand at the ground station and watch objects cross overhead |
| Your location | Apsis asks once whether it may show where you are; the crosshair button in the top bar does the same at any time. Only after a yes does the browser's own permission prompt appear. You are then a green dot, and passes and the sky view use that spot |
| Watchlist (`S`) | star an object in the inspector; it stays in the Objects panel and keeps its name tag on the globe |
| Share | the link button in the top bar copies an address that reopens the same object, close approach, time or camera position |
| Tour | offered on the first visit and always available from the controls sheet (`?`) |
| Autopilot (`A`) | a hands-free cinematic tour of the view; any key or click stops it |
| Record (`M`) | saves a video of the 3D view (with captions) to your downloads |
| Launch and re-entry feed | Objects panel: **Newest in orbit** (grouped by launch), **Satellite trains** (recent batches still flying in a line; click to light one up) and **Lowest orbits** (next to come down) |
| Constellations | Objects panel: pick GPS, Starlink, Iridium and so on to draw all its orbits and a live map of how many of its satellites can see each point on the ground |
| Aurora | Layers → Earth: tonight's aurora oval from NOAA's forecast, with the current geomagnetic activity |
| People in space | who is aboard the ISS and Tiangong right now, in those stations' Record tab |
| Contact timeline | Watchlist → **Contact timeline**: when each of several ground stations can see each starred object over the next 24 hours |
| Point your phone | in the Sky view on a phone, **Use phone motion** aims the view wherever the phone points |
| Design a satellite | Objects panel: choose an orbit, launch your own object into the live catalogue, and check what it will pass close to in the next 24 hours |
| Time | the bar at the bottom: drag the timeline to move up to 12 hours either way, pause (`Space`), 1× – 1000×, run backwards (`R`), step 10 minutes (`[` `]`), **Now** (`N`), or click the clock to type a date |
| Views | `1` `2` `3`, or the three buttons at the foot of the tool rail. Left alone, a whole-Earth view drifts slowly around the planet (Layers → Earth to switch off) |
| Settings (`,`) | rendering quality, ground-station location, download current elements |
| How it works | the button in the top bar: a walkthrough of the screening algorithm with a live trace, live hash-table statistics, the look-ahead method and the benchmark |
| Phones | below 760 px the layout becomes a map-style app: a floating search field with view chips under it, round buttons on the right edge, a floating four-tool tab bar, and rounded sheets you can drag to any height or flick open and shut. It can be added to the home screen and then runs full screen like an app |
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
and deploys on every push to `main`, and every 8 hours it first downloads fresh orbital data
from CelesTrak (which asks for no more than one download every 2 hours). The refreshed data
is published but not committed, so the repository stays small; if CelesTrak cannot be
reached, the snapshot in the repository is published instead. In the repository settings,
Pages must be set to deploy from **GitHub Actions**.

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
  data/
    catalog.ts           loads the snapshot; builds the Map/Set indexes (by NORAD id, name, prefix, category, orbit)
    categorize.ts        category + orbit class (LEO / MEO / GEO / HEO) from name and mean motion
    describe.ts          operator / purpose / model shape, inferred from the name
    ephemeris.ts         orbit maths for one or two objects: sampled orbit, look angles, passes, closest approach
    satcat.ts            catalogue facts (owner, launch, size) in a Map keyed by NORAD id
    wiki.ts              name → Wikipedia article; fetches the summary and lead photo on demand
    regions.ts           rough place name under a latitude / longitude
    types.ts
  worker/
    sim.worker.ts        Web Worker: SGP4 propagation, screening, benchmark
    SimClient.ts         main-thread side: holds two position snapshots and interpolates between them
    lookahead.worker.ts  runs the prediction scan on its own thread
    propagate.ts         SGP4 helpers (satellite.js)        protocol.ts   message types
  render/
    scene.ts             renderer, camera, bloom, quality presets
    globe.ts             Earth shader: relief, clouds and their shadows, city lights, atmosphere, close-up detail
    geoOverlay.ts        coastlines and borders, latitude / longitude grid, day / night line
    sky.ts               Milky Way, real bright stars, constellation figures, planets, Sun, Moon
    satellites.ts        all objects as one THREE.Points draw call; GPU-side interpolation; picking
    satModels.ts         procedural 3D models (20 kinds of spacecraft)
    cameraRig.ts         fly-to, object-centred focus camera, view presets
    firstPerson.ts       ride-along and sky-view cameras        siteMarker.ts   the ground-station dot
    constellation.ts     all orbits of a group + ground coverage map   aurora.ts   live aurora oval
    orbitLine.ts  groundTrack.ts  encounterViz.ts  conjunctionMarkers.ts  gridViz.ts
  ui/
    inspector.ts         the selected object's four tabs          charts.ts   hand-drawn canvas charts
    monitor.ts           close-approach list (right now)          encounterPanel.ts   one pair in detail
    ahead.ts             close passes predicted for the coming hours
    watchlist.ts         starred objects (a Set of NORAD numbers)  tour.ts   first-visit tour
    feed.ts              newest launches, trains, lowest orbits    designer.ts   design-your-own satellite
    constellations.ts    constellation picker                      contacts.ts   ground-station contact timeline
    crew.ts              people in space                           share.ts   QR code and link
    cinema.ts            autopilot tour and video recording        sheet.ts   draggable bottom sheets on phones
    launch.ts            the loading screen's launch scene         intro.ts   loading progress and hand-over
    howto.ts             the walkthrough page                     hashTrace.ts   one object through the hash
    filters.ts  search.ts  settings.ts  timeControls.ts  labels.ts  benchmarkModal.ts  intro.ts
  mobile.css             phone layout: bottom tab bar and bottom sheets
  main.ts                wires everything together; the per-frame loop
scripts/
  fetch-data.mjs         one-time download of the element snapshot, catalogue facts and textures
  build-borders.mjs      turns the world-atlas map data into public/data/borders.bin
  bench.mjs              the benchmark in Node
```

Other places hashing is used: every catalogue lookup is a built-in `Map` or `Set` —
`Map<noradId, Satellite>` for search, a prefix index `Map<prefix, ids[]>` for
autocomplete, `Map<category, Set<id>>` for the filter toggles, `Map<noradId, facts>` for
the inspector, a `Map<title, summary>` cache for Wikipedia lookups, a `Set` of starred
NORAD numbers for the watchlist, and a `Map<pair, time>` that stops the look-ahead scan
reporting the same pass twice.

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
- **Operator logos** beside names are loaded from each operator's Wikipedia article, not
  stored here; they are trademarks of their owners, shown only to identify the operator.
- **The Moon is drawn four times its true size** so it can be found; its position is real.
- **Photos and descriptions** come from Wikipedia, fetched when an object is selected. An
  object is matched to the article for its programme (a Starlink satellite shows the
  Starlink article's picture), so the photo shows that kind of spacecraft, not necessarily
  that exact one. This needs a network connection; offline, the 3D model is shown instead.
- **Operator, purpose and 3D model are inferred from the object's name** against a table
  of well-known programmes. The models are one representative shape per kind of object,
  not replicas of individual spacecraft, and are drawn far larger than life so they are
  visible.
- **Coastlines and borders** are Natural Earth data via the `world-atlas` package.

## Limitations

- **Snapshot screening, not conjunction analysis.** OrbitHash checks where everything is
  at one instant. Real operators screen a whole time window (days ahead), find the time of
  closest approach for each candidate pair and compute a collision probability from
  position uncertainty. Two objects that pass close *between* two ticks are not reported.
- **Many "close pairs" are intentional:** docked spacecraft, formation-flying pairs such
  as TerraSAR-X / TanDEM-X, and co-located geostationary satellites. Pairs under 100 m are
  counted and drawn but left out of the list, because they are parts of one station.
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
