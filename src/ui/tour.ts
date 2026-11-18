/**
 * The first-visit tour: a handful of small "coach mark" cards that walk a new visitor
 * round the screen. Each step may point at one element (a ring is drawn round it and the
 * card sits beside it) and may do something in the app — select the Space Station, open a
 * panel — through the `TourActions` it was given. It never blocks the app: only the card
 * itself takes clicks, and it can be skipped at any moment (the button, or Esc).
 */

import './tour.css';

export interface TourActions {
  selectByName(name: string): void; // e.g. 'ISS (ZARYA)': selects it and flies the camera there
  deselect(): void;
  openPanel(name: 'objects' | 'layers' | 'conj' | 'settings' | null): void;
  setMonitor(on: boolean): void; // close-approach monitor on/off
  preset(which: 1 | 2 | 3): void; // whole Earth / low orbit / GEO ring
  locate(): void; // asks the browser for the user's location and marks it on the globe
  openHowTo(): void; // opens the "How it works" page
}

type PanelName = 'objects' | 'layers' | 'conj' | 'settings' | null;

interface Step {
  title: string;
  body: string;
  /** CSS selector of the element this step points at (omit to centre the card). */
  target?: string;
  /** Label of the Next button, when "Next" is not right. */
  next?: string;
  /** An optional extra button inside the card. */
  extra?: { label: string; run: () => void };
  enter?: () => void;
  leave?: () => void;
}

const SEEN_KEY = 'apsis.tour.seen';
const TOUR_OBJECT = 'ISS (ZARYA)';
const GAP = 14; // px between the highlighted element and the card
const EDGE = 12; // px kept clear at the screen edges

export class Tour {
  private readonly actions: TourActions;
  private readonly steps: Step[];
  private root: HTMLDivElement | null = null;
  private ring!: HTMLDivElement;
  private card!: HTMLElement;
  private count!: HTMLElement;
  private title!: HTMLElement;
  private body!: HTMLElement;
  private extra!: HTMLButtonElement;
  private back!: HTMLButtonElement;
  private next!: HTMLButtonElement;
  private index = 0;
  private running = false;
  private ticker = 0;

  // What the tour has asked the app to do so far, so it never asks twice.
  private objectSelected = false;
  private monitorOn = false;
  private panel: PanelName | undefined = undefined; // undefined = not touched yet
  private openedTimebar = false;

  private readonly onKey = (event: KeyboardEvent) => this.handleKey(event);
  private readonly onResize = () => this.place();

  constructor(actions: TourActions) {
    this.actions = actions;
    this.steps = [
      {
        title: 'Welcome to Apsis',
        body: 'Every dot on the globe is a real object in orbit, placed from published tracking data and moving in real time. This short tour shows where things are.',
        next: 'Start tour',
      },
      {
        title: 'The globe',
        body: 'Drag to turn the Earth and scroll to zoom. Right-drag pans. Left alone, the view drifts slowly round the planet.',
        enter: () => {
          this.ensureDeselected();
          this.ensurePanel(null);
          this.actions.preset(1);
        },
      },
      {
        title: 'Find anything',
        body: 'Search by name or catalogue number, or just click a dot. The tour has picked the International Space Station for you.',
        target: '.search',
        enter: () => {
          this.ensurePanel(null);
          this.ensureSelected();
        },
      },
      {
        title: 'The inspector',
        body: 'Live altitude and speed, the orbit, upcoming passes and the catalogue record. The camera is now locked on: dragging turns the view around the object.',
        target: '#inspector',
        enter: () => this.ensureSelected(),
      },
      {
        title: 'Time',
        body: 'Pause, speed up or run time backwards, and drag the timeline to move up to twelve hours either way. Click the clock to type a date.',
        target: '.timebar',
        enter: () => this.holdTimebar(true),
        leave: () => this.holdTimebar(false),
      },
      {
        title: 'Close approaches',
        body: 'The monitor checks every object against all the others about once a second. Click a pair in the list to watch both spacecraft pass each other.',
        target: '#panel-conj',
        enter: () => {
          this.ensureDeselected();
          this.ensureMonitor();
          this.ensurePanel('conj');
        },
      },
      {
        title: 'Layers and views',
        body: 'Switch on borders, ground tracks, planets and more. The three buttons at the foot of the rail jump to the whole Earth, low orbit and the geostationary ring.',
        target: '#panel-layers',
        enter: () => this.ensurePanel('layers'),
      },
      {
        title: 'Your place on the map',
        body: 'Share your location and it is marked on the globe, and passes are worked out for where you are. This is optional, and nothing leaves your browser.',
        target: '#locate-top',
        extra: { label: 'Show where I am', run: () => this.actions.locate() },
        enter: () => this.ensurePanel(null),
      },
      {
        title: 'That is the tour',
        body: '“About” opens the home page: everything Apsis can do, and how the close-approach screening is done. Press ? at any time for all the controls.',
        target: '#landing-open',
        next: 'Finish',
        extra: {
          label: 'Read how it works',
          run: () => {
            this.stop();
            this.actions.openHowTo();
          },
        },
        enter: () => this.ensurePanel(null),
      },
    ];
  }

