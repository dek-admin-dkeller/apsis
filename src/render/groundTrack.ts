/**
 * What the selected object "sees" of the Earth, drawn on the globe:
 *   ground track   the path its sub-point traces over the surface (past dim, future bright)
 *   footprint      the circle inside which the object is above the horizon right now
 *   nadir line     a hairline from the object straight down to the surface
 *
 * The track is a curve fixed to the rotating Earth, but it lives in the inertial frame
 * like everything else: it is built for one instant and then simply turned about the
 * polar axis by however far the Earth has rotated since.
 */

import * as THREE from 'three';
import { eciToEcf, gstime, type SatRec } from 'satellite.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { stateAt, type Vec3 } from '../data/ephemeris.ts';
import { EARTH_RADIUS_KM } from './scene.ts';

const SURFACE = EARTH_RADIUS_KM + 16; // km: just above terrain, clouds and map lines
const TRACK_SAMPLES = 300;
const RING_SEGMENTS = 96;

export class GroundTrack {
  trackOn = true;
  footprintOn = true;
  private readonly track: Line2;
  private readonly ring: THREE.LineLoop;
  private readonly nadir: THREE.Line;
  private readonly ringPositions = new Float32Array(RING_SEGMENTS * 3);
  private readonly nadirPositions = new Float32Array(6);
  private satrec: SatRec | null = null;
  private periodMin = 0;
  private builtAt = -Infinity; // real seconds
  private builtGmst = 0;

  constructor(parent: THREE.Object3D) {
    this.track = new Line2(new LineGeometry(), new LineMaterial({ linewidth: 1.6, vertexColors: true, transparent: true, depthWrite: false }));
    const ringGeometry = new THREE.BufferGeometry();
    ringGeometry.setAttribute('position', new THREE.BufferAttribute(this.ringPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.ring = new THREE.LineLoop(ringGeometry, new THREE.LineBasicMaterial({ color: new THREE.Color(0.35, 0.85, 1.0), transparent: true, opacity: 0.55, depthWrite: false }));
    const nadirGeometry = new THREE.BufferGeometry();
    nadirGeometry.setAttribute('position', new THREE.BufferAttribute(this.nadirPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.nadir = new THREE.Line(nadirGeometry, new THREE.LineBasicMaterial({ color: new THREE.Color(0.35, 0.85, 1.0), transparent: true, opacity: 0.3, depthWrite: false }));
    for (const object of [this.track, this.ring, this.nadir]) {
      object.frustumCulled = false;
      object.visible = false;
      object.renderOrder = 1;
      parent.add(object);
    }
  }

  setSatellite(satrec: SatRec | null, periodMin: number): void {
    this.satrec = satrec;
    this.periodMin = periodMin;
    this.builtAt = -Infinity;
    this.track.visible = this.ring.visible = this.nadir.visible = false;
  }

  /** @param position the object's current position (km, inertial), or null if unknown */
  update(simTime: number, realSeconds: number, position: Vec3 | null): void {
    const gmst = gstime(new Date(simTime));

    // ---- ground track: rebuilt every 2 s, rotated with the Earth in between
    if (!this.trackOn || !this.satrec) {
      this.track.visible = false;
      this.builtAt = -Infinity;
    } else {
      if (realSeconds - this.builtAt > 2) this.buildTrack(simTime, gmst, realSeconds);
      this.track.rotation.z = gmst - this.builtGmst;
    }

    // ---- footprint + nadir line: follow the object every frame
    const show = this.footprintOn && !!position && !!this.satrec;
    this.ring.visible = this.nadir.visible = show;
    if (!show || !position) return;
    const r = Math.hypot(position.x, position.y, position.z);
    if (r <= SURFACE) return;
    const up = new THREE.Vector3(position.x, position.y, position.z).divideScalar(r);
    // Any two directions at right angles to "up" span the plane of the circle.
    const east = new THREE.Vector3(0, 0, 1).cross(up);
    if (east.lengthSq() < 1e-8) east.set(1, 0, 0);
    east.normalize();
    const north = new THREE.Vector3().crossVectors(up, east);
    const reach = Math.acos(EARTH_RADIUS_KM / r); // angle from the sub-point to the horizon
    const along = Math.cos(reach) * SURFACE, across = Math.sin(reach) * SURFACE;
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const a = (i / RING_SEGMENTS) * Math.PI * 2;
      const c = Math.cos(a) * across, s = Math.sin(a) * across;
      this.ringPositions[3 * i] = up.x * along + east.x * c + north.x * s;
      this.ringPositions[3 * i + 1] = up.y * along + east.y * c + north.y * s;
      this.ringPositions[3 * i + 2] = up.z * along + east.z * c + north.z * s;
    }
    this.ring.geometry.attributes.position.needsUpdate = true;
    this.nadirPositions.set([position.x, position.y, position.z, up.x * SURFACE, up.y * SURFACE, up.z * SURFACE]);
    this.nadir.geometry.attributes.position.needsUpdate = true;
  }

  /** One orbit behind the object, two ahead. */
  private buildTrack(simTime: number, gmstNow: number, realSeconds: number): void {
    if (!this.satrec) return;
    this.builtAt = realSeconds;
    this.builtGmst = gmstNow;
    const periodMs = this.periodMin * 60000;
    const from = simTime - periodMs, span = periodMs * 3;
    const positions: number[] = [];
    const colors: number[] = [];
    const cos = Math.cos(gmstNow), sin = Math.sin(gmstNow);
    for (let i = 0; i <= TRACK_SAMPLES; i++) {
      const t = from + (span * i) / TRACK_SAMPLES;
      const state = stateAt(this.satrec, t);
      if (!state) continue;
      // Sub-point on the rotating Earth at time t …
      const ecf = eciToEcf(state.position, gstime(new Date(t)));
      const scale = SURFACE / Math.hypot(ecf.x, ecf.y, ecf.z);
      // … expressed in the inertial frame as the Earth is turned right now.
      positions.push((ecf.x * cos - ecf.y * sin) * scale, (ecf.x * sin + ecf.y * cos) * scale, ecf.z * scale);
      const u = (t - simTime) / periodMs; // −1 … 2 orbits from now
      const level = u < 0 ? 0.16 + 0.14 * (1 + u) : 1.25 * Math.pow(1 - u / 2, 1.3) + 0.14;
      colors.push(1.0 * level, 0.68 * level, 0.3 * level);
    }
    if (positions.length < 6) {
      this.track.visible = false;
      return;
    }
    this.track.geometry.dispose();
    this.track.geometry = new LineGeometry();
    this.track.geometry.setPositions(positions);
    this.track.geometry.setColors(colors);
    this.track.visible = true;
  }
}
