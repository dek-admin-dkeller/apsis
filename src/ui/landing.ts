/**
 * The home page: what a visitor sees first, and where the tracker is explained.
 *
 * It is built to SHOW the tracker rather than describe it:
 *   - the opening screen has the live globe itself behind the headline. The tracker is
 *     starting up underneath: as soon as it has a globe to draw (`goLive`) the page's backdrop
 *     fades and the real thing shows through, and the objects appear on it when the catalogue
 *     has loaded (`ready`). Until then, and on a machine that cannot draw it, the headline
 *     stands alone;
 *   - a showcase of real screens that changes by itself like a slideshow (SHOTS in
 *     featureList.ts; retaken with `npm run shots`);
 *   - a live drawing of the search that runs the project's own hash table (hashDemo.ts);
 *   - a row of every one of the tracker's 3D models (scrolled sideways), drawn by the same code that draws them in
 *     orbit, and a button to the catalogue of all of them;
 *   - the complete list of features (FEATURES in featureList.ts — the one place to keep it
 *     current), as a compact index;
 *   - a small drawing that explains the name.
 *
 * The bar at the top sits outside the element that scrolls (#landing-scroll), so nothing the
 * visitor does to the page — the elastic bounce past its top included — can move the bar.
 *
 * The page is an opaque layer over the tracker, static markup in index.html so it is painted
 * before any script has run. "Open the tracker" puts it away; "About" in the tracker's top
 * bar brings it back. On arrival it is skipped for share links and when the "Welcome page"
 * setting is off — index.html decides that before the first paint by putting the class
 * `no-landing` on <html>.
 */

import './landing.css';
import { KIND_LABEL, type ModelKind } from '../data/describe.ts';
import { kindGroups } from '../data/spacecraft.ts';
import { modelThumbnail } from '../render/satModels.ts';
import { $, fmtInt } from './dom.ts';
import { FEATURES, HOW, SHOTS, WHATS_NEW, type Shot } from './featureList.ts';
import { HowSlides } from './howSlides.ts';
import { HashDemo } from './hashDemo.ts';

export interface LandingHost {
  /** Open the full walkthrough (it is drawn over this page). */
  howItWorks(): void;
}

/** The first squares of the plate: six kinds that look nothing like one another; every other kind follows. */
const PLATE: ModelKind[] = ['iss', 'telescope', 'starlinkv2', 'falcon9', 'dragon', 'roadster'];

const SLIDE_HOLD_MS = 20000; // after the visitor chooses a screen themselves, how long the slideshow leaves it alone
const TOUCH_HOLD_MS = 4000; // … and after a finger has been on it

export class Landing {
  /** Resolves when the visitor first chooses to go in (immediately if the page was skipped on arrival). */
  readonly entered: Promise<void>;
  private readonly root = $('landing');
  private readonly scroller = $('landing-scroll'); // everything under the bar
  private visible: boolean;
  private firstEntry: (() => void) | null = null;
  private host: LandingHost | null = null;
  private readonly demo: HashDemo;
  private plateWanted = false; // the plate of models has scrolled near
  private plateDrawn = false;
  private readonly slots: Map<ModelKind, HTMLImageElement>; // the plate: one waiting picture per kind
  private lastScroll = 0; // performance.now() when the page last moved
  private touching = false; // a finger is on the page
  private live = false; // the globe is showing through the opening screen
  private loaded = false; // the tracker has everything: its renderer may be borrowed for the plate
  private syncSlides: () => void = () => undefined; // start or pause the slideshow to suit what is on screen

