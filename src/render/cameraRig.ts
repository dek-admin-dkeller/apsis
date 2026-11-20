/** Camera choreography on top of OrbitControls: smooth fly-to, follow mode, view presets. */

import * as THREE from 'three';
import { EARTH_RADIUS, type SceneKit } from './scene.ts';

type FocusFn = () => THREE.Vector3 | null; // current focus point in scene units (moves with the satellite)

interface Flight {
  elapsed: number;
  duration: number;
  startPos: THREE.Vector3;
  startTarget: THREE.Vector3;
  /** Where the camera and its look-at target should end up (re-evaluated every frame). */
  end: () => { pos: THREE.Vector3; target: THREE.Vector3 } | null;
  /** How progress runs from 0 to 1 (slow–fast–slow unless a flight says otherwise). */
  ease: (t: number) => number;
}

const ORIGIN = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const ZOOM_SPEED = 0.9; // OrbitControls' zoom step far from the Earth (matches scene.ts)
const ROTATE_SPEED = 0.55; // …and its drag-to-turn rate
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/**
 * Half-flights, for a move that continues in another scene (see ui/places.ts): `easeIn` starts
 * gently and is at full speed when it ends, `easeOut` starts at full speed and settles. Joined
 * at their fast ends, with the scene changed there, the two read as one movement.
 */
export const easeIn = (t: number) => t * t * t;
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** How close (radians, ~7°) the camera may come to straight above or below an object it follows. */
const POLE_MARGIN = 0.12;

export class CameraRig {
  follow = false;
  /** While following and left alone, drift slowly around the object. */
  autoOrbit = true;
  /** In a whole-Earth view left alone, drift slowly around the planet. */
  earthDrift = true;
  private idle = 0; // seconds since the user last touched the camera
  private held = false; // the view was sent to look at a particular place: do not drift off it
  private interacting = false;
  private focus: FocusFn | null = null;
  private flight: Flight | null = null;
  private lastFocus: THREE.Vector3 | null = null;
  private readonly kit: SceneKit;

  constructor(kit: SceneKit) {
    this.kit = kit;
    // Grabbing the globe mid-flight hands control straight back to the user.
    kit.controls.addEventListener('start', () => {
      this.flight = null;
      this.interacting = true;
      this.held = false; // the visitor has taken over: the slow drift may come back once they let go
    });
    kit.controls.addEventListener('end', () => {
      this.interacting = false;
      this.idle = 0;
    });
  }

  get flying(): boolean {
    return this.flight !== null;
  }

  /**
   * Keep an Earth-centred view where it is until the visitor next moves it. Used after flying
   * to a place on the ground (a launch pad, a city): the slow idle drift would otherwise carry
   * the camera ten degrees east of it within a quarter of a minute.
   */
  holdStill(): void {
    this.held = true;
  }

  /** Is the slow idle drift round the planet happening right now? (The phone layout dims its controls then.) */
  get drifting(): boolean {
    const earthCentred = !this.focus && this.kit.controls.target.lengthSq() < 1;
    return earthCentred && this.earthDrift && !this.held && !this.flight && this.idle > 4;
  }

  /** Where the current flight will end (null when not flying), so the ground imagery there can load before the camera arrives. */
  get destination(): { pos: THREE.Vector3; target: THREE.Vector3 } | null {
    return this.flight ? this.flight.end() : null;
  }

  /** Fly to a fixed viewpoint (used by the intro and the 1 / 2 / 3 presets). */
  flyToView(pos: THREE.Vector3, target: THREE.Vector3, duration = 1.8, ease = easeInOut): void {
    this.idle = 0;
    this.held = false;
    this.focus = null;
    this.lastFocus = null;
    this.kit.controls.minDistance = target.lengthSq() === 0 ? EARTH_RADIUS * 1.12 : 0.05;
    this.startFlight(duration, () => ({ pos, target }), ease);
  }

