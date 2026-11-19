/**
 * Sharp ground when you zoom in.
 *
 * A world's own picture is one image of the whole globe: for the Earth 4096 pixels across,
 * about 10 km per pixel, which turns to mush from a few hundred kilometres up. So, like a map
 * app, the part of the ground being looked at is re-covered with small, detailed image tiles
 * fetched on demand. Far away nothing is fetched and the original picture is used.
 *
 * The same machinery serves any world (GroundTiles); what differs is handed in:
 *
 *   the source     where the pictures come from and how the service cuts the world up. The
 *                  Earth's are NASA's Blue Marble from the public GIBS service, the "web map"
 *                  pyramid: 2^z × 2^z squares in the Mercator projection, up to ~600 m per
 *                  pixel. The Moon, Mars and Mercury come from NASA's Solar System Treks, which
 *                  cuts a plain latitude / longitude map into 2^(z+1) × 2^z squares, each the
 *                  same number of degrees wide and tall. Both number rows from the north and
 *                  columns eastwards from longitude −180°. (Grid, below, is all that differs.)
 *   the parent     the turning globe the tiles are children of, always 6.371 scene units in
 *                  radius whatever the world's real size, so heights here are in scene units
 *                  and only the pixel sizes need the real radius.
 *   the lighting   each tile is a small curved patch of sphere just above the surface, shaded
 *                  the same way as the globe under it, or the join would show. The Earth in
 *                  the tracker: the same Sun by day, and at night a dim moonlit tone with the
 *                  globe's city lights on top (brighter near the ground than the globe's, or a
 *                  zoomed-in view of the night side would be too dark to show the detail).
 *                  Another world: exactly the lighting of render/space/bodyMesh.ts, whose
 *                  uniforms it shares; its night side is simply dark.
 *   the tone       a world's tiles and its whole-globe picture are often different products
 *                  (the Moon's map here is a brightened colour picture, its tiles a darker grey
 *                  survey mosaic), and ground that changed tone as the tiles faded in would
 *                  give the trick away. With `matchTone`, eight coarse tiles are compared with
 *                  the globe's picture once, and every tile is then drawn through the curve
 *                  (brightness, contrast, tint) that makes the one look like the other.
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
import { EARTH_RADIUS, EARTH_RADIUS_KM, KM } from './scene.ts';

const SHARP_REACH_MAX = 4; // the sharpest level reaches at most this many tiles out from the centre (9 × 9 tiles)
const RING_REACH = 2; // every coarser level: 5 × 5 of its (larger) tiles
const RIM = 0.72; // a level is solid out to this share of its radius, then fades to nothing at the edge
const KEEP = 260; // tiles kept in memory
const AT_ONCE = 16; // downloads in flight
const LINGER = 2.5; // seconds a tile of the previous view may stay while the new view loads
const FAR = 6; // scene units above the ground (6,000 km at the Earth): beyond this no tile is ever needed

// ---------------------------------------------------------------------------------------
// What is handed in: the source, and the lighting
// ---------------------------------------------------------------------------------------

/** Where the pictures come from and how the service numbers them. */
export interface TileSource {
  /** The address of one picture: {z} = level, {y} = row counted from the north, {x} = column counted eastwards from longitude −180°. */
  url: string;
  /** How the world is cut up: 'mercator' = 2^z × 2^z squares (web maps); 'degrees' = 2^(z+1) × 2^z squares of equal latitude and longitude. */
  grid: 'mercator' | 'degrees';
  /** The coarsest level ever drawn. */
  lowZoom: number;
  /** Tiles are used once the view calls for at least this level; further out the globe's own picture is as sharp. */
  nearZoom: number;
  /** The finest level the service has. Asking beyond it is worse than useless: see `quietWhenMissing`. */
  maxZoom: number;
  /**
   * Set for a service that answers "no such picture" without the header that lets a web page
   * read the answer (NASA Trek's 404). The browser then reports it exactly like a lost
   * connection. With this set, a failure while other pictures are arriving is taken to mean
   * "no such picture" for that one tile, instead of "offline: stop asking for half a minute".
   */
  quietWhenMissing?: boolean;
}

/** The Earth in the tracker: the globe's own day and night, and its city lights (borrowed from the globe's material). */
export interface EarthLight {
  like: 'earth';
  night: { value: THREE.Texture | null };
  hasNight: { value: number };
}

/**
 * Another world: the lighting of render/space/bodyMesh.ts. `uniforms` are that body's own
 * uniform objects (Sun direction, haze, gain, what can cast a shadow on it …), shared, so the
 * one update the view gives the body serves its tiles too.
 */
export interface BodyLight {
  like: 'body';
  uniforms: Record<string, THREE.IUniform>;
  /** The length of the body shader's list of shadow-casters (MAX_OCCLUDERS there). */
  occluders: number;
}

