/**
 * Tonight's aurora, drawn on the globe from NOAA's live forecast.
 *
 * Data (fetched from the visitor's browser, only while the layer is switched on):
 *   OVATION aurora model   services.swpc.noaa.gov/json/ovation_aurora_latest.json
 *                          one value per degree of longitude and latitude: the probability
 *                          (0–100) of seeing aurora overhead in the next half hour or so
 *   Planetary K index      services.swpc.noaa.gov/json/planetary_k_index_1m.json
 *                          how disturbed the Earth's magnetic field is, 0 (calm) to 9 (extreme)
 *
 * The grid becomes a 360 × 181 texture on a shell 110 km above the surface — the height
 * where the green glow really is. The shell is a child of the rotating Earth, so the ovals
 * stay over the right countries; a small shader makes them glow on the night side only.
 * Offline, or if NOAA changes the format, the layer simply stays empty.
 */

import * as THREE from 'three';
import { EARTH_RADIUS } from './scene.ts';

const AURORA_URL = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';
const KP_URL = 'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json';
const REFRESH_MS = 15 * 60 * 1000;
const W = 360, H = 181; // one texel per degree: longitude 0…359, latitude −90…+90
const SHELL = 1.017; // ≈ 110 km above the surface

const vertexShader = /* glsl */ `
  varying vec3 vLocal;        // position in the Earth's own (rotating) frame
  varying vec3 vWorldNormal;  // "straight up" at this point, in scene axes
  varying vec3 vWorldPos;
  void main() {
    vLocal = position;
    vWorldNormal = normalize((modelMatrix * vec4(normalize(position), 0.0)).xyz);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;   // aurora probability, 0…1 in the red channel
  uniform vec3 uSun;        // unit vector towards the Sun, scene axes
  uniform float uTime;
  uniform float uStrength;  // 0 until data has arrived
  varying vec3 vLocal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;

  const float PI = 3.141592653589793;

  void main() {
    // Longitude / latitude from the position itself (same convention as the globe texture:
    // longitude 0° on +X, east towards −Z, north = +Y), so nothing depends on the mesh's UVs.
    vec3 p = vLocal / max(length(vLocal), 1e-6);
    float lon = (abs(p.x) + abs(p.z) < 1e-6) ? 0.0 : atan(-p.z, p.x);   // −π … π, east positive
    float lat = asin(clamp(p.y, -1.0, 1.0));
    float lonDeg = degrees(lon);
    lonDeg += lonDeg < 0.0 ? 360.0 : 0.0;                               // 0 … 360
    vec2 uv = vec2((lonDeg + 0.5) / 360.0, (degrees(lat) + 90.5) / 181.0);
    float prob = texture2D(uMap, uv).r;

    // Nothing below ~5 %; full strength towards 45 %.
    float glow = smoothstep(0.05, 0.45, prob);

    // Night side only: fades out through twilight, a faint trace survives in daylight.
    float sunUp = dot(normalize(vWorldNormal), uSun);
    float night = 1.0 - smoothstep(-0.22, 0.12, sunUp);
    night = 0.05 + 0.95 * night;

    // Curtains: fine streaks along longitude that drift and breathe slowly.
    float streak = 0.72 + 0.28 * sin(lon * 150.0 + uTime * 0.35 + 3.0 * sin(lat * 40.0 + uTime * 0.17));
    float pulse = 0.88 + 0.12 * sin(uTime * 0.5 + lon * 6.0);

    // Seen edge-on (near the limb, or from underneath near the horizon) the layer is deeper.
    vec3 toEye = cameraPosition - vWorldPos;
    float eyeLen = max(length(toEye), 1e-6);
    float facing = abs(dot(toEye / eyeLen, normalize(vWorldNormal)));
    float edge = 1.0 - clamp(facing, 0.0, 1.0);
    float depth = 1.0 + 1.4 * edge * edge;

    vec3 green = vec3(0.22, 1.0, 0.46);
    vec3 pink = vec3(0.95, 0.32, 0.78);
    vec3 colour = mix(green, mix(green, pink, 0.55), smoothstep(0.5, 0.9, prob));

    float alpha = clamp(glow * night * streak * pulse * depth * uStrength, 0.0, 0.85);
    gl_FragColor = vec4(clamp(colour, 0.0, 1.0), alpha);
  }`;