  /** Has this browser already been through (or skipped) the tour? */
  static seen(): boolean {
    try {
      return localStorage.getItem(SEEN_KEY) === '1';
    } catch {
      return false; // storage unavailable: the tour simply offers itself again next time
    }
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    if (!this.root) this.build();
    this.running = true;
    this.objectSelected = this.monitorOn = false;
    this.panel = undefined;
    this.index = 0;
    this.root!.classList.remove('is-hidden');
    window.addEventListener('keydown', this.onKey, true); // capture: ahead of the app's own shortcuts
    window.addEventListener('resize', this.onResize);
    this.ticker = window.setInterval(() => this.tick(), 300); // panels slide in, the camera flies: keep up
    this.show(0, true);
  }

  /** End the tour (finished or skipped), remember that it was seen, and tidy up. */
  /** Called after the tour has ended (finished or skipped). */
  onStop: (() => void) | null = null;

  stop(): void {
    if (!this.running) return;
    this.steps[this.index].leave?.();
    this.running = false;
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('resize', this.onResize);
    clearInterval(this.ticker);
    this.root?.classList.add('is-hidden');
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch { /* storage unavailable */ }
    this.actions.openPanel(null);
    this.panel = undefined;
    this.onStop?.();
  }

  // ---------------------------------------------------------------- app state the tour sets up

  private ensureSelected(): void {
    if (this.objectSelected) return;
    this.objectSelected = true;
    this.actions.selectByName(TOUR_OBJECT);
  }

  private ensureDeselected(): void {
    if (!this.objectSelected) return;
    this.objectSelected = false;
    this.actions.deselect();
  }

  private ensureMonitor(): void {
    if (this.monitorOn) return;
    this.monitorOn = true;
    this.actions.setMonitor(true);
  }

  private ensurePanel(name: PanelName): void {
    if (this.panel === name) return;
    if (this.panel === undefined && name === null) {
      this.panel = null; // nothing opened by the tour yet: leave the visitor's own panel alone
      return;
    }
    this.panel = name;
    this.actions.openPanel(name);
  }

  /** The time bar rests as a small pill; keep it open while the tour is talking about it. */
  private holdTimebar(open: boolean): void {
    const bar = document.querySelector<HTMLElement>('.timebar');
    if (!bar) return;
    if (open) {
      if (!bar.classList.contains('is-open')) {
        bar.classList.add('is-open');
        this.openedTimebar = true;
      }
    } else if (this.openedTimebar) {
      this.openedTimebar = false;
      if (!bar.matches(':hover')) bar.classList.remove('is-open');
    }
  }

  // ---------------------------------------------------------------- steps

  private show(index: number, first = false): void {
    if (!first) this.steps[this.index].leave?.();
    this.index = index;
    const step = this.steps[index];
    step.enter?.();

    this.count.textContent = `${index + 1} of ${this.steps.length}`;
    this.title.textContent = step.title;
    this.body.textContent = step.body;
    this.extra.classList.toggle('is-hidden', !step.extra);
    this.extra.textContent = step.extra?.label ?? '';
    this.back.classList.toggle('is-hidden', index === 0);
    this.next.textContent = step.next ?? 'Next';

    // Replay the short entrance animation, then put everything in place.
    this.card.classList.remove('is-in');
    void this.card.offsetWidth;
    this.card.classList.add('is-in');
    this.place();
    this.next.focus({ preventScroll: true });
  }

  private go(delta: number): void {
    const to = this.index + delta;
    if (to < 0) return;
    if (to >= this.steps.length) return this.stop();
    this.show(to);
  }

  private tick(): void {
    if (!this.running) return;
    if (this.steps[this.index].target === '.timebar') this.holdTimebar(true); // the bar closes itself after a hover
    this.place();
  }

