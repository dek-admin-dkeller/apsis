/**
 * Map layers drawn on the globe: a latitude/longitude graticule, coastlines + country
 * borders, and the day/night terminator. All three are off by default and are only
 * built the first time they are switched on.
 *
 * The graticule and borders are children of the rotating Earth node, so they turn with
 * the planet. The terminator lives in the inertial scene and is re-aimed at the sun.
 *
 * Longitude/latitude → Earth-local position (matches the texture mapping of a three.js
 * SphereGeometry, whose u = 0.5 / longitude 0° meridian is on +X and 90° E is on −Z):
 *
 *   x = cos(lat) · cos(lon)      y = sin(lat)      z = −cos(lat) · sin(lon)
 */

import * as THREE from 'three';
import { EARTH_RADIUS } from './scene.ts';

const DEG = Math.PI / 180;
const BORDERS_URL = './data/borders.bin'; // written by scripts/build-borders.mjs
const MAX_STEP_DEG = 1.5; // longer segments are subdivided so they follow the curve of the globe

const vertexShader = /* glsl */ `
  attribute float aLevel;   // per-vertex brightness (major lines brighter than minor ones)
  uniform float uLift;      // radius multiplier: how far above the surface the lines float
  varying float vLevel;
  varying vec3 vWorld;
  void main() {
    vLevel = aLevel;
    vec4 world = modelMatrix * vec4(position * uLift, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

// Besides the depth test, lines are faded out as they approach the limb and dropped on
// the far side. That keeps them clean when the depth buffer is too coarse to separate a
// line from the surface a few km below it (camera far away).
const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uRadius;
  varying float vLevel;
  varying vec3 vWorld;
  void main() {
    float camDist = max(length(cameraPosition), 1e-3);
    vec3 toCam = cameraPosition / camDist;
    vec3 up = vWorld / max(length(vWorld), 1e-3);
    float limb = min(uRadius / camDist, 0.999);            // cos(angle from the sub-camera point to the horizon)
    float facing = smoothstep(0.0, 0.05, dot(up, toCam) - limb);
    float alpha = uOpacity * vLevel * facing;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(uColor, alpha);
  }`;

interface Layer {
  object: THREE.Object3D;
  material: THREE.ShaderMaterial;
  baseOpacity: number;
  /** Camera distances (scene units) between which the layer fades out. */
  fade: [number, number];
}

function makeMaterial(color: [number, number, number]): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Vector3(...color) },
      uOpacity: { value: 0 },
      uRadius: { value: EARTH_RADIUS },
      uLift: { value: 1.0015 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });
}

/** Unit vector for a longitude/latitude in degrees, in Earth-local axes. */
function unitFromLonLat(lon: number, lat: number, out: number[]): void {
  const c = Math.cos(lat * DEG);
  out.push(c * Math.cos(lon * DEG) * EARTH_RADIUS, Math.sin(lat * DEG) * EARTH_RADIUS, -c * Math.sin(lon * DEG) * EARTH_RADIUS);
}

function lineSegments(positions: number[], levels: number[], material: THREE.ShaderMaterial, index?: number[]): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aLevel', new THREE.Float32BufferAttribute(levels, 1));
  if (index) geometry.setIndex(index);
  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false; // the Earth is practically always in view; skip the per-frame test
  lines.renderOrder = 1;
  return lines;
}

export class GeoOverlay {
  private readonly parent: THREE.Object3D;
  private readonly sceneRoot: THREE.Object3D;
  private graticule: Layer | null = null;
  private borders: Layer | null = null;
  private terminator: Layer | null = null;
  private bordersWanted = false;
  private bordersRequested = false;
  private disposed = false;
  private readonly up = new THREE.Vector3(0, 1, 0);

  /**
   * @param parent    the rotating Earth node (graticule and borders turn with it)
   * @param sceneRoot the inertial scene (the terminator is aimed at the sun in it)
   */
  constructor(parent: THREE.Object3D, sceneRoot: THREE.Object3D) {
    this.parent = parent;
    this.sceneRoot = sceneRoot;
  }

