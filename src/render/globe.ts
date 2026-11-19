/**
 * The Earth: day texture blended into night city lights across the real day/night
 * terminator, ocean glint, drifting clouds that cast shadows, terrain relief and an
 * atmosphere rim whose brightness follows the height of each line of sight.
 * Any texture that fails to load is replaced by a procedural fallback in the shader.
 *
 * Loading order. The whole set is about 8 MB, most of it the cloud layer. The globe is worth
 * showing long before all of that has arrived, so the textures come in two steps: first the
 * ESSENTIAL two (the day map, and the water mask the sun's glint needs), which is when
 * `essential` resolves and the home page lets the globe show through; then the night lights,
 * the terrain and the clouds, which are held back until the caller says the catalogue has
 * downloaded (they would otherwise share the connection with it). The night lights and the
 * clouds fade in when they arrive instead of appearing between one frame and the next.
 */

import * as THREE from 'three';
import { gstime, sunPos } from 'satellite.js';
import { EARTH_RADIUS } from './scene.ts';

const TEXTURES = {
  uDay: ['earth-blue-marble.jpg', true],
  uNight: ['earth-night.jpg', true],
  uTopo: ['earth-topology.png', false],
  uWater: ['earth-water.png', false],
  uClouds: ['clouds.png', false],
} as const; // [file, isColourData]

/** What the first picture needs. Everything else can arrive while the visitor is already looking. */
const ESSENTIAL = new Set(['uDay', 'uWater']);
const REST_WAIT_MS = 4000; // the longest the other textures are held back for the caller
const FADE_SECONDS = 1.6; // how long a late layer takes to appear

const ATMOSPHERE_SCALE = 1.1; // glow shell radius relative to the Earth

/**
 * The Moon's shadow during a solar eclipse (render/eclipseShadow.ts sets the uniforms). Shared,
 * word for word, by the globe and its close-up tiles (render/tiles.ts), whose lighting must match.
 */
export const ECLIPSE_GLSL = /* glsl */ `
  uniform float uEclipse;    // 1 near new Moon, when the Moon's shadow may fall on the Earth
  uniform vec3 uMoonPos;     // the Moon, world space (scene units)
  uniform vec3 uShadowSun;   // the Sun's direction, precise (world space)
  // How much sunlight reaches point P, 0…1, with the Moon in the way: the share of the Sun's
  // disc NOT covered by the Moon's as seen from P (the area where two small discs overlap). One
  // formula gives the total eclipse's dark core, an annular ring and the wide partial shadow.
  // NaN-safe: every acos/asin argument is clamped, the square root's argument kept ≥ 0, and the
  // one division by d happens only when the discs cross (d > |rs − rm| ≥ 0, and d > 0 there).
  float eclipseLight(vec3 P) {
    if (uEclipse < 0.5) return 1.0;
    vec3 toMoon = uMoonPos - P;
    float dm = max(length(toMoon), 1e-3);
    vec3 m = toMoon / dm;
    if (dot(m, uShadowSun) < 0.995) return 1.0; // the Moon is not near the Sun in this place's sky
    float rs = 0.004652;                                   // the Sun's angular radius (rad)
    float rm = asin(clamp(1.7374 / dm, 0.0, 1.0));         // the Moon's, from here (it varies ~10 %)
    float d = 2.0 * asin(clamp(length(m - uShadowSun) * 0.5, 0.0, 1.0)); // angle between their centres
    if (d >= rs + rm) return 1.0;
    float covered;
    if (d <= abs(rs - rm)) {
      covered = min(1.0, (rm * rm) / (rs * rs)); // one disc inside the other: total, or annular
    } else {
      float a = clamp((d * d + rs * rs - rm * rm) / (2.0 * d * rs), -1.0, 1.0);
      float b = clamp((d * d + rm * rm - rs * rs) / (2.0 * d * rm), -1.0, 1.0);
      float k = max(0.0, (-d + rs + rm) * (d + rs - rm) * (d - rs + rm) * (d + rs + rm));
      covered = (rs * rs * acos(a) + rm * rm * acos(b) - 0.5 * sqrt(k)) / (3.14159265 * rs * rs);
    }
    // Squared: the picture is lit in linear light, where 11 % of the sunlight (an annular
    // eclipse's centre) shows as barely a third darker; squared, the shadow reads on screen.
    float light = clamp(1.0 - covered, 0.0, 1.0);
    return light * light;
  }

`;

const earthVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec3 vPosObj;
  void main() {
    vUv = uv;
    vPosObj = position;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPosW = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const earthFragment = /* glsl */ `
  uniform sampler2D uDay, uNight, uTopo, uWater, uClouds;
  uniform float uHasDay, uHasNight, uHasTopo, uHasWater, uHasClouds;
  uniform vec3 uSunDir;      // unit vector towards the sun (world space)
  uniform float uCloudShift; // slow eastward cloud drift
  uniform float uCloudsOn;   // display setting
  uniform float uCloudFade;  // 0 while the cloud texture is still on its way, then up to 1
  uniform float uNightFade;  // the same for the city lights
  uniform float uRelief;     // terrain relief strength (stronger when the camera is close)
  uniform float uDetail;     // 0 in the whole-Earth view → 1 in close-ups: adds fine procedural detail
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec3 vPosObj;

  const vec2 TOPO_TEXEL = vec2(1.0 / 2048.0, 1.0 / 1024.0); // one texel of the height map, in uv
  const float CLOUD_HEIGHT = 0.0025;  // cloud deck height in Earth radii (exaggerated ~1.5x so the parallax reads)
  const float SHADOW_REACH = 0.0060;  // how far cloud shadows are thrown, in Earth radii per unit tan(sun angle)

  // --- small value-noise, only used when a texture is missing ---
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  ${ECLIPSE_GLSL}
  float fbm(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  // --- close-up detail noise: one lattice lookup, anchored to the ground so it never
  //     swims when the camera moves (sin-free hash: stays well behaved at large inputs) ---
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float detailNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
  }

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 toCamera = cameraPosition - vPosW;
    vec3 V = toCamera / max(length(toCamera), 1e-4);
    vec3 unit = normalize(vPosObj);
    float cosLat = max(sqrt(max(1.0 - unit.y * unit.y, 0.0)), 0.15); // a degree of longitude shrinks towards the poles

    // Local compass directions on the surface (world space).
    vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), N) + vec3(1e-5, 0.0, 0.0));
    vec3 north = cross(N, east);
    // Converts a small step in the tangent plane (in Earth radii: east, north) into a uv step.
    vec2 tangentToUv = vec2(0.159155 / cosLat, 0.318310);

    // ---- Surface colour + land/water mask. The procedural continents are only
    //      evaluated when a texture is missing (the branches test uniforms, so they are free).
    float land = 0.0;
    if (uHasDay < 0.5 || uHasWater < 0.5 || (uHasNight < 0.5 && uNightFade > 0.0)) land = smoothstep(0.50, 0.54, fbm(unit * 2.2 + 3.0));
    vec3 dayColor;
    if (uHasDay > 0.5) {
      dayColor = texture2D(uDay, vUv).rgb;
    } else {
      dayColor = mix(vec3(0.02, 0.09, 0.22), mix(vec3(0.10, 0.22, 0.07), vec3(0.32, 0.26, 0.16), fbm(unit * 6.0)), land);
      dayColor = mix(dayColor, vec3(0.85), smoothstep(0.82, 0.92, abs(unit.y)));
    }
    float water = uHasWater > 0.5 ? texture2D(uWater, vUv).r : 1.0 - land;

    // ---- Close-up detail. From a few hundred km up one texel of the photo textures
    //      covers ~10 km and the ground would look smeared, so two scales of noise
    //      (~7 km and ~2 km blobs) break up the land, the shoreline, the sea and the cloud
    //      edges. Each scale fades out before it gets smaller than a pixel (no shimmer),
    //      and all of it is off (uDetail = 0) in the whole-Earth view.
    float detail = 0.0;
    if (uDetail > 0.001) {
      float footprint = length(fwidth(unit)); // ground covered by one pixel, in Earth radii
      float coarse = uDetail * (1.0 - smoothstep(0.15, 0.50, footprint * 900.0));
      float fine = uDetail * (1.0 - smoothstep(0.15, 0.50, footprint * 3400.0));
      if (coarse > 0.001) detail += (detailNoise(unit * 900.0) - 0.5) * 1.2 * coarse;
      if (fine > 0.001) detail += (detailNoise(unit.yzx * 3400.0 + 17.3) - 0.5) * 0.8 * fine;

      float shore = 4.0 * water * (1.0 - water);                       // 1 on the blurred shoreline, 0 inland and at sea
      float waterSharp = smoothstep(0.38, 0.62, water + detail * 0.22); // a crisper, ragged coast
      dayColor *= 1.0 + shore * uDetail * mix(0.10, -0.12, waterSharp);
      water = mix(water, waterSharp, uDetail * 0.85);
      dayColor *= 1.0 + detail * mix(0.22, 0.08, water);               // mottled land, gently varied sea
    }

    // ---- Terrain relief: tilt the normal by the slope of the height map. Central
    //      differences one texel apart (never less, or magnified texels would show as
    //      facets; more when the surface is minified, so distant mountains don't shimmer).
    vec3 Nb = N;
    if (uHasTopo > 0.5) {
      vec2 stepUv = clamp(fwidth(vUv) * 0.75, TOPO_TEXEL, vec2(0.01));
      float hE = texture2D(uTopo, vUv + vec2(stepUv.x, 0.0)).r;
      float hW = texture2D(uTopo, vUv - vec2(stepUv.x, 0.0)).r;
      float hN = texture2D(uTopo, vUv + vec2(0.0, stepUv.y)).r;
      float hS = texture2D(uTopo, vUv - vec2(0.0, stepUv.y)).r;
      // Height change per texel of ground distance; east-west texels are narrower near the poles.
      vec2 slope = vec2((hE - hW) * TOPO_TEXEL.x / (stepUv.x * cosLat), (hN - hS) * TOPO_TEXEL.y / stepUv.y);
      Nb = normalize(N - uRelief * (slope.x * east + slope.y * north));
    }

    float sun = dot(N, uSunDir);
    float day = smoothstep(-0.10, 0.20, sun); // 0 = night side, 1 = day side

    // ---- Clouds: drifting slowly east, lifted off the surface (parallax), and casting
    //      soft shadows on the ground on the side away from the sun.
    vec2 cloudUv = vUv - vec2(uCloudShift, 0.0);
    vec2 viewTangent = vec2(dot(V, east), dot(V, north)) / max(dot(N, V), 0.30);
    vec2 sunTangent = vec2(dot(uSunDir, east), dot(uSunDir, north)) / max(sun, 0.25);
    vec2 shadowUv = cloudUv + sunTangent * SHADOW_REACH * tangentToUv;
    float cloud;
    float cloudSunward; // cloud cover a short way towards the sun = what shades this spot
    if (uHasClouds > 0.5) {
      cloud = texture2D(uClouds, cloudUv + viewTangent * CLOUD_HEIGHT * tangentToUv).a;
      cloudSunward = texture2D(uClouds, shadowUv, 1.5).a; // +1.5 mip levels = a soft-edged shadow
    } else if (uCloudFade > 0.0) { // the texture failed: made-up clouds (not while it is merely still loading)
      cloud = smoothstep(0.55, 0.75, fbm(unit * 4.0 + vec3(uCloudShift * 40.0, 0.0, 0.0))) * 0.7;
      cloudSunward = cloud * 0.6;
    } else {
      cloud = 0.0;
      cloudSunward = 0.0;
    }
    cloud = clamp(cloud + detail * 1.4 * cloud * (1.0 - cloud), 0.0, 1.0); // close-up: ragged, finer cloud edges
    cloud *= uCloudsOn * uCloudFade;
    cloudSunward *= uCloudsOn * uCloudFade;
    float groundLight = 1.0 - 0.45 * cloudSunward;

    // ---- Day side: sunlit surface.
    float diffuse = max(dot(Nb, uSunDir), 0.0);
    vec3 lit = dayColor * (0.05 + 1.1 * diffuse * groundLight);

    // Sun on water: a tight glint at the mirror point plus a broad, faint sheen. Water
    // reflects far more at grazing angles (Fresnel), so both strengthen towards the limb.
    vec3 halfRaw = uSunDir + V;
    vec3 H = halfRaw / max(length(halfRaw), 1e-4);
    float nDotH = clamp(dot(N, H), 0.0, 1.0);
    float fresnelWater = 0.02 + 0.98 * pow(clamp(1.0 - dot(V, H), 0.0, 1.0), 5.0);
    float glint = pow(nDotH, 900.0) * 0.9 + pow(nDotH, 48.0) * 0.05;
    lit += vec3(1.0, 0.94, 0.82) * glint * water * min(0.33 + 1.6 * fresnelWater, 1.0) * groundLight * (1.0 - cloud);

    // Cloud tops: white by day, warm near the terminator, with the sun-facing edge of
    // each cloud a little brighter than the far edge.
    vec3 cloudTint = mix(vec3(1.0, 0.56, 0.32), vec3(0.95, 0.96, 0.98), smoothstep(0.02, 0.32, sun));
    float cloudShade = 0.78 + 0.20 * clamp(cloud - cloudSunward, -1.0, 1.0) + 0.07 * detail;
    lit = mix(lit, cloudTint * cloudShade * (0.04 + 0.96 * smoothstep(-0.06, 0.26, sun)), cloud * 0.88);

    // ---- Night side: city lights — dim sprawl is sodium-orange, bright cores whiter —
    //      switched on through dusk, dimmed under cloud; plus a trace of moonlight.
    vec3 lights;
    if (uHasNight > 0.5) {
      vec3 nightTex = texture2D(uNight, vUv).rgb;
      float brightness = max(nightTex.r, max(nightTex.g, nightTex.b));
      lights = nightTex * mix(vec3(1.36, 0.94, 0.54), vec3(1.16, 1.08, 0.92), smoothstep(0.25, 0.90, brightness)) * 1.55;
    } else if (uNightFade > 0.0) {
      lights = vec3(1.0, 0.75, 0.4) * land * step(0.62, noise(unit * 90.0)) * 0.75;
    } else {
      lights = vec3(0.0);
    }
    float lightsOn = (1.0 - smoothstep(-0.14, 0.03, sun)) * uNightFade;
    // Faint moonlit tone, so a close-up over an unlit ocean is dim rather than a black screen.
    vec3 night = dayColor * vec3(0.030, 0.038, 0.060) + vec3(0.0022, 0.0030, 0.0055);
    night = mix(night, vec3(0.034, 0.042, 0.066), cloud * 0.6);

    // A solar eclipse: the day side darkens under the Moon's shadow (totality is as dark as night).
    float eclipse = eclipseLight(vPosW);
    float dayLit = day * eclipse;
    vec3 color = mix(night, lit, dayLit) + lights * lightsOn * (1.0 - cloud * 0.75);

    // ---- Air: a warm band along the terminator (sunset/sunrise) and haze towards the
    //      limb, blue in daylight and reddening where the sun is low.
    float twilight = smoothstep(-0.12, 0.04, sun) * (1.0 - smoothstep(0.04, 0.30, sun));
    color += vec3(0.95, 0.42, 0.16) * twilight * 0.07;
    float fresnel = pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 3.2); // clamp: a negative base would make pow() return NaN
    vec3 haze = mix(vec3(0.80, 0.40, 0.20), vec3(0.22, 0.52, 1.0), smoothstep(0.0, 0.30, sun));
    color += haze * fresnel * 0.80 * dayLit + vec3(0.022, 0.052, 0.10) * fresnel * (1.0 - day);

    gl_FragColor = vec4(clamp(color, 0.0, 8.0), 1.0);
  }`;

// The glow shell is a slightly larger sphere drawn from the inside. For every pixel we
// work out how close its line of sight passes to the Earth (the "tangent height") and
// let the glow fall off exponentially with that height, like real air density.
const atmosphereFragment = /* glsl */ `
  uniform vec3 uSunDir;
  uniform float uFade;   // 0 when the camera is down inside the shell, 1 from far away
  uniform float uRadius; // Earth radius
  uniform float uShell;  // shell radius
  varying vec3 vPosW;
  void main() {
    vec3 ray = vPosW - cameraPosition;
    vec3 D = ray / max(length(ray), 1e-4);

    // Closest point of the line of sight to the Earth's centre. If it lies behind the
    // camera (looking up and out), the lowest air on the ray is where the camera is.
    float along = -dot(cameraPosition, D);
    vec3 closest = along > 0.0 ? cameraPosition + D * along : cameraPosition;
    float closestDist = max(length(closest), 1e-3);
    vec3 up = closest / closestDist;
    // 0 at the Earth's limb, 1 at the outer edge of the shell.
    float height = clamp((closestDist - uRadius) / (uShell - uRadius), 0.0, 1.0);

    // A thin bright rim hugging the limb + a wide faint halo. Close up, only an even
    // thinner rim is kept so the view is never fogged.
    float rim = exp(-height * mix(16.0, 6.5, uFade));
    float halo = exp(-height * 2.3) * 0.24 * uFade;
    float edge = 1.0 - smoothstep(0.75, 1.0, height); // reach exactly zero at the shell's silhouette

    float sun = dot(up, uSunDir);                      // is the air at that point in sunlight?
    float lit = smoothstep(-0.30, 0.25, sun);
    float sunset = smoothstep(-0.34, -0.04, sun) * (1.0 - smoothstep(-0.04, 0.26, sun));
    float towardSun = pow(clamp(dot(D, uSunDir), 0.0, 1.0), 8.0); // forward scattering: brighter looking sunwards

    vec3 blue = mix(vec3(0.10, 0.22, 0.55), vec3(0.30, 0.62, 1.0), lit);
    vec3 color = blue * (rim + halo) * (0.10 + 0.95 * lit) * (1.0 - 0.55 * sunset);
    color += vec3(1.0, 0.46, 0.18) * sunset * exp(-height * 9.0) * (0.55 + 0.7 * towardSun);
    color += vec3(1.0, 0.85, 0.70) * towardSun * lit * rim * 0.35;
    // Night-side airglow: a faint green layer just above the limb.
    float layer = (height - 0.13) / 0.05;
    color += vec3(0.10, 0.42, 0.24) * exp(-layer * layer) * 0.045 * (1.0 - lit) * mix(0.35, 1.0, uFade);

    gl_FragColor = vec4(clamp(color * edge * mix(0.75, 1.0, uFade), 0.0, 4.0), 1.0);
  }`;

export interface Globe {
  /** Rotate the Earth and move the sun to where they really are at `date`. */
  update(date: Date, realSeconds: number, cameraDistance: number): void;
  /** Unit vector from Earth to the sun, in scene coordinates. */
  sunDirection: THREE.Vector3;
  setClouds(on: boolean): void;
  setAtmosphere(on: boolean): void;
  /** The Moon (world, scene units) and the Sun's precise direction for the eclipse shadow (render/eclipseShadow.ts); null switches it off. */
  setEclipse(moonWorld: THREE.Vector3 | null, sunWorld: THREE.Vector3 | null): void;
  /** The node that turns with the planet — parent map overlays to it so they rotate too. */
  readonly earth: THREE.Object3D;
}

/**
 * @param holdRest the textures beyond the essential two wait for this (at most a few seconds):
 *                 pass the promise of the catalogue's download so they do not compete with it.
 * @returns `essential` resolves when there is a globe worth showing, `ready` when every texture is in.
 */
export function createGlobe(scene: THREE.Scene, onProgress: () => void, holdRest: Promise<unknown> = Promise.resolve()): { globe: Globe; ready: Promise<void>; essential: Promise<void> } {
  const uniforms: Record<string, THREE.IUniform> = {
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    uEclipse: { value: 0 },
    uMoonPos: { value: new THREE.Vector3(0, 0, 384) },
    uShadowSun: { value: new THREE.Vector3(1, 0, 0) },
    uCloudShift: { value: 0 },
    uFade: { value: 1 },
    uCloudsOn: { value: 1 },
    uCloudFade: { value: 0 },
    uNightFade: { value: 0 },
    uRelief: { value: 2.4 },
    uDetail: { value: 0 },
  };
  const loader = new THREE.TextureLoader();
  const settled = new Set<string>(); // textures that have arrived or failed: either way, no longer awaited
  const names = Object.keys(TEXTURES) as (keyof typeof TEXTURES)[];
  for (const name of names) {
    uniforms[name] = { value: null };
    uniforms[name.replace('u', 'uHas')] = { value: 0 };
  }
  const load = (name: keyof typeof TEXTURES): Promise<void> => {
    const [file, isColour] = TEXTURES[name];
    return loader.loadAsync(`./textures/${file}`).then(
      (texture) => {
        texture.colorSpace = isColour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.anisotropy = 16; // three.js clamps this to what the GPU supports
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        uniforms[name].value = texture;
        uniforms[name.replace('u', 'uHas')].value = 1;
      },
      () => undefined, // missing texture → keep the procedural fallback, no error
    ).then(() => {
      settled.add(name);
      onProgress();
    });
  };
  const essential = Promise.all(names.filter((name) => ESSENTIAL.has(name)).map(load)).then(() => undefined);
  const held = Promise.race([holdRest.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, REST_WAIT_MS))]);
  const ready = Promise.all([essential, held]).then(() => Promise.all(names.filter((name) => !ESSENTIAL.has(name)).map(load))).then(() => undefined);

  const earth = new THREE.Mesh(
    // 320 × 160 segments: the limb stays round (facets < half a pixel) from 300 km up.
    new THREE.SphereGeometry(EARTH_RADIUS, 320, 160),
    new THREE.ShaderMaterial({ uniforms, vertexShader: earthVertex, fragmentShader: earthFragment }),
  );
  scene.add(earth);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS * ATMOSPHERE_SCALE, 160, 80),
    new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: uniforms.uSunDir,
        uFade: uniforms.uFade,
        uRadius: { value: EARTH_RADIUS },
        uShell: { value: EARTH_RADIUS * ATMOSPHERE_SCALE },
      },
      vertexShader: earthVertex,
      fragmentShader: atmosphereFragment,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
  scene.add(atmosphere);

  const sunDirection = uniforms.uSunDir.value as THREE.Vector3;
  let lastSeconds = -1;
  let cloudShift = 0;
  const globe: Globe = {
    earth,
    sunDirection,
    setClouds: (on) => (uniforms.uCloudsOn.value = on ? 1 : 0),
    setAtmosphere: (on) => (atmosphere.visible = on),
    setEclipse: (moonWorld, sunWorld) => {
      uniforms.uEclipse.value = moonWorld && sunWorld ? 1 : 0;
      if (moonWorld) (uniforms.uMoonPos.value as THREE.Vector3).copy(moonWorld);
      if (sunWorld) (uniforms.uShadowSun.value as THREE.Vector3).copy(sunWorld);
    },
    update(date, realSeconds, cameraDistance) {
      // Seen from inside, the glow shell would fog the whole sky — fade it out as the camera descends.
      const shell = EARTH_RADIUS * ATMOSPHERE_SCALE;
      uniforms.uFade.value = THREE.MathUtils.smoothstep(cameraDistance, shell * 1.02, shell * 1.5);
      // Terrain relief is strongest in close-ups and eases off with distance.
      uniforms.uRelief.value = THREE.MathUtils.lerp(3.4, 1.9, THREE.MathUtils.smoothstep(cameraDistance, 9, 40));
      // A default three.js sphere has longitude 0° on +X, which matches our ECI→scene
      // mapping, so turning it by the sidereal angle puts Greenwich where it really is.
      earth.rotation.y = gstime(date);
      const julianDate = date.getTime() / 86400000 + 2440587.5;
      const sun = sunPos(julianDate).rsun; // ECI
      sunDirection.set(sun.x, sun.z, -sun.y).normalize(); // ECI → scene axes
      // Close-up detail fades in below ~6,600 km altitude and is complete near 900 km.
      uniforms.uDetail.value = 1 - THREE.MathUtils.smoothstep(cameraDistance, 7.3, 13);
      // Cloud drift is a whole-Earth flourish (one lap in ~28 real minutes). Seen from a
      // few hundred km up that would be clouds racing past at 24 km/s, so it slows to
      // almost nothing as the camera descends. Accumulated, so the rate can change smoothly.
      const dt = lastSeconds < 0 ? 0 : THREE.MathUtils.clamp(realSeconds - lastSeconds, 0, 0.25);
      lastSeconds = realSeconds;
      // Layers that arrive after the globe is on show come up gently.
      if (settled.has('uClouds')) uniforms.uCloudFade.value = Math.min(1, uniforms.uCloudFade.value + dt / FADE_SECONDS);
      if (settled.has('uNight')) uniforms.uNightFade.value = Math.min(1, uniforms.uNightFade.value + dt / FADE_SECONDS);
      const drift = 0.0006 * (0.03 + 0.97 * THREE.MathUtils.smoothstep(cameraDistance, 9, 30));
      cloudShift = (cloudShift + dt * drift) % 1;
      uniforms.uCloudShift.value = cloudShift;
    },
  };
  return { globe, ready, essential };
}
