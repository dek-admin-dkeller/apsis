/**
 * A whole constellation at once:
 *
 *   orbits     every member's orbit (up to 300 of them) as thin lines in the inertial frame
 *   coverage   a live map on the globe of how many members each point on the ground can see
 *
 * Coverage is a 2° latitude/longitude grid of counts. Rather than asking "which satellites
 * can this cell see?" for all 16,200 cells, each satellite stamps its own footprint into the
 * grid: for every latitude row inside the footprint, the spherical law of cosines gives the
 * span of longitudes it reaches, and those cells are incremented. 11,000 Starlinks take a
 * few milliseconds.
 */

import * as THREE from 'three';
import { gstime, sgp4, type SatRec } from 'satellite.js';
import { minutesSinceEpoch } from '../worker/propagate.ts';
import { EARTH_RADIUS, EARTH_RADIUS_KM } from './scene.ts';

const MAX_ORBITS = 300;
const ORBIT_SEGMENTS = 90;
const COLS = 180, ROWS = 90; // 2° cells
const CELL_DEG = 2;
const RAD = Math.PI / 180;

/** Colour bands of the coverage map: how many members are above the horizon. Shared with the legend. */
export const COVERAGE_BANDS: { label: string; min: number; rgb: [number, number, number]; alpha: number }[] = [
  { label: '1', min: 1, rgb: [255, 93, 110], alpha: 0.26 },
  { label: '2–3', min: 2, rgb: [255, 180, 84], alpha: 0.22 },
  { label: '4–7', min: 4, rgb: [79, 240, 180], alpha: 0.17 },
  { label: '8 or more', min: 8, rgb: [127, 227, 255], alpha: 0.13 },
];

type Vec3 = { x: number; y: number; z: number };

export class ConstellationView {
  private readonly orbits: THREE.LineSegments;
  private readonly shell: THREE.Mesh;
  private readonly texture: THREE.DataTexture;
  private readonly pixels = new Uint8Array(COLS * ROWS * 4);
  private readonly counts = new Uint16Array(COLS * ROWS);
  // per-row constants: sine, cosine and area weight of each row's latitude
  private readonly rowSin = new Float64Array(ROWS);
  private readonly rowCos = new Float64Array(ROWS);

  private orbitRecs: SatRec[] = [];
  private orbitPeriods: number[] = [];
  private orbitsBuiltSim = NaN; // simulation time the lines were built for
  private orbitsBuiltReal = -Infinity;