export interface GroundOptions {
  source: TileSource;
  /** The world's real radius: it sets how much ground a pixel covers. */
  radiusKm: number;
  /** Its real circumference, if not simply 2π × radius (web maps fix the Earth's at 40,075 km). */
  circumferenceKm?: number;
  light: EarthLight | BodyLight;
  /**
   * How much of the globe's own picture the tiles hide from far away (1 = all of it). The
   * Earth uses 0.6, so the globe's drifting clouds still show through; close to the ground
   * every world is covered completely.
   */
  farCover: number;
  /** Texture filtering quality for the pictures (the renderer's "anisotropy"); 8 unless told otherwise. */
  anisotropy?: number;
  /**
   * Match the tiles' tone to the globe's own picture (another world only). Nothing is shown
   * until setReference() has said what that picture is, or that there is none.
   */
  matchTone?: boolean;
}

// ---------------------------------------------------------------------------------------
// The two ways of cutting a world into tiles
// ---------------------------------------------------------------------------------------

/**
 * Everything about a tile grid that the rest of this file needs. `c` is the world's
 * circumference in km; latitudes are in degrees unless a name says otherwise.
 */
interface Grid {
  /** There are no tiles (or none worth drawing) beyond this latitude. */
  limit: number;
  columns(z: number): number;
  rows(z: number): number;
  /** The row a latitude falls in, as a fraction (row 0 starts at the north edge). */
  row(lat: number, z: number): number;
  /** The latitude, in radians, of a (fractional) row. */
  latitudeOf(row: number, z: number): number;
  /** How much ground one pixel of a level-0 picture covers at this latitude, km. */
  kmPerPixel0(lat: number, c: number): number;
  /** The size of one level-z picture on the ground at this latitude, km. */
  tileKm(lat: number, z: number, c: number): number;
  /** How many columns to take each side of the centre, for `reach` rows each way. */
  across(lat: number, z: number, reach: number): number;
  /** The angle (radians) from the centre that those tiles are certain to cover. */
  certain(lat: number, z: number, reach: number): number;
  /** How many strips to cut one patch into so that it follows the curve of the globe (about one per degree). */
  segments(z: number): number;
}

/**
 * Web maps (the Earth, from GIBS): squares in the Mercator projection. Every tile is square
 * on the ground, but they shrink towards the poles and stop at 85°.
 */
const MERCATOR: Grid = {
  limit: 85.0511,
  columns: (z) => 2 ** z,
  rows: (z) => 2 ** z,
  row(lat, z) {
    const latRad = THREE.MathUtils.degToRad(lat);
    return ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** z;
  },
  latitudeOf: (row, z) => Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / 2 ** z))),
  kmPerPixel0: (lat, c) => (c * Math.cos(THREE.MathUtils.degToRad(lat))) / 256,
  tileKm: (lat, z, c) => (c * Math.cos(THREE.MathUtils.degToRad(lat))) / 2 ** z,
  across: (_lat, z, reach) => Math.min(reach, Math.floor((2 ** z - 1) / 2)), // never the same column twice on a very coarse level
  certain(lat, z, reach) {
    // Mercator tiles get smaller towards the poles, so the size is taken at the far edge.
    const inLongitude = ((2 * Math.PI) / 2 ** z) * reach;
    const latRad = Math.abs(THREE.MathUtils.degToRad(lat));
    return Math.max(0.004, inLongitude * Math.cos(Math.min(1.45, latRad + inLongitude * Math.cos(latRad))));
  },
  segments: (z) => THREE.MathUtils.clamp(Math.ceil(360 / 2 ** z), 6, 48),
};

/**
 * A plain latitude / longitude map (the Moon, Mars and Mercury, from NASA Trek): two squares
 * at level 0, each tile the same number of degrees each way. Rows keep their height all the
 * way to the poles, but a tile's width on the ground shrinks with the cosine of the latitude,
 * so more columns are needed there to cover the same ground: up to twice as many as rows, and
 * beyond that the ring simply reaches less far east and west and the coarser one takes over.
 */
