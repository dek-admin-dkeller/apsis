# Apsis (repository name: OrbitHash) — guide for an AI agent or a new developer

Read this first. `README.md` is the user-facing description (features, the hashing
explanation, limits); this file is how the project is put together and how to work on it.

## What this is

A static, no-backend web app that shows every tracked object in Earth orbit (~19,500) on a
3D globe and screens them for close approaches in real time. It began as a university
algorithms project on **hashing**: the core algorithm is a 3D spatial hash grid
(`src/hashing/SpatialHash.ts`). The app presents itself as **Apsis**; "OrbitHash" is the
project/package name. Live site: GitHub Pages, deployed by `.github/workflows/deploy.yml`.

Hard constraints that came with the project (keep them):

- Vite + TypeScript (strict), **vanilla** — no React or other UI framework. Libraries:
  `three` (+ `examples/jsm`), `satellite.js` (SGP4), `qrcode-generator`, bundled fonts.
- Hash tables are built-in `Map` / `Set`; the hash function and grid logic are hand-written.
- Heavy work runs in Web Workers. The main thread only renders and handles input.
- **Be polite to CelesTrak**: download once, never poll. `scripts/fetch-data.mjs` refuses to
  re-download orbital data younger than 2 hours; the app itself only fetches CelesTrak when
  the user presses "Download current elements".
- The code must be presentable in a class walkthrough: small modules, a header comment in
  every file saying what it is for, comments that explain *why*. `SpatialHash.ts` is
  standalone and heavily commented on purpose.
- `npm run bench` must always report identical results for hash vs brute force.

## Commands

```bash
npm install
npm run dev          # Vite dev server on http://localhost:5173
npm run build        # tsc --noEmit && vite build → dist/   (must pass with zero TS errors)
npm run bench        # brute force vs hash, look-ahead completeness; exits 1 on any mismatch
npm run fetch-data   # textures + CelesTrak elements + SATCAT facts into public/ (2 h / one-day guards)
npm run fetch-radio  # SatNOGS radio records into public/data/radio.json (5.5 h guard; also run by CI)
npm run fetch-deep   # JPL Horizons + CNEOS into public/data/deep.json and scripts/fixtures/deep-reference.json (5.5 h guard; also run by CI)
npm run shots        # retake the home page's product pictures (needs Chrome and the dev server running)
npm run build-borders  # regenerate public/data/borders.bin from the world-atlas package
npm run check        # the feature checks (orbit changes, visible passes, report, decay, search, groups, and the
                     # solar system against JPL Horizons: check-deep prints the worst errors); exits 1 on a failure
```

Node ≥ 22.18 (the bench imports `.ts` files directly; `erasableSyntaxOnly` keeps that legal).

## TypeScript conventions

- `strict`, `noUnusedLocals`, `erasableSyntaxOnly` (no enums, no constructor parameter
  properties), imports written **with the `.ts` extension**.
- DOM access through `$('id')` from `src/ui/dom.ts`; number formatting with `fmt`, `fmtInt`,
  `fmtCompact`. Time helpers `utcStamp`, `clockStamp`, `zoneLabel`, `duration` live in
  `src/ui/inspector.ts`.
- **Units and clock.** The simulation is km, km/s and UTC everywhere. Text shown to the user
  must go through `fmtKm`, `fmtRange`, `fmtKmS`, `fmtSlow`, `lengthUnit`/`lengthValue`
  (`dom.ts`), `alertDistance` and `clockStamp` (`inspector.ts`) so the Settings choice
  (kilometres/miles, UTC/local) applies. Never write `` `${x} km` `` by hand. The exceptions,
  left metric on purpose: the walkthrough and hash trace (the cell size d is defined in km),
  the benchmark, the raw element record. Panels that only redraw on demand expose
  `refreshUnits()`, called from `applySettings()`.
- A UI module owns its DOM ids and exposes a small class; `src/main.ts` creates every module
  and wires them with callbacks ("host"/"handlers" objects). Modules do not import `main.ts`.
- CSS: `src/style.css` (desktop, design tokens on `:root`), `src/mobile.css` (≤ 760 px and
  touch; later sections override earlier ones — section 6 is the current phone look), and a
  few feature stylesheets imported by their own module (`tour.css`, `cinema.css`,
  `designer.css`, `constellations.css`, `contacts.css`, `crew.css`, `firstPerson.css`,
  `launch.css`, `gallery.css`).
- Shaders: a NaN anywhere becomes black squares after the bloom pass. Never `pow()` a
  possibly negative base, never `smoothstep` with reversed edges (write
  `1.0 - smoothstep(lo, hi, x)`), guard `normalize(0)` / `atan(0,0)` / divisions, clamp output.

## Coordinate frames (the thing most likely to trip you up)

- Simulation frame = **ECI/TEME**, kilometres, z = north. SGP4 outputs this.
- Scene frame: `kit.eciGroup` has `rotation.x = −π/2` and `scale = 0.001`, so ECI
  `(x, y, z)` km → scene `(x, z, −y)`, **1 scene unit = 1,000 km**, north = +Y. Put anything
  expressed in ECI km inside `eciGroup` and never convert by hand.
- The Earth mesh (`globe.earth`, radius 6.371) rotates about Y by GMST each frame. A ground
  point at latitude φ, longitude λ is at Earth-local `(R cosφ cosλ, R sinφ, −R cosφ sinλ)`.
  Things fixed to the ground are children of `globe.earth`.
- The Sun direction is `globe.sunDirection` (scene frame).

## Data flow

```
public/data/satellites.json (CelesTrak GP/OMM, 13 fields + GROUP)      public/data/satcat.json (optional facts)
        │ data/catalog.ts: buildCatalog → Satellite[] + Map/Set indexes         │ data/satcat.ts → Map<noradId, facts>
        ▼
worker/sim.worker.ts  ── propagate {t} → Float32Array positions (transferred) ──► worker/SimClient.ts
        │                 screen {t, d, mask} → pairs + hash stats                 keeps snapshots A and B (0.3 s apart),
        │                 benchmark                                                `alpha` interpolates; same maths on GPU
        ▼
render/satellites.ts: ONE THREE.Points draw call; vertex shader mixes A→B
worker/lookahead.worker.ts: started on demand for the "Coming hours" scan (hashing/lookahead.ts)
```

- `SimClient.getPosition(i, out)` gives the interpolated ECI km position of object `i`
  (what is drawn). Exact single-object maths (selected object, close-approach view, passes)
  uses SGP4 directly on the main thread via `src/data/ephemeris.ts`.
- `clock` in `main.ts` is `{ time (Unix ms), speed, paused }`; any jump in time must go
  through `jumpTo()` (it calls `sim.reset()`). The autopilot runs scenes at 100× and 1000× and
  now puts the clock back to the present when it stops (it used to leave it hours ahead, and
  the owner read that as "the time is still off"); whenever the clock is not the present its
  figures are amber (`.timebar.is-shifted`). At normal speed `advanceClock()` follows the
  COMPUTER'S clock rather than summing frame times: a background tab or a locked phone draws
  no frames, and the sum used to come back minutes behind the present (the owner saw the clock
  "off"). Times are shown in the browser's local time unless Settings says UTC (the default
  was UTC and read as a wrong local time; `Settings.defaults` moves old saves over once).
- A user-designed satellite is appended to the snapshot (`customRecord`) and the catalogue
  is rebuilt with `rebuildCatalog()`; its NORAD id is 99001.

## The algorithms (what the class project is about)

- `hashing/SpatialHash.ts`: cell size = screening distance `d`; cell coordinate
  `floor(v/d) + 2^16`; key `(ix·R + iy)·R + iz` with `R = 2^17` (< 2^53, exact); 27-cell
  neighbour query.
- `hashing/conjunction.ts`: `bruteForcePairs` and `hashedPairs`, same sorted output.
- `hashing/lookahead.ts`: prediction. Every 60 s of simulated time hash with cells of
  `d + 16 km/s × 30 s`, solve the straight-line closest approach `t* = −(r·v)/|v|²` for each
  candidate, refine survivors with SGP4 + golden section. Optional `focus` index restricts it
  to pairs involving one object (used by the satellite designer).
- `hashing/benchmark.ts` + `scripts/bench.mjs`: timing and identical-result checks.
- Passing vs flying together: the worker gets each object's velocity from the same SGP4 call
  as its position and labels every pair by relative speed (`TOGETHER_KM_S` = 0.1 km/s in
  `conjunction.ts`). `ScreenStats.passing` / `.together` are the true totals; the pair arrays
  are capped per kind. Globe markers, the top-bar count and the autopilot use passing only.
- `hashing/groups.ts`: union–find with a `Map` as the parent table. The monitor uses it to merge
  pairs closer than `DOCKED_KM` (100 m, `ui/monitor.ts`) and not drifting apart back into
  spacecraft: the Space Station is 11 catalogued objects at one place, which screening reports
  as 55 pairs at "0 m". Each such spacecraft is ONE row in "Flying together", under a "Joined"
  heading apart from the pairs that really are two things ("Separate"), and choosing it
  (or any pair that `joinedNow()` in `main.ts` finds to be joined) selects the spacecraft
  instead of opening a close-approach view — that view showed one model and "0 m", which the
  owner reported as a bug. `scripts/check-groups.mjs` tests it.
- `render/gridViz.ts` has a pair mode (`PairCells`): with a close approach open it draws the
  two objects' cells, A's 27-cell block, and turns both red while range < d.
- Other hash tables are listed in the README ("Other places hashing is used").

## Source map

