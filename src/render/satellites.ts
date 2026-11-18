/**
 * All satellites as ONE THREE.Points object = a single draw call for ~20,000 objects.
 *
 * The GPU does the per-frame work: each vertex carries its position in snapshot A and in
 * snapshot B, and the vertex shader interpolates between them using one uniform (uAlpha).
 * Filtering is a per-vertex flag (aVisible), so hiding objects never rebuilds geometry.
 */

import * as THREE from 'three';
import type { Catalog } from '../data/catalog.ts';
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

export type ColorMode = 'category' | 'orbit' | 'altitude';

/** Altitude colour ramp stops (km → colour), on a log scale from low orbit to beyond GEO. */
export const ALTITUDE_STOPS: [number, string][] = [[300, '#5ad1ff'], [800, '#6dffb0'], [2000, '#f7f06a'], [20000, '#ff9d4d'], [40000, '#ff5d8f']];

export function colorFor(sat: Satellite, mode: ColorMode): string {
  if (mode === 'category') return CATEGORY_COLORS[sat.category];
  if (mode === 'orbit') return ORBIT_COLORS[sat.orbitClass];
  const alt = Math.max(sat.meanAltKm, 1);
  for (let i = 1; i < ALTITUDE_STOPS.length; i++) {
    const [a, ca] = ALTITUDE_STOPS[i - 1], [b, cb] = ALTITUDE_STOPS[i];
    if (alt <= b || i === ALTITUDE_STOPS.length - 1) {
      const t = THREE.MathUtils.clamp(Math.log(alt / a) / Math.log(b / a), 0, 1);
      return '#' + new THREE.Color(ca).lerp(new THREE.Color(cb), t).getHexString();
    }
  }
  return ALTITUDE_STOPS[0][1];
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
  private catalog: Catalog | null = null;
  private colorMode: ColorMode = 'category';

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
    this.setColorMode(this.colorMode);
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.geometry.setAttribute('aVisible', this.attrVisible);
    this.points.visible = false; // until the first snapshot arrives
  }

  /** Recolour every point: by category, by orbit class, or by altitude. */
  setColorMode(mode: ColorMode): void {
    this.colorMode = mode;
    if (!this.catalog) return;
    const color = new THREE.Color();
    const array = this.attrColor.array as Float32Array;
    for (const sat of this.catalog.sats) {
      color.set(colorFor(sat, mode)); // sRGB hex → linear working space
      array[sat.index * 3] = color.r;
      array[sat.index * 3 + 1] = color.g;
      array[sat.index * 3 + 2] = color.b;
    }
    this.attrColor.needsUpdate = true;
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
