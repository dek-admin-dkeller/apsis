/**
 * The Moon's shadow on the Earth during a solar eclipse, and the track of its centre.
 *
 * The globe's shader (render/globe.ts) darkens every point of the day side by how much of the
 * Sun's disc the Moon covers AS SEEN FROM THAT POINT: the overlap of two small discs, worked
 * out per pixel. That one formula draws the dark core (umbra, total), the ring of an annular
 * eclipse and the wide soft partial shadow exactly, with no shadow map. This module gives the
 * shader the Moon's position and the Sun's direction, precisely: the tracker's own sky Moon is
 * a low-precision series (~0.3°, which would put the shadow up to 2,000 km wrong), so the
 * solar system's ephemeris is used (space/ephem.ts: the Moon to ~0.01°), carried from J2000
 * to the equator of date (IAU 1976 precession) because the tracker's frame is of date.
 *
 * Work is done only near new Moon (the Moon within a few degrees of the Sun, seen from the
 * Earth); the rest of the month this costs one dot product a frame.
 *
 * The track: while the clock is within a central eclipse (space/skyEvents.ts), the line where
 * the shadow's axis meets the ground, every two minutes from the first moment it touches to
 * the last, drawn on the globe (a child of the turning Earth).
 */

import * as THREE from 'three';
import { bodyRelative } from '../space/ephem.ts';
import { eclipses, type SkyEvent } from '../space/skyEvents.ts';
import type { Vec } from '../space/types.ts';
import { EARTH_RADIUS } from './scene.ts';

const DEG = Math.PI / 180;
const EARTH_KM = 6371;
const TRACK_LIFT = 1.0025; // just above the ground, like the pad marks

/** J2000 → mean equator and equinox of date (IAU 1976): the transpose of ephem.ts's ofDateToJ2000. */
function toDate(v: Vec, tMs: number): Vec {
  const T = (tMs - Date.UTC(2000, 0, 1, 12)) / (36525 * 86400000);
  const AS = DEG / 3600;
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T) * AS;
  const zed = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T) * AS;
  const theta = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T) * AS;
  const cz = Math.cos(zeta), sz = Math.sin(zeta), cZ = Math.cos(zed), sZ = Math.sin(zed), ct = Math.cos(theta), st = Math.sin(theta);
  const [x, y, z] = v;
  return [
    (cz * ct * cZ - sz * sZ) * x + (-sz * ct * cZ - cz * sZ) * y - st * cZ * z,
    (cz * ct * sZ + sz * cZ) * x + (-sz * ct * sZ + cz * cZ) * y - st * sZ * z,
    cz * st * x - sz * st * y + ct * z,
  ];
}

/** Greenwich sidereal angle, radians (IAU 1982). */
function gmst(tMs: number): number {
  const d = (tMs - Date.UTC(2000, 0, 1, 12)) / 86400000;
  return ((((280.46061837 + 360.98564736629 * d) % 360) + 360) % 360) * DEG;
}

/** Moon and Sun relative to the Earth's centre, km, equator of date. */
function moonAndSun(tMs: number): { moon: Vec; sun: Vec } {
  return { moon: toDate(bodyRelative('moon', 'earth', tMs), tMs), sun: toDate(bodyRelative('sun', 'earth', tMs), tMs) };
}

/** Where the shadow's axis meets the Earth (a sphere), km of date; null if it misses. */
function axisOnGround(tMs: number): Vec | null {
  const { moon, sun } = moonAndSun(tMs);
  const d = [moon[0] - sun[0], moon[1] - sun[1], moon[2] - sun[2]];
  const n = Math.hypot(d[0], d[1], d[2]);
  const u = [d[0] / n, d[1] / n, d[2] / n]; // from the Sun through the Moon
  const b = moon[0] * u[0] + moon[1] * u[1] + moon[2] * u[2];
  const c = moon[0] * moon[0] + moon[1] * moon[1] + moon[2] * moon[2] - EARTH_KM * EARTH_KM;
  const disc = b * b - c;
  if (disc < 0) return null;
  const s = -b - Math.sqrt(disc); // the near side of the Earth
  return [moon[0] + s * u[0], moon[1] + s * u[1], moon[2] + s * u[2]];
}

