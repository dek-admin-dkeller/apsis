/**
 * Sharp ground when you zoom in.
 *
 * The globe's own picture is one 4096-pixel image of the whole planet: about 10 km per
 * pixel, which turns to mush from a few hundred kilometres up. So, like a map app, the
 * part of the Earth being looked at is re-covered with small, detailed image tiles fetched
 * on demand — NASA's Blue Marble from the public GIBS service, up to ~600 m per pixel
 * (sixteen times finer). Far away nothing is fetched and the original picture is used.
 *
 * Tiles are the standard "web map" pyramid: at zoom z the world is 2^z × 2^z squares in the
 * Mercator projection. Each tile here is a small curved patch of sphere sitting just above
 * the surface, a child of the rotating Earth, shaded the same way as the globe: the same
 * Sun by day, and at night a dim moonlit tone with the globe's city lights on top. Close to
 * the ground that night tone is brighter than the globe's, otherwise a zoomed-in view of the
 * night side would be too dark to show any of the extra detail.
 *
 * WHICH tiles are shown depends only on WHERE THE CAMERA IS, never on which way it is
 * looking: they form rings around the point on the ground straight below the camera — the
 * sharpest level in the middle, then coarser and coarser levels reaching out to the horizon.
 * (An earlier version chose tiles around the middle of the picture. Turning the camera around
 * a satellite then swept that point across half a continent and every small movement
 * swapped the whole set: the ground flickered.) With rings, turning the camera changes
 * nothing, and moving it only adds tiles at the outer edge of each ring.
 *
 * Four things keep the loading from being noticed:
 *
 *   1. RINGS FADE AT THEIR RIM. Each level's outer edge fades out over the next coarser level
 *      (the same picture, less sharp), and the coarsest fades into the globe. So no level
 *      ends in a visible line, and a tile that arrives at the rim is still transparent there.
 *   2. COARSE FIRST. The coarse levels are a handful of pictures and arrive almost at once;
 *      the sharp level fades in over them, which looks like focusing, not like squares
 *      popping in.
 *   3. LOOKING AHEAD. While the camera is flying somewhere the tiles for its destination are
 *      fetched before it arrives, and while it follows a satellite the tiles ahead of it are.
 *   4. NOTHING IS REMOVED UNTIL ITS REPLACEMENT IS READY. Tiles of the previous view stay on
 *      screen until the new view's tiles have all arrived.
 *
 * Tiles are remembered in a Map keyed by "z/x/y" (a hash table again): asking "do I already
 * have this tile?" is O(1), and the least recently used ones are dropped beyond a limit.
 */

import * as THREE from 'three';
import { EARTH_RADIUS } from './scene.ts';

const SOURCE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8';
const NEAR_ZOOM = 5; // tiles are used once the view calls for at least this zoom; further out the globe's own image is as sharp
const MAX_ZOOM = 8; // the finest level the service has
const LOW_ZOOM = 2; // the coarsest level ever drawn
const SHARP_REACH_MAX = 4; // the sharpest level reaches at most this many tiles out from the centre (9 × 9 tiles)
const RING_REACH = 2; // every coarser level: 5 × 5 of its (larger) tiles
const RIM = 0.72; // a level is solid out to this share of its radius, then fades to nothing at the edge
const KEEP = 260; // tiles kept in memory
const AT_ONCE = 16; // downloads in flight
const LINGER = 2.5; // seconds a tile of the previous view may stay while the new view loads
const MERCATOR_LIMIT = 85.0511; // the projection has no tiles beyond this latitude
const KM_PER_RADIAN = 6371;

interface Tile {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  texture: THREE.Texture | null;
  bitmap: ImageBitmap | null;
  state: 'idle' | 'loading' | 'ready' | 'failed';
  cancel: AbortController | null; // set while its picture is downloading
  retryAt: number; // for a failed tile: when to try again (real seconds)
  usedAt: number; // last time any plan asked for it (real seconds) — for eviction
  shownAt: number; // last time the CURRENT view needed it on screen
  opacity: number;
  z: number;
}

/** What a camera position needs: rings of tiles around the point straight below it. */
interface View {
  centre: THREE.Vector3; // the point on the ground below the camera (unit vector, Earth frame)
  lat: number; // of that point, degrees
  lon: number;
  altitudeKm: number;
  kmPerPixel: number; // how much ground one screen pixel covers, looking straight down
  zoom: number; // the tile zoom whose pixels would match that exactly (a fraction, not yet rounded)
}