  private coverageOn = false;
  private minElevation = 10 * RAD;
  private coverageAt = -Infinity; // real seconds of the last recompute
  private covered = 0;
  private most = 0;
  private readonly scratch: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(eciGroup: THREE.Object3D, earth: THREE.Object3D) {
    this.orbits = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.orbits.frustumCulled = false;
    this.orbits.visible = false;
    this.orbits.renderOrder = 1;
    eciGroup.add(this.orbits);

    for (let j = 0; j < ROWS; j++) {
      const lat = (-90 + (j + 0.5) * CELL_DEG) * RAD; // row 0 = south: a DataTexture's first row is v = 0
      this.rowSin[j] = Math.sin(lat);
      this.rowCos[j] = Math.cos(lat);
    }

    // The grid as a texture on a shell just above the surface. A default three.js sphere
    // puts u = 0.5 (the middle column) on longitude 0° and v = 1 on the north pole — the
    // same mapping the Earth's own textures use — so column i is longitude −180° + 2°·(i + ½).
    this.texture = new THREE.DataTexture(this.pixels, COLS, ROWS, THREE.RGBAFormat);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.RepeatWrapping;
    this.texture.generateMipmaps = false;
    this.shell = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_RADIUS * 1.006, 96, 48),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false }),
    );
    this.shell.renderOrder = 1;
    this.shell.visible = false;
    earth.add(this.shell);
  }

  /** Share of the Earth's surface that currently sees at least one member (0–1). */
  get coveredFraction(): number {
    return this.covered;
  }

  /** The largest number of members in view from any one place. */
  get maxInView(): number {
    return this.most;
  }

  setOrbits(satrecs: SatRec[], periodsMin: number[], color: THREE.Color): void {
    // Too many to draw them all: take an even sample.
    const stride = Math.max(1, Math.ceil(satrecs.length / MAX_ORBITS));
    this.orbitRecs = [];
    this.orbitPeriods = [];
    for (let i = 0; i < satrecs.length; i += stride) {
      this.orbitRecs.push(satrecs[i]);
      this.orbitPeriods.push(periodsMin[i]);
    }
    (this.orbits.material as THREE.LineBasicMaterial).color.copy(color);
    this.orbitsBuiltSim = NaN; // (re)build on the next update
    this.orbitsBuiltReal = -Infinity;
    if (this.orbitRecs.length === 0) {
      this.orbits.visible = false;
      this.orbits.geometry.dispose();
      this.orbits.geometry = new THREE.BufferGeometry();
    }
  }

  setCoverage(on: boolean, minElevationDeg: number): void {
    this.coverageOn = on;
    this.minElevation = minElevationDeg * RAD;
    this.shell.visible = on;
    this.coverageAt = -Infinity; // recompute straight away
    if (!on) this.covered = this.most = 0;
  }

  update(simTimeMs: number, realSeconds: number, count: number, positions: (i: number, out: Vec3) => boolean): void {
    // Orbits are fixed in the inertial frame and drift only slowly, so they are rebuilt
    // rarely: when the clock has moved 10 minutes, and never more than once every 3 s.
    if (this.orbitRecs.length > 0) {
      const stale = Number.isNaN(this.orbitsBuiltSim) || Math.abs(simTimeMs - this.orbitsBuiltSim) > 600000;
      if (stale && realSeconds - this.orbitsBuiltReal > 3) this.buildOrbits(simTimeMs, realSeconds);
    }
    if (this.coverageOn && realSeconds - this.coverageAt >= 1.5) {
      this.coverageAt = realSeconds;
      this.computeCoverage(simTimeMs, count, positions);
    }
  }

  /** One closed loop per member: its path over one revolution from now. */
  private buildOrbits(simTimeMs: number, realSeconds: number): void {
    this.orbitsBuiltSim = simTimeMs;
    this.orbitsBuiltReal = realSeconds;
    const vertices = new Float32Array(this.orbitRecs.length * ORBIT_SEGMENTS * 6);
    let at = 0;
    for (let m = 0; m < this.orbitRecs.length; m++) {
      const rec = this.orbitRecs[m];
      const start = minutesSinceEpoch(rec, simTimeMs);
      let px = 0, py = 0, pz = 0, have = false;
      for (let s = 0; s <= ORBIT_SEGMENTS; s++) {
        const p = sgp4(rec, start + (this.orbitPeriods[m] * s) / ORBIT_SEGMENTS)?.position;
        if (!p || !Number.isFinite(p.x)) {
          have = false; // a gap: do not join across it
          continue;
        }
        if (have) {
          vertices[at++] = px; vertices[at++] = py; vertices[at++] = pz;
          vertices[at++] = p.x; vertices[at++] = p.y; vertices[at++] = p.z;
        }
        px = p.x; py = p.y; pz = p.z;
        have = true;
      }
    }
    this.orbits.geometry.dispose();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices.subarray(0, at), 3));
    this.orbits.geometry = geometry;
    this.orbits.visible = at > 0;
  }

  /** Stamp every member's footprint into the count grid, then turn the counts into colours. */
  private computeCoverage(simTimeMs: number, count: number, positions: (i: number, out: Vec3) => boolean): void {
    const { counts, rowSin, rowCos } = this;
    counts.fill(0);
    const gmst = gstime(new Date(simTimeMs));
    const eps = this.minElevation;
    const p = this.scratch;
    for (let i = 0; i < count; i++) {
      if (!positions(i, p)) continue;
      const r = Math.hypot(p.x, p.y, p.z);
      if (r <= EARTH_RADIUS_KM + 1) continue;
      // Largest Earth-central angle at which the satellite is still `eps` above the horizon.
      const reach = Math.acos(Math.min(1, (EARTH_RADIUS_KM * Math.cos(eps)) / r)) - eps;
      if (reach <= 0) continue;
      const lat0 = Math.asin(p.z / r);
      const lon0 = Math.atan2(p.y, p.x) - gmst; // longitude of the point underneath (radians, any multiple of 2π)
      const sin0 = Math.sin(lat0), cos0 = Math.cos(lat0), cosReach = Math.cos(reach);
      const colCentre = ((lon0 / RAD + 180) / CELL_DEG) - 0.5; // fractional column of lon0

      const rowLo = Math.max(0, Math.ceil(((lat0 - reach) / RAD + 90) / CELL_DEG - 0.5));
      const rowHi = Math.min(ROWS - 1, Math.floor(((lat0 + reach) / RAD + 90) / CELL_DEG - 0.5));
      for (let j = rowLo; j <= rowHi; j++) {
        // cos(angle) = sinφ·sinφ₀ + cosφ·cosφ₀·cos(Δlon) ≥ cos(reach)  →  how far east/west this row is reached
        const denom = rowCos[j] * cos0;
        const need = denom > 1e-9 ? (cosReach - rowSin[j] * sin0) / denom : (rowSin[j] * sin0 >= cosReach ? -2 : 2);
        if (need > 1) continue; // this row is out of reach
        const base = j * COLS;
        if (need <= -1) {
          for (let c = 0; c < COLS; c++) counts[base + c]++; // the whole circle of latitude (near a pole)
          continue;
        }
        const halfCols = Math.acos(need) / RAD / CELL_DEG;
        const from = Math.ceil(colCentre - halfCols), to = Math.floor(colCentre + halfCols);
        if (to - from + 1 >= COLS) {
          for (let c = 0; c < COLS; c++) counts[base + c]++;
          continue;
        }
        for (let c = from; c <= to; c++) counts[base + (((c % COLS) + COLS) % COLS)]++; // wraps round the date line
      }
    }

    // counts → colours, and the two summary numbers (area-weighted: cells shrink towards the poles)
    const pixels = this.pixels;
    const none = COVERAGE_BANDS[0].rgb;
    let most = 0, seenArea = 0, allArea = 0;
    for (let j = 0; j < ROWS; j++) {
      const weight = rowCos[j];
      allArea += weight * COLS;
      for (let c = 0; c < COLS; c++) {
        const n = counts[j * COLS + c];
        const o = (j * COLS + c) * 4;
        if (n === 0) {
          // transparent, but in the lowest band's colour so the blended edge has no dark fringe
          pixels[o] = none[0]; pixels[o + 1] = none[1]; pixels[o + 2] = none[2]; pixels[o + 3] = 0;
          continue;
        }
        if (n > most) most = n;
        seenArea += weight;
        let band = COVERAGE_BANDS[0];
        for (const candidate of COVERAGE_BANDS) if (n >= candidate.min) band = candidate;
        pixels[o] = band.rgb[0]; pixels[o + 1] = band.rgb[1]; pixels[o + 2] = band.rgb[2];
        pixels[o + 3] = Math.round(band.alpha * 255);
      }
    }
    this.covered = seenArea / allArea;
    this.most = most;
    this.texture.needsUpdate = true;
  }
}
