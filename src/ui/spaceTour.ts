/**
 * The guided overview: a hands-free tour of what Apsis is and what it can show, from the
 * Earth's tracked objects out to the solar system, ending on the question the "How it works"
 * slides answer (ui/howSlides.ts).
 *
 * It replaced a Sun-to-Pluto tour of the worlds (the owner's call, for presenting the project):
 * the stops are now what Apsis DOES —
 *   1. the Earth with every tracked object;
 *   2. one real piece of debris, selected, its card open (a fragment of Cosmos 2251, which hit
 *      Iridium 33 in 2009);
 *   3. the geostationary ring;
 *   4. out to the solar system, where the same screening runs;
 *   5. the Mars Reconnaissance Orbiter and 6. the Webb telescope, each with its card;
 *   7. the question: how do you find which objects are close without checking every pair?
 * Every number in a caption is read from the data loaded at that moment (`OverviewHost.facts`).
 *
 * It does nothing a visitor could not do by hand: every move is a journey `Places` already
 * makes, or a selection, or one of the Earth's views. The interface stays on screen (the cards
 * are the point of several stops). For presenting: → goes on to the next stop at once, ← back
 * to the one before; any other key, a click, a touch or a wheel turn stops it where it is.
 * The Earth's own autopilot (ui/cinema.ts) is unchanged.
 */

export interface OverviewFacts {
  objects: number;
  /** Fragments of Cosmos 2251 in the catalogue, and the one the tour shows (NORAD number). */
  cosmosDebris: number;
  cosmosPick: number | null;
  geo: number;
}

export interface SpaceTourHost {
  /** Into the Earth's tracker (from wherever the visitor is) and resolve once there. */
  earth(): Promise<void>;
  /** Out to the whole solar system, and resolve once there. */
  system(): Promise<void>;
  /** A move is under way (a journey cannot be interrupted; the tour waits for it). */
  moving(): boolean;
  /** One of the Earth's views ('earth' whole, 'geo' the geostationary ring). */
  earthView(name: 'earth' | 'geo'): void;
  /** Select a catalogue object by NORAD number (its card opens); null: nothing selected. */
  select(noradId: number | null): void;
  /** Go and look at a craft beyond Earth orbit by its id in deep.json (its card opens); false if unknown. */
  craft(id: string): boolean;
  facts(): OverviewFacts;
  /** Close any open panel or menu, so the picture is clear. */
  clear(): void;
  /** The tour started or stopped (the button shows it as pressed). */
  onChange(): void;
}

interface Stop {
  /** Get there (camera moves, selections). Resolves when the picture is ready to talk over. */
  go: (host: SpaceTourHost) => Promise<void>;
  title: (facts: OverviewFacts) => string;
  text: (facts: OverviewFacts) => string;
  /** Seconds to stay; Infinity for the last stop (it stays until the visitor moves on). */
  hold: number;
}

