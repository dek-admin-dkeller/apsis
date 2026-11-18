/**
 * Name labels floating next to objects, like the callsigns on a flight-tracking map.
 *   "Famous" — a short list of well-known spacecraft, always labelled.
 *   "Nearby" — also the objects closest to the camera once you zoom in.
 * A small pool of DOM elements is reused; which objects get a label is re-decided a few
 * times a second, and their screen positions are updated every frame.
 */

import * as THREE from 'three';
import type { Catalog } from '../data/catalog.ts';
import { behindEarth, type SatelliteCloud } from '../render/satellites.ts';
import type { SceneKit } from '../render/scene.ts';
import type { SimClient } from '../worker/SimClient.ts';
import { $ } from './dom.ts';

export type LabelMode = 'off' | 'notable' | 'nearby';

const FAMOUS = /^(ISS \(ZARYA\)|CSS \(TIANHE\)|HST|LANDSAT 9|GOES 19|TERRASAR-X|NOAA 21|SENTINEL-2A|TDRS 13|METEOSAT-12 \(MTG-I1\)|HIMAWARI-9)$/;
const POOL = 26;
const NEARBY = 18;

export class Labels {
  mode: LabelMode = 'nearby';
  private readonly elements: HTMLDivElement[] = [];
  private famous: number[] = [];
  private pinned: number[] = []; // watchlist: always labelled
  private chosen: number[] = []; // object indices currently labelled, most important first
  private catalog: Catalog | null = null;
  private lastPick = -Infinity;
  private readonly kit: SceneKit;
  private readonly sim: SimClient;
  private readonly cloud: SatelliteCloud;

  constructor(kit: SceneKit, sim: SimClient, cloud: SatelliteCloud) {
    this.kit = kit;
    this.sim = sim;
    this.cloud = cloud;
    const container = $('labels');
    for (let i = 0; i < POOL; i++) {
      const el = document.createElement('div');
      el.className = 'sat-label';
      el.style.display = 'none';
      container.append(el);
      this.elements.push(el);
    }
  }

  setCatalog(catalog: Catalog): void {
    this.catalog = catalog;
    this.famous = catalog.sats.filter((sat) => FAMOUS.test(sat.name)).map((sat) => sat.index);
    this.chosen = [];
    this.lastPick = -Infinity;
  }

  /** Objects that always get a label (the watchlist). */
  setPinned(indices: number[]): void {
    this.pinned = indices;
    this.lastPick = -Infinity;
  }

  /** Decide which objects deserve a label right now. */
  private pick(cameraEci: THREE.Vector3): void {
    this.chosen = [...new Set([...this.pinned, ...this.famous])].filter((i) => this.cloud.visible[i]);
    // Only label the crowd once the camera is within ~4,000 km of the surface.
    if (this.mode !== 'nearby' || this.kit.camera.position.length() > 10.5) return;
    const nearest: { index: number; d2: number }[] = [];
    const p = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < this.sim.count; i++) {
      if (!this.cloud.visible[i] || !this.sim.getPosition(i, p)) continue;
      const d2 = (p.x - cameraEci.x) ** 2 + (p.y - cameraEci.y) ** 2 + (p.z - cameraEci.z) ** 2;
      if (nearest.length === NEARBY && d2 >= nearest[NEARBY - 1].d2) continue;
      if (behindEarth(cameraEci, p)) continue;
      // insertion into a short sorted list — cheaper than sorting 20,000 distances
      let at = nearest.length;
      while (at > 0 && nearest[at - 1].d2 > d2) at--;
      nearest.splice(at, 0, { index: i, d2 });
      if (nearest.length > NEARBY) nearest.pop();
    }
    for (const n of nearest) if (!this.chosen.includes(n.index)) this.chosen.push(n.index);
  }

  /** `avoid`: a screen circle to keep clear (the 3D model of the selected object). */
  update(realSeconds: number, selectedIndex: number, avoid: { x: number; y: number; r: number } | null = null): void {
    if (this.mode === 'off' || !this.catalog || !this.sim.hasData) {
      for (const el of this.elements) el.style.display = 'none';
      return;
    }
    const { camera, eciGroup } = this.kit;
    const cameraEci = eciGroup.worldToLocal(camera.position.clone());
    if (realSeconds - this.lastPick > 0.35) {
      this.lastPick = realSeconds;
      this.pick(cameraEci);
    }

    const m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(eciGroup.matrixWorld).elements;
    const width = window.innerWidth, height = window.innerHeight;
    const placed: { x: number; y: number }[] = [];
    const p = { x: 0, y: 0, z: 0 };
    let used = 0;
    for (const index of this.chosen) {
      if (used >= POOL) break;
      if (index === selectedIndex || !this.sim.getPosition(index, p)) continue;
      const w = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
      if (w <= 0 || behindEarth(cameraEci, p)) continue;
      const x = ((m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12]) / w * 0.5 + 0.5) * width;
      const y = (0.5 - (m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13]) / w * 0.5) * height;
      if (x < 0 || x > width || y < 60 || y > height) continue;
      if (avoid && Math.hypot(x - avoid.x, y - avoid.y) < avoid.r) continue;
      if (placed.some((q) => Math.abs(q.x - x) < 110 && Math.abs(q.y - y) < 15)) continue; // would overlap another label
      placed.push({ x, y });
      const el = this.elements[used++];
      const sat = this.catalog.sats[index];
      if (el.textContent !== sat.name) el.textContent = sat.name;
      el.classList.toggle('is-notable', this.famous.includes(index) || this.pinned.includes(index));
      el.style.display = '';
      el.style.transform = `translate(${x.toFixed(1)}px, ${(y - 7).toFixed(1)}px)`;
    }
    for (let i = used; i < POOL; i++) this.elements[i].style.display = 'none';
  }
}
