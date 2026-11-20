/**
 * The designer (Objects → Tools → Designer): an orbit lab for one spacecraft of your own, and a
 * collision course for it.
 *
 * The orbit is described the way the real catalogue describes every object — one OMM record of
 * orbital elements — so the made-up spacecraft is propagated, drawn, inspected and screened by
 * exactly the same code as the 19,000 real ones.
 *
 *   The lab      the spacecraft (name, any of the 3D models, mass) and its orbit (perigee,
 *                apogee, tilt, node, where the perigee lies, where it starts), drawn live as the
 *                sliders move, with the physics that follows from it (data/orbitLab.ts): speed
 *                at both ends, how far the Earth's bulge turns the orbit each day, whether it is
 *                sun-synchronous (and the tilt that would make it so), time in shadow, how long
 *                drag leaves it up, and the velocity change to get there from a parking orbit.
 *                The 24-hour check is the look-ahead scan (hashing/lookahead.ts) in its "focus"
 *                mode: only the 27 cells around this one object are searched.
 *
 *   Collision    choose any object as the target, when to meet it and from which direction;
 *   course       the orbit that puts your spacecraft exactly where the target will be is solved
 *                (its velocity at that moment is the target's turned about the line to the
 *                Earth's centre by the crossing angle, then corrected until SGP4 agrees to
 *                metres). The approach can be watched in the close-approach view, the two
 *                objects in their cells of the hash grid. At the moment of impact the two are
 *                replaced by a cloud of fragments — each on its own orbit, with the number,
 *                energy and severity given by NASA's standard break-up model — and the
 *                fragments are screened by the same hash grid as everything else: the panel
 *                counts the close approaches the new cloud causes.
 * It is a simulation inside this page only: the real catalogue is never changed, and "Clear
 * simulation" puts everything back.
 */

import './designer.css';
import { KIND_LABEL, MODEL_OVERRIDE, type ModelKind } from '../data/describe.ts';
import {
  betaAngle, breakup, deltaVFromParking, j2Rates, lifetimeDays, orbitPoints, recordFrom, rotateAbout, shadowFraction,
  stateToElements, sunSyncInclination, fragmentStates, TYPICAL_MASS, RE, MU, type Breakup, type Elements, type V3,
} from '../data/orbitLab.ts';
import { kindGroups } from '../data/spacecraft.ts';
import { CATEGORY_COLORS, type OmmRecord, type Satellite } from '../data/types.ts';
import type { FutureApproach } from '../hashing/lookahead.ts';
import { modelThumbnail } from '../render/satModels.ts';
import type { LookaheadReply, LookaheadRequest } from '../worker/lookahead.worker.ts';
import { fmt, fmtInt, fmtKm, fmtKmS, fmtRange } from './dom.ts';
import { alertDistance, clockStamp, duration } from './inspector.ts';

export interface State { r: V3; v: V3 }

/** Everything the designer asks of the tracker (main.ts). */
export interface DesignerHost {
  /** Put this record into the live catalogue (replacing any previous custom one) and select it. Returns its Satellite, or null if the catalogue is not loaded. */
  launch(record: OmmRecord): Satellite | null;
  /** Remove the custom object (and any simulation) from the catalogue. */
  remove(): void;
  /** Everything a look-ahead scan needs, taken at the current simulation time; null if not ready. */
  context(): { records: OmmRecord[]; sats: Satellite[]; mask: Uint8Array; startMs: number } | null;
  /** Jump to a predicted pass and open the close-approach view on it. */
  openApproach(a: number, b: number, tcaMs: number): void;
  /** Current simulation time (Unix ms) — use it as the epoch of the new element set. */
  now(): number;
  /** Draw the orbit being designed (ECI km points), or null to take it away. */
  preview(points: Float32Array | null): void;
  /** The object selected in the tracker, if any. */
  selected(): Satellite | null;
  /** The model kind an object is drawn with. */
  kindOf(sat: Satellite): ModelKind;
  /** SGP4 state of a catalogue object, or of a record, at a moment; null if it cannot be worked out. */
  stateOf(noradId: number, tMs: number): State | null;
  propagate(record: OmmRecord, tMs: number): State | null;
  /** Unit vector to the Sun, inertial frame. */
  sun(tMs: number): V3;
  /** Start a collision: the impactor and the fragments it will make (hidden until the moment). */
  arm(plan: CollisionPlan): Satellite | null;
  /** The approach in the close-approach view: the clock to a minute before, the two in their cells. */
  watch(plan: CollisionPlan): void;
  /** The screening cells (the G key) on or off. */
  setGrid(on: boolean): void;
}

export interface CollisionPlan {
  impactor: OmmRecord;
  fragments: OmmRecord[];
  targetNorad: number;
  impactMs: number;
  /** Where it happens, ECI km. */
  at: V3;
  figures: Breakup;
}

export const CUSTOM_NORAD_ID = 99001;
/** Fragments of a simulated collision: 99100, 99101, … */
export const FRAGMENT_NORAD_BASE = 99100;
/** At most this many fragments are drawn and screened (the model's own count is given in the panel). */
const MAX_DRAWN_FRAGMENTS = 250;
/**
 * Is this catalogue number one of a simulated collision's fragments? The range is exact: real
 * catalogue numbers have passed 100,000 (Soyuz MS-29 is 100,057), and a looser test once counted
 * the Space Station's visiting vehicles as debris.
 */