  /** Latitude/longitude lines every 15°. */
  setGraticule(on: boolean): void {
    if (on && !this.graticule && !this.disposed) {
      this.graticule = this.buildGraticule();
      this.parent.add(this.graticule.object);
    }
    if (this.graticule) this.graticule.object.visible = on;
  }

  /** Coastlines and country borders (loaded from a local file the first time). */
  setBorders(on: boolean): void {
    this.bordersWanted = on;
    if (this.borders) this.borders.object.visible = on;
    if (on && !this.bordersRequested && !this.disposed) {
      this.bordersRequested = true;
      void this.loadBorders();
    }
  }

  /** The great circle separating day from night. */
  setTerminator(on: boolean): void {
    if (on && !this.terminator && !this.disposed) {
      this.terminator = this.buildTerminator();
      this.sceneRoot.add(this.terminator.object);
    }
    if (this.terminator) this.terminator.object.visible = on;
  }

  /** Call once per frame: aims the terminator and fades the layers with camera distance. */
  update(sunDirection: THREE.Vector3, cameraDistance: number): void {
    // Lift the lines a little more when the camera is far away, where the depth buffer is coarse.
    const lift = 1.0015 + THREE.MathUtils.clamp((cameraDistance - 20) * 0.00004, 0, 0.012);
    for (const layer of [this.graticule, this.borders, this.terminator]) {
      if (!layer || !layer.object.visible) continue;
      const fade = 1 - THREE.MathUtils.smoothstep(cameraDistance, layer.fade[0], layer.fade[1]);
      layer.material.uniforms.uOpacity.value = layer.baseOpacity * fade;
      layer.material.uniforms.uLift.value = lift;
    }
    if (this.terminator?.object.visible && sunDirection.lengthSq() > 1e-8) {
      // The circle is built in the XZ plane (normal +Y); turn that normal to face the sun.
      this.terminator.object.quaternion.setFromUnitVectors(this.up, this.scratch.copy(sunDirection).normalize());
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const layer of [this.graticule, this.borders, this.terminator]) {
      if (!layer) continue;
      layer.object.removeFromParent();
      (layer.object as THREE.LineSegments).geometry.dispose();
      layer.material.dispose();
    }
    this.graticule = this.borders = this.terminator = null;
  }

  private readonly scratch = new THREE.Vector3();

  // ---------------------------------------------------------------- graticule

  private buildGraticule(): Layer {
    const positions: number[] = [];
    const levels: number[] = [];
    const STEP = 2; // degrees between vertices along a line

    /** Add one line as separate segments; `dash` keeps only every other segment. */
    const addLine = (point: (t: number) => [number, number], from: number, to: number, level: number, dash = false) => {
      let n = 0;
      for (let t = from; t < to - 1e-9; t += STEP, n++) {
        if (dash && n % 2 === 1) continue;
        const a = point(t);
        const b = point(Math.min(t + STEP, to));
        unitFromLonLat(a[0], a[1], positions);
        unitFromLonLat(b[0], b[1], positions);
        levels.push(level, level);
      }
    };

    // Parallels every 15°. The equator is the brightest line.
    for (let lat = -75; lat <= 75; lat += 15) {
      addLine((lon) => [lon, lat], -180, 180, lat === 0 ? 1.0 : 0.5);
    }
    // Tropics and polar circles: where the sun can be overhead / the midnight sun begins.
    for (const lat of [23.4364, -23.4364, 66.5636, -66.5636]) {
      addLine((lon) => [lon, lat], -180, 180, 0.42, true);
    }
    // Meridians every 15°. Only the four principal ones run all the way to the poles,
    // otherwise 24 lines would pile up into a bright knot there.
    for (let lon = -180; lon < 180; lon += 15) {
      const principal = lon % 90 === 0;
      const top = principal ? 90 : 75;
      const level = lon === 0 ? 1.0 : lon === -180 ? 0.7 : 0.5;
      addLine((lat) => [lon, lat], -top, top, level);
    }

    const material = makeMaterial([0.40, 0.60, 0.72]);
    return { object: lineSegments(positions, levels, material), material, baseOpacity: 0.34, fade: [70, 220] };
  }

