/**
 * A close approach drawn in space: the two flight paths through the closest point, the
 * miss-distance line between them, and the two objects moving along their paths.
 *
 * Everything is positioned with SGP4 directly (not the interpolated catalogue snapshots)
 * and expressed relative to the closest point, so the picture stays exact when the camera
 * is only a few kilometres away and when time is replayed in slow motion.
 */

import * as THREE from 'three';
import type { SatRec } from 'satellite.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { stateAt, type Approach, type Vec3 } from '../data/ephemeris.ts';
import { KM, type SceneKit } from './scene.ts';

const PATH_SAMPLES = 160;
export const COLOR_A = new THREE.Color(0.35, 0.86, 1.0); // cyan
export const COLOR_B = new THREE.Color(1.0, 0.68, 0.3); // amber

export interface EncounterFrame {
  a: THREE.Vector3; // scene units
  b: THREE.Vector3;
  mid: THREE.Vector3;
  /** Travel directions (scene axes), for pointing the 3D models. */
  va: THREE.Vector3;
  vb: THREE.Vector3;
  rangeKm: number;
  /** Mid-point position, km inertial (for altitude / lat / lon readouts). */
  midEci: Vec3;
}

export class EncounterViz {
  private readonly group = new THREE.Group(); // origin = mid-point at closest approach (km, inertial)
  private readonly pathA: Line2;
  private readonly pathB: Line2;
  private readonly missLine: THREE.Line;
  private readonly liveLine: THREE.Line;
  private readonly dots: THREE.Points;
  private readonly dotMaterial: THREE.ShaderMaterial;
  private readonly kit: SceneKit;
  private recA: SatRec | null = null;
  private recB: SatRec | null = null;
  private readonly origin = new THREE.Vector3();