export const isSimFragment = (norad: number): boolean => norad >= FRAGMENT_NORAD_BASE && norad < FRAGMENT_NORAD_BASE + MAX_DRAWN_FRAGMENTS;

const ALT_MIN = 160, ALT_MAX = 40000; // slider range, km (log scale)
const SCAN_HOURS = 24;
const MAX_ROWS = 50;

interface Preset {
  label: string;
  perigee: number;
  apogee: number;
  inclination: number;
}
const PRESETS: Preset[] = [
  { label: 'ISS-like', perigee: 420, apogee: 420, inclination: 51.6 },
  { label: 'Sun-sync', perigee: 700, apogee: 700, inclination: 98.2 },
  { label: 'Starlink shell', perigee: 550, apogee: 550, inclination: 53 },
  { label: 'GPS-like', perigee: 20200, apogee: 20200, inclination: 55 },
  { label: 'GEO', perigee: 35786, apogee: 35786, inclination: 0 },
  { label: 'Molniya', perigee: 600, apogee: 39700, inclination: 63.4 },
];

/** Directions to meet the target from: the angle the impactor's track crosses the target's. */
const APPROACHES: { label: string; deg: number; hint: string }[] = [
  { label: 'Catch up', deg: 12, hint: 'Nearly the same direction: a slow, glancing hit' },
  { label: 'Crossing', deg: 90, hint: 'Across the target’s track: orbits that cross at right angles' },
  { label: 'Head-on', deg: 178, hint: 'Opposite directions: the fastest possible meeting' },
];

// Altitude sliders run 0 … 1000 on a log scale, so low orbits get most of the travel.
const sliderToKm = (v: number) => ALT_MIN * Math.pow(ALT_MAX / ALT_MIN, v / 1000);
const kmToSlider = (km: number) => Math.round((1000 * Math.log(Math.max(ALT_MIN, km) / ALT_MIN)) / Math.log(ALT_MAX / ALT_MIN));
// Mass, 1 kg … 500 t, log scale.
const sliderToKg = (v: number) => Math.round(Math.pow(10, (v / 1000) * Math.log10(500000)));
const kgToSlider = (kg: number) => Math.round((1000 * Math.log10(Math.max(1, kg))) / Math.log10(500000));

/** The numbers that follow from a perigee and apogee altitude (two-body orbit). */
export function orbitFrom(perigeeKm: number, apogeeKm: number) {
  const rp = RE + perigeeKm, ra = RE + apogeeKm;
  const a = (rp + ra) / 2; // semi-major axis
  const n = Math.sqrt(MU / (a * a * a)); // mean motion, rad/s
  return {
    semiMajorKm: a,
    eccentricity: (ra - rp) / (ra + rp),
    meanMotionRevPerDay: (n * 86400) / (2 * Math.PI),
    periodMin: (2 * Math.PI) / n / 60,
    perigeeSpeedKmS: Math.sqrt(MU * (2 / rp - 1 / a)), // vis-viva
    apogeeSpeedKmS: Math.sqrt(MU * (2 / ra - 1 / a)),
  };
}

const span = (minutes: number): string => (minutes < 180 ? `${fmt(minutes, 1)} min` : `${fmt(minutes / 60, 2)} h`);
function lifeText(days: number): string {
  if (!Number.isFinite(days)) return 'over a century';
  if (days < 2) return `${fmt(days * 24, 0)} hours`;
  if (days < 60) return `${fmt(days, 0)} days`;
  if (days < 730) return `${fmt(days / 30.44, 0)} months`;
  return `${fmt(days / 365.25, days < 3652 ? 1 : 0)} years`;
}
function energyText(tnt: number): string {
  if (tnt < 0.001) return `${fmt(tnt * 1e6, 0)} g of TNT`;
  if (tnt < 1) return `${fmt(tnt * 1000, tnt < 0.01 ? 1 : 0)} kg of TNT`;
  return `${fmt(tnt, tnt < 10 ? 1 : 0)} t of TNT`;
}

export class Designer {
  private readonly host: DesignerHost;
  private readonly root: HTMLElement;
  private perigee = 550;
  private apogee = 550;
  private circular = true;
  private inclination = 53;
  private raan = 0;
  private argp = 270;
  private start = 0;
  private kind: ModelKind = 'smallsat';
  private massKg = 500;
  private alertKm = 20;
  private launched = false;
  private worker: Worker | null = null;
  private scanStart = 0;
  private scanSats: Satellite[] = [];
  private focusIndex = -1;
  private finished: LookaheadReply | null = null;
  private scanKm = 20;
  // The collision course.
  private target: Satellite | null = null;
  private targetKind: ModelKind = 'smallsat';
  private leadMin = 20;
  private angle = 90;
  private plan: CollisionPlan | null = null;
  private impacted = false;
  private open = false;

