/**
 * Phones only: getting between worlds with one small pill and a few gestures.
 *
 * The owner found the earlier phone controls fiddly and in the way: a path of words at the top
 * ("Solar system / Earth": tap "Solar system" to come out beside the dot, again for the whole
 * system) and a 90 px strip of planet chips above the tab bar. Following how phone apps that
 * show a full-screen 3D world do it (Apple Maps, Google Earth, Eyes on the Solar System: the
 * picture is the interface, a few floating controls, sheets that swipe away), there is now:
 *
 *   the pill    the middle item of the tab bar itself, "‹ Earth ›" (it used to float above the
 *               bar; the owner asked for the two to be one, to take less room), with a line of context above
 *               the name. Tap it at a world: out to the WHOLE solar system in one move. Tap it
 *               on the solar system: go in to the world the camera is beside, or (looking at
 *               all of it) open the list of worlds. Swipe it sideways, or tap ‹ ›: the next or
 *               previous world outwards from the Sun. Swipe it up, or hold it: the list.
 *   the sheet   every world as a small globe (its own map) in a grid, the moons of the planet
 *               you are at in a row of their own; swiped down, a tap outside or Escape closes it.
 *   two fingers a two-finger tap anywhere on the picture goes up a level (the same as Escape),
 *               as a two-finger tap zooms out in a map app.
 * Every gesture has a visible equivalent on the pill (the chevrons, the tap), because gestures
 * nobody shows are gestures nobody finds. A one-finger drag on the picture still turns the
 * camera and a pinch still zooms: the pill takes only the swipes that start on it.
 *
 * On a computer none of this is shown: the path in the top bar and the picture are the menu
 * (see "Places" in CLAUDE.md).
 */

import './worldStrip.css';
import { BODIES, BODY_LIST } from '../space/bodies.ts';
import { IMAGERY } from '../space/imagery.ts';
import type { BodyId } from '../space/types.ts';

type WorldId = BodyId | 'system';

export interface WorldStripHost {
  /** Where the visitor is: the kind of scene, its world, and on the solar system the world the camera is beside. */
  whereNow(): { spot: 'tracker' | 'place' | 'map'; body: BodyId; beside: BodyId | null };
  /** A world chosen: on the solar system, up to its dot (a second time, in); elsewhere the journey there. */
  go(id: WorldId): void;
  /** All the way to a world (and in), from wherever the visitor is. */
  enter(id: BodyId): void;
  /** Out to the whole solar system, from wherever the visitor is. */
  whole(): void;
  /** One level up (what Escape does). */
  up(): void;
}

/** The worlds in order outwards from the Sun: what a sideways swipe steps through. */
const ORDER: BodyId[] = ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

/**
 * A world's small map (the copy the solar system draws it from), if it has one. A world wrapped
 * in cloud is pictured by its clouds, as it is seen (Venus), except the Earth.
 */
function smallMap(id: BodyId): string | null {
  const imagery = IMAGERY[id];
  const base = imagery?.clouds && id !== 'earth' ? imagery.clouds : imagery?.base;
  return base ? base.replace(/(_m)?\.(jpg|webp|png)$/, '_s.$2') : null; // (a "_m" copy shares its small copy with the full map)
}

/**
 * The icon of a world: its own map projected onto a sphere and lit from the upper left, like a
 * photograph of the planet (the first icons were the flat map stretched over a circle under two
 * gradients, and read as coloured balls: the owner's words). Drawn once per world, at twice the
 * largest size shown, in an idle moment, and kept.
 */
const GLOBES = new Map<BodyId, Promise<string | null>>();
const GLOBE_PX = 104;
function globeIcon(id: BodyId): Promise<string | null> {
  const known = GLOBES.get(id);
  if (known) return known;
  const map = smallMap(id);
  const made = !map ? Promise.resolve(null) : new Promise<string | null>((resolve) => {
    const image = new Image();
    image.onerror = () => resolve(null);
    image.onload = () => {
      const work = () => {
        try {
          resolve(renderGlobe(image, id === 'sun'));
        } catch {
          resolve(null);
        }
      };
      if (typeof requestIdleCallback === 'function') requestIdleCallback(work, { timeout: 600 });
      else setTimeout(work, 30);
    };
    image.src = map;
  });
  GLOBES.set(id, made);
  return made;
}

