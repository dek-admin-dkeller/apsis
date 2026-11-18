/**
 * The welcome page: what a visitor sees first, instead of a loading screen.
 *
 * The tracker starts loading behind it straight away (the page is an opaque layer on top,
 * static markup in index.html so it is painted before any script has run). When the visitor
 * presses "Open the tracker" the page fades and whatever is underneath shows: the tracker
 * itself if it has finished loading, otherwise the launch screen with its progress.
 *
 * It is skipped for share links (the visitor asked for something specific) and when the
 * "Welcome page" setting is off — index.html decides that before the first paint by putting
 * the class `no-landing` on <html>.
 */

import './landing.css';
import { $ } from './dom.ts';

export class Landing {
  /** Resolves when the visitor chooses to go in (immediately if the page is skipped). */
  readonly entered: Promise<void>;
  private open: boolean;

  constructor() {
    const root = $('landing');
    this.open = !document.documentElement.classList.contains('no-landing');
    if (!this.open) {
      root.remove();
      this.entered = Promise.resolve();
      return;
    }
    const button = $<HTMLButtonElement>('landing-enter');
    button.focus({ preventScroll: true });
    this.entered = new Promise((resolve) => {
      const enter = () => {
        if (!this.open) return;
        this.open = false;
        root.classList.add('is-leaving');
        setTimeout(() => root.remove(), 460); // after the fade in landing.css
        resolve();
      };
      button.addEventListener('click', enter);
      window.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') enter();
      });
    });
  }

  /** Is the page still in front of the tracker? (Keyboard shortcuts wait until it is not.) */
  get showing(): boolean {
    return this.open;
  }

  /** The line beside the button: what the tracker behind the page is doing. */
  status(text: string): void {
    if (this.open) $('landing-status').textContent = text;
  }
}