  constructor(container: HTMLElement, host: DesignerHost) {
    this.host = host;
    this.root = container;
    container.classList.add('designer');
    const kinds = kindGroups().map(([heading, list]) => `<optgroup label="${heading}">${list.map((kind) => `<option value="${kind}">${KIND_LABEL[kind]}</option>`).join('')}</optgroup>`).join('');
    container.innerHTML = `
      <p class="note">Design a spacecraft and its orbit, launch it among the real objects, or put it on a collision course. It is drawn, tracked and screened like everything else.</p>

      <h4 class="d-h">Spacecraft</h4>
      <div class="d-craft">
        <img class="d-thumb" alt="" />
        <div class="d-craft-fields">
          <label class="text-field"><span>Name</span><input type="text" class="d-name" maxlength="24" spellcheck="false" autocomplete="off" value="MY SATELLITE" /></label>
          <label class="text-field d-model"><span>Model</span><select class="d-kind">${kinds}</select></label>
        </div>
      </div>
      <div class="field">
        <div class="field-head"><span>Mass</span><output class="d-mass-out"></output></div>
        <input type="range" class="d-mass" min="0" max="1000" step="1" aria-label="Mass" />
      </div>

      <h4 class="d-h">Orbit</h4>
      <div class="quick d-presets"></div>
      <div class="field">
        <div class="field-head"><span>Lowest point (perigee)</span><output class="d-perigee-out"></output></div>
        <input type="range" class="d-perigee" min="0" max="1000" step="1" aria-label="Perigee altitude" />
      </div>
      <label class="row-toggle d-circular-row"><span>Circular orbit</span><input type="checkbox" class="d-circular" checked /></label>
      <div class="field d-apogee-field">
        <div class="field-head"><span>Highest point (apogee)</span><output class="d-apogee-out"></output></div>
        <input type="range" class="d-apogee" min="0" max="1000" step="1" aria-label="Apogee altitude" />
      </div>
      <div class="field">
        <div class="field-head"><span>Tilt to the equator (inclination)</span><output class="d-inc-out"></output></div>
        <input type="range" class="d-inc" min="0" max="180" step="0.1" aria-label="Inclination" />
        <button class="d-link d-sso" type="button">Make it sun-synchronous</button>
      </div>
      <div class="field">
        <div class="field-head"><span>Where it crosses the equator northbound (node)</span><output class="d-raan-out"></output></div>
        <input type="range" class="d-raan" min="0" max="360" step="1" aria-label="Right ascension of the ascending node" />
      </div>
      <div class="field d-argp-field">
        <div class="field-head"><span>Where the lowest point lies (argument of perigee)</span><output class="d-argp-out"></output></div>
        <input type="range" class="d-argp" min="0" max="360" step="1" aria-label="Argument of perigee" />
      </div>
      <div class="field">
        <div class="field-head"><span>Where it starts on the orbit</span><output class="d-start-out"></output></div>
        <input type="range" class="d-start" min="0" max="360" step="1" aria-label="Mean anomaly at the start" />
      </div>

      <dl class="designer-readout">
        <div><dt>Period</dt><dd class="d-period"></dd></div>
        <div><dt>Speed, low point</dt><dd class="d-speed"></dd></div>
        <div><dt>Speed, high point</dt><dd class="d-speed-hi"></dd></div>
        <div><dt>Eccentricity</dt><dd class="d-ecc"></dd></div>
        <div title="The Earth's equatorial bulge (J2) turns the orbit's plane a little every day"><dt>Plane turns</dt><dd class="d-node"></dd></div>
        <div title="A sun-synchronous orbit turns once a year, keeping the same angle to the Sun: the orbit of most imaging satellites"><dt>Sun-synchronous</dt><dd class="d-sso-out"></dd></div>
        <div title="Of each orbit, at today's angle between the Sun and the orbit's plane"><dt>In shadow</dt><dd class="d-shadow"></dd></div>
        <div title="Until drag brings it down to 150 km, for a spacecraft of this mass and a typical size"><dt>Time in orbit</dt><dd class="d-life"></dd></div>
        <div title="Velocity change from a 200 km parking orbit at the same tilt (two burns, no change of plane)"><dt>Δv from parking orbit</dt><dd class="d-dv"></dd></div>
      </dl>
      <div class="designer-actions">
        <button class="btn btn-primary d-launch">Launch</button>
        <button class="btn d-remove is-hidden">Remove</button>
      </div>
      <p class="note d-launch-note"></p>
      <div class="d-check is-hidden">
        <p class="field-label">What comes close in the next ${SCAN_HOURS} hours? Report passes within</p>
        <div class="segmented d-alert">
          <button data-value="5"></button><button data-value="20" class="is-on"></button><button data-value="50"></button>
        </div>
        <button class="btn wide d-scan">Check the next ${SCAN_HOURS} hours</button>
        <div class="designer-bar is-hidden"><i></i></div>
        <p class="note d-status"></p>
        <ol class="designer-list"></ol>
      </div>

      <h4 class="d-h">Collision course</h4>
      <div class="d-collision">
        <div class="d-target">
          <div><span class="d-target-label">Target</span><b class="d-target-name">None chosen</b></div>
          <button class="btn d-pick" type="button">Use the selected object</button>
        </div>
        <div class="field">
          <div class="field-head"><span>Impact in</span><output class="d-lead-out"></output></div>
          <input type="range" class="d-lead" min="2" max="120" step="1" aria-label="Minutes until impact" />
        </div>
        <p class="field-label">Approach</p>
        <div class="segmented d-approach">${APPROACHES.map((a) => `<button data-value="${a.deg}" title="${a.hint}">${a.label}</button>`).join('')}</div>
        <dl class="designer-readout d-impact-readout">
          <div><dt>Closing speed</dt><dd class="d-rel"></dd></div>
          <div title="The energy of the collision in the frame moving with the pair's centre of mass"><dt>Energy</dt><dd class="d-energy"></dd></div>
          <div title="NASA standard break-up model: catastrophic when the projectile brings more than 40 J per gram of target"><dt>Break-up</dt><dd class="d-severity"></dd></div>
          <div title="Fragments 10 cm and larger, by the NASA standard break-up model"><dt>Fragments ≥ 10 cm</dt><dd class="d-frag"></dd></div>
          <div title="Fragments 1 cm and larger: too small to track, large enough to destroy a satellite"><dt>Fragments ≥ 1 cm</dt><dd class="d-frag1"></dd></div>
          <div title="The target's mass is the typical one for its kind of spacecraft"><dt>Target mass</dt><dd class="d-tmass"></dd></div>
        </dl>
        <div class="designer-actions">
          <button class="btn btn-primary d-arm" type="button" disabled>Launch on collision course</button>
        </div>
        <p class="note d-arm-note"></p>
        <div class="d-live is-hidden">
          <div class="d-count"><span class="d-count-label">Impact</span><b class="d-countdown"></b></div>
          <div class="designer-actions">
            <button class="btn btn-primary d-watch" type="button">Watch the approach</button>
            <button class="btn d-cells" type="button" title="The cells of the hash grid that screening uses (G)">Screening cells</button>
          </div>
          <p class="note d-after"></p>
          <button class="btn wide d-clear" type="button">Clear simulation</button>
        </div>
      </div>`;

    const presets = this.el('.d-presets');
    for (const preset of PRESETS) {
      const button = document.createElement('button');
      button.textContent = preset.label;
      button.addEventListener('click', () => {
        this.perigee = preset.perigee;
        this.apogee = preset.apogee;
        this.inclination = preset.inclination;
        this.circular = preset.apogee === preset.perigee;
        this.syncControls();
      });
      presets.append(button);
    }

    const name = this.input('.d-name');
    name.addEventListener('keydown', (event) => event.stopPropagation()); // typing must not trigger app shortcuts
    name.addEventListener('change', () => (name.value = this.cleanName()));
    const kind = this.el<HTMLSelectElement>('.d-kind');
    kind.value = this.kind;
    kind.addEventListener('change', () => {
      this.kind = kind.value as ModelKind;
      this.massKg = TYPICAL_MASS[this.kind] ?? this.massKg;
      this.drawThumb();
      this.syncControls();
    });
    kind.addEventListener('keydown', (event) => event.stopPropagation());
    this.input('.d-mass').addEventListener('input', () => {
      this.massKg = Math.max(1, sliderToKg(Number(this.input('.d-mass').value)));
      this.syncControls();
    });

    const slider = (selector: string, set: (value: number) => void) => this.input(selector).addEventListener('input', () => {
      set(Number(this.input(selector).value));
      this.syncControls();
    });
    slider('.d-perigee', (v) => {
      this.perigee = sliderToKm(v);
      if (this.circular || this.apogee < this.perigee) this.apogee = this.perigee;
    });
    slider('.d-apogee', (v) => (this.apogee = Math.max(this.perigee, sliderToKm(v))));
    slider('.d-inc', (v) => (this.inclination = v));
    slider('.d-raan', (v) => (this.raan = v));
    slider('.d-argp', (v) => (this.argp = v));
    slider('.d-start', (v) => (this.start = v));
    this.input('.d-circular').addEventListener('change', () => {
      this.circular = this.input('.d-circular').checked;
      if (this.circular) this.apogee = this.perigee;
      this.syncControls();
    });
    this.el('.d-sso').addEventListener('click', () => {
      const tilt = sunSyncInclination(orbitFrom(this.perigee, this.apogee).semiMajorKm, orbitFrom(this.perigee, this.apogee).eccentricity);
      if (tilt !== null) this.inclination = Math.round(tilt * 10) / 10;
      this.syncControls();
    });

    this.el('.d-launch').addEventListener('click', () => this.launch());
    this.el('.d-remove').addEventListener('click', () => this.host.remove());
    const alert = this.el('.d-alert');
    for (const button of alert.querySelectorAll<HTMLElement>('button')) {
      button.addEventListener('click', () => {
        for (const other of alert.querySelectorAll('button')) other.classList.toggle('is-on', other === button);
        this.alertKm = Number(button.dataset.value);
      });
    }
    this.el('.d-scan').addEventListener('click', () => (this.worker ? this.stopScan('Check stopped.') : this.startScan()));

    // ---- the collision course
    this.el('.d-pick').addEventListener('click', () => this.pickTarget());
    slider('.d-lead', (v) => (this.leadMin = v));
    const approach = this.el('.d-approach');
    for (const button of approach.querySelectorAll<HTMLElement>('button')) {
      button.addEventListener('click', () => {
        this.angle = Number(button.dataset.value);
        this.syncControls();
      });
    }
    this.el('.d-arm').addEventListener('click', () => this.arm());
    this.el('.d-watch').addEventListener('click', () => this.plan && this.host.watch(this.plan));
    this.el('.d-cells').addEventListener('click', () => this.host.setGrid(true));
    this.el('.d-clear').addEventListener('click', () => this.host.remove());

    // The live preview is drawn while the section is open.
    const section = container.closest('details');
    section?.addEventListener('toggle', () => {
      this.open = section.open;
      if (this.open) this.drawThumb();
      this.drawPreview();
    });

    this.refreshUnits();
    this.syncLaunched();
  }

