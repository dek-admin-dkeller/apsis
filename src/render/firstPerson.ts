/**
 * First-person views: instead of looking AT the scene from outside, look OUT from a place in it.
 *
 *   satellite  "ride along" — the camera sits on the selected object and travels with it
 *   ground     "sky view"   — the camera stands at the ground station and looks up
 *
 * Both work the same way. Each frame a local frame is built at the viewpoint:
 *   up       straight away from the Earth's centre
 *   forward  the reference direction on the horizon (north on the ground, the direction of
 *            travel on a satellite)
 *   right    forward × up (east on the ground)
 * and the view direction is a yaw (turn right from "forward") and a pitch (tilt up from the
 * horizon) in that frame. Dragging changes yaw / pitch, the wheel changes the field of view.
 *
 * While a view is active this class owns the camera: OrbitControls is switched off and the
 * normal camera rig must not run. Leaving restores the camera exactly as it was.
 */

import './firstPerson.css';

import * as THREE from 'three';
import { gstime } from 'satellite.js';
import { compass, type Observer } from '../data/ephemeris.ts';
import { EARTH_RADIUS, type SceneKit } from './scene.ts';

export type FirstPersonMode = 'off' | 'satellite' | 'ground';

const RAD = Math.PI / 180;
const GROUND_HEIGHT = 0.002; // 2 km above the sphere: clear of the globe's flat facets
const SATELLITE_NUDGE = 0.001; // 1 km outward, so the camera is not inside the object's marker
const FOV_MIN = 20, FOV_MAX = 90;
const HORIZON_LABEL_ELEVATION = 1.5; // degrees: compass letters sit just above the horizon

/** Compass points drawn on the horizon in the sky view: [text, azimuth°, main point?]. */
const COMPASS_POINTS: [string, number, boolean][] = [
  ['N', 0, true], ['NE', 45, false], ['E', 90, true], ['SE', 135, false],
  ['S', 180, true], ['SW', 225, false], ['W', 270, true], ['NW', 315, false],
];

interface SavedCamera {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  up: THREE.Vector3;
  fov: number;
  target: THREE.Vector3;
  controlsEnabled: boolean;
}

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

export class FirstPersonView {
  private current: FirstPersonMode = 'off';
  private readonly kit: SceneKit;
  private readonly onExit: () => void;
  private saved: SavedCamera | null = null;
  private observer: Observer | null = null;

  // the local frame at the viewpoint (scene units / unit vectors), rebuilt every frame
  private readonly position = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly forward = new THREE.Vector3(1, 0, 0);
  private readonly right = new THREE.Vector3(0, 0, 1);
  private hasFrame = false;

  // where the view points, in degrees: the "target" follows the pointer, the shown value eases after it
  private yaw = 0;
  private pitch = 0;
  private yawTarget = 0;
  private pitchTarget = 0;
  private fovTarget = 42;
  private pitchMin = -5;
  private pitchMax = 89;
  private drag: { id: number; x: number; y: number } | null = null;

  // DOM: the banner and the compass letters
  private readonly banner: HTMLDivElement;
  private readonly title: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly compassBox: HTMLDivElement;
  private readonly compassLabels: { el: HTMLSpanElement; azimuth: number; shown: boolean; x: number; y: number }[] = [];
  private readoutText = '';

