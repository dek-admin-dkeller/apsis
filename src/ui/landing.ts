/**
 * The home page: what a visitor sees first, and where the tracker is explained.
 *
 * It is built to SHOW the tracker rather than describe it:
 *   - the opening screen has the live globe itself behind the headline (the tracker is already
 *     running underneath; once it is ready the page's backdrop fades and the real thing shows
 *     through). Until then, and on a machine that cannot draw it, the headline stands alone;
 *   - a showcase of real screens (SHOTS in featureList.ts; retaken with `npm run shots`);
 *   - a live drawing of the search that runs the project's own hash table (hashDemo.ts);
 *   - a plate of the tracker's 3D models, drawn by the same code that draws them in orbit;
 *   - the complete list of features (FEATURES in featureList.ts — the one place to keep it
 *     current), as a compact index;
 *   - a small corner for games, and a small drawing that explains the name.
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
import { modelThumbnail } from '../render/satModels.ts';
import { $, fmtInt } from './dom.ts';
import { FEATURES, SHOTS, type Shot } from './featureList.ts';
import { HashDemo } from './hashDemo.ts';

export interface LandingHost {
  /** Open the full walkthrough (it is drawn over this page). */
  howItWorks(): void;
}

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
  private live = false;

  constructor() {
    this.visible = !document.documentElement.classList.contains('no-landing');
    this.entered = this.visible ? new Promise((resolve) => (this.firstEntry = resolve)) : Promise.resolve();
    if (!this.visible) this.root.classList.add('is-away');
    document.body.classList.toggle('home-open', this.visible);

    this.drawShowcase();
    this.drawIndex();
    this.demo = new HashDemo($<HTMLCanvasElement>('ld-demo-canvas'), {
      objects: $('ld-demo-n'), checks: $('ld-demo-checks'), pairs: $('ld-demo-pairs'), mode: $('ld-demo-mode'),
    });
    this.demo.setAllowed(this.visible);
    // The models are drawn by the tracker's own renderer, so only once it has loaded — and only
    // if the visitor scrolls that far.
    new IntersectionObserver((entries, observer) => {
      if (!entries[0].isIntersecting) return;
      observer.disconnect();
      this.plateWanted = true;
      this.drawPlate();
    }, { rootMargin: '400px' }).observe($('ld-plate'));

    for (const button of this.root.querySelectorAll<HTMLElement>('[data-ld-enter]')) button.addEventListener('click', () => this.enter());
    for (const link of this.root.querySelectorAll<HTMLElement>('[data-ld-jump]')) {
      link.addEventListener('click', () => $(link.dataset.ldJump!).scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
    $('landing-how').addEventListener('click', () => this.host?.howItWorks());
    // The bar is glass over the live globe only while the page is at its very top.
    this.scroller.addEventListener('scroll', () => this.root.classList.toggle('is-scrolled', this.scroller.scrollTop > 8), { passive: true });
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

  // ---- the showcase: one large real screen at a time ----------------------------------------

  private drawShowcase(): void {
    const tabs = $('ld-tabs'), image = $<HTMLImageElement>('ld-shot'), text = $('ld-shot-text'), screen = $('ld-screen');
    const show = (shot: Shot, button: HTMLElement) => {
      for (const other of tabs.children) {
        other.classList.toggle('is-on', other === button);
        other.setAttribute('aria-selected', String(other === button));
      }
      screen.classList.toggle('is-phone', !!shot.phone);
      screen.classList.add('is-changing');
      const next = new Image();
      next.onload = next.onerror = () => {
        image.src = next.src;
        image.alt = `Screen from the tracker: ${shot.tab.toLowerCase()}`;
        text.textContent = shot.text;
        screen.classList.remove('is-changing');
      };
      next.src = `./shots/${shot.file}.webp`;
    };
    SHOTS.forEach((shot, k) => {
      const button = document.createElement('button');
      button.textContent = shot.tab;
      button.setAttribute('role', 'tab');
      button.addEventListener('click', () => show(shot, button));
      // Fetch a picture when its tab is pointed at, so the click shows it at once.
      button.addEventListener('pointerenter', () => (new Image().src = `./shots/${shot.file}.webp`), { once: true });
      tabs.append(button);
      if (k === 0) {
        // The first picture is only fetched when the showcase comes near the screen.
        new IntersectionObserver((entries, observer) => {
          if (!entries[0].isIntersecting) return;
          observer.disconnect();
          show(shot, button);
        }, { rootMargin: '600px' }).observe(screen);
        button.classList.add('is-on');
        text.textContent = shot.text;
      }
    });
  }

  // ---- the plate of spacecraft ------------------------------------------------------------

  /** One picture per kind of model, rendered by the tracker's own code in idle moments. */
  private drawPlate(): void {
    if (this.plateDrawn || !this.plateWanted || !this.live) return;
    this.plateDrawn = true;
    const plate = $('ld-plate');
    const kinds = Object.keys(KIND_LABEL) as ModelKind[];
    const idle = (work: () => void) => ('requestIdleCallback' in window ? window.requestIdleCallback(work, { timeout: 1500 }) : setTimeout(work, 60));
    const next = () => {
      const kind = kinds.shift();
      if (!kind) return;
      const url = modelThumbnail(kind);
      if (url) {
        const figure = document.createElement('figure');
        const image = Object.assign(document.createElement('img'), { src: url, alt: '' });
        const caption = Object.assign(document.createElement('figcaption'), { textContent: KIND_LABEL[kind] });
        figure.append(image, caption);
        plate.append(figure);
      }
      idle(next);
    };
    idle(next);
  }

  // ---- everything it does: a compact index ---------------------------------------------------

  /**
   * Each group is a row: its name, the names of its features, and one line of text that
   * shows whichever feature is being pointed at (or the group's own summary). The whole list
   * stays on the page without becoming a wall of paragraphs.
   */
  private drawIndex(): void {
    const list = $('ld-feature-list');
    for (const group of FEATURES) {
      const row = document.createElement('div');
      row.className = 'ld-row';
      const title = Object.assign(document.createElement('h3'), { textContent: group.title });
      const names = document.createElement('div');
      names.className = 'ld-names';
      const line = Object.assign(document.createElement('p'), { className: 'ld-line', textContent: group.summary });
      let pinned: HTMLElement | null = null; // a tapped name keeps its text until another is tapped
      for (const feature of group.items) {
        const name = document.createElement('button');
        name.textContent = feature.name;
        if (feature.fresh) name.append(Object.assign(document.createElement('span'), { className: 'ld-fresh', textContent: 'new' }));
        const point = () => {
          line.textContent = feature.text;
          for (const other of names.children) other.classList.toggle('is-on', other === name);
        };
        name.addEventListener('pointerenter', point);
        name.addEventListener('focus', point);
        name.addEventListener('click', () => {
          pinned = name;
          point();
        });
        names.append(name);
      }
      names.addEventListener('pointerleave', () => {
        if (pinned) return pinned.dispatchEvent(new Event('focus'));
        line.textContent = group.summary;
        for (const other of names.children) other.classList.remove('is-on');
      });
      const body = document.createElement('div');
      body.append(names, line);
      row.append(title, body);
      list.append(row);
    }
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
   * The tracker underneath has loaded and is drawing: let it show through the opening screen,
   * and draw the things that need its renderer.
   */
  goLive(): void {
    this.live = true;
    this.root.classList.add('is-live');
    this.drawPlate();
  }

  /** Put the page away and show the tracker. */
  enter(): void {
    if (!this.visible) return;
    this.visible = false;
    this.demo.setAllowed(false);
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