  /** Write everything that names a distance or speed again (the units setting changed). */
  refreshUnits(): void {
    this.syncControls();
    for (const button of this.el('.d-alert').querySelectorAll<HTMLElement>('button')) button.textContent = alertDistance(Number(button.dataset.value));
    if (this.finished) this.showResult(this.finished);
  }

  /** Call when the catalogue was rebuilt for any reason, so stale results are cleared. `hasCustom` = the custom object is in it. */
  catalogChanged(hasCustom: boolean): void {
    this.stopScan('');
    this.el('.designer-list').replaceChildren();
    this.launched = hasCustom;
    if (!hasCustom) {
      this.el('.d-launch-note').textContent = '';
      this.plan = null;
      this.impacted = false;
      this.el('.d-live').classList.add('is-hidden');
      this.el('.d-arm-note').textContent = '';
    }
    this.syncLaunched();
  }

  /** Called every frame by the tracker with the clock: the countdown, and the moment itself. */
  tick(nowMs: number): void {
    if (!this.plan) return;
    const left = this.plan.impactMs - nowMs;
    const label = this.el('.d-countdown');
    label.textContent = left > 0 ? `in ${duration(left)} · ${clockStamp(this.plan.impactMs, true)}` : `${duration(-left)} ago · ${clockStamp(this.plan.impactMs, true)}`;
    this.el('.d-count-label').textContent = left > 0 ? 'Impact' : 'Impact was';
  }

