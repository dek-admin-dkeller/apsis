/**
 * All satellites as ONE THREE.Points object = a single draw call for ~20,000 objects.
 *
 * The GPU does the per-frame work: each vertex carries its position in snapshot A and in
 * snapshot B, and the vertex shader interpolates between them using one uniform (uAlpha).
 * Filtering is a per-vertex flag (aVisible), so hiding objects never rebuilds geometry.
 */

import * as THREE from 'three';
import type { Catalog } from '../data/catalog.ts';
import { elementAgeDays } from '../data/changes.ts';
import { CATEGORY_COLORS, ORBIT_COLORS, type Satellite } from '../data/types.ts';
import type { SimClient } from '../worker/SimClient.ts';
import { EARTH_RADIUS_KM, type SceneKit } from './scene.ts';

const vertexShader = /* glsl */ `
  attribute vec3 positionB;   // position in snapshot B ("position" holds snapshot A), km
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aVisible;
  uniform float uAlpha;       // 0 → snapshot A, 1 → snapshot B
  uniform float uPixelRatio;
  uniform float uSize;        // display setting: point-size multiplier
  varying vec3 vColor;
  void main() {
    float rA = length(position);
    float rB = length(positionB);
    // Interpolate direction and radius separately so objects follow the curve of their orbit.
    vec3 p = normalize(mix(position, positionB, uAlpha)) * mix(rA, rB, uAlpha);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float px = clamp(62.0 / -mv.z, 1.7, 7.0) * aSize * uSize;
    gl_PointSize = px * uPixelRatio;
    vColor = aColor;
    if (aVisible < 0.5 || rA < 1.0 || rB < 1.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // filtered out / invalid → off-screen
  }`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    float core = 1.0 - smoothstep(0.12, 0.62, r); // bright centre
    float halo = (1.0 - r) * (1.0 - r);         // soft glow
    gl_FragColor = vec4(vColor * (0.55 + core * 1.25), core * 0.95 + halo * 0.35);
  }`;

export type ColorMode = 'category' | 'orbit' | 'altitude' | 'owner' | 'age' | 'tilt' | 'fresh';

/** A colour ramp: value → colour stops, interpolated (optionally on a log scale). */
type Ramp = { stops: [number, string][]; log?: boolean };

/** Altitude (km), on a log scale from low orbit to beyond GEO. */
export const ALTITUDE_STOPS: [number, string][] = [[300, '#5ad1ff'], [800, '#6dffb0'], [2000, '#f7f06a'], [20000, '#ff9d4d'], [40000, '#ff5d8f']];
const RAMPS: Record<'altitude' | 'age' | 'tilt' | 'fresh', Ramp> = {
  altitude: { stops: ALTITUDE_STOPS, log: true },
  // launch year: the oldest hardware glows red, this year's is cyan
  age: { stops: [[1975, '#ff5d5d'], [2000, '#ff9d4d'], [2015, '#f7f06a'], [2022, '#6dffb0'], [2026, '#5ad1ff']] },
  // inclination: equatorial → mid-latitude → polar → retrograde (sun-synchronous and beyond)
  tilt: { stops: [[0, '#f7f06a'], [35, '#ff9d4d'], [55, '#5ad1ff'], [90, '#ffffff'], [100, '#b693ff'], [145, '#ff5d8f']] },
  // days since the elements were measured: today's are bright; older ones fade to a dim grey,
  // because the further a position is predicted from its measurement the less it can be trusted
  // (well past STALE_DAYS in data/changes.ts it may be far off). Uneven steps, evenly spaced in
  // the legend, since nearly everything is under two days old and the interesting part is the tail.
  fresh: { stops: [[0, '#b8f6ff'], [1, '#5ad1ff'], [3, '#5f8fb8'], [7, '#55626f'], [14, '#3a4048']] },
};

/** Who owns it, grouped into the handful of operators that own nearly everything. */
const OWNER_GROUPS: [name: string, color: string, codes: string[]][] = [
  ['United States', '#6fb1ff', ['US']],
  ['China', '#ff6b6b', ['PRC']],
  ['Russia', '#ffb454', ['CIS']],
  ['Europe', '#4ff0b4', ['ESA', 'FR', 'GER', 'IT', 'SPN', 'UK', 'EUME', 'EUTE', 'SES', 'LUXE', 'NETH', 'NOR', 'SWED', 'FIN', 'DEN', 'BEL', 'SWTZ', 'AUST', 'POL', 'CZCH', 'POR', 'GREC', 'FGER', 'FRIT']],
  ['Japan', '#ffffff', ['JPN']],
  ['India', '#ffd966', ['IND']],
];
const OWNER_OTHER = '#7f90a6';
const ownerColor = new Map<string, string>(); // owner code → colour: one hash lookup per object
for (const [, color, codes] of OWNER_GROUPS) for (const code of codes) ownerColor.set(code, color);

function ramp(r: Ramp, value: number): string {
  const { stops } = r;
  for (let i = 1; i < stops.length; i++) {
    const [a, ca] = stops[i - 1], [b, cb] = stops[i];
    if (value <= b || i === stops.length - 1) {
      const t = THREE.MathUtils.clamp(r.log ? Math.log(Math.max(value, 1) / a) / Math.log(b / a) : (value - a) / (b - a), 0, 1);
      return '#' + new THREE.Color(ca).lerp(new THREE.Color(cb), t).getHexString();
    }
  }
  return stops[0][1];
}

export function colorFor(sat: Satellite, mode: ColorMode, owner?: string, nowMs = Date.now()): string {
  switch (mode) {
    case 'category': return CATEGORY_COLORS[sat.category];
    case 'orbit': return ORBIT_COLORS[sat.orbitClass];
    case 'altitude': return ramp(RAMPS.altitude, sat.meanAltKm);
    case 'age': return sat.launchYear ? ramp(RAMPS.age, sat.launchYear) : OWNER_OTHER;
    case 'tilt': return ramp(RAMPS.tilt, sat.inclinationDeg);
    case 'owner': return (owner && ownerColor.get(owner)) || OWNER_OTHER;
    case 'fresh': return ramp(RAMPS.fresh, elementAgeDays(sat.omm, nowMs)); // an epoch in the future counts as fresh
  }
}

/** What the colours mean, for the legend under the colour picker (null = the filter chips already show it). */
export type Legend = { gradient: string; ticks: string[] } | { swatches: [string, string][] } | null;
export function legendFor(mode: ColorMode): Legend {
  const bar = (r: Ramp) => `linear-gradient(90deg, ${r.stops.map(([, c], i) => `${c} ${Math.round((i / (r.stops.length - 1)) * 100)}%`).join(', ')})`;
  switch (mode) {
    case 'altitude': return { gradient: bar(RAMPS.altitude), ticks: ['300 km', '2,000', '40,000 km'] };
    case 'age': return { gradient: bar(RAMPS.age), ticks: ['1975', '2015', 'this year'] };
    case 'tilt': return { gradient: bar(RAMPS.tilt), ticks: ['equatorial', 'polar', 'backwards'] };
    case 'fresh': return { gradient: bar(RAMPS.fresh), ticks: ['today', '3 days old', '2 weeks or more'] };
    case 'owner': return { swatches: [...OWNER_GROUPS.map(([name, color]) => [name, color] as [string, string]), ['Everyone else', OWNER_OTHER]] };
    default: return null;
  }
}

export class SatelliteCloud {
  readonly points: THREE.Points;
  /** 1 = shown, 0 = hidden by a filter. Shared with the screening worker as its mask. */
  visible = new Uint8Array(0);
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly kit: SceneKit;
  private readonly sim: SimClient;
  private attrA!: THREE.BufferAttribute;
  private attrB!: THREE.BufferAttribute;
  private attrVisible!: THREE.BufferAttribute;
  private attrColor!: THREE.BufferAttribute;
  private attrSize!: THREE.BufferAttribute;
  private baseSizes = new Float32Array(0);
  private catalog: Catalog | null = null;
  private colorMode: ColorMode = 'category';
  private owners: (index: number) => string | undefined = () => undefined;
  private highlight: Set<number> | null = null; // when set: these stand out, the rest are dimmed

  constructor(kit: SceneKit, sim: SimClient) {
    this.kit = kit;
    this.sim = sim;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uAlpha: { value: 0 }, uPixelRatio: { value: kit.pixelRatio }, uSize: { value: 1 } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false; // positions are computed in the shader
    this.points.renderOrder = 2;
    kit.eciGroup.add(this.points);
  }

  /** (Re)build the buffers for a catalogue. Positions arrive later from the worker. */
  setCatalog(catalog: Catalog): void {
    const n = catalog.sats.length;
    this.catalog = catalog;
    const sizes = new Float32Array(n);
    for (const sat of catalog.sats) {
      sizes[sat.index] = sat.category === 'Space Stations' ? 1.7 : sat.category === 'Debris' ? 0.85 : 1;
    }
    this.attrColor = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.visible = new Uint8Array(n).fill(1);
    // The position attributes wrap the SimClient's arrays directly — no copying per frame.
    this.attrA = new THREE.BufferAttribute(this.sim.posA, 3);
    this.attrB = new THREE.BufferAttribute(this.sim.posB, 3);
    this.attrVisible = new THREE.BufferAttribute(this.visible, 1);
    this.attrA.setUsage(THREE.DynamicDrawUsage);
    this.attrB.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.attrA);
    this.geometry.setAttribute('positionB', this.attrB);
    this.geometry.setAttribute('aColor', this.attrColor);
    this.baseSizes = sizes;
    this.attrSize = new THREE.BufferAttribute(new Float32Array(sizes), 1);
    this.geometry.setAttribute('aSize', this.attrSize);
    this.highlight = null;
    // The owner lookup still indexes the PREVIOUS catalogue, and the repaint below would ask it
    // about slots that catalogue never had (adding a designed satellite did exactly that and
    // threw). Drop it; main.ts hands over the new lookup straight after (setOwners).
    this.owners = () => undefined;
    this.setColorMode(this.colorMode);
    this.geometry.setAttribute('aVisible', this.attrVisible);
    this.points.visible = false; // until the first snapshot arrives
  }

  /** Recolour every point by the chosen property (type, orbit, altitude, owner, launch year, tilt or data age). */
  setColorMode(mode: ColorMode): void {
    this.colorMode = mode;
    this.repaint();
  }

  /** Where owner codes come from (the catalogue facts load after the catalogue itself). */
  setOwners(lookup: (index: number) => string | undefined): void {
    this.owners = lookup;
    if (this.colorMode === 'owner') this.repaint();
  }

  /** Make a group stand out (a launch, a constellation) and dim everything else; null = back to normal. */
  setHighlight(indices: number[] | null): void {
    this.highlight = indices && indices.length > 0 ? new Set(indices) : null;
    this.repaint();
  }

  private repaint(): void {
    if (!this.catalog) return;
    const color = new THREE.Color();
    const colors = this.attrColor.array as Float32Array;
    const sizes = this.attrSize.array as Float32Array;
    const group = this.highlight;
    const now = Date.now(); // one "now" for the whole repaint (data age is measured from the real present)
    for (const sat of this.catalog.sats) {
      const i = sat.index;
      color.set(colorFor(sat, this.colorMode, this.owners(i), now)); // sRGB hex → linear working space
      const level = !group ? 1 : group.has(i) ? 1.5 : 0.14;
      colors[i * 3] = color.r * level;
      colors[i * 3 + 1] = color.g * level;
      colors[i * 3 + 2] = color.b * level;
      sizes[i] = this.baseSizes[i] * (group?.has(i) ? 1.7 : 1);
    }
    this.attrColor.needsUpdate = true;
    this.attrSize.needsUpdate = true;
  }

  setPointSize(scale: number): void {
    this.material.uniforms.uSize.value = scale;
  }

  /** New worker snapshot: upload both position buffers to the GPU (~3 times per second). */
  onSnapshot(): void {
    this.attrA.needsUpdate = true;
    this.attrB.needsUpdate = true;
    this.points.visible = true;
  }

  /** Filters changed: upload the visibility flags. */
  visibilityChanged(): void {
    this.attrVisible.needsUpdate = true;
  }

  update(): void {
    this.material.uniforms.uAlpha.value = this.sim.alpha;
    this.material.uniforms.uPixelRatio.value = this.kit.pixelRatio;
  }

  /**
   * Which satellite is under the mouse? Projects every visible object to the screen
   * (~20k multiply-adds, well under a millisecond) and returns the nearest one within
   * `radiusPx` that is not hidden behind the Earth, or −1.
   */
  pick(clientX: number, clientY: number, radiusPx = 9): number {
    if (!this.sim.hasData) return -1;
    const { camera, eciGroup } = this.kit;
    const width = window.innerWidth, height = window.innerHeight;
    const m = new THREE.Matrix4()
      .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .multiply(eciGroup.matrixWorld).elements;
    const cam = eciGroup.worldToLocal(camera.position.clone()); // camera in ECI km
    const p = { x: 0, y: 0, z: 0 };
    let best = -1;
    let bestD2 = radiusPx * radiusPx;
    for (let i = 0; i < this.sim.count; i++) {
      if (!this.visible[i] || !this.sim.getPosition(i, p)) continue;
      const w = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
      if (w <= 0) continue; // behind the camera
      const sx = ((m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12]) / w * 0.5 + 0.5) * width;
      const sy = (0.5 - (m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13]) / w * 0.5) * height;
      const d2 = (sx - clientX) ** 2 + (sy - clientY) ** 2;
      if (d2 < bestD2 && !behindEarth(cam, p)) {
        bestD2 = d2;
        best = i;
      }
    }
    return best;
  }
}

/** Does the straight line from the camera to point p pass through the Earth? (both in ECI km) */
export function behindEarth(cam: { x: number; y: number; z: number }, p: { x: number; y: number; z: number }): boolean {
  const dx = p.x - cam.x, dy = p.y - cam.y, dz = p.z - cam.z;
  const t = -(cam.x * dx + cam.y * dy + cam.z * dz) / (dx * dx + dy * dy + dz * dz);
  if (t <= 0 || t >= 1) return false; // closest approach to Earth's centre is not between them
  const cx = cam.x + dx * t, cy = cam.y + dy * t, cz = cam.z + dz * t;
  return cx * cx + cy * cy + cz * cz < (EARTH_RADIUS_KM - 20) ** 2;
}
