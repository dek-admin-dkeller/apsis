/**
 * A planet, a moon or the Sun as a lit sphere, and Saturn's rings.
 *
 * One shader draws every body that shines by reflected sunlight. What differs between an
 * airless grey moon and a gas giant is a handful of numbers (LOOKS below): how soft the edge of
 * night is, how much the disc darkens towards its limb, the colour of the glow along the lit
 * edge. The map is an ordinary equirectangular picture (longitude 0 in the middle); until it
 * has loaded the body is drawn in its plain colour, so a place never opens on a black ball.
 *
 * Shadows are worked out per pixel from geometry, not from a shadow map: for each nearby body
 * ("occluder") the pixel asks whether the line from itself to the Sun passes through that
 * body. That gives a moon's shadow crossing its planet, a moon dimming as it enters its planet's
 * shadow, and eclipses on the Earth and Moon, for a few dot products a pixel on any machine.
 * The rings shade the planet the same way (a ray to the ring plane), and the planet shades the
 * rings.
 *
 * Shader hygiene (see CLAUDE.md): no pow() of a possibly negative base, every smoothstep with
 * its edges in order, no division without a guard, the output clamped.
 */

import * as THREE from 'three';
import type { BodyId } from '../../space/types.ts';

export const MAX_OCCLUDERS = 6;

interface Look {
  /** 0 = airless (a hard edge of night), 1 = a thick atmosphere (soft edge, dark limb). */
  haze: number;
  /** Glow along the sunlit limb: colour and strength. */
  rim: [number, number, number];
  rimStrength: number;
  /** How bright the sunlit side is drawn (the bloom pass sits on top, so pale worlds stay under 1). */
  gain: number;
}
const AIRLESS: Look = { haze: 0, rim: [0, 0, 0], rimStrength: 0, gain: 1.15 };
const LOOKS: Partial<Record<BodyId, Look>> = {
  venus: { haze: 1, rim: [1.0, 0.86, 0.6], rimStrength: 0.35, gain: 0.95 },
  earth: { haze: 0.55, rim: [0.35, 0.6, 1.0], rimStrength: 0.55, gain: 1.05 },
  mars: { haze: 0.18, rim: [0.95, 0.6, 0.42], rimStrength: 0.22, gain: 1.1 },
  jupiter: { haze: 0.85, rim: [0.9, 0.8, 0.66], rimStrength: 0.1, gain: 1.0 },
  saturn: { haze: 0.85, rim: [0.95, 0.86, 0.66], rimStrength: 0.1, gain: 1.0 },
  uranus: { haze: 1, rim: [0.6, 0.9, 0.95], rimStrength: 0.18, gain: 0.95 },
  neptune: { haze: 1, rim: [0.4, 0.55, 1.0], rimStrength: 0.22, gain: 1.0 },
  titan: { haze: 1, rim: [1.0, 0.72, 0.36], rimStrength: 0.4, gain: 0.95 },
  pluto: { haze: 0.08, rim: [0.5, 0.65, 1.0], rimStrength: 0.12, gain: 1.1 },
  triton: { haze: 0.04, rim: [0.6, 0.7, 1.0], rimStrength: 0.05, gain: 1.1 },
};