  /** The clock went back before the impact (a rewind): ready to happen again. */
  rewound(): void {
    if (!this.plan) return;
    this.impacted = false;
    this.el('.d-watch').textContent = 'Watch the approach';
    this.el('.d-after').textContent = 'Rewound to before the impact: play forward to see it again.';
  }

  /** The impact has happened (the tracker saw the clock pass it). */
  impact(): void {
    if (!this.plan || this.impacted) return;
    this.impacted = true;
    this.el('.d-watch').textContent = 'Watch it again'; // a minute before, the pair closing in, then the impact
    const f = this.plan.figures;
    this.el('.d-after').textContent = `${f.catastrophic ? 'Catastrophic break-up' : 'Damaging, not catastrophic'}: ${fmtInt(this.plan.fragments.length)} fragments drawn and screened (the model expects ${fmtInt(f.fragments10cm)} of 10 cm or more). Close approaches they cause appear below as the screening runs.`;
  }

  /**
   * The tracker's screening result, so the panel can say what the new cloud is doing: how many
   * close pairs involve a fragment and another object, and how many are within the cloud.
   */
  noteScreening(pairs: [number, number][], sats: Satellite[], withinKm: number): void {
    if (!this.plan || !this.impacted) return;
    let outside = 0, inside = 0;
    const isFragment = (i: number) => sats[i] !== undefined && isSimFragment(sats[i].noradId);
    for (const [a, b] of pairs) {
      const fa = isFragment(a), fb = isFragment(b);
      if (fa && fb) inside++;
      else if (fa || fb) outside++;
    }
    const f = this.plan.figures;
    this.el('.d-after').textContent = `${f.catastrophic ? 'Catastrophic break-up' : 'Damaging, not catastrophic'}: ${fmtInt(this.plan.fragments.length)} fragments drawn and screened (the model expects ${fmtInt(f.fragments10cm)} of 10 cm or more). Within ${alertDistance(withinKm)} right now: ${fmtInt(outside)} pass${outside === 1 ? '' : 'es'} between fragments and other objects, ${fmtInt(inside)} inside the cloud.`;
  }

  // ---------------------------------------------------------------- controls

  private el<T extends HTMLElement = HTMLElement>(selector: string): T {
    return this.root.querySelector(selector) as T;
  }

  private input(selector: string): HTMLInputElement {
    return this.el<HTMLInputElement>(selector);
  }

  private cleanName(): string {
    return this.input('.d-name').value.trim().toUpperCase().slice(0, 24) || 'MY SATELLITE';
  }

  private drawThumb(): void {
    if (!this.open) return;
    const image = this.el<HTMLImageElement>('.d-thumb');
    try {
      image.src = modelThumbnail(this.kind) || '';
    } catch {
      image.removeAttribute('src');
    }
  }

  /** The designed orbit's elements (now as epoch). */
  private elements(): Elements {
    const orbit = orbitFrom(this.perigee, this.apogee);
    return { aKm: orbit.semiMajorKm, e: orbit.eccentricity, iDeg: this.inclination, raanDeg: this.raan % 360, argpDeg: orbit.eccentricity < 0.0005 ? 0 : this.argp, meanAnomalyDeg: this.start };
  }

  private drawPreview(): void {
    this.host.preview(this.open && !this.plan ? orbitPoints(this.elements(), 240) : null);
  }

