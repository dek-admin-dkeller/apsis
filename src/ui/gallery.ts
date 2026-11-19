/**
 * The spacecraft catalogue: every 3D model in one place.
 *
 * A page of small pictures, grouped by where the craft work. Choosing one shows it large,
 * slowly turning, to be dragged round with the mouse or a finger, with its name and one
 * sentence about the real thing; where the Earth catalogue has objects of that kind, a button
 * goes and finds one in orbit.
 *
 * It is opened by anything that presses #gallery-open (the About sheet has that button; the
 * Tools tab and the home page press it), and it lies above the home page, as the walkthrough
 * does, because it is opened from there too.
 *
 * What it costs: nothing until it is first opened. Then the pictures are drawn one at a time
 * in idle moments (each takes the main thread for a moment), into squares that already have
 * their size, so nothing moves as they arrive. The large view has its own small renderer,
 * made the first time a model is chosen, and runs only while that view is on screen.
 */

import { KIND_LABEL, type ModelKind } from '../data/describe.ts';
import { KIND_FACT, kindGroups } from '../data/spacecraft.ts';
import { ModelPreview, modelThumbnail } from '../render/satModels.ts';
import { $ } from './dom.ts';
import './gallery.css';

/** What the catalogue needs from the rest of the program. */
export interface GalleryHost {
  /** How many objects of this kind can be shown in orbit right now. Zero: no button. */
  count(kind: ModelKind): number;
  /** Go and show one of them. The catalogue has already closed itself. */
  show(kind: ModelKind): void;
  /** What the button says for this kind ("Show one in orbit" when not given): a rocket's is "Preview its next launch". */
  label?(kind: ModelKind): string;
}

export class Gallery {
  private readonly overlay = $('gallery');
  private readonly host: GalleryHost;
  private readonly kinds: ModelKind[] = []; // in the order they are laid out: what "next" means
  private readonly queue: [ModelKind, HTMLImageElement][] = []; // pictures still to draw
  private built = false;
  private drawing = false;
  private dragging = false;
  private running = false; // the large view's frame loop is going
  private shown: ModelKind | null = null; // the model in the large view, if that view is up
  private preview: ModelPreview | null = null;
  private opener: HTMLElement | null = null; // what had the keyboard before, to give it back
  // parts of the page, made on first opening
  private grid!: HTMLElement;
  private detail!: HTMLElement;
  private stage!: HTMLCanvasElement;
  private back!: HTMLButtonElement;
  private count!: HTMLElement;
  private caption!: HTMLElement;
  private fact!: HTMLElement;
  private orbit!: HTMLButtonElement;

