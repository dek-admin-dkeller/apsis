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
npm run build-borders  # regenerate public/data/borders.bin from the world-atlas package
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
- `render/gridViz.ts` has a pair mode (`PairCells`): with a close approach open it draws the
  two objects' cells, A's 27-cell block, and turns both red while range < d.
- Other hash tables are listed in the README ("Other places hashing is used").

## Source map

```
src/main.ts                 creates every module, per-frame loop, keyboard, share links, home/reset
src/data/                   catalog, categorize, describe (operator/purpose/model kind from the name), ephemeris
                            (orbit series, look angles, passes, closest approach), satcat, wiki (name → article),
                            regions ("over the South Pacific"), crew (people in space), types
src/hashing/                SpatialHash, conjunction, lookahead, benchmark
src/worker/                 sim.worker (+ SimClient, protocol, propagate), lookahead.worker
src/render/                 scene (renderer, bloom, quality presets), globe (Earth shader), tiles (close-up ground:
                            NASA GIBS map tiles streamed in below ~6,000 km), geoOverlay (borders, grid, terminator), sky (Milky Way, stars, constellations, planets, Sun, Moon), aurora, satellites
                            (the point cloud, colour modes, highlighting, picking), satModels (20 procedural models,
                            previews, thumbnails), cameraRig (fly-to, object focus, Earth drift), firstPerson (ride-along,
                            sky view, phone motion), orbitLine, groundTrack, encounterViz (close-approach drawing),
                            conjunctionMarkers, gridViz, constellation (orbits + coverage map), siteMarker
src/ui/                     inspector (+ charts), monitor (live pairs), ahead (prediction), encounterPanel, howto
                            (walkthrough), hashTrace, benchmarkModal, filters, search, settings, timeControls, labels,
                            watchlist, feed (launches, trains, lowest), designer, constellations, contacts, crew,
                            share (QR), tour, cinema (autopilot + recording), sheet (phone sheets), landing (welcome
                            page), launch + intro (loading screen), dom (DOM, number, unit and clock helpers)
index.html                  all static markup; ids are the contract between HTML and the ui modules
scripts/                    fetch-data.mjs, build-borders.mjs, bench.mjs
public/                     data/ (satellites.json, satcat.json, borders.bin), textures/, icons/, manifest.webmanifest
.github/workflows/deploy.yml  build + deploy to Pages; every 8 h it refreshes CelesTrak data first (not committed back)
```

## UI structure (desktop)

Welcome page first (`#landing`, `src/ui/landing.ts`): static markup painted before any
script, the tracker loading behind it; `boot()` waits on `landing.entered` before the loading
screen's lift-off. An inline script in `index.html` skips it for share links (any `#hash`)
and when `Settings.landing` is off.

Top bar (logo = home/reset, search, readouts, tools; picture and video sit in the
`#capture` menu so they cannot be hit by accident) · left tool rail opening ONE panel at a
time (`panel-objects`, `panel-layers`, `panel-conj`, `panel-settings`) · right dock holding
`#inspector` or `#encounter` · bottom time bar (rests as a small pill, opens on hover) ·
status line. Overlays: `#howto`, `#keys`, `#about`, `#share-dialog`, `#bench`, `#contacts`.

Settings are generic: any control with `data-setting="name"` edits `Settings[name]`
(`src/ui/settings.ts`), persisted in `localStorage`. To add a toggle: add the field + default
in `settings.ts`, a control in `index.html`, and apply it in `applySettings()` in `main.ts`.

Phones (≤ 760 px, `src/mobile.css`): floating search pill, round buttons on the right edge
(location, views menu, share), a floating 4-item tab bar (the rail), panels as rounded bottom
sheets draggable by their header (`src/ui/sheet.ts` sets `--sheet`). `main.ts` shifts the
camera's view offset up while a sheet is open. Section 7 of `mobile.css` is the current
phone look (short, narrow tab bar; smaller round buttons); in the object sheet `#inspector`
itself is the scroller there — the name and the tabs are `position: sticky`, the photo and
switches scroll away. `sheet.ts`'s `tallest` must match `--top` and `--status`.

## Browser storage keys

`orbithash.settings.v2` (settings), `apsis.watchlist`, `apsis.stations`,
`apsis.tour.seen`, `apsis.location.consent`.

## Outside services (all optional at run time; the app works offline without them)

CelesTrak (manual refresh; scheduled in CI), Wikipedia REST summary (photos/descriptions,
cached per article), NOAA SWPC (aurora grid, Kp), a public people-in-space list
(`src/data/crew.ts`), NASA GIBS map tiles (`src/render/tiles.ts`, only while zoomed in and
only with the `sharpGround` setting on), nothing else. No analytics, no accounts. Location is used only after
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

- The globe texture is ~10 km per pixel. Below ~6,000 km altitude `EarthTiles.update()` picks a
  web-map zoom level (5–8) whose pixels match screen pixels, and covers the centre of the view
  (out to the screen corners, at most 11 × 11 tiles) with curved patches that are children of
  `globe.earth`, lifted 0.09 % above the surface and lit with the same Sun term as the globe.
- Tiles are alpha-blended over the globe: fully covering near the ground, 60 % from far away
  (so the globe's clouds still show). They are drawn on the night side as well (the first
  version faded them out there, which read as "not working" to anyone zooming in after dark):
  the night tone equals the globe's from far away and rises to bright moonlight near the
  ground, and the globe's city-lights texture (the same uniform objects, borrowed from the
  Earth material) is added through a 16-tap cubic B-spline, because its real detail is ~20 km
  and plain linear filtering shows as squares.
- Loading is hidden three ways (see the header of `tiles.ts`): a BACKDROP layer two zoom
  levels coarser under the sharp layer (arrives first, reaches further); both layers fade out
  towards the rim of what they cover (`uEdge`, centred on `uCentre`), so no chunk edge shows
  in tilted views; and tiles are fetched AHEAD — for `rig.destination` during a camera flight,
  or along the direction of travel while following a satellite. Old tiles stay until the new
  view is complete. At high ground speed (fast time while following) the sharp zoom is lowered.
  Pictures are fetched with `fetch` + `createImageBitmap` (decoded off the main thread) and
  stale downloads are aborted. `tiles.prewarm()` compiles the shader behind the loading screen.
- `tiles.status` feeds About → "This device" (off / service not reachable / N tiles shown).
- Tile cache is a `Map<"z/x/y", Tile>` with least-recently-used eviction (200 tiles), at most
  8 downloads in flight, and a 30 s back-off if the service cannot be reached.

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

1. `npm run build` (zero TypeScript errors) and, if hashing/look-ahead changed, `npm run bench`.
2. Run the dev server and exercise the feature. Check the browser console is clean. A
   background/hidden tab throttles `requestAnimationFrame` to ~2 fps, which makes camera
   flights look stuck — that is the browser, not a bug.
3. Check the phone layout at 375 × 812 as well as desktop.

Things that have never been verified on real hardware: the phone-motion sky view
(`firstPerson.ts`), geolocation end to end, Safari/iOS specifics, video recording outside
Chrome.

## Deploying

Push to `main` → the workflow builds and publishes `dist/` to GitHub Pages. The scheduled run
(every 8 h) downloads fresh CelesTrak data before building and re-enables itself so GitHub
does not pause the schedule after 60 days of inactivity. `vite.config.ts` uses `base: './'`,
so the site works from any sub-path.

## Ideas not built yet

Multiplayer games on a separate `/play` page (needs a small real-time service such as
Firebase or Supabase; Pages cannot provide one), a rewind of historic collisions, a
congestion dashboard, a growth-by-year slider, poster export, a command bar.