  constructor(kit: SceneKit) {
    this.kit = kit;
    const path = () => new Line2(new LineGeometry(), new LineMaterial({ linewidth: 2, vertexColors: true, transparent: true, depthWrite: false }));
    this.pathA = path();
    this.pathB = path();

    const segment = (material: THREE.Material) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3).setUsage(THREE.DynamicDrawUsage));
      return new THREE.Line(geometry, material);
    };
    this.missLine = segment(new THREE.LineDashedMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, dashSize: 0.2, gapSize: 0.14, depthWrite: false }));
    this.liveLine = segment(new THREE.LineBasicMaterial({ color: new THREE.Color(2.0, 0.3, 0.36), transparent: true, depthWrite: false }));

    // Four markers: the two objects now (rings) and where each is at the closest point (small dots).
    const dotGeometry = new THREE.BufferGeometry();
    dotGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3).setUsage(THREE.DynamicDrawUsage));
    dotGeometry.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array([
      COLOR_A.r, COLOR_A.g, COLOR_A.b, COLOR_B.r, COLOR_B.g, COLOR_B.b,
      COLOR_A.r, COLOR_A.g, COLOR_A.b, COLOR_B.r, COLOR_B.g, COLOR_B.b,
    ]), 3));
    dotGeometry.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array([1, 1, 0, 0]), 1));
    this.dotMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: kit.pixelRatio }, uCore: { value: 1 }, uRing: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aKind;
        uniform float uPixelRatio;
        varying vec3 vColor;
        varying float vKind;
        void main() {
          vColor = aColor;
          vKind = aKind;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = mix(9.0, 46.0, aKind) * uPixelRatio;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uCore;
        uniform float uRing;
        varying vec3 vColor;
        varying float vKind;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          if (r > 1.0) discard;
          float core = (1.0 - smoothstep(0.06, 0.14, r)) * uCore;
          float pulse = 0.55 + 0.45 * sin(uTime * 4.0);
          float ring = (1.0 - smoothstep(0.0, 0.07, abs(r - 0.86))) * pulse * uRing;
          float small = 1.0 - smoothstep(0.5, 0.95, r);
          float a = mix(small * 0.9, max(core, ring), vKind);
          gl_FragColor = vec4(clamp(vColor * 1.5, 0.0, 3.0), clamp(a, 0.0, 1.0));
        }`,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.dots = new THREE.Points(dotGeometry, this.dotMaterial);

    for (const object of [this.pathA, this.pathB, this.missLine, this.liveLine, this.dots]) {
      object.frustumCulled = false;
      object.renderOrder = 4;
      this.group.add(object);
    }
    this.group.visible = false;
    kit.eciGroup.add(this.group);
  }

  get active(): boolean {
    return this.group.visible;
  }

  /** Build the picture for one pair. `windowS` = how many seconds either side of the closest point to draw. */
  show(recA: SatRec, recB: SatRec, approach: Approach, windowS: number): void {
    this.recA = recA;
    this.recB = recB;
    const a = stateAt(recA, approach.tcaMs), b = stateAt(recB, approach.tcaMs);
    if (!a || !b) return this.hide();
    this.origin.set((a.position.x + b.position.x) / 2, (a.position.y + b.position.y) / 2, (a.position.z + b.position.z) / 2);
    this.group.position.copy(this.origin);

    const build = (line: Line2, rec: SatRec, color: THREE.Color) => {
      const positions: number[] = [], colors: number[] = [];
      for (let i = 0; i <= PATH_SAMPLES; i++) {
        const u = (i / PATH_SAMPLES) * 2 - 1; // −1 … 1
        const state = stateAt(rec, approach.tcaMs + u * windowS * 1000);
        if (!state) continue;
        positions.push(state.position.x - this.origin.x, state.position.y - this.origin.y, state.position.z - this.origin.z);
        const level = 0.18 + 1.1 * Math.pow(1 - Math.abs(u), 1.6); // brightest at the closest point
        colors.push(color.r * level, color.g * level, color.b * level);
      }
      line.geometry.dispose();
      line.geometry = new LineGeometry();
      line.geometry.setPositions(positions);
      line.geometry.setColors(colors);
    };
    build(this.pathA, recA, COLOR_A);
    build(this.pathB, recB, COLOR_B);

    const o = this.origin;
    const tcaA = [a.position.x - o.x, a.position.y - o.y, a.position.z - o.z];
    const tcaB = [b.position.x - o.x, b.position.y - o.y, b.position.z - o.z];
    (this.missLine.geometry.attributes.position.array as Float32Array).set([...tcaA, ...tcaB]);
    this.missLine.geometry.attributes.position.needsUpdate = true;
    // Dashes sized to the gap so there are always about a dozen of them.
    const dash = this.missLine.material as THREE.LineDashedMaterial;
    dash.dashSize = Math.max(approach.missKm, 0.02) / 22;
    dash.gapSize = dash.dashSize * 0.8;
    this.missLine.computeLineDistances();
    const dots = this.dots.geometry.attributes.position.array as Float32Array;
    dots.set(tcaA, 6);
    dots.set(tcaB, 9);
    this.group.visible = true;
  }

  /** With 3D models drawn at the two objects, drop the solid centre dots and keep only the rings. */
  setModelsShown(on: boolean, ring = 1): void {
    this.dotMaterial.uniforms.uCore.value = on ? 0 : 1;
    this.dotMaterial.uniforms.uRing.value = on ? ring : 1; // rings fade once the models are big enough to see
  }

  hide(): void {
    this.group.visible = false;
    this.recA = this.recB = null;
  }

  /** Move the two objects to where they are at `simTime`. Returns their positions for the camera and labels. */
  update(simTime: number, realSeconds: number): EncounterFrame | null {
    if (!this.group.visible || !this.recA || !this.recB) return null;
    const a = stateAt(this.recA, simTime), b = stateAt(this.recB, simTime);
    if (!a || !b) return null;
    this.dotMaterial.uniforms.uTime.value = realSeconds;
    this.dotMaterial.uniforms.uPixelRatio.value = this.kit.pixelRatio;
    const o = this.origin;
    const pa = [a.position.x - o.x, a.position.y - o.y, a.position.z - o.z];
    const pb = [b.position.x - o.x, b.position.y - o.y, b.position.z - o.z];
    const dots = this.dots.geometry.attributes.position.array as Float32Array;
    dots.set(pa, 0);
    dots.set(pb, 3);
    this.dots.geometry.attributes.position.needsUpdate = true;
    (this.liveLine.geometry.attributes.position.array as Float32Array).set([...pa, ...pb]);
    this.liveLine.geometry.attributes.position.needsUpdate = true;

    const toScene = (p: Vec3) => new THREE.Vector3(p.x, p.z, -p.y).multiplyScalar(KM);
    const midEci = { x: (a.position.x + b.position.x) / 2, y: (a.position.y + b.position.y) / 2, z: (a.position.z + b.position.z) / 2 };
    return {
      a: toScene(a.position),
      b: toScene(b.position),
      mid: toScene(midEci),
      va: new THREE.Vector3(a.velocity.x, a.velocity.z, -a.velocity.y),
      vb: new THREE.Vector3(b.velocity.x, b.velocity.z, -b.velocity.y),
      midEci,
      rangeKm: Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y, a.position.z - b.position.z),
    };
  }
}