const DEGREES: Grid = {
  limit: 86,
  columns: (z) => 2 ** (z + 1),
  rows: (z) => 2 ** z,
  row: (lat, z) => ((90 - lat) / 180) * 2 ** z,
  latitudeOf: (row, z) => THREE.MathUtils.degToRad(90 - (row * 180) / 2 ** z),
  kmPerPixel0: (_lat, c) => c / 2 / 256, // measured north–south, the coarser of the two directions
  tileKm: (_lat, z, c) => c / 2 / 2 ** z,
  across(lat, z, reach) {
    const farEdge = Math.min(1.5, Math.abs(THREE.MathUtils.degToRad(lat)) + (Math.PI / 2 ** z) * reach);
    return Math.min(Math.ceil(reach / Math.max(Math.cos(farEdge), 0.05)), 2 * reach, Math.floor((2 ** (z + 1) - 1) / 2));
  },
  certain(lat, z, reach) {
    const side = Math.PI / 2 ** z; // one tile, as an angle
    const farEdge = Math.min(1.5, Math.abs(THREE.MathUtils.degToRad(lat)) + side * reach);
    return Math.max(0.004, Math.min(side * reach, side * this.across(lat, z, reach) * Math.cos(farEdge)));
  },
  segments: (z) => THREE.MathUtils.clamp(Math.ceil(180 / 2 ** z), 6, 48),
};

/** The Earth's pictures: NASA's Blue Marble, from the public GIBS service. */
const GIBS: TileSource = {
  url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
  grid: 'mercator',
  lowZoom: 2,
  nearZoom: 5,
  maxZoom: 8,
};

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
  centre: THREE.Vector3; // the point on the ground below the camera (unit vector, in the globe's own frame)
  lat: number; // of that point, degrees
  lon: number;
  altitude: number; // scene units
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

// ---------------------------------------------------------------------------------------
// Shaders: the Earth's, then another world's
// ---------------------------------------------------------------------------------------

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

