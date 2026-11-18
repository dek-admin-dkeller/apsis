/**
 * Launch pads on the globe: one small amber mark per pad, and a larger pulsing one for the
 * pad of the launch the visitor is pointing at.
 *
 * All pads are ONE THREE.Points object (one draw call) whose vertices sit just above the
 * surface. It is a child of the rotating Earth, so the marks turn with the planet, and it
 * depth-tests against the globe, so pads on the far side are hidden like any other surface
 * feature. A point sprite has a single depth for its whole square, which means a mark near
 * the edge of the disc is either fully drawn or not at all — never cut in half.
 *
 * Like the ground-station marker (siteMarker.ts) the marks have a fixed size on screen, so
 * they stay readable at any zoom and never swell when the camera comes close. The one
 * exception is far away: once the whole Earth is only a few marks wide they shrink and fade
 * out, because a ring the size of the planet tells nobody where the pad is.
 */

import * as THREE from 'three';
import { EARTH_RADIUS } from './scene.ts';

const LIFT = 1.0025; // the same 16 km above the surface as the ground-station marker: clear of the map lines

const vertexShader = /* glsl */ `
  attribute float aOn;          // 1 for the emphasised pad, 0 for the rest
  uniform float uPixelRatio;
  varying float vOn;
  varying float vNear;          // 1 at ordinary viewing distances, 0 once the Earth is a small disc
  void main() {
    vOn = aOn;
    // The Earth's centre is this object's origin; its distance from the camera in scene units
    // (thousands of km). A whole-Earth view is about 20; the marks are gone by 110.
    float away = length((modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz);
    vNear = 1.0 - smoothstep(30.0, 110.0, away);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = mix(15.0, 40.0, aOn) * uPixelRatio * (0.4 + 0.6 * vNear);
  }`;

// NaN-safe by construction: no division, no pow, every smoothstep has its edges in order,
// and the alpha is clamped (see "Shaders" in CLAUDE.md for why that matters here).
const fragmentShader = /* glsl */ `
  uniform float uTime;
  varying float vOn;
  varying float vNear;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;        // 0 at the centre, 1 at the sprite's edge
    if (r > 1.0) discard;
    // An ordinary pad: a dot with a thin ring round it.
    float dotSmall = 1.0 - smoothstep(0.26, 0.44, r);
    float ringSmall = (1.0 - smoothstep(0.0, 0.17, abs(r - 0.76))) * 0.7;
    // The emphasised pad (a bigger sprite): the same dot, and a ring that grows and fades.
    float dotBig = 1.0 - smoothstep(0.13, 0.2, r);
    float wave = fract(uTime * 0.6);
    float ringBig = (1.0 - smoothstep(0.0, 0.07, abs(r - (0.26 + 0.68 * wave)))) * (1.0 - wave);
    float alpha = mix(max(dotSmall, ringSmall), max(dotBig, ringBig), vOn);
    vec3 colour = mix(vec3(1.0, 0.71, 0.33), vec3(1.5, 0.98, 0.4), vOn);   // amber; brighter than 1 so bloom gives it a glow
    gl_FragColor = vec4(colour, clamp(alpha * vNear, 0.0, 1.0));
  }`;

export class PadMarkers {
  private readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  private emphasised = -1;

  /** @param earth the rotating Earth (radius 6.371 scene units); the marks become its child */
  constructor(earth: THREE.Object3D) {
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true, // the Earth hides the far side
    });
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
    this.points.frustumCulled = false; // a handful of vertices: not worth a bounding sphere that must be kept current
    this.points.renderOrder = 2; // after the Earth and its map lines, like the other surface marks
    this.points.visible = false;
    // The size is given in CSS pixels; the renderer knows how many real pixels that is (it changes with the quality setting).
    this.points.onBeforeRender = (renderer) => {
      this.material.uniforms.uPixelRatio.value = renderer.getPixelRatio();
    };
    earth.add(this.points);
  }

  /** Replace the pads (latitude / longitude in degrees, east positive). Clears the emphasis. */
  set(pads: readonly { latDeg: number; lonDeg: number }[]): void {
    const positions = new Float32Array(pads.length * 3);
    pads.forEach((pad, i) => {
      const lat = THREE.MathUtils.degToRad(pad.latDeg), lon = THREE.MathUtils.degToRad(pad.lonDeg);
      // Same convention as the globe texture: longitude 0° on +X, east towards −Z, north = +Y.
      const radius = EARTH_RADIUS * LIFT;
      positions[i * 3] = radius * Math.cos(lat) * Math.cos(lon);
      positions[i * 3 + 1] = radius * Math.sin(lat);
      positions[i * 3 + 2] = -radius * Math.cos(lat) * Math.sin(lon);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aOn', new THREE.BufferAttribute(new Float32Array(pads.length), 1));
    this.points.geometry.dispose();
    this.points.geometry = geometry;
    this.emphasised = -1;
  }

  /** Emphasise one pad by its position in the list given to `set` (−1: none). */
  emphasise(index: number): void {
    if (index === this.emphasised) return;
    const on = this.points.geometry.getAttribute('aOn') as THREE.BufferAttribute | undefined;
    if (!on) return;
    if (this.emphasised >= 0 && this.emphasised < on.count) on.setX(this.emphasised, 0);
    this.emphasised = index >= 0 && index < on.count ? index : -1;
    if (this.emphasised >= 0) on.setX(this.emphasised, 1);
    on.needsUpdate = true;
  }

  setVisible(on: boolean): void {
    this.points.visible = on;
  }

  /** Call each frame while visible: advances the pulse. */
  update(realSeconds: number): void {
    this.material.uniforms.uTime.value = realSeconds;
  }
}
