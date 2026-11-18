/** Loading screen: animated object counter and progress bar. */

import { $, fmtInt } from './dom.ts';

export class LoadingScreen {
  private readonly counter = $('loading-count');
  private readonly bar = $('loading-bar');
  private readonly status = $('loading-status');
  private counted: Promise<void> = Promise.resolve();

  /** Count up from 0 to the number of objects in the catalogue. */
  countTo(total: number, durationMs = 2200): void {
    this.counted = new Promise((resolve) => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, Math.max(0, (now - start) / durationMs)); // the first frame's timestamp can predate `start`
        this.counter.textContent = fmtInt(total * (1 - Math.pow(1 - t, 3))); // ease-out
        if (t < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
  }

  private shown = 0;

  /** Progress never goes backwards, even though textures and data finish in no fixed order. */
  progress(fraction: number, status: string): void {
    fraction = this.shown = Math.max(this.shown, fraction);
    this.bar.style.width = `${Math.round(fraction * 100)}%`;
    $('loading').style.setProperty('--p', fraction.toFixed(3)); // how high the rocket has climbed
    this.status.textContent = status;
  }

  /** Launch and fade out once the counter has finished its run. */
  async finish(): Promise<void> {
    await this.counted;
    this.progress(1, 'Lift-off');
    $('loading').classList.add('is-liftoff'); // the rocket leaves the top of the screen …
    await new Promise((resolve) => setTimeout(resolve, 900));
    $('loading').classList.add('is-done'); // … and the globe fades in behind it
  }

  /**
   * The tracker finished loading while the visitor was still on the home page: put this
   * screen away at once, with no lift-off, so the live globe can show through that page.
   */
  skip(): void {
    this.progress(1, 'Ready');
    $('loading').classList.add('is-done');
  }

  fail(message: string): void {
    this.status.textContent = message;
    this.status.style.color = 'var(--red)';
  }
}