  constructor() {
    this.visible = !document.documentElement.classList.contains('no-landing');
    this.entered = this.visible ? new Promise((resolve) => (this.firstEntry = resolve)) : Promise.resolve();
    if (!this.visible) this.root.classList.add('is-away');
    document.body.classList.toggle('home-open', this.visible);

    this.drawShowcase();
    this.drawIndex();
    this.slots = this.layPlate();
    new HowSlides($('ld-slides'));
    this.demo = new HashDemo($<HTMLCanvasElement>('ld-demo-canvas'), {
      objects: $('ld-demo-n'), checks: $('ld-demo-checks'), pairs: $('ld-demo-pairs'), mode: $('ld-demo-mode'),
    });
    this.demo.setAllowed(this.visible);
    // The models are drawn by the tracker's own renderer, so only once it has loaded — and only
    // if the visitor scrolls towards them. (The margin is measured from the element that scrolls.)
    new IntersectionObserver((entries, observer) => {
      if (!entries[0].isIntersecting) return;
      observer.disconnect();
      this.plateWanted = true;
      this.drawPlate();
    }, { root: this.scroller, rootMargin: '900px' }).observe($('ld-plate')); // well before it is on screen

    for (const button of this.root.querySelectorAll<HTMLElement>('[data-ld-enter]')) button.addEventListener('click', () => this.enter());
    for (const link of this.root.querySelectorAll<HTMLElement>('[data-ld-jump]')) {
      link.addEventListener('click', () => $(link.dataset.ldJump!).scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
    $('landing-how').addEventListener('click', () => this.host?.howItWorks());
    // The bar is glass over the live globe only while the page is at its very top.
    this.scroller.addEventListener('scroll', () => {
      this.lastScroll = performance.now();
      this.root.classList.toggle('is-scrolled', this.scroller.scrollTop > 8);
    }, { passive: true });
    this.scroller.addEventListener('touchstart', () => (this.touching = true), { passive: true });
    for (const end of ['touchend', 'touchcancel']) this.scroller.addEventListener(end, () => (this.touching = false), { passive: true });
    // The bar is not inside the part that scrolls, so a wheel turned over it has to be passed on.
    this.root.querySelector<HTMLElement>('.ld-top')!.addEventListener('wheel', (event) => {
      this.scroller.scrollTop += event.deltaMode === 1 ? event.deltaY * 18 : event.deltaY; // mode 1 counts lines
    }, { passive: true });
    // Enter goes in — unless the key belongs to a button that has the focus (that button handles it).
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && this.visible && !(event.target as HTMLElement).closest('button, a, input')) this.enter();
    });
    if (this.visible) $('landing-enter').focus({ preventScroll: true });
  }

  setHost(host: LandingHost): void {
    this.host = host;
  }

  // ---- the showcase: one large real screen at a time, changing like a slideshow ---------------

  /**
   * The tabs over the product pictures, and the slideshow that moves through them.
   *
   * The timer is the progress line itself: a CSS animation on the active tab (landing.css,
   * `ld-tab-progress`), and its `animationend` is what moves on. So the line and the change
   * cannot drift apart, and pausing is one class. It runs only while the picture is on screen
   * and the page is visible; it pauses under a finger and while a tab has the keyboard focus,
   * but NOT under the mouse pointer (the picture fills the screen, so a resting pointer is
   * nearly always over it and the slideshow would never run: the owner's catch); a screen the visitor chose themselves is left alone for a good while;
   * and with "reduce motion" set it never runs at all.
   *
   * It never changes the page's length (see also the plate below). On a wide screen the tall
   * phone picture sits beside its words in the room the wide pictures take, and that room is
   * held while it shows. On a narrow screen it is far taller than the others, so there the
   * slideshow passes over it; its tab still shows it.
   */
  private drawShowcase(): void {
    const tabs = $('ld-tabs'), image = $<HTMLImageElement>('ld-shot'), text = $('ld-shot-text'), screen = $('ld-screen');
    const buttons: HTMLElement[] = [];
    const address = (k: number) => `./shots/${SHOTS[k].file}.webp`;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    const narrow = () => window.innerWidth <= 860; // where landing.css stacks the phone picture over its words
    let current = 0;
    let shown = false; // the first picture has been fetched
    let onScreen = false, focused = false, touched = false;
    let heldUntil = 0; // performance.now() until which the slideshow leaves the visitor's own choice alone
    let request = 0;

    const show = (k: number) => {
      const shot: Shot = SHOTS[k];
      const mine = ++request;
      // On a wide screen the phone picture takes less height than the wide ones: keep the height
      // they had while it shows, so nothing below moves. (Applied with the change of picture, not before.)
      const height = shot.phone && !narrow() ? (SHOTS[current].phone ? screen.style.minHeight : `${screen.offsetHeight}px`) : '';
      current = k;
      shown = true;
      buttons.forEach((button, index) => {
        button.classList.toggle('is-on', index === k);
        button.setAttribute('aria-selected', String(index === k));
      });
      // On a phone the tabs are a strip that scrolls sideways: bring the active one into it.
      // (Only the strip is moved. scrollIntoView would be free to scroll the page as well.)
      if (tabs.scrollWidth > tabs.clientWidth) {
        const left = buttons[k].getBoundingClientRect().left - tabs.getBoundingClientRect().left + tabs.scrollLeft;
        tabs.scrollTo({ left: Math.max(0, left - 24), behavior: still.matches ? 'auto' : 'smooth' });
      }
      screen.classList.add('is-changing');
      const next = new Image();
      const dipped = new Promise((resolve) => setTimeout(resolve, 170)); // long enough for the old picture to dim
      next.onload = next.onerror = () => void dipped.then(() => {
        if (mine !== request) return; // another screen was chosen meanwhile
        screen.style.minHeight = height;
        screen.classList.toggle('is-phone', !!shot.phone);
        image.src = next.src;
        image.alt = `Screen from the tracker: ${shot.tab.toLowerCase()}`;
        text.textContent = shot.text;
        screen.classList.remove('is-changing');
        new Image().src = address(following()); // have the one after ready, so the next change is instant
      });
      next.src = address(k);
    };
    /** The screen the slideshow shows after the current one. */
    const following = (): number => {
      for (let step = 1; step <= SHOTS.length; step++) {
        const k = (current + step) % SHOTS.length;
        if (!(SHOTS[k].phone && narrow())) return k;
      }
      return current;
    };
    const sync = () => {
      const now = performance.now();
      const running = shown && !still.matches && now >= heldUntil;
      tabs.classList.toggle('is-auto', running);
      tabs.classList.toggle('is-paused', running && !(this.visible && onScreen && !document.hidden && !focused && !touched));
    };
    this.syncSlides = sync;
    const hold = (ms: number) => {
      heldUntil = Math.max(heldUntil, performance.now() + ms);
      setTimeout(sync, ms + 30);
      sync();
    };

    SHOTS.forEach((shot, k) => {
      const button = document.createElement('button');
      button.textContent = shot.tab;
      button.setAttribute('role', 'tab');
      button.addEventListener('click', () => {
        show(k);
        hold(SLIDE_HOLD_MS);
      });
      // Fetch a picture when its tab is pointed at, so the click shows it at once.
      button.addEventListener('pointerenter', () => (new Image().src = address(k)), { once: true });
      buttons.push(button);
      tabs.append(button);
    });
    buttons[0].classList.add('is-on');
    text.textContent = SHOTS[0].text;
    // The first picture is only fetched when the showcase comes near the screen.
    new IntersectionObserver((entries, observer) => {
      if (!entries[0].isIntersecting) return;
      observer.disconnect();
      show(0);
      sync();
    }, { root: this.scroller, rootMargin: '600px' }).observe(screen);
    // … and the slideshow only runs while a good part of it can actually be seen.
    new IntersectionObserver((entries) => {
      onScreen = entries[0].isIntersecting;
      sync();
    }, { root: this.scroller, threshold: 0.35 }).observe(screen);

    tabs.addEventListener('animationend', (event) => {
      if (event.animationName === 'ld-tab-progress') show(following());
    });
    for (const part of [tabs, screen]) {
      part.addEventListener('touchstart', () => {
        touched = true;
        sync();
      }, { passive: true });
      for (const end of ['touchend', 'touchcancel']) {
        part.addEventListener(end, () => {
          touched = false;
          hold(TOUCH_HOLD_MS);
        }, { passive: true });
      }
    }
    // Only focus from the keyboard counts: a tab keeps the focus after a click, and that must not stop the show for good.
    tabs.addEventListener('focusin', (event) => {
      focused = (event.target as HTMLElement).matches(':focus-visible');
      sync();
    });
    tabs.addEventListener('focusout', () => {
      focused = false;
      sync();
    });
    document.addEventListener('visibilitychange', sync);
    still.addEventListener('change', sync);
    window.addEventListener('resize', () => {
      if (!SHOTS[current].phone) screen.style.minHeight = ''; // the held height was for the old width
    });
  }

  // ---- the plate of spacecraft ------------------------------------------------------------

  /**
   * The plate: EVERY kind of model, in one row that scrolls sideways (the owner asked to be able
   * to look through all of them here): the six favourites first, then the catalogue's groups. Its
   * layout is made once and complete — a square and a caption per kind — so the page never
   * changes length; the row's own height is fixed. Pictures fade into their squares as they are
   * drawn (see drawPlate). Arrow buttons scroll a pageful for a mouse without a sideways wheel.
   */
  private layPlate(): Map<ModelKind, HTMLImageElement> {
    const slots = new Map<ModelKind, HTMLImageElement>();
    const figures: HTMLElement[] = [];
    const order = [...new Set<ModelKind>([...PLATE, ...kindGroups().flatMap(([, kinds]) => kinds)])];
    for (const kind of order) {
      const figure = document.createElement('figure');
      figure.dataset.kind = kind;
      const image = Object.assign(document.createElement('img'), { alt: '' });
      figure.append(image, Object.assign(document.createElement('figcaption'), { textContent: KIND_LABEL[kind] }));
      figures.push(figure);
      slots.set(kind, image);
    }
    const plate = $('ld-plate');
    plate.replaceChildren(...figures);
    $('ld-kind-count').textContent = String(order.length);
    const step = (direction: number) => plate.scrollBy({ left: direction * plate.clientWidth * 0.85, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    $('ld-plate-back').addEventListener('click', () => step(-1));
    $('ld-plate-on').addEventListener('click', () => step(1));
    const ends = () => {
      $<HTMLButtonElement>('ld-plate-back').disabled = plate.scrollLeft < 4;
      $<HTMLButtonElement>('ld-plate-on').disabled = plate.scrollLeft > plate.scrollWidth - plate.clientWidth - 4;
    };
    plate.addEventListener('scroll', () => {
      ends();
      bar();
      if (!this.gliding) this.plateMoved = performance.now(); // the row's own glide is not the visitor moving it
    }, { passive: true });
    requestAnimationFrame(ends);

    // A slim track of the site's own instead of the browser's scrollbar (its thumb can be dragged).
    const track = document.createElement('div');
    track.className = 'ld-plate-bar';
    const thumb = document.createElement('i');
    track.append(thumb);
    plate.after(track);
    const bar = () => {
      const share = plate.clientWidth / Math.max(1, plate.scrollWidth);
      thumb.style.width = `${Math.max(6, share * 100)}%`;
      thumb.style.transform = `translateX(${(plate.scrollLeft / Math.max(1, plate.scrollWidth - plate.clientWidth)) * (1 / share - 1) * 100}%)`;
    };
    requestAnimationFrame(bar);
    new ResizeObserver(bar).observe(plate);
    thumb.addEventListener('pointerdown', (event) => {
      const x0 = event.clientX, left0 = plate.scrollLeft;
      thumb.setPointerCapture(event.pointerId);
      const move = (e: PointerEvent) => (plate.scrollLeft = left0 + ((e.clientX - x0) / track.clientWidth) * plate.scrollWidth);
      thumb.addEventListener('pointermove', move);
      thumb.addEventListener('pointerup', () => thumb.removeEventListener('pointermove', move), { once: true });
      this.plateHeld = performance.now();
    });

    // Drag the row with the mouse (a finger already can); a drag is not a click on a model.
    let drag: { x: number; left: number; moved: boolean } | null = null;
    plate.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      drag = { x: event.clientX, left: plate.scrollLeft, moved: false };
      plate.classList.add('is-dragging');
    });
    window.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      if (Math.abs(dx) > 4) drag.moved = true;
      plate.scrollLeft = drag.left - dx;
      this.plateHeld = performance.now();
    });
    window.addEventListener('pointerup', () => {
      if (!drag) return;
      if (drag.moved) plate.addEventListener('click', (event) => event.stopPropagation(), { capture: true, once: true });
      drag = null;
      plate.classList.remove('is-dragging');
    });

    // The glide: slowly along by itself while the row is on screen and nobody is using it.
    const wrap = plate.parentElement!;
    let pointing = false, seen = false;
    wrap.addEventListener('pointerenter', (event) => (pointing = event.pointerType === 'mouse'));
    wrap.addEventListener('pointerleave', () => (pointing = false));
    plate.addEventListener('touchstart', () => (this.plateHeld = performance.now()), { passive: true });
    plate.addEventListener('wheel', () => (this.plateHeld = performance.now()), { passive: true });
    new IntersectionObserver((entries) => (seen = entries.some((entry) => entry.isIntersecting)), { root: this.scroller, threshold: 0.3 }).observe(plate);
    const still = matchMedia('(prefers-reduced-motion: reduce)');
    let last = 0, at = 0, restUntil = 0;
    const glide = (now: number) => {
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      const free = this.loaded && seen && !pointing && !drag && !still.matches && !document.hidden && this.visible && now - this.plateHeld > 4000 && now > restUntil && !this.plateDrawing();
      if (free) {
        if (Math.abs(at - plate.scrollLeft) > 2) at = plate.scrollLeft; // the visitor moved it meanwhile: carry on from there
        at += 26 * dt; // pixels a second: slow enough to read the names
        const end = plate.scrollWidth - plate.clientWidth;
        if (at >= end) {
          restUntil = now + 2500; // a pause at the end, then back to the start
          setTimeout(() => {
            this.gliding = true;
            plate.scrollTo({ left: 0, behavior: 'smooth' });
            setTimeout(() => (this.gliding = false), 1200);
            at = 0;
          }, 2400);
        } else {
          this.gliding = true;
          plate.scrollLeft = at;
          this.gliding = false;
        }
      }
      requestAnimationFrame(glide);
    };
    requestAnimationFrame(glide);
    // "See all models" presses the button that opens the catalogue of models. That catalogue is
    // another module's; if its button is not on the page there is nothing to open, and no button here.
    $('landing-models').addEventListener('click', () => document.getElementById('gallery-open')?.click());
    this.offerModels();
    return slots;
  }

  /** Show "See all models" only while there is a catalogue of models to open. */
  private offerModels(): void {
    $('landing-models').hidden = !document.getElementById('gallery-open');
  }

  private plateMoved = 0; // when the row was last scrolled sideways (by the visitor)
  private plateHeld = 0; // when the visitor last dragged, swiped or wheeled the row: the glide waits a while
  private gliding = false; // the row is being moved by its own glide (not counted as the visitor's)
  private platePending: Map<ModelKind, HTMLImageElement> | null = null;
  /** A picture just ahead in the row still has to be drawn: the glide waits for it (drawing holds the main thread). */
  private plateDrawing(): boolean {
    return !!this.platePending && [...this.nearView].some((kind) => this.platePending!.has(kind));
  }
  private readonly nearView = new Set<ModelKind>(); // squares in or near the row's visible part

  /**
   * Draw the pictures with the tracker's own renderer, one at a time, in quiet moments, the
   * squares in view first. Drawing one takes the main thread for a moment (a dozen renders to
   * find its best side), which a finger on the page would feel as a hitch: so nothing is drawn
   * while the page or the row is being moved; the queue simply waits. Squares far along the
   * row are drawn only as the row is scrolled towards them.
   */
  private drawPlate(): void {
    if (this.plateDrawn || !this.plateWanted || !this.loaded) return;
    this.plateDrawn = true;
    const plate = $('ld-plate');
    const pending = new Map(this.slots);
    this.platePending = pending;
    const watcher = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const kind = (entry.target as HTMLElement).dataset.kind as ModelKind;
        if (entry.isIntersecting) this.nearView.add(kind);
        else this.nearView.delete(kind);
      }
    }, { root: plate, rootMargin: '0px 400px' });
    for (const figure of plate.children) watcher.observe(figure);
    const quiet = (): boolean => this.quiet && performance.now() - this.plateMoved > 350;
    const later = (work: () => void, ms: number) => ('requestIdleCallback' in window ? window.requestIdleCallback(work, { timeout: ms * 4 }) : setTimeout(work, ms));
    const next = () => {
      if (pending.size === 0) return watcher.disconnect();
      const kind = [...pending.keys()].find((candidate) => this.nearView.has(candidate));
      if (!kind || !quiet()) return void setTimeout(next, 250); // nothing in view to draw, or the page is moving
      const image = pending.get(kind)!;
      pending.delete(kind);
      const url = modelThumbnail(kind);
      if (url) {
        image.onload = () => image.classList.add('is-in');
        image.src = url;
      }
      later(next, 80);
    };
    later(next, 80);
  }

  // ---- what's new: the change log, newest first ----------------------------------------------

  /** The three newest updates as rows (date and title, then their points); the rest are in About. */
  /** Open the page at its list of every feature (About's link). */
  openAtFeatures(): void {
    this.open();
    requestAnimationFrame(() => document.getElementById('ld-all')?.scrollIntoView({ block: 'start' }));
  }

  // ---- everything you can do: six areas, one at a time --------------------------------------------

  /**
   * The areas (FEATURES' groups) as a list to choose from; the chosen one's features as cards,
   * each with what it does and, in small type, where to find it (HOW). One area at a time keeps
   * sixty-odd features from becoming a wall of text (the owner found the earlier lists
   * "overwhelming" and "AI"); the cards come in with a short stagger when an area is chosen.
   */
  private drawIndex(): void {
    const root = $('ld-feature-list');
    const tabs = document.createElement('div');
    tabs.className = 'ld-ex-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Areas');
    const panel = document.createElement('div');
    panel.className = 'ld-ex-panel';
    panel.setAttribute('role', 'tabpanel');
    const buttons: HTMLButtonElement[] = [];
    const show = (index: number) => {
      const group = FEATURES[index];
      buttons.forEach((button, i) => {
        button.classList.toggle('is-on', i === index);
        button.setAttribute('aria-selected', String(i === index));
      });
      const summary = Object.assign(document.createElement('p'), { className: 'ld-ex-sum', textContent: group.summary });
      const grid = document.createElement('div');
      grid.className = 'ld-ex-grid';
      group.items.forEach((feature, i) => {
        const card = document.createElement('article');
        card.className = 'ld-ex-card';
        card.style.setProperty('--i', String(Math.min(i, 12)));
        card.append(Object.assign(document.createElement('h3'), { textContent: feature.name }), Object.assign(document.createElement('p'), { textContent: feature.text }));
        const how = HOW[feature.name];
        if (how) card.append(Object.assign(document.createElement('span'), { className: 'ld-ex-how', textContent: how }));
        grid.append(card);
      });
      panel.replaceChildren(summary, grid);
    };
    FEATURES.forEach((group, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.className = 'ld-ex-tab';
      button.append(Object.assign(document.createElement('span'), { textContent: group.title }), Object.assign(document.createElement('small'), { textContent: String(group.items.length) }));
      button.addEventListener('click', () => show(i));
      tabs.append(button);
      buttons.push(button);
    });
    root.replaceChildren(tabs, panel);
    show(0);
  }

  // ---- showing, hiding, and what the tracker tells the page ------------------------------------

  /** Is the page in front of the tracker? (Keyboard shortcuts wait while it is.) */
  get showing(): boolean {
    return this.visible;
  }

  /** Is the opening screen — the part the live globe shows through — on screen? */
  get heroInView(): boolean {
    return this.visible && this.scroller.scrollTop < window.innerHeight * 0.95;
  }

  /**
   * Is this a moment when a little work would not be felt? True whenever the page is away;
   * while it is up, only if it is neither under a finger nor has just scrolled.
   */
  get quiet(): boolean {
    return !this.visible || (!this.touching && performance.now() - this.lastScroll > 350);
  }

  /** Is the globe showing through the opening screen yet? */
  get isLive(): boolean {
    return this.live;
  }

  /**
   * The tracker underneath has a globe to draw: let it show through the opening screen. This
   * comes early, as soon as the Earth's own picture has arrived; the objects are still loading.
   */
  goLive(): void {
    this.live = true;
    this.root.classList.add('is-live');
  }

  /**
   * The tracker has loaded everything: say so beside the button, put the real size of the
   * catalogue into the figures, and draw the things that borrow its renderer.
   */
  ready(objects: number): void {
    this.loaded = true;
    this.root.classList.add('is-ready');
    this.status(`${fmtInt(objects)} objects loaded and moving`);
    this.setCount(objects);
    this.offerModels();
    this.drawPlate();
  }

  /** Put the page away and show the tracker. */
  enter(): void {
    if (!this.visible) return;
    this.visible = false;
    this.demo.setAllowed(false);
    this.syncSlides();
    document.body.classList.remove('home-open');
    this.root.classList.add('is-leaving');
    setTimeout(() => {
      if (this.visible) return; // brought straight back
      this.root.classList.add('is-away');
      this.root.classList.remove('is-leaving');
    }, 460); // after the fade in landing.css
    this.firstEntry?.();
    this.firstEntry = null;
  }

  /** Bring the page back from inside the tracker (the "About" button). */
  open(): void {
    if (this.visible) return;
    this.visible = true;
    this.demo.setAllowed(true);
    this.offerModels();
    this.syncSlides();
    document.documentElement.classList.remove('no-landing');
    document.body.classList.add('home-open');
    this.root.classList.remove('is-away', 'is-leaving');
    this.scroller.scrollTop = 0;
    for (const button of this.root.querySelectorAll<HTMLElement>('[data-ld-enter]')) button.textContent = 'Back to the tracker';
  }

  /** The line beside the button: what the tracker behind the page is doing. */
  status(text: string): void {
    $('landing-status').textContent = text;
  }

  /** Put the real size of the catalogue into the figures. */
  setCount(objects: number): void {
    const pairs = (objects * (objects - 1)) / 2;
    for (const el of this.root.querySelectorAll('[data-ld-count]')) el.textContent = fmtInt(objects);
    for (const el of this.root.querySelectorAll('[data-ld-pairs-exact]')) el.textContent = fmtInt(pairs);
  }
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Rows for a list of updates (the home page's "What's new", About's), with class names under `prefix`. */
export function updateRows(updates: typeof WHATS_NEW, prefix: string): HTMLElement[] {
  return updates.map((update) => {
    const row = document.createElement('article');
    row.className = `${prefix}-update`;
    const [y, m, d] = update.date.split('-').map(Number);
    const when = Object.assign(document.createElement('time'), { dateTime: update.date, textContent: `${d} ${MONTH_NAMES[m - 1]} ${y}` });
    const title = Object.assign(document.createElement('h3'), { textContent: update.title });
    const list = document.createElement('ul');
    for (const item of update.items) list.append(Object.assign(document.createElement('li'), { textContent: item }));
    row.append(when, title, list);
    return row;
  });
}