  constructor(host: GalleryHost) {
    this.host = host;
    $('gallery-open').addEventListener('click', () => this.open());
    this.overlay.addEventListener('pointerdown', (event) => {
      if (event.target === this.overlay) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.overlay.classList.contains('is-hidden');
  }

  /** Open the catalogue, at the page of pictures or straight at one model. */
  open(kind?: ModelKind): void {
    if (!this.built) this.build();
    if (!this.isOpen) {
      this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.overlay.classList.remove('is-hidden');
      window.addEventListener('keydown', this.onKey, true);
    }
    if (kind) this.choose(kind);
    else {
      this.leaveDetail();
      this.grid.focus({ preventScroll: true });
    }
    this.draw();
  }

  close(): void {
    if (!this.isOpen) return;
    this.overlay.classList.add('is-hidden');
    window.removeEventListener('keydown', this.onKey, true);
    this.leaveDetail();
    if (this.opener?.isConnected) this.opener.focus({ preventScroll: true });
    this.opener = null;
  }

  // ---- the page ---------------------------------------------------------------------------

  private build(): void {
    this.built = true;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] => {
      const node = document.createElement(tag);
      node.className = className;
      if (text) node.textContent = text;
      return node;
    };
    const panel = el('div', 'panel gal');
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-label', 'Spacecraft catalogue');

    // Head: the title, which in the large view is the way back (as in the Objects panel), a count, the cross.
    const head = el('header', 'panel-head');
    const title = el('h2', 'gal-title');
    this.back = el('button', 'gal-back', 'Spacecraft');
    this.back.type = 'button';
    this.back.disabled = true; // only a title until a model is chosen
    this.back.addEventListener('click', () => this.leaveDetail(true));
    title.append(this.back);
    this.count = el('span', 'gal-count');
    const cross = el('button', 'icon-btn', '×');
    cross.type = 'button';
    cross.setAttribute('aria-label', 'Close');
    cross.addEventListener('click', () => this.close());
    head.append(title, this.count, cross);

    // The page of pictures.
    this.grid = el('div', 'gal-grid');
    this.grid.tabIndex = -1;
    for (const [heading, kinds] of kindGroups()) {
      const group = el('section', 'gal-group');
      const tiles = el('div', 'gal-tiles');
      for (const kind of kinds) {
        const tile = el('button', 'gal-tile');
        tile.type = 'button';
        const picture = el('span', 'gal-thumb');
        const image = Object.assign(document.createElement('img'), { alt: '', draggable: false });
        picture.append(image);
        tile.append(picture, el('span', 'gal-name', KIND_LABEL[kind]));
        tile.addEventListener('click', () => this.choose(kind));
        tiles.append(tile);
        this.kinds.push(kind);
        this.queue.push([kind, image]);
      }
      group.append(el('h3', 'gal-heading', heading), tiles);
      this.grid.append(group);
    }

    // The large view.
    this.detail = el('div', 'gal-detail is-hidden');
    this.stage = el('canvas', 'gal-stage');
    this.caption = el('h3', 'gal-caption');
    this.fact = el('p', 'gal-fact');
    this.orbit = el('button', 'btn gal-orbit', 'Show one in orbit');
    this.orbit.type = 'button';
    this.orbit.addEventListener('click', () => {
      const kind = this.shown;
      if (!kind) return;
      this.close();
      this.host.show(kind);
    });
    const step = (by: number, label: string, sign: string): HTMLButtonElement => {
      const button = el('button', `icon-btn gal-step ${by < 0 ? 'gal-prev' : 'gal-next'}`, sign);
      button.type = 'button';
      button.setAttribute('aria-label', label);
      button.addEventListener('click', () => this.step(by));
      return button;
    };
    const words = el('div', 'gal-words');
    words.append(this.caption, this.fact);
    const foot = el('div', 'gal-foot');
    foot.append(words, this.orbit);
    this.detail.append(this.stage, step(-1, 'Previous', '‹'), step(1, 'Next', '›'), foot);

    panel.append(head, this.grid, this.detail);
    this.overlay.replaceChildren(panel);
    this.count.textContent = `${this.kinds.length} models`;
    this.turnByHand();
  }

  /** Draw the waiting pictures, one per idle moment, while the catalogue is open. */
  private draw(): void {
    if (this.drawing) return;
    this.drawing = true;
    const later = (work: () => void, ms: number) => ('requestIdleCallback' in window ? window.requestIdleCallback(work, { timeout: ms * 4 }) : setTimeout(work, ms));
    const next = () => {
      if (!this.isOpen || this.queue.length === 0) return void (this.drawing = false);
      if (this.dragging) return void setTimeout(next, 250); // a picture now would be felt as a hitch under the hand
      const [kind, image] = this.queue.shift()!;
      const url = modelThumbnail(kind);
      if (url) {
        image.onload = () => image.classList.add('is-in');
        image.src = url;
      }
      later(next, 60);
    };
    later(next, 60);
  }

  // ---- one model, large -------------------------------------------------------------------

  private choose(kind: ModelKind): void {
    const first = this.shown === null;
    this.shown = kind;
    this.grid.classList.add('is-hidden');
    this.detail.classList.remove('is-hidden');
    this.back.disabled = false;
    this.back.classList.add('is-back');
    this.back.setAttribute('aria-label', 'Back to all spacecraft');
    this.count.textContent = `${this.kinds.indexOf(kind) + 1} / ${this.kinds.length}`;
    this.caption.textContent = KIND_LABEL[kind];
    this.fact.textContent = KIND_FACT[kind];
    const inOrbit = this.host.count(kind);
    this.orbit.classList.toggle('is-hidden', inOrbit === 0);
    this.orbit.textContent = this.host.label?.(kind) ?? 'Show one in orbit';
    this.orbit.title = inOrbit === 1 ? 'There is one to see' : `${inOrbit.toLocaleString('en-US')} to see`;
    try {
      this.preview ??= new ModelPreview(this.stage, true);
      this.preview.show(kind);
    } catch {
      this.preview = null; // no graphics context to spare: the name and the sentence still stand
    }
    if (first) this.back.focus({ preventScroll: true });
    if (!this.running) {
      this.running = true;
      requestAnimationFrame(this.frame);
    }
  }

  private leaveDetail(focusTile = false): void {
    const was = this.shown;
    this.shown = null;
    if (!this.built) return;
    this.detail.classList.add('is-hidden');
    this.grid.classList.remove('is-hidden');
    this.back.classList.remove('is-back');
    this.back.removeAttribute('aria-label');
    this.back.disabled = true;
    this.count.textContent = `${this.kinds.length} models`;
    // Back where the visitor was: on the tile they chose (or its neighbour, after stepping along).
    const tile = was ? this.grid.querySelectorAll<HTMLElement>('.gal-tile')[this.kinds.indexOf(was)] : null;
    if (focusTile && tile) {
      tile.focus({ preventScroll: true });
      tile.scrollIntoView({ block: 'nearest' });
    }
  }

  private step(by: number): void {
    if (!this.shown) return;
    const n = this.kinds.length;
    this.choose(this.kinds[(this.kinds.indexOf(this.shown) + by + n) % n]);
  }

  /** The large view's own frame loop: it stops by itself as soon as that view is left. */
  private readonly frame = (ms: number): void => {
    if (!this.shown || !this.isOpen) return void (this.running = false);
    this.preview?.render(ms / 1000);
    requestAnimationFrame(this.frame);
  };

  /** Dragging the picture turns the model; letting go lets it drift on. */
  private turnByHand(): void {
    let lastX = 0, lastY = 0;
    this.stage.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      this.stage.setPointerCapture(event.pointerId);
      this.preview?.hold(true);
    });
    this.stage.addEventListener('pointermove', (event) => {
      if (!this.dragging) return;
      this.preview?.turn((event.clientX - lastX) * 0.011, (event.clientY - lastY) * 0.008);
      lastX = event.clientX;
      lastY = event.clientY;
    });
    const release = () => {
      this.dragging = false;
      this.preview?.hold(false);
    };
    this.stage.addEventListener('pointerup', release);
    this.stage.addEventListener('pointercancel', release);
  }

  // ---- keyboard ---------------------------------------------------------------------------

  /**
   * Keys while the catalogue is open. Caught before anything else sees them, so the tracker's
   * one-letter shortcuts do not fire behind the page (and so Escape works from the home page,
   * where the tracker's own key handler is switched off).
   */
  private readonly onKey = (event: KeyboardEvent): void => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.shown) this.leaveDetail(true);
      else this.close();
    } else if (this.shown && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      this.step(event.key === 'ArrowLeft' ? -1 : 1);
    } else if (event.key === 'Tab') {
      // Keep the keyboard inside the page while it is open.
      const stops = [...this.overlay.querySelectorAll<HTMLButtonElement>('button')].filter((button) => !button.disabled && button.offsetParent !== null);
      const first = stops[0], last = stops[stops.length - 1];
      const at = document.activeElement;
      if (!first) return;
      if (event.shiftKey && (at === first || !this.overlay.contains(at))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (at === last || !this.overlay.contains(at))) {
        event.preventDefault();
        first.focus();
      }
    }
  };
}