  /** Write the state back into the controls, the physics readouts and the preview. */
  private syncControls(): void {
    this.input('.d-perigee').value = String(kmToSlider(this.perigee));
    this.input('.d-apogee').value = String(kmToSlider(this.apogee));
    this.input('.d-circular').checked = this.circular;
    this.input('.d-apogee').disabled = this.circular;
    this.el('.d-apogee-field').classList.toggle('is-off', this.circular);
    this.el('.d-argp-field').classList.toggle('is-off', this.circular);
    this.input('.d-argp').disabled = this.circular;
    this.input('.d-inc').value = String(this.inclination);
    this.input('.d-raan').value = String(this.raan);
    this.input('.d-argp').value = String(this.argp);
    this.input('.d-start').value = String(this.start);
    this.input('.d-mass').value = String(kgToSlider(this.massKg));
    this.el<HTMLSelectElement>('.d-kind').value = this.kind;
    this.el('.d-mass-out').textContent = this.massKg >= 10000 ? `${fmt(this.massKg / 1000, 0)} t` : `${fmtInt(this.massKg)} kg`;
    this.el('.d-perigee-out').textContent = fmtKm(this.perigee);
    this.el('.d-apogee-out').textContent = fmtKm(this.apogee);
    this.el('.d-inc-out').textContent = `${fmt(this.inclination, 1)}°`;
    this.el('.d-raan-out').textContent = `${fmtInt(this.raan)}°`;
    this.el('.d-argp-out').textContent = this.circular ? '–' : `${fmtInt(this.argp)}°`;
    this.el('.d-start-out').textContent = `${fmtInt(this.start)}°`;

    const orbit = orbitFrom(this.perigee, this.apogee);
    this.el('.d-period').textContent = span(orbit.periodMin);
    this.el('.d-speed').textContent = fmtKmS(orbit.perigeeSpeedKmS);
    this.el('.d-speed-hi').textContent = fmtKmS(orbit.apogeeSpeedKmS);
    this.el('.d-ecc').textContent = orbit.eccentricity < 0.0005 ? '0 (circular)' : orbit.eccentricity.toFixed(3);
    const rates = j2Rates(orbit.semiMajorKm, orbit.eccentricity, this.inclination);
    this.el('.d-node').textContent = `${rates.nodeDegPerDay >= 0 ? '+' : '−'}${fmt(Math.abs(rates.nodeDegPerDay), 2)}° a day`;
    const sso = sunSyncInclination(orbit.semiMajorKm, orbit.eccentricity);
    const isSso = sso !== null && Math.abs(sso - this.inclination) < 0.25;
    this.el('.d-sso-out').textContent = sso === null ? 'Not possible this high' : isSso ? 'Yes' : `No (needs ${fmt(sso, 1)}°)`;
    this.el('.d-sso').hidden = sso === null || isSso;
    const beta = betaAngle(this.inclination, this.raan, this.host.sun(this.host.now()));
    const shadow = shadowFraction((this.perigee + this.apogee) / 2, beta);
    this.el('.d-shadow').textContent = shadow <= 0 ? 'Always in sunlight' : `${fmt(shadow * orbit.periodMin, 0)} min (${fmt(shadow * 100, 0)} %)`;
    const areaPerMass = 0.01 * Math.cbrt(1000 / Math.max(1, this.massKg)); // a bigger craft has less area per kilogram
    this.el('.d-life').textContent = lifeText(lifetimeDays(this.perigee, this.apogee, areaPerMass));
    this.el('.d-dv').textContent = fmtKmS(deltaVFromParking(this.perigee, this.apogee));
    this.drawPreview();
    this.syncCollision();
  }

  private syncLaunched(): void {
    this.el('.d-launch').textContent = this.launched && !this.plan ? 'Update orbit' : 'Launch';
    this.el('.d-remove').classList.toggle('is-hidden', !this.launched || !!this.plan);
    this.el('.d-check').classList.toggle('is-hidden', !this.launched || !!this.plan);
  }

  // ---------------------------------------------------------------- launch

  /** The designed orbit as a CelesTrak-style OMM record, with "now" as its epoch. */
  private record(): OmmRecord {
    return recordFrom(this.elements(), this.host.now(), this.cleanName(), CUSTOM_NORAD_ID, '2099-001A');
  }

  private launch(): void {
    MODEL_OVERRIDE.set(CUSTOM_NORAD_ID, this.kind);
    this.plan = null;
    const sat = this.host.launch(this.record()); // the host rebuilds the catalogue and calls catalogChanged()
    const note = this.el('.d-launch-note');
    if (!sat) {
      note.textContent = 'The catalogue is still loading. Try again in a moment.';
      return;
    }
    this.launched = true;
    this.syncLaunched();
    this.drawPreview();
    note.textContent = `${sat.name} is in orbit. Change the sliders and press Update orbit to move it.`;
  }

  // ---------------------------------------------------------------- collision course

  private pickTarget(): void {
    const sat = this.host.selected();
    const note = this.el('.d-arm-note');
    if (!sat || sat.noradId === CUSTOM_NORAD_ID || isSimFragment(sat.noradId)) {
      note.textContent = 'Select an object in the tracker first (click it, or find it with the search), then press Use the selected object.';
      return;
    }
    this.target = sat;
    this.targetKind = this.host.kindOf(sat);
    note.textContent = '';
    this.syncCollision();
  }

  /**
   * The impactor's state at the moment of impact: at the target's position, moving with the
   * target's speed but turned about the line to the Earth's centre by the crossing angle.
   */
  private impactStates(): { target: State; impactor: State; impactMs: number } | null {
    if (!this.target) return null;
    const impactMs = this.host.now() + this.leadMin * 60000;
    const target = this.host.stateOf(this.target.noradId, impactMs);
    if (!target) return null;
    const radial = { x: target.r.x, y: target.r.y, z: target.r.z };
    const length = Math.hypot(radial.x, radial.y, radial.z);
    const up = { x: radial.x / length, y: radial.y / length, z: radial.z / length };
    return { target, impactor: { r: target.r, v: rotateAbout(target.v, up, this.angle) }, impactMs };
  }