  constructor(kit: SceneKit, canvas: HTMLCanvasElement, onExit: () => void) {
    this.kit = kit;
    this.onExit = onExit;

    // ---- banner: where you are looking from, a hint, where you are looking, and the way out
    this.banner = document.createElement('div');
    this.banner.className = 'fp-banner is-hidden';
    this.banner.setAttribute('role', 'status');
    const text = document.createElement('div');
    text.className = 'fp-text';
    this.title = document.createElement('b');
    this.title.className = 'fp-title';
    const hint = document.createElement('span');
    hint.className = 'fp-hint';
    hint.textContent = 'Drag to look around, scroll to zoom';
    text.append(this.title, hint);
    this.readout = document.createElement('span');
    this.readout.className = 'fp-readout';
    const leave = document.createElement('button');
    leave.className = 'btn fp-exit';
    leave.textContent = 'Exit view';
    leave.title = 'Back to the normal camera (Esc)';
    leave.addEventListener('click', () => this.exit());
    this.banner.append(text, this.readout, leave);
    document.body.append(this.banner);

    // ---- compass letters on the horizon (sky view only)
    this.compassBox = document.createElement('div');
    this.compassBox.className = 'fp-compass is-hidden';
    for (const [name, azimuth, main] of COMPASS_POINTS) {
      const el = document.createElement('span');
      el.textContent = name;
      if (main) el.className = 'is-main';
      el.style.display = 'none';
      this.compassBox.append(el);
      this.compassLabels.push({ el, azimuth, shown: false, x: NaN, y: NaN });
    }
    (document.getElementById('labels') ?? document.body).append(this.compassBox);

    // ---- looking around: drag = "grab the sky", wheel = zoom
    canvas.addEventListener('pointerdown', (event) => {
      if (this.current === 'off' || this.drag) return;
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      try {
        canvas.setPointerCapture(event.pointerId); // keep the drag when the pointer leaves the canvas
      } catch { /* pointer already gone */ }
    });
    canvas.addEventListener('pointermove', (event) => {
      const drag = this.drag;
      if (!drag || event.pointerId !== drag.id || this.current === 'off') return;
      // One pixel of drag turns the view by one pixel's worth of angle, so the sky stays under the pointer.
      const degreesPerPixel = this.kit.camera.fov / Math.max(1, canvas.clientHeight);
      this.yawTarget -= (event.clientX - drag.x) * degreesPerPixel; // drag right → the scene follows → look left
      this.pitchTarget = clamp(this.pitchTarget + (event.clientY - drag.y) * degreesPerPixel, this.pitchMin, this.pitchMax);
      drag.x = event.clientX;
      drag.y = event.clientY;
    });
    const release = (event: PointerEvent) => {
      if (this.drag && event.pointerId === this.drag.id) this.drag = null;
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('wheel', (event) => {
      if (this.current === 'off') return;
      event.preventDefault();
      this.fovTarget = clamp(this.fovTarget * Math.exp(event.deltaY * 0.0012), FOV_MIN, FOV_MAX);
    }, { passive: false });
  }

  get mode(): FirstPersonMode {
    return this.current;
  }

  /** Ride along with the selected object. `label` is its name, for the banner. */
  enterSatellite(label: string): void {
    this.begin('satellite');
    this.observer = null;
    this.pitchMin = -89;
    this.pitchMax = 60;
    this.yaw = this.yawTarget = 0; // facing the direction of travel …
    this.pitch = this.pitchTarget = -35; // … tilted down so both the horizon and the ground ahead are in view
    this.title.textContent = `Riding along with ${label}`;
    this.compassBox.classList.add('is-hidden');
  }

  /** Stand at the ground station and look at the sky. */
  enterGround(observer: Observer): void {
    this.begin('ground');
    this.observer = { ...observer };
    this.pitchMin = -5;
    this.pitchMax = 89;
    this.yaw = this.yawTarget = 180; // facing south …
    this.pitch = this.pitchTarget = 30; // … a third of the way up the sky
    this.title.textContent = `Sky above ${observer.name || 'your location'}`;
    this.compassBox.classList.remove('is-hidden');
  }

  /** Common part of entering either view: remember the camera (once) and take it over. */
  private begin(mode: FirstPersonMode): void {
    const { camera, controls } = this.kit;
    if (this.current === 'off') {
      this.saved = {
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
        up: camera.up.clone(),
        fov: camera.fov,
        target: controls.target.clone(),
        controlsEnabled: controls.enabled,
      };
    }
    controls.enabled = false;
    this.current = mode;
    this.hasFrame = false;
    this.drag = null;
    this.fovTarget = mode === 'ground' ? 60 : 55; // a little wider than the normal camera: more sky, more ground
    this.readoutText = '';
    this.readout.textContent = '';
    this.banner.classList.remove('is-hidden');
    document.body.classList.add('first-person');
  }

  /** Give the camera back exactly as it was, and tell the app. */
  exit(): void {
    if (this.current === 'off') return;
    const { camera, controls } = this.kit;
    this.current = 'off';
    this.drag = null;
    this.observer = null;
    if (this.saved) {
      camera.position.copy(this.saved.position);
      camera.quaternion.copy(this.saved.quaternion);
      camera.up.copy(this.saved.up);
      camera.fov = this.saved.fov;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      controls.target.copy(this.saved.target);
      controls.enabled = this.saved.controlsEnabled;
      this.saved = null;
    }
    this.banner.classList.add('is-hidden');
    this.compassBox.classList.add('is-hidden');
    document.body.classList.remove('first-person');
    this.onExit();
  }

  /**
   * Call every frame INSTEAD of the normal camera rig while mode !== 'off' (no-op when off).
   * @param satellite position (scene units) and velocity (scene axes, any length) of the object
   *                  being ridden; null if unknown — the last pose is then held.
   */
  update(dt: number, simTimeMs: number, satellite: { position: THREE.Vector3; velocity: THREE.Vector3 } | null): void {
    if (this.current === 'off') return;
    if (this.current === 'ground') this.frameOnGround(simTimeMs);
    else if (satellite) this.frameOnSatellite(satellite.position, satellite.velocity);
    if (!this.hasFrame) return;
    const { camera, controls } = this.kit;

    // Ease towards where the pointer has asked to look (light damping, about a tenth of a second).
    const blend = 1 - Math.exp(-Math.max(0, dt) * 16);
    this.yaw += (this.yawTarget - this.yaw) * blend;
    this.pitch += (this.pitchTarget - this.pitch) * blend;
    const fov = camera.fov + (this.fovTarget - camera.fov) * blend;
    if (Math.abs(fov - camera.fov) > 0.005) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    const direction = this.directionAt(this.yaw, this.pitch);
    camera.position.copy(this.position);
    camera.up.copy(this.up);
    camera.lookAt(this.position.clone().add(direction));
    camera.updateMatrixWorld();
    // kit.render() derives the near plane from the distance to controls.target: keep it
    // tight on the ground (objects pass low overhead), looser when riding in open space.
    controls.target.copy(this.position).addScaledVector(direction, this.current === 'ground' ? 0.02 : 1);

    this.updateReadout();
    if (this.current === 'ground') this.updateCompass(direction);
  }

  /** Local frame at the ground station: up = zenith, forward = north, right = east. */
  private frameOnGround(simTimeMs: number): void {
    if (!this.observer) return;
    const lat = this.observer.latDeg * RAD;
    const lon = this.observer.lonDeg * RAD + gstime(new Date(simTimeMs)); // the Earth has turned by the sidereal angle
    this.up.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
    this.position.copy(this.up).multiplyScalar(EARTH_RADIUS + GROUND_HEIGHT);
    // North = the part of the polar axis that lies along the ground.
    this.forward.set(0, 1, 0).addScaledVector(this.up, -this.up.y);
    if (this.forward.lengthSq() < 1e-10) this.forward.set(1, 0, 0).addScaledVector(this.up, -this.up.x); // at a pole
    this.forward.normalize();
    this.right.crossVectors(this.forward, this.up); // east
    this.hasFrame = true;
  }

  /** Local frame on a satellite: up = away from the Earth, forward = direction of travel made level. */
  private frameOnSatellite(position: THREE.Vector3, velocity: THREE.Vector3): void {
    if (position.lengthSq() < 1e-12) return;
    this.up.copy(position).normalize();
    this.position.copy(position).addScaledVector(this.up, SATELLITE_NUDGE);
    const level = velocity.clone().addScaledVector(this.up, -velocity.dot(this.up));
    if (level.lengthSq() < 1e-14) {
      // No usable velocity: keep the previous heading, just re-levelled against the new "up".
      level.copy(this.forward).addScaledVector(this.up, -this.forward.dot(this.up));
      if (level.lengthSq() < 1e-10) level.set(0, 1, 0).addScaledVector(this.up, -this.up.y);
      if (level.lengthSq() < 1e-10) level.set(1, 0, 0).addScaledVector(this.up, -this.up.x);
    }
    this.forward.copy(level).normalize();
    this.right.crossVectors(this.forward, this.up);
    this.hasFrame = true;
  }

  /** Unit view direction for a yaw (degrees to the right of "forward") and pitch (degrees above the horizon). */
  private directionAt(yawDeg: number, pitchDeg: number): THREE.Vector3 {
    const yaw = yawDeg * RAD, pitch = pitchDeg * RAD;
    return new THREE.Vector3()
      .addScaledVector(this.forward, Math.cos(pitch) * Math.cos(yaw))
      .addScaledVector(this.right, Math.cos(pitch) * Math.sin(yaw))
      .addScaledVector(this.up, Math.sin(pitch));
  }

  /** "Looking SSW, 34° up" — written to the DOM only when the words change. */
  private updateReadout(): void {
    const heading = ((this.yaw % 360) + 360) % 360;
    const tilt = Math.round(this.pitch);
    const tiltText = tilt === 0 ? 'level' : `${Math.abs(tilt)}° ${tilt > 0 ? 'up' : 'down'}`;
    let where: string;
    if (this.current === 'ground') where = compass(heading);
    else where = heading < 45 || heading >= 315 ? 'ahead' : heading < 135 ? 'right' : heading < 225 ? 'behind' : 'left';
    const text = `Looking ${where}, ${tiltText}`;
    if (text === this.readoutText) return;
    this.readoutText = text;
    this.readout.textContent = text;
  }

  /** Put N / E / S / W on the horizon by projecting each direction to the screen. */
  private updateCompass(viewDirection: THREE.Vector3): void {
    const { camera } = this.kit;
    const width = window.innerWidth, height = window.innerHeight;
    const point = new THREE.Vector3();
    for (const label of this.compassLabels) {
      const direction = this.directionAt(label.azimuth, HORIZON_LABEL_ELEVATION);
      let shown = direction.dot(viewDirection) > 0.15; // in front of the camera
      let x = 0, y = 0;
      if (shown) {
        point.copy(this.position).addScaledVector(direction, 10).project(camera);
        shown = Math.abs(point.x) < 1.05 && Math.abs(point.y) < 1.05 && point.z < 1;
        x = (point.x * 0.5 + 0.5) * width;
        y = (0.5 - point.y * 0.5) * height;
      }
      if (shown !== label.shown) {
        label.shown = shown;
        label.el.style.display = shown ? '' : 'none';
      }
      if (shown && (Math.abs(x - label.x) > 0.4 || Math.abs(y - label.y) > 0.4)) {
        label.x = x;
        label.y = y;
        label.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      }
    }
  }
}