const VERTEX = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec2 vUv;
  void main() {
    // Maps are decoded off the main thread into bitmaps, which arrive the right way up (row 0 =
    // north); a sphere's v runs from the south. So v is turned over here, once, for every map.
    vUv = vec2(uv.x, 1.0 - uv.y);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPosW = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const BODY_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uUseMap;      // 0 until the map has loaded
  uniform vec3 uColor;        // the plain colour used until then
  uniform vec3 uSunDir;       // unit vector towards the Sun
  uniform float uSunSize;     // the Sun's angular radius as seen from here, radians (soft shadow edges)
  uniform vec3 uCentre;       // this body's centre
  uniform vec3 uPole;         // its north pole (the normal of the ring plane)
  uniform float uHaze;
  uniform vec3 uRim;
  uniform float uGain;
  uniform float uNight;       // faint fill on the dark side
  uniform vec4 uOcc[${MAX_OCCLUDERS}];   // bodies that can cast a shadow here: centre, radius
  uniform int uOccCount;
  uniform sampler2D uRingMap;
  uniform vec3 uRing;         // inner radius, outer radius, how much light the densest part stops (0 = no rings)
  uniform sampler2D uNightMap;   // lights on the dark side (the Earth's cities)
  uniform float uUseNight;
  uniform sampler2D uCloudMap;   // cloud cover in its alpha channel
  uniform float uUseClouds;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec2 vUv;

  // 1 = this body does not hide the Sun from the pixel, 0 = it hides it completely.
  float lightPast(vec4 occ) {
    vec3 toOcc = occ.xyz - vPosW;
    float along = dot(toOcc, uSunDir);                 // how far towards the Sun the other body lies
    if (along <= 0.0) return 1.0;                      // it is on the night side of this pixel
    float miss = length(toOcc - uSunDir * along);      // how far the ray to the Sun passes from its centre
    float blur = max(along * uSunSize, occ.w * 0.03);  // half-width of the penumbra
    return smoothstep(occ.w - blur, occ.w + blur, miss);
  }

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vPosW);
    float ndl = dot(n, uSunDir);
    float mu = max(dot(n, v), 0.0);
    vec3 albedo = mix(uColor, texture2D(uMap, vUv).rgb, uUseMap);
    float cloud = texture2D(uCloudMap, vUv).a * uUseClouds;
    albedo = mix(albedo, vec3(0.9), cloud * 0.92);

    // Dusty airless ground scatters light back, so its lit disc is nearly evenly bright with a
    // hard edge; a thick atmosphere wraps the light a little way round into the night.
    // (render/tiles.ts repeats this lighting for the close-up ground of a body: change both.)
    float hard = pow(max(ndl, 0.0), 0.75);
    float soft = clamp((ndl + 0.12) / 1.12, 0.0, 1.0);
    float lit = mix(hard, soft * soft * (3.0 - 2.0 * soft), uHaze);
    float limb = mix(1.0, 0.42 + 0.58 * pow(mu, 0.55), uHaze);

    float sun = 1.0;
    for (int i = 0; i < ${MAX_OCCLUDERS}; i++) {
      if (i >= uOccCount) break;
      sun = min(sun, lightPast(uOcc[i]));
    }
    if (uRing.z > 0.0) {
      // Where does the line to the Sun cross the ring plane, and how dense are the rings there?
      // The ring picture is read for EVERY pixel and the result masked afterwards: read inside
      // per-pixel conditions (lit side, the right side of the plane, within the rings), the GPU
      // cannot tell which mip level to use at their edges and drew a dashed seam along the
      // shadow's outer edge (the owner saw it on Saturn).
      float tilt = dot(uSunDir, uPole);
      float safeTilt = abs(tilt) > 1.0e-4 ? tilt : 1.0e-4;
      vec3 rel = vPosW - uCentre;
      float t = -dot(rel, uPole) / safeTilt;
      float u = (length(rel + uSunDir * t) - uRing.x) / max(uRing.y - uRing.x, 1.0e-6);
      float density = texture2D(uRingMap, vec2(clamp(u, 0.0, 1.0), 0.5)).a;
      float inside = step(0.0, u) * step(u, 1.0) * step(0.0, t) * step(1.0e-4, abs(tilt)) * step(0.0, ndl);
      sun *= 1.0 - density * inside * uRing.z;
    }

    vec3 col = albedo * (lit * limb * sun * uGain + uNight);
    // City lights where it is night, dimmer under cloud.
    col += texture2D(uNightMap, vUv).rgb * uUseNight * (1.0 - smoothstep(-0.12, 0.08, ndl)) * (1.0 - cloud * 0.7) * 0.85;
    float edge = 1.0 - mu;
    col += uRim * (edge * edge * edge) * smoothstep(-0.15, 0.4, ndl) * sun;
    gl_FragColor = vec4(clamp(col, 0.0, 4.0), 1.0);
  }`;

const SUN_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uUseMap;
  uniform vec3 uColor;
  uniform float uTime;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec2 vUv;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  void main() {
    vec3 n = normalize(vNormalW);
    float mu = max(dot(n, normalize(cameraPosition - vPosW)), 0.0);
    vec3 base = mix(uColor, texture2D(uMap, vUv).rgb, uUseMap);
    // Slowly boiling granulation on top of the map, so the surface is never perfectly still.
    float boil = noise(n * 26.0 + vec3(0.0, uTime * 0.05, 0.0)) * 0.5 + noise(n * 61.0 - vec3(uTime * 0.07, 0.0, 0.0)) * 0.25;
    float limb = 0.32 + 0.68 * pow(mu, 0.5);           // the edge of the disc is cooler and darker
    float edge = 1.0 - mu;
    // Bright enough to glow through the bloom pass, not so bright that the surface washes out to white.
    vec3 col = base * (0.75 + boil * 0.5) * limb * 1.25 + vec3(1.0, 0.62, 0.25) * edge * edge * edge * 0.55;
    gl_FragColor = vec4(clamp(col, 0.0, 6.0), 1.0);
  }`;

