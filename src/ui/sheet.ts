/**
 * Phones: the tool panels and the inspector are bottom sheets. This makes them draggable —
 * grab a sheet by its header and slide it to any height, from just the header (so the
 * globe and the 3D model have the whole screen) up to nearly full screen.
 *
 * The height lives in the CSS variable --sheet (src/mobile.css reads it), so there is
 * nothing to re-lay-out here: dragging just changes one number.
 */

const PHONE_MAX_WIDTH = 760;
const COLLAPSED = 58; // px: the header alone
const DEFAULT_SHARE = 0.54; // of the screen height (matches --sheet in mobile.css)

export class Sheets {
  private height: number | null = null; // px once dragged; null = the stylesheet's default (58% of the screen)
  private readonly onResize: () => void;

  constructor(onResize: () => void) {
    this.onResize = onResize;
    for (const head of document.querySelectorAll<HTMLElement>('.dock > .panel > .panel-head, .dock > .panel > .insp-head')) {
      this.makeDraggable(head);
    }
    window.addEventListener('resize', () => {
      if (this.height !== null) this.set(this.height); // re-clamp to the new screen
    });
  }

  static get isPhone(): boolean {
    return window.innerWidth <= PHONE_MAX_WIDTH;
  }

  /** Height of an open sheet right now, in pixels (what the 3D view should make room for). */
  get current(): number {
    return this.height ?? Math.round(window.innerHeight * DEFAULT_SHARE);
  }

  private get tallest(): number {
    return Math.max(COLLAPSED, window.innerHeight - 56 - 62 - 10); // below the search field, above the tab bar (matches --top and --status in mobile.css)
  }

  /** A sheet that is being opened always starts at its normal height, whatever the last one was dragged to. */
  reset(): void {
    if (this.height === null) return;
    this.height = null;
    document.documentElement.style.removeProperty('--sheet');
    this.onResize();
  }

  /** Glide to a height (used after a tap or a flick) instead of jumping. */
  private glide(px: number): void {
    document.documentElement.classList.add('sheet-gliding'); // mobile.css animates max-height while this is set
    this.set(px);
    setTimeout(() => document.documentElement.classList.remove('sheet-gliding'), 440);
  }

  private set(px: number): void {
    this.height = Math.round(Math.min(this.tallest, Math.max(COLLAPSED, px)));
    document.documentElement.style.setProperty('--sheet', `${this.height}px`);
    this.onResize();
  }

  private makeDraggable(head: HTMLElement): void {
    let startY = 0, startHeight = 0, moved = false, active = false;
    let lastY = 0, lastT = 0, velocity = 0; // px per ms, positive = moving down
    head.addEventListener('pointerdown', (event) => {
      if (!Sheets.isPhone) return;
      if ((event.target as HTMLElement).closest('button, input, a, label')) return; // close, star, switches still work
      active = true;
      moved = false;
      startY = lastY = event.clientY;
      lastT = event.timeStamp;
      velocity = 0;
      startHeight = head.parentElement!.getBoundingClientRect().height;
      head.setPointerCapture(event.pointerId);
    });
    head.addEventListener('pointermove', (event) => {
      if (!active) return;
      const dt = event.timeStamp - lastT;
      if (dt > 0) velocity = 0.7 * velocity + 0.3 * ((event.clientY - lastY) / dt);
      lastY = event.clientY;
      lastT = event.timeStamp;
      const dy = event.clientY - startY;
      if (Math.abs(dy) > 4) moved = true;
      if (moved) this.set(startHeight - dy);
    });
    const end = () => {
      if (!active) return;
      active = false;
      // A tap (no drag) toggles between tucked away and the default height.
      if (!moved) this.glide(this.current <= COLLAPSED + 24 ? window.innerHeight * DEFAULT_SHARE : COLLAPSED);
      // A quick flick carries on in its direction: down tucks the sheet away, up opens it fully.
      else if (velocity > 0.5) this.glide(COLLAPSED); // 500 px/s counts as a deliberate fling
      else if (velocity < -0.5) this.glide(this.tallest);
    };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', () => (active = false));
  }
}