  /**
   * Fly to a moving focus point and stop `distance` scene units away. From then on (while
   * `follow` is on) the object is the centre of the view: dragging turns the camera around
   * IT, not around the Earth, and scrolling moves towards or away from it.
   */
  flyToFocus(focus: FocusFn, distance: number, duration = 1.6, minDistance = 0.012, side?: THREE.Vector3): void {
    this.focus = focus;
    this.lastFocus = null;
    this.idle = 0;
    this.kit.controls.minDistance = minDistance;
    const first = focus();
    if (!first) return;
    // End above and to one side of the object — on the side we came from — tilted far enough
    // over that the curve of the Earth and its horizon sit behind it.
    // (`side`: end on that side of the object instead, e.g. square to a collision's approach.)
    const from = side ? side.clone() : this.kit.camera.position.clone().sub(first);
    this.startFlight(duration, () => {
      const target = focus();
      if (!target) return null;
      const outward = target.clone().normalize();
      const lean = from.clone().addScaledVector(outward, -from.dot(outward)); // sideways part only
      if (lean.lengthSq() < 1e-9) lean.set(0, 1, 0).addScaledVector(outward, -outward.y);
      const dir = outward.multiplyScalar(0.55).addScaledVector(lean.normalize(), 0.84).normalize();
      return { pos: target.clone().add(dir.multiplyScalar(distance)), target };
    });
  }

  /** Is the camera currently tied to a moving object? */
  get focused(): boolean {
    return this.focus !== null;
  }

  /** Stop tracking and pull back to a whole-Earth view from the current side. */
  release(): void {
    if (!this.focus) return;
    const dir = this.kit.camera.position.clone().normalize();
    this.flyToView(dir.multiplyScalar(Math.max(this.kit.camera.position.length(), 19)), ORIGIN.clone(), 1.4);
  }

  private startFlight(duration: number, end: Flight['end'], ease = easeInOut): void {
    this.flight = {
      ease,
      elapsed: 0,
      duration,
      startPos: this.kit.camera.position.clone(),
      startTarget: this.kit.controls.target.clone(),
      end,
    };
  }

  update(dt: number): void {
    const { camera, controls } = this.kit;

    if (this.flight) {
      const f = this.flight;
      const end = f.end();
      if (!end) {
        this.flight = null;
      } else {
        f.elapsed += dt;
        const t = Math.min(1, f.elapsed / f.duration);
        const e = f.ease(t);
        // Swing the camera AROUND the Earth (interpolate direction and radius separately)
        // instead of cutting straight through it.
        const dirA = f.startPos.clone().normalize();
        const dirB = end.pos.clone().normalize();
        const angle = dirA.angleTo(dirB);
        const q = new THREE.Quaternion().setFromUnitVectors(dirA, dirB);
        const dir = dirA.applyQuaternion(new THREE.Quaternion().slerp(q, e));
        const radius = THREE.MathUtils.lerp(f.startPos.length(), end.pos.length(), e) + Math.sin(Math.PI * e) * (angle / Math.PI) * 7;
        camera.position.copy(dir.multiplyScalar(radius));
        controls.target.lerpVectors(f.startTarget, end.target, e);
        if (t >= 1) {
          this.flight = null;
          this.lastFocus = this.focus ? end.target.clone() : null;
        }
      }
    } else if (this.follow && this.focus) {
      // Follow: carry the camera along with the object, turning its offset with the orbit
      // so it keeps looking down from the same side.
      const now = this.focus();
      if (now) {
        const offset = camera.position.clone().sub(controls.target);
        if (this.lastFocus) {
          offset.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(this.lastFocus.clone().normalize(), now.clone().normalize()));
        }
        // Left alone for a few seconds: circle the object slowly, about its local "up".
        this.idle = this.interacting ? 0 : this.idle + dt;
        if (this.autoOrbit && this.idle > 2.5) {
          const ease = Math.min(1, (this.idle - 2.5) / 2);
          offset.applyAxisAngle(now.clone().normalize(), dt * 0.07 * ease);
        }
        controls.target.copy(now);
        camera.position.copy(now).add(offset);
        this.lastFocus = now.clone();
      }
    } else {
      this.lastFocus = null;
      // An Earth-centred view left alone: turn very slowly about the polar axis — the same
      // idea as circling a selected object, but about a third of the pace.
      this.idle = this.interacting ? 0 : this.idle + dt;
      if (this.earthDrift && !this.held && this.idle > 4 && controls.target.lengthSq() < 1) {
        const ease = Math.min(1, (this.idle - 4) / 4);
        camera.position.applyAxisAngle(WORLD_UP, dt * 0.022 * ease);
      }
    }