  private figures(): Breakup | null {
    const states = this.impactStates();
    if (!states) return null;
    const dv = { x: states.target.v.x - states.impactor.v.x, y: states.target.v.y - states.impactor.v.y, z: states.target.v.z - states.impactor.v.z };
    return breakup(this.massKg, TYPICAL_MASS[this.targetKind] ?? 1000, Math.hypot(dv.x, dv.y, dv.z));
  }

  private syncCollision(): void {
    for (const button of this.el('.d-approach').querySelectorAll<HTMLElement>('button')) button.classList.toggle('is-on', Number(button.dataset.value) === this.angle);
    this.input('.d-lead').value = String(this.leadMin);
    this.el('.d-lead-out').textContent = `${this.leadMin} min`;
    this.el('.d-target-name').textContent = this.target ? this.target.name : 'None chosen';
    const figures = this.target ? this.figures() : null;
    this.el<HTMLButtonElement>('.d-arm').disabled = !figures || !!this.plan;
    this.el('.d-rel').textContent = figures ? fmtKmS(figures.relSpeedKmS, 2) : '–';
    this.el('.d-energy').textContent = figures ? energyText(figures.tntTonnes) : '–';
    this.el('.d-severity').textContent = figures ? (figures.catastrophic ? `Catastrophic (${fmtInt(figures.emr)} J/g)` : `Damaging (${fmt(figures.emr, 1)} J/g)`) : '–';
    this.el('.d-frag').textContent = figures ? fmtInt(figures.fragments10cm) : '–';
    this.el('.d-frag1').textContent = figures ? fmtInt(figures.fragments1cm) : '–';
    const targetMass = TYPICAL_MASS[this.targetKind] ?? 1000;
    this.el('.d-tmass').textContent = this.target ? (targetMass >= 10000 ? `${fmt(targetMass / 1000, 0)} t` : `${fmtInt(targetMass)} kg`) : '–';
  }

  /**
   * Solve the impactor's orbit and the fragments, and hand them to the tracker. The orbit: the
   * impact state turned into elements with the impact as their epoch, then corrected — the
   * error between where SGP4 puts that element set and where it must be is added back and the
   * elements worked out again — until SGP4 agrees to well under a kilometre.
   */
  private arm(): void {
    const states = this.impactStates();
    const figures = this.figures();
    const note = this.el('.d-arm-note');
    if (!states || !figures || !this.target) {
      note.textContent = 'The target’s position cannot be worked out for that moment.';
      return;
    }
    const name = this.cleanName();
    let r = { ...states.impactor.r }, v = { ...states.impactor.v };
    let record = recordFrom(stateToElements(r, v), states.impactMs, name, CUSTOM_NORAD_ID, '2099-001A');
    let miss = Infinity;
    for (let k = 0; k < 8; k++) {
      const got = this.host.propagate(record, states.impactMs);
      if (!got) break;
      const er = { x: states.impactor.r.x - got.r.x, y: states.impactor.r.y - got.r.y, z: states.impactor.r.z - got.r.z };
      const ev = { x: states.impactor.v.x - got.v.x, y: states.impactor.v.y - got.v.y, z: states.impactor.v.z - got.v.z };
      miss = Math.hypot(er.x, er.y, er.z);
      if (miss < 0.01) break;
      r = { x: r.x + er.x, y: r.y + er.y, z: r.z + er.z };
      v = { x: v.x + ev.x, y: v.y + ev.y, z: v.z + ev.z };
      record = recordFrom(stateToElements(r, v), states.impactMs, name, CUSTOM_NORAD_ID, '2099-001A');
    }
    const perigee = record.MEAN_MOTION > 0 ? Math.cbrt(MU / Math.pow((record.MEAN_MOTION * 2 * Math.PI) / 86400, 2)) * (1 - record.ECCENTRICITY) - RE : 0;
    if (!(miss < 1) || perigee < 120) {
      note.textContent = perigee < 120 ? 'That approach would dip into the atmosphere before reaching the target. Try another direction or time.' : 'No orbit could be found that meets the target then. Try another direction or time.';
      return;
    }
    // The fragments: from the pair's centre of mass at the moment of impact, spread by the
    // break-up model's typical speeds, each turned into an element set of its own.
    const mt = TYPICAL_MASS[this.targetKind] ?? 1000, mi = this.massKg;
    const cm = {
      x: (mi * states.impactor.v.x + mt * states.target.v.x) / (mi + mt),
      y: (mi * states.impactor.v.y + mt * states.target.v.y) / (mi + mt),
      z: (mi * states.impactor.v.z + mt * states.target.v.z) / (mi + mt),
    };
    const drawn = Math.max(6, Math.min(MAX_DRAWN_FRAGMENTS, figures.fragments10cm));
    const spread = figures.catastrophic ? 0.12 : 0.05; // km/s: the break-up model's typical ejection speeds
    const fragments = fragmentStates(states.target.r, cm, drawn, spread, this.target.noradId).map((state, k) =>
      recordFrom(stateToElements(state.r, state.v), states.impactMs, `IMPACT DEB ${k + 1}`, FRAGMENT_NORAD_BASE + k, `2099-002${String.fromCharCode(65 + (k % 26))}`),
    );
    MODEL_OVERRIDE.set(CUSTOM_NORAD_ID, this.kind);
    this.plan = { impactor: record, fragments, targetNorad: this.target.noradId, impactMs: states.impactMs, at: states.target.r, figures };
    this.impacted = false;
    this.el('.d-watch').textContent = 'Watch the approach';
    const sat = this.host.arm(this.plan);
    if (!sat) {
      this.plan = null;
      note.textContent = 'The catalogue is still loading. Try again in a moment.';
      return;
    }
    this.launched = true;
    this.syncLaunched();
    this.drawPreview();
    this.syncCollision();
    note.textContent = `${name} is on its way. It meets ${this.target.name} at ${fmtKmS(figures.relSpeedKmS, 1)} (the orbit was solved to ${fmtRange(miss)}).`;
    this.el('.d-after').textContent = '';
    this.el('.d-live').classList.remove('is-hidden');
    this.tick(this.host.now());
  }