// Another world. Its body is lit in world space (bodyMesh.ts), so the patch carries its
// normal and position there as well as in the body's own frame (which the rim fade uses).
const bodyVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalLocal;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vUv = uv;
    vNormalLocal = normalize(position); // the patch is part of a sphere centred on the body
    vNormalW = normalize(mat3(modelMatrix) * vNormalLocal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPosW = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

/**
 * The lighting here REPEATS bodyMesh.ts's BODY_FRAGMENT, line for line, for a body without
 * clouds, city lights or rings (no world that has those has tiles): the same hard or hazy edge
 * of night, the same darkening towards the limb, the same shadows of whatever passes in front
 * of the Sun, the same glow along the lit edge. Change one and change the other, or a square
 * of ground will stand out from the globe round it.
 * (Shader hygiene as there: pow() only of values clamped to ≥ 0, smoothstep edges in order.)
 */
const bodyFragmentShader = (occluders: number): string => /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uSunDir;       // unit vector towards the Sun, world space (the body's own uniform)
  uniform float uSunSize;
  uniform float uHaze;
  uniform vec3 uRim;
  uniform float uGain;
  uniform float uNight;
  uniform vec4 uOcc[${occluders}];
  uniform int uOccCount;
  uniform vec3 uToneGain;   // the tile's colour is drawn as uToneGain × colour^uToneGamma: the curve
  uniform float uToneGamma; // that makes it match the globe's own picture (GroundTiles.measure)
  uniform float uOpacity; // fades the tile in once its picture has arrived
  uniform float uCover;   // how completely the tile hides the globe's own (blurrier) picture
  uniform vec3 uCentre;   // the point on the ground below the camera (unit vector, body frame)
  uniform vec2 uEdge;     // fade out between these two distances from uCentre (y = 0: no fade)
  varying vec2 vUv;
  varying vec3 vNormalLocal;
  varying vec3 vNormalW;
  varying vec3 vPosW;

  // 1 = this body does not hide the Sun from the pixel, 0 = it hides it completely.
  float lightPast(vec4 occ) {
    vec3 toOcc = occ.xyz - vPosW;
    float along = dot(toOcc, uSunDir);
    if (along <= 0.0) return 1.0;
    float miss = length(toOcc - uSunDir * along);
    float blur = max(along * uSunSize, occ.w * 0.03);
    return smoothstep(occ.w - blur, occ.w + blur, miss);
  }

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vPosW);
    float ndl = dot(n, uSunDir);
    float mu = max(dot(n, v), 0.0);
    vec3 albedo = uToneGain * pow(max(texture2D(uMap, vUv).rgb, vec3(0.0)), vec3(uToneGamma));
    // A survey mosaic is a photograph: its sunlit slopes are far brighter than anything in a
    // painted globe, and brightened to match they would burn out (and bloom). Above a knee,
    // values are eased towards a ceiling instead of running on.
    albedo = min(albedo, vec3(0.5)) + 0.42 * (1.0 - exp(-max(albedo - 0.5, vec3(0.0)) / 0.42));

    float hard = pow(max(ndl, 0.0), 0.75);
    float soft = clamp((ndl + 0.12) / 1.12, 0.0, 1.0);
    float lit = mix(hard, soft * soft * (3.0 - 2.0 * soft), uHaze);
    float limb = mix(1.0, 0.42 + 0.58 * pow(mu, 0.55), uHaze);

    float sun = 1.0;
    for (int i = 0; i < ${occluders}; i++) {
      if (i >= uOccCount) break;
      sun = min(sun, lightPast(uOcc[i]));
    }

    vec3 col = albedo * (lit * limb * sun * uGain + uNight);
    float edge = 1.0 - mu;
    col += uRim * (edge * edge * edge) * smoothstep(-0.15, 0.4, ndl) * sun;
    // The outer rim of the covered area melts into the globe instead of ending in a line.
    float rim = uEdge.y > uEdge.x ? 1.0 - smoothstep(uEdge.x, uEdge.y, length(normalize(vNormalLocal) - uCentre)) : 1.0;
    gl_FragColor = vec4(clamp(col, 0.0, 4.0), clamp(uOpacity * uCover * rim, 0.0, 1.0));
  }`;

// ---------------------------------------------------------------------------------------
// The tiles of one world
// ---------------------------------------------------------------------------------------

export class GroundTiles {
  enabled = true;
  private readonly group = new THREE.Group();
  private readonly tiles = new Map<string, Tile>();
  // One uniform object shared by every tile for each value that is the same for all of them.
  private readonly sun = { value: new THREE.Vector3(1, 0, 0) };
  private readonly cover = { value: 1 };
  private readonly close = { value: 0 };
  private readonly centre = { value: new THREE.Vector3(1, 0, 0) };
  private readonly edges = new Map<number, { value: THREE.Vector2 }>(); // zoom level → where its rim fade starts and ends
  private readonly nightTexel = { value: new THREE.Vector2(1 / 4096, 1 / 2048) };
  private readonly globe: THREE.Object3D;
  private readonly source: TileSource;
  private readonly grid: Grid;
  private readonly light: EarthLight | BodyLight;
  private readonly radiusKm: number;
  private readonly kmPerUnit: number; // real kilometres in one scene unit of height above this world
  private readonly circumferenceKm: number;
  private readonly farCover: number;
  private readonly anisotropy: number;
  private readonly bodyFragment: string; // the other-world shader, made once (empty for the Earth)
  private maxZoom: number; // the finest level in use: the source's, unless that turned out not to exist
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
  private lastArrival = -Infinity; // when a picture last arrived (real seconds)
  private disposed = false;
  // Matching the globe's own picture (see measure()): until that is settled no tile is shown.
  private readonly toneGain = { value: new THREE.Vector3(1, 1, 1) };
  private readonly toneGamma = { value: 1 };
  private tone: 'settled' | 'waiting' | 'measuring';
  private reference: CanvasImageSource | null | undefined; // the globe's picture; null = it has none; undefined = not told yet
  private waitingSince = -1; // when tiles were first needed with the tone not yet settled (real seconds)

  /** @param globe  the turning sphere the tiles lie on (radius EARTH_RADIUS scene units); they become its children */
  constructor(globe: THREE.Object3D, options: GroundOptions) {
    this.globe = globe;
    this.source = options.source;
    this.grid = options.source.grid === 'mercator' ? MERCATOR : DEGREES;
    this.light = options.light;
    this.radiusKm = options.radiusKm;
    this.kmPerUnit = options.radiusKm / EARTH_RADIUS_KM / KM; // the globe is drawn the Earth's size whatever its own
    this.circumferenceKm = options.circumferenceKm ?? 2 * Math.PI * options.radiusKm;
    this.farCover = options.farCover;
    this.anisotropy = options.anisotropy ?? 8;
    this.maxZoom = options.source.maxZoom;
    this.bodyFragment = options.light.like === 'body' ? bodyFragmentShader(options.light.occluders) : '';
    this.tone = options.matchTone ? 'waiting' : 'settled';
    globe.add(this.group);
  }

  /**
   * Say what the globe's own picture is, for the tiles' tone to be matched to it: a plain
   * latitude / longitude map of the whole world with longitude −180° at its left edge. Null:
   * the globe has no picture (it is drawn in a plain colour), so the tiles are shown as they come.
   */
  setReference(picture: CanvasImageSource | null): void {
    if (this.reference === undefined || this.tone === 'waiting') this.reference = picture;
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
    const low = this.source.lowZoom;
    const key = `${low}/0/0`;
    if (!this.tiles.has(key)) this.create(key, low, 0, 0);
    const tile = this.tiles.get(key)!;
    tile.mesh.visible = true;
    renderer.compile(scene, camera);
    tile.mesh.visible = false;
  }

  /** Stop every download and give everything back. The object is finished after this. */
  dispose(): void {
    this.disposed = true;
    for (const tile of this.tiles.values()) this.discard(tile);
    this.tiles.clear();
    this.wanted = [];
    this.needed.clear();
    this.group.removeFromParent();
  }

  /**
   * Call every frame. `sunDirection` is in scene coordinates. `ahead` says where the camera
   * is flying to, if it is (asked a few times a second). `timeRate` is how fast simulated
   * time is running (1 = real time).
   */
  update(camera: THREE.PerspectiveCamera, sunDirection: THREE.Vector3, realSeconds: number, dt: number, ahead?: () => Destination | null, timeRate = 1): void {
    if (this.disposed) return;
    this.now = realSeconds;
    this.timeRate = timeRate;
    const toGlobe = this.globe.getWorldQuaternion(new THREE.Quaternion()).invert();
    // The Sun as seen from the turning globe: undo its rotation.
    this.sun.value.copy(sunDirection).applyQuaternion(toGlobe);

    const eye = this.globe.worldToLocal(camera.position.clone());
    const altitude = eye.length() - EARTH_RADIUS;
    this.close.value = 1 - THREE.MathUtils.smoothstep(altitude, 1.5, 5);
    if (this.light.like === 'earth') {
      const lightsPicture = this.light.night.value?.image as { width?: number; height?: number } | undefined;
      if (lightsPicture?.width && lightsPicture.height) this.nightTexel.value.set(1 / lightsPicture.width, 1 / lightsPicture.height);
    }
    // The rings are centred on the point below the camera, followed every frame so they glide.
    if (altitude > 0) this.centre.value.copy(eye).normalize();

    if (realSeconds - this.lastPlan > 0.25) {
      this.lastPlan = realSeconds;
      this.plan(camera, ahead?.() ?? null, realSeconds);
    }

    if (this.tone === 'waiting' && this.needed.size > 0) {
      if (this.waitingSince < 0) this.waitingSince = realSeconds;
      if (this.reference) void this.measure(this.reference);
      else if (this.reference === null || realSeconds - this.waitingSince > 6) this.tone = 'settled'; // nothing to match, or it is not coming
    }
    const held = this.tone !== 'settled'; // not until their tone is known: tiles that changed tone on screen would be worse than a short wait

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
      const wanted = !held && (this.needed.has(key) || (!complete && realSeconds - tile.shownAt < LINGER));
      tile.opacity = wanted ? Math.min(1, tile.opacity + dt * 3.5) : Math.max(0, tile.opacity - dt * 2.5);
      tile.material.uniforms.uOpacity.value = tile.opacity;
      tile.mesh.visible = tile.opacity > 0.003;
    }
  }

  /** What does a camera at this position (scene coordinates) need? Null when it is too far away for tiles to help. */
  private look(eyeWorld: THREE.Vector3, fov: number): View | null {
    const eye = this.globe.worldToLocal(eyeWorld.clone());
    const altitude = eye.length() - EARTH_RADIUS;
    if (altitude > FAR || altitude <= 0) return null;
    const centre = eye.normalize();
    const lat = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(centre.y, -1, 1)));
    const lon = THREE.MathUtils.radToDeg(Math.atan2(-centre.z, centre.x));
    if (Math.abs(lat) > this.grid.limit - 1) return null;
    const altitudeKm = altitude * this.kmPerUnit;
    const kmPerPixel = (altitudeKm * 2 * Math.tan(THREE.MathUtils.degToRad(fov / 2))) / window.innerHeight;
    const zoom = Math.log2(this.grid.kmPerPixel0(lat, this.circumferenceKm) / kmPerPixel);
    if (zoom < this.source.nearZoom - 0.5) return null;
    return { centre, lat, lon, altitude, kmPerPixel, zoom };
  }

  /**
   * The rings for a view whose middle ring is at zoom `sharp`: that level out to the corners
   * of the screen, then coarser levels, each reaching twice as far as the last useful one,
   * until the horizon is covered.
   */
  private rings(view: View, sharp: number): Ring[] {
    const tileKm = this.grid.tileKm(view.lat, sharp, this.circumferenceKm);
    const halfDiagonalKm = (view.kmPerPixel * Math.hypot(window.innerWidth, window.innerHeight)) / 2;
    // The sharp level should be SOLID out to the screen's corners (seen straight down), so
    // its faded rim is allowed for by dividing by RIM.
    const sharpReach = THREE.MathUtils.clamp(Math.ceil(halfDiagonalKm / tileKm / RIM), RING_REACH, SHARP_REACH_MAX);
    const horizon = Math.acos(EARTH_RADIUS / (EARTH_RADIUS + view.altitude)); // angle from below the camera to the edge of the visible globe
    const rings: Ring[] = [{ z: sharp, reach: sharpReach, radius: this.grid.certain(view.lat, sharp, sharpReach) }];
    for (let z = sharp - 1; z >= this.source.lowZoom && rings[rings.length - 1].radius < horizon; z--) {
      const radius = this.grid.certain(view.lat, z, RING_REACH);
      if (radius > rings[rings.length - 1].radius * 1.3) rings.push({ z, reach: RING_REACH, radius }); // skip a level that adds almost nothing
    }
    return rings;
  }

  /** Decide which tiles to show and which to fetch, and start loading the missing ones. */
  private plan(camera: THREE.PerspectiveCamera, destination: Destination | null, realSeconds: number): void {
    const { lowZoom } = this.source, maxZoom = this.maxZoom;
    const picks: Pick[] = [];
    const view = this.enabled ? this.look(camera.position, camera.fov) : null;
    let coming: View | null = this.enabled && destination ? this.look(destination.pos, camera.fov) : null;
    let comingSharp = coming ? THREE.MathUtils.clamp(Math.round(coming.zoom), lowZoom + 1, maxZoom) : 0;

    if (view) {
      // How fast is the camera passing over the ground? Smoothed, but dropped at once when the
      // motion stops.
      const since = realSeconds - this.lastCentreAt;
      const stride = this.lastCentre ? view.centre.angleTo(this.lastCentre) : 0; // radians since the last plan
      if (this.lastCentre && since > 0 && since < 1) {
        const speedNow = (stride * this.radiusKm) / since;
        this.speed = speedNow < this.speed ? speedNow : this.speed + (speedNow - this.speed) * Math.min(1, since / 1.5);
      } else this.speed = 0;

      // The middle ring's level follows the camera's height, but only changes once the ideal
      // level has clearly moved on — otherwise hovering between two levels would swap every
      // tile back and forth.
      if (this.sharpest === 0 || Math.abs(view.zoom - this.sharpest) > 0.65) this.sharpest = Math.round(view.zoom);
      // With time running fast, a followed satellite covers 760 km every second (at 100×): far
      // too fast for the finest tiles to arrive, or to be seen. Then a tile should stay under
      // the camera for at least a second and a half. This is NOT applied to the user's own
      // dragging and turning: lowering the level for a moment there is exactly the blur-then-
      // sharpen flicker this file exists to avoid.
      const racing = this.timeRate >= 50 && this.speed > 1;
      const speedZoom = racing ? Math.floor(Math.log2(this.grid.tileKm(view.lat, 0, this.circumferenceKm) / (this.speed * 1.5))) : maxZoom;
      const sharp = THREE.MathUtils.clamp(Math.min(this.sharpest, speedZoom), lowZoom + 1, maxZoom);
      const rings = this.rings(view, sharp);

      // Coarsest first: those few pictures cover everything and arrive soonest.
      rings.forEach((ring, k) => {
        this.around(picks, ring.z, view, ring.reach, rings.length - 1 - k, true);
        this.edge(ring.z).value.set(ring.radius * RIM, ring.radius);
      });
      // From far away the Earth's tiles are partly see-through (60 %), so the globe's drifting
      // clouds still show; close in (where those clouds are only a blur) they cover it
      // completely. Several rings lie on top of each other in the middle, so each one's share
      // is chosen to give that total there. (A world without clouds is covered from the start.)
      this.cover.value = 1 - Math.pow(1 - THREE.MathUtils.lerp(this.farCover, 1, this.close.value), 1 / rings.length);

      // Not flying anywhere, but moving (following a satellite, or the slow drift): fetch the
      // strip of ground the camera will be over in the next few seconds.
      if (!coming && this.lastCentre && since > 0 && since < 1 && stride > 1e-6) {
        // … six seconds' worth of the last stride, but no further than the middle ring reaches
        const lead = Math.min(6 / since, (0.6 * rings[0].radius) / stride);
        const centre = view.centre.clone().addScaledVector(view.centre.clone().sub(this.lastCentre), lead).normalize();
        const lat = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(centre.y, -1, 1)));
        if (Math.abs(lat) < this.grid.limit - 1) {
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
    const columns = this.grid.columns(z), rows = this.grid.rows(z);
    const cx = ((view.lon + 180) / 360) * columns;
    const cy = this.grid.row(view.lat, z);
    const across = this.grid.across(view.lat, z, reach);
    for (let dy = -reach; dy <= reach; dy++) {
      const y = Math.floor(cy) + dy;
      if (y < 0 || y >= rows) continue;
      for (let dx = -across; dx <= across; dx++) {
        const x = (((Math.floor(cx) + dx) % columns) + columns) % columns; // wraps round the date line
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

  /** Build the curved patch for one tile (its picture is loaded later, in pump()). */
  private create(key: string, z: number, x: number, y: number): void {
    const columns = this.grid.columns(z);
    // Enough segments to follow the curve of the globe: about one per degree. A higher zoom
    // sits a little higher off the surface, so a sharp tile never fights for depth with the
    // backdrop tile under it (both stay below the map lines and markers).
    const grid = this.grid.segments(z);
    const lift = 1.0005 + 0.0001 * (z - this.source.lowZoom);
    const positions = new Float32Array((grid + 1) * (grid + 1) * 3);
    const uvs = new Float32Array((grid + 1) * (grid + 1) * 2);
    for (let j = 0; j <= grid; j++) {
      // Rows are evenly spaced the way the picture's own rows are (in Mercator y for a web
      // map, in latitude for a plain one), so the picture maps on linearly.
      const lat = this.grid.latitudeOf(y + j / grid, z);
      for (let i = 0; i <= grid; i++) {
        const lon = (((x + i / grid) / columns) * 360 - 180) * (Math.PI / 180);
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
    const light = this.light;
    const shared = { uMap: { value: null }, uOpacity: { value: 0 }, uCover: this.cover, uCentre: this.centre, uEdge: this.edge(z) };
    const material = new THREE.ShaderMaterial({
      uniforms: light.like === 'earth'
        ? { ...shared, uNight: light.night, uHasNight: light.hasNight, uNightTexel: this.nightTexel, uSun: this.sun, uClose: this.close }
        : {
          ...shared,
          // the body's own uniform objects: whatever the view sets for the globe holds for its tiles
          uSunDir: light.uniforms.uSunDir, uSunSize: light.uniforms.uSunSize, uHaze: light.uniforms.uHaze, uRim: light.uniforms.uRim,
          uGain: light.uniforms.uGain, uNight: light.uniforms.uNight, uOcc: light.uniforms.uOcc, uOccCount: light.uniforms.uOccCount,
          uToneGain: this.toneGain, uToneGamma: this.toneGamma,
        },
      vertexShader: light.like === 'earth' ? vertexShader : bodyVertexShader,
      fragmentShader: light.like === 'earth' ? fragmentShader : this.bodyFragment,
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
      const response = await fetch(this.address(z, x, y), { signal: cancel.signal, referrerPolicy: 'no-referrer' });
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
      texture.anisotropy = this.anisotropy;
      texture.needsUpdate = true;
      tile.bitmap = bitmap;
      tile.texture = texture;
      tile.material.uniforms.uMap.value = texture;
      tile.state = 'ready';
      this.lastArrival = this.now;
    } catch {
      if (cancel.signal.aborted) {
        tile.state = 'idle'; // we gave up on it ourselves; it can be asked for again
      } else if (this.source.quietWhenMissing && this.now - this.lastArrival < 10) {
        // Other pictures are arriving, so the connection is fine: it is this one picture the
        // service does not have (see TileSource.quietWhenMissing). If that is true of a whole
        // level, the table that said the level exists was wrong: stop using it.
        tile.state = 'failed';
        tile.retryAt = Infinity;
        this.forget(tile.z);
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
      if (!cancel.signal.aborted && !this.disposed) this.pump(); // a slot is free: start the next download now
    }
  }

  /** The address of one picture. */
  private address(z: string | number, x: string | number, y: string | number): string {
    return this.source.url.replace('{z}', String(z)).replace('{y}', String(y)).replace('{x}', String(x));
  }

  /**
   * Work out the curve that makes this world's tiles look like its whole-globe picture
   * (`reference`), so that the ground keeps its tone as the tiles fade in over it.
   *
   * The eight tiles of level 1 (the whole world, 250 kilobytes) are fetched once and shrunk
   * to 16 × 16 samples each. The two pictures are then compared as wholes, not place by place
   * (two surveys never agree pixel for pixel): the tiles are given the curve
   *     colour → gain × colour^gamma
   * that moves their dark end, their middle and their bright end (the 10th, 50th and 90th
   * percentile of brightness) onto the reference's. `gamma` is the contrast, from how far apart
   * the dark and bright ends are in each; `gain`, one number per colour channel, puts the
   * middles together and carries the tint.
   * If anything fails (offline, a picture that cannot be read) the tiles are shown as they come.
   */
  private async measure(reference: CanvasImageSource): Promise<void> {
    this.tone = 'measuring';
    try {
      const level = 1, columns = this.grid.columns(level), rows = this.grid.rows(level);
      const N = 16, W = 256, H = 128;
      const pad = (width: number, height: number): CanvasRenderingContext2D => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.imageSmoothingQuality = 'high';
        return ctx;
      };
      const whole = pad(W, H);
      whole.drawImage(reference, 0, 0, W, H);
      const base = whole.getImageData(0, 0, W, H).data;
      const pictures = await Promise.all(Array.from({ length: columns * rows }, async (_, k) => {
        const x = k % columns, y = Math.floor(k / columns);
        const response = await fetch(this.address(level, x, y), { referrerPolicy: 'no-referrer' });
        if (!response.ok) throw new Error('no such picture');
        return { x, y, bitmap: await createImageBitmap(await response.blob()) };
      }));
      // Pictures hold display values; light adds up in linear ones, which is what the shader works in.
      const linear = (value: number): number => {
        const c = value / 255;
        return Math.max(c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4, 1e-3);
      };
      const small = pad(N, N);
      // red, green, blue and brightness of every sample: of the tiles, and of the reference
      const tiles: number[][] = [[], [], [], []], globe: number[][] = [[], [], [], []];
      for (const { x, y, bitmap } of pictures) {
        small.drawImage(bitmap, 0, 0, N, N);
        bitmap.close();
        const tile = small.getImageData(0, 0, N, N).data;
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
          const lon = ((x + (i + 0.5) / N) / columns) * 360 - 180;
          const lat = THREE.MathUtils.radToDeg(this.grid.latitudeOf(y + (j + 0.5) / N, level));
          // Not the polar caps: a survey's tiles are full of long shadows there, and a painted
          // globe is often simply blank.
          if (Math.abs(lat) > 60) continue;
          const bx = THREE.MathUtils.clamp(Math.floor(((lon + 180) / 360) * W), 0, W - 1);
          const by = THREE.MathUtils.clamp(Math.floor(((90 - lat) / 180) * H), 0, H - 1);
          let t = 0, b = 0;
          for (let c = 0; c < 3; c++) {
            const tc = linear(tile[(j * N + i) * 4 + c]), bc = linear(base[(by * W + bx) * 4 + c]);
            tiles[c].push(tc);
            globe[c].push(bc);
            t += tc / 3;
            b += bc / 3;
          }
          tiles[3].push(t);
          globe[3].push(b);
        }
      }
      if (this.disposed || tiles[3].length < 100) return;
      for (const list of [...tiles, ...globe]) list.sort((p, q) => p - q);
      const at = (list: number[], share: number): number => list[Math.min(list.length - 1, Math.floor(share * list.length))];
      const spanTiles = Math.log(at(tiles[3], 0.9) / at(tiles[3], 0.1)), spanGlobe = Math.log(at(globe[3], 0.9) / at(globe[3], 0.1));
      const gamma = spanTiles > 0.05 && spanGlobe > 0.05 ? THREE.MathUtils.clamp(spanGlobe / spanTiles, 0.6, 1.6) : 1;
      const gain = [0, 1, 2].map((c) => THREE.MathUtils.clamp(at(globe[c], 0.5) / at(tiles[c], 0.5) ** gamma, 0.25, 8));
      this.toneGamma.value = gamma;
      this.toneGain.value.set(gain[0], gain[1], gain[2]);
    } catch {
      // as they come
    } finally {
      this.tone = 'settled';
    }
  }

  /** A picture of level z turned out not to exist. If none of that level ever has, the level does not: use the one below as the finest. */
  private forget(z: number): void {
    if (z !== this.maxZoom || z <= this.source.lowZoom + 1) return;
    let missing = 0;
    for (const tile of this.tiles.values()) {
      if (tile.z !== z) continue;
      if (tile.state === 'ready') return;
      if (tile.state === 'failed' && tile.retryAt === Infinity) missing++;
    }
    if (missing >= 4) this.maxZoom = z - 1;
  }

  /** Forget the tiles that have gone longest without being asked for. */
  private evict(): void {
    if (this.tiles.size <= KEEP) return;
    const oldest = [...this.tiles.entries()].sort((p, q) => p[1].usedAt - q[1].usedAt).slice(0, this.tiles.size - KEEP);
    for (const [key, tile] of oldest) {
      this.discard(tile);
      this.tiles.delete(key);
    }
  }

  /** Give back everything one tile holds. */
  private discard(tile: Tile): void {
    tile.cancel?.abort();
    this.group.remove(tile.mesh);
    tile.mesh.geometry.dispose();
    tile.material.dispose();
    tile.texture?.dispose();
    tile.bitmap?.close();
  }
}

/** The Earth's close-up ground in the tracker. */
export class EarthTiles extends GroundTiles {
  constructor(earth: THREE.Object3D) {
    // Borrow the globe's city-lights picture: the same uniform objects, so it arrives here
    // the moment the globe has loaded it.
    const globeUniforms = ((earth as THREE.Mesh).material as THREE.ShaderMaterial | undefined)?.uniforms;
    super(earth, {
      source: GIBS,
      radiusKm: 6371,
      circumferenceKm: 40075,
      light: { like: 'earth', night: globeUniforms?.uNight ?? { value: null }, hasNight: globeUniforms?.uHasNight ?? { value: 0 } },
      farCover: 0.6,
    });
  }
}
