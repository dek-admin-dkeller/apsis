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
npm run fetch-data   # textures + CelesTrak elements + SATCAT facts into public/ (2 h / 24 h guards)
npm run fetch-radio  # SatNOGS radio records into public/data/radio.json (6 h guard; also run by CI)
npm run shots        # retake the home page's product pictures (needs Chrome and the dev server running)
npm run build-borders  # regenerate public/data/borders.bin from the world-atlas package
npm run check        # the feature checks (orbit changes, visible passes, report, decay, command bar); exits 1 on a failure
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
  `launch.css`).
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
  through `jumpTo()` (it calls `sim.reset()`).
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
  as 55 pairs at "0 m". Each such spacecraft is ONE row in "Flying together", and choosing it
  (or any pair that `joinedNow()` in `main.ts` finds to be joined) selects the spacecraft
  instead of opening a close-approach view — that view showed one model and "0 m", which the
  owner reported as a bug. `scripts/check-groups.mjs` tests it.
- `render/gridViz.ts` has a pair mode (`PairCells`): with a close approach open it draws the
  two objects' cells, A's 27-cell block, and turns both red while range < d.
- Other hash tables are listed in the README ("Other places hashing is used").

## Source map

```
src/main.ts                 creates every module, per-frame loop, keyboard, share links, home/reset
src/data/                   catalog, categorize, describe (operator/purpose/model kind from the name), ephemeris
                            (orbit series, look angles, passes, closest approach), satcat, wiki (name → article),
                            regions ("over the South Pacific"), crew (people in space), types; and for the feature
                            modules: radio + doppler (SatNOGS records, Doppler shift), changes (compare two downloads),
                            decay + spaceWeather (time left, NOAA flux and Kp), launches (Launch Library 2), visibility
                            (bright passes), approachData (report numbers), places (cities for the command bar)
src/hashing/                SpatialHash, conjunction, lookahead, benchmark, groups (union–find)
src/worker/                 sim.worker (+ SimClient, protocol, propagate), lookahead.worker, tonight.worker (visible passes)
src/render/                 scene (renderer, bloom, quality presets), globe (Earth shader), tiles (close-up ground:
                            NASA GIBS map tiles streamed in below ~6,000 km), geoOverlay (borders, grid, terminator), sky (Milky Way, stars, constellations, planets, Sun, Moon), aurora, satellites
                            (the point cloud, colour modes, highlighting, picking), satModels (21 procedural models,
                            previews, thumbnails), cameraRig (fly-to, object focus, Earth drift), firstPerson (ride-along,
                            sky view, phone motion), orbitLine, groundTrack, encounterViz (close-approach drawing),
                            conjunctionMarkers, gridViz, constellation (orbits + coverage map), siteMarker, padMarkers
src/features/               optional modules installed through the App interface (see "Feature modules"): radio, changes,
                            weather, launches, tonight (+ tonightWords), report (+ reportPage), growth, command (+ commandParse)
src/ui/                     app (the App interface), featureList (every feature, drawn on the home page), objectTabs (the
                            Objects panel's three tabs), inspector (+ charts), monitor (live pairs), ahead (prediction), encounterPanel, howto
                            (walkthrough), hashTrace, benchmarkModal, filters, search, settings, timeControls, labels,
                            watchlist, feed (launches, trains, lowest), designer, constellations, contacts, crew,
                            share (QR), tour, cinema (autopilot + recording), sheet (phone sheets), landing (welcome
                            page), launch + intro (loading screen), dom (DOM, number, unit and clock helpers)
index.html                  all static markup; ids are the contract between HTML and the ui modules
scripts/                    fetch-data.mjs, fetch-radio.mjs, diff-elements.mjs (writes changes.json), carry-over.mjs (push
                            builds keep the published data), build-borders.mjs, bench.mjs, shots.mjs, and the checks behind
                            `npm run check`: check-changes, check-visibility, check-report, decay-check, test-command, check-groups
public/                     data/ (satellites.json, satcat.json, radio.json, borders.bin; changes.json exists only in the
                            published site), shots/, textures/, icons/, manifest.webmanifest
.github/workflows/deploy.yml  build + deploy to Pages; every 8 h it refreshes CelesTrak and SatNOGS data first (not committed
                            back); a push build keeps the data the site already shows (carry-over.mjs)
```

## UI structure (desktop)

