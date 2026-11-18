/** Close pairs found by the screening: red pulsing markers joined by red lines. */

import * as THREE from 'three';
import type { SimClient } from '../worker/SimClient.ts';
import type { SceneKit } from './scene.ts';

const MAX_PAIRS = 2000;

export class ConjunctionMarkers {
  private readonly points: THREE.Points;
  private readonly lines: THREE.LineSegments;
  private readonly linePositions = new Float32Array(MAX_PAIRS * 6); // two endpoints per pair
  private readonly pointPositions = new Float32Array(MAX_PAIRS * 6); // one marker per involved object
  private readonly marked = new Set<number>(); // objects that already have a marker this frame
  private readonly material: THREE.ShaderMaterial;
  private readonly sim: SimClient;
  private readonly kit: SceneKit;
  private pairA: Uint32Array = new Uint32Array(0);
  private pairB: Uint32Array = new Uint32Array(0);
  private d = 10;

  constructor(kit: SceneKit, sim: SimClient) {
    this.sim = sim;
    this.kit = kit;
    const dynamicGeometry = (array: Float32Array) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(array, 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setDrawRange(0, 0);
      return geometry;
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: kit.pixelRatio } },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uPixelRatio;
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = (15.0 + 5.0 * sin(uTime * 5.0)) * uPixelRatio;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          if (r > 1.0) discard;
          float ring = 1.0 - smoothstep(0.0, 0.16, abs(r - 0.72));   // pulsing ring
          float dot = 1.0 - smoothstep(0.05, 0.30, r);               // solid centre
          float a = max(ring * (0.65 + 0.35 * sin(uTime * 5.0)), dot);
          gl_FragColor = vec4(vec3(1.7, 0.2, 0.26), a);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(dynamicGeometry(this.pointPositions), this.material);
    this.lines = new THREE.LineSegments(
      dynamicGeometry(this.linePositions),
      new THREE.LineBasicMaterial({ color: new THREE.Color(2.2, 0.25, 0.3), transparent: true, depthWrite: false }),
    );
    for (const object of [this.points, this.lines]) {
      object.frustumCulled = false;
      object.renderOrder = 3;
      object.visible = false;
      kit.eciGroup.add(object);
    }
  }

  setPairs(pairA: Uint32Array, pairB: Uint32Array, d: number): void {
    this.pairA = pairA;
    this.pairB = pairB;
    this.d = d;
  }

  setVisible(on: boolean): void {
    this.points.visible = on;
    this.lines.visible = on;
  }

  /**
   * Every frame: move the markers with their satellites. The screening is a snapshot,
   * so a pair that has since flown apart (> 3·d) is dropped until the next screening tick.
   */
  update(realSeconds: number): void {
    if (!this.points.visible) return;
    this.material.uniforms.uTime.value = realSeconds;
    this.material.uniforms.uPixelRatio.value = this.kit.pixelRatio;
    const a = { x: 0, y: 0, z: 0 }, b = { x: 0, y: 0, z: 0 };
    const limit2 = (3 * this.d) ** 2;
    let lineVerts = 0;
    let pointVerts = 0;
    this.marked.clear();
    // One marker per OBJECT (a station with 10 docked modules is in 45 pairs but gets 10 markers).
    const mark = (id: number, p: { x: number; y: number; z: number }) => {
      if (this.marked.has(id)) return;
      this.marked.add(id);
      this.pointPositions.set([p.x, p.y, p.z], pointVerts * 3);
      pointVerts++;
    };
    const count = Math.min(this.pairA.length, MAX_PAIRS);
    for (let k = 0; k < count; k++) {
      if (!this.sim.getPosition(this.pairA[k], a) || !this.sim.getPosition(this.pairB[k], b)) continue;
      if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2 > limit2) continue;
      this.linePositions.set([a.x, a.y, a.z, b.x, b.y, b.z], lineVerts * 3);
      lineVerts += 2;
      mark(this.pairA[k], a);
      mark(this.pairB[k], b);
    }
    this.lines.geometry.setDrawRange(0, lineVerts);
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.setDrawRange(0, pointVerts);
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