export interface ShadowTarget {
  /** Hand the shader the Moon (world position, scene units) and the Sun's direction, or null when there is nothing to draw. */
  setEclipse(moonWorld: THREE.Vector3 | null, sunWorld: THREE.Vector3 | null): void;
}

export class EclipseShadow {
  private readonly globe: ShadowTarget;
  private readonly earth: THREE.Object3D;
  private readonly moonWorld = new THREE.Vector3();
  private readonly sunWorld = new THREE.Vector3();
  private track: THREE.Line | null = null;
  private trackFor = '';
  private events: SkyEvent[] = [];
  private eventsFrom = -Infinity;
  private on = false;

  constructor(globe: ShadowTarget, earth: THREE.Object3D) {
    this.globe = globe;
    this.earth = earth;
  }

  /**
   * Each frame, with the clock and the Sun's direction the tracker already has (scene frame):
   * a quick test first, and the precise work only near new Moon.
   */
  update(tMs: number, roughSun: THREE.Vector3, roughMoonDir: THREE.Vector3): void {
    const near = roughSun.dot(roughMoonDir) > Math.cos(4 * DEG); // within 4°: the rough Moon is 0.3° out at worst
    if (near) {
      const { moon, sun } = moonAndSun(tMs);
      // ECI (x, y, z) km → scene (x, z, −y) in thousands of km.
      this.moonWorld.set(moon[0], moon[2], -moon[1]).multiplyScalar(EARTH_RADIUS / EARTH_KM);
      this.sunWorld.set(sun[0], sun[2], -sun[1]).normalize();
      this.globe.setEclipse(this.moonWorld, this.sunWorld);
    } else if (this.on) {
      this.globe.setEclipse(null, null);
    }
    this.on = near;
    this.updateTrack(tMs, near);
  }

  /** The central line, drawn while the clock is within a central eclipse (and an hour either side). */
  private updateTrack(tMs: number, near: boolean): void {
    if (!near) {
      this.dropTrack();
      return;
    }
    if (Math.abs(tMs - this.eventsFrom) > 10 * 86400000) {
      this.eventsFrom = tMs;
      try {
        this.events = eclipses(tMs - 2 * 86400000, tMs + 2 * 86400000).filter((event) => event.kind === 'solar-eclipse' && event.subtype !== 'partial');
      } catch {
        this.events = [];
      }
    }
    const event = this.events.find((e) => tMs > e.startMs - 3600000 && tMs < e.endMs + 3600000);
    if (!event) return this.dropTrack();
    if (this.trackFor === event.id) return;
    this.dropTrack();
    const points: number[] = [];
    for (let t = event.startMs; t <= event.endMs; t += 120000) {
      const hit = axisOnGround(t);
      if (!hit) continue;
      // Of date → the Earth's own frame (turn back by sidereal time) → latitude and longitude.
      const g = gmst(t), c = Math.cos(-g), s = Math.sin(-g);
      const x = hit[0] * c - hit[1] * s, y = hit[0] * s + hit[1] * c, z = hit[2];
      const lat = Math.atan2(z, Math.hypot(x, y)), lon = Math.atan2(y, x);
      const r = EARTH_RADIUS * TRACK_LIFT;
      points.push(r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), -r * Math.cos(lat) * Math.sin(lon));
    }
    if (points.length < 6) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    this.track = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffb454, transparent: true, opacity: 0.85, depthWrite: false }));
    this.track.renderOrder = 3;
    this.earth.add(this.track);
    this.trackFor = event.id;
  }

  private dropTrack(): void {
    if (!this.track) return;
    this.track.removeFromParent();
    this.track.geometry.dispose();
    (this.track.material as THREE.Material).dispose();
    this.track = null;
    this.trackFor = '';
  }
}