// The air above the limb: a slightly larger shell seen from inside out, brightest where it
// meets the planet's edge and gone by its own. cos is the angle at the shell's far wall; at the
// planet's limb it has a fixed value that depends only on how much bigger the shell is.
const AIR_FRAGMENT = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uRim;
  uniform float uLimbCos;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vPosW);
    float depth = clamp(dot(-n, v) / uLimbCos, 0.0, 1.0);
    float day = smoothstep(-0.25, 0.35, dot(n, uSunDir));
    gl_FragColor = vec4(uRim * depth * depth * day * 1.6, 1.0);
  }`;
const AIR_SCALE = 1.035;

const RING_VERTEX = /* glsl */ `
  attribute float aAcross;    // 0 at the inner edge … 1 at the outer edge
  varying float vAcross;
  varying vec3 vPosW;
  void main() {
    vAcross = aAcross;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPosW = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const RING_FRAGMENT = /* glsl */ `
  uniform sampler2D uRingMap;
  uniform vec3 uSunDir;
  uniform vec3 uCentre;
  uniform vec3 uPole;
  uniform float uPlanetRadius;
  varying float vAcross;
  varying vec3 vPosW;
  void main() {
    vec4 ring = texture2D(uRingMap, vec2(vAcross, 0.5));
    // The planet's shadow lying across the rings.
    vec3 rel = vPosW - uCentre;
    float along = dot(rel, uSunDir);
    float miss = length(rel - uSunDir * along);
    float sun = along < 0.0 ? smoothstep(uPlanetRadius * 0.985, uPlanetRadius * 1.02, miss) : 1.0;
    // Seen from the sunlit face the rings are bright; from the other face only the light that
    // filters through the thin parts reaches the eye.
    float sunSide = dot(uSunDir, uPole);
    float eyeSide = dot(normalize(cameraPosition - vPosW), uPole);
    float sameFace = sunSide * eyeSide >= 0.0 ? 1.0 : 0.3 * (1.0 - ring.a * 0.6);
    vec3 col = ring.rgb * sun * sameFace * (0.5 + 0.6 * abs(sunSide));
    gl_FragColor = vec4(clamp(col, 0.0, 2.0), ring.a);
  }`;

const blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
blank.needsUpdate = true;

export interface BodyMesh {
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
  ring: THREE.Mesh | null;
  ringUniforms: Record<string, THREE.IUniform> | null;
  /** Give it its map (or take it away again with null). */
  setMap(texture: THREE.Texture | null): void;
  /** The Earth's two extra pictures: lights on its night side, and cloud cover (in the alpha channel). */
  setExtras(night: THREE.Texture | null, clouds: THREE.Texture | null): void;
  dispose(): void;
}

/**
 * @param radius    scene units
 * @param segments  around the equator: more on the High setting, fewer for a dot beside its planet
 */
export function createBody(id: BodyId, color: [number, number, number], radius: number, segments: number): BodyMesh {
  const star = id === 'sun';
  const look = LOOKS[id] ?? AIRLESS;
  const uniforms: Record<string, THREE.IUniform> = {
    uMap: { value: blank },
    uUseMap: { value: 0 },
    uColor: { value: new THREE.Vector3(...color) },
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    uSunSize: { value: 0.0046 },
    uCentre: { value: new THREE.Vector3() },
    uPole: { value: new THREE.Vector3(0, 1, 0) },
    uHaze: { value: look.haze },
    uRim: { value: new THREE.Vector3(...look.rim).multiplyScalar(look.rimStrength) },
    uGain: { value: look.gain },
    uNight: { value: 0.012 },
    uOcc: { value: Array.from({ length: MAX_OCCLUDERS }, () => new THREE.Vector4()) },
    uOccCount: { value: 0 },
    uRingMap: { value: blank },
    uRing: { value: new THREE.Vector3(0, 1, 0) },
    uNightMap: { value: blank },
    uUseNight: { value: 0 },
    uCloudMap: { value: blank },
    uUseClouds: { value: 0 },
  };
  const geometry = new THREE.SphereGeometry(radius, segments, Math.max(8, segments >> 1));
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: star ? SUN_FRAGMENT : BODY_FRAGMENT });
  const mesh = new THREE.Mesh(geometry, material);

  let air: THREE.Mesh | null = null;
  if (!star && look.haze > 0.1 && look.rimStrength > 0 && segments >= 64) {
    air = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
      uniforms: { uSunDir: uniforms.uSunDir, uRim: uniforms.uRim, uLimbCos: { value: Math.sqrt(1 - 1 / (AIR_SCALE * AIR_SCALE)) } },
      vertexShader: VERTEX,
      fragmentShader: AIR_FRAGMENT,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }));
    air.scale.setScalar(AIR_SCALE);
    mesh.add(air);
  }

  return {
    mesh,
    uniforms,
    ring: null,
    ringUniforms: null,
    setMap(texture) {
      uniforms.uMap.value = texture ?? blank;
      uniforms.uUseMap.value = texture ? 1 : 0;
    },
    setExtras(night, clouds) {
      uniforms.uNightMap.value = night ?? blank;
      uniforms.uUseNight.value = night ? 1 : 0;
      uniforms.uCloudMap.value = clouds ?? blank;
      uniforms.uUseClouds.value = clouds ? 1 : 0;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      (air?.material as THREE.Material | undefined)?.dispose();
      this.ring?.geometry.dispose();
      (this.ring?.material as THREE.Material | undefined)?.dispose();
    },
  };
}