Home page first (`#landing`, `src/ui/landing.ts`, `landing.css`): static markup painted before
any script, with the tracker loading behind it. It is built to SHOW the tracker, not describe
it (the owner found a text-only page bland):
- **Opening screen:** once the tracker has loaded, `boot()` calls `loading.skip()` and
  `landing.goLive()`; the page's backdrop fades (`is-live`) and the LIVE globe shows through,
  held closer than the home view and moved beside the headline by `updateViewShift()`
  (`heroShift`). Until then, and without WebGL, the headline stands alone on a plain dark
  backdrop: **nothing animates on the opening screen while the tracker loads** (an orbit
  drawing used to; it stuttered during loading and the owner had it removed). While the page is
  up `body.home-open` hides the tracker's controls, shortcuts are off, and the globe is drawn
  every frame only while the opening screen is in view.
- **The bar at the top is not inside the element that scrolls.** `#landing` is a fixed flex
  column: `.ld-top`, then `#landing-scroll` (`.ld-scroll`, `overscroll-behavior: none`). With
  the bar `position: sticky` inside the scroller, the elastic bounce past the top of the page
  pulled it away from the top edge. `landing.ts` passes a wheel turned over the bar on to the
  scroller and sets `is-scrolled` (solid bar) once the page has moved.
- **Showcase:** real screens in `public/shots/*.webp`, listed in `SHOTS` (`featureList.ts`).
  Retake them with `npm run shots` (`scripts/shots.mjs`: headless Chrome driven over the
  DevTools protocol against the running dev server) whenever the interface changes visibly.
- **How it works:** `src/ui/hashDemo.ts`, a 2D canvas that files dots in the real
  `SpatialHash` and draws either every pair or only the neighbours the table offers.
- **Spacecraft plate:** `modelThumbnail()` for every `ModelKind`, drawn in idle moments once
  the tracker is live and the plate is near the screen.
- **Index:** `FEATURES` (`featureList.ts`) as rows of names with one line of text each.
- A deliberately quiet "Games" row, then a small section that explains the name (the orbit
  drawing with its two apsides marked, `.ld-name`), then the footer.
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
status line. Overlays: `#howto`, `#keys`, `#about`, `#share-dialog`, `#bench`, `#contacts`.

The Objects panel has three tabs (`src/ui/objectTabs.ts`): **Browse** (watchlist, notable
objects, type / orbit filters, appearance), **Activity** (visible tonight, launches, orbit
changes, newest, trains, lowest orbits) and **Tools** (constellations, growth by year,
designer). Every section is still one `<details class="sec">` in `index.html`, with
`data-tab` (which tab) and `data-section` (the name code opens it by: `app.openSection(name)`,
used by the command bar). A section opened by code brings its own tab forward (a captured
`toggle` listener), so nothing needs to know which tab a section is in. Activity and Tools
sections share a `name` attribute, so the browser keeps one open at a time, and their closed
summaries carry a one-line description (`.sum-text small`). A new section goes into the tab
that matches what the visitor is doing, never into a fourth tab or a longer Browse.

Settings are generic: any control with `data-setting="name"` edits `Settings[name]`
(`src/ui/settings.ts`), persisted in `localStorage`. To add a toggle: add the field + default
in `settings.ts`, a control in `index.html`, and apply it in `applySettings()` in `main.ts`.

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

Phone idle fade: while the globe drifts by itself (`rig.drifting`) and nothing has been
touched for 4 s, `updatePhoneRest()` in `main.ts` puts `m-rest` on `<body>` and `mobile.css`
section 11 dims the search pill, round buttons and tab bar to half. Any `pointerdown` removes
it at once. Never while a sheet, the menu, the time controls or the tour is open.

