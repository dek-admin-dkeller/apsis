/**
 * Autoplay for the solar system: a hands-free trip from the Sun outwards, world by world.
 *
 * The Earth's autopilot (ui/cinema.ts) shows the tracker; this is the same idea for the rest
 * of the solar system, started from the same button (and the A key) whenever the visitor is
 * not in the tracker. It does nothing a visitor could not do by hand: every move is one of
 * the journeys `Places` already makes (out to the solar system, up to a dot, in to a world),
 * so it keeps every rule those follow (no cut, the same sky, nothing built during a move).
 *
 * What it adds is the order, the waiting, and a caption per world, drawn with the autopilot's
 * own caption style. The interface is hidden while it plays; any real key, click, touch or
 * wheel turn stops it and leaves the visitor wherever it had got to, ready to look around.
 */

import { BODIES } from '../space/bodies.ts';
import type { BodyId } from '../space/types.ts';

export interface SpaceTourHost {
  /** Go to a world (the Earth: the tracker) and resolve once there; nothing happens while another move runs. */
  visit(body: BodyId): Promise<void>;
  /** Out to the whole solar system, and resolve once there. */
  system(): Promise<void>;
  /** A move is under way (a journey cannot be interrupted; the tour waits for it). */
  moving(): boolean;
  /** One of the views of the place the camera is at ('moons' shows a planet's family). */
  view(name: 'whole' | 'moons'): void;
  hideInterface(on: boolean): void;
  /** The tour started or stopped (the button shows it as pressed). */
  onChange(): void;
}

/** The stops, in order, and how long to stay at each (seconds); `moons` also steps back to show the family. */
const STOPS: { body: BodyId; hold: number; moons?: boolean }[] = [
  { body: 'sun', hold: 8 },
  { body: 'mercury', hold: 8 },
  { body: 'venus', hold: 8 },
  { body: 'earth', hold: 9 },
  { body: 'moon', hold: 8 },
  { body: 'mars', hold: 9 },
  { body: 'jupiter', hold: 7, moons: true },
  { body: 'europa', hold: 8 },
  { body: 'saturn', hold: 7, moons: true },
  { body: 'titan', hold: 8 },
  { body: 'uranus', hold: 8 },
  { body: 'neptune', hold: 8 },
  { body: 'pluto', hold: 8 },
];

const OPENING = {
  title: 'The solar system',
  text: 'Every planet where it is right now, on its true orbit. Distances from the Sun are squeezed so that all of them fit; directions and lighting are real.',
};

/** Keys, clicks and scrolls in the first moment after starting are the press that started it. */
const GRACE_MS = 600;

const wait = (seconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

export class SpaceTour {
  private readonly host: SpaceTourHost;
  private playing = false;
  private run = 0; // which play() the running loop belongs to: a stop and a quick restart must not leave two loops
  private startedAt = 0;
  private root: HTMLElement | null = null;
  private caption: HTMLElement | null = null;
  private title: HTMLElement | null = null;
  private text: HTMLElement | null = null;
  private hint: HTMLElement | null = null;

  constructor(host: SpaceTourHost) {
    this.host = host;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  toggle(): void {
    if (this.playing) this.stop();
    else this.play();
  }

  play(): void {
    if (this.playing) return;
    this.build();
    this.playing = true;
    this.startedAt = performance.now();
    this.host.hideInterface(true);
    this.root!.classList.add('is-playing');
    this.hint!.classList.add('is-on');
    window.setTimeout(() => this.hint?.classList.remove('is-on'), 5000);
    window.addEventListener('pointerdown', this.onInput, true);
    window.addEventListener('wheel', this.onInput, { capture: true, passive: true });
    window.addEventListener('keydown', this.onInput, true);
    this.host.onChange();
    void this.loop(++this.run);
  }

  /** Stop where it is: the visitor stays at whatever world the tour had reached. */
  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    window.removeEventListener('pointerdown', this.onInput, true);
    window.removeEventListener('wheel', this.onInput, true);
    window.removeEventListener('keydown', this.onInput, true);
    this.host.hideInterface(false);
    this.root?.classList.remove('is-playing');
    this.caption?.classList.remove('is-on');
    this.hint?.classList.remove('is-on');
    this.host.onChange();
  }

  private readonly onInput = (event: Event): void => {
    if (!this.playing || !event.isTrusted) return;
    if (performance.now() - this.startedAt < GRACE_MS) return;
    if (event.type === 'keydown') {
      // The key only stops the tour; it must not also fire one of the app's shortcuts.
      event.stopImmediatePropagation();
      event.preventDefault();
    }
    this.stop();
  };

  private async loop(run: number): Promise<void> {
    const alive = () => this.playing && this.run === run;
    // A journey already under way (the visitor pressed play mid-move) is let finish first.
    const settle = async () => {
      while (alive() && this.host.moving()) await wait(0.2);
    };
    while (alive()) {
      await settle();
      if (!alive()) return;
      this.say(null);
      await this.host.system();
      if (!alive()) return;
      this.say(OPENING.title, OPENING.text);
      await wait(7);
      for (const stop of STOPS) {
        await settle();
        if (!alive()) return;
        this.say(null);
        await this.host.visit(stop.body);
        if (!alive()) return;
        const body = BODIES[stop.body];
        this.say(body.name, body.blurb);
        await wait(stop.hold);
        if (stop.moons && alive()) {
          this.host.view('moons');
          await wait(6);
        }
        if (!alive()) return;
      }
    }
  }

  /** Show a caption, or (null) fade the one on screen out while the camera travels. */
  private say(title: string | null, text = ''): void {
    if (!this.caption || !this.title || !this.text) return;
    if (title === null) {
      this.caption.classList.remove('is-on');
      return;
    }
    this.title.textContent = title;
    this.text.textContent = text;
    this.caption.classList.add('is-on');
  }

  /** The autopilot's caption and hint (ui/cinema.css), in a layer of their own. */
  private build(): void {
    if (this.root) return;
    const root = document.createElement('div');
    root.id = 'space-tour';
    root.setAttribute('aria-live', 'polite');
    const caption = document.createElement('div');
    caption.className = 'cinema-caption';
    const title = document.createElement('p');
    title.className = 'cinema-title';
    const text = document.createElement('p');
    text.className = 'cinema-text';
    caption.append(title, text);
    const hint = document.createElement('div');
    hint.className = 'cinema-hint';
    hint.textContent = 'Autoplay — press any key to stop';
    root.append(caption, hint);
    document.body.append(root);
    this.root = root;
    this.caption = caption;
    this.title = title;
    this.text = text;
    this.hint = hint;
  }
}