/**
 * Rings for `body`: a flat annulus in its equatorial plane (a child of the body's mesh, so it
 * tilts with the planet), and the uniforms on the planet that let the rings shade it.
 * `inner` / `outer` are scene units.
 */
export function addRing(body: BodyMesh, strip: THREE.Texture, inner: number, outer: number, planetRadius: number): void {
  const around = 160;
  const position = new Float32Array((around + 1) * 2 * 3);
  const across = new Float32Array((around + 1) * 2);
  const index: number[] = [];
  for (let i = 0; i <= around; i++) {
    const a = (i / around) * Math.PI * 2;
    position.set([Math.cos(a) * inner, 0, Math.sin(a) * inner, Math.cos(a) * outer, 0, Math.sin(a) * outer], i * 6);
    across.set([0, 1], i * 2);
    if (i < around) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aAcross', new THREE.BufferAttribute(across, 1));
  geometry.setIndex(index);
  const ringUniforms: Record<string, THREE.IUniform> = {
    uRingMap: { value: strip },
    uSunDir: body.uniforms.uSunDir, // the same objects as the planet's, so one update serves both
    uCentre: body.uniforms.uCentre,
    uPole: body.uniforms.uPole,
    uPlanetRadius: { value: planetRadius },
  };
  const ring = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
    uniforms: ringUniforms,
    vertexShader: RING_VERTEX,
    fragmentShader: RING_FRAGMENT,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  }));
  ring.renderOrder = 2;
  body.mesh.add(ring);
  body.ring = ring;
  body.ringUniforms = ringUniforms;
  body.uniforms.uRingMap.value = strip;
  (body.uniforms.uRing.value as THREE.Vector3).set(inner, outer, 0.85);
}

/** A soft round glow (the Sun's corona, the Sun as a far-off light): white centre fading to nothing. */
export function glowTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,250,235,1)');
  gradient.addColorStop(0.06, 'rgba(255,240,205,0.95)');
  gradient.addColorStop(0.16, 'rgba(255,205,140,0.34)');
  gradient.addColorStop(0.42, 'rgba(255,170,95,0.08)');
  gradient.addColorStop(1, 'rgba(255,150,80,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