  private handleKey(event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const el = event.target as HTMLElement | null;
    if (el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el.isContentEditable)) return; // typing in a field
    let handled = true;
    if (event.key === 'Escape') this.stop();
    else if (event.key === 'ArrowRight') this.go(1);
    else if (event.key === 'ArrowLeft') this.go(-1);
    else handled = false;
    if (handled) {
      event.preventDefault();
      event.stopImmediatePropagation(); // the app's shortcuts must not also fire
    }
  }

  // ---------------------------------------------------------------- layout

  /** The element the current step points at, if it is on screen. */
  private targetRect(): DOMRect | null {
    const selector = this.steps[this.index].target;
    if (!selector) return null;
    const el = document.querySelector<HTMLElement>(selector);
    if (!el || el.getClientRects().length === 0) return null; // missing, or display: none
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    if (rect.right < 0 || rect.bottom < 0 || rect.left > window.innerWidth || rect.top > window.innerHeight) return null;
    return rect;
  }

  /** Draw the ring round the target and put the card beside it (or centre the card). */
  private place(): void {
    if (!this.running || !this.root) return;
    const rect = this.targetRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    this.root.classList.toggle('is-centred', !rect);

    if (rect) {
      const pad = 5;
      const left = Math.max(2, rect.left - pad), top = Math.max(2, rect.top - pad);
      this.ring.style.left = `${left}px`;
      this.ring.style.top = `${top}px`;
      this.ring.style.width = `${Math.min(vw - 2, rect.right + pad) - left}px`;
      this.ring.style.height = `${Math.min(vh - 2, rect.bottom + pad) - top}px`;
    }

    // Phones: the stylesheet docks the card to the bottom edge; no coordinates needed.
    if (window.matchMedia('(max-width: 760px)').matches) {
      this.card.style.left = this.card.style.top = '';
      return;
    }

    const cw = this.card.offsetWidth, ch = this.card.offsetHeight;
    let x = (vw - cw) / 2, y = (vh - ch) / 2;
    if (rect) {
      const room = {
        right: vw - rect.right - GAP - EDGE,
        left: rect.left - GAP - EDGE,
        below: vh - rect.bottom - GAP - EDGE,
        above: rect.top - GAP - EDGE,
      };
      const midX = rect.left + rect.width / 2 - cw / 2, midY = rect.top + rect.height / 2 - ch / 2;
      // A wide, flat target (a bar) reads best with the card above or below it; a tall one, beside it.
      const order: (keyof typeof room)[] = rect.width > rect.height * 2.5
        ? ['below', 'above', 'right', 'left']
        : ['right', 'left', 'below', 'above'];
      const side = order.find((s) => (s === 'right' || s === 'left' ? room[s] >= cw : room[s] >= ch));
      if (side === 'right') [x, y] = [rect.right + GAP, midY];
      else if (side === 'left') [x, y] = [rect.left - GAP - cw, midY];
      else if (side === 'below') [x, y] = [midX, rect.bottom + GAP];
      else if (side === 'above') [x, y] = [midX, rect.top - GAP - ch];
      // no side has room (the target fills the screen): the card stays in the centre
    }
    this.card.style.left = `${Math.round(Math.min(Math.max(EDGE, x), vw - cw - EDGE))}px`;
    this.card.style.top = `${Math.round(Math.min(Math.max(EDGE, y), vh - ch - EDGE))}px`;
  }

  // ---------------------------------------------------------------- DOM

  private build(): void {
    const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] => {
      const el = document.createElement(tag);
      el.className = className;
      if (text) el.textContent = text;
      return el;
    };

    const root = make('div', 'tour is-hidden');
    root.id = 'tour';
    this.ring = make('div', 'tour-ring');
    this.card = make('section', 'tour-card');
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-label', 'Guided tour');

    const head = make('header', 'tour-head');
    this.count = make('span', 'tour-count');
    const skip = make('button', 'link tour-skip', 'Skip tour');
    skip.type = 'button';
    skip.title = 'Skip the tour (Esc)';
    skip.addEventListener('click', () => this.stop());
    head.append(this.count, skip);

    this.title = make('h2', 'tour-title');
    this.body = make('p', 'tour-body');
    this.extra = make('button', 'btn tour-extra is-hidden');
    this.extra.type = 'button';
    this.extra.addEventListener('click', () => this.steps[this.index].extra?.run());

    const foot = make('footer', 'tour-foot');
    this.back = make('button', 'btn tour-back', 'Back');
    this.back.type = 'button';
    this.back.addEventListener('click', () => this.go(-1));
    this.next = make('button', 'btn btn-primary tour-next', 'Next');
    this.next.type = 'button';
    this.next.addEventListener('click', () => this.go(1));
    foot.append(this.back, this.next);

    this.card.append(head, this.title, this.body, this.extra, foot);
    root.append(make('div', 'tour-dim'), this.ring, this.card);
    document.body.append(root);
    this.root = root;
  }
}