```
src/main.ts                 creates every module, per-frame loop, keyboard, share links, home/reset
src/data/                   freshness (a tab left open takes the newer data files the site has published: see
                            "A tab left open"), catalog, categorize, describe (operator/purpose/model kind from the name), ephemeris
                            (orbit series, look angles, passes, closest approach), satcat, wiki (name → article, link),
                            names (displayName: "Hubble Space Telescope (HST)"), spacecraft (a sentence about each model kind, for the catalogue),
                            regions ("over the South Pacific"), crew (people in space), types; and for the feature
                            modules: radio + doppler (SatNOGS records, Doppler shift), changes (compare two downloads),
                            decay + spaceWeather (time left, NOAA flux and Kp), launches (Launch Library 2), visibility
                            (bright passes), approachData (report numbers), places (cities the search can fly to)
src/hashing/                SpatialHash, conjunction, lookahead, benchmark, groups (union–find)
src/worker/                 sim.worker (+ SimClient, protocol, propagate), lookahead.worker, tonight.worker (visible passes)
src/render/                 space/spaceView + space/bodyMesh (the scenes away from the tracker; see "Places"),
                            scene (renderer, bloom, quality presets, the dissolve between scenes), globe (Earth shader), tiles (close-up ground:
                            NASA GIBS map tiles streamed in below ~6,000 km), geoOverlay (borders, grid, terminator), sky (Milky Way, stars, constellations, planets, Sun, Moon), aurora, satellites
                            (the point cloud, colour modes, highlighting, picking), satModels + modelParts + observatoryModels +
                            deepModels + planetaryModels + constellationModels + vehicleModels + rocketModels (72 procedural models: see "3D models"; satModels also holds the
                            previews, thumbnails), prewarm (models built in idle slices from the home page), cameraRig (fly-to, object focus, Earth drift), firstPerson (ride-along,
                            sky view, phone motion), orbitLine, groundTrack, encounterViz (close-approach drawing),
                            conjunctionMarkers, gridViz, constellation (orbits + coverage map), siteMarker, padMarkers
src/space/                  beyond Earth orbit (see "Beyond Earth orbit"): types (the contract), bodies, ephem (positions,
                            rotation, Kepler), deep (deep.json, craft positions), imagery (maps, tile layers, credits),
                            dsn (live Deep Space Network), showers (annual meteor showers)
src/features/               optional modules installed through the App interface (see "Feature modules"): radio, changes,
                            weather, launches, tonight (+ tonightWords), report (+ reportPage), growth, commands (+ commandParse),
                            flybys, fireballs, showers, dsn (the four share beyond.css)
src/ui/                     places (+ space.css: the moves between the tracker, another world and the solar system; see "Places"),
                            placeWatch (the close-approach monitor of another world),
                            app (the App interface), featureList (every feature, drawn on the home page), objectTabs (the
                            Objects panel's three tabs), inspector (+ charts), monitor (live pairs), ahead (prediction), encounterPanel, howto
                            (walkthrough), hashTrace, benchmarkModal, filters, search (+ searchMatch, searchIndex,
                            searchObjects: see "The search field"), settings, timeControls, labels,
                            watchlist, feed (launches, trains, lowest), designer, constellations, contacts, crew,
                            gallery (the spacecraft catalogue), share (QR), tour, cinema (autopilot + recording), sheet (phone sheets), landing (welcome
                            page), launch + intro (loading screen), dom (DOM, number, unit and clock helpers)
index.html                  all static markup; ids are the contract between HTML and the ui modules
scripts/                    fetch-data.mjs, fetch-radio.mjs, fetch-deep.mjs (+ deep-craft.mjs, horizons.mjs), diff-elements.mjs
                            (writes changes.json), carry-over.mjs (push builds keep the published data), build-borders.mjs,
                            bench.mjs, shots.mjs, make-deep-fixture.mjs and build-space-maps.py (both run by hand), and the
                            checks behind `npm run check`: check-changes, check-visibility, check-report, decay-check,
                            test-command (the search: grammar, matching, keyword index), check-groups, check-deep (fixtures/ holds its two reference files)
public/                     data/ (satellites.json, satcat.json, radio.json, deep.json, borders.bin; changes.json exists only
                            in the published site), shots/, textures/ (space/ = the maps of other bodies), icons/,
                            manifest.webmanifest
.github/workflows/deploy.yml  build + deploy to Pages; every 3 h it refreshes CelesTrak, SatNOGS and JPL data first (not
                            committed back); a push build keeps the data the site already shows (carry-over.mjs)
```

## UI structure (desktop)

