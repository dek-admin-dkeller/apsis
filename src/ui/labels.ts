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
import { describe } from '../data/describe.ts';
import { operatorLogo } from '../data/operators.ts';

export type LabelMode = 'off' | 'notable' | 'nearby';

const FAMOUS = /^(ISS \(ZARYA\)|CSS \(TIANHE\)|HST|LANDSAT [89]|GOES 1[6-9]|TERRASAR-X|TANDEM-X|NOAA 2[01]|SUOMI NPP|SENTINEL-[1236][A-D]?|SENTINEL-6.*|TDRS 1[0-3]|METEOSAT-1[012].*|HIMAWARI-[89]|TERRA|AQUA|AURA|CXO|XMM-NEWTON|SWIFT|TESS|NUSTAR|IXPE|ICESAT-2|SWOT|PACE|JASON-3|GPM-CORE|SMAP|CALIPSO|CLOUDSAT|GRACE-FO [12]|CRYOSAT 2|METOP-[BC]|ELEKTRO-L 4|FENGYUN 4[AB]|GEO-KOMPSAT-2A|INSAT-3DS|CREW DRAGON.*|SOYUZ-MS.*|PROGRESS-MS.*|CYGNUS.*|TIANZHOU.*|SHENZHOU.*)$/;
const MAJOR = /^(ISS \(ZARYA\)|CSS \(TIANHE\)|HST)$/; // the handful named even in the whole-Earth view
const POOL = 96;

export class Labels {
  mode: LabelMode = 'nearby';
  /** The most nearby objects that get a name tag when fully zoomed in (fewer on a phone). */
  nearby = 36;
  private readonly operators = new Map<number, string | null>(); // object index → operator (worked out once)
  private readonly elements: HTMLDivElement[] = [];
  private major: number[] = [];
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
      const logo = document.createElement('img');
      logo.className = 'op';
      logo.alt = '';
      logo.referrerPolicy = 'no-referrer';
      logo.style.display = 'none';
      el.append(logo, document.createElement('span'));
      el.style.display = 'none';
      container.append(el);
      this.elements.push(el);
    }
  }

  setCatalog(catalog: Catalog): void {
    this.catalog = catalog;
    this.operators.clear();
    this.major = catalog.sats.filter((sat) => MAJOR.test(sat.name)).map((sat) => sat.index);
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
    // Names arrive as you zoom in, so the wide view stays clean:
    //   far out (whole Earth)   only the watchlist and the three or four everyone knows
    //   closer than ~16,000 km  the well-known spacecraft too
    //   closer than ~10,000 km  the objects nearest the camera, more of them the closer you get
    const distance = this.kit.camera.position.length(); // scene units from the Earth's centre
    const named = this.mode === 'notable' || distance < 16 ? [...this.pinned, ...this.major, ...this.famous] : [...this.pinned, ...this.major];
    this.chosen = [...new Set(named)].filter((i) => this.cloud.visible[i]);
    if (this.mode !== 'nearby' || distance > 10.5) return;
    const closeness = Math.min(1, Math.max(0, (10.5 - distance) / 3.4)); // 0 at 10,500 km → 1 by about 7,100 km
    const count = Math.round(4 + (this.nearby - 4) * closeness * closeness); // slowly at first, then quickly
    const nearest: { index: number; d2: number }[] = [];
    const p = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < this.sim.count; i++) {
      if (!this.cloud.visible[i] || !this.sim.getPosition(i, p)) continue;
      const d2 = (p.x - cameraEci.x) ** 2 + (p.y - cameraEci.y) ** 2 + (p.z - cameraEci.z) ** 2;
      if (nearest.length === count && d2 >= nearest[count - 1].d2) continue;
      if (behindEarth(cameraEci, p)) continue;
      // insertion into a short sorted list — cheaper than sorting 20,000 distances
      let at = nearest.length;
      while (at > 0 && nearest[at - 1].d2 > d2) at--;
      nearest.splice(at, 0, { index: i, d2 });
      if (nearest.length > count) nearest.pop();
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
      if (placed.some((q) => Math.abs(q.x - x) < 96 && Math.abs(q.y - y) < 14)) continue; // would overlap another label
      placed.push({ x, y });
      const el = this.elements[used++];
      const sat = this.catalog.sats[index];
      // Each tag is [operator logo] name; the logo arrives from Wikipedia the first time that operator is seen.
      const text = el.lastElementChild as HTMLElement, logo = el.firstElementChild as HTMLImageElement;
      if (text.textContent !== sat.name) text.textContent = sat.name;
      let operator = this.operators.get(index);
      if (operator === undefined) this.operators.set(index, (operator = describe(sat).operator));
      const mark = operatorLogo(operator);
      const url = mark?.url ?? '';
      if (logo.dataset.url !== url) {
        logo.dataset.url = url;
        logo.style.display = url ? '' : 'none';
        logo.classList.toggle('is-dark', !!mark?.dark);
        if (url) logo.src = url;
      }
      el.classList.toggle('is-notable', this.major.includes(index) || this.famous.includes(index) || this.pinned.includes(index));
      el.style.display = '';
      el.style.transform = `translate(${x.toFixed(1)}px, ${(y - 7).toFixed(1)}px)`;
    }
    for (let i = used; i < POOL; i++) this.elements[i].style.display = 'none';
  }
}