Phone sky view: the `#m-sky` button calls `skyFromPhone()` in `main.ts`, which asks for the
location (and, on iOS, the motion sensors) straight from the tap, then enters the sky view
with `sky-immersive` on `<body>`: `firstPerson.css` hides the whole interface and leaves only
a faint close button (the banner's own Exit button, restyled), any message, and "Set north"
when the phone has no compass. Taps do not select objects in that mode.

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
| `tonight.ts` | `#tonight-body` | Bright passes in the next 24 h, computed in `worker/tonight.worker.ts` only when asked |
| `report.ts` | `#enc-export` | Close-approach report (new tab, or a saved file if the tab is blocked) and CSV |
| `growth.ts` | `#growth-body` | Year slider; registers one filter with `app.setFilter('growth', …)`; cleared by Home (`app.onHome`) |
| `command.ts` | its own overlay | Ctrl/Cmd+K; anything with `data-command-open` opens it; `commandParse.ts` holds the grammar |

To add a feature: write the module, reserve an element if it needs one (in the Objects panel:
a `<details class="sec" data-tab data-section>` in the right tab), add one import and one name
to the installer list in `main.ts`, extend `App` only if the module needs something new, and
add its entry to `featureList.ts`.

**A feature module must ask `app` about the program's state, never the page.** The command bar
once decided whether it could open by testing `document.getElementById('landing')`; when the
home page stopped being removed from the document, the bar silently never opened again. It
now asks `app.ready()`. If a module needs to know something `App` cannot tell it, add a getter.

## Browser storage keys

`orbithash.settings.v2` (settings), `apsis.watchlist`, `apsis.stations`,
`apsis.tour.seen`, `apsis.location.consent`, `apsis.weather` (NOAA readings, 3 h),
`apsis.launches` (launch list, 1 h), `apsis.reloads` (the one-reload guard after a lost
graphics context).

## Outside services (all optional at run time; the app works offline without them)

CelesTrak (manual refresh; scheduled in CI), Wikipedia REST summary (photos/descriptions,
cached per article), NOAA SWPC (aurora grid, Kp, solar flux), a public people-in-space list
(`src/data/crew.ts`), NASA GIBS map tiles (`src/render/tiles.ts`, only while zoomed in and
only with the `sharpGround` setting on), Launch Library 2 from The Space Devs (only when the
launches section is opened; about 15 requests an hour are allowed, the answer is kept for an
hour), nothing else from the browser. SatNOGS is read at BUILD time only
(`scripts/fetch-radio.mjs`, 6 h guard, at most 22 requests; its API sends no CORS headers,
and its data is CC BY-SA and credited in About). No analytics, no accounts. Location is used only after
an in-app yes plus the browser's own prompt, and stays in `localStorage`.

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

## 3D models (`render/satModels.ts`)

- 21 kinds (`ModelKind` in `data/describe.ts`), each a builder in `BUILDERS`, built once,
  merged by material, normalised and cloned by `buildModel(kind)`. Materials are shared
  (`makeMaterials()`): painted canvas textures, normal maps computed from painted height
  fields, and a small painted environment map so foil and glass glint.
- Brightness budget: the main view has bloom and a headlight, so pale paint stays ~0.75 grey
  with high roughness and nothing large and flat is smoother than ~0.45, or it blows out.
- Axes for builders: +X = direction of travel, +Y = away from Earth, Z = across the track.
- `spinner` (Fengyun-2, Meteosat 8–11) is a spin-stabilised drum; add name patterns to
  `SHAPES` in `describe.ts` before the general weather line.

## Thumbnails and the hover card

- `modelThumbnail(kind)` (in `satModels.ts`) renders a model once per kind: it tries eight
  headings and two diagonal leans with an orthographic camera cropped to the model's real
  outline and keeps the pose that covers most of the square with the most light and colour.
- `ui/thumb.ts` shows a Wikipedia photo when the article's lead image is a photograph, else
  that render. A lead image is treated as a logo (never used as the photo) when more than
  12 % of its pixels are transparent, or, if its pixels cannot be read, when it is an `.svg`.

## Performance notes

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
fallback has been seen working), and the home page's bar under a real elastic overscroll.

## Deploying

Push to `main` → the workflow builds and publishes `dist/` to GitHub Pages. The scheduled run
(every 8 h) downloads fresh CelesTrak and SatNOGS data before building, compares the new
elements with the published ones (`changes.json`), and re-enables itself so GitHub does not
pause the schedule after 60 days of inactivity. A push build downloads nothing from outside:
`scripts/carry-over.mjs` reads the data files back from the published site and keeps each one
that parses, has the same top-level fields as the repository's copy and is newer, so a push
never puts the site back on older data or drops the orbit-change list. Runs queue rather
than cancel each other (`cancel-in-progress: false`): the first scheduled refresh was once
cancelled by a push that arrived seconds later, and the data stayed two days old. `vite.config.ts` uses `base: './'`,
so the site works from any sub-path.

## Ideas not built yet

Multiplayer games on a separate `/play` page (needs a small real-time service such as
Firebase or Supabase; Pages cannot provide one; the home page has a placeholder "Games" row),
a rewind of historic collisions, a congestion dashboard, poster export, pointing the phone
sky view at a chosen pass.