  // ---------------------------------------------------------------- borders

  private async loadBorders(): Promise<void> {
    let buffer: ArrayBuffer;
    try {
      const response = await fetch(BORDERS_URL);
      if (!response.ok) throw new Error(String(response.status));
      buffer = await response.arrayBuffer();
    } catch {
      this.bordersRequested = false; // allow another try the next time the layer is switched on
      console.warn('OrbitHash: borders layer unavailable (public/data/borders.bin missing — run `npm run build-borders`).');
      return;
    }
    if (this.disposed) return;
    const layer = this.buildBorders(buffer);
    if (!layer) return;
    this.borders = layer;
    layer.object.visible = this.bordersWanted;
    this.parent.add(layer.object);
  }

  /** Decode borders.bin (format documented in scripts/build-borders.mjs) into line segments. */
  private buildBorders(buffer: ArrayBuffer): Layer | null {
    const view = new DataView(buffer);
    if (buffer.byteLength < 8 || view.getUint32(0, true) !== 0x3142484f /* "OHB1" */) return null;
    const arcCount = view.getUint32(4, true);
    let coordOffset = 8 + arcCount * 2;

    const positions: number[] = [];
    const levels: number[] = [];
    const index: number[] = [];
    let vertex = 0;
    const push = (lon: number, lat: number, level: number): number => {
      unitFromLonLat(lon, lat, positions);
      levels.push(level);
      return vertex++;
    };

    for (let a = 0; a < arcCount; a++) {
      const packed = view.getUint16(8 + a * 2, true);
      const count = packed & 0x7fff;
      const level = packed & 0x8000 ? 0.55 : 1.0; // land borders dimmer than coastlines
      if (coordOffset + count * 4 > buffer.byteLength) return null; // truncated file
      let prevLon = 0;
      let prevLat = 0;
      let prevIndex = -1;
      for (let p = 0; p < count; p++, coordOffset += 4) {
        const lon = (view.getInt16(coordOffset, true) / 32767) * 180;
        const lat = (view.getInt16(coordOffset + 2, true) / 32767) * 90;
        if (p > 0) {
          // Skip the artificial edges of the source map: the cut along the ±180° meridian
          // and Antarctica's bottom edge along the south pole.
          const onCut = Math.abs(prevLon) > 179.98 && Math.abs(lon) > 179.98;
          const onPole = prevLat < -89.5 && lat < -89.5;
          if (onCut || onPole) {
            prevIndex = -1;
          } else {
            let dLon = lon - prevLon;
            if (dLon > 180) dLon -= 360;
            else if (dLon < -180) dLon += 360;
            const dLat = lat - prevLat;
            const pieces = Math.max(1, Math.ceil(Math.max(Math.abs(dLon), Math.abs(dLat)) / MAX_STEP_DEG));
            let from = prevIndex >= 0 ? prevIndex : push(prevLon, prevLat, level);
            for (let s = 1; s <= pieces; s++) {
              const to = push(prevLon + (dLon * s) / pieces, prevLat + (dLat * s) / pieces, level);
              index.push(from, to);
              from = to;
            }
            prevIndex = from;
          }
        }
        prevLon = lon;
        prevLat = lat;
      }
    }

    const material = makeMaterial([0.62, 0.78, 0.86]);
    return { object: lineSegments(positions, levels, material, index), material, baseOpacity: 0.5, fade: [90, 260] };
  }

  // ---------------------------------------------------------------- terminator

  private buildTerminator(): Layer {
    const positions: number[] = [];
    const levels: number[] = [];
    const N = 360;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const b = ((i + 1) / N) * Math.PI * 2;
      positions.push(Math.cos(a) * EARTH_RADIUS, 0, Math.sin(a) * EARTH_RADIUS, Math.cos(b) * EARTH_RADIUS, 0, Math.sin(b) * EARTH_RADIUS);
      levels.push(1, 1);
    }
    const material = makeMaterial([1.0, 0.74, 0.42]);
    return { object: lineSegments(positions, levels, material), material, baseOpacity: 0.5, fade: [150, 420] };
  }
}