function kpLabel(kp: number): string {
  if (kp < 3) return 'quiet';
  if (kp < 4) return 'unsettled';
  if (kp < 5) return 'active';
  if (kp < 6) return 'minor storm';
  if (kp < 7) return 'moderate storm';
  if (kp < 8) return 'strong storm';
  if (kp < 9) return 'severe storm';
  return 'extreme storm';
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export class Aurora {
  /** Called whenever the status text changes. */
  onStatus: ((text: string) => void) | null = null;
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly texture: THREE.DataTexture;
  private readonly data = new Uint8Array(W * H);
  private statusText = '';
  private visible = false;
  private lastFetch = -Infinity;
  private timer = 0;
  private loading = false;
  private warned = false;

  /** @param earth the GMST-rotating Earth mesh; the aurora shell becomes its child */
  constructor(earth: THREE.Object3D) {
    this.texture = new THREE.DataTexture(this.data, W, H, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.RepeatWrapping; // longitude wraps round
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: this.texture },
        uSun: { value: new THREE.Vector3(1, 0, 0) },
        uTime: { value: 0 },
        uStrength: { value: 0 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true, // the Earth hides the far side
      side: THREE.DoubleSide, // also visible from underneath, in the sky view
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS * SHELL, 180, 90), this.material);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2; // after the Earth and its map lines
    earth.add(this.mesh);
  }

  /** e.g. "Kp 4.3, active" — empty until the index has been downloaded. */
  get status(): string {
    return this.statusText;
  }

  /** Lazy: the first switch-on downloads the forecast; it is refreshed every 15 minutes while on. */
  setVisible(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    this.mesh.visible = on;
    clearInterval(this.timer);
    if (!on) return;
    if (performance.now() - this.lastFetch > REFRESH_MS) void this.load();
    this.timer = window.setInterval(() => void this.load(), REFRESH_MS);
  }

  /** Call every frame. `sunDirection` is the unit vector towards the Sun in scene coordinates. */
  update(realSeconds: number, sunDirection: THREE.Vector3): void {
    if (!this.visible) return;
    this.material.uniforms.uTime.value = realSeconds;
    (this.material.uniforms.uSun.value as THREE.Vector3).copy(sunDirection);
  }

  private warn(what: string, error: unknown): void {
    if (this.warned) return; // say it once, not every 15 minutes
    this.warned = true;
    console.warn(`Apsis: ${what} is unavailable (${error instanceof Error ? error.message : String(error)}); the aurora layer stays empty.`);
  }

  private async load(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.lastFetch = performance.now();
    try {
      await Promise.all([this.loadOval(), this.loadKp()]);
    } finally {
      this.loading = false;
    }
  }

  /** The probability grid → texture. */
  private async loadOval(): Promise<void> {
    try {
      const file = (await fetchJson(AURORA_URL)) as { coordinates?: unknown };
      const points = file.coordinates;
      if (!Array.isArray(points) || points.length < W * H * 0.9) throw new Error('unexpected format');
      const grid = new Float32Array(W * H);
      for (const point of points as unknown[]) {
        if (!Array.isArray(point)) continue;
        const lon = Math.round(Number(point[0])), lat = Math.round(Number(point[1])), value = Number(point[2]);
        if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(value)) continue;
        const x = ((lon % 360) + 360) % 360, y = lat + 90;
        if (y < 0 || y >= H) continue;
        grid[y * W + x] = Math.min(100, Math.max(0, value));
      }
      // One light blur so the one-degree cells do not show as blocks.
      for (let y = 0; y < H; y++) {
        const up = Math.max(0, y - 1), down = Math.min(H - 1, y + 1);
        for (let x = 0; x < W; x++) {
          const left = (x + W - 1) % W, right = (x + 1) % W;
          const smooth = (grid[y * W + x] * 4 + grid[y * W + left] + grid[y * W + right] + grid[up * W + x] + grid[down * W + x]) / 8;
          this.data[y * W + x] = Math.round(smooth * 2.55);
        }
      }
      this.texture.needsUpdate = true;
      this.material.uniforms.uStrength.value = 0.9;
    } catch (error) {
      this.warn('NOAA aurora forecast', error);
    }
  }

  /** The latest planetary K index → status text. */
  private async loadKp(): Promise<void> {
    try {
      const rows = (await fetchJson(KP_URL)) as unknown;
      if (!Array.isArray(rows)) throw new Error('unexpected format');
      let kp = NaN;
      for (let i = rows.length - 1; i >= 0 && !Number.isFinite(kp); i--) {
        const row = rows[i] as { estimated_kp?: unknown; kp_index?: unknown; Kp?: unknown } | null;
        if (!row || typeof row !== 'object') continue;
        for (const value of [row.estimated_kp, row.Kp, row.kp_index]) {
          const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
          if (Number.isFinite(n)) {
            kp = n;
            break;
          }
        }
      }
      if (!Number.isFinite(kp)) throw new Error('no value');
      const text = `Kp ${kp.toFixed(1)}, ${kpLabel(kp)}`;
      if (text !== this.statusText) {
        this.statusText = text;
        this.onStatus?.(text);
      }
    } catch (error) {
      this.warn('NOAA K index', error);
    }
  }
}
