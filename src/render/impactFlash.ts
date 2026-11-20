/**
 * The moment of a simulated collision (ui/designer.ts): a flash at the point of impact and a
 * shock ring spreading from it, for about two and a half seconds of REAL time (the clock may be
 * running at any speed). The fragments themselves are catalogue objects, drawn by the point
 * cloud like everything else.
 *
 * Drawn in the inertial group (kilometres, like the satellites) with additive sprites, so bloom
 * carries the light; sized as a share of the distance to the camera, so it reads from a close-up
 * of the pair as well as from a whole-Earth view.
 */

import * as THREE from 'three';

const LIFE_S = 2.6;

function glow(stops: [number, string][]): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d')!;
  const gradient = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [at, colour] of stops) gradient.addColorStop(at, colour);
  g.fillStyle = gradient;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function ringTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d')!;
  const gradient = g.createRadialGradient(64, 64, 40, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,200,140,0)');
  gradient.addColorStop(0.7, 'rgba(255,190,120,0.9)');
  gradient.addColorStop(1, 'rgba(255,160,90,0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

export class ImpactFlash {
  private readonly group = new THREE.Group();
  private readonly core: THREE.Sprite;
  private readonly fire: THREE.Sprite;
  private readonly ring: THREE.Sprite;
  private startedAt = -1;
  private readonly unitsPerKm: number;

  private readonly sizeFactor: number;

  /**
   * `unitsPerKm`: 1 in the inertial group (km), 0.001 on the turning Earth (scene units).
   * `sizeFactor`: how large against the view (1 for a collision; a fireball is a smaller flash).
   */
  constructor(parent: THREE.Object3D, unitsPerKm = 1, sizeFactor = 1) {
    this.unitsPerKm = unitsPerKm;
    this.sizeFactor = sizeFactor;
    const sprite = (map: THREE.Texture) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
      s.renderOrder = 30;
      s.frustumCulled = false;
      return s;
    };
    this.core = sprite(glow([[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,240,210,0.9)'], [1, 'rgba(255,200,120,0)']]));
    this.fire = sprite(glow([[0, 'rgba(255,190,110,0.9)'], [0.5, 'rgba(255,120,60,0.45)'], [1, 'rgba(255,80,40,0)']]));
    this.ring = sprite(ringTexture());
    this.group.add(this.fire, this.ring, this.core);
    this.group.visible = false;
    parent.add(this.group);
  }

  /** Flash at `at` (ECI km, in the parent's frame). */
  start(at: { x: number; y: number; z: number }): void {
    this.group.position.set(at.x, at.y, at.z);
    this.startedAt = performance.now() / 1000;
    this.group.visible = true;
  }

  /** Each frame: `cameraKm` is the camera's distance to the point, km. */
  update(cameraKm: number): void {
    if (this.startedAt < 0) return;
    const t = performance.now() / 1000 - this.startedAt;
    if (t > LIFE_S) {
      this.group.visible = false;
      this.startedAt = -1;
      return;
    }
    const base = Math.max(8, cameraKm * 0.08) * this.unitsPerKm * this.sizeFactor; // a share of the view, whatever the zoom
    const k = t / LIFE_S;
    const flash = Math.exp(-t * 6);
    this.core.scale.setScalar(base * (0.6 + 2.4 * flash));
    (this.core.material as THREE.SpriteMaterial).opacity = Math.min(1, flash * 1.6);
    this.fire.scale.setScalar(base * (1 + 3 * Math.sqrt(k)));
    (this.fire.material as THREE.SpriteMaterial).opacity = 0.9 * (1 - k) * (1 - k);
    this.ring.scale.setScalar(base * (0.5 + 7 * k));
    (this.ring.material as THREE.SpriteMaterial).opacity = 0.85 * (1 - k);
  }

  get active(): boolean {
    return this.startedAt >= 0;
  }
}