const fmt = (n: number): string => n.toLocaleString('en-US');
const wait = (seconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

/** Wait until no journey is running (a craft's trip is several moves in a row). */
async function settle(host: SpaceTourHost): Promise<void> {
  await wait(0.15);
  while (host.moving()) await wait(0.2);
}

const STOPS: Stop[] = [
  {
    go: async (host) => {
      await host.earth();
      host.select(null);
      host.earthView('earth');
      await wait(1.6);
    },
    title: () => 'Apsis',
    text: (f) => `Every tracked object in Earth orbit — ${fmt(f.objects)} right now — placed from live orbital data and screened continuously for close approaches.`,
    hold: 11,
  },
  {
    go: async (host) => {
      host.select(host.facts().cosmosPick);
      await wait(2.4);
    },
    title: () => 'One piece of debris',
    text: (f) => `A fragment of Cosmos 2251, a dead satellite that collided with Iridium 33 in 2009. Apsis still tracks ${fmt(f.cosmosDebris)} pieces of it, alongside active satellites and spent rocket stages. Its card gives its name, catalogue number and orbit.`,
    hold: 13,
  },
  {
    go: async (host) => {
      host.select(null);
      host.earthView('geo');
      await wait(2.6);
    },
    title: () => 'The geostationary ring',
    text: (f) => `${fmt(f.geo)} objects 35,786 km up, circling once a day, exactly as fast as the Earth turns: each one stays over the same spot. Each dot is one of them, mostly communications and weather satellites.`,
    hold: 12,
  },
  {
    go: async (host) => {
      await host.system();
      await wait(1);
    },
    title: () => 'Beyond Earth orbit',
    text: () => 'Every planet where it is today. The same close-approach screening runs here too: at every world, and between the planets.',
    hold: 10,
  },
  {
    go: async (host) => {
      if (host.craft('mro')) await settle(host);
      await wait(1.2);
    },
    title: () => 'Mars Reconnaissance Orbiter',
    text: () => 'Mapping Mars since 2006 and relaying the rovers’ data home. Apsis places it from NASA’s own trajectory data; its card shows how far away it is and how long its signal takes to reach us.',
    hold: 12,
  },
  {
    go: async (host) => {
      if (host.craft('webb')) await settle(host);
      await wait(1.2);
    },
    title: () => 'James Webb Space Telescope',
    text: () => 'An infrared telescope 1.5 million km beyond the Earth. When one of NASA’s Deep Space Network dishes is talking to it, Apsis shows the link live.',
    hold: 12,
  },
  {
    go: async (host) => {
      await host.system();
      await wait(1);
    },
    title: () => 'Which of them are close?',
    text: (f) => `${fmt(f.objects)} objects make ${fmt((f.objects * (f.objects - 1)) / 2)} possible pairs. How do you find the close ones without measuring every pair?`,
    hold: Infinity,
  },
];

/** Keys, clicks and scrolls in the first moment after starting are the press that started it. */
const GRACE_MS = 600;

export class SpaceTour {
  private readonly host: SpaceTourHost;
  private playing = false;
  private run = 0; // which play() the running loop belongs to: a stop and a quick restart must not leave two loops
  private startedAt = 0;
  private index = 0;
  private jump: ((to: number) => void) | null = null; // ← / →: end the current hold and go to another stop
  private root: HTMLElement | null = null;
  private caption: HTMLElement | null = null;
  private title: HTMLElement | null = null;
  private text: HTMLElement | null = null;
  private count: HTMLElement | null = null;
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
    this.index = 0;
    this.host.clear();
    this.root!.classList.add('is-playing');
    this.hint!.classList.add('is-on');
    window.setTimeout(() => this.hint?.classList.remove('is-on'), 6000);
    window.addEventListener('pointerdown', this.onInput, true);
    window.addEventListener('wheel', this.onInput, { capture: true, passive: true });
    window.addEventListener('keydown', this.onInput, true);
    this.host.onChange();
    void this.loop(++this.run);
  }

  /** Stop where it is: the visitor stays wherever the tour had reached, free to look around. */
  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    this.jump?.(-1);
    window.removeEventListener('pointerdown', this.onInput, true);
    window.removeEventListener('wheel', this.onInput, true);
    window.removeEventListener('keydown', this.onInput, true);
    this.root?.classList.remove('is-playing');
    this.caption?.classList.remove('is-on');
    this.hint?.classList.remove('is-on');
    this.host.onChange();
  }

  private readonly onInput = (event: Event): void => {
    if (!this.playing || !event.isTrusted) return;
    if (performance.now() - this.startedAt < GRACE_MS) return;
    if (event.type === 'keydown') {
      const key = (event as KeyboardEvent).key;
      // The key belongs to the tour; it must not also fire one of the app's shortcuts.
      event.stopImmediatePropagation();
      event.preventDefault();
      if (key === 'ArrowRight' || key === 'ArrowLeft') {
        const to = this.index + (key === 'ArrowRight' ? 1 : -1);
        if (to >= 0 && to < STOPS.length) this.jump?.(to);
        return;
      }
    }
    this.stop();
  };

  private async loop(run: number): Promise<void> {
    const alive = () => this.playing && this.run === run;
    while (alive() && this.host.moving()) await wait(0.2); // a journey already under way finishes first
    while (alive() && this.index < STOPS.length) {
      const stop = STOPS[this.index];
      this.say(null);
      await stop.go(this.host);
      if (!alive()) return;
      const facts = this.host.facts();
      this.say(stop.title(facts), stop.text(facts));
      // Hold, unless ← / → asks for another stop first.
      const next = await new Promise<number>((resolve) => {
        this.jump = resolve;
        if (Number.isFinite(stop.hold)) window.setTimeout(() => resolve(this.index + 1), stop.hold * 1000);
      });
      this.jump = null;
      if (!alive() || next < 0) return;
      this.index = next;
    }
  }

  /** Show a caption, or (null) fade the one on screen out while the camera travels. */
  private say(title: string | null, text = ''): void {
    if (!this.caption || !this.title || !this.text || !this.count) return;
    if (title === null) {
      this.caption.classList.remove('is-on');
      return;
    }
    this.title.textContent = title;
    this.text.textContent = text;
    this.count.textContent = `${this.index + 1} / ${STOPS.length}`;
    this.caption.classList.add('is-on');
  }

  /** The autopilot's caption and hint (ui/cinema.css), in a layer of their own. */
  private build(): void {
    if (this.root) return;
    const root = document.createElement('div');
    root.id = 'space-tour';
    root.setAttribute('aria-live', 'polite');
    const caption = document.createElement('div');
    caption.className = 'cinema-caption overview-caption';
    const count = document.createElement('p');
    count.className = 'overview-count';
    const title = document.createElement('p');
    title.className = 'cinema-title';
    const text = document.createElement('p');
    text.className = 'cinema-text';
    caption.append(count, title, text);
    const hint = document.createElement('div');
    hint.className = 'cinema-hint';
    hint.textContent = 'Guided overview — → next stop · ← back · any other key stops';
    root.append(caption, hint);
    document.body.append(root);
    this.root = root;
    this.caption = caption;
    this.title = title;
    this.text = text;
    this.count = count;
    this.hint = hint;
  }
}