/** One ring: a zoom level and how many of its tiles it reaches out from the centre. */
interface Ring {
  z: number;
  reach: number;
  radius: number; // the angle from the centre it is certain to cover, radians
}

interface Pick {
  key: string;
  z: number;
  x: number;
  y: number;
  rank: number; // download order: lower first
  visible: boolean; // part of the current view (false = fetched ahead of time only)
}

/** Where a camera flight will end. */
export interface Destination {
  pos: THREE.Vector3;
  target: THREE.Vector3;
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalLocal;
  void main() {
    vUv = uv;
    vNormalLocal = normalize(position); // the patch is part of a sphere centred on the Earth
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform sampler2D uNight; // the globe's city-lights picture (whole Earth)
  uniform float uHasNight;
  uniform vec2 uNightTexel; // size of one pixel of that picture, in texture coordinates
  uniform vec3 uSun;      // direction to the Sun in the Earth's own (rotating) frame
  uniform float uOpacity; // fades the tile in once its picture has arrived
  uniform float uCover;   // how completely the tile hides the globe's own (blurrier) picture
  uniform float uClose;   // 0 far away … 1 near the ground
  uniform vec3 uCentre;   // the point on the ground in the middle of the view (unit vector, Earth frame)
  uniform vec2 uEdge;     // fade out between these two distances from uCentre (y = 0: no fade)
  varying vec2 vUv;
  varying vec3 vNormalLocal;

  // The city-lights picture read with a cubic B-spline: the 4 × 4 neighbouring cells blended
  // by a smooth bell curve, on a grid twice as coarse as the picture's pixels (its real
  // detail). Ordinary linear filtering leaves every cell's outline visible when magnified
  // this much; the spline has no creases, so the squares become a glow.
  vec4 bell(float f) {
    float f2 = f * f, f3 = f2 * f;
    return vec4(1.0 - 3.0 * f + 3.0 * f2 - f3, 4.0 - 6.0 * f2 + 3.0 * f3, 1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3, f3) / 6.0;
  }
  vec3 softLights(vec2 uv) {
    vec2 cell = uNightTexel * 2.0;
    vec2 p = uv / cell - 0.5;
    vec2 f = fract(p);
    vec2 corner = (p - f - 0.5) * cell; // centre of the cell one up and one left of this one
    vec4 wx = bell(f.x), wy = bell(f.y);
    vec3 sum = vec3(0.0);
    for (int j = 0; j < 4; j++) {
      for (int i = 0; i < 4; i++) {
        sum += wx[i] * wy[j] * texture2D(uNight, corner + vec2(float(i), float(j)) * cell).rgb;
      }
    }
    return sum;
  }

  void main() {
    vec3 N = normalize(vNormalLocal);
    float sun = dot(N, uSun);
    float day = smoothstep(-0.10, 0.20, sun);          // same day / night edge as the globe
    vec3 ground = texture2D(uMap, vUv).rgb;
    vec3 lit = ground * (0.05 + 1.1 * max(sun, 0.0));  // same daylight as the globe

    // Night: far away, exactly the globe's faint tone; near the ground, bright moonlight.
    vec3 moonlight = mix(vec3(0.030, 0.038, 0.060), vec3(0.105, 0.135, 0.205), uClose);
    vec3 night = ground * moonlight + vec3(0.0022, 0.0030, 0.0055);

    // City lights, looked up in the globe's whole-Earth picture by latitude and longitude.
    // (Tiles stop short of the poles, so N.x and N.z are never both zero here.)
    // That picture is coarse (its detail is ~20 km), so from close up it would be drawn as
    // visible squares. softLights() below reads it through a smooth curve instead, turning
    // the squares into a glow; it is also dimmed a little near the ground so the sharper
    // detail underneath shows.
    // (Sixteen texture reads: skipped entirely in daylight, where the lights are off anyway.)
    float lightsOn = 1.0 - smoothstep(-0.14, 0.03, sun);
    vec3 lights = vec3(0.0);
    if (uHasNight > 0.5 && lightsOn > 0.002) {
      vec2 lonLat = vec2(0.5 + atan(-N.z, N.x) / 6.2831853, 0.5 + asin(clamp(N.y, -1.0, 1.0)) / 3.1415927);
      vec3 nightTex = softLights(lonLat);
      float brightness = max(nightTex.r, max(nightTex.g, nightTex.b));
      lights = nightTex * mix(vec3(1.36, 0.94, 0.54), vec3(1.16, 1.08, 0.92), smoothstep(0.25, 0.90, brightness)) * 1.55;
      lights *= mix(1.0, 0.62, uClose);
    }

    vec3 color = mix(night, lit, day) + lights * lightsOn;
    // The outer rim of the covered area melts into the globe instead of ending in a line.
    float rim = uEdge.y > uEdge.x ? 1.0 - smoothstep(uEdge.x, uEdge.y, length(N - uCentre)) : 1.0;
    gl_FragColor = vec4(clamp(color, 0.0, 4.0), clamp(uOpacity * uCover * rim, 0.0, 1.0));
  }`;

export class EarthTiles {
  enabled = true;
  private readonly group = new THREE.Group();
  private readonly tiles = new Map<string, Tile>();
  // One uniform object shared by every tile for each value that is the same for all of them.
  private readonly sun = { value: new THREE.Vector3(1, 0, 0) };
  private readonly cover = { value: 1 };
  private readonly close = { value: 0 };
  private readonly centre = { value: new THREE.Vector3(1, 0, 0) };
  private readonly edges = new Map<number, { value: THREE.Vector2 }>(); // zoom level → where its rim fade starts and ends
  private readonly nightMap: { value: THREE.Texture | null };
  private readonly hasNightMap: { value: number };
  private readonly nightTexel = { value: new THREE.Vector2(1 / 4096, 1 / 2048) };
  private readonly earth: THREE.Object3D;
  private wanted: string[] = []; // tiles to have in memory, most urgent first
  private needed = new Set<string>(); // tiles the current view shows
  private loading = 0;
  private lastPlan = -Infinity;
  private lastCentre: THREE.Vector3 | null = null;
  private lastCentreAt = 0;
  private speed = 0; // how fast the camera is passing over the ground, km per real second (smoothed)
  private sharpest = 0; // the zoom level currently used for the middle ring (0 = none yet)
  private timeRate = 1;
  private now = 0;
  private offline = false; // the service could not be reached: stop asking for a while
  private offlineSince = 0;

  constructor(earth: THREE.Object3D) {
    this.earth = earth;
    earth.add(this.group);
    // Borrow the globe's city-lights picture: the same uniform objects, so it arrives here
    // the moment the globe has loaded it.
    const globeUniforms = ((earth as THREE.Mesh).material as THREE.ShaderMaterial | undefined)?.uniforms;
    this.nightMap = globeUniforms?.uNight ?? { value: null };
    this.hasNightMap = globeUniforms?.uHasNight ?? { value: 0 };
  }

  /** Number of detailed tiles on screen (for About → "This device"). */
  get shown(): number {
    let n = 0;
    for (const tile of this.tiles.values()) if (tile.mesh.visible) n++;
    return n;
  }

  /** One short phrase for About → "This device", so a "no sharp ground" report can be diagnosed. */
  get status(): string {
    if (!this.enabled) return 'sharp ground off';
    if (this.offline) return 'sharp ground: imagery service not reachable';
    const shown = this.shown;
    return shown > 0 ? `sharp ground: ${shown} tiles shown` : 'sharp ground: none needed at this distance';
  }

  /**
   * Compile the tile shader ahead of time (behind the loading screen), so the first zoom-in
   * does not pause for it.
   */
  prewarm(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    const key = `${LOW_ZOOM}/0/0`;
    if (!this.tiles.has(key)) this.create(key, LOW_ZOOM, 0, 0);
    const tile = this.tiles.get(key)!;
    tile.mesh.visible = true;
    renderer.compile(scene, camera);
    tile.mesh.visible = false;
  }

  /**
   * Call every frame. `sunDirection` is in scene coordinates. `ahead` says where the camera
   * is flying to, if it is (asked a few times a second). `timeRate` is how fast simulated
   * time is running (1 = real time).
   */
  update(camera: THREE.PerspectiveCamera, sunDirection: THREE.Vector3, realSeconds: number, dt: number, ahead?: () => Destination | null, timeRate = 1): void {
    this.now = realSeconds;
    this.timeRate = timeRate;
    const toEarth = this.earth.getWorldQuaternion(new THREE.Quaternion()).invert();
    // The Sun as seen from the turning Earth: undo the Earth's rotation.
    this.sun.value.copy(sunDirection).applyQuaternion(toEarth);

    const eye = this.earth.worldToLocal(camera.position.clone());
    const altitude = eye.length() - EARTH_RADIUS;
    this.close.value = 1 - THREE.MathUtils.smoothstep(altitude, 1.5, 5);
    const lightsPicture = this.nightMap.value?.image as { width?: number; height?: number } | undefined;
    if (lightsPicture?.width && lightsPicture.height) this.nightTexel.value.set(1 / lightsPicture.width, 1 / lightsPicture.height);
    // The rings are centred on the point below the camera, followed every frame so they glide.
    if (altitude > 0) this.centre.value.copy(eye).normalize();

    if (realSeconds - this.lastPlan > 0.25) {
      this.lastPlan = realSeconds;
      this.plan(camera, ahead?.() ?? null, realSeconds);
    }

    // Fade tiles in and out. A tile of the previous view lingers until the new view is complete.
    let complete = true;
    for (const key of this.needed) {
      const state = this.tiles.get(key)?.state;
      if (state === 'idle' || state === 'loading') {
        complete = false;
        break;
      }
    }
    for (const [key, tile] of this.tiles) {
      if (tile.state !== 'ready') continue;
      const wanted = this.needed.has(key) || (!complete && realSeconds - tile.shownAt < LINGER);
      tile.opacity = wanted ? Math.min(1, tile.opacity + dt * 3.5) : Math.max(0, tile.opacity - dt * 2.5);
      tile.material.uniforms.uOpacity.value = tile.opacity;
      tile.mesh.visible = tile.opacity > 0.003;
    }
  }

  /** What does a camera at this position (scene coordinates) need? Null when it is too far away for tiles to help. */
  private look(eyeWorld: THREE.Vector3, fov: number): View | null {
    const eye = this.earth.worldToLocal(eyeWorld.clone());
    const altitudeKm = (eye.length() - EARTH_RADIUS) * 1000;
    if (altitudeKm > 6000 || altitudeKm <= 0) return null;
    const centre = eye.normalize();
    const lat = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(centre.y, -1, 1)));
    const lon = THREE.MathUtils.radToDeg(Math.atan2(-centre.z, centre.x));
    if (Math.abs(lat) > MERCATOR_LIMIT - 1) return null;
    const kmPerPixel = (altitudeKm * 2 * Math.tan(THREE.MathUtils.degToRad(fov / 2))) / window.innerHeight;
    const kmPerTilePixelAtZoom0 = (40075 * Math.cos(THREE.MathUtils.degToRad(lat))) / 256;
    const zoom = Math.log2(kmPerTilePixelAtZoom0 / kmPerPixel);
    if (zoom < NEAR_ZOOM - 0.5) return null;
    return { centre, lat, lon, altitudeKm, kmPerPixel, zoom };
  }

  /**
   * The rings for a view whose middle ring is at zoom `sharp`: that level out to the corners
   * of the screen, then coarser levels, each reaching twice as far as the last useful one,
   * until the horizon is covered.
   */
  private rings(view: View, sharp: number): Ring[] {
    const tileKm = (40075 * Math.cos(THREE.MathUtils.degToRad(view.lat))) / 2 ** sharp;
    const halfDiagonalKm = (view.kmPerPixel * Math.hypot(window.innerWidth, window.innerHeight)) / 2;
    // The sharp level should be SOLID out to the screen's corners (seen straight down), so
    // its faded rim is allowed for by dividing by RIM.
    const sharpReach = THREE.MathUtils.clamp(Math.ceil(halfDiagonalKm / tileKm / RIM), RING_REACH, SHARP_REACH_MAX);
    const horizon = Math.acos(6371 / (6371 + view.altitudeKm)); // angle from below the camera to the edge of the visible Earth
    const rings: Ring[] = [{ z: sharp, reach: sharpReach, radius: this.certain(sharp, view.lat, sharpReach) }];
    for (let z = sharp - 1; z >= LOW_ZOOM && rings[rings.length - 1].radius < horizon; z--) {
      const radius = this.certain(z, view.lat, RING_REACH);
      if (radius > rings[rings.length - 1].radius * 1.3) rings.push({ z, reach: RING_REACH, radius }); // skip a level that adds almost nothing
    }
    return rings;
  }

  /** Decide which tiles to show and which to fetch, and start loading the missing ones. */
  private plan(camera: THREE.PerspectiveCamera, destination: Destination | null, realSeconds: number): void {
    const picks: Pick[] = [];
    const view = this.enabled ? this.look(camera.position, camera.fov) : null;
    let coming: View | null = this.enabled && destination ? this.look(destination.pos, camera.fov) : null;
    let comingSharp = coming ? THREE.MathUtils.clamp(Math.round(coming.zoom), LOW_ZOOM + 1, MAX_ZOOM) : 0;

    if (view) {
      // How fast is the camera passing over the ground? Smoothed, but dropped at once when the
      // motion stops.
      const since = realSeconds - this.lastCentreAt;
      const stride = this.lastCentre ? view.centre.angleTo(this.lastCentre) : 0; // radians since the last plan
      if (this.lastCentre && since > 0 && since < 1) {
        const speedNow = (stride * KM_PER_RADIAN) / since;
        this.speed = speedNow < this.speed ? speedNow : this.speed + (speedNow - this.speed) * Math.min(1, since / 1.5);
      } else this.speed = 0;

      // The middle ring's level follows the camera's height, but only changes once the ideal
      // level has clearly moved on — otherwise hovering between two levels would swap every
      // tile back and forth.
      if (this.sharpest === 0 || Math.abs(view.zoom - this.sharpest) > 0.65) this.sharpest = Math.round(view.zoom);
      const cosLat = Math.cos(THREE.MathUtils.degToRad(view.lat));
      // With time running fast, a followed satellite covers 760 km every second (at 100×): far
      // too fast for the finest tiles to arrive, or to be seen. Then a tile should stay under
      // the camera for at least a second and a half. This is NOT applied to the user's own
      // dragging and turning: lowering the level for a moment there is exactly the blur-then-
      // sharpen flicker this file exists to avoid.
      const racing = this.timeRate >= 50 && this.speed > 1;
      const speedZoom = racing ? Math.floor(Math.log2((40075 * cosLat) / (this.speed * 1.5))) : MAX_ZOOM;
      const sharp = THREE.MathUtils.clamp(Math.min(this.sharpest, speedZoom), LOW_ZOOM + 1, MAX_ZOOM);
      const rings = this.rings(view, sharp);

      // Coarsest first: those few pictures cover everything and arrive soonest.
      rings.forEach((ring, k) => {
        this.around(picks, ring.z, view, ring.reach, rings.length - 1 - k, true);
        this.edge(ring.z).value.set(ring.radius * RIM, ring.radius);
      });
      // From far away the tiles are partly see-through (60 %), so the globe's drifting clouds
      // still show; close in (where those clouds are only a blur) they cover it completely.
      // Several rings lie on top of each other in the middle, so each one's share is chosen
      // to give that total there.
      this.cover.value = 1 - Math.pow(1 - THREE.MathUtils.lerp(0.6, 1, this.close.value), 1 / rings.length);

      // Not flying anywhere, but moving (following a satellite, or the slow drift): fetch the
      // strip of ground the camera will be over in the next few seconds.
      if (!coming && this.lastCentre && since > 0 && since < 1 && stride > 1e-6) {
        // … six seconds' worth of the last stride, but no further than the middle ring reaches
        const lead = Math.min(6 / since, (0.6 * rings[0].radius) / stride);
        const centre = view.centre.clone().addScaledVector(view.centre.clone().sub(this.lastCentre), lead).normalize();
        const lat = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(centre.y, -1, 1)));
        if (Math.abs(lat) < MERCATOR_LIMIT - 1) {
          coming = { ...view, centre, lat, lon: THREE.MathUtils.radToDeg(Math.atan2(-centre.z, centre.x)) };
          comingSharp = sharp;
        }
      }
      this.lastCentre = view.centre.clone();
      this.lastCentreAt = realSeconds;
    } else {
      this.lastCentre = null;
      this.speed = 0;
      this.sharpest = 0;
    }

    if (coming) {
      const rings = this.rings(coming, comingSharp);
      rings.forEach((ring, k) => this.around(picks, ring.z, coming!, ring.reach, 10 + rings.length - 1 - k, false));
    }

    // One entry per tile (the two views overlap), most urgent first.
    const chosen = new Map<string, Pick>();
    for (const pick of picks) {
      const had = chosen.get(pick.key);
      if (!had) chosen.set(pick.key, pick);
      else {
        had.rank = Math.min(had.rank, pick.rank);
        had.visible ||= pick.visible;
      }
    }
    const ordered = [...chosen.values()].sort((p, q) => p.rank - q.rank);
    this.needed = new Set();
    this.wanted = [];
    for (const pick of ordered) {
      if (!this.tiles.has(pick.key)) this.create(pick.key, pick.z, pick.x, pick.y);
      const tile = this.tiles.get(pick.key)!;
      tile.usedAt = realSeconds;
      if (pick.visible) {
        tile.shownAt = realSeconds;
        this.needed.add(pick.key);
      }
      this.wanted.push(pick.key);
    }
    // A download for a tile nobody wants any more only delays the ones that are wanted.
    for (const [key, tile] of this.tiles) {
      if (tile.state === 'loading' && !chosen.has(key)) tile.cancel?.abort();
    }
    this.pump();
    this.evict();
  }

  /** Add the tiles of zoom z within `reach` tiles of a view's centre. */
  private around(picks: Pick[], z: number, view: View, reach: number, priority: number, visible: boolean): void {
    const n = 2 ** z;
    const latRad = THREE.MathUtils.degToRad(view.lat);
    const cx = ((view.lon + 180) / 360) * n;
    const cy = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
    const across = Math.min(reach, Math.floor((n - 1) / 2)); // never the same column twice on a very coarse level
    for (let dy = -reach; dy <= reach; dy++) {
      const y = Math.floor(cy) + dy;
      if (y < 0 || y >= n) continue;
      for (let dx = -across; dx <= across; dx++) {
        const x = (((Math.floor(cx) + dx) % n) + n) % n; // wraps round the date line
        const d2 = (dx + 0.5 - (cx % 1)) ** 2 + (dy + 0.5 - (cy % 1)) ** 2;
        picks.push({ key: `${z}/${x}/${y}`, z, x, y, rank: priority * 10000 + d2, visible });
      }
    }
  }

  private edge(z: number): { value: THREE.Vector2 } {
    let edge = this.edges.get(z);
    if (!edge) this.edges.set(z, (edge = { value: new THREE.Vector2(0, 0) }));
    return edge;
  }

  /**
   * The angle (radians) from the centre that `reach` tiles of zoom z are certain to
   * cover. Mercator tiles get smaller towards the poles, so the size is taken at the far edge.
   */
  private certain(z: number, lat: number, reach: number): number {
    const inLongitude = ((2 * Math.PI) / 2 ** z) * reach;
    const latRad = Math.abs(THREE.MathUtils.degToRad(lat));
    return Math.max(0.004, inLongitude * Math.cos(Math.min(1.45, latRad + inLongitude * Math.cos(latRad))));
  }

  /** Build the curved patch for one tile (its picture is loaded later, in pump()). */
  private create(key: string, z: number, x: number, y: number): void {
    const n = 2 ** z;
    // Enough segments to follow the curve of the Earth: about one per degree. A higher zoom
    // sits a little higher off the surface, so a sharp tile never fights for depth with the
    // backdrop tile under it (both stay below the map lines and markers).
    const grid = THREE.MathUtils.clamp(Math.ceil(360 / n), 6, 48);
    const lift = 1.0005 + 0.0001 * (z - LOW_ZOOM);
    const positions = new Float32Array((grid + 1) * (grid + 1) * 3);
    const uvs = new Float32Array((grid + 1) * (grid + 1) * 2);
    for (let j = 0; j <= grid; j++) {
      // Rows are evenly spaced in MERCATOR y (not latitude), so the picture maps on linearly.
      const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + j / grid)) / n)));
      for (let i = 0; i <= grid; i++) {
        const lon = (((x + i / grid) / n) * 360 - 180) * (Math.PI / 180);
        const k = j * (grid + 1) + i;
        // Same convention as the globe: longitude 0° on +X, east towards −Z, north = +Y.
        positions[3 * k] = Math.cos(lat) * Math.cos(lon) * EARTH_RADIUS * lift;
        positions[3 * k + 1] = Math.sin(lat) * EARTH_RADIUS * lift;
        positions[3 * k + 2] = -Math.cos(lat) * Math.sin(lon) * EARTH_RADIUS * lift;
        uvs[2 * k] = i / grid;
        uvs[2 * k + 1] = j / grid; // the picture's first row is its north edge
      }
    }
    const index: number[] = [];
    for (let j = 0; j < grid; j++) {
      for (let i = 0; i < grid; i++) {
        const a = j * (grid + 1) + i, b = a + 1, c = a + grid + 1, d = c + 1;
        index.push(a, c, b, b, c, d);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: null }, uNight: this.nightMap, uHasNight: this.hasNightMap, uNightTexel: this.nightTexel,
        uSun: this.sun, uOpacity: { value: 0 }, uCover: this.cover, uClose: this.close,
        uCentre: this.centre, uEdge: this.edge(z),
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      // The patch lies only a few kilometres above the globe. With the camera a few metres from
      // a satellite the depth buffer cannot tell the two apart at a distance, and without this
      // nudge towards the camera the ground would flicker between the tile and the globe.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -8,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    mesh.renderOrder = -6 + z * 0.01; // straight after the globe, coarse before sharp, before everything drawn on top
    this.group.add(mesh);
    this.tiles.set(key, {
      mesh, material, texture: null, bitmap: null, state: 'idle', cancel: null,
      retryAt: 0, usedAt: 0, shownAt: -Infinity, opacity: 0, z,
    });
  }

  /** Start downloads for wanted tiles that have no picture yet, most urgent first. */
  private pump(): void {
    if (this.offline && this.now - this.offlineSince < 30) return;
    this.offline = false;
    for (const key of this.wanted) {
      if (this.loading >= AT_ONCE) return;
      const tile = this.tiles.get(key);
      if (!tile) continue;
      if (tile.state === 'failed' && this.now >= tile.retryAt) tile.state = 'idle';
      if (tile.state === 'idle') void this.load(key, tile);
    }
  }

  /**
   * Fetch one tile's picture. It is decoded off the main thread (createImageBitmap), so a
   * burst of arriving tiles does not make the animation stutter.
   */
  private async load(key: string, tile: Tile): Promise<void> {
    const [z, x, y] = key.split('/');
    const cancel = new AbortController();
    tile.state = 'loading';
    tile.cancel = cancel;
    this.loading++;
    try {
      const response = await fetch(`${SOURCE}/${z}/${y}/${x}.jpeg`, { signal: cancel.signal, referrerPolicy: 'no-referrer' });
      if (!response.ok) {
        tile.state = 'failed'; // the service has no such picture: do not ask again
        tile.retryAt = Infinity;
        return;
      }
      const bitmap = await createImageBitmap(await response.blob());
      if (this.tiles.get(key) !== tile) {
        bitmap.close(); // the tile was dropped while its picture was on the way
        return;
      }
      const texture = new THREE.Texture(bitmap);
      texture.flipY = false; // bitmaps are uploaded as they are (see the uv comment in create())
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      texture.needsUpdate = true;
      tile.bitmap = bitmap;
      tile.texture = texture;
      tile.material.uniforms.uMap.value = texture;
      tile.state = 'ready';
    } catch {
      if (cancel.signal.aborted) {
        tile.state = 'idle'; // we gave up on it ourselves; it can be asked for again
      } else {
        // Offline or blocked: keep what is on screen and try again later.
        tile.state = 'failed';
        tile.retryAt = this.now + 30;
        this.offline = true;
        this.offlineSince = this.now;
      }
    } finally {
      tile.cancel = null;
      this.loading--;
      if (!cancel.signal.aborted) this.pump(); // a slot is free: start the next download now
    }
  }

  /** Forget the tiles that have gone longest without being asked for. */
  private evict(): void {
    if (this.tiles.size <= KEEP) return;
    const oldest = [...this.tiles.entries()].sort((p, q) => p[1].usedAt - q[1].usedAt).slice(0, this.tiles.size - KEEP);
    for (const [key, tile] of oldest) {
      tile.cancel?.abort();
      this.group.remove(tile.mesh);
      tile.mesh.geometry.dispose();
      tile.material.dispose();
      tile.texture?.dispose();
      tile.bitmap?.close();
      this.tiles.delete(key);
    }
  }
}