    // Which way is "up" for the camera: the north pole normally, but straight away from the
    // Earth while tied to an object — so the horizon under it stays level and dragging turns
    // the view around the object's own vertical. OrbitControls keeps a rotation derived from
    // camera.up that it only computes once, so it is refreshed here as "up" eases across.
    const anchor = this.follow || this.flight ? this.focus?.() : null;
    const wantUp = anchor ? anchor.clone().normalize() : WORLD_UP;
    const up = camera.up.clone().lerp(wantUp, 1 - Math.exp(-dt * 3.5));
    if (up.lengthSq() > 1e-6) camera.up.copy(up.normalize());
    const internals = controls as unknown as { _quat: THREE.Quaternion; _quatInverse: THREE.Quaternion };
    internals._quat.setFromUnitVectors(camera.up, WORLD_UP);
    internals._quatInverse.copy(internals._quat).invert();

    // Scroll-zoom multiplies the distance to the look-at point. Around a satellite that is
    // what you want, but with the Earth's CENTRE as that point the same step near the
    // surface swallows most of the remaining altitude and feels wildly sensitive. So in an
    // Earth-centred view the step is scaled by how much altitude is left.
    // Dragging has the same problem: one pixel always turns the camera by the same angle about
    // the Earth's centre, so close to the surface the ground races past. The turn rate is tied
    // to altitude so the ground moves roughly with the finger at any height.
    // Tied to an object, the camera may not tilt all the way to straight above it (its "up" is
    // the object's own vertical, so looking straight down that line leaves no heading: the view
    // flipped every frame as the object moved), nor so far under it that the camera would pass
    // into the Earth (the rule below then pushed it out each frame while the drag pushed it back
    // in: the owner saw the view "glitching" looking down past the Space Station at the Earth).
    if (this.follow && this.focus && !this.flight) {
      const at = controls.target;
      const r = at.length(), d = Math.max(camera.position.distanceTo(at), 1e-6);
      const floor = EARTH_RADIUS * 1.02;
      // The widest angle from the object's vertical at which the camera, d away, is still above the ground.
      const c = (floor * floor - r * r - d * d) / (2 * r * d);
      const horizon = c <= -1 ? Math.PI : Math.acos(Math.min(1, c));
      controls.minPolarAngle = POLE_MARGIN;
      controls.maxPolarAngle = Math.max(POLE_MARGIN + 0.05, Math.min(Math.PI - POLE_MARGIN, horizon));
    } else {
      controls.minPolarAngle = 0;
      controls.maxPolarAngle = Math.PI;
    }

    if (!this.focus && controls.target.lengthSq() < 1) {
      const distance = camera.position.length();
      const altitude = Math.max(0, distance - EARTH_RADIUS); // scene units (1,000 km)
      controls.zoomSpeed = ZOOM_SPEED * THREE.MathUtils.clamp((altitude / distance) * 1.3, 0.06, 1);
      controls.rotateSpeed = THREE.MathUtils.clamp(altitude * 0.033, 0.02, ROTATE_SPEED);
    } else {
      controls.zoomSpeed = ZOOM_SPEED;
      controls.rotateSpeed = ROTATE_SPEED;
    }

    controls.update();
    // Never let the camera sink into the planet.
    if (camera.position.length() < EARTH_RADIUS * 1.015) camera.position.setLength(EARTH_RADIUS * 1.015);
  }
}