  // ---------------------------------------------------------------- 24-hour check

  private startScan(): void {
    const ctx = this.host.context();
    const custom = ctx?.sats.find((sat) => sat.noradId === CUSTOM_NORAD_ID);
    if (!ctx || !custom) {
      this.el('.d-status').textContent = 'Launch the satellite first.';
      return;
    }
    this.scanSats = ctx.sats;
    this.scanStart = ctx.startMs;
    this.focusIndex = custom.index;
    this.scanKm = this.alertKm;
    this.finished = null;
    this.el('.designer-list').replaceChildren();
    this.worker = new Worker(new URL('../worker/lookahead.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<LookaheadReply>) => this.onReply(event.data);
    const request: LookaheadRequest = {
      records: ctx.records, mask: ctx.mask, startMs: ctx.startMs, hours: SCAN_HOURS, alertKm: this.alertKm, focus: custom.index,
    };
    this.worker.postMessage(request);
    this.el('.d-scan').textContent = 'Stop';
    const bar = this.el('.designer-bar');
    bar.classList.remove('is-hidden');
    (bar.firstElementChild as HTMLElement).style.width = '0%';
    this.el('.d-status').textContent = `Flying it forward ${SCAN_HOURS} hours against everything shown…`;
  }

  private stopScan(message: string): void {
    this.worker?.terminate();
    this.worker = null;
    this.finished = null;
    this.el('.d-scan').textContent = `Check the next ${SCAN_HOURS} hours`;
    this.el('.designer-bar').classList.add('is-hidden');
    this.el('.d-status').textContent = message;
  }

  private other(approach: FutureApproach): Satellite {
    return this.scanSats[approach.a === this.focusIndex ? approach.b : approach.a];
  }

  private onReply(reply: LookaheadReply): void {
    (this.el('.designer-bar').firstElementChild as HTMLElement).style.width = `${(reply.fraction * 100).toFixed(1)}%`;
    this.render(reply.closest.slice(0, MAX_ROWS));
    if (!reply.done) {
      this.el('.d-status').textContent = `Checking… ${Math.round(reply.fraction * 100)}%, ${fmtInt(reply.total)} found so far.`;
      return;
    }
    this.stopScan(this.summary(reply));
    this.finished = reply;
  }

  private showResult(reply: LookaheadReply): void {
    this.render(reply.closest.slice(0, MAX_ROWS));
    this.el('.d-status').textContent = this.summary(reply);
  }

  private summary(reply: LookaheadReply): string {
    const within = `within ${alertDistance(this.scanKm)} in the next ${SCAN_HOURS} h`;
    if (reply.total === 0) return `Nothing comes ${within}.`;
    const nearest = reply.closest[0];
    const objects = new Set(reply.closest.map((approach) => this.other(approach).index)).size;
    const complete = reply.total <= reply.closest.length; // the worker sends at most its closest 250
    const count = complete
      ? `${fmtInt(objects)} object${objects === 1 ? '' : 's'} pass${objects === 1 ? 'es' : ''} ${within}`
        + (reply.total > objects ? ` (${fmtInt(reply.total)} passes in all)` : '')
      : `${fmtInt(reply.total)} passes ${within}`;
    return `${count}; the closest is ${this.other(nearest).name} at ${this.distance(nearest.missKm)}.`
      + (reply.total > MAX_ROWS ? ` Showing the closest ${MAX_ROWS}.` : '');
  }

  private distance(km: number): string {
    return km < 10 ? fmtRange(km) : fmtKm(km, 1);
  }

  private render(approaches: FutureApproach[]): void {
    this.el('.designer-list').replaceChildren(...approaches.map((approach) => {
      const sat = this.other(approach);
      const li = document.createElement('li');
      li.className = approach.missKm < this.alertKm / 4 ? 'sev-high' : approach.missKm < this.alertKm / 2 ? 'sev-mid' : 'sev-low';
      li.innerHTML = '<i class="sev"></i><div class="names"><span><i class="dot"></i><b></b></span><small></small></div><span class="dist"><b></b><small></small></span>';
      li.querySelector('.names b')!.textContent = sat.name;
      li.querySelector<HTMLElement>('.dot')!.style.color = CATEGORY_COLORS[sat.category];
      li.querySelector('.names small')!.textContent = `passing at ${fmtKmS(approach.relSpeedKmS, 1)}`;
      const dist = li.querySelector('.dist')!;
      dist.firstElementChild!.textContent = this.distance(approach.missKm);
      dist.lastElementChild!.textContent = `in ${duration(approach.tcaMs - this.scanStart)}`;
      li.addEventListener('click', () => this.host.openApproach(approach.a, approach.b, approach.tcaMs));
      return li;
    }));
  }
}
