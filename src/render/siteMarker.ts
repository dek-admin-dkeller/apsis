/**
 * The ground station (or "you are here") marker: a pulsing ring on the surface with a
 * faint beam rising from it. It is a child of the rotating Earth, so it turns with the
 * planet and hides behind it like any other surface feature.
 */

import * as THREE from 'three';
import { EARTH_RADIUS, type SceneKit } from './scene.ts';

const BEAM_HEIGHT = 0.32; // scene units (320 km): about the height of the lowest satellites

export class SiteMarker {
  private readonly group = new THREE.Group();
  private readonly material: THREE.ShaderMaterial;
  private readonly kit: SceneKit;
  private readonly local = new THREE.Vector3(1, 0, 0); // unit direction in the Earth's own frame

  constructor(earth: THREE.Object3D, kit: SceneKit) {
    this.kit = kit;
    const ring = new THREE.BufferGeometry();
    ring.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: kit.pixelRatio } },
      vertexShader: /* glsl */ `
        uniform float uPixelRatio;
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = 34.0 * uPixelRatio;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          if (r > 1.0) discard;
          float core = 1.0 - smoothstep(0.10, 0.2, r);
          float wave = fract(uTime * 0.55);                       // a ring that grows and fades
          float ring = (1.0 - smoothstep(0.0, 0.09, abs(r - (0.22 + 0.7 * wave)))) * (1.0 - wave);
          float a = clamp(max(core, ring * 0.9), 0.0, 1.0);
          gl_FragColor = vec4(vec3(0.5, 1.5, 1.05), a);
        }`,
      transparent: true,
      depthWrite: false,
    });
    const point = new THREE.Points(ring, this.material);

    const beam = new THREE.BufferGeometry();
    beam.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, BEAM_HEIGHT, 0]), 3));
    beam.setAttribute('color', new THREE.BufferAttribute(new Float32Array([0.35, 1.0, 0.7, 0.0, 0.0, 0.0]), 3));
    const line = new THREE.Line(beam, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));

    for (const object of [point, line]) {
      object.frustumCulled = false;
      object.renderOrder = 2;
      this.group.add(object);
    }
    earth.add(this.group);
    this.set(0, 0);
  }

  /** Move the marker to a latitude / longitude (degrees, east positive). */
  set(latDeg: number, lonDeg: number): void {
    const lat = THREE.MathUtils.degToRad(latDeg), lon = THREE.MathUtils.degToRad(lonDeg);
    // Same convention as the globe texture: longitude 0° on +X, east towards −Z, north = +Y.
    this.local.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
    this.group.position.copy(this.local).multiplyScalar(EARTH_RADIUS * 1.0025);
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.local); // beam points straight up
  }

  setVisible(on: boolean): void {
    this.group.visible = on;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  /** Where the marker is right now in scene coordinates (the Earth has turned since `set`). */
  worldPosition(out: THREE.Vector3): THREE.Vector3 {
    return this.group.getWorldPosition(out);
  }

  update(realSeconds: number): void {
    this.material.uniforms.uTime.value = realSeconds;
    this.material.uniforms.uPixelRatio.value = this.kit.pixelRatio;
  }
}
