/**
 * Sharp ground when you zoom in.
 *
 * The globe's own picture is one 4096-pixel image of the whole planet: about 10 km per
 * pixel, which turns to mush from a few hundred kilometres up. So, like a map app, the
 * part of the Earth being looked at is re-covered with small, detailed image tiles fetched
 * on demand — NASA's Blue Marble from the public GIBS service, up to ~600 m per pixel
 * (sixteen times finer). Far away nothing is fetched and the original picture is used.
 *
 * Tiles are the standard "web map" pyramid: at zoom z the world is 2^z × 2^z squares in the
 * Mercator projection. Each tile here is a small curved patch of sphere sitting just above
 * the surface, a child of the rotating Earth, lit by the same Sun as the globe and faded out
 * on the night side so the city lights underneath still show.
 *
 * Tiles are remembered in a Map keyed by "z/x/y" (a hash table again): asking "do I already
 * have this tile?" is O(1), and the least recently used ones are dropped beyond a limit.
 */

import * as THREE from 'three';
import { EARTH_RADIUS } from './scene.ts';

const SOURCE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8';
const MIN_ZOOM = 5; // below this the globe's own image is just as sharp
const MAX_ZOOM = 8; // the finest level the service has
const GRID = 10; // segments per tile edge (keeps the patch on the sphere)
const LIFT = 1.0009; // just above the surface, below the map lines and markers
const KEEP = 200; // tiles kept in memory
const AT_ONCE = 8; // downloads in flight
const MERCATOR_LIMIT = 85.0511; // the projection has no tiles beyond this latitude