function renderGlobe(image: HTMLImageElement, glowing: boolean): string {
  const sw = image.naturalWidth, sh = image.naturalHeight;
  const source = document.createElement('canvas');
  source.width = sw;
  source.height = sh;
  const sg = source.getContext('2d', { willReadFrequently: true })!;
  sg.drawImage(image, 0, 0);
  const src = sg.getImageData(0, 0, sw, sh).data;
  const out = document.createElement('canvas');
  out.width = out.height = GLOBE_PX;
  const og = out.getContext('2d')!;
  const img = og.createImageData(GLOBE_PX, GLOBE_PX);
  const R = GLOBE_PX / 2 - 1;
  const light = { x: -0.55, y: 0.45, z: 0.7 };
  const ll = Math.hypot(light.x, light.y, light.z);
  for (let py = 0; py < GLOBE_PX; py++) {
    for (let px = 0; px < GLOBE_PX; px++) {
      const x = (px + 0.5 - GLOBE_PX / 2) / R, y = (GLOBE_PX / 2 - py - 0.5) / R;
      const d = Math.hypot(x, y);
      if (d > 1 + 1 / R) continue;
      const z = Math.sqrt(Math.max(0, 1 - Math.min(1, d) ** 2));
      // The point on the sphere → longitude and latitude → the map (longitude 0 in the middle).
      const lon = Math.atan2(x, z), lat = Math.asin(Math.max(-1, Math.min(1, y)));
      const u = Math.min(sw - 1, Math.max(0, Math.floor((lon / (2 * Math.PI) + 0.5) * sw)));
      const v = Math.min(sh - 1, Math.max(0, Math.floor((0.5 - lat / Math.PI) * sh)));
      const s = (v * sw + u) * 4;
      // Sunlight from the upper left, a little light round the night side, a darker limb;
      // the Sun glows by itself.
      const lambert = Math.max(0, (x * light.x + y * light.y + z * light.z) / ll);
      const shade = glowing ? 0.72 + 0.38 * z : (0.1 + 0.95 * Math.pow(lambert, 0.85)) * (0.86 + 0.14 * z);
      const o = (py * GLOBE_PX + px) * 4;
      img.data[o] = Math.min(255, src[s] * shade);
      img.data[o + 1] = Math.min(255, src[s + 1] * shade);
      img.data[o + 2] = Math.min(255, src[s + 2] * shade);
      img.data[o + 3] = Math.round(255 * Math.max(0, Math.min(1, (1 - d) * R + 0.5))); // a smooth edge
    }
  }
  og.putImageData(img, 0, 0);
  return out.toDataURL('image/png');
}

const SYSTEM_SVG = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="2.2"/><ellipse cx="10" cy="10" rx="8.2" ry="3.4"/><ellipse cx="10" cy="10" rx="5" ry="2"/></svg>';

/** A little globe of a world: its own map, lit from one side. */
function orb(id: WorldId, size: 'small' | 'large'): HTMLElement {
  const node = el('span', `ws-orb is-${size}`);
  if (id === 'system') {
    node.classList.add('is-system');
    node.innerHTML = SYSTEM_SVG;
    return node;
  }
  const [r, g, b] = BODIES[id].color.map((c) => Math.round(c * 255));
  node.style.setProperty('--orb', `rgb(${r}, ${g}, ${b})`);
  const map = smallMap(id);
  if (map) node.style.setProperty('--map', `url("${map}")`);
  if (id === 'sun') node.classList.add('is-sun');
  if (id === 'saturn') node.classList.add('has-ring');
  // The rendered globe replaces the stand-in as soon as it is ready (at once, the second time).
  void globeIcon(id).then((url) => {
    if (!url) return;
    node.style.setProperty('--globe', `url("${url}")`);
    node.classList.add('is-rendered');
  });
  return node;
}

/** The planet a world belongs to (a moon's planet; a planet itself). */
const planetOf = (id: BodyId): BodyId => (BODIES[id].kind === 'moon' && id !== 'moon' ? BODIES[id].parent! : id);

export class WorldStrip {
  private readonly host: WorldStripHost;
  private readonly pill = el('nav', 'world-pill');
  private readonly prev = el('button', 'wp-step is-prev');
  private readonly next = el('button', 'wp-step is-next');
  private readonly label = el('button', 'wp-label');
  private readonly sheet = el('div', 'world-sheet is-hidden');
  private readonly scrim = el('div', 'world-scrim is-hidden');
  private shownKey = '';
  /** The last world the visitor was at: where "the next world" counts from on the whole solar system. */
  private lastWorld: BodyId = 'earth';

