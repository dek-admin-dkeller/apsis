/**
 * Phones only: a strip of worlds along the bottom, above the tab bar, away from the Earth's
 * tracker (on the solar system and at every other world).
 *
 * Moving between worlds by pinching past the edge of a view and tapping small dots was hard on
 * a phone; the owner asked for something "modern, fluid, user friendly and mobile optimised",
 * for phones only (on a computer the picture stays the only menu: see "Places" in CLAUDE.md).
 *
 * One row of round chips that scrolls sideways with momentum and snaps: the solar system, the
 * Sun, each planet, the Moon and Pluto, and the moons of the world you are at or beside (they
 * appear right after their planet). Each chip is a little globe made from that world's own small
 * map. Where you are is ringed in amber and slid to the middle; on the solar system the world the
 * camera is beside is ringed in blue and says "Tap to go in". A tap does what a tap on its dot
 * does (Places.goWorld): up to the world, then in.
 */

import './worldStrip.css';
import { BODIES, BODY_LIST } from '../space/bodies.ts';
import { IMAGERY } from '../space/imagery.ts';
import type { BodyId } from '../space/types.ts';

type WorldId = BodyId | 'system';

export interface WorldStripHost {
  /** Where the visitor is: the kind of scene, its world, and on the solar system the world the camera is beside. */
  whereNow(): { spot: 'tracker' | 'place' | 'map'; body: BodyId; beside: BodyId | null };
  go(id: WorldId): void;
}

/** The worlds always on the strip, in order outwards. */
const MAIN: BodyId[] = ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

/** A world's small map (the copy the solar system draws it from), if it has one. */
function smallMap(id: BodyId): string | null {
  const base = IMAGERY[id]?.base;
  return base ? base.replace(/\.(jpg|webp|png)$/, '_s.$1') : null;
}

export class WorldStrip {
  private readonly root = el('nav', 'world-strip');
  private readonly row = el('div', 'ws-row');
  private readonly host: WorldStripHost;
  private readonly chips = new Map<WorldId, HTMLButtonElement>();
  private shownKey = '';
  private touching = false;
  private lastTouch = 0;

  constructor(host: WorldStripHost) {
    this.host = host;
    this.root.id = 'm-worlds';
    this.root.setAttribute('aria-label', 'Worlds');
    this.root.append(this.row);
    document.body.append(this.root);
    // While a finger is on the strip it is the visitor's: never slide it under them.
    this.row.addEventListener('touchstart', () => (this.touching = true), { passive: true });
    this.row.addEventListener('touchend', () => {
      this.touching = false;
      this.lastTouch = performance.now();
    }, { passive: true });
  }

  /** Redraw for where the visitor is now (cheap when nothing changed). */
  update(): void {
    const where = this.host.whereNow();
    if (where.spot === 'tracker') return;
    const focusWorld = where.beside ?? where.body;
    const ids = this.listFor(focusWorld);
    const key = `${ids.join(',')}|${where.spot}|${where.body}|${where.beside ?? ''}`;
    if (key === this.shownKey) return;
    const sameList = this.shownKey.startsWith(`${ids.join(',')}|`);
    this.shownKey = key;
    if (!sameList) this.build(ids);
    const here: WorldId = where.spot === 'map' ? 'system' : where.body;
    for (const [id, chip] of this.chips) {
      const isHere = id === here;
      const isBeside = where.spot === 'map' && id === where.beside;
      chip.classList.toggle('is-here', isHere);
      chip.classList.toggle('is-beside', isBeside);
      chip.setAttribute('aria-current', isHere ? 'true' : 'false');
      const hint = chip.querySelector('.ws-hint');
      if (hint) hint.textContent = isBeside ? 'Tap to go in' : '';
    }
    // Slide the world in question to the middle — unless a finger is (or just was) on the strip.
    const target = this.chips.get(where.beside ?? here);
    if (target && !this.touching && performance.now() - this.lastTouch > 1500) {
      const left = target.offsetLeft - (this.row.clientWidth - target.offsetWidth) / 2;
      this.row.scrollTo({ left, behavior: sameList ? 'smooth' : 'auto' });
    }
  }

  /** The solar system, the main worlds, and the moons of the world in question right after their planet. */
  private listFor(world: BodyId): WorldId[] {
    const planet = BODIES[world].kind === 'moon' ? BODIES[world].parent! : world;
    const moons = planet === 'earth' ? [] : BODY_LIST.filter((body) => body.parent === planet && body.visitable).map((body) => body.id);
    const ids: WorldId[] = ['system'];
    for (const id of MAIN) {
      ids.push(id);
      if (id === planet) ids.push(...moons);
    }
    return ids;
  }

  private build(ids: WorldId[]): void {
    this.chips.clear();
    this.row.replaceChildren(...ids.map((id) => {
      const chip = el('button', `ws-chip${id !== 'system' && BODIES[id].kind === 'moon' ? ' is-moon' : ''}`);
      chip.type = 'button';
      const orb = el('span', 'ws-orb');
      if (id === 'system') {
        orb.classList.add('is-system');
        orb.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="2.2"/><ellipse cx="10" cy="10" rx="8.2" ry="3.4"/><ellipse cx="10" cy="10" rx="5" ry="2"/></svg>';
      } else {
        const [r, g, b] = BODIES[id].color.map((c) => Math.round(c * 255));
        orb.style.setProperty('--orb', `rgb(${r}, ${g}, ${b})`);
        const map = smallMap(id);
        if (map) orb.style.setProperty('--map', `url("${map}")`);
        if (id === 'sun') orb.classList.add('is-sun');
        if (id === 'saturn') orb.classList.add('has-ring');
      }
      const name = id === 'system' ? 'Solar system' : BODIES[id].name;
      chip.append(orb, el('span', 'ws-name', name), el('span', 'ws-hint'));
      chip.setAttribute('aria-label', name);
      chip.addEventListener('click', () => {
        navigator.vibrate?.(8);
        this.host.go(id);
      });
      this.chips.set(id, chip);
      return chip;
    }));
  }
}