Home page first (`#landing`, `src/ui/landing.ts`, `landing.css`): static markup painted before
any script, with the tracker loading behind it. It is built to SHOW the tracker, not describe
it (the owner found a text-only page bland):
- **Opening screen:** the LIVE globe shows through it as early as possible. `boot()` calls
  `landing.goLive()` (the page's backdrop fades, `is-live`) as soon as the Earth's day map and
  water mask have arrived (`globeReady`, about 2 MB), not when everything has: the catalogue,
  the first positions and the heavy textures (clouds, night lights, terrain) follow behind the
  page, the objects appearing when they are ready and the clouds and lights fading in
  (`render/globe.ts`, "Loading order"). `landing.ready()` then writes the status line and
  allows the plate to be drawn. The globe is held closer than the home view and moved beside
  the headline by `updateViewShift()` (`heroShift`). Until there is a globe, and without WebGL,
  the headline stands alone on a plain dark backdrop: **nothing but the live globe animates on
  the opening screen** (an orbit drawing used to; it stuttered during loading and the owner had
  it removed. The globe only drifts slowly, and `boot()` yields a frame between its heavy
  steps). The owner asked for this order ("the globe as fast as possible, then load in the
  background"); measured on a throttled connection it roughly halves the wait for the picture.
  While the page is up `body.home-open` hides the tracker's controls, shortcuts are off, and
  the globe is drawn every frame only while the opening screen is in view.
- **Going in early:** the loading screen (`#loading`, the rocket) is set aside
  (`loading.setAside`, `display: none`) while the globe shows through the page, but its
  progress is kept up to date. If the visitor presses "Open the tracker" before everything is
  ready it comes back with that real progress, lifts off when loading finishes, and the
  tracker opens as it does from a share link. Opened straight into the tracker nothing has
  changed: the loading screen stays until every texture and the first positions are in.
- **No loading screen to work behind:** from the home page the 3D models and the tile shader
  are made ready by `prewarmInIdle()` (`render/prewarm.ts`): one model per idle moment, and
  only while `landing.quiet` (not touched, not just scrolled). `index.html` preloads the day
  map and the water mask so they start downloading with the page (not the catalogue: that
  was measured, and it delayed the globe).
- **The bar at the top is not inside the element that scrolls.** `#landing` is a fixed flex
  column: `.ld-top`, then `#landing-scroll` (`.ld-scroll`, `overscroll-behavior: none`). With
  the bar `position: sticky` inside the scroller, the elastic bounce past the top of the page
  pulled it away from the top edge. `landing.ts` passes a wheel turned over the bar on to the
  scroller and sets `is-scrolled` once the page has moved.
- **The bar has two states and one height** (`--ld-bar`, 60 px at every width). At the very
  top of the page it is CLEAR over the live globe; what keeps it legible on a sunlit cloud is
  a soft shade, darkest along the top edge and gone three bar-heights down (`.ld-top::before`),
  with its words in full ink and a small text shadow. Once the page has moved it is SOLID with
  a hairline. The change takes 180 ms. Do not bring back a tinted or frosted slab: the owner
  disliked "its opacity" (it drew a hard line across the planet and washed the grey links out),
  and the blur it leaned on never reached the built site (see "Performance notes": the build
  drops unprefixed `backdrop-filter`). Until there is a globe, `.ld-top::after` stands in as
  the same dark backdrop the opening screen has and fades with it.
- **Showcase:** real screens in `public/shots/*.webp`, listed in `SHOTS` (`featureList.ts`).
  Retake them with `npm run shots` (`scripts/shots.mjs`: headless Chrome driven over the
  DevTools protocol against the running dev server) whenever the interface changes visibly.
  The tabs advance by themselves every 5 s like a slideshow. The timer IS the thin progress
  line on the active tab (a CSS animation, `ld-tab-progress`; its `animationend` moves on), so
  pausing is one class: it runs only while the picture is on screen and the page visible,
  pauses under the pointer, a finger or keyboard focus, leaves a screen the visitor chose
  alone for 20 s, and never runs with "reduce motion". It must not change the page's length:
  on a wide screen the figure's height is held while the phone picture shows; on a narrow one
  the slideshow passes over the phone picture (its tab still shows it).
- **How it works:** `src/ui/hashDemo.ts`, a 2D canvas that files dots in the real
  `SpatialHash` and draws either every pair or only the neighbours the table offers.
- **Spacecraft plate:** `modelThumbnail()` for six kinds (`PLATE` in `landing.ts`; the owner
  asked for "a couple", not all of them), drawn in idle moments once the tracker is ready and
  the plate is near the screen. "See all models" (`#landing-models`) presses `#gallery-open`,
  the button of the catalogue of models, and is hidden while that button is not on the page.
- **Index:** `FEATURES` (`featureList.ts`) as rows of names with one line of text each.
- **The plate never changes the page's length.** `layPlate()` makes a square and a caption
  for each kind shown at construction; the pictures only fade into place. They are drawn one at a
  time and only while the page is neither being touched nor has just scrolled (each one holds
  the main thread for a moment). Figures used to be appended as they were drawn, and on a
  phone the page grew and hitched under the finger.
- The bar is one row at every width; below 600 px its two shortcuts are hidden (mark on the
  left, "Open the tracker" on the right). Two rows were "big and smooshed" on an iPhone.
- A small section that explains the name (the orbit drawing with its two apsides marked,
  `.ld-name`), then the footer. (A placeholder "Games" row was removed at the owner's request.)
- The headline and lede cover both halves of the app (Earth orbit AND the solar system);
  keep them that way when either half changes.
Navigation inside the page uses buttons, never `#anchor` links: any `#hash` in the address
means "share link" (an inline script in `index.html` then skips the page on arrival, as it
does when `Settings.landing` is off). "About" in the top bar (`#landing-open`, the round **i**
on phones) brings the page back with `landing.open()`. There is no "How it works" button in
the tracker: the walkthrough (`#howto`, drawn above the page) opens from the home page, the
monitor panel and the About sheet.

**Keeping the feature list current (a standing rule from the owner):** every user-visible
feature has an entry in `src/ui/featureList.ts`, and the home page's "What it does" section
is drawn from that file. Whenever a feature is added, changed or removed, update its entry in
the same change (and the README's usage table).

Top bar (logo = home/reset, search, readouts, tools; picture and video sit in the
`#capture` menu so they cannot be hit by accident) · left tool rail opening ONE panel at a
time (`panel-objects`, `panel-layers`, `panel-conj`, `panel-settings`) · right dock holding
`#inspector` or `#encounter` · bottom time bar (rests as a small pill, opens on hover) ·
status line. Overlays: `#howto`, `#keys`, `#about`, `#share-dialog`, `#bench`, `#contacts`, `#gallery`.

The Objects panel has three tabs (`src/ui/objectTabs.ts`). **Browse** is a page of controls
(watchlist, notable objects, type / orbit filters, appearance). **Activity** and **Tools** are
grids of TILES, one per feature: an icon, a short name and a live figure where the feature
has one. A tile opens its section in place of the grid, and the section's title is the way
back. The owner rejected two earlier versions of this panel: one long scroll of fourteen
sections ("features get lost") and then tabs holding lists of collapsed sections with a line
of description each ("just a list, a lot of text, an AI feel"). Do not go back to prose lists.
- Every section is still one `<details class="sec">` in `index.html`, filled by the same
  module as before. `data-tab` says which tab, `data-section` the name code opens it by
  (`app.openSection(name)`, used by the search field's actions), `data-tile` its tile's label and
  `data-hint` the tile's tooltip. "Open" still means the `<details>` is open, so modules that
  listen for `toggle` did not change. Sections in one tab share a `name`: one open at a time.
- A module puts a figure on its tile with `sectionNote(element, text)` (`dom.ts`): it keeps a
  `.sum-note` in the section's `<summary>`, and the tile copies whatever is there.
- Tiles that are not sections (spacecraft catalogue, contact timeline, benchmark, walkthrough, tour)
  are in `SHORTCUTS` in `objectTabs.ts`; each presses a button that already exists.
- A new feature gets a section in the right tab plus an icon in `ICONS`. Never a fourth tab.

The Layers panel is two columns of small toggle tiles (`.layer-tile`, lit amber while on) in
plain groups (`.group-label`, not accordions): each is still a `<label>` around a checkbox with
`data-setting`, the checkbox stretched over the tile and drawn as its box, so nothing in
`settings.ts` changed. The Settings panel is flat groups with one line per setting (`.set-row`
for a two-way choice, `.row-toggle` for a switch); anything longer than a name goes in the
`title`. Camera habits (drift round the Earth, circle a selected object) are in Settings, not
Layers, and name tags are set in Layers only. Controls that mean nothing on a phone carry
`d-only`.

The top bar says "Apsis" as the home page writes it (plain, not spaced capitals; no tagline)
and shows ONE object count: "of 19,572" appears only while a filter is hiding something.

Settings are generic: any control with `data-setting="name"` edits `Settings[name]`
(`src/ui/settings.ts`), persisted in `localStorage`. To add a toggle: add the field + default
in `settings.ts`, a control in `index.html` (a `.layer-tile` with an icon if it is a layer, a
`.row-toggle` in Settings otherwise), and apply it in `applySettings()` in `main.ts`.

Phones (≤ 760 px, `src/mobile.css`): floating search pill, round buttons on the right edge
(location, views menu, share), a floating 4-item tab bar (the rail), panels as rounded bottom
sheets draggable by their header (`src/ui/sheet.ts` sets `--sheet`). `main.ts` shifts the
camera's view offset up while a sheet is open. Section 7 of `mobile.css` is the current
phone look (short, narrow tab bar; smaller round buttons); in the object sheet `#inspector`
itself is the scroller there — the name and the tabs are `position: sticky`, the photo and
switches scroll away. Section 8 joins an open sheet to the tab bar (the sheet rests on the
bar, one outline, one glass); dragged fully down the sheet is "tucked" (22 px: only its grip,
class `sheet-tucked` on `<html>`), leaving the tab bar. `sheet.ts`'s `COLLAPSED` and
`tallest` must match the `min-height` and offsets in `mobile.css`.

Phone chrome is deliberately minimal (the owner's rule: the globe is the feature, the
interface stays out of its way): search pill, two round buttons (sky view, menu), the tab
bar. There is NO time bar on a phone: `mobile.css` section 10 hides `.timebar` unless `<body>`
has `m-time-open`, which follows the bar's own `is-open` class (menu → "Time and speed", the
tour, tap elsewhere to close); `#m-time-chip` appears only while time is not live.

Idle fade: while the globe drifts by itself (`rig.drifting`) and nothing has been touched,
pressed or moved for 4 s, `updateRest()` in `main.ts` puts `ui-rest` on `<body>`. On a computer
the top bar, rail and status line dim slightly (0.62, `style.css`; the owner asked for it to be
subtle there); on a phone the search pill, round buttons and tab bar dim to 0.28 (`mobile.css`
section 11; the owner asked for it fainter than half). Any `pointerdown`, `pointermove`, wheel
or key removes it at once. Never while a panel, a menu, an overlay, the command bar, the time
controls or the tour is open.

Phone menu (`#m-views`, `mobile.css` section 12): the four views side by side as icons, then
four actions as an icon list. It was nine equal lines of text. (There is no "search" or
"command" entry: the search pill is always on screen.)

"Visible tonight" on a phone is NOT in the Objects panel (its tile is hidden at phone width).
It belongs to the full-screen sky view: `features/tonight.ts` adds a small faded eye button
beside that view's cross (`app.onSkyView`) and shows the same list as a sheet over the sky.
Tapping a pass there closes the sheet and moves the clock to just before the pass. On every
screen the search first calls `app.useMyLocation()`, so the list is for where the visitor is.

Phone sky view: the `#m-sky` button calls `skyFromPhone()` in `main.ts`, which asks for the
location (and, on iOS, the motion sensors) straight from the tap, then enters the sky view
with `sky-immersive` on `<body>`: `firstPerson.css` hides the whole interface and leaves only
a faint close button (the banner's own Exit button, restyled), any message, and "Set north"
when the phone has no compass. Taps do not select objects in that mode.

## Places: the tracker, another world, the solar system (`ui/places.ts`, `render/space/`)

The tracker is one of three kinds of picture, and the visitor moves between them by zooming:
the tracker (the Earth and everything round it), **a place** (another body, close up, at true
scale, with its moons and spacecraft), and **the solar system** (every planet on its orbit;
the camera either beside one body's dot or drawn back to the whole of it). Each is a scene of
its own: the tracker's, and two `SpaceView`s (`render/space/spaceView.ts`; read its header)
drawn through the same renderer and bloom with `SceneKit.show()`. `Places` (`ui/places.ts`)
owns the two views and every move between the three.

**The owner's rules for this (each one was asked for in so many words):**
- **No cut and no fade to black between scenes.** For the half second of a change two scenes
  are drawn at once and dissolved (`SceneKit.blend`, the `Dissolve` pass in `scene.ts`), and
  the incoming scene's camera is held in the same position RELATIVE TO THE BODY as the outgoing
  one's (`Pose`: position in body radii and orientation, both in star axes;
  `SpaceView.update(…, slave)`, `holdCamera()` in `main.ts` for the tracker). A body is drawn
  identically in a place and as its dot on the solar system (same shader, same map — the maps
  are shared by all views —, same sunlight, same turn), so the body does not change at all:
  only what surrounds it fades in or out. An earlier version dipped to black; it was rejected.
- **The sky must not change.** Every scene has the same Milky Way, stars and constellation
  figures (`Sky.backdrop()`, sharing the tracker's buffers), turned by each view's `frame`, and
  the pose carries the camera's tilt across, so the stars do not jump; the view then comes
  upright gently (`moveCamera` eases `camera.up`).
- **Three steps, in this order.** Out of a world you arrive BESIDE ITS DOT on the solar
  system, not at the whole picture; one step further out (the card's ×, Escape, a click on
  empty space, zooming out) is the whole system. In: click a planet (the camera goes up to its
  dot), then go on — click it again, zoom in, or the card's button — and the camera carries on
  in while that world's surroundings appear. `Places.travel()` chains these for a search hit
  or a button; `Places.jump()` (share links only) is the one place a scene simply appears.
- **No menu of planets.** The picture is the menu on the solar system (no rail there at all;
  a list of planets down the side was built and rejected). Moons that can be visited are drawn
  beside their planet. At another world the ORDINARY tool rail is shown with what applies
  there: Objects (the list of what is at that world, `#panel-here`), Layers (only the sky
  tiles, marked `data-everywhere`), Settings, and the way out. `space.css` hides the rest with
  `body.away` / `body.on-map`.

How the pieces fit:
- A place puts its body at the origin, always 6.371 scene units in radius (the Earth's size
  in the tracker), so camera limits and close-up ground behave the same everywhere and GPU
  precision is never asked to hold a Mars orbiter's position measured from the Sun. The
  solar system squeezes distance from the Sun with a logarithm (`mapRadius`) and draws bodies
  large; directions, lighting and turn are true. A dot the camera is near but not looking at
  is shrunk (`place()`), or a neighbour would loom like a second world next door.
- `bodyMesh.ts` is one shader for every body: a few numbers per body (`LOOKS`) for haze, limb
  and rim; shadows worked out per pixel from geometry (a moon's shadow on its planet, a planet's
  on its moon, rings on Saturn and Saturn on its rings) rather than from a shadow map, so they
  cost a few dot products on any machine; the Sun has its own. The Earth as a place borrows
  the tracker's night-lights and cloud pictures.
- `main.ts` asks `places.away` (the tracker is not being drawn at all: its simulation,
  screening and globe do not run) and `places.elsewhere` (the visitor is not in the tracker:
  its shortcuts and picking are off). `step()` calls `places.lead()` before the tracker's
  camera moves and `places.follow()` after, because in a dissolve one camera follows another.
- "The Earth as a place" is only the far view that holds what is beyond Earth orbit (Webb, the
  L1 craft, a passing asteroid); the tracker and it are the same world in the same position,
  so going between them is a dissolve with no move. An asteroid of the fly-by list is given to
  the views as a `Craft` with `passing` set (`rockCraft` in `places.ts`).
- The solar system names only a dozen well-known craft (`HEADLINE`) and draws only the paths
  of the five leaving for good (`LEAVING`): with every dead probe named and ringed, the inner
  planets were buried.
- Share links: `#place=mars`, `#place=system&at=jupiter`, `#craft=webb`.
- **The solar system is the tool; the Earth is the place in it with the most going on.** The
  owner's words, and the test for every piece of interface here: nothing may read as a
  separate "mode" or make the Earth the "main" view ("Back to Earth" was removed for that
  reason). Every world has the same top bar, the same rail (with what applies there), the
  same kind of card as a satellite's inspector, the same Layers, Settings, views and monitor.
  When data for another world gets richer, it is added INTO these same parts.
- **Where you are is a path in the top bar** (`#path`, drawn by `Places.drawPath`): "Solar
  system / Earth", "Solar system / Jupiter / Europa". The last name is where the visitor is
  (a click puts the usual view back); each name before it is one step out; on the solar
  system a world the camera has gone up to is added in amber as the way in. It replaced an
  amber "Solar system" button, a "System" entry in the rail's View group and a round button
  on phones, each of which the owner found too small, too hidden or too much like a feature.
- **The logo resets the view of the world you are AT** (`goHome` → `places.resetView()`):
  usual view, nothing selected, no panel, clock back to now. It does not go to the Earth.
- **On the solar system a world is captioned in the picture** (`#place-hud`): its name, one
  line of where it is, "Enter <name>" (also the Enter key, a second click, or zooming in),
  and its moons as plain links. This replaced a side card with a "Go to the Moon" button,
  which the owner called "super AI and elementary". Keep it words in the picture: no box.
- **Everything else gets the card, built from the inspector's own parts** (`#place-card`
  uses `.insp-head`, `.insp-hero`, `.acts`, `.tabs`, `.telemetry`, `.kv`): a craft has Live /
  Orbit / Record, a world Now / Facts / About, a landing site Site / About. The switches
  (`#pc-acts`) are the tracker's own settings (`orbitPath`, `groundTrack`, `footprint`,
  `model`); `SpaceView` draws the ground track in the body's turning frame (a child of its
  mesh) and the footprint as the circle acos(R / r) from the point under the craft.
- **Views at every world** (`data-place-view` / `data-map-view` buttons in the rail's View
  group, keys 1–4, `SpaceView.goView`): whole, close, night, moons; on the solar system
  whole, inner, above.
- **A close-approach monitor at every world** (`ui/placeWatch.ts`, `#panel-watch`, the rail's
  Monitor button): the craft in flight there go through the SAME `hashedPairs`, once a second,
  with a cell as wide as the alert distance; a 24-hour look-ahead hashes every 30 s with
  cells widened by what two craft can close in one step and narrows each candidate by thirds;
  "Screening cells" (the tracker's own switch, `G`) draws the occupied cells
  (`SpaceView.setCells`). It finds something only now and then: that is the true state of
  things out there, and the panel says so.
- **Nothing is set up during a change of scene** (the owner noticed frame drops): the solar
  system is built and drawn once out of sight ~10 s after start-up (`SpaceView.prewarm`: a
  render into a 32-pixel buffer compiles shaders and uploads shapes); a world's place is
  built while the camera goes up to its dot (`Places.prepare`), not when the visitor goes
  in; maps are decoded off the main thread (`createImageBitmap`) and uploaded in an idle
  moment (`renderer.initTexture`) before anything draws with them; the second picture of a
  dissolve is not multisampled; the page's classes (rail, path) change when a move STARTS
  (`Places.chrome`), because restyling the page costs a frame; a view that has been left is
  kept, not torn down. Do not move any of this work back into the move.
- **The camera can never be inside a world** (`moveCamera` pushes it out to just above the
  ground of any body it enters): turning the view round something that stands on the ground
  used to swing it down through the surface. Things on the ground are placed 0.14 % above
  the radius, because the close-up ground is drawn as patches lifted up to 0.11 %.
- **On the solar system, a moon is placed from its planet's FULL size** and a planet whose
  moon is being looked at stays at least half size (`place()`): placed from the size the
  planet was currently drawn at, a chosen moon slid into its shrinking planet and ballooned.
- **Layers away from the tracker** (`SpaceOptions`, set from `applySettings`): the sky tiles
  and the selected craft's switches (`data-everywhere`), the ground (`data-place`: not on the
  solar system), and a group that exists only out here (`data-away`): Planet orbits, Craft orbits, Names,
  Spacecraft, Landing sites, Every craft on the solar system (`spaceOrbits` for planets and moons, `spaceCraftOrbits` for craft, separate at the owner's request; `spaceNames`,
  `spaceCraft`, `spaceMoons`, `landingSites`, `spaceAllCraft`). The solar system has no menu of planets, but
  it does keep the rail's Layers and Settings: the owner asked to be able to turn the orbits
  off there.
- **Landing sites** (`space/sites.ts`, `Site`) are given to the views as craft that stand on
  the ground (`siteCraft`, `Craft.site`), like passing asteroids: a dot, a name once the
  camera comes down to it, a card. Listed under "Landing sites" in a place's Objects panel.
- **Constellation names** away from the tracker are the tracker's own (`host.figures()`,
  the same `.sky-label` style), behind the same "Sky names" switch.
- **Zooming past the edge of a view** carries on into the next: the wheel, and on a phone a
  pinch that begins at the limit (`pastEdge` in `SpaceView`, `pastTheEdge` in `main.ts`).

Never verified on real hardware: how the dissolve and the long zooms feel on a phone's GPU.

## Beyond Earth orbit (`src/space/`): data and maths

Everything outside this folder knows only objects in Earth orbit. `src/space/` adds the Sun,
planets and moons ("bodies") and the spacecraft CelesTrak cannot describe ("craft").
`src/space/types.ts` is the contract between this layer and whatever draws it.

- **One frame: ICRF / J2000 equatorial, kilometres, Unix ms.** x → the equinox, z → the
  celestial pole. It is within a third of a degree of the TEME frame SGP4 gives the tracker,
  so the same scene conversion applies: ICRF `(x, y, z)` → scene `(x, z, −y)`.
- **Clock.** The app's clock is UTC; orbits run on uniform time, 69.184 s ahead
  (`TT_MINUS_UTC_MS` in `ephem.ts`, the same constant in `scripts/horizons.mjs`). Horizons'
  vector tables are tagged in TDB; every script converts at the edge.

```
scripts/deep-craft.mjs (the facts: name, aliases, agency, launch date, model, DSN codes)
        │ scripts/fetch-deep.mjs ── JPL Horizons state vectors (scripts/horizons.mjs: one request
        │                           at a time, ≥ 1.1 s apart) + JPL CNEOS fly-bys and fireballs
        ▼
public/data/deep.json (DeepData)          scripts/fixtures/deep-reference.json (Horizons' own later positions,
        │                                  same download: what check-deep compares deep.json against)
        ▼ space/deep.ts: loadDeep() (once; also hands the moons' fresh orbits to ephem.ts)
craftPosition(craft, t) → km about craft.centre      bodyPosition / bodyRelative / bodyAxes (space/ephem.ts, pure maths)
```

- `bodies.ts`: `BODIES` and `BODY_LIST`, 45 bodies: the Sun, eight planets, Pluto and 35
  moons (every one Horizons can place that is round or well known). Radius and GM from JPL's
  satellite tables, periods and discoveries from NSSDC's fact sheets; `discovered`, `tempC`
  and `air` only where there is a real answer. GM of a giant planet is the planet alone
  (used for things orbiting close to it). `visitable` is true exactly when `imagery.ts` has
  a map (the check enforces it): 31 bodies; fourteen small moons are plain coloured balls.
- `ephem.ts`: planets from JPL's "approximate positions" table (1800–2050); the Earth is
  that table's Earth–Moon barycentre minus the Moon's share; the Moon is a 70-term series
  (Meeus ch. 47) precessed to J2000. Rotation is the IAU model per body (`ROTATION`, with the
  periodic terms in `NOD`), every constant checked against Horizons; the Earth uses GMST
  carried back through precession; nine moons with no model (Hyperion tumbles; Janus and
  Epimetheus; Himalia, Nereid, Pluto's small four) are locked to their planet. Everything
  here must stay importable by Node (no DOM, no three.js) and cheap: the 3D side calls it for
  a planet's whole family each frame.
- `moonOrbits.ts` is GENERATED (`node scripts/make-deep-fixture.mjs --fit`, from sixty years
  of Horizons positions; `--cache <folder>` keeps the samples so the fit can be reworked
  without asking again). Each moon is an ellipse whose plane swings round a fitted axis
  (`axis`, `nodeRate`), whose long axis turns (`periRate`), and whose longitude carries slow
  sine waves (`swing`: Mimas ±44° over 71 years with Tethys, Janus and Epimetheus trading
  orbits every 8). A few have a changing shape (`wobble`: Himalia, Hyperion, Phoebe, Nereid),
  and Pluto's four small moons orbit the centre of mass of Pluto and Charon (`partner`). Lessons
  that cost time: a fixed plane was 1–2° wrong for Phobos and Triton; the fit's own residual
  hid a bug that the independent fixture showed at once (always run the check); measured
  from Pluto's centre the small moons have no usable ellipse at all.
- **The table beats a download inside its span.** deep.json carries each moon's osculating
  ellipse, but `setMoonElements()` uses one only if the download falls outside 1996–2056:
  one moment's ellipse carries that moment's passing disturbances (ten days on, a downloaded
  Mimas is 0.5° out and Pluto's small moons 2°, the table a tenth of that).
- **Motion has three forms** (`Motion` in types.ts): `elements` (Kepler; hyperbolas have
  `aKm < 0`, `e > 1`; orbiters carry optional measured `rates`, applied as a turn about the
  PLANET's pole: in ICRF a plane precessing about Mars's pole changes inclination and node
  together, and a first version that advanced the ICRF node was 10° out after a week),
  `samples` (Catmull–Rom through equal steps, held at the ends) and `surface` (a latitude
  and longitude turned with `bodyAxes`). Always go through `craftPosition` / `motionPosition`
  (a fly-by's path is a Motion about the Earth); do not re-implement them.
- fetch-deep builds each orbit from Horizons' position and velocity with the SAME GM the
  browser propagates with (`stateToElements`), so the round trip is exact at the epoch. A
  craft "round the Sun" that is inside a planet's sphere of influence at that moment (a
  gravity assist, an arrival) is given about that planet instead. A craft Horizons cannot
  place is skipped with a log line; the script never fails a build.
- `imagery.ts`: one map per visitable body (2:1, longitude 0 in the middle, east right) in
  `public/textures/space/`, each with a 256 px `<name>_s.jpg` beside it for the solar-system
  view, made by `scripts/build-space-maps.py` (run by hand; Pillow), plus NASA Trek tile
  layers whose deepest level and CORS header were checked. `IMAGE_CREDITS` must be shown
  wherever credits are: the Solar System Scope textures are CC BY 4.0. Rules the script
  follows: a map from anywhere but Trek is lined up against the Trek layer of the same world
  by where its craters fall (`line_up`: it found NASA's colour maps of Saturn's moons half a
  turn out, and the Mimas one a further 3.9° out, an older zero of longitude); parts no
  camera has seen are one flat average tone, never black and never invented terrain
  (`fill_unseen`); a map is bundled only if its public-domain status was confirmed at the
  source (which is why Mimas and Rhea come from NASA's colour maps, used in grey, and not
  from the DLR mosaics Trek serves as their tiles; and why Deimos has no map).
- `sites.ts`: `SITES`, the 32 historic landing sites (Moon, Mars, Venus, Titan), each
  coordinate from a primary source named in the file's header. Not for craft that deep.json
  already stands on the ground. Ids are used in share links: do not rename them.
- Craft facts live in `scripts/deep-craft.mjs`. `arrived`, `ended` and `massKg` are filled
  only where a primary source confirms them (the header says which); after editing run
  `node scripts/fetch-deep.mjs --facts`, which rewrites the facts in deep.json without the
  network. `--only-new` asks Horizons only for craft or moons the file lacks.
- `skyEvents.ts`: eclipses (solar: Besselian-style shadow cones on the WGS84 ellipsoid;
  lunar: Danjon's 1 % shadow enlargement, as Espenak's canon), Mercury/Venus transits, and the
  Galilean moons' shadows and transits on Jupiter (IAU 1-bar ellipsoid, light time applied).
  `skyEvents(from, to)` is what the bell calls (cached per lunation / conjunction / 4-day
  Jupiter block: ~12 ms cold, < 1 ms after). `rare` = worth an alert (Earth eclipses, planet
  transits); Jupiter events are routine. Evidence: `scripts/check-sky-events.mjs` against NASA's
  eclipse and transit catalogues (2023–2032, 2000–2045) and IMCCE's Galilean tables for
  2026–27 (`scripts/fixtures/galilean-imcce.json`); the timing limit is `ephem.ts`'s planetary
  table (Callisto runs ~2 min late), not the geometry.
- `dsn.ts`: `watchDsn()` polls NASA's DSN Now XML once a minute only while something
  watches. `showers.ts`: twelve annual showers; peaks solved from the Sun's longitude.
- **The evidence** is `scripts/check-deep.mjs` (part of `npm run check`): it compares the
  ephemeris with `scripts/fixtures/deep-truth.json` (Horizons, twelve dates 2024–2030: every
  planet and moon, and the orientation of all 36 bodies that have a rotation model) and
  deep.json with the reference file, and prints the worst errors; it also checks the maps,
  their small copies and the landing sites. If you change `ephem.ts`, run it. To add a moon:
  `BodyId`, `BODIES`, `BODY_LIST`, `BODY_CODE` in `horizons.mjs`, then
  `make-deep-fixture.mjs --fit` (adds it to the fixture and refits the table) and
  `fetch-deep.mjs --only-new`. To add a craft: a row in `deep-craft.mjs`, then
  `fetch-deep.mjs --only-new`. Commit deep.json and deep-reference.json together (the check
  refuses a mismatched pair).
- A jump inside Horizons' own trajectory (two mission files that do not join) shows up in
  the sampled-path check; it is detected, reported and not counted. Do not "fix" it by
  loosening the 1,000 km tolerance.

## Feature modules (`src/features/`)

Features added after the core do not live in `main.ts`. Each is one file in `src/features/`
exporting `install…(app)`, and talks to the rest of the program only through the `App`
interface in `src/ui/app.ts` (getters, actions, `on…` hooks). `main.ts` builds the single `app`
object and calls every installer inside a try/catch, so a broken extra cannot stop the
tracker. Each module draws inside an empty element reserved for it in `index.html`; a reserved
`<details data-feature>` section stays hidden while its body is empty.

| Module | Draws in | What it does |
| --- | --- | --- |
| `radio.ts` | `#insp-heard` (Live tab), `#insp-radio` (Passes tab) | SatNOGS "last heard", transmitters, Doppler shift at the ground station. Reads `public/data/radio.json` only; never calls SatNOGS |
| `changes.ts` | `#changes-body`, `#insp-fresh` | Orbit changes between two downloads (`changes.json`, or compared in the browser after "Download current elements"); data age and catalogue status of the selected object |
| `weather.ts` | `#weather-body` (in "Lowest orbits") | NOAA solar flux and Kp in words; feeds `ui/feed.ts` → `data/decay.ts` for the "time left" estimates |
| `launches.ts` | `#launches-body` | Launch Library 2 list with countdowns; pads on the globe (`render/padMarkers.ts`) only while the section is open |
| `tonight.ts` | `#tonight-body` (moved into its own sheet in the phone sky view) | Bright passes in the next 24 h from the visitor's own position, computed in `worker/tonight.worker.ts` only when asked |
| `report.ts` | `#enc-export` | Close-approach report (new tab, or a saved file if the tab is blocked) and CSV |
| `growth.ts` | `#growth-body` | Year slider; registers one filter with `app.setFilter('growth', …)`; cleared by Home (`app.onHome`) |
| `commands.ts` | nothing of its own | Places, times, clock speeds and actions for the search field: one source registered with `app.addSearch`; `commandParse.ts` holds the grammar of times and speeds |
| `flybys.ts` | `#flybys-body` | Asteroid fly-bys from deep.json, soonest first (real clock); choosing one calls `app.jumpTo` |
| `fireballs.ts` | `#fireballs-body` | Recent fireballs from deep.json; marks on the globe (it reuses `PadMarkers`) only while the section is on screen |
| `showers.ts` | `#showers-body` | Meteor showers active / next on the SIMULATED clock (`space/showers.ts`); rebuilt when the simulated day changes |
| `dsn.ts` | `#dsn-body` | Live Deep Space Network links (`space/dsn.ts`): one read 4 s after start for the tile, then once a minute only while on screen |
| `ascent.ts` | `.ascent-tags` (its own layer), objects in `app.eciGroup` | Estimated climbs of launches (`data/ascent.ts`) on the simulated clock; `watchLaunch()` is used by `launches.ts` and `bell.ts` |
| `bell.ts` | `#bell`, `#bell-menu` (top bar; phones: the menu's "Live and coming up") | Three kinds of row on the REAL clock: alerts (a launch in flight or within 20 min, a shower within a day of its peak, an asteroid within 6 h; counted on the bell), ongoing (DSN contacts, a shower in its active weeks: routine, never counted, the owner's rule) and coming up (next launches, asteroid, shower peak); each row goes there (`app.showDeepCraft`, `app.goEarth`). Launch list through `loadLaunches()` (its hour-old copy, so at most one request an hour), DSN feed once every 5 min while the tab is visible |

To add a feature: write the module, reserve an element if it needs one (in the Objects panel:
a `<details class="sec" data-tab data-section>` in the right tab), add one import and one name
to the installer list in `main.ts`, extend `App` only if the module needs something new, and
add its entry to `featureList.ts`.

**A feature module must ask `app` about the program's state, never the page.** The command bar
(since folded into the search field) once decided whether it could open by testing
`document.getElementById('landing')`; when the home page stopped being removed from the
document, the bar silently never opened again. The search field's shortcut asks `app.ready()`.
If a module needs to know something `App` cannot tell it, add a getter.

## Loading in pieces (`vite.config.ts`, the end of `main.ts`)

The owner's condition for splitting the code: nothing may ever wait on a download at the moment
it is used. So:
- three.js and satellite.js are chunks of their own (`manualChunks`): they rarely change, so a
  returning visitor re-downloads only the app's code after a deploy.
- The feature modules are `import()`ed in parallel as soon as `main.ts` runs (`FEATURES`) and
  installed together, in order, when all have arrived — long before the home page or loading
  screen lets anyone reach them. Because they can arrive after the catalogue, `onCatalog`,
  `onFacts`, `onSelect` and `onEncounter` tell a late listener the current state at once.
  (Settings are not replayed: features only ever reacted to changes.)
- The share window's QR library (`warmShare`) and the contact timeline are fetched by
  `warmLater()` in idle moments once loading is done, and made on first use.
- Do NOT turn something the first frame needs (the globe, Places, the models the loading
  screen warms) into a dynamic import. Do not group `src/features/` into one manual chunk
  either: shared modules get dragged in with it and the main file then imports it eagerly
  (tried; it put three.js inside "features").

## Launches as they happen (`data/ascent.ts`, `features/ascent.ts`, `data/fresh.ts`)

- **No one publishes a rocket's live position**, so a climb is a MODEL and always says so:
  `planAscent(launch)` takes the pad, the time to the minute and the target orbit from Launch
  Library 2 (`orbit`, `family`, `webcast` were added to `Launch`), picks an inclination (the
  Station's for an ISS trip, known constellations by mission name, a pad's usual direction by
  site, else due east), the azimuth from sin Az = cos i / cos φ (southward at pads that
  cannot fly east), and a typical ~9-minute climb (height on an S-curve, speed ∝ t^1.4, range
  the integral of speed). It is computed in the inertial frame frozen at lift-off and coasts
  round two orbits after the burn. `ascentState` is pure: test it in Node.
- `features/ascent.ts` draws it on the SIMULATED clock, from an hour before lift-off: the path
  (flown part bright), a model (`rocketKind`: the family's model if one exists, else
  `launcher`/`rocketbody`; the upper stage alone after staging), a glow while burning, and a
  card with T+, height, speed, the stage, the basis of the estimate, Follow (`app.follow`)
  and Watch live (the listed webcast, else a search). `watchLaunch(launch)` (exported; used by
  the launches list's "Preview / Watch / Replay the climb" and the bell) moves the clock to
  just before lift-off when needed.
- `data/fresh.ts`: launches of the last three days found in the catalogue (by international
  designator, dated by the SATCAT facts; newer than the facts = new). `cloud.setFresh` makes
  them larger and mint without dimming anything; `labels.setFresh` names each launch's lead
  object "New ·". Layers switch `newLaunches`; the bell lists them as ongoing.

## Small rules added in the polish pass (Nov 2026)

- **Escape in the tracker**, with nothing left to close (overlay, selection, panel), goes out to
  the solar system like Escape at any other world. Overlays that close on Escape stop the key
  (`stopImmediatePropagation`) so closing one does not also leave the Earth.
- **Autoplay** (`ui/spaceTour.ts`): away from the tracker the autopilot button and `A` play a
  trip from the Sun to Pluto made only of `Places` journeys (`visit`, `visitSystem`); any real
  input stops it where it is. The tracker's own autopilot (`cinema.ts`) is unchanged.
- **Coming back into the tracker** its name tags wait (`body.arriving`, set in `Places.chrome`,
  removed when the dissolve ends): they used to appear at once over the solar system's dive.
- **Distances to a focus use `item.base`** (full size), never `item.radius`: on the solar
  system a nearby dot is drawn shrunk, and the camera stopped five times too close to it.
- **Things on the ground stand on the ground actually drawn** (`groundRadius` in
  `spaceView.ts`: one ray down onto the body's sphere and the shown tile patches, twice a
  second) and get two soft shadow quads (`groundShadow`): a contact patch, and one stretched
  away from the Sun that fades out at night. Opacities are high on purpose: blending is in
  linear light, so 0.78 read as barely there.
- **Closed craft orbits are sampled by turn, not only by time** (`sampleOrbit`): Juno's line
  ran straight through Jupiter with 240 even steps.
- **Hover away from the Earth**: each `SpaceView` runs its click test on `pointermove` (mouse
  only, every 50 ms), sets the hand cursor, and `Places.hover` fills the tracker's own
  `#tooltip` (a lit ball for a world, the model's thumbnail for a craft, distance from Earth).
  It follows `Settings.hoverCard` and hides on every change of scene.
- **Rovers stand at the end of their driven path** (`Places.placeRovers`, from
  `public/data/rovers.json` once loaded), not at Horizons' landing-site position (12–14 km
  away). Paths: `scripts/fetch-rovers.mjs` (NASA MMGIS traverse, 23.5 h guard), drawn by
  `spaceView.ts` (`roverPaths`), Layers switch `roverPaths`, credited NASA/JPL-Caltech.
- **Search at another world** lifts that world's moons and craft by 0.12 under a heading of
  their own ("At Mars"), and the Earth's catalogue objects score ×0.9 there. Choosing an Earth
  object while away travels back to the Earth first (`app.select`).
- **What's new**: `WHATS_NEW` in `featureList.ts` is the visitor-facing change log (home page
  section `#ld-new`, About). Add an entry at the top for every visible change, as well as the
  feature's own entry in `FEATURES`.
- **A filter is announced** (`#filter-banner`, `ui/filters.ts`): count, reasons (`FilterAbout`
  labels from `app.setFilter`, plus types / orbits / height), and "Show all", which calls each
  module's `clear`. It pulses when the visitor comes back to the Earth.

## The search field (`src/ui/search.ts`)

There is ONE place to type. A second one, the command bar, was removed at the owner's request
after a visitor could not find a telescope in either; do not add another. The field asks every
source for what was typed and shows one list under quiet headings, each row a `SearchHit`
(`ui/app.ts`: title, note, group, score 0…1, run). Headings are ordered by their best row, so
Enter always runs the best match overall.

| Source | Heading | Where |
| --- | --- | --- |
| Catalogue objects by name, nickname, number | Objects | `ui/searchObjects.ts`: `byNorad`, the prefix index (the shortest candidate list of the typed words), the nicknames; only if those find nothing, a `Map<word, objects>` of the names' vocabulary is scanned for misspellings |
| What objects ARE: "telescope", "spacex", "chinese weather" | Types | `ui/searchIndex.ts`: an inverted index, `Map<description, Topic>` and `Map<keyword, object indices>`, built once per catalogue (and again when the owners in `satcat.json` arrive) from `describe()`, the category, the orbit class and the owner. Several words intersect their sorted lists |
| Places, times, speeds, actions | Places, Time, Actions | `features/commands.ts`, through `app.addSearch` |
| Anything else | its own `group` | any module: `app.addSearch((query) => SearchHit[])` |

- `matchScore(query, ...texts)` in `ui/searchMatch.ts` is the one scorer (the scale is in its
  header). 0.6 is the line between "what was typed is in the name" and "probably meant"
  (a misspelling): when the list has a proper match, everything under 0.6 is left out.
- Choosing a type registers `app.setFilter('search', …)` and shows a chip in the field
  (`#search-filter`); the chip, Home, or a new catalogue clears it.
- `displayName(sat)` (`data/names.ts`) is what a headline shows: the suggestions, the
  inspector's title, the hover card. Lists, name tags and the simulation keep `sat.name`.
- `app.focusSearch(text?)` puts the cursor in the field (with text already typed, if given).
- With nothing typed the field lists `EXAMPLES`, one of each kind; choosing one types it.
- On a phone a row is two lines and the round buttons step aside while the list is open
  (`mobile.css` section 14).
- `scripts/test-command.mjs` checks the grammar, the scorer, the index and the finder against
  the real catalogue. "james webber telescope" must keep finding "James Webb Space Telescope".

## Browser storage keys

`orbithash.settings.v2` (settings), `apsis.watchlist`, `apsis.stations`,
`apsis.tour.seen`, `apsis.location.consent`, `apsis.weather` (NOAA readings, 3 h),
`apsis.launches` (launch list, 1 h), `apsis.reloads` (the one-reload guard after a lost
graphics context).

## Outside services (all optional at run time; the app works offline without them)

The page's own site first: a tab left open asks it, and only it, whether a data file has been
published again (`src/data/freshness.ts`: four HEAD requests at most every 30 minutes, only
while the tab is visible; see "A tab left open" below). Then, to others:
CelesTrak (manual refresh; scheduled in CI), Wikipedia (REST summary for photos and descriptions,
and the query API when an object's own name is tried as a title; cached per article), NOAA SWPC (aurora grid, Kp, solar flux), a public people-in-space list
(`src/data/crew.ts`), NASA GIBS map tiles (`src/render/tiles.ts`, only while zoomed in and
only with the `sharpGround` setting on) and, at the Moon, Mars and Mercury, NASA Solar System
Treks map tiles under the same two conditions (plus eight coarse tiles once per visit, to match
their tone to the body's map), Launch Library 2 from The Space Devs (when the
launches section is opened, and by the bell a few seconds after start; about 15 requests an hour are allowed, the answer is kept for an
hour, so a visitor asks at most once an hour), NASA's DSN Now feed (`src/space/dsn.ts`: one read shortly after start, once a
minute while the Deep Space Network section or the bell's list is on screen, and once every five minutes for the bell's badge while the tab is visible), NASA Solar System Treks map
tiles (the layers in `src/space/imagery.ts`, for whatever draws other bodies close up),
nothing else from the browser. SatNOGS is read at BUILD time only
(`scripts/fetch-radio.mjs`, 5.5 h guard, at most 22 requests; its API sends no CORS headers,
and its data is CC BY-SA and credited in About). JPL Horizons and JPL CNEOS are also BUILD
time only (`scripts/fetch-deep.mjs`, 5.5 h guard, about 130 requests one at a time; Horizons
sends no CORS headers). How often the build asks each of them is in "Deploying". The maps of other bodies are bundled; the Solar System Scope ones
are CC BY 4.0 and must be credited (`IMAGE_CREDITS`). No analytics, no accounts. Location is used only after
an in-app yes plus the browser's own prompt, and stays in `localStorage`.

## A tab left open (`src/data/freshness.ts`)

A page reads the data files when it loads; the site publishes new ones every 3 hours. So that
a tab opened yesterday does not show yesterday's orbits, the page asks its OWN site (relative
addresses, never a third party) whether a file has been published again, and takes it.

- **What it asks:** at most once every 30 minutes, only while the tab is visible, one HEAD per
  watched file (`satellites.json`, `deep.json`, `radio.json`, `changes.json`): headers only.
  The `ETag` / `Last-Modified` is compared with that of the copy in use, which `fetchData()`
  remembered when the file was loaded (every loader of these files goes through `fetchData`).
  Only a file whose validator differs is fetched, once.
- **The caches.** Pages sends `Cache-Control: max-age=600`; a plain fetch would be answered by
  the browser's cache for ten minutes. Both requests use `cache: 'no-cache'` ("ask the server
  before using my copy"): unchanged is a 304, changed brings the new file. A validator only
  says "published again" (every deployment changes it), so each owner also compares the
  file's own `fetchedAt` before changing anything, and never goes backwards.
- **Owners** register with `watchData(url, { reload, when? })`. `reload()` answers `'changed'`
  (the visitor can see it: one toast, "Newer tracking data loaded"), `'same'`, or `'later'`.
  - The catalogue (block at the end of `main.ts`, before "start"): `takeNewerSnapshot()` goes
    through `rebuildCatalog()` like "Download current elements", but keeps the selected object
    selected by NORAD id WITHOUT `select()` (which would fly the camera, reset the phone
    sheet and buzz): `selected` is cleared for the rebuild and put back with the new object.
    It waits (`quietForNewData()`) while the home page or loading screen is up, away from the
    Earth (`places.elsewhere`), in a close approach or replay, a first-person view, the
    autopilot, a recording, the tour, with a constellation on show, the monitor panel open or
    an overlay open. The dots blink off for a moment while the worker computes the first
    positions; that is the same as the manual refresh.
  - Deep space: `refreshDeep()` (`space/deep.ts`) replaces the cached copy and tells
    `onDeepRefresh` listeners: `places.refreshData`, the fly-by and fireball lists.
  - Radio: `features/radio.ts` hands the new records to its cards.
  - Orbit changes: after a catalogue swap the comparison is made in the browser (what this
    tab had against what it has now); `changes.json` is only taken when nothing is showing.
- The search field's type filter is kept by NORAD id, so it survives the swap.

## Robustness (added after a "black screen on a friend's laptop" report that could not be reproduced)

- `scene.ts` runs a tiny guard pass before bloom that turns any NaN / infinite pixel black, so
  one bad pixel from any shader can no longer blank the whole frame through the bloom blur.
- `main.ts` handles `webglcontextlost` / `webglcontextrestored` (message, then one reload),
  refuses to start without WebGL 2 with a plain message, and wraps each frame in try/catch so
  an exception cannot freeze the picture.
- When the tour ends or is skipped the app returns to the whole-Earth view.
- About → "This device" shows the graphics card, quality level, frame rate and the last
  recorded problem — ask a user to read that out when they report something odd.

## Close-up ground (`render/tiles.ts`)

(The rules below were learned on the Earth and hold at every world.)

- The globe texture is ~10 km per pixel. Below ~6,000 km altitude detailed map tiles (NASA
  GIBS, zoom 2–8) are drawn as curved patches, children of `globe.earth`, lifted a few km
  above the surface and lit like the globe.
- **Which tiles are shown depends only on where the camera IS, never on where it looks.**
  They form rings around the point straight below the camera: the sharpest level (chosen from
  the camera's height, with hysteresis) out to the screen's corners, then coarser levels, each
  reaching further, until the horizon is covered (`rings()`). An earlier version centred the
  tiles on the middle of the picture; turning the camera around a satellite swept that point
  across a continent and swapped every tile on each small move — the ground flickered. Do
  not reintroduce view-direction-dependent selection.
- Each level fades out towards its rim (`uEdge`, centred on `uCentre` = the sub-camera point)
  over the coarser level beneath, and the coarsest into the globe, so no level ends in a line
  and tiles arriving at the rim are still transparent. Coarse levels load first; old tiles
  stay until the new set is complete; tiles are fetched ahead for `rig.destination` and along
  the direction of travel.
- The level is lowered for ground speed ONLY when simulated time runs at ≥ 50× (a followed
  satellite then covers hundreds of km a second). Never for the user's own dragging: that
  would be a blur-then-sharpen flicker.
- Tile materials use `polygonOffset`: with the camera metres from a satellite model the near
  plane is tiny and the depth buffer cannot separate a patch from the globe at a distance
  (z-fighting) without it.
- Blending: fully covering near the ground, 60 % in total from far away (so the globe's clouds
  still show); several rings overlap in the middle, so each ring's share is computed to give
  that total. On the night side the tone equals the globe's from far away and rises to bright
  moonlight near the ground; the globe's city-lights texture (the same uniform objects,
  borrowed from the Earth material) is added through a 16-tap cubic B-spline (skipped in
  daylight), because its real detail is ~20 km and linear filtering shows as squares.
- Pictures are fetched with `fetch` + `createImageBitmap` (decoded off the main thread), stale
  downloads are aborted, `tiles.prewarm()` compiles the shader behind the loading screen, and
  `tiles.status` feeds About → "This device". Cache: `Map<"z/x/y", Tile>`, least recently used
  evicted beyond 260, at most 16 downloads in flight, 30 s back-off if the service is down.

### The same machinery at other worlds

- `tiles.ts` is `GroundTiles(globe, options)`; `EarthTiles` is that class with the Earth's
  options and must keep behaving EXACTLY as before (check: same camera, same paused clock, a
  screenshot with the old file and with the new, compared pixel for pixel; the day side came
  out identical). What is handed in:
  - **the source** (`TileSource`): address template with `{z}/{y}/{x}`, level range, and the
    grid. GIBS is `'mercator'` (2^z × 2^z web-map squares); NASA Trek is `'degrees'` (a plain
    latitude / longitude map, 2^(z+1) × 2^z squares, rows evenly spaced in latitude). Both
    count rows from the north and columns from longitude −180°. Everything that differs
    between the two is in the `Grid` objects (`MERCATOR`, `DEGREES`).
  - **the lighting**: `'earth'` (the globe's day and night, its city lights) or `'body'`: the
    shader REPEATS `bodyMesh.ts`'s lighting and shares that body's uniform objects (Sun,
    haze, gain, shadow-casters). Change the lighting in one file and change it in the other.
  - **the tone** (`matchTone`): a body's tiles and its whole-globe map are different products
    (the Moon's tiles are a grey survey mosaic nearly four times darker than its painted map).
    `measure()` fetches the eight level-1 tiles once, compares their brightness percentiles
    with the map's (`setReference`) and gives every tile the curve `gain × colour^gamma`
    that matches them; a shoulder in the shader stops sunlit slopes burning out. No tile is
    shown until that is settled. Without a map (a body in plain colour) tiles show as they come.
- Heights are in scene units (every body is drawn 6.371 units in radius); only pixel sizes
  use the body's real radius.
- `SpaceView.buildPlace` creates the tiles for a body with `IMAGERY[id].tiles`, as children
  of the centre body's mesh; `update` feeds them that view's camera and the clock's rate (the
  body turns under a camera fixed among the stars); `clear` disposes of them. Places apply
  `Settings.sharpGround` through `places.setSharpGround`; the Layers tile carries
  `data-everywhere`.
- The camera may come down to 1.025–1.0375 radii where there are tiles (`lowest` in
  `spaceView.ts`: until the finest level is about three times life size), 1.06 elsewhere. Not
  lower than 1.025: the camera looks at the body's centre and SceneKit's near plane is 2 % of
  that distance. Drag and idle drift are scaled down with altitude.
- **True finest levels** (from each layer's WMTSCapabilities.xml, and by asking): Moon
  `LRO_WAC_Mosaic_Global_303ppd_v02` 8, Mars `Mars_Viking_MDIM21_ClrMosaic_global_232m` 7,
  Mercury `Mercury_MESSENGER_MDIS_Basemap_BDR_Mosaic_Global_166m` 7. Trek answers a missing
  tile with a 404 that has no CORS header, which a page cannot tell from being offline; with
  `quietWhenMissing` a level that turns out not to exist is dropped (`forget`) instead of
  stopping all downloads for 30 s, but a wrong `maxZoom` still fills the console with errors.
- Known limits of the data, not of the code: the Moon's mosaic is coarse and blocky beyond
  about 75° of latitude (no tiles are drawn beyond 86°); the Viking mosaic of Mars shows its
  own seams.

## Close-approach view details

- `gridViz.ts` pair mode draws the usual grid of occupied cells around the pair, dimmed and
  fading with distance, and on top the two objects' cells (cyan / amber, red while inside the
  alert distance unless the pair flies together) plus a faint outline of A's 27-cell block.
  Cells are fixed in space and the objects cross one about every second, so each lit cell
  fades in and out (a short trail) instead of jumping. (Two earlier attempts were rejected by
  the owner: a full lattice that jumped with the objects, and the pair's cells alone with no
  grid.)
- `encounterViz.ts` draws both flight paths as ten-minute arcs through the closest point and
  rebuilds them further along as the clock runs. They must never be shorter than what the
  live view can outrun: with only the few seconds around the closest point drawn, the objects
  left the ends of their lines at once and "the orbits disappeared".
- `updateEncounter()` in `main.ts` keeps both objects framed (`encAutoFrame`): the camera eases
  back as they separate and in again during a replay; a manual zoom switches that off until
  the pair is re-centred from the panel.

## 3D models (`render/satModels.ts` and the files beside it)

- 72 kinds (`ModelKind` in `data/describe.ts`), each a builder, built once, merged by
  material, normalised and cloned by `buildModel(kind)`. The files:
  - `modelParts.ts`: the kit, and nothing about any one spacecraft. `makeMaterials()` (painted
    canvas textures, normal maps computed from painted height fields, a small painted
    environment map so foil and glass glint) and one helper per part: `bus`, `prism`, `slab`,
    `cyl`, `dish`, `buildWing` / `wingPair`, `fan` (round array), `lattice` (boom), `rtg`,
    `scope`, `plate`, `thrusters`, `tracker` …
  - `satModels.ts`: the 24 kinds found in Earth orbit (`BUILDERS`, which also spreads in the
    three tables below), `buildModel`, `modelBase`, `modelThumbnail`, `SatelliteModel`,
    `ModelPreview`.
  - `observatoryModels.ts` (webb, euclid, tess, chandra, xmm, soho, l1monitor, stereo),
    `deepModels.ts` (voyager, pioneer, newhorizons, probe, juno, clipper, lucy, psyche,
    samplereturn, bepi, parker, solarorbiter), `planetaryModels.ts` (lunarorbiter, marsorbiter,
    rover, lander, asteroid).
- Added in Nov 2026 (23 kinds), in three more files spread into `BUILDERS`:
  `constellationModels.ts` (starlinkv2 — every 5-digit Starlink, 8,000 objects, so it is in
  `WARMED` —, kuiper, iridium, o3b, galileo, glonass, goes), `vehicleModels.ts` (shenzhou,
  starliner, orion, dreamchaser, and `roadster`: the Tesla Roadster with Starman on its
  adapter, deep.json's `roadster` craft), `rocketModels.ts` (falcon9, falconheavy, starship,
  electron, longmarch, soyuzrocket, atlasv, vulcan, ariane6, newglenn, `launcher` = generic).
  Rockets stand along +Y, nose up, engine bells at the bottom (`modelBase` −0.5); they are built
  at true proportions (1 unit = 5 m) so they are slim. `rocketKind(name)` in `describe.ts` maps
  a Launch Library rocket name to its kind (the launch climb uses it). Rocket materials are
  painted the first time a rocket is built, not at start-up.
- **A new kind must not split a search type**: give it a `KIND_TOPIC` (`searchIndex.ts`) and a
  `KIND_NOTE` (`search.ts`) — starlinkv2 is "Starlink satellites" like starlink, or "starlink"
  would have found only the old 3,000.
- **The kind names are a contract.** The deep-space data file names models as plain strings
  (`Craft.model` in `space/types.ts`); check one with `isModelKind(name)` and fall back to
  `'probe'`. Renaming a kind breaks that file silently.
- A new kind needs: the name in `ModelKind`, a label in `KIND_LABEL`, a builder, a sentence in
  `KIND_FACT` and a place in a group (`data/spacecraft.ts`; a kind left out of the groups
  still shows, at the end). TypeScript refuses to build until the first four exist.
- Only the original 21 kinds (`WARMED` in `satModels.ts`) are built behind the loading screen.
  Everything else is built the first time it is shown (a few ms; the asteroid about 30 ms).
  Do not add to `WARMED` without a reason: start-up pays for every kind in it.
- Brightness budget: the main view has bloom and a headlight, so pale paint stays ~0.75 grey
  with high roughness and nothing large and flat is smoother than ~0.45, or it blows out.
  (The laser-ranging sphere is `dullMetal` for this reason: polished, it was one white blob.)
- Axes for builders: +X = direction of travel, +Y = away from the body the craft is shown at,
  Z = across the track. The rover and lander stand on y = 0 with +Y up; `modelBase(kind)` says
  how far below the normalised model's centre its lowest point is, to stand it on the ground.
  Dish-first probes (Voyager, Pioneer, New Horizons, `probe`) are built in a tilted frame
  (`probeFrame` in `deepModels.ts`) so the bowl shows from the usual three-quarter view.
- Booms are shorter than life on purpose (a 13 m boom on a 3.7 m dish makes the craft a dot in
  its own thumbnail), and the giant wings of Clipper, BepiColombo and Solar Orbiter a little.
- `TUMBLE` in `satModels.ts`: debris, rocket bodies and the asteroid turn slowly instead of
  flying nose-first.
- `spinner` (Fengyun-2, Meteosat 8–11) is a spin-stabilised drum; add name patterns to
  `SHAPES` in `describe.ts` before the general weather line. `SHAPES` also sends CXO to
  `chandra`, XMM-NEWTON to `xmm`, SDO to `soho`, the magnetosphere probes (MMS, THEMIS, Arase,
  TRACERS, Polar, IMAGE) to `l1monitor`, the laser-ranging spheres (LAGEOS, LARES, Starlette,
  Stella, Ajisai, Etalon, Westpac, Larets) to `lasersphere`, TDRS / Luch /
  Tianlian to `relay` and BlueWalker / SpaceMobile to `phasedarray`.
- To look at models while working on them, draw `modelThumbnail(kind)` and a few large
  renders into a throwaway page and capture it with headless Chrome over the DevTools protocol
  (as `scripts/shots.mjs` does). Check the thumbnails of the kinds you did not touch against a
  capture taken before your change: they should be byte-identical.

## Spacecraft catalogue (`ui/gallery.ts`, `ui/gallery.css`, `data/spacecraft.ts`)

- An overlay (`#gallery`, empty in `index.html`, filled the first time it opens) with a grid of
  every kind in groups and, in place of the grid, one model large: a `ModelPreview` made with
  `fit = true`, dragged round with `turn()` / `hold()`, with its label, its `KIND_FACT`
  sentence and, when the Earth catalogue has objects of that kind, "Show one in orbit".
- It opens when anything presses **`#gallery-open`** (a link in the About sheet). The Tools
  tab's "Spacecraft" tile and the home page press that button; `gallery.open(kind?)` is the
  call. It lies above the home page (`z-index: 210`, like `#howto`).
- `main.ts` gives it a host: `count(kind)` and `show(kind)`, from `ofKind()`, which sorts the
  catalogue by shape once per catalogue (oldest object first, so "a telescope" is Hubble) and
  steps to the next object each time it is asked again. The host knows only the Earth
  catalogue: craft beyond Earth orbit get no button until `count` / `show` are taught about them.
- Keys while it is open are caught on the way down (capture) and go no further: the tracker's
  one-letter shortcuts must not fire behind it, and from the home page the tracker's own key
  handler is switched off anyway. Escape steps back (model → grid → closed), arrows step
  between models, Tab stays inside.
- Thumbnails are drawn one per idle moment while it is open, into squares that already have
  their size. In the head, the title is the way back from a model (as in the Objects panel).
- The owner's rule for it: very little text, no card template look. Tiles are a hairline grid
  on `--cell`; the only prose is one sentence per model.

## Thumbnails and the hover card

- `modelThumbnail(kind)` (in `satModels.ts`) renders a model once per kind: it tries eight
  headings and two diagonal leans with an orthographic camera cropped to the model's real
  outline and keeps the pose that covers most of the square with the most light and colour.
- The inspector always has a Wikipedia link under the name (`#insp-wiki`): the article from
  `articleFor` (`data/wiki.ts`), else the object's own name tried once as a title
  (`wikiGuess`, through Wikipedia's query API so that a missing page is not an error in the
  console; accepted only if the article reads like one about something in space), else
  "Search Wikipedia". On a phone the sheet's tabs pin under the name at `--insp-head`, which
  `inspector.ts` keeps equal to the name block's real height.
- `ui/thumb.ts` shows a Wikipedia photo when the article's lead image is a photograph, else
  that render. A lead image is treated as a logo (never used as the photo) when more than
  12 % of its pixels are transparent, or, if its pixels cannot be read, when it is an `.svg`.

## Performance notes

- **The production build has no `backdrop-filter` in Chrome or Firefox.** The CSS minifier
  keeps only `-webkit-backdrop-filter` where both are written (the built stylesheet has 25 of
  those and not one unprefixed), so every "frosted" surface is frosted in Safari and in
  `npm run dev`, and plain in the built site elsewhere. Nothing depends on the blur for
  legibility any more (the home page's bar was the one place that did). If the frost is wanted
  on the live site, fix it in the build (`css.lightningcss` targets / `build.cssTarget`), and
  then look at every panel again, because none has been seen with it there.
- 3D models are built once per kind and cloned (`buildModel` cache); `prewarmModels()` builds
  the common ones and compiles their shaders behind the loading screen so selecting an
  object or changing autopilot scene does not stutter.
- While the interface is hidden (`body.ui-hidden`: H key, autopilot) the frame loop skips
  panel-only work (inspector charts, watchlist, status line).
- Drag and zoom rates in Earth-centred views scale with altitude (`cameraRig.ts`).

## Verifying a change

1. `npm run build` (zero TypeScript errors), `npm run check`, and, if hashing/look-ahead
   changed, `npm run bench`.
2. Run the dev server and exercise the feature. Check the browser console is clean. A
   background/hidden tab throttles `requestAnimationFrame` to ~2 fps, which makes camera
   flights look stuck — that is the browser, not a bug.
3. Check the phone layout at 375 × 812 as well as desktop.

Things that have never been verified on real hardware: the phone-motion sky view
(`firstPerson.ts`), geolocation end to end, Safari/iOS specifics, video recording outside
Chrome, the report's new-tab route (the test browser blocks new tabs, so only the saved-file
fallback has been seen working), the home page's bar under a real elastic overscroll, and the
search list above a real on-screen keyboard (it is sized from `visualViewport`).

## Deploying

Push to `main` → the workflow builds and publishes `dist/` to GitHub Pages. The scheduled run
(every 3 h, at 37 minutes past) downloads fresh CelesTrak, SatNOGS and JPL (deep-space) data before building, compares the new
elements with the published ones (`changes.json`), and re-enables itself so GitHub does not
pause the schedule after 60 days of inactivity.

**How often each source is asked, and why that is polite.** The schedule only sets the pace.
Every run first reads back the data the site is showing (`carry-over.mjs`, our own site), and
each download script then declines if ITS file is too young, so no source is asked more often
than its script allows however often the workflow runs (a run started by hand minutes after a
scheduled one downloads nothing, and still deploys):

| Source | Asked | Requests | Why that is within bounds |
| --- | --- | --- | --- |
| CelesTrak elements | every run, 3 h (guard 2 h) | 5, a second apart | CelesTrak refreshes about every 2 h and asks for no more than one download per update |
| CelesTrak catalogue facts | once a day (guard 23.5 h) | 1 | changes slowly; one file |
| SatNOGS | every second run, 6 h (guard 5.5 h) | at most 22, 1.5 s apart | 6 h is how far back one download's reports reach, so "last heard" has no gaps; more often would repeat the same pages |
| JPL Horizons and CNEOS | every second run, 6 h (guard 5.5 h) | about 130, strictly one at a time, 1.1 s apart | JPL asks for no parallel requests; the craft follow paths predicted weeks ahead, so more often would gain nothing |

The guards are half an hour short of their round figure on purpose: the run that is due
starts a few minutes less than 6 h after the last download finished, and an exact 6 would
turn it away. Before this, the guards were measured against the weeks-old copies in the
repository and never held: every run asked everyone. Each download step has its own time
limit and may fail (`continue-on-error`); a source that is down, or a guard that declines,
costs that refresh and never the deployment, and the site keeps the data it had. Never raise
the pace for CelesTrak past one download per 2 hours, and do not run the fetch scripts with
`--force` in CI. A push build downloads nothing from outside:
`scripts/carry-over.mjs` reads the data files back from the published site and keeps each one
that parses, has the same top-level fields as the repository's copy and is newer, so a push
never puts the site back on older data or drops the orbit-change list. Runs queue rather
than cancel each other (`cancel-in-progress: false`): the first scheduled refresh was once
cancelled by a push that arrived seconds later, and the data stayed two days old. The job has a
45-minute limit so a hung run cannot hold the queue. `vite.config.ts` uses `base: './'`,
so the site works from any sub-path.

## Ideas not built yet

Beyond Earth orbit: a camera lock switch on a craft's card (today closing the card lets go
of it), the paths of rovers across the ground, eclipses and transits called out as they happen.

Multiplayer games on a separate `/play` page (needs a small real-time service such as
Firebase or Supabase; Pages cannot provide one),
a rewind of historic collisions, a congestion dashboard, poster export, pointing the phone
sky view at a chosen pass.