  constructor(host: WorldStripHost) {
    this.host = host;
    this.pill.id = 'm-worlds';
    this.pill.setAttribute('aria-label', 'Worlds');
    this.prev.type = this.next.type = this.label.type = 'button';
    this.prev.setAttribute('aria-label', 'Previous world');
    this.next.setAttribute('aria-label', 'Next world');
    this.pill.append(this.prev, this.label, this.next);
    document.body.append(this.scrim, this.sheet);
    // Inside the tab bar (the rail is the tab bar on a phone; on a computer the pill is hidden).
    (document.querySelector('#hud .rail') ?? document.body).append(this.pill);
    this.prev.addEventListener('click', () => this.step(-1));
    this.next.addEventListener('click', () => this.step(1));
    this.scrim.addEventListener('click', () => this.closeSheet());
    this.wireSwipes();
    this.wireTwoFingerTap();
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.sheetOpen) {
        event.stopImmediatePropagation();
        this.closeSheet();
      }
    }, true);
  }

  private get sheetOpen(): boolean {
    return !this.sheet.classList.contains('is-hidden');
  }

  /** Redraw for where the visitor is now (cheap when nothing changed). */
  update(): void {
    const where = this.host.whereNow();
    if (where.spot !== 'map') this.lastWorld = where.body;
    const key = `${where.spot}|${where.body}|${where.beside ?? ''}`;
    if (key === this.shownKey) return;
    this.shownKey = key;
    let caption: string, name: string, icon: WorldId;
    if (where.spot === 'map' && where.beside) {
      caption = 'Tap to go in';
      name = BODIES[where.beside].name;
      icon = where.beside;
    } else if (where.spot === 'map') {
      caption = 'Swipe for worlds';
      name = 'Solar system';
      icon = 'system';
    } else {
      const body = BODIES[where.body];
      caption = body.kind === 'moon' && where.body !== 'moon' ? `Solar system · ${BODIES[body.parent!].name}` : 'Solar system';
      name = body.name;
      icon = where.body;
    }
    const text = el('span', 'wp-text');
    text.append(el('span', 'wp-caption', caption), el('b', 'wp-name', name));
    this.label.replaceChildren(orb(icon, 'small'), text);
    this.label.setAttribute('aria-label', where.spot === 'map' ? (where.beside ? `Go in to ${name}` : 'Choose a world') : `${name}: out to the solar system`);
    this.pill.classList.toggle('is-beside', where.spot === 'map' && where.beside !== null);
    if (this.sheetOpen) this.drawSheet();
  }

  /** The world a step counts from, and a step to the next or previous one outwards. */
  private step(direction: 1 | -1): void {
    const where = this.host.whereNow();
    const from = planetOf(where.spot === 'map' ? where.beside ?? this.lastWorld : where.body);
    const i = Math.max(0, ORDER.indexOf(from));
    const target = ORDER[(i + direction + ORDER.length) % ORDER.length];
    navigator.vibrate?.(6);
    this.nudge(direction);
    this.host.go(target);
  }

  /** A small slide of the name in the direction of travel: the pill answers the swipe at once. */
  private nudge(direction: 1 | -1): void {
    this.label.animate?.([{ transform: `translateX(${direction * 14}px)`, opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  }

  private tap(): void {
    const where = this.host.whereNow();
    navigator.vibrate?.(6);
    if (where.spot === 'map') {
      if (where.beside) this.host.go(where.beside);
      else this.openSheet();
    } else {
      this.host.whole();
    }
  }

  /** Swipes and holds that start on the pill (and only there: the picture keeps its own drags). */
  private wireSwipes(): void {
    let start: { x: number; y: number; t: number; id: number } | null = null;
    let held = 0;
    let done = false;
    this.label.addEventListener('pointerdown', (event) => {
      start = { x: event.clientX, y: event.clientY, t: performance.now(), id: event.pointerId };
      done = false;
      this.label.setPointerCapture?.(event.pointerId);
      window.clearTimeout(held);
      held = window.setTimeout(() => {
        if (!start || done) return;
        done = true; // held: the list
        this.openSheet();
      }, 480);
    });
    this.label.addEventListener('pointermove', (event) => {
      if (!start || done || event.pointerId !== start.id) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (Math.hypot(dx, dy) > 10) window.clearTimeout(held);
      this.label.style.transform = `translateX(${Math.max(-18, Math.min(18, dx * 0.35))}px)`;
      if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        done = true;
        this.label.style.transform = '';
        this.step(dx < 0 ? 1 : -1); // a swipe to the left brings the next world in from the right
      } else if (dy < -34 && Math.abs(dy) > Math.abs(dx)) {
        done = true;
        this.label.style.transform = '';
        this.openSheet();
      }
    });
    const end = (event: PointerEvent): void => {
      window.clearTimeout(held);
      this.label.style.transform = '';
      if (!start || event.pointerId !== start.id) return;
      const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      const wasTap = !done && moved < 10 && event.type === 'pointerup';
      start = null;
      if (wasTap) this.tap();
    };
    this.label.addEventListener('pointerup', end);
    this.label.addEventListener('pointercancel', end);
    // Keyboard and screen readers: a click with no pointer movement is a tap.
    this.label.addEventListener('click', (event) => {
      if (event.detail === 0) this.tap();
    });
  }

  /** Two fingers down and up together, without moving, on the picture: up a level. */
  private wireTwoFingerTap(): void {
    let begin: { t: number; points: { x: number; y: number }[] } | null = null;
    let moved = false;
    const onPicture = (target: EventTarget | null): boolean => target instanceof HTMLCanvasElement;
    window.addEventListener('touchstart', (event) => {
      if (event.touches.length === 2 && onPicture(event.target)) {
        begin = { t: performance.now(), points: [...event.touches].map((touch) => ({ x: touch.clientX, y: touch.clientY })) };
        moved = false;
      } else if (event.touches.length > 2) {
        begin = null;
      }
    }, { passive: true });
    window.addEventListener('touchmove', (event) => {
      if (!begin) return;
      for (const touch of event.touches) {
        if (begin.points.every((point) => Math.hypot(point.x - touch.clientX, point.y - touch.clientY) > 12)) moved = true;
      }
    }, { passive: true });
    window.addEventListener('touchend', (event) => {
      if (!begin || event.touches.length > 0) return;
      const quick = performance.now() - begin.t < 260;
      begin = null;
      if (quick && !moved && window.matchMedia('(max-width: 760px)').matches && !document.body.classList.contains('sky-immersive')) this.host.up();
    }, { passive: true });
  }

  // ---- the list of worlds -------------------------------------------------------------------

  private openSheet(): void {
    navigator.vibrate?.(8);
    this.drawSheet();
    this.sheet.classList.remove('is-hidden');
    this.scrim.classList.remove('is-hidden');
    document.body.classList.add('world-sheet-open');
  }

  private closeSheet(): void {
    this.sheet.classList.add('is-hidden');
    this.scrim.classList.add('is-hidden');
    document.body.classList.remove('world-sheet-open');
  }

  private drawSheet(): void {
    const where = this.host.whereNow();
    const here: WorldId = where.spot === 'map' ? where.beside ?? 'system' : where.body;
    const planet = planetOf(where.spot === 'map' ? where.beside ?? this.lastWorld : where.body);
    const grip = el('div', 'ws-grip');
    const title = el('div', 'ws-title', 'Worlds');
    const grid = el('div', 'ws-grid');
    const tile = (id: WorldId): HTMLButtonElement => {
      const button = el('button', `ws-tile${id === here ? ' is-here' : ''}`);
      button.type = 'button';
      const name = id === 'system' ? 'Solar system' : BODIES[id].name;
      button.append(orb(id, 'large'), el('span', 'ws-name', name));
      button.setAttribute('aria-label', name);
      button.addEventListener('click', () => {
        this.closeSheet();
        if (id === 'system') this.host.whole();
        else if (id === here) this.host.go(id); // where you are: its usual view back
        else this.host.enter(id); // a choice in the list goes all the way in, not just up to the dot
      });
      return button;
    };
    grid.append(tile('system'), ...ORDER.map(tile));
    const parts: HTMLElement[] = [grip, title, grid];
    const moons = planet === 'earth' ? [] : BODY_LIST.filter((body) => body.parent === planet && body.visitable).map((body) => body.id);
    if (moons.length > 0) {
      parts.push(el('div', 'ws-title is-sub', `Moons of ${BODIES[planet].name}`));
      const row = el('div', 'ws-grid');
      row.append(...moons.map(tile));
      parts.push(row);
    }
    this.sheet.replaceChildren(...parts);
    // Swiped down from anywhere on it (it does not scroll): closed.
    let y0: number | null = null;
    this.sheet.onpointerdown = (event) => (y0 = event.clientY);
    this.sheet.onpointermove = (event) => {
      if (y0 === null) return;
      const dy = Math.max(0, event.clientY - y0);
      this.sheet.style.transform = dy > 4 ? `translateY(${dy}px)` : '';
    };
    this.sheet.onpointerup = this.sheet.onpointercancel = (event) => {
      const dy = y0 === null ? 0 : event.clientY - y0;
      y0 = null;
      this.sheet.style.transform = '';
      if (dy > 70) this.closeSheet();
    };
  }
}