interface Tile {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  texture: THREE.Texture | null;
  ready: boolean;
  failed: boolean;
  usedAt: number; // real seconds
  z: number;
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalLocal;
  void main() {
    vUv = uv;
    vNormalLocal = normalize(position); // the patch is part of a sphere centred on the Earth
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uSun;      // direction to the Sun in the Earth's own (rotating) frame
  uniform float uOpacity; // fades the tile in once its picture has arrived
  uniform float uCover;   // how completely the tile hides the globe's own (blurrier) picture
  varying vec2 vUv;
  varying vec3 vNormalLocal;
  void main() {
    vec3 N = normalize(vNormalLocal);
    float sun = dot(N, uSun);
    float day = smoothstep(-0.10, 0.20, sun);                       // same day / night edge as the globe
    vec3 ground = texture2D(uMap, vUv).rgb * (0.05 + 1.1 * max(sun, 0.0)); // same daylight as the globe
    gl_FragColor = vec4(clamp(ground, 0.0, 4.0), clamp(day * uOpacity * uCover, 0.0, 1.0));
  }`;

export class EarthTiles {
  enabled = true;
  private readonly group = new THREE.Group();
  private readonly tiles = new Map<string, Tile>();
  private readonly loader = new THREE.TextureLoader().setCrossOrigin('anonymous');
  private readonly sun = { value: new THREE.Vector3(1, 0, 0) }; // one uniform shared by every tile
  private readonly cover = { value: 1 }; // shared too
  private readonly earth: THREE.Object3D;
  private wanted: string[] = []; // tiles for the current view, nearest the centre first
  private loading = 0;
  private lastPlan = -Infinity;
  private offline = false; // the service could not be reached: stop asking for a while
  private offlineSince = 0;

  constructor(earth: THREE.Object3D) {
    this.earth = earth;
    earth.add(this.group);
  }

  /** Number of detailed tiles on screen (for the status line / debugging). */
  get shown(): number {
    let n = 0;
    for (const tile of this.tiles.values()) if (tile.ready && tile.mesh.visible) n++;
    return n;
  }

  /** Call every frame. `sunDirection` is in scene coordinates. */
  update(camera: THREE.PerspectiveCamera, sunDirection: THREE.Vector3, realSeconds: number, dt: number): void {
    // The Sun as seen from the turning Earth: undo the Earth's rotation.
    this.sun.value.copy(sunDirection).applyQuaternion(this.earth.quaternion.clone().invert());

    // From far away the tiles are partly see-through, so the globe's drifting clouds still show;
    // close in (where those clouds are only a blur) they cover it completely.
    const altitude = this.earth.worldToLocal(camera.position.clone()).length() - EARTH_RADIUS;
    this.cover.value = THREE.MathUtils.lerp(1, 0.6, THREE.MathUtils.smoothstep(altitude, 1.5, 5));

    if (realSeconds - this.lastPlan > 0.25) {
      this.lastPlan = realSeconds;
      this.plan(camera, realSeconds);
    }
    for (const tile of this.tiles.values()) {
      if (tile.ready && tile.mesh.visible && tile.material.uniforms.uOpacity.value < 1) {
        tile.material.uniforms.uOpacity.value = Math.min(1, tile.material.uniforms.uOpacity.value + dt * 3);
      }
    }
  }

  /** Decide which tiles the current view needs, show those, and start loading the missing ones. */
  private plan(camera: THREE.PerspectiveCamera, realSeconds: number): void {
    this.wanted = [];
    const eye = this.earth.worldToLocal(camera.position.clone()); // camera in the Earth's frame
    const altitude = eye.length() - EARTH_RADIUS; // scene units (1,000 km)
    if (!this.enabled || altitude > 6 || altitude <= 0) return this.show(new Set());

    // The point on the ground in the middle of the view: where the centre ray meets the
    // sphere (or, if it misses — the horizon is centred — the point straight below).
    const forward = camera.getWorldDirection(new THREE.Vector3()).applyQuaternion(this.earth.getWorldQuaternion(new THREE.Quaternion()).invert());
    const b = eye.dot(forward);
    const disc = b * b - (eye.lengthSq() - EARTH_RADIUS * EARTH_RADIUS);
    const ground = disc > 0 && -b - Math.sqrt(disc) > 0
      ? eye.clone().addScaledVector(forward, -b - Math.sqrt(disc))
      : eye.clone().setLength(EARTH_RADIUS);
    const range = eye.distanceTo(ground) * 1000; // km from the camera to that point
    const lat = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(ground.y / EARTH_RADIUS, -1, 1)));
    const lon = THREE.MathUtils.radToDeg(Math.atan2(-ground.z, ground.x));
    if (Math.abs(lat) > MERCATOR_LIMIT - 1) return this.show(new Set());

    // Pick the zoom whose pixels are about the size of screen pixels at that range.
    const kmPerScreenPixel = (range * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / window.innerHeight;
    const kmPerTilePixelAtZoom0 = (40075 * Math.cos(THREE.MathUtils.degToRad(lat))) / 256;
    const z = Math.min(MAX_ZOOM, Math.round(Math.log2(kmPerTilePixelAtZoom0 / kmPerScreenPixel)));
    if (z < MIN_ZOOM) return this.show(new Set());

    // Tiles around the centre, far enough out to fill the view.
    const n = 2 ** z;
    const cx = ((lon + 180) / 360) * n;
    const latRad = THREE.MathUtils.degToRad(lat);
    const cy = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
    const tileKm = (40075 * Math.cos(latRad)) / n;
    // … which means out to the corners of the screen: half the screen's diagonal, in tiles.
    const halfDiagonalKm = (kmPerScreenPixel * Math.hypot(window.innerWidth, window.innerHeight)) / 2;
    const reach = Math.min(5, Math.max(1, Math.ceil(halfDiagonalKm / tileKm)));
    const picks: { key: string; d2: number; x: number; y: number }[] = [];
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const y = Math.floor(cy) + dy;
        if (y < 0 || y >= n) continue;
        const x = (((Math.floor(cx) + dx) % n) + n) % n; // wraps round the date line
        picks.push({ key: `${z}/${x}/${y}`, d2: (dx + 0.5 - (cx % 1)) ** 2 + (dy + 0.5 - (cy % 1)) ** 2, x, y });
      }
    }
    picks.sort((p, q) => p.d2 - q.d2);
    const needed = new Set<string>();
    for (const pick of picks) {
      needed.add(pick.key);
      this.wanted.push(pick.key);
      if (!this.tiles.has(pick.key)) this.create(pick.key, z, pick.x, pick.y);
      this.tiles.get(pick.key)!.usedAt = realSeconds;
    }
    this.show(needed);
    this.pump(realSeconds);
    this.evict();
  }

  private show(needed: Set<string>): void {
    for (const [key, tile] of this.tiles) tile.mesh.visible = tile.ready && needed.has(key);
  }

  /** Build the curved patch for one tile (its picture is loaded later, in pump()). */
  private create(key: string, z: number, x: number, y: number): void {
    const n = 2 ** z;
    const positions = new Float32Array((GRID + 1) * (GRID + 1) * 3);
    const uvs = new Float32Array((GRID + 1) * (GRID + 1) * 2);
    for (let j = 0; j <= GRID; j++) {
      // Rows are evenly spaced in MERCATOR y (not latitude), so the picture maps on linearly.
      const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + j / GRID)) / n)));
      for (let i = 0; i <= GRID; i++) {
        const lon = (((x + i / GRID) / n) * 360 - 180) * (Math.PI / 180);
        const k = j * (GRID + 1) + i;
        // Same convention as the globe: longitude 0° on +X, east towards −Z, north = +Y.
        positions[3 * k] = Math.cos(lat) * Math.cos(lon) * EARTH_RADIUS * LIFT;
        positions[3 * k + 1] = Math.sin(lat) * EARTH_RADIUS * LIFT;
        positions[3 * k + 2] = -Math.cos(lat) * Math.sin(lon) * EARTH_RADIUS * LIFT;
        uvs[2 * k] = i / GRID;
        uvs[2 * k + 1] = 1 - j / GRID;
      }
    }
    const index: number[] = [];
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const a = j * (GRID + 1) + i, b = a + 1, c = a + GRID + 1, d = c + 1;
        index.push(a, c, b, b, c, d);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    const material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: null }, uSun: this.sun, uOpacity: { value: 0 }, uCover: this.cover },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    mesh.renderOrder = -5 + z * 0.01; // straight after the globe, before everything drawn on top of it
    this.group.add(mesh);
    this.tiles.set(key, { mesh, material, texture: null, ready: false, failed: false, usedAt: 0, z });
  }

  /** Start downloads for wanted tiles that have no picture yet, a few at a time. */
  private pump(realSeconds: number): void {
    if (this.offline && realSeconds - this.offlineSince < 30) return;
    this.offline = false;
    for (const key of this.wanted) {
      if (this.loading >= AT_ONCE) return;
      const tile = this.tiles.get(key);
      if (!tile || tile.ready || tile.failed || tile.texture) continue;
      const [z, x, y] = key.split('/');
      this.loading++;
      tile.texture = this.loader.load(
        `${SOURCE}/${z}/${y}/${x}.jpeg`,
        (texture) => {
          this.loading--;
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = 8;
          tile.material.uniforms.uMap.value = texture;
          tile.ready = true;
        },
        undefined,
        () => {
          // Offline or blocked: keep the globe's own image and try again later.
          this.loading--;
          tile.failed = true;
          tile.texture = null;
          this.offline = true;
          this.offlineSince = realSeconds;
          setTimeout(() => (tile.failed = false), 30000);
        },
      );
    }
  }

  /** Forget the tiles that have gone longest without being needed. */
  private evict(): void {
    if (this.tiles.size <= KEEP) return;
    const oldest = [...this.tiles.entries()].sort((p, q) => p[1].usedAt - q[1].usedAt).slice(0, this.tiles.size - KEEP);
    for (const [key, tile] of oldest) {
      this.group.remove(tile.mesh);
      tile.mesh.geometry.dispose();
      tile.material.dispose();
      tile.texture?.dispose();
      this.tiles.delete(key);
    }
  }
}
