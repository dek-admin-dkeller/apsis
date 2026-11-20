/**
 * Country names on the globe (Layers → "Country names", `Settings.countryNames`, beside Borders).
 *
 * The points come from public/data/countries.json (scripts/build-country-labels.mjs: the centre
 * of each country's largest landmass, and its area), fetched the first time the layer is on.
 * Each frame the names on the side of the Earth facing the camera are placed on screen, largest
 * country first, skipping any that would overlap one already placed: from far away only the big
 * countries are named, and more appear as the camera comes down. Names near the limb fade, so
 * none hangs at the edge of the disc.
 *
 * DOM labels in a layer of their own under the satellites' name tags; the ground point is a
 * child position of `globe.earth` (it turns with the Earth: see "Coordinate frames").
 */

import * as THREE from 'three';

interface Country {
  n: string;
  lat: number;
  lon: number;
  a: number; // km²
}

const R = 6.371; // the Earth's radius, scene units
const POOL = 90; // at most this many names at once
/** The smallest country named, by the camera's height (scene units = 1,000 km): big ones from far, all of them close in. */
const minAreaKm2 = (heightUnits: number): number => 6e5 * Math.pow(Math.max(0, heightUnits) / 16.6, 2.2); // the usual whole-Earth view (16,600 km): countries over 600,000 km²

export class CountryLabels {
  private readonly root = document.createElement('div');
  private readonly pool: HTMLElement[] = [];
  private countries: (Country & { local: THREE.Vector3 })[] | null = null;
  private loading = false;
  private on = false;
  private readonly world = new THREE.Vector3();
  private readonly toCamera = new THREE.Vector3();
  private readonly screen = new THREE.Vector3();
  private readonly earth: THREE.Object3D;
  private readonly camera: THREE.Camera;

  constructor(earth: THREE.Object3D, camera: THREE.Camera) {
    this.earth = earth;
    this.camera = camera;
    this.root.className = 'country-labels';
    for (let i = 0; i < POOL; i++) {
      const label = document.createElement('span');
      label.className = 'country-label';
      this.pool.push(label);
      this.root.append(label);
    }
    document.body.append(this.root);
  }

  setVisible(on: boolean): void {
    this.on = on;
    this.root.classList.toggle('is-on', on);
    if (on && !this.countries && !this.loading) void this.load();
  }

  private async load(): Promise<void> {
    this.loading = true;
    try {
      const list = (await (await fetch('data/countries.json')).json()) as Country[];
      this.countries = list.map((c) => {
        const φ = THREE.MathUtils.degToRad(c.lat), λ = THREE.MathUtils.degToRad(c.lon);
        // Earth-local: (R cosφ cosλ, R sinφ, −R cosφ sinλ), just above the ground.
        return { ...c, local: new THREE.Vector3(Math.cos(φ) * Math.cos(λ), Math.sin(φ), -Math.cos(φ) * Math.sin(λ)).multiplyScalar(R * 1.002) };
      });
    } catch {
      this.countries = []; // the layer simply stays empty
    }
    this.loading = false;
  }

  /** Each frame (only while the layer is on and the tracker is drawn). */
  update(hidden: boolean): void {
    this.root.classList.toggle('is-hidden', hidden || !this.on);
    if (hidden || !this.on || !this.countries) return;
    const width = window.innerWidth, height = window.innerHeight;
    const cameraHeight = this.camera.position.length() - R;
    const smallest = minAreaKm2(cameraHeight);
    const placed: { x: number; y: number; w: number }[] = [];
    let used = 0;
    for (const country of this.countries) {
      if (used >= POOL) break;
      if (country.a < smallest) break; // largest first: nothing smaller will be named either
      this.world.copy(country.local).applyMatrix4(this.earth.matrixWorld);
      // Facing the camera? (the angle between the ground's normal and the way to the camera)
      this.toCamera.copy(this.camera.position).sub(this.world);
      const facing = this.toCamera.normalize().dot(this.world.clone().normalize());
      if (facing < 0.12) continue;
      this.screen.copy(this.world).project(this.camera);
      if (this.screen.z > 1 || Math.abs(this.screen.x) > 1.02 || Math.abs(this.screen.y) > 1.02) continue;
      const x = (this.screen.x * 0.5 + 0.5) * width, y = (0.5 - this.screen.y * 0.5) * height;
      const w = country.n.length * 7 + 10; // about the label's width, for spacing
      if (placed.some((p) => Math.abs(p.x - x) < (p.w + w) / 2 && Math.abs(p.y - y) < 16)) continue;
      placed.push({ x, y, w });
      const label = this.pool[used++];
      if (label.textContent !== country.n) label.textContent = country.n;
      label.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
      label.style.opacity = String(Math.min(1, (facing - 0.12) / 0.25));
      label.classList.toggle('is-big', country.a > 2e6);
      label.hidden = false;
    }
    for (let i = used; i < POOL; i++) this.pool[i].hidden = true;
  }
}
